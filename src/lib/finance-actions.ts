"use server";

import { all, audit, get, run, stockMove, todayStr, tx } from "./db";
import { can, requireUser } from "./auth";
import { fail, ok } from "./flash";
import { WASTE_KINDS, WASTE_REASONS, fmtTL, parseKurus, parseNum, str } from "./util";

const now = () => new Date().toISOString();
const id = (f: FormData, k = "id") => Number(f.get(k)) || 0;
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

const recipeCost = (pid: number) =>
  get<{ c: number }>(
    `SELECT p.packaging_cost + COALESCE((SELECT SUM(r.qty*COALESCE(i.last_price,0)) FROM recipe_items r
       JOIN stock_items i ON i.id=r.item_id WHERE r.product_id=p.id),0) AS c FROM products p WHERE p.id=?`, pid)?.c ?? 0;

/** Satılan adede göre reçetedeki malzemeleri stoktan düşer (negatif adet iade eder). */
function consume(productId: number, qty: number, ref: string, userId: number) {
  for (const r of all<{ item_id: number; qty: number }>("SELECT item_id, qty FROM recipe_items WHERE product_id=?", productId))
    stockMove(r.item_id, -r.qty * qty, "satis", ref, null, userId);
}

/* ---------- Ürün ve reçete ---------- */

export async function productSave(f: FormData) {
  const u = await requireUser();
  if (!can.editProducts(u)) return fail("Ürün düzenleme yetkiniz yok.");
  const name = str(f.get("name")), price = parseKurus(f.get("price")), tax = parseNum(f.get("tax_rate")) ?? 0;
  const pack = parseKurus(f.get("packaging_cost")) ?? 0;
  if (!name || price == null || price < 0 || tax < 0 || tax > 100 || pack < 0) return fail("Ad, satış fiyatı ve vergi oranını kontrol edin.");
  const pid = id(f);
  if (pid) {
    const old = get<{ price: number }>("SELECT price FROM products WHERE id=?", pid);
    run("UPDATE products SET name=?,category=?,price=?,tax_rate=?,packaging_cost=?,active=? WHERE id=?",
      name, str(f.get("category")), price, tax, pack, f.get("active") ? 1 : 0, pid);
    audit(u.id, "Ürünü güncelledi", "product", pid, old && old.price !== price ? `${name}: ${fmtTL(old.price)} → ${fmtTL(price)}` : name);
    return ok("Ürün güncellendi. Onaylanmış satışlar eski fiyat ve maliyetle kalır.");
  }
  const nid = run("INSERT INTO products(name,category,price,tax_rate,packaging_cost) VALUES(?,?,?,?,?)", name, str(f.get("category")), price, tax, pack);
  audit(u.id, "Ürün ekledi", "product", nid, name);
  return ok("Ürün eklendi. Reçetesini tanımlayın.");
}

export async function recipeSet(f: FormData) {
  const u = await requireUser();
  if (!can.editProducts(u)) return fail("Reçete düzenleme yetkiniz yok.");
  const pid = id(f, "product_id"), iid = id(f, "item_id"), qty = parseNum(f.get("qty"));
  if (!pid || !iid || qty == null || qty <= 0) return fail("Malzeme ve miktar girin.");
  run("INSERT INTO recipe_items(product_id,item_id,qty) VALUES(?,?,?) ON CONFLICT(product_id,item_id) DO UPDATE SET qty=excluded.qty", pid, iid, qty);
  audit(u.id, "Reçeteyi güncelledi", "product", pid, `malzeme #${iid}: ${qty}`);
  return ok("Reçete güncellendi.");
}

export async function recipeRemove(f: FormData) {
  const u = await requireUser();
  if (!can.editProducts(u)) return fail("Reçete düzenleme yetkiniz yok.");
  const r = get<{ product_id: number }>("SELECT product_id FROM recipe_items WHERE id=?", id(f));
  if (!r) return fail("Reçete satırı bulunamadı.");
  run("DELETE FROM recipe_items WHERE id=?", id(f));
  audit(u.id, "Reçeteden malzeme çıkardı", "product", r.product_id);
  return ok("Malzeme reçeteden çıkarıldı.");
}

