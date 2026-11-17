import { cache } from "react";
import { all, get, setting, todayStr } from "./db";
import { GROUPS, daysIn, periodShort, shiftPeriod, type GroupKey } from "./util";

/** Bir dönemin gelir-gider özeti. g[tür] = [sabit, değişken] kuruş. */
export type Bucket = {
  key: string; label: string; nakit: number; kart: number; toplu: number; ciro: number;
  g: Record<GroupKey, [number, number]>;
  /** Hesaplanan gelir vergisi (g.vergi içinde de sayılır) ve matrahı. */
  tax: number; taxBase: number;
};
export type Kdv = { out: number; inp: number; devir: number; odenecek: number; devreden: number };

const emptyG = () => Object.fromEntries(GROUPS.map((x) => [x.key, [0, 0]])) as Record<GroupKey, [number, number]>;
const empty = (key: string, label: string): Bucket => ({ key, label, nakit: 0, kart: 0, toplu: 0, ciro: 0, g: emptyG(), tax: 0, taxBase: 0 });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(s + "T00:00:00Z");
/** Vergi matrahında düşülen resmi kalemler: alımlar, resmi giderler ve ödenecek KDV. Resmi olmayanlar düşülmez. */
const DEDUCT: GroupKey[] = ["tedarik", "kira", "maas", "sgk", "resmi", "kdv"];
export const giderOf = (b: Bucket) => GROUPS.reduce((s, x) => s + b.g[x.key][0] + b.g[x.key][1], 0);

/**
 * Ödenecek KDV = cironun içindeki KDV − alım ve giderlerde ödenen KDV − önceki aydan devreden.
 * İndirilecek KDV fazlaysa fark sonraki aya devreder. İlk kayıtlı aydan itibaren sırayla hesaplanır.
 */
export const kdvByPeriod = cache(async (end: string): Promise<Map<string, Kdv>> => {
  const rate = Number(await setting("revenue_vat_pct")) || 0;
  const rev = new Map<string, number>(), inp = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const [a, b, c, d] = await Promise.all([
    all<{ p: string; t: number }>("SELECT substr(date,1,7) AS p, SUM(cash+card) AS t FROM revenue_days GROUP BY p"),
    all<{ period: string; amount: number }>("SELECT period, amount FROM revenue_lump"),
    all<{ period: string; v: number }>("SELECT period, SUM(vat) AS v FROM sup_purchases GROUP BY period"),
    all<{ period: string; v: number }>("SELECT period, SUM(vat) AS v FROM expenses GROUP BY period"),
  ]);
  for (const r of a) add(rev, r.p, r.t);
  for (const r of b) add(rev, r.period, r.amount);
  for (const r of c) add(inp, r.period, r.v);
  for (const r of d) add(inp, r.period, r.v);
  const first = [...rev.keys(), ...inp.keys()].sort()[0];
  const out = new Map<string, Kdv>();
  if (!first) return out;
  let carry = 0;
  for (let p = first, i = 0; p <= end && i < 120; p = shiftPeriod(p, 1), i++) {
    const o = Math.round(((rev.get(p) ?? 0) * rate) / (100 + rate)), n = inp.get(p) ?? 0;
    const net = o - n - carry;
    out.set(p, { out: o, inp: n, devir: carry, odenecek: Math.max(net, 0), devreden: Math.max(-net, 0) });
    carry = Math.max(-net, 0);
  }
  return out;
});

type DayRow = { date: string; b: Bucket };

