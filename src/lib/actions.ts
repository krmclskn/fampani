"use server";

import { redirect } from "next/navigation";
import { audit, ensureStockRequests, stockMove, get, hashPassword, run, todayStr, tx, verifyPassword } from "./db";
import { can, createSession, destroySession, requireUser, ROLE_LABEL, type Role, type User } from "./auth";
import { fail, ok } from "./flash";
import { EXCEPTION_REASONS, EXCEPTION_ROUTE, LOCATIONS, UNITS, parseNum, str } from "./util";

const now = () => new Date().toISOString();
const id = (f: FormData, k = "id") => Number(f.get(k)) || 0;

/* ---------- Giriş ---------- */

const attempts = new Map<string, { n: number; until: number }>();

export async function login(f: FormData) {
  const username = (str(f.get("username")) ?? "").toLowerCase();
  const password = typeof f.get("password") === "string" ? (f.get("password") as string) : "";
  const a = attempts.get(username);
  if (a && a.until > Date.now()) redirect("/giris?hata=" + encodeURIComponent("Çok fazla deneme. Birkaç dakika sonra tekrar deneyin."));
  const u = await get<{ id: number; password_hash: string }>("SELECT id,password_hash FROM users WHERE username=? AND active=1", username);
  if (!u || !verifyPassword(password, u.password_hash)) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(username, { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 5 * 60000 : 0 });
    redirect("/giris?hata=" + encodeURIComponent("Kullanıcı adı veya parola hatalı."));
  }
  attempts.delete(username);
  await createSession(u.id);
  await audit(u.id, "Giriş yaptı");
  const role = (await get<{ role: string }>("SELECT role FROM users WHERE id=?", u.id))?.role;
  redirect(role === "sahip" ? "/finans" : role === "operasyon" ? "/operasyon" : "/");
}

export async function logout() {
  await destroySession();
  redirect("/giris");
}

/* ---------- Görevler ---------- */

type Task = {
  id: number; title: string; kind: string; status: string; assignee_id: number | null; assignee_role: string | null;
  needs_review: number; area_id: number | null; done_by: number | null;
};
const getTask = async (tid: number) => await get<Task>("SELECT * FROM tasks WHERE id=?", tid);
const mayWork = (u: User, t: Task) =>
  t.kind !== "is" || t.assignee_id === u.id || t.assignee_role === u.role || can.assignTasks(u);

export async function taskDone(f: FormData) {
  const u = await requireUser();
  const t = await getTask(id(f));
  if (!t || !["atandi", "engellendi"].includes(t.status)) return fail("Görev bulunamadı veya zaten kapatılmış.");
  if (!mayWork(u, t)) return fail("Bu görev size atanmamış.");
  const status = t.needs_review && !can.reviewTasks(u) ? "kontrol" : "tamamlandi";
  await run("UPDATE tasks SET status=?, note=COALESCE(?,note), exception_reason=NULL, done_by=?, done_at=? WHERE id=?",
    status, str(f.get("note")), u.id, now(), t.id);
  await audit(u.id, status === "kontrol" ? "Görevi kontrole gönderdi" : "Görevi tamamladı", "task", t.id, t.title);
  return ok(status === "kontrol" ? "Kontrole gönderildi." : "Tamamlandı.");
}

export async function taskBlock(f: FormData) {
  const u = await requireUser();
  const t = await getTask(id(f));
  const reason = str(f.get("reason")) ?? "";
  if (!t || t.status !== "atandi") return fail("Görev bulunamadı veya zaten kapatılmış.");
  if (!mayWork(u, t)) return fail("Bu görev size atanmamış.");
  if (!(EXCEPTION_REASONS as readonly string[]).includes(reason)) return fail("Bir istisna nedeni seçin.");
  const note = str(f.get("note"));
  await tx(async () => {
    await run("UPDATE tasks SET status='engellendi', exception_reason=?, note=?, done_by=?, done_at=? WHERE id=?",
      reason, note, u.id, now(), t.id);
    await run(
      `INSERT INTO tasks(date,title,detail,kind,area_id,assignee_role,priority,source,created_by,created_at)
       VALUES(?,?,?,'is',?,?,'yuksek',?,?,?)`,
      todayStr(), `${reason}: ${t.title}`, note, t.area_id, EXCEPTION_ROUTE[reason], `task:${t.id}`, u.id, now(),
    );
    await audit(u.id, "Görevi istisnayla kapattı", "task", t.id, `${reason} — ${t.title}`);
  });
  return ok("İstisna kaydedildi, ilgili sorumluya görev açıldı.");
}

