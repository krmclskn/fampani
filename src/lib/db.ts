import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Veri katmanı: Postgres.
 * - DATABASE_URL varsa (Supabase) `postgres` sürücüsüyle bağlanır.
 * - Yoksa yerel geliştirme için data/pg altında gömülü Postgres (PGlite) kullanılır.
 * Sorgular SQLite dönemindeki gibi `?` yer tutucusuyla yazılır; burada `$1, $2…` biçimine çevrilir.
 */

type P = string | number | null;
type Row = Record<string, unknown>;
type Exec = { query: (text: string, params: P[]) => Promise<Row[]> };
type Driver = Exec & { begin: <T>(fn: (e: Exec) => Promise<T>) => Promise<T> };

const g = globalThis as unknown as { __fampaniDriver?: Promise<Driver> };
const als = new AsyncLocalStorage<Exec>();

export const schemaSql = () => fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");

async function connect(): Promise<Driver> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    // bigint (sayımlar, kuruş tutarları) ve numeric (SUM sonuçları) JS sayısı olarak gelsin.
    const num = { serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) };
    const sql = postgres(url, {
      prepare: false, // Supabase transaction pooler hazır ifadeleri desteklemez
      max: 5, idle_timeout: 20, connect_timeout: 15,
      types: { int8: { to: 20, from: [20], ...num }, numeric: { to: 1700, from: [1700], ...num } },
    });
    const wrap = (s: { unsafe: (q: string, p: never[]) => PromiseLike<unknown> }): Exec => ({
      query: async (q, p) => (await s.unsafe(q, p as never[])) as Row[],
    });
    return {
      ...wrap(sql),
      begin: <T,>(fn: (e: Exec) => Promise<T>) => sql.begin((t) => fn(wrap(t))) as Promise<T>,
    };
  }
  // Sunucuda (Vercel) gömülü veritabanına düşülmez: adres tanımlı değilse açıkça hata ver.
  if (process.env.VERCEL || process.env.NODE_ENV === "production") throw new Error("DATABASE_URL tanımlı değil");
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = path.join(process.cwd(), "data", "pg");
  fs.mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir, { parsers: { 20: (x: string) => Number(x), 1700: (x: string) => Number(x) } });
  await pg.exec(schemaSql());
  const wrap = (s: { query: (q: string, p: P[]) => Promise<{ rows: unknown[] }> }): Exec => ({
    query: async (q, p) => (await s.query(q, p)).rows as Row[],
  });
  return { ...wrap(pg), begin: <T,>(fn: (e: Exec) => Promise<T>) => pg.transaction((t) => fn(wrap(t))) };
}

function driver(): Promise<Driver> {
  if (!g.__fampaniDriver) g.__fampaniDriver = connect().catch((e) => { g.__fampaniDriver = undefined; throw e; });
  return g.__fampaniDriver;
}

const converted = new Map<string, string>();
/** `?` ve `?1` yer tutucularını `$n` biçimine çevirir; tırnak içindekilere dokunmaz. */
function toPg(sql: string): string {
  let out = converted.get(sql);
  if (out !== undefined) return out;
  out = "";
  let n = 0, quoted = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") quoted = !quoted;
    if (ch === "?" && !quoted) {
      let j = i + 1;
      while (j < sql.length && sql[j] >= "0" && sql[j] <= "9") j++;
      out += "$" + (j > i + 1 ? sql.slice(i + 1, j) : String(++n));
      i = j - 1;
      continue;
    }
    out += ch;
  }
  converted.set(sql, out);
  return out;
}

async function q(sql: string, p: P[]): Promise<Row[]> {
  const ex = als.getStore() ?? (await driver());
  return ex.query(toPg(sql), p);
}

export async function all<T>(sql: string, ...p: P[]): Promise<T[]> {
  return (await q(sql, p)).map((r) => ({ ...r })) as T[];
}
export async function get<T>(sql: string, ...p: P[]): Promise<T | undefined> {
  const r = (await q(sql, p))[0];
  return r ? ({ ...r } as T) : undefined;
}

const NO_ID = new Set(["settings", "sessions", "sales_days", "sale_payments", "day_closings", "revenue_days", "revenue_lump"]);
/** Yazma sorgusu. `id` sütunu olan tabloya INSERT yapılırsa yeni kaydın id'sini döner. */
export async function run(sql: string, ...p: P[]): Promise<number> {
  const m = /^\s*insert\s+into\s+(\w+)/i.exec(sql);
  if (m && !NO_ID.has(m[1].toLowerCase()) && !/\breturning\b/i.test(sql)) {
    const rows = await q(`${sql} RETURNING id`, p);
    return Number(rows[0]?.id ?? 0);
  }
  await q(sql, p);
  return 0;
}

