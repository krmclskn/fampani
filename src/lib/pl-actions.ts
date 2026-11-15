"use server";

import { audit, get, run, todayStr, tx } from "./db";
import { can, requireUser, type User } from "./auth";
import { fail, ok } from "./flash";
import { daysIn, fmtTL, isPeriod, parseKurus, parseNum, periodLabel, shiftPeriod, str, vatOf } from "./util";

const now = () => new Date().toISOString();
const id = (f: FormData, k = "id") => Number(f.get(k)) || 0;
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
async function admin(): Promise<User> {
  const u = await requireUser();
  if (!can.seeFinance(u)) await fail("Bu işlem için yönetici yetkisi gerekir.");
  return u;
}
function setDay(date: string, cash: number, card: number, note: string | null, uid: number) {
  if (!cash && !card && !note) run("DELETE FROM revenue_days WHERE date=?", date);
  else run(`INSERT INTO revenue_days(date,cash,card,note,user_id,at) VALUES(?,?,?,?,?,?)
            ON CONFLICT(date) DO UPDATE SET cash=excluded.cash, card=excluded.card, note=excluded.note, user_id=excluded.user_id, at=excluded.at`,
    date, cash, card, note, uid, now());
}

/* ---------- Ciro ---------- */

export async function revenueDay(f: FormData) {
  const u = await admin();
  const date = str(f.get("date")), cash = parseKurus(f.get("cash")) ?? 0, card = parseKurus(f.get("card")) ?? 0;
  if (!isDate(date) || date > todayStr()) return fail("Geçerli bir gün seçin.");
  if (cash < 0 || card < 0) return fail("Tutar negatif olamaz.");
  setDay(date, cash, card, str(f.get("note")), u.id);
  audit(u.id, "Günlük ciro girdi", "revenue", undefined, `${date}: ${fmtTL(cash + card)}`);
  return ok(`${date} cirosu kaydedildi: ${fmtTL(cash + card)}.`);
}

export async function revenueMonth(f: FormData) {
  const u = await admin();
  const period = str(f.get("period"));
  if (!isPeriod(period) || period > todayStr().slice(0, 7)) return fail("Geçerli bir ay seçin.");
  const lump = parseKurus(f.get("lump")) ?? 0;
  if (lump < 0) return fail("Tutar negatif olamaz.");
  const rows: [string, number, number][] = [];
  for (let d = 1; d <= daysIn(period); d++) {
    const date = `${period}-${String(d).padStart(2, "0")}`;
    const cash = parseKurus(f.get(`n_${d}`)) ?? 0, card = parseKurus(f.get(`k_${d}`)) ?? 0;
    if (cash < 0 || card < 0) return fail(`${d}. gün: tutar negatif olamaz.`);
    rows.push([date, cash, card]);
  }
  let total = lump;
  tx(() => {
    for (const [date, cash, card] of rows) {
      const old = get<{ note: string | null }>("SELECT note FROM revenue_days WHERE date=?", date);
      setDay(date, cash, card, old?.note ?? null, u.id);
      total += cash + card;
    }
    if (lump) run("INSERT INTO revenue_lump(period,amount,user_id,at) VALUES(?,?,?,?) ON CONFLICT(period) DO UPDATE SET amount=excluded.amount, user_id=excluded.user_id, at=excluded.at", period, lump, u.id, now());
    else run("DELETE FROM revenue_lump WHERE period=?", period);
    audit(u.id, "Aylık ciro tablosunu kaydetti", "revenue", undefined, `${period}: ${fmtTL(total)}`);
  });
  return ok(`${periodLabel(period)} cirosu kaydedildi: ${fmtTL(total)}.`);
}