/** start..end arası her gün için gelir ve giderler; tüm giderler ve aylık toplamlar ayın günlerine eşit yayılır, alımlar fatura gününde kalır. */
async function daily(start: string, end: string): Promise<DayRow[]> {
  const pct = Number(await setting("card_commission_pct")) || 0;
  const days = new Map<string, Bucket>();
  for (let d = utc(start); iso(d) <= end; d.setUTCDate(d.getUTCDate() + 1)) days.set(iso(d), empty(iso(d), ""));
  const p0 = start.slice(0, 7), p1 = end.slice(0, 7);
  const spread = (period: string, fn: (b: Bucket, share: number) => void) => {
    const n = daysIn(period);
    for (let i = 1; i <= n; i++) { const b = days.get(`${period}-${String(i).padStart(2, "0")}`); if (b) fn(b, 1 / n); }
  };
  const [revRows, lumpRows, supRows, expRows] = await Promise.all([
    all<{ date: string; cash: number; card: number }>("SELECT date, cash, card FROM revenue_days WHERE date BETWEEN ? AND ?", start, end),
    all<{ period: string; amount: number }>("SELECT period, amount FROM revenue_lump WHERE period BETWEEN ? AND ?", p0, p1),
    all<{ date: string; period: string; amount: number; monthly: number }>(
      "SELECT date, period, amount, monthly FROM sup_purchases WHERE period BETWEEN ? AND ?", p0, p1),
    all<{ date: string; period: string; amount: number; fixed: number; grp: GroupKey }>(
      `SELECT e.date, e.period, e.amount, e.fixed, c.grp FROM expenses e JOIN expense_categories c ON c.id=e.category_id WHERE e.period BETWEEN ? AND ?`, p0, p1),
  ]);
  for (const r of revRows) {
    const b = days.get(r.date); if (b) { b.nakit += r.cash; b.kart += r.card; b.g.resmi[1] += (r.card * pct) / 100; }
  }
  for (const r of lumpRows)
    spread(r.period, (b, s) => { b.toplu += r.amount * s; });
  for (const r of supRows) {
    if (r.monthly) spread(r.period, (b, s) => { b.g.tedarik[1] += r.amount * s; });
    else { const b = days.get(r.date); if (b) b.g.tedarik[1] += r.amount; }
  }
  for (const r of expRows) {
    // Tek seferlik giderler de ait olduğu aya yayılır: kayıt ya da ödeme günü günlük kârı çarpıtmasın.
    spread(r.period, (b, s) => { b.g[r.grp][r.fixed ? 0 : 1] += r.amount * s; });
  }
  for (const b of days.values()) b.ciro = b.nakit + b.kart + b.toplu;
  // Ödenecek KDV ayın cirosuyla orantılı olarak günlere dağıtılır.
  const kdv = await kdvByPeriod(p1), monthRev = new Map<string, number>();
  for (const [date, b] of days) monthRev.set(date.slice(0, 7), (monthRev.get(date.slice(0, 7)) ?? 0) + b.ciro);
  for (const [date, b] of days) {
    const p = date.slice(0, 7), tot = monthRev.get(p) ?? 0;
    if (tot > 0) b.g.kdv[1] += ((kdv.get(p)?.odenecek ?? 0) * b.ciro) / tot;
  }
  // Gelir vergisi ay bazında hesaplanır, günlere ciroyla orantılı dağıtılır.
  const span = (Number(p1.slice(0, 4)) - Number(p0.slice(0, 4))) * 12 + Number(p1.slice(5)) - Number(p0.slice(5)) + 1;
  const taxes = new Map((await monthSeries(p1, span)).map((m) => [m.key, m.tax]));
  for (const [date, b] of days) {
    const p = date.slice(0, 7), tot = monthRev.get(p) ?? 0;
    if (tot > 0) { b.tax = ((taxes.get(p) ?? 0) * b.ciro) / tot; b.g.vergi[1] += b.tax; }
  }
  return [...days].map(([date, b]) => ({ date, b }));
}

function merge(into: Bucket, b: Bucket) {
  into.nakit += b.nakit; into.kart += b.kart; into.toplu += b.toplu; into.ciro += b.ciro; into.tax += b.tax; into.taxBase += b.taxBase;
  for (const x of GROUPS) { into.g[x.key][0] += b.g[x.key][0]; into.g[x.key][1] += b.g[x.key][1]; }
}
const round = (b: Bucket): Bucket => ({
  ...b, nakit: Math.round(b.nakit), kart: Math.round(b.kart), toplu: Math.round(b.toplu), ciro: Math.round(b.ciro),
  tax: Math.round(b.tax), taxBase: Math.round(b.taxBase),
  g: Object.fromEntries(GROUPS.map((x) => [x.key, [Math.round(b.g[x.key][0]), Math.round(b.g[x.key][1])]])) as Bucket["g"],
});

