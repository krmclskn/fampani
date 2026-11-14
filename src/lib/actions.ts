"use server";

import { redirect } from "next/navigation";
import { audit, stockMove, get, hashPassword, run, setting, todayStr, tx, verifyPassword } from "./db";
import { can, createSession, destroySession, requireUser, ROLE_LABEL, type Role, type User } from "./auth";
import { fail, ok } from "./flash";
import { COUNT_REASONS, EXCEPTION_REASONS, EXCEPTION_ROUTE, LOCATIONS, UNITS, parseKurus, parseNum, str } from "./util";

const now = () => new Date().toISOString();
const id = (f: FormData, k = "id") => Number(f.get(k)) || 0;

/* ---------- Giriş ---------- */

const attempts = new Map<string, { n: number; until: number }>();

export async function login(f: FormData) {
  const username = (str(f.get("username")) ?? "").toLowerCase();
  const password = typeof f.get("password") === "string" ? (f.get("password") as string) : "";
  const a = attempts.get(username);
  if (a && a.until > Date.now()) redirect("/giris?hata=" + encodeURIComponent("Çok fazla deneme. Birkaç dakika sonra tekrar deneyin."));
  const u = get<{ id: number; password_hash: string }>("SELECT id,password_hash FROM users WHERE username=? AND active=1", username);
  if (!u || !verifyPassword(password, u.password_hash)) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(username, { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 5 * 60000 : 0 });
    redirect("/giris?hata=" + encodeURIComponent("Kullanıcı adı veya parola hatalı."));
  }
  attempts.delete(username);
  await createSession(u.id);
  audit(u.id, "Giriş yaptı");
  redirect(["sahip", "operasyon"].includes(get<{ role: string }>("SELECT role FROM users WHERE id=?", u.id)?.role ?? "") ? "/finans" : "/");
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
const getTask = (tid: number) => get<Task>("SELECT * FROM tasks WHERE id=?", tid);
const mayWork = (u: User, t: Task) =>
  t.kind !== "is" || t.assignee_id === u.id || t.assignee_role === u.role || can.assignTasks(u);

export async function taskDone(f: FormData) {
  const u = await requireUser();
  const t = getTask(id(f));
  if (!t || !["atandi", "engellendi"].includes(t.status)) return fail("Görev bulunamadı veya zaten kapatılmış.");
  if (!mayWork(u, t)) return fail("Bu görev size atanmamış.");
  const status = t.needs_review && !can.reviewTasks(u) ? "kontrol" : "tamamlandi";
  run("UPDATE tasks SET status=?, note=COALESCE(?,note), exception_reason=NULL, done_by=?, done_at=? WHERE id=?",
    status, str(f.get("note")), u.id, now(), t.id);
  audit(u.id, status === "kontrol" ? "Görevi kontrole gönderdi" : "Görevi tamamladı", "task", t.id, t.title);
  return ok(status === "kontrol" ? "Kontrole gönderildi." : "Tamamlandı.");
}

export async function taskBlock(f: FormData) {
  const u = await requireUser();
  const t = getTask(id(f));
  const reason = str(f.get("reason")) ?? "";
  if (!t || t.status !== "atandi") return fail("Görev bulunamadı veya zaten kapatılmış.");
  if (!mayWork(u, t)) return fail("Bu görev size atanmamış.");
  if (!(EXCEPTION_REASONS as readonly string[]).includes(reason)) return fail("Bir istisna nedeni seçin.");
  const note = str(f.get("note"));
  tx(() => {
    run("UPDATE tasks SET status='engellendi', exception_reason=?, note=?, done_by=?, done_at=? WHERE id=?",
      reason, note, u.id, now(), t.id);
    run(
      `INSERT INTO tasks(date,title,detail,kind,area_id,assignee_role,priority,source,created_by,created_at)
       VALUES(?,?,?,'is',?,?,'yuksek',?,?,?)`,
      todayStr(), `${reason}: ${t.title}`, note, t.area_id, EXCEPTION_ROUTE[reason], `task:${t.id}`, u.id, now(),
    );
    audit(u.id, "Görevi istisnayla kapattı", "task", t.id, `${reason} — ${t.title}`);
  });
  return ok("İstisna kaydedildi, ilgili sorumluya görev açıldı.");
}