/* ---------- Günlük satış ---------- */

export async function salesSave(f: FormData) {
  const u = await requireUser();
  if (!can.enterSales(u)) return fail("Satış girişi yetkiniz yok.");
  const date = str(f.get("date"));
  if (!isDate(date) || date > todayStr()) return fail("Geçerli bir tarih seçin.");
  if (get("SELECT 1 FROM sales_days WHERE date=? AND status='onayli'", date)) return fail("Bu gün onaylanmış; değişiklik için düzeltme kaydı açın.");
  const prods = all<{ id: number; name: string; price: number; tax_rate: number }>("SELECT id,name,price,tax_rate FROM products WHERE active=1");
  const rows: [number, number, number, number, number, number][] = [];
  for (const p of prods) {
    const q = parseNum(f.get(`q_${p.id}`)) ?? 0, d = parseKurus(f.get(`d_${p.id}`)) ?? 0, r = parseKurus(f.get(`r_${p.id}`)) ?? 0;
    if (q < 0 || d < 0 || r < 0) return fail(`${p.name}: negatif değer girilemez.`);
    if (q === 0 && (d || r)) return fail(`${p.name}: adet olmadan indirim/iade girilemez.`);
    if (d + r > q * p.price) return fail(`${p.name}: indirim ve iade, satış tutarını aşamaz.`);
    if (q > 0) rows.push([p.id, q, p.price, d, r, p.tax_rate]);
  }
  const chans = all<{ id: number }>("SELECT id FROM payment_channels WHERE active=1");
  tx(() => {
    run("DELETE FROM sale_lines WHERE date=? AND kind='satis' AND ticket_id IS NULL", date);
    for (const r of rows)
      run("INSERT INTO sale_lines(date,product_id,qty,unit_price,discount,refund,tax_rate,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)", date, ...r, u.id, now());
    run("DELETE FROM sale_payments WHERE date=?", date);
    for (const c of chans) {
      const a = parseKurus(f.get(`p_${c.id}`)) ?? 0;
      if (a > 0) run("INSERT INTO sale_payments(date,channel_id,amount) VALUES(?,?,?)", date, c.id, a);
    }
    run(`INSERT INTO sales_days(date,entered_by,entered_at,note) VALUES(?,?,?,?)
         ON CONFLICT(date) DO UPDATE SET entered_by=excluded.entered_by, entered_at=excluded.entered_at, note=excluded.note`,
      date, u.id, now(), str(f.get("note")));
    audit(u.id, "Günlük satışı kaydetti", "sales_day", undefined, `${date}: ${rows.length} ürün`);
  });
  return ok("Satış taslağı kaydedildi. Kontrol edip onaylayın.");
}

export async function salesApprove(f: FormData) {
  const u = await requireUser();
  if (!can.approveSales(u)) return fail("Gün sonu onayı yetkiniz yok.");
  const date = str(f.get("date"));
  if (!isDate(date)) return fail("Tarih geçersiz.");
  const day = get<{ status: string; note: string | null }>("SELECT status,note FROM sales_days WHERE date=?", date);
  if (!day || day.status === "onayli") return fail("Onaylanacak taslak bulunamadı.");
  const lines = all<{ id: number; product_id: number; qty: number; net: number; consumed: number; unit_cost: number | null }>(
    "SELECT id, product_id, qty, qty*unit_price-discount-refund AS net, consumed, unit_cost FROM sale_lines WHERE date=?", date);
  if (!lines.length) return fail("Bu gün için satış satırı yok.");
  const net = lines.reduce((s, l) => s + l.net, 0);
  const paid = get<{ s: number | null }>("SELECT SUM(amount) AS s FROM sale_payments WHERE date=?", date)?.s ?? 0;
  if (Math.round(net) !== paid && !day.note)
    return fail(`Net satış ${fmtTL(Math.round(net))}, tahsilat ${fmtTL(paid)}. Farkı taslaktaki açıklama alanına yazıp kaydedin.`);
  tx(() => {
    for (const l of lines) {
      if (l.consumed) continue; // kasadan girilen satırlar satış anında düşüldü
      run("UPDATE sale_lines SET unit_cost=?, consumed=1 WHERE id=?", Math.round(recipeCost(l.product_id)), l.id);
      consume(l.product_id, l.qty, `sale:${date}`, u.id);
    }
    run(`UPDATE sale_payments SET commission = CAST(ROUND(amount * (SELECT commission_pct FROM payment_channels c WHERE c.id=channel_id) / 100.0) AS INTEGER) WHERE date=?`, date);
    run("UPDATE sales_days SET status='onayli', approved_by=?, approved_at=? WHERE date=?", u.id, now(), date);
    audit(u.id, "Günlük satışı onayladı", "sales_day", undefined, `${date}: net ${fmtTL(Math.round(net))}, tahsilat ${fmtTL(paid)}`);
  });
  return ok("Gün onaylandı; reçetelere göre stok düşüldü.");
}

