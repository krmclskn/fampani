import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

/** Geldiği sayfaya mesajla döner. */
async function back(kind: "ok" | "hata", msg: string): Promise<never> {
  let target = `/?${kind}=${encodeURIComponent(msg)}`;
  try {
    const ref = (await headers()).get("referer");
    if (ref) {
      const u = new URL(ref);
      u.searchParams.delete("ok");
      u.searchParams.delete("hata");
      u.searchParams.set(kind, msg);
      target = u.pathname + "?" + u.searchParams.toString();
    }
  } catch {}
  if (kind === "ok") revalidatePath("/", "layout");
  redirect(target);
}
export const fail = (msg: string) => back("hata", msg);
export const ok = (msg: string) => back("ok", msg);
