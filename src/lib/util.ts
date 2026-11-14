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
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export function parseKurus(v: FormDataEntryValue | null): number | null {
  const n = parseNum(v);
  return n == null ? null : Math.round(n * 100);
}
export const str = (v: FormDataEntryValue | null) => (typeof v === "string" && v.trim() ? v.trim() : null);