export async function taskReview(f: FormData) {
  const u = await requireUser();
  const t = await getTask(id(f));
  if (!t || t.status !== "kontrol") return fail("Kontrol bekleyen görev bulunamadı.");
  if (!can.reviewTasks(u)) return fail("Kontrol yetkiniz yok.");
  if (t.done_by === u.id) return fail("Kendi tamamladığınız işi siz onaylayamazsınız.");
  const approve = f.get("karar") === "onay";
  await run("UPDATE tasks SET status=?, reviewed_by=? WHERE id=?", approve ? "tamamlandi" : "atandi", u.id, t.id);
  await audit(u.id, approve ? "Görevi onayladı" : "Görevi geri gönderdi", "task", t.id, t.title);
  return ok(approve ? "Onaylandı." : "Geri gönderildi.");
}

export async function taskReopen(f: FormData) {
  const u = await requireUser();
  const t = await getTask(id(f));
  if (!t || !["tamamlandi", "engellendi", "kontrol"].includes(t.status)) return fail("Görev yeniden açılamaz.");
  if (!(can.assignTasks(u) || t.done_by === u.id)) return fail("Yetkiniz yok.");
  await run("UPDATE tasks SET status='atandi', exception_reason=NULL, done_by=NULL, done_at=NULL, reviewed_by=NULL WHERE id=?", t.id);
  await audit(u.id, "Görevi yeniden açtı", "task", t.id, t.title);
  return ok("Görev yeniden açıldı.");
}

export async function taskCancel(f: FormData) {
  const u = await requireUser();
  const t = await getTask(id(f));
  const reason = str(f.get("note"));
  if (!t || t.kind !== "is" || t.status === "tamamlandi") return fail("Görev iptal edilemez.");
  if (!can.assignTasks(u)) return fail("Yetkiniz yok.");
  if (!reason) return fail("İptal nedeni yazın.");
  await run("UPDATE tasks SET status='iptal', note=?, done_by=?, done_at=? WHERE id=?", reason, u.id, now(), t.id);
  await audit(u.id, "Görevi iptal etti", "task", t.id, `${t.title} — ${reason}`);
  return ok("Görev iptal edildi.");
}

/* ---------- Yapılacaklar ---------- */

type Todo = { id: number; title: string; status: string; assignee_id: number | null; assignee_role: string | null; created_by: number | null; kind: string };
const getTodo = async (tid: number) => await get<Todo>("SELECT id,title,status,assignee_id,assignee_role,created_by,kind FROM tasks WHERE id=? AND kind='is'", tid);
const personName = async (uid: number) => (await get<{ name: string }>("SELECT name FROM users WHERE id=? AND active=1", uid))?.name;

/** Aşamanın bağlı olduğu ilk aşamayı (işi) açan kişi. */
async function rootCreator(tid: number): Promise<number | null> {
  const r = await get<{ created_by: number | null }>(
    `WITH RECURSIVE up(id, parent_id, created_by) AS (
       SELECT id, parent_id, created_by FROM tasks WHERE id=?
       UNION ALL SELECT t.id, t.parent_id, t.created_by FROM tasks t JOIN up ON t.id=up.parent_id)
     SELECT created_by FROM up WHERE parent_id IS NULL LIMIT 1`, tid);
  return r?.created_by ?? null;
}

