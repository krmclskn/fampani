import { all, todayStr } from "./db";

export type Gran = "gun" | "hafta" | "ay" | "yil";
export const GRAN_LABEL: Record<Gran, string> = { gun: "Günlük", hafta: "Haftalık", ay: "Aylık", yil: "Yıllık" };

export type Bucket = {
  key: string; label: string;
  brut: number; indirim: number; net: number; vergi: number; netHaric: number;
  maliyet: number; fire: number; komisyon: number; gider: number; sabit: number; sonuc: number;
  tahsilat: number; nakitCikis: number; nakitNet: number;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(s + "T00:00:00Z");
const AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
/** ISO zaman damgasının İstanbul'daki günü. */
export const dayOf = (isoTs: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(new Date(isoTs));

function bucketOf(date: string, g: Gran): { key: string; label: string } {
  if (g === "gun") return { key: date, label: `${date.slice(8)}.${date.slice(5, 7)}` };
  if (g === "ay") return { key: date.slice(0, 7), label: `${AY[Number(date.slice(5, 7)) - 1]} ${date.slice(2, 4)}` };
  if (g === "yil") return { key: date.slice(0, 4), label: date.slice(0, 4) };
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // pazartesi
  const k = iso(d);
  return { key: k, label: `${k.slice(8)}.${k.slice(5, 7)} hf.` };
}

function rangeStart(g: Gran, today: string): string {
  const d = utc(today);
  if (g === "gun") d.setUTCDate(d.getUTCDate() - 13);
  else if (g === "hafta") d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7 * 11);
  else if (g === "ay") { d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 11); }
  else { d.setUTCMonth(0, 1); d.setUTCFullYear(d.getUTCFullYear() - 2); }
  return iso(d);
}

const empty = (key: string, label: string): Bucket => ({
  key, label, brut: 0, indirim: 0, net: 0, vergi: 0, netHaric: 0, maliyet: 0, fire: 0, komisyon: 0, gider: 0, sabit: 0,
  sonuc: 0, tahsilat: 0, nakitCikis: 0, nakitNet: 0,
});

/** Yalnızca onaylı satış günleri hesaba girer. Sabit giderler ait olduğu ayın günlerine eşit dağıtılır. */
export function financeSeries(g: Gran): Bucket[] {
  const today = todayStr(), start = rangeStart(g, today);
  const map = new Map<string, Bucket>();
  for (let d = utc(start); iso(d) <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    const b = bucketOf(iso(d), g);
    if (!map.has(b.key)) map.set(b.key, empty(b.key, b.label));
  }
  const at = (date: string) => (date >= start && date <= today ? map.get(bucketOf(date, g).key) : undefined);

  for (const r of all<{ date: string; brut: number; ind: number; vergi: number; maliyet: number }>(
    `SELECT l.date, SUM(l.qty*l.unit_price) AS brut, SUM(l.discount+l.refund) AS ind,
       SUM((l.qty*l.unit_price-l.discount-l.refund)*l.tax_rate/(100+l.tax_rate)) AS vergi, SUM(l.qty*COALESCE(l.unit_cost,0)) AS maliyet
     FROM sale_lines l JOIN sales_days d ON d.date=l.date WHERE d.status='onayli' AND l.date>=? GROUP BY l.date`, start)) {
    const b = at(r.date); if (!b) continue;
    b.brut += r.brut; b.indirim += r.ind; b.vergi += r.vergi; b.maliyet += r.maliyet;
  }
  for (const r of all<{ date: string; amount: number; commission: number }>(
    `SELECT p.date, SUM(p.amount) AS amount, SUM(p.commission) AS commission FROM sale_payments p
     JOIN sales_days d ON d.date=p.date WHERE d.status='onayli' AND p.date>=? GROUP BY p.date`, start)) {
    const b = at(r.date); if (!b) continue;
    b.komisyon += r.commission; b.tahsilat += r.amount - r.commission;
  }
  for (const r of all<{ date: string; cost: number }>(
    "SELECT date, SUM(qty*COALESCE(unit_cost,0)) AS cost FROM waste WHERE date>=? GROUP BY date", start)) {
    const b = at(r.date); if (b) b.fire += r.cost;
  }
  for (const e of all<{ date: string; period: string; amount: number; fixed: number; paid_at: string | null }>(
    "SELECT date,period,amount,fixed,paid_at FROM expenses WHERE period>=? OR paid_at>=?", start.slice(0, 7), start)) {
    if (e.fixed) {
      const [y, m] = e.period.split("-").map(Number);
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      for (let i = 1; i <= days; i++) {
        const b = at(`${e.period}-${String(i).padStart(2, "0")}`);
        if (b) { b.gider += e.amount / days; b.sabit += e.amount / days; }
      }
    } else { const b = at(e.date); if (b) b.gider += e.amount; }
    if (e.paid_at) { const b = at(e.paid_at); if (b) b.nakitCikis += e.amount; }
  }
  for (const p of all<{ paid_at: string; invoice_amount: number }>(
    "SELECT paid_at, invoice_amount FROM purchases WHERE paid_at IS NOT NULL AND invoice_amount IS NOT NULL")) {
    const b = at(dayOf(p.paid_at)); if (b) b.nakitCikis += p.invoice_amount;
  }
  for (const b of map.values()) {
    b.net = b.brut - b.indirim;
    b.netHaric = b.net - b.vergi;
    b.sonuc = b.netHaric - b.maliyet - b.fire - b.komisyon - b.gider;
    b.nakitNet = b.tahsilat - b.nakitCikis;
  }
  return [...map.values()];
}