export async function ratesSave(f: FormData) {
  const u = await admin();
  const pct = parseNum(f.get("pct")), vat = parseNum(f.get("vat"));
  if (pct == null || pct < 0 || pct > 100 || vat == null || vat < 0 || vat > 100) return fail("Oranları kontrol edin.");
  const set = (k: string, v: number) => run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", k, String(v));
  set("card_commission_pct", pct); set("revenue_vat_pct", vat);
  audit(u.id, "Ciro oranlarını değiştirdi", "setting", undefined, `kart komisyonu %${pct}, ciro KDV %${vat}`);
  return ok("Oranlar kaydedildi; tüm aylara uygulanır.");
}

/* ---------- Giderler ---------- */

const rate = (f: FormData, k = "vat_rate") => { const r = parseNum(f.get(k)) ?? 0; return r >= 0 && r <= 100 ? r : 0; };

/** Tek form: tek seferlik gider ya da "her ay tekrarla" ile sabit gider. Tutar KDV dahildir. */
export async function expenseAdd(f: FormData) {
  const u = await admin();
  const cat = get<{ id: number; name: string; official: number }>("SELECT id,name,official FROM expense_categories WHERE id=?", id(f, "category_id"));
  const amount = parseKurus(f.get("amount")), period = str(f.get("period"));
  if (!cat || amount == null || amount <= 0 || !isPeriod(period)) return fail("Tür ve tutarı girin.");
  const name = str(f.get("name")) ?? cat.name, vr = cat.official ? rate(f) : 0;
  if (f.get("repeat")) {
    const start = str(f.get("start")) ?? period;
    if (!isPeriod(start) || start > todayStr().slice(0, 7) || start < shiftPeriod(todayStr().slice(0, 7), -59)) return fail("Başlangıç ayı geçersiz.");
    const tid = run("INSERT INTO expense_templates(name,category_id,amount,due_day,start_period,vat_rate) VALUES(?,?,?,1,?,?)", name, cat.id, amount, start, vr);
    audit(u.id, "Sabit gider ekledi", "expense_template", tid, `${name}: ${fmtTL(amount)}/ay, ${start} itibarıyla`);
    return ok(`${name} her aya eklendi (${periodLabel(start)} ayından itibaren).`);
  }
  const today = todayStr();
  const date = str(f.get("date")) ?? (period === today.slice(0, 7) ? today : `${period}-01`);
  if (!isDate(date) || date.slice(0, 7) !== period) return fail("Tarih seçili ayın içinde olmalı.");
  const eid = run("INSERT INTO expenses(date,period,name,category_id,amount,vat,fixed,created_by,created_at) VALUES(?,?,?,?,?,?,0,?,?)",
    date, period, name, cat.id, amount, vatOf(amount, vr), u.id, now());
  audit(u.id, "Gider ekledi", "expense", eid, `${name}: ${fmtTL(amount)} (${period})`);
  return ok(`${name} eklendi.`);
}

/** Maaş girişi: SGK'lı maaş, SGK/vergi primi ve varsa elden (SGK'sız) ödeme ayrı kalemler olarak açılır. */
export async function salaryAdd(f: FormData) {
  const u = await admin();
  const person = str(f.get("person")), start = str(f.get("start"));
  const maas = parseKurus(f.get("maas")) ?? 0, sgk = parseKurus(f.get("sgk")) ?? 0, elden = parseKurus(f.get("elden")) ?? 0;
  if (!person) return fail("Çalışanın adını yazın.");
  if (maas < 0 || sgk < 0 || elden < 0 || maas + sgk + elden <= 0) return fail("En az bir tutar girin.");
  if (!isPeriod(start) || start > todayStr().slice(0, 7) || start < shiftPeriod(todayStr().slice(0, 7), -59)) return fail("Başlangıç ayı geçersiz.");
  const catId = (n: string) => get<{ id: number }>("SELECT id FROM expense_categories WHERE name=?", n)?.id;
  const parts: [string, number, number | undefined][] = [
    [`${person} maaş`, maas, get<{ id: number }>("SELECT id FROM expense_categories WHERE grp='maas' ORDER BY id LIMIT 1")?.id],
    [`${person} SGK`, sgk, catId("SGK primi")],
    [`${person} elden`, elden, catId("SGK'sız maaş")],
  ];
  const once = !f.get("repeat");
  tx(() => {
    for (const [name, amount, cid] of parts) {
      if (!amount || !cid) continue;
      if (once) run("INSERT INTO expenses(date,period,name,category_id,amount,fixed,created_by,created_at) VALUES(?,?,?,?,?,0,?,?)", `${start}-01`, start, name, cid, amount, u.id, now());
      else run("INSERT INTO expense_templates(name,category_id,amount,due_day,start_period) VALUES(?,?,?,1,?)", name, cid, amount, start);
    }
    audit(u.id, "Maaş kalemi ekledi", "expense", undefined, `${person}: maaş ${fmtTL(maas)}, SGK ${fmtTL(sgk)}, elden ${fmtTL(elden)}${once ? "" : `, ${start} itibarıyla her ay`}`);
  });
  return ok(`${person} için maaş kalemleri eklendi${once ? "" : " (her ay tekrarlar)"}.`);
}