/** "ben" / "havuz" / kişi id → atanacak kişi (yoksa null = sahipsiz). Geçersizse hata metni döner. */
async function resolveAssignee(u: User, who: string, allowOthers: boolean): Promise<{ id: number | null } | string> {
  if (who === "havuz") return { id: null };
  if (who === "ben" || Number(who) === u.id) return { id: u.id };
  const target = Number(who);
  if (!allowOthers) return "Başkasına iş atama yetkin yok; kendine yaz ya da sahipsiz bırak.";
  if (!target || !(await personName(target))) return "Kişi bulunamadı.";
  return { id: target };
}

/** Yeni iş notu: kendine, sahipsiz havuza ya da (yetkiliyse) başkasına. */
export async function todoAdd(f: FormData) {
  const u = await requireUser();
  const title = str(f.get("title"));
  if (!title) return fail("Yapılacak işi yaz.");
  const who = str(f.get("assignee")) ?? "ben", due = str(f.get("due"));
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return fail("Son tarih geçersiz.");
  let assignee: number | null = u.id;
  if (who === "havuz") assignee = null;
  else if (who !== "ben") {
    const target = Number(who);
    if (target !== u.id && !can.assignTasks(u)) return fail("Başkasına iş atama yetkin yok; kendine yaz ya da sahipsiz bırak.");
    if (!await personName(target)) return fail("Kişi bulunamadı.");
    assignee = target;
  }
  const tid = await run("INSERT INTO tasks(date,title,detail,kind,assignee_id,due,created_by,created_at) VALUES(?,?,?,'is',?,?,?,?)",
    todayStr(), title, str(f.get("detail")), assignee, due, u.id, now());
  const who2 = assignee && assignee !== u.id ? await personName(assignee) : null;
  await audit(u.id, "Yapılacak iş ekledi", "task", tid, `${title}${who2 ? ` → ${who2}` : ""}`);
  return ok(assignee === u.id ? "Listene eklendi." : assignee ? `${who2} kişisine atandı.` : "Sahipsiz işlere eklendi.");
}

/**
 * İşin şu anki aşamasını bitirir: isteğe bağlı not; `next_title` doluysa yeni aşama açılır (iş devam eder),
 * boşsa iş tamamlanır. Yeni aşama herkes tarafından herhangi birine aktarılabilir.
 */
export async function todoFinish(f: FormData) {
  const u = await requireUser();
  const t = await getTodo(id(f));
  if (!t) return fail("İş bulunamadı.");
  const mine = t.assignee_id === u.id, boss = can.assignTasks(u);
  if (t.status !== "atandi" || !(mine || boss || !t.assignee_id)) return fail("Bu işi bitiremezsin.");
  const note = str(f.get("note")), next = str(f.get("next_title")), due = str(f.get("next_due"));
  if (f.get("mode") === "devam" && !next) return fail("Devam aşamasında ne yapılacağını yaz.");
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return fail("Devam aşamasının son tarihi geçersiz.");
  let nextWho: { id: number | null } | null = null;
  if (next) {
    const r = await resolveAssignee(u, str(f.get("next_assignee")) ?? "ben", true);
    if (typeof r === "string") return fail(r);
    nextWho = r;
  }
  const nextName = nextWho?.id && nextWho.id !== u.id ? await personName(nextWho.id) : null;
  await tx(async () => {
    await run("UPDATE tasks SET status='tamamlandi', note=COALESCE(?,note), assignee_id=COALESCE(assignee_id,?), done_by=?, done_at=? WHERE id=?",
      note, u.id, u.id, now(), t.id);
    await audit(u.id, next ? "Aşamayı bitirdi" : "İşi tamamladı", "task", t.id, note ? `${t.title} — ${note}` : t.title);
    if (next && nextWho) {
      const nid = await run("INSERT INTO tasks(date,title,detail,kind,assignee_id,due,parent_id,created_by,created_at) VALUES(?,?,?,'is',?,?,?,?,?)",
        todayStr(), next, str(f.get("next_detail")), nextWho.id, due, t.id, u.id, now());
      await audit(u.id, "Devam aşaması ekledi", "task", nid, `${t.title} → ${next}${nextName ? ` (${nextName})` : ""}`);
    }
  });
  if (!next) return ok(note ? "İş tamamlandı, not kaydedildi." : "İş tamamlandı.");
  return ok(nextWho?.id === u.id ? `Yeni aşama: "${next}" — sende.` : nextWho?.id ? `Yeni aşama: "${next}" — ${nextName} kişisine aktarıldı.` : `Yeni aşama: "${next}" — sahipsiz, isteyen üstlenir.`);
}