/** İçindeki tüm sorgular tek işlemde çalışır; hata olursa hepsi geri alınır. */
export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  if (als.getStore()) return fn();
  const d = await driver();
  return d.begin((e) => als.run(e, fn));
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return salt.toString("hex") + ":" + scryptSync(pw, salt, 64).toString("hex");
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [s, h] = stored.split(":");
  if (!s || !h) return false;
  const a = scryptSync(pw, Buffer.from(s, "hex"), 64);
  const b = Buffer.from(h, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function todayStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Istanbul" }).format(d);
}

export async function setting(key: string): Promise<string> {
  return (await get<{ value: string }>("SELECT value FROM settings WHERE key=?", key))?.value ?? "";
}

export async function audit(userId: number | null, action: string, entity?: string, entityId?: number, detail?: string) {
  await run("INSERT INTO audit_log(user_id,action,entity,entity_id,detail,at) VALUES(?,?,?,?,?,?)",
    userId, action, entity ?? null, entityId ?? null, detail ?? null, new Date().toISOString());
}

/** O günün kontrol listesi görevlerini şablondan üretir (tekrar çağrılabilir). */
export async function ensureDay(date: string) {
  const wd = String(((new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7) + 1); // 1=Pzt … 7=Paz
  await run(
    `INSERT INTO tasks(date,title,kind,area_id,checklist_item_id,assignee_id,created_at)
     SELECT ?::text, text, kind, area_id, id, assignee_id, ?::text FROM checklist_items WHERE active=1 AND strpos(days, ?::text)>0
     ON CONFLICT DO NOTHING`,
    date, new Date().toISOString(), wd,
  );
}

/** Stok miktarını yalnızca hareket kaydıyla değiştirir. */
export async function stockMove(itemId: number, delta: number, reason: string, ref: string | null, note: string | null, userId: number) {
  const after = (await get<{ qty: number }>("UPDATE stock_items SET qty = qty + ? WHERE id=? RETURNING qty", delta, itemId))!.qty;
  await run("INSERT INTO stock_movements(item_id,delta,qty_after,reason,ref,note,user_id,at) VALUES(?,?,?,?,?,?,?,?)",
    itemId, delta, after, reason, ref, note, userId, new Date().toISOString());
}

/** Sabit gider şablonlarından içinde bulunulan aya kadar eksik dönem kayıtlarını üretir. */
export async function ensureRecurring() {
  const cur = todayStr().slice(0, 7);
  const tpl = await all<{ id: number; name: string; category_id: number; amount: number; due_day: number; start_period: string; end_period: string | null; vat_rate: number; vat_amount: number | null }>(
    "SELECT * FROM expense_templates WHERE active=1");
  if (!tpl.length) return;
  const have = new Set((await all<{ k: string }>(
    "SELECT template_id || '|' || period AS k FROM expenses WHERE template_id IS NOT NULL")).map((r) => r.k));
  for (const t of tpl) {
    let [y, m] = t.start_period.split("-").map(Number);
    for (let i = 0; i < 60; i++) {
      const period = `${y}-${String(m).padStart(2, "0")}`;
      if (period > cur || (t.end_period && period > t.end_period)) break;
      if (!have.has(`${t.id}|${period}`)) {
        const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const due = `${period}-${String(Math.min(t.due_day, last)).padStart(2, "0")}`;
        await run(`INSERT INTO expenses(date,period,name,category_id,amount,vat,fixed,due_date,template_id,created_at)
             VALUES(?,?,?,?,?,?,1,?,?,?) ON CONFLICT DO NOTHING`, due, period, t.name, t.category_id, t.amount,
          t.vat_amount ?? Math.round((t.amount * t.vat_rate) / (100 + t.vat_rate)), due, t.id, new Date().toISOString());
      }
      if (++m > 12) { m = 1; y++; }
    }
  }
}

const OPEN_ORDER = "('talep','onay_bekliyor','onaylandi','siparis','eksik_teslim')";

/**
 * Stok minimumun altına inen kalemler için kendiliğinden sipariş talebi açar;
 * sipariş verilmeden stok yeniden minimuma çıktıysa talebi kapatır.
 */
export async function ensureStockRequests(userId: number) {
  const now = new Date().toISOString();
  await run(`UPDATE purchases SET status='reddedildi', decision_note='Stok yeniden yeterli', decided_at=?
       WHERE status='talep' AND item_id IN (SELECT id FROM stock_items WHERE qty >= min_level)`, now);
  await run(`INSERT INTO purchases(item_id,qty_requested,observed_qty,note,requested_by,requested_at)
       SELECT i.id, GREATEST(i.min_level*2 - i.qty, 1), i.qty, 'Otomatik: stok minimumun altında', ?::bigint, ?::text
       FROM stock_items i WHERE i.active=1 AND i.min_level>0 AND i.qty < i.min_level
         AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.item_id=i.id AND p.status IN ${OPEN_ORDER})`, userId, now);
}
