import { get } from "@/lib/db";

/** Sağlık kontrolü: veritabanına ulaşılıyor mu? Gizli bilgi döndürmez. */
export async function GET() {
  try {
    const r = await get<{ users: number }>("SELECT COUNT(*) AS users FROM users WHERE active=1");
    return Response.json({ veritabani: "bagli", aktif_kisi: r?.users ?? 0 }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    const m = (e as Error).message;
    const neden = /DATABASE_URL/.test(m) ? "DATABASE_URL tanımlı değil"
      : /password|authentication/i.test(m) ? "veritabanı parolası hatalı"
      : /relation .* does not exist/i.test(m) ? "tablolar yok (şema kurulmamış)"
      : "bağlantı kurulamadı";
    return Response.json({ veritabani: "hata", neden }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