export async function todoAct(f: FormData) {
  const u = await requireUser();
  const t = await getTodo(id(f)), op = str(f.get("op"));
  if (!t) return fail("İş bulunamadı.");
  const mine = t.assignee_id === u.id, boss = can.assignTasks(u);
  if (op === "ustlen") {
    if (t.status !== "atandi" || (t.assignee_id && !mine && !boss)) return fail("Bu iş başkasına atanmış.");
    await run("UPDATE tasks SET assignee_id=?, assignee_role=NULL WHERE id=?", u.id, t.id);
    await audit(u.id, "İşi üstlendi", "task", t.id, t.title);
    return ok("İş artık senin listende.");
  }
  if (op === "tamamla") {
    if (t.status !== "atandi" || !(mine || boss || !t.assignee_id)) return fail("Bu işi tamamlayamazsın.");
    await run("UPDATE tasks SET status='tamamlandi', assignee_id=COALESCE(assignee_id,?), done_by=?, done_at=? WHERE id=?", u.id, u.id, now(), t.id);
    await audit(u.id, "İşi tamamladı", "task", t.id, t.title);
    return ok("Tamamlandı.");
  }
  if (op === "gerial") {
    if (t.status !== "tamamlandi" || !(mine || boss)) return fail("Bu iş geri alınamaz.");
    await run("UPDATE tasks SET status='atandi', done_by=NULL, done_at=NULL WHERE id=?", t.id);
    await audit(u.id, "İşi yeniden açtı", "task", t.id, t.title);
    return ok("İş yeniden açıldı.");
  }
  if (op === "ata") {
    const who = str(f.get("assignee")) ?? "", target = who === "havuz" ? null : Number(who);
    if (!(boss || mine || t.created_by === u.id)) return fail("Bu işi atama yetkin yok.");
    // Üzerindeki işi herkes başkasına devredebilir; başkasının işini yalnızca yönetenler taşır.
    if (target && target !== u.id && !(boss || mine)) return fail("Bu işi başkasına aktaramazsın; sahipsiz bırakabilirsin.");
    if (target && !await personName(target)) return fail("Kişi bulunamadı.");
    await run("UPDATE tasks SET assignee_id=?, assignee_role=NULL WHERE id=?", target, t.id);
    const tn = target ? await personName(target) : null;
    await audit(u.id, "İşi atadı", "task", t.id, `${t.title} → ${tn ?? "sahipsiz"}`);
    return ok(tn ? `${tn} kişisine atandı.` : "İş sahipsiz işlere bırakıldı.");
  }
  if (op === "sil") {
    if (!(boss || t.created_by === u.id || (await rootCreator(t.id)) === u.id)) return fail("Yalnızca işi açan kişi ya da yönetici iptal edebilir.");
    await run("UPDATE tasks SET status='iptal', done_by=?, done_at=? WHERE id=?", u.id, now(), t.id);
    await audit(u.id, "İşi iptal etti", "task", t.id, t.title);
    return ok("İş iptal edildi.");
  }
  return fail("Geçersiz işlem.");
}

/* ---------- Kontrol listesi yönetimi ---------- */

const DAYS = "1234567";
const pickDays = (f: FormData) => DAYS.split("").filter((d) => f.get(`d${d}`)).join("");

