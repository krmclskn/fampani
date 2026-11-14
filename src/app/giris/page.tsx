import { redirect } from "next/navigation";
import { login } from "@/lib/actions";
import { currentUser } from "@/lib/auth";
import { Submit } from "@/components/client";

export default async function Giris({ searchParams }: { searchParams: Promise<{ hata?: string }> }) {
  if (await currentUser()) redirect("/");
  const { hata } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="text-2xl font-semibold tracking-tight">Fampani</h1>
      <p className="muted mb-6">MekanSAL işletme paneli</p>
      {hata && <p role="alert" className="mb-4 rounded-lg bg-[#f8dcd9] px-4 py-3 text-sm font-medium text-bad">{hata}</p>}
      <form action={login} className="card grid gap-4">
        <div>
          <label className="label" htmlFor="username">Kullanıcı adı</label>
          <input id="username" name="username" className="input" autoComplete="username" autoCapitalize="none" required autoFocus />
        </div>
        <div>
          <label className="label" htmlFor="password">Parola</label>
          <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
        </div>
        <Submit>Giriş yap</Submit>
      </form>
    </main>
  );
}