/** Seçili ayla biten 12 ay; her ay kendi tam kayıtlarıyla (yayma yok). */
export const monthSeries = cache(async (end: string, n = 12): Promise<Bucket[]> => {
  const start = shiftPeriod(end, -(n - 1));
  const pct = Number(await setting("card_commission_pct")) || 0;
  const m = new Map<string, Bucket>();
  for (let i = 0; i < n; i++) { const p = shiftPeriod(start, i); m.set(p, empty(p, periodShort(p))); }
  const [revRows, lumpRows, supRows, expRows, kdv, taxPct] = await Promise.all([
    all<{ p: string; cash: number; card: number }>(
      "SELECT substr(date,1,7) AS p, SUM(cash) AS cash, SUM(card) AS card FROM revenue_days WHERE date>=? AND date<=? GROUP BY p", start + "-01", end + "-31"),
    all<{ period: string; amount: number }>("SELECT period, amount FROM revenue_lump WHERE period BETWEEN ? AND ?", start, end),
    all<{ period: string; a: number }>("SELECT period, SUM(amount) AS a FROM sup_purchases WHERE period BETWEEN ? AND ? GROUP BY period", start, end),
    all<{ period: string; fixed: number; grp: GroupKey; a: number }>(
      `SELECT e.period, e.fixed, c.grp, SUM(e.amount) AS a FROM expenses e JOIN expense_categories c ON c.id=e.category_id
       WHERE e.period BETWEEN ? AND ? GROUP BY e.period, e.fixed, c.grp`, start, end),
    kdvByPeriod(end),
    setting("income_tax_pct").then((x) => Number(x) || 0),
  ]);
  for (const r of revRows) {
    const b = m.get(r.p); if (b) { b.nakit = r.cash; b.kart = r.card; b.g.resmi[1] += (r.card * pct) / 100; }
  }
  for (const r of lumpRows) {
    const b = m.get(r.period); if (b) b.toplu = r.amount;
  }
  for (const r of supRows) {
    const b = m.get(r.period); if (b) b.g.tedarik[1] = r.a;
  }
  for (const r of expRows) {
    const b = m.get(r.period); if (b) b.g[r.grp][r.fixed ? 0 : 1] += r.a;
  }
  for (const b of m.values()) {
    b.ciro = b.nakit + b.kart + b.toplu; b.g.kdv[1] = kdv.get(b.key)?.odenecek ?? 0;
    // Gelir vergisi = (ciro − resmi giderler) × oran; zarar varsa 0.
    b.taxBase = b.ciro - DEDUCT.reduce((s, k) => s + b.g[k][0] + b.g[k][1], 0);
    b.tax = Math.max(0, (b.taxBase * taxPct) / 100);
    b.g.vergi[1] += b.tax;
  }
  return [...m.values()].map(round);
});

/** Panel grafikleri: son 30 gün, son 12 hafta, son 12 ay. */
export async function chartData(period: string) {
  const today = todayStr();
  const end = period === today.slice(0, 7) ? today : `${period}-${String(daysIn(period)).padStart(2, "0")}`;
  const e = utc(end), ws = utc(end);
  ws.setUTCDate(ws.getUTCDate() - ((ws.getUTCDay() + 6) % 7) - 7 * 11); // 12 hafta önceki pazartesi
  const rows = await daily(iso(ws), end);
  const d30 = new Date(e); d30.setUTCDate(d30.getUTCDate() - 29);
  const gun = rows.filter((r) => r.date >= iso(d30)).map((r) => round({ ...r.b, label: `${r.date.slice(8)}.${r.date.slice(5, 7)}` }));
  const wk = new Map<string, Bucket>();
  for (const r of rows) {
    const d = utc(r.date); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const k = iso(d);
    if (!wk.has(k)) wk.set(k, empty(k, `${k.slice(8)}.${k.slice(5, 7)}`));
    merge(wk.get(k)!, r.b);
  }
  return { gun, hafta: [...wk.values()].map(round), ay: await monthSeries(period) };
}

export const expenseRows = (period: string) =>
  all<{ id: number; date: string; name: string; amount: number; vat: number; fixed: number; template_id: number | null; category: string;
    grp: GroupKey; official: number; vat_rate: number | null; paid_at: string | null }>(
    `SELECT e.id, e.date, e.name, e.amount, e.vat, e.fixed, e.template_id, e.paid_at, c.name AS category, c.grp, c.official, t.vat_rate
     FROM expenses e JOIN expense_categories c ON c.id=e.category_id LEFT JOIN expense_templates t ON t.id=e.template_id
     WHERE e.period=? ORDER BY c.official DESC, c.grp, e.fixed DESC, e.name`, period);

export const expenseByCategory = (period: string) =>
  all<{ name: string; grp: GroupKey; official: number; total: number }>(
    `SELECT c.name, c.grp, c.official, SUM(e.amount) AS total FROM expenses e JOIN expense_categories c ON c.id=e.category_id
     WHERE e.period=? GROUP BY c.id HAVING SUM(e.amount)<>0 ORDER BY c.official DESC, total DESC`, period);