export async function checkItemSave(f: FormData) {
  const u = await requireUser();
  if (!can.manage(u)) return fail("Kontrol listesini yönetici düzenler.");
  const text = str(f.get("text")), kind = str(f.get("kind")) ?? "", areaId = id(f, "area_id"), days = pickDays(f);
  const stockId = id(f, "stock_item_id") || null;
  const who = id(f, "assignee_id") || null;
  if (who && !await get("SELECT 1 FROM users WHERE id=? AND active=1", who)) return fail("Kişi bulunamadı.");
  if (!text || !["acilis", "gunici", "kapanis"].includes(kind) || !areaId) return fail("Madde, liste ve alan zorunlu.");
  if (!days) return fail("En az bir gün seçin.");
  const cid = id(f);
  if (cid) {
    await run("UPDATE checklist_items SET text=?, kind=?, area_id=?, days=?, stock_item_id=?, assignee_id=? WHERE id=?", text, kind, areaId, days, stockId, who, cid);
    // Bugünün henüz yapılmamış görevini de güncelle; bugün listede değilse kaldır.
    const wd = String(((new Date(todayStr() + "T00:00:00Z").getUTCDay() + 6) % 7) + 1);
    if (days.includes(wd)) await run("UPDATE tasks SET title=?, kind=?, area_id=?, assignee_id=? WHERE checklist_item_id=? AND date=? AND status='atandi'", text, kind, areaId, who, cid, todayStr());
    else await run("DELETE FROM tasks WHERE checklist_item_id=? AND date=? AND status='atandi'", cid, todayStr());
    await audit(u.id, "Kontrol listesi maddesini güncelledi", "checklist_item", cid, text);
    return ok("Madde güncellendi.");
  }
  const pos = (await get<{ p: number }>("SELECT COALESCE(MAX(position),0)+1 AS p FROM checklist_items WHERE kind=? AND area_id=?", kind, areaId))!.p;
  const nid = await run("INSERT INTO checklist_items(kind,area_id,text,position,days,stock_item_id,assignee_id) VALUES(?,?,?,?,?,?,?)", kind, areaId, text, pos, days, stockId, who);
  await audit(u.id, "Kontrol listesine madde ekledi", "checklist_item", nid, text);
  return ok("Madde eklendi; seçili günlerde personelin listesinde görünür.");
}

export async function checkItemRemove(f: FormData) {
  const u = await requireUser();
  if (!can.manage(u)) return fail("Kontrol listesini yönetici düzenler.");
  const c = await get<{ id: number; text: string }>("SELECT id,text FROM checklist_items WHERE id=?", id(f));
  if (!c) return fail("Madde bulunamadı.");
  await tx(async () => {
    await run("UPDATE checklist_items SET active=0 WHERE id=?", c.id);
    await run("DELETE FROM tasks WHERE checklist_item_id=? AND status='atandi' AND date>=?", c.id, todayStr());
  });
  await audit(u.id, "Kontrol listesi maddesini kaldırdı", "checklist_item", c.id, c.text);
  return ok("Madde listeden kaldırıldı; geçmiş kayıtları durur.");
}

/** Stok sayımı içeren kontrol maddesi: sayımı kaydeder ve görevi tamamlar. */
export async function taskCount(f: FormData) {
  const u = await requireUser();
  const t = await get<{ id: number; title: string; status: string; stock_item_id: number | null }>(
    "SELECT t.id, t.title, t.status, c.stock_item_id FROM tasks t JOIN checklist_items c ON c.id=t.checklist_item_id WHERE t.id=?", id(f));
  const counted = parseNum(f.get("counted"));
  if (!t || t.status !== "atandi" || !t.stock_item_id) return fail("Sayım görevi bulunamadı.");
  const it = await getItem(t.stock_item_id);
  if (!it) return fail("Stok kalemi bulunamadı.");
  if (counted == null || counted < 0) return fail("Sayılan miktarı girin.");
  const diff = counted - it.qty;
  await tx(async () => {
    const cid = await run("INSERT INTO stock_counts(item_id,previous,counted,note,status,counted_by,counted_at) VALUES(?,?,?,?,'islendi',?,?)",
      it.id, it.qty, counted, "Kontrol listesi sayımı", u.id, now());
    if (diff !== 0) await stockMove(it.id, diff, "sayim", `count:${cid}`, "Kontrol listesi sayımı", u.id);
    await run("UPDATE tasks SET status='tamamlandi', note=?, done_by=?, done_at=? WHERE id=?", `Sayım: ${counted} ${it.unit}`, u.id, now(), t.id);
    await audit(u.id, "Kontrol listesinden stok saydı", "stock_item", it.id, `${it.name}: ${it.qty} → ${counted} ${it.unit}`);
    await ensureStockRequests(u.id);
  });
  return ok("Sayım kaydedildi.");
}