export async function salesCorrect(f: FormData) {
  const u = await requireUser();
  if (!can.approveSales(u)) return fail("Düzeltme kaydı yetkiniz yok.");
  const date = str(f.get("date")), note = str(f.get("note"));
  const pid = id(f, "product_id"), qty = parseNum(f.get("qty")), chan = id(f, "channel_id"), amount = parseKurus(f.get("amount")) ?? 0;
  if (!isDate(date) || !get("SELECT 1 FROM sales_days WHERE date=? AND status='onayli'", date)) return fail("Düzeltme yalnızca onaylı güne açılır.");
  if (!note) return fail("Düzeltme nedenini yazın.");
  const p = pid ? get<{ price: number; tax_rate: number }>("SELECT price,tax_rate FROM products WHERE id=?", pid) : undefined;
  if (pid && (!p || qty == null || qty === 0)) return fail("Ürün için sıfırdan farklı adet girin (eksiltmek için negatif).");
  if (!pid && !(chan && amount)) return fail("Ürün adedi veya tahsilat düzeltmesi girin.");
  tx(() => {
    if (p && qty) {
      const old = get<{ unit_price: number; tax_rate: number }>(
        "SELECT unit_price,tax_rate FROM sale_lines WHERE date=? AND product_id=? AND kind='satis' LIMIT 1", date, pid);
      run(`INSERT INTO sale_lines(date,product_id,qty,unit_price,tax_rate,unit_cost,kind,note,created_by,created_at,consumed) VALUES(?,?,?,?,?,?,'duzeltme',?,?,?,1)`,
        date, pid, qty, old?.unit_price ?? p.price, old?.tax_rate ?? p.tax_rate, Math.round(recipeCost(pid)), note, u.id, now());
      consume(pid, qty, `sale:${date}:duzeltme`, u.id);
    }
    if (chan && amount) {
      run(`INSERT INTO sale_payments(date,channel_id,amount) VALUES(?,?,?) ON CONFLICT(date,channel_id) DO UPDATE SET amount=amount+excluded.amount`, date, chan, amount);
      run(`UPDATE sale_payments SET commission = CAST(ROUND(amount * (SELECT commission_pct FROM payment_channels c WHERE c.id=channel_id) / 100.0) AS INTEGER) WHERE date=? AND channel_id=?`, date, chan);
    }
    audit(u.id, "Satış düzeltme kaydı açtı", "sales_day", undefined, `${date}: ${note}`);
  });
  return ok("Düzeltme kaydı eklendi; asıl kayıt değişmedi.");
}