export async function taskReview(f: FormData) {
  const u = await requireUser();
  const t = getTask(id(f));
  if (!t || t.status !== "kontrol") return fail("Kontrol bekleyen görev bulunamadı.");
  if (!can.reviewTasks(u)) return fail("Kontrol yetkiniz yok.");
  if (t.done_by === u.id) return fail("Kendi tamamladığınız işi siz onaylayamazsınız.");
  const approve = f.get("karar") === "onay";
  run("UPDATE tasks SET status=?, reviewed_by=? WHERE id=?", approve ? "tamamlandi" : "atandi", u.id, t.id);
  audit(u.id, approve ? "Görevi onayladı" : "Görevi geri gönderdi", "task", t.id, t.title);
  return ok(approve ? "Onaylandı." : "Geri gönderildi.");
}

export async function taskReopen(f: FormData) {
  const u = await requireUser();
  const t = getTask(id(f));
  if (!t || !["tamamlandi", "engellendi", "kontrol"].includes(t.status)) return fail("Görev yeniden açılamaz.");
  if (!(can.assignTasks(u) || t.done_by === u.id)) return fail("Yetkiniz yok.");
  run("UPDATE tasks SET status='atandi', exception_reason=NULL, done_by=NULL, done_at=NULL, reviewed_by=NULL WHERE id=?", t.id);
  audit(u.id, "Görevi yeniden açtı", "task", t.id, t.title);
  return ok("Görev yeniden açıldı.");
}

export async function taskCancel(f: FormData) {
  const u = await requireUser();
  const t = getTask(id(f));
  const reason = str(f.get("note"));
  if (!t || t.kind !== "is" || t.status === "tamamlandi") return fail("Görev iptal edilemez.");
  if (!can.assignTasks(u)) return fail("Yetkiniz yok.");
  if (!reason) return fail("İptal nedeni yazın.");
  run("UPDATE tasks SET status='iptal', note=?, done_by=?, done_at=? WHERE id=?", reason, u.id, now(), t.id);
  audit(u.id, "Görevi iptal etti", "task", t.id, `${t.title} — ${reason}`);
  return ok("Görev iptal edildi.");
}

export async function taskCreate(f: FormData) {
  const u = await requireUser();
  const title = str(f.get("title"));
  if (!title) return fail("Görev başlığı yazın.");
  let assigneeId: number | null = null;
  let assigneeRole: string | null = "operasyon"; // çalışan bildirimi operasyon sorumlusuna düşer
  if (can.assignTasks(u)) {
    const a = str(f.get("assignee")) ?? "";
    if (a.startsWith("rol:") && a.slice(4) in ROLE_LABEL) assigneeRole = a.slice(4);
    else if (get("SELECT 1 FROM users WHERE id=? AND active=1", Number(a))) { assigneeId = Number(a); assigneeRole = null; }
    else return fail("Sorumlu seçin.");
  }
  const tid = run(
    `INSERT INTO tasks(date,title,detail,kind,area_id,assignee_id,assignee_role,priority,needs_review,created_by,created_at)
     VALUES(?,?,?,'is',?,?,?,?,?,?,?)`,
    todayStr(), title, str(f.get("detail")), id(f, "area_id") || null, assigneeId, assigneeRole,
    f.get("priority") === "yuksek" ? "yuksek" : "normal", can.assignTasks(u) && f.get("needs_review") ? 1 : 0, u.id, now(),
  );
  audit(u.id, "Görev açtı", "task", tid, title);
  return ok(can.assignTasks(u) ? "Görev açıldı." : "Bildiriminiz operasyon sorumlusuna iletildi.");
}