/* ---------- Sipariş ve teslimat ---------- */

/** Sipariş verildi: yönetici verdiği miktarı yazar. */
export async function orderPlace(f: FormData) {
  const u = await requireUser();
  if (!can.orderPurchase(u)) return fail("Sipariş verme yetkiniz yok.");
  const p = await get<{ id: number; status: string; item: string; unit: string }>(
    "SELECT p.id, p.status, i.name AS item, i.unit FROM purchases p JOIN stock_items i ON i.id=p.item_id WHERE p.id=?", id(f));
  const qty = parseNum(f.get("qty"));
  if (!p || !["talep", "onay_bekliyor", "onaylandi"].includes(p.status)) return fail("Sipariş bekleyen kayıt bulunamadı.");
  if (qty == null || qty <= 0) return fail("Sipariş verdiğin miktarı yaz.");
  await run("UPDATE purchases SET status='siparis', qty_order=?, ordered_by=?, ordered_at=? WHERE id=?", qty, u.id, now(), p.id);
  await audit(u.id, "Sipariş verdi", "purchase", p.id, `${p.item}: ${qty} ${p.unit}`);
  return ok(`${p.item}: ${qty} ${p.unit} sipariş verildi olarak kaydedildi.`);
}

/** Teslimat: gelen miktar yazılır ve stoğa eklenir. */
export async function orderReceive(f: FormData) {
  const u = await requireUser();
  if (!can.receivePurchase(u)) return fail("Teslim alma yetkiniz yok.");
  const p = await get<{ id: number; status: string; item_id: number; qty_order: number | null; item: string; unit: string }>(
    "SELECT p.id, p.status, p.item_id, p.qty_order, i.name AS item, i.unit FROM purchases p JOIN stock_items i ON i.id=p.item_id WHERE p.id=?", id(f));
  const qty = parseNum(f.get("qty"));
  if (!p || !["siparis", "eksik_teslim"].includes(p.status)) return fail("Teslimat bekleyen sipariş bulunamadı.");
  if (qty == null || qty < 0) return fail("Gelen miktarı yaz.");
  await tx(async () => {
    await run("UPDATE purchases SET status='teslim_alindi', qty_received=COALESCE(qty_received,0)+?, received_by=?, received_at=? WHERE id=?", qty, u.id, now(), p.id);
    if (qty > 0) await stockMove(p.item_id, qty, "teslim", `purchase:${p.id}`, null, u.id);
    await audit(u.id, "Teslim aldı", "purchase", p.id, `${p.item}: sipariş ${p.qty_order ?? "?"}, gelen ${qty} ${p.unit}`);
    await ensureStockRequests(u.id);
  });
  return ok(`${p.item}: ${qty} ${p.unit} stoğa eklendi.`);
}

export async function orderCancel(f: FormData) {
  const u = await requireUser();
  if (!can.orderPurchase(u)) return fail("Yetkiniz yok.");
  const p = await get<{ id: number; status: string; item: string }>("SELECT p.id, p.status, i.name AS item FROM purchases p JOIN stock_items i ON i.id=p.item_id WHERE p.id=?", id(f));
  if (!p || !["siparis", "eksik_teslim"].includes(p.status)) return fail("İptal edilecek sipariş bulunamadı.");
  await run("UPDATE purchases SET status='reddedildi', decision_note='Sipariş iptal edildi', decided_by=?, decided_at=? WHERE id=?", u.id, now(), p.id);
  await audit(u.id, "Siparişi iptal etti", "purchase", p.id, p.item);
  return ok(`${p.item} siparişi iptal edildi.`);
}