export async function expenseAmount(f: FormData) {
  const u = await admin();
  const e = get<{ id: number; name: string; amount: number; vat: number; template_id: number | null; period: string }>("SELECT * FROM expenses WHERE id=?", id(f));
  const amount = parseKurus(f.get("amount"));
  if (!e || amount == null || amount < 0) return fail("Tutarı kontrol edin.");
  const forward = !!f.get("forward") && !!e.template_id;
  const vat = e.amount ? Math.round((e.vat * amount) / e.amount) : 0; // KDV oranı korunur
  tx(() => {
    run("UPDATE expenses SET amount=?, vat=? WHERE id=?", amount, vat, e.id);
    if (forward) {
      run("UPDATE expense_templates SET amount=? WHERE id=?", amount, e.template_id);
      run("UPDATE expenses SET amount=?, vat=? WHERE template_id=? AND period>?", amount, vat, e.template_id, e.period);
    }
    audit(u.id, "Gider tutarını değiştirdi", "expense", e.id, `${e.name} ${e.period}: ${fmtTL(e.amount)} → ${fmtTL(amount)}${forward ? " (sonraki aylar dahil)" : ""}`);
  });
  return ok(forward ? "Tutar bu ay ve sonraki aylar için güncellendi." : "Tutar yalnızca bu ay için güncellendi.");
}

export async function expenseRemove(f: FormData) {
  const u = await admin();
  const e = get<{ id: number; name: string; amount: number; template_id: number | null; period: string }>("SELECT * FROM expenses WHERE id=?", id(f));
  if (!e || e.template_id) return fail("Kayıt bulunamadı.");
  run("DELETE FROM expenses WHERE id=?", e.id);
  audit(u.id, "Gideri sildi", "expense", e.id, `${e.name}: ${fmtTL(e.amount)} (${e.period})`);
  return ok("Gider silindi.");
}

/** Sabit gideri seçili aydan itibaren kaldırır; önceki aylar kalır. */
export async function fixedRemove(f: FormData) {
  const u = await admin();
  const t = get<{ id: number; name: string; start_period: string }>("SELECT id,name,start_period FROM expense_templates WHERE id=?", id(f));
  const from = str(f.get("from"));
  if (!t || !isPeriod(from)) return fail("Sabit gider bulunamadı.");
  tx(() => {
    run("DELETE FROM expenses WHERE template_id=? AND period>=?", t.id, from);
    if (from <= t.start_period) run("DELETE FROM expense_templates WHERE id=?", t.id);
    else run("UPDATE expense_templates SET end_period=?, active=1 WHERE id=?", shiftPeriod(from, -1), t.id);
    audit(u.id, "Sabit gideri kaldırdı", "expense_template", t.id, `${t.name}: ${from} itibarıyla`);
  });
  return ok(`${t.name}, ${periodLabel(from)} ayından itibaren kaldırıldı.`);
}