/* ---------- Vardiya ---------- */

export async function shiftAdd(f: FormData) {
  const u = await requireUser();
  if (!can.planShifts(u)) return fail("Vardiya planlama yetkiniz yok.");
  const date = str(f.get("date")) ?? "", start = str(f.get("start")) ?? "", end = str(f.get("end")) ?? "";
  const userId = id(f, "user_id"), areaId = id(f, "area_id");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || start >= end)
    return fail("Tarih ve saatleri kontrol edin (başlangıç bitişten önce olmalı).");
  if (!userId || !areaId) return fail("Kişi ve alan seçin.");
  if (get("SELECT 1 FROM shifts WHERE date=? AND user_id=? AND start<? AND end>?", date, userId, end, start))
    return fail("Bu kişinin aynı saatlerde başka bir vardiyası var.");
  const sid = run("INSERT INTO shifts(date,area_id,user_id,start,end,is_lead) VALUES(?,?,?,?,?,?)",
    date, areaId, userId, start, end, f.get("is_lead") ? 1 : 0);
  audit(u.id, "Vardiya ekledi", "shift", sid, `${date} ${start}–${end}`);
  return ok("Vardiya eklendi.");
}

export async function shiftDelete(f: FormData) {
  const u = await requireUser();
  if (!can.planShifts(u)) return fail("Vardiya planlama yetkiniz yok.");
  const s = get<{ date: string; start: string; end: string; name: string }>(
    "SELECT s.date,s.start,s.end,u.name FROM shifts s JOIN users u ON u.id=s.user_id WHERE s.id=?", id(f));
  if (!s) return fail("Vardiya bulunamadı.");
  run("DELETE FROM shifts WHERE id=?", id(f));
  audit(u.id, "Vardiya sildi", "shift", id(f), `${s.name} ${s.date} ${s.start}–${s.end}`);
  return ok("Vardiya silindi.");
}

/* ---------- Vardiya devri ---------- */