export async function channelSave(f: FormData) {
  const u = await requireUser();
  if (u.role !== "sahip") return fail("Ödeme kanallarını işletme sahibi düzenler.");
  const name = str(f.get("name")), pct = parseNum(f.get("commission_pct")) ?? 0;
  if (!name || pct < 0 || pct > 100) return fail("Kanal adı ve komisyon oranını kontrol edin.");
  const cid = id(f);
  if (cid) run("UPDATE payment_channels SET name=?, commission_pct=?, active=? WHERE id=?", name, pct, f.get("active") ? 1 : 0, cid);
  else run("INSERT INTO payment_channels(name,commission_pct) VALUES(?,?)", name, pct);
  audit(u.id, "Ödeme kanalını kaydetti", "channel", cid || undefined, `${name}: %${pct}`);
  return ok("Ödeme kanalı kaydedildi. Yeni oran bundan sonra onaylanan günlere uygulanır.");
}

/* ---------- Kasa ---------- */

export async function kasaSale(f: FormData) {
  const u = await requireUser();
  const date = todayStr();
  if (get("SELECT 1 FROM sales_days WHERE date=? AND status='onayli'", date)) return fail("Bugün onaylanıp kilitlenmiş; yeni satış girilemez. Yöneticiye haber verin.");
  let items: { id: number; qty: number }[] = [];
  try {
    const raw = JSON.parse(String(f.get("items") ?? "[]"));
    if (Array.isArray(raw)) items = raw.map((r) => ({ id: Number(r?.id), qty: Number(r?.qty) }));
  } catch {}
  if (!items.length || items.some((i) => !Number.isInteger(i.id) || !Number.isInteger(i.qty) || i.qty <= 0 || i.qty > 500)) return fail("Sepet boş veya geçersiz.");
  const mode = str(f.get("mode")) ?? "";
  const ikram = mode === "ikram";
  const chan = ikram ? null : get<{ id: number; name: string }>("SELECT id,name FROM payment_channels WHERE id=? AND active=1", Number(mode));
  if (!ikram && !chan) return fail("Ödeme türünü seçin.");
  const treatBy = ikram ? get<{ id: number; name: string }>("SELECT id,name FROM users WHERE id=? AND active=1", id(f, "treat_by")) : undefined;
  if (ikram && !treatBy) return fail("İkramı yapan kişiyi seçin.");
  const rows = items.map((i) => ({ ...i, p: get<{ id: number; name: string; price: number; tax_rate: number }>("SELECT id,name,price,tax_rate FROM products WHERE id=? AND active=1", i.id) }));
  if (rows.some((r) => !r.p)) return fail("Sepette satışta olmayan ürün var; sayfayı yenileyin.");
  const total = ikram ? 0 : rows.reduce((s, r) => s + r.qty * r.p!.price, 0);
  const summary = rows.map((r) => `${r.qty}× ${r.p!.name}`).join(", ");
  tx(() => {
    run("INSERT OR IGNORE INTO sales_days(date,entered_by,entered_at) VALUES(?,?,?)", date, u.id, now());
    const tid = run("INSERT INTO tickets(date,at,user_id,kind,channel_id,treat_by,note,total,summary) VALUES(?,?,?,?,?,?,?,?,?)",
      date, now(), u.id, ikram ? "ikram" : "satis", chan?.id ?? null, treatBy?.id ?? null, str(f.get("note")), total, summary);
    for (const r of rows) {
      run(`INSERT INTO sale_lines(date,product_id,qty,unit_price,tax_rate,unit_cost,kind,ticket_id,consumed,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,1,?,?)`,
        date, r.id, r.qty, ikram ? 0 : r.p!.price, r.p!.tax_rate, Math.round(recipeCost(r.id)), ikram ? "ikram" : "satis", tid, u.id, now());
      consume(r.id, r.qty, `ticket:${tid}`, u.id);
    }
    audit(u.id, ikram ? "Kasadan ikram girdi" : "Kasadan satış girdi", "ticket", tid,
      ikram ? `${summary} · ikramı yapan: ${treatBy!.name}` : `${summary} · ${chan!.name} ${fmtTL(total)}`);
  });
  return ok(ikram ? `İkram kaydedildi (${treatBy!.name}); stoktan düşüldü.` : `Satış kaydedildi: ${fmtTL(total)} · ${chan!.name}.`);
}

