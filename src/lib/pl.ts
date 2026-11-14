import { all, get, setting } from "./db";
import { daysIn, periodShort, shiftPeriod } from "./util";

export type Month = {
  period: string; label: string; nakit: number; kart: number; toplu: number; ciro: number;
  alim: number; sabit: number; diger: number; komisyon: number; gider: number; net: number;
};

/** Gelir tablosu: ciro − tedarikçi alımları − giderler − kart komisyonu. Tutarlar kuruş, girildiği gibi (vergi dahil). */
export function months(end: string, n: number): Month[] {
  const start = shiftPeriod(end, -(n - 1));
  const pct = Number(setting("card_commission_pct")) || 0;
  const m = new Map<string, Month>();
  for (let i = 0; i < n; i++) {
    const p = shiftPeriod(start, i);
    m.set(p, { period: p, label: periodShort(p), nakit: 0, kart: 0, toplu: 0, ciro: 0, alim: 0, sabit: 0, diger: 0, komisyon: 0, gider: 0, net: 0 });
  }
  for (const r of all<{ p: string; cash: number; card: number }>(
    "SELECT substr(date,1,7) AS p, SUM(cash) AS cash, SUM(card) AS card FROM revenue_days WHERE date>=? AND date<=? GROUP BY p", start + "-01", end + "-31")) {
    const x = m.get(r.p); if (x) { x.nakit = r.cash; x.kart = r.card; }
  }
  for (const r of all<{ period: string; amount: number }>("SELECT period, amount FROM revenue_lump WHERE period BETWEEN ? AND ?", start, end)) {
    const x = m.get(r.period); if (x) x.toplu = r.amount;
  }
  for (const r of all<{ period: string; a: number }>("SELECT period, SUM(amount) AS a FROM sup_purchases WHERE period BETWEEN ? AND ? GROUP BY period", start, end)) {
    const x = m.get(r.period); if (x) x.alim = r.a;
  }
  for (const r of all<{ period: string; fixed: number; a: number }>(
    "SELECT period, fixed, SUM(amount) AS a FROM expenses WHERE period BETWEEN ? AND ? GROUP BY period, fixed", start, end)) {
    const x = m.get(r.period); if (x) { if (r.fixed) x.sabit = r.a; else x.diger = r.a; }
  }
  for (const x of m.values()) {
    x.ciro = x.nakit + x.kart + x.toplu;
    x.komisyon = Math.round((x.kart * pct) / 100);
    x.gider = x.alim + x.sabit + x.diger + x.komisyon;
    x.net = x.ciro - x.gider;
  }
  return [...m.values()];
}

export const expenseByCategory = (period: string) =>
  all<{ name: string; fixed: number; total: number }>(
    `SELECT c.name, e.fixed, SUM(e.amount) AS total FROM expenses e JOIN expense_categories c ON c.id=e.category_id
     WHERE e.period=? GROUP BY c.id, e.fixed HAVING total<>0 ORDER BY e.fixed DESC, total DESC`, period);

export const purchasesBySupplier = (period: string) =>
  all<{ name: string; total: number }>(
    `SELECT s.name, SUM(p.amount) AS total FROM sup_purchases p JOIN suppliers s ON s.id=p.supplier_id
     WHERE p.period=? GROUP BY s.id ORDER BY total DESC`, period);

export function dailyRevenue(period: string) {
  const rows = new Map(all<{ date: string; cash: number; card: number; note: string | null }>(
    "SELECT date, cash, card, note FROM revenue_days WHERE substr(date,1,7)=?", period).map((r) => [r.date, r]));
  return Array.from({ length: daysIn(period) }, (_, i) => {
    const date = `${period}-${String(i + 1).padStart(2, "0")}`;
    const r = rows.get(date);
    return { date, day: i + 1, cash: r?.cash ?? 0, card: r?.card ?? 0, note: r?.note ?? null, has: !!r };
  });
}

export type SupplierV = { id: number; name: string; alim: number; odeme: number; ayAlim: number; ayOdeme: number; bakiye: number };
export const supplierBalances = (period: string) =>
  all<SupplierV>(
    `SELECT s.id, s.name,
       COALESCE((SELECT SUM(amount) FROM sup_purchases p WHERE p.supplier_id=s.id),0) AS alim,
       COALESCE((SELECT SUM(amount) FROM sup_payments y WHERE y.supplier_id=s.id),0) AS odeme,
       COALESCE((SELECT SUM(amount) FROM sup_purchases p WHERE p.supplier_id=s.id AND p.period=?),0) AS ayAlim,
       COALESCE((SELECT SUM(amount) FROM sup_payments y WHERE y.supplier_id=s.id AND substr(y.date,1,7)=?),0) AS ayOdeme
     FROM suppliers s ORDER BY s.name`, period, period).map((s) => ({ ...s, bakiye: s.alim - s.odeme }));

export const lumpOf = (period: string) => get<{ amount: number }>("SELECT amount FROM revenue_lump WHERE period=?", period)?.amount ?? 0;
