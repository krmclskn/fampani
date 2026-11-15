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
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, price INTEGER NOT NULL,
  tax_rate REAL NOT NULL DEFAULT 0, packaging_cost INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS recipe_items (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id),
  item_id INTEGER NOT NULL REFERENCES stock_items(id), qty REAL NOT NULL, UNIQUE(product_id, item_id)
);
CREATE TABLE IF NOT EXISTS payment_channels (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, commission_pct REAL NOT NULL DEFAULT 0,
  fixed_fee INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sales_days (
  date TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'taslak', entered_by INTEGER REFERENCES users(id),
  entered_at TEXT, approved_by INTEGER REFERENCES users(id), approved_at TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS sale_lines (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL, unit_price INTEGER NOT NULL, discount INTEGER NOT NULL DEFAULT 0, refund INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0, unit_cost INTEGER, kind TEXT NOT NULL DEFAULT 'satis', note TEXT,
  created_by INTEGER REFERENCES users(id), created_at TEXT
);
CREATE INDEX IF NOT EXISTS sale_lines_date ON sale_lines(date);
CREATE TABLE IF NOT EXISTS sale_payments (
  date TEXT NOT NULL, channel_id INTEGER NOT NULL REFERENCES payment_channels(id), amount INTEGER NOT NULL,
  commission INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(date, channel_id)
);
CREATE TABLE IF NOT EXISTS expense_categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS expense_templates (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES expense_categories(id),
  amount INTEGER NOT NULL, due_day INTEGER NOT NULL DEFAULT 1, start_period TEXT NOT NULL, end_period TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, period TEXT NOT NULL, name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES expense_categories(id), amount INTEGER NOT NULL,
  fixed INTEGER NOT NULL DEFAULT 0, supplier_id INTEGER REFERENCES suppliers(id), doc_no TEXT, due_date TEXT,
  paid_at TEXT, paid_by INTEGER REFERENCES users(id), note TEXT, template_id INTEGER REFERENCES expense_templates(id),
  created_by INTEGER REFERENCES users(id), created_at TEXT, UNIQUE(template_id, period)
);
CREATE TABLE IF NOT EXISTS waste (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, item_id INTEGER NOT NULL REFERENCES stock_items(id), qty REAL NOT NULL,
  kind TEXT NOT NULL, reason TEXT, note TEXT, unit_cost INTEGER, user_id INTEGER REFERENCES users(id), at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL, at TEXT NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL, channel_id INTEGER REFERENCES payment_channels(id), treat_by INTEGER REFERENCES users(id),
  note TEXT, total INTEGER NOT NULL DEFAULT 0, void_by INTEGER REFERENCES users(id), void_at TEXT, summary TEXT
);
CREATE INDEX IF NOT EXISTS tickets_date ON tickets(date);
CREATE TABLE IF NOT EXISTS revenue_days (
  date TEXT PRIMARY KEY, cash INTEGER NOT NULL DEFAULT 0, card INTEGER NOT NULL DEFAULT 0, note TEXT,
  user_id INTEGER REFERENCES users(id), at TEXT
);
CREATE TABLE IF NOT EXISTS revenue_lump (period TEXT PRIMARY KEY, amount INTEGER NOT NULL, user_id INTEGER REFERENCES users(id), at TEXT);
CREATE TABLE IF NOT EXISTS sup_purchases (
  id INTEGER PRIMARY KEY, supplier_id INTEGER NOT NULL REFERENCES suppliers(id), date TEXT NOT NULL, period TEXT NOT NULL,
  amount INTEGER NOT NULL, monthly INTEGER NOT NULL DEFAULT 0, doc_no TEXT, note TEXT, user_id INTEGER REFERENCES users(id), at TEXT
);
CREATE INDEX IF NOT EXISTS sup_purchases_period ON sup_purchases(period);
CREATE TABLE IF NOT EXISTS sup_purchase_lines (
  id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL REFERENCES sup_purchases(id) ON DELETE CASCADE,
  name TEXT NOT NULL, qty REAL NOT NULL, unit_price INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sup_payments (
  id INTEGER PRIMARY KEY, supplier_id INTEGER NOT NULL REFERENCES suppliers(id), date TEXT NOT NULL, amount INTEGER NOT NULL,
  note TEXT, user_id INTEGER REFERENCES users(id), at TEXT
);
CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, principal INTEGER NOT NULL, start_date TEXT NOT NULL,
  monthly_rate REAL NOT NULL DEFAULT 0, note TEXT, user_id INTEGER REFERENCES users(id), at TEXT
);
CREATE TABLE IF NOT EXISTS debt_payments (
  id INTEGER PRIMARY KEY, debt_id INTEGER NOT NULL REFERENCES debts(id), date TEXT NOT NULL, amount INTEGER NOT NULL,
  note TEXT, user_id INTEGER REFERENCES users(id), at TEXT
);
CREATE TABLE IF NOT EXISTS item_prices (
  id INTEGER PRIMARY KEY, item_id INTEGER NOT NULL REFERENCES stock_items(id), price INTEGER NOT NULL,
  prev_price INTEGER, purchase_id INTEGER REFERENCES purchases(id), at TEXT NOT NULL
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

/** Sonradan eklenen modüller için tek seferlik veri adımları (PRAGMA user_version ile izlenir). */
function migrate(d: DatabaseSync) {
  const v = (d.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (v < 1) {
    // Finans modülü: sayım uyarı eşiği %5, mutlak tolerans, fiyat uyarı eşiği, örnek ürünler.
    d.exec(`UPDATE settings SET value='5' WHERE key='count_tolerance_pct' AND value='10';
      INSERT OR IGNORE INTO settings(key,value) VALUES('count_abs_tolerance','0'),('price_alert_pct','10');
      ALTER TABLE stock_counts ADD COLUMN reason TEXT;`);
    const ins = (sql: string, ...p: P[]) => Number(d.prepare(sql).run(...p).lastInsertRowid);
    for (const c of ["Kira", "Personel ve yan giderler", "Elektrik, su, internet", "Ambalaj ve sarf", "Temizlik",
      "Bakım ve onarım", "Etkinlik ve atölye", "Pazarlama ve içerik", "Ekipman ve yatırım", "Komisyon ve banka", "Diğer"])
      ins("INSERT OR IGNORE INTO expense_categories(name) VALUES(?)", c);
    // Komisyon oranı sözleşmeye göre Finans ekranından girilmelidir.
    ins("INSERT INTO payment_channels(name) VALUES('Nakit')");
    ins("INSERT INTO payment_channels(name) VALUES('Kart (POS)')");
    // Örnek ürünler ve reçeteler: fiyat, vergi oranı ve miktarlar gerçek değildir.
    const item = (name: string) => (d.prepare("SELECT id FROM stock_items WHERE name=?").get(name) as { id: number } | undefined)?.id;
    const samples: [string, string, number, [string, number][]][] = [
      ["Espresso (örnek)", "Kahve", 9000, [["Espresso çekirdeği", 0.018]]],
      ["Latte (örnek)", "Kahve", 13000, [["Espresso çekirdeği", 0.018], ["Süt", 0.2], ["Bardak 12 oz", 1], ["Bardak kapağı", 1]]],
      ["Kurabiye (örnek)", "Mutfak", 8000, [["Un", 0.05], ["Tereyağı", 0.03], ["Yumurta", 0.25]]],
    ];
    for (const [name, cat, price, rec] of samples) {
      const pid = ins("INSERT INTO products(name,category,price,tax_rate) VALUES(?,?,?,10)", name, cat, price);
      for (const [iname, qty] of rec) {
        const iid = item(iname);
        if (iid) ins("INSERT INTO recipe_items(product_id,item_id,qty) VALUES(?,?,?)", pid, iid, qty);
      }
    }
    d.exec("PRAGMA user_version = 1");
  }
  if (v < 2) {
    // Kasa: fişe bağlı satış satırları stoğu anında düşer (consumed=1).
    d.exec(`ALTER TABLE sale_lines ADD COLUMN ticket_id INTEGER REFERENCES tickets(id);
      ALTER TABLE sale_lines ADD COLUMN consumed INTEGER NOT NULL DEFAULT 0;
      UPDATE sale_lines SET consumed=1 WHERE kind='duzeltme' OR date IN (SELECT date FROM sales_days WHERE status='onayli');
      PRAGMA user_version = 2;`);
  }
  if (v < 3) {
    // Kart komisyonu: daha önce ödeme kanalına girilmiş oran varsa onu devral.
    d.exec(`INSERT OR IGNORE INTO settings(key,value) VALUES('card_commission_pct', COALESCE((SELECT CAST(MAX(commission_pct) AS TEXT) FROM payment_channels), '0'));
      PRAGMA user_version = 3;`);
  }
  if (v < 4) {
    // KDV, gider türleri (resmi / resmi olmayan), checklist günleri ve stok görevi.
    d.exec(`ALTER TABLE expense_categories ADD COLUMN grp TEXT NOT NULL DEFAULT 'resmi';
      ALTER TABLE expense_categories ADD COLUMN official INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE expenses ADD COLUMN vat INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE expense_templates ADD COLUMN vat_rate REAL NOT NULL DEFAULT 0;
      ALTER TABLE sup_purchases ADD COLUMN vat INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sup_purchases ADD COLUMN vat_rate REAL;
      ALTER TABLE sup_purchase_lines ADD COLUMN vat_rate REAL NOT NULL DEFAULT 0;
      ALTER TABLE checklist_items ADD COLUMN days TEXT NOT NULL DEFAULT '1234567';
      ALTER TABLE checklist_items ADD COLUMN stock_item_id INTEGER REFERENCES stock_items(id);
      INSERT OR IGNORE INTO settings(key,value) VALUES('revenue_vat_pct','10'),('tax_debt_rate','3.7');
      UPDATE expense_categories SET grp='kira' WHERE name='Kira';
      UPDATE expense_categories SET name='Maaşlar (SGK''lı)', grp='maas' WHERE name='Personel ve yan giderler';
      UPDATE expense_categories SET name='Elektrik, su, doğalgaz, internet' WHERE name='Elektrik, su, internet';
      UPDATE expense_categories SET name='Banka ve POS komisyonu' WHERE name='Komisyon ve banka';
      UPDATE expense_categories SET name='Diğer (faturalı)' WHERE name='Diğer';`);
    const cat = d.prepare("INSERT OR IGNORE INTO expense_categories(name,grp,official) VALUES(?,?,?)");
    for (const [n, g, o] of [["SGK primi", "sgk", 1], ["Bağkur", "sgk", 1], ["Gelir / kurumlar vergisi", "vergi", 1],
      ["Stopaj ve diğer vergiler", "vergi", 1], ["Huzur hakkı", "resmi", 1], ["Muhasebe ve danışmanlık", "resmi", 1],
      ["SGK'sız maaş", "gayri", 0], ["Part-time maaş", "gayri", 0], ["Faturasız ödeme", "gayri", 0]] as [string, string, number][]) cat.run(n, g, o);
    // Maaş kategorisine girilmiş sigorta/SGK kayıtlarını SGK türüne taşı.
    d.exec(`UPDATE expenses SET category_id=(SELECT id FROM expense_categories WHERE name='SGK primi')
        WHERE (lower(name) LIKE '%sigorta%' OR lower(name) LIKE '%sgk%') AND category_id=(SELECT id FROM expense_categories WHERE grp='maas');
      UPDATE expense_templates SET category_id=(SELECT id FROM expense_categories WHERE name='SGK primi')
        WHERE (lower(name) LIKE '%sigorta%' OR lower(name) LIKE '%sgk%') AND category_id=(SELECT id FROM expense_categories WHERE grp='maas');`);
    // "X" ve "X-kdv" olarak ayrı girilmiş sabit giderleri tek kayıtta (KDV dahil tutar + oran) birleştir.
    const pairs = d.prepare(`SELECT a.id AS base, b.id AS kdv, a.amount AS ba, b.amount AS ka FROM expense_templates a JOIN expense_templates b
      ON b.id<>a.id AND (lower(b.name)=lower(a.name)||'-kdv' OR lower(b.name)=lower(a.name)||' kdv') AND b.start_period=a.start_period`).all() as { base: number; kdv: number; ba: number; ka: number }[];
    for (const p of pairs) {
      d.prepare("UPDATE expenses SET amount=amount+COALESCE((SELECT k.amount FROM expenses k WHERE k.template_id=? AND k.period=expenses.period),0), vat=COALESCE((SELECT k.amount FROM expenses k WHERE k.template_id=? AND k.period=expenses.period),0) WHERE template_id=?").run(p.kdv, p.kdv, p.base);
      d.prepare("DELETE FROM expenses WHERE template_id=?").run(p.kdv);
      d.prepare("DELETE FROM expense_templates WHERE id=?").run(p.kdv);
      d.prepare("UPDATE expense_templates SET amount=?, vat_rate=? WHERE id=?").run(p.ba + p.ka, Math.round((p.ka / p.ba) * 10000) / 100, p.base);
    }
    d.exec("PRAGMA user_version = 4");
  }
}

/** .env.local içinde parolası tanımlı hesapları (yoksa) oluşturur; var olan hesaba dokunmaz. */
function ensureEnvUsers(d: DatabaseSync) {
  for (const [username, name, role, env] of [
    ["admin", "Yönetici", "sahip", "ADMIN_PASSWORD"],
    ["personel", "Personel", "calisan", "PERSONEL_PASSWORD"],
  ]) {
    const pw = process.env[env];
    if (!pw || d.prepare("SELECT 1 FROM users WHERE username=?").get(username)) continue;
    d.prepare("INSERT INTO users(name,username,password_hash,role) VALUES(?,?,?,?)").run(name, username, hashPassword(pw), role);
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
      ensureEnvUsers(d);
      migrate(d);
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
  // node:sqlite satırları null prototipli döner; istemci bileşenlerine geçebilsin diye düz nesneye çevrilir.
  return db().prepare(sql).all(...p).map((r) => ({ ...r })) as T[];
}
export function get<T>(sql: string, ...p: P[]): T | undefined {
  const r = db().prepare(sql).get(...p);
  return r ? ({ ...r } as T) : undefined;
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
  const wd = String(((new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7) + 1); // 1=Pzt … 7=Paz
  run(
    `INSERT OR IGNORE INTO tasks(date,title,kind,area_id,checklist_item_id,created_at)
     SELECT ?, text, kind, area_id, id, ? FROM checklist_items WHERE active=1 AND instr(days, ?)>0`,
    date, new Date().toISOString(), wd,
  );
}

/** Stok miktarını yalnızca hareket kaydıyla değiştirir. */
export function stockMove(itemId: number, delta: number, reason: string, ref: string | null, note: string | null, userId: number) {
  run("UPDATE stock_items SET qty = qty + ? WHERE id=?", delta, itemId);
  const after = get<{ qty: number }>("SELECT qty FROM stock_items WHERE id=?", itemId)!.qty;
  run("INSERT INTO stock_movements(item_id,delta,qty_after,reason,ref,note,user_id,at) VALUES(?,?,?,?,?,?,?,?)",
    itemId, delta, after, reason, ref, note, userId, new Date().toISOString());
}

/** Sabit gider şablonlarından içinde bulunulan aya kadar eksik dönem kayıtlarını üretir. */
export function ensureRecurring() {
  const cur = todayStr().slice(0, 7);
  const tpl = all<{ id: number; name: string; category_id: number; amount: number; due_day: number; start_period: string; end_period: string | null; vat_rate: number }>(
    "SELECT * FROM expense_templates WHERE active=1");
  for (const t of tpl) {
    let [y, m] = t.start_period.split("-").map(Number);
    for (let i = 0; i < 60; i++) {
      const period = `${y}-${String(m).padStart(2, "0")}`;
      if (period > cur || (t.end_period && period > t.end_period)) break;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const due = `${period}-${String(Math.min(t.due_day, last)).padStart(2, "0")}`;
      run(`INSERT OR IGNORE INTO expenses(date,period,name,category_id,amount,vat,fixed,due_date,template_id,created_at)
           VALUES(?,?,?,?,?,?,1,?,?,?)`, due, period, t.name, t.category_id, t.amount,
        Math.round((t.amount * t.vat_rate) / (100 + t.vat_rate)), due, t.id, new Date().toISOString());
      if (++m > 12) { m = 1; y++; }
    }
  }
}