/* ---------- Tedarikçiler ---------- */

export async function supplierAdd(f: FormData) {
  const u = await admin();
  const name = str(f.get("name"));
  if (!name) return fail("Tedarikçi adını yazın.");
  if (get("SELECT 1 FROM suppliers WHERE name=?", name)) return fail("Bu adla bir tedarikçi zaten var.");
  const sid = run("INSERT INTO suppliers(name) VALUES(?)", name);
  audit(u.id, "Tedarikçi ekledi", "supplier", sid, name);
  return ok(`${name} eklendi.`);
}

export async function supplierEdit(f: FormData) {
  const u = await admin();
  const s = get<{ id: number; name: string }>("SELECT id,name FROM suppliers WHERE id=?", id(f));
  if (!s) return fail("Tedarikçi bulunamadı.");
  if (f.get("op") === "sil") {
    const used = get<{ c: number }>(
      `SELECT (SELECT COUNT(*) FROM sup_purchases WHERE supplier_id=?1) + (SELECT COUNT(*) FROM sup_payments WHERE supplier_id=?1)
       + (SELECT COUNT(*) FROM purchases WHERE supplier_id=?1) + (SELECT COUNT(*) FROM expenses WHERE supplier_id=?1) AS c`, s.id)!.c;
    if (used) return fail("Bu tedarikçinin kayıtları var; önce onları silin.");
    tx(() => { run("UPDATE stock_items SET supplier_id=NULL WHERE supplier_id=?", s.id); run("DELETE FROM suppliers WHERE id=?", s.id); });
    audit(u.id, "Tedarikçiyi sildi", "supplier", s.id, s.name);
    return ok(`${s.name} silindi.`);
  }
  const name = str(f.get("name"));
  if (!name) return fail("Ad boş olamaz.");
  run("UPDATE suppliers SET name=? WHERE id=?", name, s.id);
  audit(u.id, "Tedarikçi adını değiştirdi", "supplier", s.id, `${s.name} → ${name}`);
  return ok("Tedarikçi adı güncellendi.");
}

/**
 * Alım: ya fatura toplamı (KDV dahil) + KDV oranı, ya da ürün satırları (birim fiyat KDV hariç, satır başına KDV oranı).
 * İndirilecek KDV kayıtla birlikte saklanır.
 */
