import { DatabaseSync } from "node:sqlite";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type P = string | number | null;

const g = globalThis as unknown as { __fampaniDb?: DatabaseSync };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS areas (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, needs_cover INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, area_id INTEGER NOT NULL REFERENCES areas(id),
  user_id INTEGER NOT NULL REFERENCES users(id), start TEXT NOT NULL, end TEXT NOT NULL,
  is_lead INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS shifts_date ON shifts(date);
CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, area_id INTEGER NOT NULL REFERENCES areas(id),
  text TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, title TEXT NOT NULL, detail TEXT,
  kind TEXT NOT NULL DEFAULT 'is', area_id INTEGER REFERENCES areas(id),
  assignee_id INTEGER REFERENCES users(id), assignee_role TEXT,
  priority TEXT NOT NULL DEFAULT 'normal', status TEXT NOT NULL DEFAULT 'atandi',
  needs_review INTEGER NOT NULL DEFAULT 0, exception_reason TEXT, note TEXT,
  checklist_item_id INTEGER REFERENCES checklist_items(id), source TEXT,
  created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL,
  done_by INTEGER REFERENCES users(id), done_at TEXT, reviewed_by INTEGER REFERENCES users(id),
  UNIQUE(date, checklist_item_id)
);
CREATE INDEX IF NOT EXISTS tasks_date ON tasks(date);
CREATE TABLE IF NOT EXISTS handovers (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, area_id INTEGER NOT NULL REFERENCES areas(id),
  from_user INTEGER NOT NULL REFERENCES users(id), cash_status TEXT, stock_notes TEXT,
  pending_work TEXT, issues TEXT, deliveries TEXT, upcoming TEXT, note TEXT,
  created_at TEXT NOT NULL, accepted_by INTEGER REFERENCES users(id), accepted_at TEXT
);
CREATE TABLE IF NOT EXISTS day_closings (
  date TEXT PRIMARY KEY, closed_by INTEGER NOT NULL REFERENCES users(id), closed_at TEXT NOT NULL,
  cash_total INTEGER, pos_total INTEGER, cash_diff_note TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact TEXT, delivery_days TEXT, payment_terms TEXT
);
CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, unit TEXT NOT NULL, location TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0, min_level REAL NOT NULL DEFAULT 0, critical_level REAL NOT NULL DEFAULT 0,
  supplier_id INTEGER REFERENCES suppliers(id), last_price INTEGER, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES stock_items(id), delta REAL NOT NULL,
  qty_after REAL NOT NULL, reason TEXT NOT NULL, ref TEXT, note TEXT,
  user_id INTEGER REFERENCES users(id), at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_counts (
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES stock_items(id), previous REAL NOT NULL,
  counted REAL NOT NULL, note TEXT, status TEXT NOT NULL, counted_by INTEGER NOT NULL REFERENCES users(id),
  counted_at TEXT NOT NULL, decided_by INTEGER REFERENCES users(id), decided_at TEXT
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES stock_items(id),
  qty_requested REAL NOT NULL, observed_qty REAL, note TEXT,
  requested_by INTEGER NOT NULL REFERENCES users(id), requested_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'talep',
  supplier_id INTEGER REFERENCES suppliers(id), qty_order REAL, unit_price INTEGER,
  reviewed_by INTEGER REFERENCES users(id), reviewed_at TEXT,
  decided_by INTEGER REFERENCES users(id), decided_at TEXT, decision_note TEXT,
  ordered_by INTEGER REFERENCES users(id), ordered_at TEXT, expected_date TEXT,
  received_by INTEGER REFERENCES users(id), received_at TEXT, qty_received REAL, qty_damaged REAL,
  doc_no TEXT, invoice_amount INTEGER, receive_note TEXT,
  paid_by INTEGER REFERENCES users(id), paid_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), action TEXT NOT NULL,
  entity TEXT, entity_id INTEGER, detail TEXT, at TEXT NOT NULL
);
`;

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

function seed(d: DatabaseSync) {
  const n = d.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  if (n.c > 0) return;
  let pw = process.env.SEED_PASSWORD;
  if (!pw) {
    pw = randomBytes(9).toString("base64url");
    console.log(`[fampani] SEED_PASSWORD tanımlı değil; örnek kullanıcıların başlangıç parolası: ${pw}`);
  }
  const ins = (sql: string, ...p: P[]) => Number(d.prepare(sql).run(...p).lastInsertRowid);
  const hash = hashPassword(pw);
  const u: Record<string, number> = {};
  for (const [username, name, role] of [
    ["sahip", "İşletme Sahibi", "sahip"],
    ["operasyon", "Operasyon Sorumlusu", "operasyon"],
    ["sef", "Mutfak Şefi", "sef"],
    ["stok", "Stok Sorumlusu", "stok"],
    ["bar", "Bar Sorumlusu", "bar"],
    ["calisan1", "Vardiya Çalışanı 1", "calisan"],
    ["calisan2", "Vardiya Çalışanı 2", "calisan"],
    ["mutfak1", "Mutfak Yardımcısı", "calisan"],
  ]) {
    u[username] = ins("INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,?)", name, username, hash, role);
  }

  for (const [k, v] of [
    ["purchase_limit", "500000"], // kuruş: bu tutara kadar operasyon sorumlusu onaylar
    ["count_tolerance_pct", "10"],
    ["open_time", "08:00"],
    ["close_time", "22:00"],
  ]) ins("INSERT INTO settings(key,value) VALUES(?,?)", k, v);

  const a: Record<string, number> = {};
  for (const [name, cover] of [
    ["Bar", 1], ["Mutfak", 1], ["İç Salon", 0], ["Dış Alan", 0], ["Amfi", 0], ["Atölye", 0], ["Depo", 0],
  ] as [string, number][]) a[name] = ins("INSERT INTO areas(name,needs_cover) VALUES(?,?)", name, cover);

  const lists: [string, string, string[]][] = [
    ["acilis", "Bar", [
      "Bar alanının genel temizliğini kontrol et",
      "Kahve makinesi ve ekipmanların çalışmasını kontrol et",
      "Günlük kullanılacak ürünleri hazırla",
      "Süt, kahve, şurup, bardak ve kapak gibi hızlı tüketilen kalemleri kontrol et",
      "Eksikleri miktarıyla bildir (Stok → Eksik bildir)",
      "Kasa/POS açılış durumunu kaydet",
    ]],
    ["acilis", "Mutfak", [
      "Soğuk depolama ve saklama alanlarının durumunu kontrol et",
      "Günlük üretim planını ve beklenen yoğunluğu incele",
      "Eksik hammaddeleri bildir (Stok → Eksik bildir)",
      "Hazırlık ve porsiyonlama işlerini listele",
      "Kullanılacak ekipmanların çalıştığını kontrol et",
      "Hijyen ve üretim başlangıç kontrolünü tamamla",
    ]],
    ["acilis", "İç Salon", [
      "Masa, sandalye ve servis alanlarını kontrol et",
      "Çöp kutuları, yönlendirme ve geçiş alanlarını kontrol et",
      "Etkinlik veya atölye kurulumu varsa alan takvimini kontrol et",
    ]],
    ["acilis", "Dış Alan", [
      "Dış alanın hava koşullarına uygunluğunu değerlendir",
      "Masa ve ekipman düzenini kontrol et",
      "Arıza, hasar ve güvenlik sorunlarını görev olarak aç",
    ]],
    ["kapanis", "Bar", [
      "Bar ekipmanını ve çalışma alanını temizle, kapat",
      "Kasa/POS kapanışını yap",
      "Kritik bar ürünlerini say",
    ]],
    ["kapanis", "Mutfak", [
      "Mutfak temizliğini tamamla",
      "Gıdaları uygun şekilde sakla ve etiketle",
      "Kritik mutfak ürünlerini say",
    ]],
    ["kapanis", "İç Salon", [
      "Salon düzenini topla",
      "Çöp ve atık ayrımını yap",
      "Kapı, aydınlatma ve güvenlik kontrolünü yap",
    ]],
    ["kapanis", "Dış Alan", ["Dış alan düzenini topla, ekipmanı kaldır"]],
  ];
  for (const [kind, area, items] of lists)
    items.forEach((t, i) => ins("INSERT INTO checklist_items(kind,area_id,text,position) VALUES(?,?,?,?)", kind, a[area], t, i));

  const s1 = ins("INSERT INTO suppliers(name,contact,delivery_days,payment_terms) VALUES(?,?,?,?)", "Örnek Tedarikçi A (kahve/süt)", null, "Pzt, Per", "30 gün vade");
  const s2 = ins("INSERT INTO suppliers(name,contact,delivery_days,payment_terms) VALUES(?,?,?,?)", "Örnek Tedarikçi B (ambalaj/sarf)", null, "Sal", "Peşin");
  const s3 = ins("INSERT INTO suppliers(name,contact,delivery_days,payment_terms) VALUES(?,?,?,?)", "Örnek Tedarikçi C (mutfak)", null, "Pzt, Çar, Cum", "15 gün vade");

  // Örnek stok kartları: miktarlar ve fiyatlar gerçek değildir, saha sayımıyla değiştirilmelidir.
  const items: [string, string, string, string, number, number, number, number, number][] = [
    ["Espresso çekirdeği", "Kahve", "kg", "Bar", 6, 4, 2, s1, 60000],
    ["Süt", "Süt ürünleri", "litre", "Bar", 18, 20, 10, s1, 4500],
    ["Bardak 12 oz", "Ambalaj", "adet", "Ambalaj / sarf", 350, 400, 150, s2, 250],
    ["Bardak kapağı", "Ambalaj", "adet", "Ambalaj / sarf", 900, 400, 150, s2, 120],
    ["Vanilya şurubu", "Şurup", "adet", "Bar", 3, 2, 1, s1, 32000],
    ["Un", "Kuru gıda", "kg", "Mutfak kuru depo", 25, 15, 5, s3, 3000],
    ["Tereyağı", "Süt ürünleri", "kg", "Mutfak soğuk depo", 2, 4, 2, s3, 45000],
    ["Yumurta", "Taze", "adet", "Mutfak soğuk depo", 120, 90, 30, s3, 700],
    ["Yüzey temizleyici", "Temizlik", "adet", "Temizlik malzemeleri", 4, 3, 1, s2, 15000],
  ];
  for (const it of items)
    ins("INSERT INTO stock_items(name,category,unit,location,qty,min_level,critical_level,supplier_id,last_price) VALUES(?,?,?,?,?,?,?,?,?)", ...it);

  // Örnek vardiya şablonu: bar/dış alan iki vardiya, mutfakta şef + yardımcı.
  for (let i = 0; i < 7; i++) {
    const date = todayStr(i);
    const sh = (area: string, user: string, start: string, end: string, lead = 0) =>
      ins("INSERT INTO shifts(date,area_id,user_id,start,end,is_lead) VALUES(?,?,?,?,?,?)", date, a[area], u[user], start, end, lead);
    sh("Bar", "bar", "08:00", "15:00", 1);
    sh("Bar", "calisan1", "15:00", "22:00", 1);
    sh("Dış Alan", "calisan2", "11:00", "19:00");
    sh("Mutfak", "sef", "08:00", "17:00", 1);
    sh("Mutfak", "mutfak1", "11:00", "20:00");
  }
}

export function db(): DatabaseSync {
  if (!g.__fampaniDb) {
    const dir = path.join(process.cwd(), "data");
    fs.mkdirSync(dir, { recursive: true });
    const d = new DatabaseSync(path.join(dir, "fampani.db"));
    d.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    d.exec(SCHEMA);
    d.exec("BEGIN");
    try {
      seed(d);
      d.exec("COMMIT");
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    }
    g.__fampaniDb = d;
  }
  return g.__fampaniDb;
}

export function all<T>(sql: string, ...p: P[]): T[] {
  return db().prepare(sql).all(...p) as T[];
}
export function get<T>(sql: string, ...p: P[]): T | undefined {
  return db().prepare(sql).get(...p) as T | undefined;
}
export function run(sql: string, ...p: P[]): number {
  return Number(db().prepare(sql).run(...p).lastInsertRowid);
}
export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
export function setting(key: string): string {
  return get<{ value: string }>("SELECT value FROM settings WHERE key=?", key)?.value ?? "";
}
export function audit(userId: number | null, action: string, entity?: string, entityId?: number, detail?: string) {
  run("INSERT INTO audit_log(user_id,action,entity,entity_id,detail,at) VALUES(?,?,?,?,?,?)",
    userId, action, entity ?? null, entityId ?? null, detail ?? null, new Date().toISOString());
}

/** O günün açılış/kapanış kontrol listesi görevlerini şablondan üretir (tekrar çağrılabilir). */
export function ensureDay(date: string) {
  run(
    `INSERT OR IGNORE INTO tasks(date,title,kind,area_id,checklist_item_id,created_at)
     SELECT ?, text, kind, area_id, id, ? FROM checklist_items WHERE active=1`,
    date, new Date().toISOString(),
  );
}