export async function handoverCreate(f: FormData) {
  const u = await requireUser();
  const areaId = id(f, "area_id");
  if (!areaId) return fail("Alan seçin.");
  const v = (k: string) => str(f.get(k));
  const hid = run(
    `INSERT INTO handovers(date,area_id,from_user,cash_status,stock_notes,pending_work,issues,deliveries,upcoming,note,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    todayStr(), areaId, u.id, v("cash_status"), v("stock_notes"), v("pending_work"), v("issues"), v("deliveries"),
    v("upcoming"), v("note"), now(),
  );
  audit(u.id, "Vardiya devri oluşturdu", "handover", hid);
  return ok("Devir kaydı oluşturuldu; devralan kişinin onayı bekleniyor.");
}

export async function handoverAccept(f: FormData) {
  const u = await requireUser();
  const h = get<{ id: number; from_user: number; accepted_at: string | null }>("SELECT * FROM handovers WHERE id=?", id(f));
  if (!h || h.accepted_at) return fail("Devir kaydı bulunamadı veya zaten teslim alınmış.");
  if (h.from_user === u.id) return fail("Kendi devrinizi siz teslim alamazsınız.");
  run("UPDATE handovers SET accepted_by=?, accepted_at=? WHERE id=?", u.id, now(), h.id);
  audit(u.id, "Vardiya devrini teslim aldı", "handover", h.id);
  return ok("Devir teslim alındı.");
}

/* ---------- Stok ---------- */

type Item = { id: number; name: string; unit: string; qty: number };
const getItem = (iid: number) => get<Item>("SELECT id,name,unit,qty FROM stock_items WHERE id=? AND active=1", iid);

export async function itemSave(f: FormData) {
  const u = await requireUser();
  if (!can.editStock(u)) return fail("Stok kartı düzenleme yetkiniz yok.");
  const name = str(f.get("name")), unit = str(f.get("unit")) ?? "", location = str(f.get("location")) ?? "";
  const min = parseNum(f.get("min_level")) ?? 0, crit = parseNum(f.get("critical_level")) ?? 0;
  if (!name || !UNITS.includes(unit) || !LOCATIONS.includes(location)) return fail("Ad, birim ve konum zorunlu.");
  if (min < 0 || crit < 0 || crit > min) return fail("Kritik seviye, minimum seviyeden büyük olamaz.");
  const sup = id(f, "supplier_id") || null;
  const iid = id(f);
  if (iid) {
    run("UPDATE stock_items SET name=?,category=?,unit=?,location=?,min_level=?,critical_level=?,supplier_id=? WHERE id=?",
      name, str(f.get("category")), unit, location, min, crit, sup, iid);
    audit(u.id, "Stok kartını güncelledi", "stock_item", iid, name);
    return ok("Stok kartı güncellendi.");
  }
  const qty = parseNum(f.get("qty")) ?? 0;
  if (qty < 0) return fail("Miktar negatif olamaz.");
  tx(() => {
    const nid = run("INSERT INTO stock_items(name,category,unit,location,qty,min_level,critical_level,supplier_id) VALUES(?,?,?,?,0,?,?,?)",
      name, str(f.get("category")), unit, location, min, crit, sup);
    if (qty) stockMove(nid, qty, "acilis", null, "Açılış miktarı", u.id);
    audit(u.id, "Stok kartı açtı", "stock_item", nid, name);
  });
  return ok("Stok kartı açıldı.");
}

export async function supplierSave(f: FormData) {
  const u = await requireUser();
  if (!can.reviewPurchase(u)) return fail("Tedarikçi ekleme yetkiniz yok.");
  const name = str(f.get("name"));
  if (!name) return fail("Tedarikçi adı yazın.");
  const sid = run("INSERT INTO suppliers(name,contact,delivery_days,payment_terms) VALUES(?,?,?,?)",
    name, str(f.get("contact")), str(f.get("delivery_days")), str(f.get("payment_terms")));
  audit(u.id, "Tedarikçi ekledi", "supplier", sid, name);
  return ok("Tedarikçi eklendi.");
}

export async function stockCount(f: FormData) {
  const u = await requireUser();
  const it = getItem(id(f, "item_id"));
  const counted = parseNum(f.get("counted"));
  const note = str(f.get("note"));
  if (!it) return fail("Stok kalemi bulunamadı.");
  if (counted == null || counted < 0) return fail("Sayılan miktarı girin.");
  const diff = counted - it.qty;
  const tol = Math.max((Number(setting("count_tolerance_pct")) / 100) * Math.max(it.qty, 0), Number(setting("count_abs_tolerance")) || 0);
  const reason = str(f.get("reason"));
  if (diff !== 0 && !(reason && COUNT_REASONS.includes(reason))) return fail("Fark var: fark nedenini seçin.");
  const small = Math.abs(diff) <= tol;
  const direct = diff === 0 || small || can.approveCount(u);
  tx(() => {
    const cid = run(
      "INSERT INTO stock_counts(item_id,previous,counted,note,reason,status,counted_by,counted_at,decided_by,decided_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
      it.id, it.qty, counted, note, diff !== 0 ? reason : null, direct ? "islendi" : "onay_bekliyor", u.id, now(),
      direct && !small && diff !== 0 ? u.id : null, direct && !small && diff !== 0 ? now() : null,
    );
    if (direct && diff !== 0) stockMove(it.id, diff, "sayim", `count:${cid}`, note, u.id);
    audit(u.id, "Stok saydı", "stock_item", it.id, `${it.name}: ${it.qty} → ${counted} ${it.unit}${direct ? "" : " (onay bekliyor)"}`);
  });
  return ok(direct ? "Sayım işlendi." : "Fark büyük: sayım yönetici onayına gönderildi.");
}

export async function countDecide(f: FormData) {
  const u = await requireUser();
  if (!can.approveCount(u)) return fail("Sayım onaylama yetkiniz yok.");
  const c = get<{ id: number; item_id: number; previous: number; counted: number; status: string; note: string | null; counted_by: number }>(
    "SELECT * FROM stock_counts WHERE id=?", id(f));
  if (!c || c.status !== "onay_bekliyor") return fail("Onay bekleyen sayım bulunamadı.");
  const approve = f.get("karar") === "onay";
  tx(() => {
    run("UPDATE stock_counts SET status=?, decided_by=?, decided_at=? WHERE id=?", approve ? "islendi" : "reddedildi", u.id, now(), c.id);
    // Sayımdan sonraki hareketler korunsun diye mutlak değer değil fark işlenir.
    if (approve) stockMove(c.item_id, c.counted - c.previous, "sayim", `count:${c.id}`, c.note, u.id);
    audit(u.id, approve ? "Sayım farkını onayladı" : "Sayımı reddetti (yeniden sayım)", "stock_count", c.id);
    if (!approve)
      run(`INSERT INTO tasks(date,title,kind,assignee_id,priority,source,created_by,created_at)
           SELECT ?, 'Yeniden say: ' || name, 'is', ?, 'yuksek', ?, ?, ? FROM stock_items WHERE id=?`,
        todayStr(), c.counted_by, `count:${c.id}`, u.id, now(), c.item_id);
  });
  return ok(approve ? "Sayım onaylandı ve stoğa işlendi." : "Sayım reddedildi, yeniden sayım görevi açıldı.");
}

/* ---------- Satın alma ---------- */

type Purchase = {
  id: number; item_id: number; status: string; qty_order: number | null; unit_price: number | null;
  qty_received: number | null; qty_damaged: number | null; requested_by: number; reviewed_by: number | null;
  invoice_amount: number | null; paid_at: string | null;
};
const getPurchase = (pid: number) => get<Purchase>("SELECT * FROM purchases WHERE id=?", pid);

export async function shortageReport(f: FormData) {
  const u = await requireUser();
  const it = getItem(id(f, "item_id"));
  const qty = parseNum(f.get("qty"));
  if (!it) return fail("Stok kalemi seçin.");
  if (qty == null || qty <= 0) return fail("İhtiyaç miktarını girin.");
  const open = get<{ id: number }>(
    "SELECT id FROM purchases WHERE item_id=? AND status IN ('talep','onay_bekliyor','onaylandi','siparis')", it.id);
  if (open && !f.get("force")) return fail(`${it.name} için zaten açık bir talep var (#${open.id}).`);
  const pid = run("INSERT INTO purchases(item_id,qty_requested,observed_qty,note,requested_by,requested_at) VALUES(?,?,?,?,?,?)",
    it.id, qty, parseNum(f.get("observed_qty")), str(f.get("note")), u.id, now());
  audit(u.id, "Eksik bildirdi", "purchase", pid, `${it.name}: ${qty} ${it.unit}`);
  return ok("Eksik bildirildi; stok sorumlusu değerlendirecek.");
}

export async function purchaseReview(f: FormData) {
  const u = await requireUser();
  if (!can.reviewPurchase(u)) return fail("Talep değerlendirme yetkiniz yok.");
  const p = getPurchase(id(f));
  if (!p || p.status !== "talep") return fail("Değerlendirilecek talep bulunamadı.");
  if (f.get("karar") === "red") {
    const note = str(f.get("note"));
    if (!note) return fail("Kapatma nedenini yazın.");
    run("UPDATE purchases SET status='reddedildi', reviewed_by=?, reviewed_at=?, decision_note=? WHERE id=?", u.id, now(), note, p.id);
    audit(u.id, "Talebi satın almadan kapattı", "purchase", p.id, note);
    return ok("Talep kapatıldı.");
  }
  const qty = parseNum(f.get("qty_order")), price = parseKurus(f.get("unit_price")), sup = id(f, "supplier_id");
  if (qty == null || qty <= 0 || price == null || price < 0 || !sup) return fail("Tedarikçi, miktar ve birim fiyat zorunlu.");
  run("UPDATE purchases SET status='onay_bekliyor', supplier_id=?, qty_order=?, unit_price=?, reviewed_by=?, reviewed_at=? WHERE id=?",
    sup, qty, price, u.id, now(), p.id);
  audit(u.id, "Talebi onaya gönderdi", "purchase", p.id);
  return ok("Talep onaya gönderildi.");
}

export async function purchaseDecide(f: FormData) {
  const u = await requireUser();
  const p = getPurchase(id(f));
  if (!p || p.status !== "onay_bekliyor") return fail("Onay bekleyen talep bulunamadı.");
  const total = Math.round((p.qty_order ?? 0) * (p.unit_price ?? 0));
  if (!can.approvePurchase(u, total)) return fail("Bu tutarı onaylama yetkiniz yok; işletme sahibi onaylamalı.");
  const approve = f.get("karar") === "onay";
  const note = str(f.get("note"));
  if (!approve && !note) return fail("Ret nedenini yazın.");
  run("UPDATE purchases SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=?",
    approve ? "onaylandi" : "reddedildi", u.id, now(), note, p.id);
  audit(u.id, approve ? "Satın almayı onayladı" : "Satın almayı reddetti", "purchase", p.id, note ?? undefined);
  return ok(approve ? "Onaylandı." : "Reddedildi.");
}

export async function purchaseOrder(f: FormData) {
  const u = await requireUser();
  if (!can.orderPurchase(u)) return fail("Sipariş verme yetkiniz yok.");
  const p = getPurchase(id(f));
  const expected = str(f.get("expected_date"));
  if (!p || p.status !== "onaylandi") return fail("Onaylanmış talep bulunamadı.");
  if (!expected || !/^\d{4}-\d{2}-\d{2}$/.test(expected)) return fail("Beklenen teslimat tarihini girin.");
  run("UPDATE purchases SET status='siparis', ordered_by=?, ordered_at=?, expected_date=? WHERE id=?", u.id, now(), expected, p.id);
  audit(u.id, "Siparişi verdi", "purchase", p.id, `Beklenen: ${expected}`);
  return ok("Sipariş kaydedildi.");
}

export async function purchaseReceive(f: FormData) {
  const u = await requireUser();
  if (!can.receivePurchase(u)) return fail("Teslim alma yetkiniz yok.");
  const p = getPurchase(id(f));
  if (!p || !["siparis", "eksik_teslim"].includes(p.status)) return fail("Teslim alınacak sipariş bulunamadı.");
  const got = parseNum(f.get("qty_received")), bad = parseNum(f.get("qty_damaged")) ?? 0;
  if (got == null || got < 0 || bad < 0 || bad > got) return fail("Gelen ve hasarlı miktarı kontrol edin.");
  const accepted = got - bad;
  const totalGot = (p.qty_received ?? 0) + got, totalBad = (p.qty_damaged ?? 0) + bad;
  const complete = totalGot - totalBad >= (p.qty_order ?? 0);
  const inv = parseKurus(f.get("invoice_amount"));
  tx(() => {
    run(
      `UPDATE purchases SET status=?, received_by=?, received_at=?, qty_received=?, qty_damaged=?,
       doc_no=COALESCE(?,doc_no), invoice_amount=COALESCE(?,invoice_amount), receive_note=COALESCE(?,receive_note) WHERE id=?`,
      complete ? "teslim_alindi" : "eksik_teslim", u.id, now(), totalGot, totalBad, str(f.get("doc_no")), inv, str(f.get("note")), p.id,
    );
    if (accepted > 0) stockMove(p.item_id, accepted, "teslim", `purchase:${p.id}`, null, u.id);
    if (p.unit_price != null) {
      const prev = get<{ last_price: number | null }>("SELECT last_price FROM stock_items WHERE id=?", p.item_id)?.last_price ?? null;
      if (prev !== p.unit_price)
        run("INSERT INTO item_prices(item_id,price,prev_price,purchase_id,at) VALUES(?,?,?,?,?)", p.item_id, p.unit_price, prev, p.id, now());
      run("UPDATE stock_items SET last_price=? WHERE id=?", p.unit_price, p.item_id);
    }
    audit(u.id, "Teslim aldı", "purchase", p.id, `Gelen ${got}, hasarlı ${bad}, kabul ${accepted}`);
  });
  return ok(complete ? "Teslim alındı, stoğa işlendi." : "Eksik teslim kaydedildi; kabul edilen miktar stoğa işlendi.");
}

export async function purchasePaid(f: FormData) {
  const u = await requireUser();
  if (!can.markPaid(u)) return fail("Ödeme kaydı yetkisi işletme sahibindedir.");
  const p = getPurchase(id(f));
  if (!p || !["teslim_alindi", "eksik_teslim"].includes(p.status) || p.paid_at) return fail("Ödenecek kayıt bulunamadı.");
  if (p.invoice_amount == null) return fail("Önce fatura tutarı girilmeli.");
  run("UPDATE purchases SET paid_by=?, paid_at=? WHERE id=?", u.id, now(), p.id);
  audit(u.id, "Ödendi olarak işaretledi", "purchase", p.id);
  return ok("Ödeme kaydedildi.");
}

/* ---------- Kapanış ---------- */

export async function dayClose(f: FormData) {
  const u = await requireUser();
  if (!can.closeDay(u)) return fail("Kapanış kaydını vardiya sorumlusu verebilir.");
  const date = todayStr();
  if (get("SELECT 1 FROM day_closings WHERE date=?", date)) return fail("Bugün zaten kapatılmış.");
  const open = get<{ c: number }>("SELECT COUNT(*) AS c FROM tasks WHERE date=? AND kind='kapanis' AND status='atandi'", date)!.c;
  if (open > 0) return fail(`Kapanış listesinde ${open} açık madde var. Tamamlayın veya istisna nedeniyle kapatın.`);
  const cash = parseKurus(f.get("cash_total")), pos = parseKurus(f.get("pos_total"));
  if (cash == null || pos == null || cash < 0 || pos < 0) return fail("Nakit ve POS kapanış tutarlarını girin.");
  run("INSERT INTO day_closings(date,closed_by,closed_at,cash_total,pos_total,cash_diff_note,note) VALUES(?,?,?,?,?,?,?)",
    date, u.id, now(), cash, pos, str(f.get("cash_diff_note")), str(f.get("note")));
  audit(u.id, "İşletme kapandı kaydını verdi", "day", undefined, date);
  return ok("İşletme kapandı. Açık işler yarına devredildi.");
}

/* ---------- Ayarlar ---------- */

export async function settingsSave(f: FormData) {
  const u = await requireUser();
  if (!can.manage(u)) return fail("Yetkiniz yok.");
  const limit = parseKurus(f.get("purchase_limit")), tol = parseNum(f.get("count_tolerance_pct"));
  const abs = parseNum(f.get("count_abs_tolerance")), pa = parseNum(f.get("price_alert_pct"));
  if (abs == null || abs < 0 || pa == null || pa < 0) return fail("Değerleri kontrol edin.");
  const open = str(f.get("open_time")) ?? "", close = str(f.get("close_time")) ?? "";
  if (limit == null || limit < 0 || tol == null || tol < 0 || tol > 100 || !/^\d{2}:\d{2}$/.test(open) || !/^\d{2}:\d{2}$/.test(close) || open >= close)
    return fail("Değerleri kontrol edin.");
  if (u.role !== "sahip" && limit !== Number(setting("purchase_limit"))) return fail("Onay limitini yalnızca işletme sahibi değiştirebilir.");
  const set = (k: string, v: string) => run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, v);
  set("purchase_limit", String(limit)); set("count_tolerance_pct", String(tol)); set("count_abs_tolerance", String(abs)); set("price_alert_pct", String(pa)); set("open_time", open); set("close_time", close);
  audit(u.id, "İşletme ayarlarını güncelledi");
  return ok("Ayarlar kaydedildi.");
}

export async function userCreate(f: FormData) {
  const u = await requireUser();
  if (!can.manage(u)) return fail("Yetkiniz yok.");
  const name = str(f.get("name")), username = (str(f.get("username")) ?? "").toLowerCase(), role = str(f.get("role")) ?? "";
  const pw = typeof f.get("password") === "string" ? (f.get("password") as string) : "";
  if (!name || !/^[a-z0-9._-]{3,30}$/.test(username) || !(role in ROLE_LABEL)) return fail("Ad, kullanıcı adı (küçük harf/rakam) ve rol zorunlu.");
  if (role === "sahip" && u.role !== "sahip") return fail("İşletme sahibi rolünü yalnızca işletme sahibi verebilir.");
  if (pw.length < 8) return fail("Parola en az 8 karakter olmalı.");
  if (get("SELECT 1 FROM users WHERE username=?", username)) return fail("Bu kullanıcı adı kullanılıyor.");
  const nid = run("INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,?)", name, username, hashPassword(pw), role);
  audit(u.id, "Kullanıcı ekledi", "user", nid, `${name} (${ROLE_LABEL[role as Role]})`);
  return ok("Kullanıcı eklendi.");
}

export async function userUpdate(f: FormData) {
  const u = await requireUser();
  if (!can.manage(u)) return fail("Yetkiniz yok.");
  const t = get<{ id: number; name: string; role: Role; active: number }>("SELECT id,name,role,active FROM users WHERE id=?", id(f));
  if (!t) return fail("Kullanıcı bulunamadı.");
  if (t.role === "sahip" && u.role !== "sahip") return fail("İşletme sahibini yalnızca işletme sahibi düzenleyebilir.");
  const op = f.get("op");
  if (op === "durum") {
    if (t.id === u.id) return fail("Kendi hesabınızı kapatamazsınız.");
    run("UPDATE users SET active=? WHERE id=?", t.active ? 0 : 1, t.id);
    if (t.active) run("DELETE FROM sessions WHERE user_id=?", t.id);
    audit(u.id, t.active ? "Kullanıcıyı pasifleştirdi" : "Kullanıcıyı etkinleştirdi", "user", t.id, t.name);
    return ok("Kullanıcı durumu güncellendi.");
  }
  if (op === "rol") {
    const role = str(f.get("role")) ?? "";
    if (!(role in ROLE_LABEL)) return fail("Rol seçin.");
    if ((role === "sahip" || t.role === "sahip") && u.role !== "sahip") return fail("Bu rol değişikliğini yalnızca işletme sahibi yapabilir.");
    if (t.id === u.id) return fail("Kendi rolünüzü değiştiremezsiniz.");
    run("UPDATE users SET role=? WHERE id=?", role, t.id);
    audit(u.id, "Rol değiştirdi", "user", t.id, `${t.name}: ${ROLE_LABEL[t.role]} → ${ROLE_LABEL[role as Role]}`);
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
    const t = get<{ role: Role }>("SELECT role FROM users WHERE id=?", targetId);
    if (!t || (t.role === "sahip" && u.role !== "sahip")) return fail("Bu kullanıcının parolasını değiştiremezsiniz.");
  } else {
    const cur = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=?", u.id)!;
    if (!verifyPassword(typeof f.get("current") === "string" ? (f.get("current") as string) : "", cur.password_hash))
      return fail("Mevcut parola hatalı.");
  }
  run("UPDATE users SET password_hash=? WHERE id=?", hashPassword(pw), targetId);
  if (targetId !== u.id) run("DELETE FROM sessions WHERE user_id=?", targetId);
  audit(u.id, "Parola değiştirdi", "user", targetId);
  return ok("Parola güncellendi.");
}