/* ---------- Stok ---------- */

type Item = { id: number; name: string; unit: string; qty: number };
const getItem = async (iid: number) => await get<Item>("SELECT id,name,unit,qty FROM stock_items WHERE id=? AND active=1", iid);

export async function itemSave(f: FormData) {
  const u = await requireUser();
  if (!can.editStock(u)) return fail("Stok kartı düzenleme yetkiniz yok.");
  const name = str(f.get("name")), unit = str(f.get("unit")) ?? "", location = str(f.get("location")) ?? "";
  const min = parseNum(f.get("min_level")) ?? 0, crit = parseNum(f.get("critical_level")) ?? 0;
  if (!name || !UNITS.includes(unit) || !LOCATIONS.includes(location)) return fail("Ad, birim ve konum zorunlu.");
  if (min < 0) return fail("Minimum seviye negatif olamaz.");
  const sup = id(f, "supplier_id") || null;
  const iid = id(f);
  if (iid) {
    await run("UPDATE stock_items SET name=?,category=?,unit=?,location=?,min_level=?,critical_level=?,supplier_id=? WHERE id=?",
      name, str(f.get("category")), unit, location, min, crit, sup, iid);
    await audit(u.id, "Stok kartını güncelledi", "stock_item", iid, name);
    return ok("Stok kartı güncellendi.");
  }
  const qty = parseNum(f.get("qty")) ?? 0;
  if (qty < 0) return fail("Miktar negatif olamaz.");
  await tx(async () => {
    const nid = await run("INSERT INTO stock_items(name,category,unit,location,qty,min_level,critical_level,supplier_id) VALUES(?,?,?,?,0,?,?,?)",
      name, str(f.get("category")), unit, location, min, crit, sup);
    if (qty) await stockMove(nid, qty, "acilis", null, "Açılış miktarı", u.id);
    await audit(u.id, "Stok kartı açtı", "stock_item", nid, name);
  });
  return ok("Stok kartı açıldı.");
}

export async function stockCount(f: FormData) {
  const u = await requireUser();
  const it = await getItem(id(f, "item_id"));
  const counted = parseNum(f.get("counted"));
  if (!it) return fail("Stok kalemi bulunamadı.");
  if (counted == null || counted < 0) return fail("Sayılan miktarı girin.");
  const diff = counted - it.qty;
  await tx(async () => {
    const cid = await run("INSERT INTO stock_counts(item_id,previous,counted,status,counted_by,counted_at) VALUES(?,?,?,'islendi',?,?)", it.id, it.qty, counted, u.id, now());
    if (diff !== 0) await stockMove(it.id, diff, "sayim", `count:${cid}`, null, u.id);
    await audit(u.id, "Stok saydı", "stock_item", it.id, `${it.name}: ${it.qty} → ${counted} ${it.unit}`);
    await ensureStockRequests(u.id);
  });
  return ok(`${it.name}: ${counted} ${it.unit} olarak kaydedildi.`);
}

/* ---------- Ayarlar ---------- */

export async function userCreate(f: FormData) {
  const u = await requireUser();
  if (!can.manage(u)) return fail("Yetkiniz yok.");
  const name = str(f.get("name")), username = (str(f.get("username")) ?? "").toLowerCase(), role = str(f.get("role")) ?? "";
  const pw = typeof f.get("password") === "string" ? (f.get("password") as string) : "";
  if (!name || !/^[a-z0-9._-]{3,30}$/.test(username) || !(role in ROLE_LABEL)) return fail("Ad, kullanıcı adı (küçük harf/rakam) ve rol zorunlu.");
  if (role === "sahip" && u.role !== "sahip") return fail("İşletme sahibi rolünü yalnızca işletme sahibi verebilir.");
  if (pw.length < 8) return fail("Parola en az 8 karakter olmalı.");
  if (await get("SELECT 1 FROM users WHERE username=?", username)) return fail("Bu kullanıcı adı kullanılıyor.");
  const nid = await run("INSERT INTO users(name,username,password_hash,role,title) VALUES(?,?,?,?,?)", name, username, hashPassword(pw), role, str(f.get("title")));
  await audit(u.id, "Kullanıcı ekledi", "user", nid, `${name} (${ROLE_LABEL[role as Role]})`);
  return ok("Kullanıcı eklendi.");
}