export type ProductStat = {
  id: number; name: string; category: string | null; adet: number; ikram: number; net: number; netHaric: number; maliyet: number;
  indirim: number; komisyon: number; katki: number; marj: number | null;
};

/** Katkı payı = vergi hariç net satış − reçete ve ambalaj maliyeti − ürüne düşen POS komisyonu. */
export function productStats(days: number): ProductStat[] {
  const start = todayStr(-(days - 1));
  const lines = all<{ date: string; product_id: number; name: string; category: string | null; qty: number; unit_price: number;
    discount: number; refund: number; tax_rate: number; unit_cost: number | null; kind: string }>(
    `SELECT l.*, p.name, p.category FROM sale_lines l JOIN sales_days d ON d.date=l.date JOIN products p ON p.id=l.product_id
     WHERE d.status='onayli' AND l.date>=?`, start);
  const comm = new Map(all<{ date: string; c: number }>(
    "SELECT date, SUM(commission) AS c FROM sale_payments WHERE date>=? GROUP BY date", start).map((r) => [r.date, r.c]));
  const dayNet = new Map<string, number>();
  const netOf = (l: (typeof lines)[number]) => l.qty * l.unit_price - l.discount - l.refund;
  for (const l of lines) dayNet.set(l.date, (dayNet.get(l.date) ?? 0) + netOf(l));
  const out = new Map<number, ProductStat>();
  for (const l of lines) {
    const s = out.get(l.product_id) ?? { id: l.product_id, name: l.name, category: l.category, adet: 0, ikram: 0, net: 0, netHaric: 0,
      maliyet: 0, indirim: 0, komisyon: 0, katki: 0, marj: null };
    const net = netOf(l), dn = dayNet.get(l.date) ?? 0;
    if (l.kind === "ikram") s.ikram += l.qty; else s.adet += l.qty;
    s.net += net; s.netHaric += net - (net * l.tax_rate) / (100 + l.tax_rate);
    s.maliyet += l.qty * (l.unit_cost ?? 0); s.indirim += l.discount + l.refund;
    s.komisyon += dn > 0 ? ((comm.get(l.date) ?? 0) * net) / dn : 0;
    out.set(l.product_id, s);
  }
  for (const s of out.values()) {
    s.katki = s.netHaric - s.maliyet - s.komisyon;
    s.marj = s.netHaric > 0 ? (s.katki / s.netHaric) * 100 : null;
  }
  return [...out.values()].sort((a, b) => b.katki - a.katki);
}

export type ProductV = {
  id: number; name: string; category: string | null; price: number; tax_rate: number; packaging_cost: number; active: number;
  recipe_cost: number; missing_price: number; recipe_n: number;
};
export const products = (onlyActive = false) =>
  all<ProductV>(`SELECT p.*,
      COALESCE((SELECT SUM(r.qty*COALESCE(i.last_price,0)) FROM recipe_items r JOIN stock_items i ON i.id=r.item_id WHERE r.product_id=p.id),0) AS recipe_cost,
      (SELECT COUNT(*) FROM recipe_items r JOIN stock_items i ON i.id=r.item_id WHERE r.product_id=p.id AND i.last_price IS NULL) AS missing_price,
      (SELECT COUNT(*) FROM recipe_items r WHERE r.product_id=p.id) AS recipe_n
    FROM products p ${onlyActive ? "WHERE p.active=1" : ""} ORDER BY p.active DESC, p.category, p.name`);

/** Birim katkı: vergi hariç fiyat − reçete − ambalaj (komisyon hariç). */
export function unitMargin(p: ProductV) {
  const haric = p.price - (p.price * p.tax_rate) / (100 + p.tax_rate);
  const cost = p.recipe_cost + p.packaging_cost;
  return { haric, cost, katki: haric - cost, marj: haric > 0 ? ((haric - cost) / haric) * 100 : null };
}

export type PriceAlert = { item: string; unit: string; price: number; prev_price: number; pct: number; at: string; products: string | null };
export function priceAlerts(thresholdPct: number): PriceAlert[] {
  return all<Omit<PriceAlert, "pct">>(
    `SELECT i.name AS item, i.unit, h.price, h.prev_price, h.at,
       (SELECT GROUP_CONCAT(p.name, ', ') FROM recipe_items r JOIN products p ON p.id=r.product_id WHERE r.item_id=h.item_id AND p.active=1) AS products
     FROM item_prices h JOIN stock_items i ON i.id=h.item_id WHERE h.prev_price IS NOT NULL AND h.prev_price>0 AND h.at>=? ORDER BY h.id DESC`,
    new Date(Date.now() - 45 * 86400000).toISOString(),
  ).map((r) => ({ ...r, pct: ((r.price - r.prev_price) / r.prev_price) * 100 }))
    .filter((r) => Math.abs(r.pct) >= thresholdPct);
}
