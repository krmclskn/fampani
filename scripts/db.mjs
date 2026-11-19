// Fampani veritabanı aracı.
//   node --env-file-if-exists=.env.local scripts/db.mjs import --from=yerel [--force]   yerel Postgres (data/pg) → DATABASE_URL
//   node --env-file-if-exists=.env.local scripts/db.mjs import --from=sqlite [--force]  eski SQLite (data/fampani.db) → Postgres
//   node --env-file-if-exists=.env.local scripts/db.mjs check              hedefteki satır sayıları
// Hedef: DATABASE_URL tanımlıysa Supabase/Postgres, değilse yerel PGlite (data/pg).
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SQLITE = path.join(ROOT, "data", "fampani.db");
const SCHEMA = fs.readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8");

// Bağımlılık sırasına göre (yabancı anahtarlar önce gelen tablolara bakar).
const TABLES = [
  "users", "sessions", "settings", "areas", "suppliers", "stock_items", "checklist_items", "shifts", "tasks", "task_participants", "handovers",
  "day_closings", "stock_movements", "stock_counts", "purchases", "audit_log", "products", "recipe_items", "payment_channels",
  "sales_days", "tickets", "sale_lines", "sale_payments", "waste", "item_prices", "expense_categories", "expense_templates",
  "expenses", "revenue_days", "revenue_lump", "sup_purchases", "sup_purchase_lines", "sup_payments", "debts", "debt_payments",
];
const RENAME = { shifts: { start: "start_time", end: "end_time" } };

async function target() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
    const host = new URL(url).host;
    return {
      name: `Postgres (${host})`,
      exec: (q) => sql.unsafe(q),
      query: (q, p = []) => sql.unsafe(q, p),
      tx: (fn) => sql.begin((t) => fn({ query: (q, p = []) => t.unsafe(q, p), exec: (q) => t.unsafe(q) })),
      end: () => sql.end(),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = path.join(ROOT, "data", "pg");
  fs.mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  const wrap = (s) => ({ query: async (q, p = []) => (await s.query(q, p)).rows, exec: (q) => s.exec(q) });
  return { name: `yerel PGlite (${dir})`, ...wrap(pg), tx: (fn) => pg.transaction((t) => fn(wrap(t))), end: () => pg.close() };
}

async function counts(db) {
  const out = {};
  for (const t of TABLES) out[t] = Number((await db.query(`SELECT COUNT(*) AS c FROM ${t}`))[0].c);
  return out;
}

/** Kaynaktan tablo satırlarını okuyan nesne: eski SQLite ya da yerel PGlite. */
async function openSource(from) {
  if (from === "sqlite") {
    if (!fs.existsSync(SQLITE)) throw new Error(`SQLite dosyası yok: ${SQLITE}`);
    const { DatabaseSync } = await import("node:sqlite");
    const src = new DatabaseSync(SQLITE, { readOnly: true });
    return { name: "eski SQLite", rows: async (t) => src.prepare(`SELECT * FROM ${t}`).all().map((r) => ({ ...r })), close: async () => src.close() };
  }
  if (from === "yerel") {
    if (!process.env.DATABASE_URL) throw new Error("Hedef yok: .env.local içinde DATABASE_URL tanımlı değil.");
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = path.join(ROOT, "data", "pg");
    if (!fs.existsSync(dir)) throw new Error(`Yerel veritabanı yok: ${dir}`);
    const pg = new PGlite(dir, { parsers: { 20: (x) => Number(x), 1700: (x) => Number(x) } });
    return { name: "yerel Postgres (data/pg)", rows: async (t) => (await pg.query(`SELECT * FROM ${t} ORDER BY 1`)).rows, close: () => pg.close() };
  }
  throw new Error("Kaynak seçin: --from=yerel ya da --from=sqlite");
}

async function importFrom(db, from, force) {
  const src = await openSource(from);
  console.log(`Kaynak: ${src.name}`);
  await db.exec(SCHEMA);
  const existing = Number((await db.query("SELECT COUNT(*) AS c FROM users"))[0].c);
  if (existing && !force) throw new Error(`Hedefte zaten ${existing} kullanıcı var. Üzerine yazmak için --force ekleyin.`);

  const source = {};
  await db.tx(async (t) => {
    if (existing) await t.exec(`TRUNCATE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    for (const table of TABLES) {
      // Eski kaynakta sonradan eklenen tablo olmayabilir.
      const rows = await src.rows(table).catch(() => []);
      source[table] = rows.length;
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const dest = cols.map((c) => RENAME[table]?.[c] ?? c);
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200), params = [];
        const values = chunk.map((r) => `(${cols.map((c) => { params.push(r[c]); return `$${params.length}`; }).join(",")})`);
        await t.query(`INSERT INTO ${table}(${dest.join(",")}) VALUES ${values.join(",")}`, params);
      }
      if (cols.includes("id"))
        await t.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), GREATEST((SELECT MAX(id) FROM ${table}), 1))`);
    }
  });
  await src.close();
  return source;
}

const [cmd, ...flags] = process.argv.slice(2);
const db = await target();
console.log(`Hedef: ${db.name}`);
try {
  if (cmd === "import") {
    const from = (flags.find((f) => f.startsWith("--from=")) ?? "").slice(7);
    const source = await importFrom(db, from, flags.includes("--force"));
    const dest = await counts(db);
    let ok = true;
    for (const t of TABLES) {
      const same = source[t] === dest[t];
      if (!same) ok = false;
      if (source[t] || dest[t]) console.log(`${same ? "✓" : "✗"} ${t.padEnd(20)} kaynak ${String(source[t]).padStart(4)}  →  hedef ${String(dest[t]).padStart(4)}`);
    }
    console.log(ok ? "\nTüm tablolar birebir taşındı." : "\nUYARI: bazı tablolarda satır sayısı tutmuyor.");
    if (!ok) process.exitCode = 1;
  } else if (cmd === "check") {
    await db.exec(SCHEMA);
    const c = await counts(db);
    for (const t of TABLES) if (c[t]) console.log(`${t.padEnd(20)} ${c[t]}`);
  } else {
    console.log("Kullanım: scripts/db.mjs import --from=yerel|sqlite [--force] | check");
    process.exitCode = 2;
  }
} catch (e) {
  console.error("HATA:", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