export async function purchaseAdd(f: FormData) {
  const u = await admin();
  const sup = get<{ id: number; name: string }>("SELECT id,name FROM suppliers WHERE id=?", id(f, "supplier_id"));
  if (!sup) return fail("Tedarikçi seçin.");
  const monthly = f.get("monthly") === "1";
  let date: string, period: string;
  if (monthly) {
    const p = str(f.get("period"));
    if (!isPeriod(p) || p > todayStr().slice(0, 7)) return fail("Geçerli bir ay seçin.");
    period = p; date = `${p}-${String(daysIn(p)).padStart(2, "0")}`;
  } else {
    const d = str(f.get("date"));
    if (!isDate(d) || d > todayStr()) return fail("Geçerli bir tarih seçin.");
    date = d; period = d.slice(0, 7);
  }
  let lines: { name: string; qty: number; price: number; vr: number }[] = [];
  try {
    const raw = JSON.parse(String(f.get("lines") ?? "[]"));
    if (Array.isArray(raw))
      lines = raw.map((r) => ({ name: String(r?.name ?? "").trim().slice(0, 120), qty: parseNum(String(r?.qty ?? "")) ?? 0,
        price: parseKurus(String(r?.price ?? "")) ?? 0, vr: Math.min(100, Math.max(0, parseNum(String(r?.vat ?? "")) ?? 0)) }))
        .filter((r) => r.name || r.price);
  } catch {}
  if (lines.some((l) => !l.name || l.qty <= 0 || l.price < 0)) return fail("Ürün satırlarında ad ve miktar zorunlu.");
  let amount: number | null, vat: number, vr: number | null;
  if (lines.length) {
    const net = lines.map((l) => l.qty * l.price);
    vat = Math.round(lines.reduce((s, l, i) => s + (net[i] * l.vr) / 100, 0));
    amount = Math.round(net.reduce((s, x) => s + x, 0)) + vat; vr = null;
  } else {
    amount = parseKurus(f.get("amount")); vr = rate(f);
    vat = amount ? vatOf(amount, vr) : 0;
  }
  if (amount == null || amount <= 0) return fail("Fatura toplamını girin veya ürün satırı ekleyin.");
  tx(() => {
    const pid = run("INSERT INTO sup_purchases(supplier_id,date,period,amount,vat,vat_rate,monthly,doc_no,note,user_id,at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      sup.id, date, period, amount, vat, vr, monthly ? 1 : 0, str(f.get("doc_no")), str(f.get("note")), u.id, now());
    for (const l of lines) run("INSERT INTO sup_purchase_lines(purchase_id,name,qty,unit_price,vat_rate) VALUES(?,?,?,?,?)", pid, l.name, l.qty, l.price, l.vr);
    if (f.get("paid")) run("INSERT INTO sup_payments(supplier_id,date,amount,note,user_id,at) VALUES(?,?,?,?,?,?)", sup.id, date, amount, "Alımla birlikte ödendi", u.id, now());
    audit(u.id, monthly ? "Tedarikçi aylık toplam alım girdi" : "Tedarikçi alımı girdi", "sup_purchase", pid, `${sup.name}: ${fmtTL(amount)}, KDV ${fmtTL(vat)} (${monthly ? period : date})`);
  });
  return ok(`${sup.name}: ${fmtTL(amount)} alım kaydedildi (içinde KDV ${fmtTL(vat)}).`);
}

/**
 * Ödeme. "Alımını ayrıca girmedim" işaretliyse ödeme aynı anda alım (gider) olarak da yazılır;
 * işaretli değilse yalnızca daha önce girilmiş alımın borcunu kapatır.
 */
export async function paymentAdd(f: FormData) {
  const u = await admin();
  const sup = get<{ id: number; name: string }>("SELECT id,name FROM suppliers WHERE id=?", id(f, "supplier_id"));
  const date = str(f.get("date")), amount = parseKurus(f.get("amount"));
  if (!sup || !isDate(date) || date > todayStr() || amount == null || amount <= 0) return fail("Tarih ve tutarı girin.");
  const asPurchase = !!f.get("as_purchase"), vr = rate(f), note = str(f.get("note"));
  tx(() => {
    if (asPurchase)
      run("INSERT INTO sup_purchases(supplier_id,date,period,amount,vat,vat_rate,monthly,note,user_id,at) VALUES(?,?,?,?,?,?,0,?,?,?)",
        sup.id, date, date.slice(0, 7), amount, vatOf(amount, vr), vr, note ?? "Ödemeyle birlikte girildi", u.id, now());
    const yid = run("INSERT INTO sup_payments(supplier_id,date,amount,note,user_id,at) VALUES(?,?,?,?,?,?)", sup.id, date, amount, note, u.id, now());
    audit(u.id, "Tedarikçi ödemesi girdi", "sup_payment", yid, `${sup.name}: ${fmtTL(amount)} (${date})${asPurchase ? " · alım olarak da yazıldı" : ""}`);
  });
  return ok(asPurchase ? `${sup.name}: ${fmtTL(amount)} ödeme kaydedildi ve gidere yazıldı.` : `${sup.name}: ${fmtTL(amount)} ödeme borçtan düşüldü.`);
}

export async function supRecordDelete(f: FormData) {
  const u = await admin();
  const kind = f.get("kind") === "odeme" ? "sup_payments" : "sup_purchases";
  const r = get<{ id: number; amount: number; date: string; supplier_id: number }>(`SELECT id,amount,date,supplier_id FROM ${kind} WHERE id=?`, id(f));
  if (!r) return fail("Kayıt bulunamadı.");
  const name = get<{ name: string }>("SELECT name FROM suppliers WHERE id=?", r.supplier_id)?.name ?? "";
  tx(() => {
    if (kind === "sup_purchases") run("DELETE FROM sup_purchase_lines WHERE purchase_id=?", r.id);
    run(`DELETE FROM ${kind} WHERE id=?`, r.id);
    audit(u.id, kind === "sup_payments" ? "Tedarikçi ödemesini sildi" : "Tedarikçi alımını sildi", kind, r.id, `${name}: ${fmtTL(r.amount)} (${r.date})`);
  });
  return ok("Kayıt silindi.");
}

/* ---------- Borçlar ---------- */

export async function debtAdd(f: FormData) {
  const u = await admin();
  const name = str(f.get("name")), principal = parseKurus(f.get("principal")), start = str(f.get("start_date"));
  const kind = f.get("kind") === "vergi" ? "vergi" : "diger", r = parseNum(f.get("monthly_rate")) ?? 0;
  if (!name || principal == null || principal <= 0 || !isDate(start) || start > todayStr()) return fail("Ad, anapara ve vade tarihini girin.");
  if (r < 0 || r > 100) return fail("Aylık faiz oranını kontrol edin.");
  const did = run("INSERT INTO debts(name,kind,principal,start_date,monthly_rate,note,user_id,at) VALUES(?,?,?,?,?,?,?,?)", name, kind, principal, start, r, str(f.get("note")), u.id, now());
  audit(u.id, "Borç ekledi", "debt", did, `${name}: ${fmtTL(principal)}, aylık %${r}, ${start} itibarıyla`);
  return ok(`${name} eklendi.`);
}

export async function debtPay(f: FormData) {
  const u = await admin();
  const d = get<{ id: number; name: string; start_date: string }>("SELECT id,name,start_date FROM debts WHERE id=?", id(f, "debt_id"));
  const date = str(f.get("date")), amount = parseKurus(f.get("amount"));
  if (!d || !isDate(date) || date > todayStr() || amount == null || amount <= 0) return fail("Tarih ve tutarı girin.");
  if (date < d.start_date) return fail("Ödeme tarihi borcun vadesinden önce olamaz.");
  const pid = run("INSERT INTO debt_payments(debt_id,date,amount,note,user_id,at) VALUES(?,?,?,?,?,?)", d.id, date, amount, str(f.get("note")), u.id, now());
  audit(u.id, "Borç ödemesi girdi", "debt_payment", pid, `${d.name}: ${fmtTL(amount)} (${date})`);
  return ok(`${d.name}: ${fmtTL(amount)} ödeme kaydedildi.`);
}

export async function debtDelete(f: FormData) {
  const u = await admin();
  if (f.get("kind") === "odeme") {
    const p = get<{ id: number; amount: number; date: string }>("SELECT id,amount,date FROM debt_payments WHERE id=?", id(f));
    if (!p) return fail("Ödeme bulunamadı.");
    run("DELETE FROM debt_payments WHERE id=?", p.id);
    audit(u.id, "Borç ödemesini sildi", "debt_payment", p.id, `${fmtTL(p.amount)} (${p.date})`);
    return ok("Ödeme silindi.");
  }
  const d = get<{ id: number; name: string; principal: number }>("SELECT id,name,principal FROM debts WHERE id=?", id(f));
  if (!d) return fail("Borç bulunamadı.");
  tx(() => { run("DELETE FROM debt_payments WHERE debt_id=?", d.id); run("DELETE FROM debts WHERE id=?", d.id); });
  audit(u.id, "Borç kaydını sildi", "debt", d.id, `${d.name}: ${fmtTL(d.principal)}`);
  return ok(`${d.name} silindi.`);
}