export const categories = () =>
  all<{ id: number; name: string; grp: GroupKey; official: number }>("SELECT * FROM expense_categories ORDER BY official DESC, grp, name");

export const purchasesBySupplier = (period: string) =>
  all<{ name: string; total: number }>(
    `SELECT s.name, SUM(p.amount) AS total FROM sup_purchases p JOIN suppliers s ON s.id=p.supplier_id
     WHERE p.period=? GROUP BY s.id ORDER BY total DESC`, period);

export async function dailyRevenue(period: string) {
  const rows = new Map((await all<{ date: string; cash: number; card: number }>(
    "SELECT date, cash, card FROM revenue_days WHERE substr(date,1,7)=?", period)).map((r) => [r.date, r]));
  return Array.from({ length: daysIn(period) }, (_, i) => {
    const date = `${period}-${String(i + 1).padStart(2, "0")}`;
    const r = rows.get(date);
    return { date, day: i + 1, cash: r?.cash ?? 0, card: r?.card ?? 0 };
  });
}

export type SupplierV = { id: number; name: string; alim: number; odeme: number; ayAlim: number; ayOdeme: number; ayKdv: number; bakiye: number };
export const supplierBalances = async (period: string) =>
  (await all<Omit<SupplierV, "bakiye">>(
    `SELECT s.id, s.name,
       COALESCE((SELECT SUM(amount) FROM sup_purchases p WHERE p.supplier_id=s.id),0) AS alim,
       COALESCE((SELECT SUM(amount) FROM sup_payments y WHERE y.supplier_id=s.id),0) AS odeme,
       COALESCE((SELECT SUM(amount) FROM sup_purchases p WHERE p.supplier_id=s.id AND p.period=?),0) AS "ayAlim",
       COALESCE((SELECT SUM(vat) FROM sup_purchases p WHERE p.supplier_id=s.id AND p.period=?),0) AS "ayKdv",
       COALESCE((SELECT SUM(amount) FROM sup_payments y WHERE y.supplier_id=s.id AND substr(y.date,1,7)=?),0) AS "ayOdeme"
     FROM suppliers s ORDER BY s.name`, period, period, period)).map((s) => ({ ...s, bakiye: s.alim - s.odeme }));

export const lumpOf = async (period: string) => (await get<{ amount: number }>("SELECT amount FROM revenue_lump WHERE period=?", period))?.amount ?? 0;

/* ---------- Borçlar ---------- */

export type DebtV = {
  id: number; name: string; kind: string; principal: number; start_date: string; monthly_rate: number; note: string | null;
  kalanAna: number; faiz: number; toplam: number; odenen: number; gunluk: number;
  payments: { id: number; date: string; amount: number; note: string | null }[];
};

/**
 * Basit faiz: her gün kalan anaparaya aylık oran / 30 kadar faiz işler (6183 gecikme zammı mantığı).
 * Ödeme, o günkü anapara ve birikmiş faize oranlı olarak dağıtılır.
 */
export async function debts(asOf = todayStr()): Promise<DebtV[]> {
  const pays = await all<{ id: number; debt_id: number; date: string; amount: number; note: string | null }>("SELECT * FROM debt_payments ORDER BY date, id");
  return (await all<Omit<DebtV, "kalanAna" | "faiz" | "toplam" | "odenen" | "gunluk" | "payments">>("SELECT id,name,kind,principal,start_date,monthly_rate,note FROM debts ORDER BY kind DESC, start_date")).map((d) => {
    const mine = pays.filter((p) => p.debt_id === d.id);
    let ana = d.principal, faiz = 0, cursor = d.start_date, odenen = 0;
    const accrue = (to: string) => {
      const n = Math.max(0, Math.round((utc(to).getTime() - utc(cursor).getTime()) / 86400000));
      faiz += (ana * (d.monthly_rate / 100) * n) / 30;
      if (to > cursor) cursor = to;
    };
    for (const p of mine) {
      accrue(p.date);
      const total = ana + faiz, pay = Math.min(p.amount, total);
      if (total > 0) { const share = ana / total; ana -= pay * share; faiz -= pay * (1 - share); }
      odenen += p.amount;
    }
    accrue(asOf);
    return {
      ...d, kalanAna: Math.round(ana), faiz: Math.round(faiz), toplam: Math.round(ana + faiz), odenen,
      gunluk: Math.round((ana * (d.monthly_rate / 100)) / 30), payments: mine,
    };
  });
}
