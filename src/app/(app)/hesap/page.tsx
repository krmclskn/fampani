import { Submit } from "@/components/client";
import { logout, passwordChange } from "@/lib/actions";
import { requireUser, ROLE_LABEL } from "@/lib/auth";

export default async function Hesap() {
  const u = await requireUser();
  return (
    <div className="grid max-w-md gap-4">
      <div>
        <h1 className="h1">{u.name}</h1>
        <p className="muted">@{u.username} · {ROLE_LABEL[u.role]}</p>
      </div>
      <section className="card">
        <h2 className="h2">Parola değiştir</h2>
        <form action={passwordChange} className="mt-3 grid gap-3">
          <div><label className="label" htmlFor="current">Mevcut parola</label><input id="current" name="current" type="password" className="input" autoComplete="current-password" required /></div>
          <div><label className="label" htmlFor="password">Yeni parola (en az 8 karakter)</label><input id="password" name="password" type="password" className="input" minLength={8} autoComplete="new-password" required /></div>
          <Submit>Parolayı güncelle</Submit>
        </form>
      </section>
      <form action={logout}><Submit className="btn">Çıkış yap</Submit></form>
    </div>
  );
}
