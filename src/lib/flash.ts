import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

/**
 * İşlem sonucunu bildirir. Sayfaya yönlendirme yapılmaz (sayfa en üste kaymasın):
 * mesaj kısa ömürlü bir çereze yazılır, sayfa yerinde yenilenir ve Flash bileşeni mesajı gösterip çerezi siler.
 */
async function back(kind: "ok" | "hata", msg: string): Promise<void> {
  try {
    (await cookies()).set("flash", encodeURIComponent(JSON.stringify({ kind, msg, t: Date.now() })), {
      path: "/", maxAge: 60, sameSite: "lax", httpOnly: false,
    });
  } catch {}
  revalidatePath("/", "layout");
}
export const fail = (msg: string) => back("hata", msg);
export const ok = (msg: string) => back("ok", msg);