export async function userUpdate(f: FormData) {
  const u = await requireUser();
  if (!can.manage(u)) return fail("Yetkiniz yok.");
  const t = await get<{ id: number; name: string; role: Role; active: number }>("SELECT id,name,role,active FROM users WHERE id=?", id(f));
  if (!t) return fail("Kullanıcı bulunamadı.");
  if (t.role === "sahip" && u.role !== "sahip") return fail("İşletme sahibini yalnızca işletme sahibi düzenleyebilir.");
  const op = f.get("op");
  if (op === "durum") {
    if (t.id === u.id) return fail("Kendi hesabınızı kapatamazsınız.");
    await run("UPDATE users SET active=? WHERE id=?", t.active ? 0 : 1, t.id);
    if (t.active) await run("DELETE FROM sessions WHERE user_id=?", t.id);
    await audit(u.id, t.active ? "Kullanıcıyı pasifleştirdi" : "Kullanıcıyı etkinleştirdi", "user", t.id, t.name);
    return ok(t.active ? `${t.name} çıkarıldı; artık giriş yapamaz.` : `${t.name} yeniden eklendi.`);
  }
  if (op === "bilgi") {
    const name = str(f.get("name"));
    if (!name) return fail("Ad boş olamaz.");
    await run("UPDATE users SET name=?, title=? WHERE id=?", name, str(f.get("title")), t.id);
    await audit(u.id, "Kişi bilgisini güncelledi", "user", t.id, name);
    return ok("Kişi bilgisi güncellendi.");
  }
  if (op === "rol") {
    const role = str(f.get("role")) ?? "";
    if (!(role in ROLE_LABEL)) return fail("Rol seçin.");
    if ((role === "sahip" || t.role === "sahip") && u.role !== "sahip") return fail("Bu rol değişikliğini yalnızca işletme sahibi yapabilir.");
    if (t.id === u.id) return fail("Kendi rolünüzü değiştiremezsiniz.");
    await run("UPDATE users SET role=? WHERE id=?", role, t.id);
    await audit(u.id, "Rol değiştirdi", "user", t.id, `${t.name}: ${ROLE_LABEL[t.role]} → ${ROLE_LABEL[role as Role]}`);
    return ok("Rol güncellendi.");
  }
  return fail("Geçersiz işlem.");
}

export async function passwordChange(f: FormData) {
  const u = await requireUser();
  const targetId = id(f) || u.id;
  const pw = typeof f.get("password") === "string" ? (f.get("password") as string) : "";
  if (pw.length < 8) return fail("Parola en az 8 karakter olmalı.");
  if (targetId !== u.id) {
    if (!can.manage(u)) return fail("Yetkiniz yok.");
    const t = await get<{ role: Role }>("SELECT role FROM users WHERE id=?", targetId);
    if (!t || (t.role === "sahip" && u.role !== "sahip")) return fail("Bu kullanıcının parolasını değiştiremezsiniz.");
  } else {
    const cur = (await get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=?", u.id))!;
    if (!verifyPassword(typeof f.get("current") === "string" ? (f.get("current") as string) : "", cur.password_hash))
      return fail("Mevcut parola hatalı.");
  }
  await run("UPDATE users SET password_hash=? WHERE id=?", hashPassword(pw), targetId);
  if (targetId !== u.id) await run("DELETE FROM sessions WHERE user_id=?", targetId);
  await audit(u.id, "Parola değiştirdi", "user", targetId);
  return ok("Parola güncellendi.");
}