export async function kasaVoid(f: FormData) {
  const u = await requireUser();
  const t = get<{ id: number; date: string; user_id: number; void_at: string | null; summary: string }>("SELECT * FROM tickets WHERE id=?", id(f));
  const note = str(f.get("note"));
  if (!t || t.void_at) return fail("Fiş bulunamadı veya zaten iptal edilmiş.");
  if (!(t.user_id === u.id || can.approveSales(u))) return fail("Yalnızca kendi fişinizi iptal edebilirsiniz.");
  if (get("SELECT 1 FROM sales_days WHERE date=? AND status='onayli'", t.date)) return fail("Gün onaylanmış; düzeltme kaydı açılmalı.");
  if (!note) return fail("İptal nedenini yazın.");
  tx(() => {
    for (const l of all<{ product_id: number; qty: number }>("SELECT product_id, qty FROM sale_lines WHERE ticket_id=?", t.id))
      consume(l.product_id, -l.qty, `ticket:${t.id}:iptal`, u.id);
    run("DELETE FROM sale_lines WHERE ticket_id=?", t.id);
    run("UPDATE tickets SET void_by=?, void_at=?, note=COALESCE(note || ' · ', '') || ? WHERE id=?", u.id, now(), `İptal: ${note}`, t.id);
    audit(u.id, "Kasa fişini iptal etti", "ticket", t.id, `${t.summary} — ${note}`);
  });
  return ok("Fiş iptal edildi; stok geri alındı.");
}

/* ---------- Giderler ---------- */

