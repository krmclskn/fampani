export const EXCEPTION_REASONS = [
  "Eksik malzeme",
  "Ekipman arızası",
  "Personel eksikliği",
  "Alan kullanılamıyor",
  "Yönetici kararı bekliyor",
  "Güvenlik veya hijyen nedeniyle durduruldu",
] as const;

/** İstisna nedeni hangi role takip görevi açar. */
export const EXCEPTION_ROUTE: Record<string, string> = {
  "Eksik malzeme": "stok",
  "Ekipman arızası": "operasyon",
  "Personel eksikliği": "operasyon",
  "Alan kullanılamıyor": "operasyon",
  "Yönetici kararı bekliyor": "operasyon",
  "Güvenlik veya hijyen nedeniyle durduruldu": "operasyon",
};

export const TASK_STATUS: Record<string, string> = {
  atandi: "Açık",
  kontrol: "Kontrol bekliyor",
  tamamlandi: "Tamamlandı",
  engellendi: "Engellendi",
  iptal: "İptal edildi",
};

export const PURCHASE_STATUS: Record<string, string> = {
  talep: "Talep",
  onay_bekliyor: "Onay bekliyor",
  onaylandi: "Onaylandı",
  reddedildi: "Reddedildi",
  siparis: "Sipariş verildi",
  eksik_teslim: "Eksik teslim alındı",
  teslim_alindi: "Teslim alındı",
};

export const LOCATIONS = [
  "Mutfak soğuk depo", "Mutfak kuru depo", "Bar", "Ambalaj / sarf", "Temizlik malzemeleri", "Atölye malzemeleri",
];
export const UNITS = ["adet", "kg", "litre", "paket", "koli"];

const nf = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 });
export const fmtQty = (n: number | null | undefined) => (n == null ? "–" : nf.format(n));
export const fmtTL = (kurus: number | null | undefined) =>
  kurus == null ? "–" : new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(kurus / 100);

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "–";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}
export function fmtDate(date: string) {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })
    .format(new Date(date + "T00:00:00Z"));
}

/** "125,50" veya "125.50" → sayı; geçersizse null. */
export function parseNum(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  let s = v.trim().replace(/\s/g, "");
  // Türkçe yazım: nokta binlik ayırıcı, virgül ondalık ("410.000" = 410000, "1.250,50" = 1250.5).
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export function parseKurus(v: FormDataEntryValue | null): number | null {
  const n = parseNum(v);
  return n == null ? null : Math.round(n * 100);
}
export const str = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim() : null);

export const COUNT_REASONS = [
  "Satış girişi eksik", "Reçete miktarı yanlış", "Fire/ikram kaydı unutuldu", "Teslimat eksik veya yanlış girildi",
  "Sayım hatası", "Sebep bilinmiyor",
];
export const WASTE_KINDS: Record<string, string> = { fire: "Fire / zayi", ikram: "İkram", ic_kullanim: "İç kullanım" };
export const WASTE_REASONS = ["Üretim hatası", "Bozulma", "Fazla üretim", "Düşme/hasar", "İade", "Tarih aşımı", "Diğer"];
export const tlInput = (kurus: number | null | undefined) => (kurus == null ? "" : String(kurus / 100).replace(".", ","));

/** Kapalı modüller: ürün/reçete bazlı satış ve kasa. Yeniden açmak için true yapın. */
export const FEATURES = { kasa: false };

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
export const isPeriod = (s: string | null | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export function shiftPeriod(p: string, d: number) {
  const [y, m] = p.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7);
}
export const periodLabel = (p: string) => `${AYLAR[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;
export const periodShort = (p: string) => `${AYLAR[Number(p.slice(5)) - 1].slice(0, 3)} ${p.slice(2, 4)}`;
export const daysIn = (p: string) => { const [y, m] = p.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