export async function expenseSave(f: FormData) {
  const u = await requireUser();
  if (!can.editExpenses(u)) return fail("Gider kaydı yetkiniz yok.");
  const name = str(f.get("name")), amount = parseKurus(f.get("amount")), date = str(f.get("date")), cat = id(f, "category_id");
  const period = str(f.get("period")) ?? (date ?? "").slice(0, 7), due = str(f.get("due_date"));
  if (!name || amount == null || amount <= 0 || !isDate(date) || !cat || !/^\d{4}-\d{2}$/.test(period)) return fail("Ad, tutar, tarih ve kategori zorunlu.");
  if (due && !isDate(due)) return fail("Vade tarihi geçersiz.");
  const eid = run(
    `INSERT INTO expenses(date,period,name,category_id,amount,fixed,supplier_id,doc_no,due_date,paid_at,paid_by,note,created_by,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    date, period, name, cat, amount, f.get("fixed") ? 1 : 0, id(f, "supplier_id") || null, str(f.get("doc_no")), due,
    f.get("paid") ? date : null, f.get("paid") ? u.id : null, str(f.get("note")), u.id, now());
  audit(u.id, "Gider kaydetti", "expense", eid, `${name}: ${fmtTL(amount)}`);
  return ok("Gider kaydedildi.");
}

export async function expensePaid(f: FormData) {
  const u = await requireUser();
  if (!can.editExpenses(u)) return fail("Yetkiniz yok.");
  const e = get<{ id: number; name: string; paid_at: string | null }>("SELECT id,name,paid_at FROM expenses WHERE id=?", id(f));
  const date = str(f.get("paid_at")) ?? todayStr();
  if (!e || e.paid_at) return fail("Ödenecek gider bulunamadı.");
  if (!isDate(date) || date > todayStr()) return fail("Ödeme tarihi geçersiz.");
  run("UPDATE expenses SET paid_at=?, paid_by=? WHERE id=?", date, u.id, e.id);
  audit(u.id, "Gideri ödendi işaretledi", "expense", e.id, `${e.name}, ${date}`);
  return ok("Ödeme kaydedildi.");
}

export async function expenseDelete(f: FormData) {
  const u = await requireUser();
  if (u.role !== "sahip") return fail("Gider kaydını yalnızca işletme sahibi silebilir.");
  const e = get<{ id: number; name: string; amount: number; paid_at: string | null; template_id: number | null }>("SELECT * FROM expenses WHERE id=?", id(f));
  if (!e || e.paid_at) return fail("Ödenmiş gider silinemez.");
  if (e.template_id) return fail("Şablondan gelen kayıt silinemez; şablonu durdurun.");
  run("DELETE FROM expenses WHERE id=?", e.id);
  audit(u.id, "Gider kaydını sildi", "expense", e.id, `${e.name}: ${fmtTL(e.amount)}`);
  return ok("Gider silindi.");
}

export async function templateSave(f: FormData) {
  const u = await requireUser();
  if (!can.editExpenses(u)) return fail("Yetkiniz yok.");
  const tid = id(f), amount = parseKurus(f.get("amount"));
  if (amount == null || amount <= 0) return fail("Tutar girin.");
  if (tid) {
    const t = get<{ name: string; amount: number }>("SELECT name,amount FROM expense_templates WHERE id=?", tid);
    if (!t) return fail("Şablon bulunamadı.");
    run("UPDATE expense_templates SET amount=?, active=? WHERE id=?", amount, f.get("active") ? 1 : 0, tid);
    audit(u.id, "Sabit gider şablonunu güncelledi", "expense_template", tid, `${t.name}: ${fmtTL(t.amount)} → ${fmtTL(amount)}`);
    return ok("Şablon güncellendi. Oluşmuş dönem kayıtları değişmez; yeni tutar sonraki dönemlere uygulanır.");
  }
  const name = str(f.get("name")), cat = id(f, "category_id"), day = Number(f.get("due_day")) || 0, start = str(f.get("start_period")) ?? "";
  if (!name || !cat || day < 1 || day > 31 || !/^\d{4}-\d{2}$/.test(start)) return fail("Ad, kategori, vade günü ve başlangıç ayını girin.");
  const nid = run("INSERT INTO expense_templates(name,category_id,amount,due_day,start_period) VALUES(?,?,?,?,?)", name, cat, amount, day, start);
  audit(u.id, "Sabit gider şablonu açtı", "expense_template", nid, `${name}: ${fmtTL(amount)}`);
  return ok("Sabit gider şablonu açıldı.");
}

export async function categoryAdd(f: FormData) {
  const u = await requireUser();
  if (!can.editExpenses(u)) return fail("Yetkiniz yok.");
  const name = str(f.get("name"));
  if (!name) return fail("Kategori adı yazın.");
  if (get("SELECT 1 FROM expense_categories WHERE name=?", name)) return fail("Bu kategori zaten var.");
  run("INSERT INTO expense_categories(name) VALUES(?)", name);
  return ok("Kategori eklendi.");
}

/* ---------- Fire / ikram / iç kullanım ---------- */

export async function wasteRecord(f: FormData) {
  const u = await requireUser();
  const it = get<{ id: number; name: string; unit: string; last_price: number | null }>("SELECT id,name,unit,last_price FROM stock_items WHERE id=? AND active=1", id(f, "item_id"));
  const qty = parseNum(f.get("qty")), kind = str(f.get("kind")) ?? "", reason = str(f.get("reason"));
  if (!it || qty == null || qty <= 0 || !(kind in WASTE_KINDS)) return fail("Kalem, miktar ve tür zorunlu.");
  if (kind === "fire" && !(reason && WASTE_REASONS.includes(reason))) return fail("Fire nedenini seçin.");
  tx(() => {
    const wid = run("INSERT INTO waste(date,item_id,qty,kind,reason,note,unit_cost,user_id,at) VALUES(?,?,?,?,?,?,?,?,?)",
      todayStr(), it.id, qty, kind, kind === "fire" ? reason : null, str(f.get("note")), it.last_price, u.id, now());
    stockMove(it.id, -qty, kind, `waste:${wid}`, reason, u.id);
    audit(u.id, `${WASTE_KINDS[kind]} kaydetti`, "stock_item", it.id, `${it.name}: ${qty} ${it.unit}`);
  });
  return ok("Kayıt alındı, stoktan düşüldü.");
}
