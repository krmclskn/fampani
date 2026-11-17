import { redirect } from "next/navigation";
import { Submit } from "@/components/client";
import { passwordChange, userCreate, userUpdate } from "@/lib/actions";
import { can, requireUser, type Role } from "@/lib/auth";
import { all } from "@/lib/db";

const ROLES: [Role, string, string][] = [
  ["calisan", "Personel", "Yalnızca operasyon: kendi işleri, kontrol listeleri, stok sayımı"],
  ["sef", "Mutfak şefi", "Personel + stok ürünlerini düzenleme, teslim alma"],
  ["operasyon", "İşletmeci", "Tüm operasyon: iş atama, stok ve sipariş, kişiler. Finansı görmez"],
  ["sahip", "İşletme sahibi", "Her şey: finans paneli dahil tüm ekranlar"],
];
const label = (r: string) => ROLES.find((x) => x[0] === r)?.[1] ?? r;
type P = { id: number; name: string; username: string; role: Role; active: number; title: string | null };

export default async function Kisiler() {
  const u = await requireUser();
  if (!can.manage(u)) redirect("/");
  const owner = u.role === "sahip";
  const users = await all<P>("SELECT id,name,username,role,active,title FROM users ORDER BY role='sahip' DESC, role='operasyon' DESC, name");
  const active = users.filter((p) => p.active), gone = users.filter((p) => !p.active);
  const roles = ROLES.filter(([k]) => k !== "sahip" || owner);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Kişiler</h1>
        <p className="muted">{active.length} kişi giriş yapabiliyor. Çıkardığın kişi giriş yapamaz; geçmiş kayıtları durur.</p>
      </div>

      <form action={userCreate} className="card grid gap-3">
        <h2 className="h2">Kişi ekle</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div><label className="label" htmlFor="name">Ad soyad</label><input id="name" name="name" className="input" required /></div>
          <div><label className="label" htmlFor="title">Görevi</label><input id="title" name="title" className="input" placeholder="Örn. Barista" /></div>
          <div><label className="label" htmlFor="role">Yetki</label>
            <select id="role" name="role" className="input" defaultValue="calisan">{roles.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="label" htmlFor="username">Kullanıcı adı</label><input id="username" name="username" className="input" autoCapitalize="none" pattern="[a-z0-9._\-]{3,30}" placeholder="küçük harf" required /></div>
          <div><label className="label" htmlFor="password">İlk parola</label><input id="password" name="password" type="password" className="input" minLength={8} autoComplete="new-password" required /></div>
        </div>
        <ul className="grid gap-0.5 text-xs text-muted">{roles.map(([k, l, d]) => <li key={k}><b className="font-semibold">{l}:</b> {d}</li>)}</ul>
        <div><Submit>Kişiyi ekle</Submit></div>
      </form>

      <section className="card">
        <h2 className="h2">Ekip</h2>
        <ul className="mt-1">
          {active.map((p) => {
            const locked = (p.role === "sahip" && !owner) || p.id === u.id;
            return (
              <li key={p.id} className="border-b border-line py-3 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><b className="font-medium">{p.name}</b>{p.title ? <span className="text-muted"> · {p.title}</span> : null}<span className="block text-xs text-muted">@{p.username}{p.id === u.id ? " · sen" : ""}</span></span>
                  <span className={`badge ${p.role === "sahip" ? "badge-ok" : p.role === "operasyon" ? "badge-warn" : ""}`}>{label(p.role)}</span>
                </div>
                {!locked && (
                  <details className="mt-1">
                    <summary className="text-xs font-medium text-muted underline underline-offset-2">Düzenle / çıkar</summary>
                    <div className="mt-2 grid gap-3 rounded-lg bg-bg p-3">
                      <form action={userUpdate} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="bilgi" />
                        <div><label className="label" htmlFor={`n${p.id}`}>Ad soyad</label><input id={`n${p.id}`} name="name" className="input" defaultValue={p.name} required /></div>
                        <div><label className="label" htmlFor={`t${p.id}`}>Görevi</label><input id={`t${p.id}`} name="title" className="input" defaultValue={p.title ?? ""} /></div>
                        <Submit className="btn">Kaydet</Submit>
                      </form>
                      <div className="flex flex-wrap items-end gap-3">
                        <form action={userUpdate} className="flex items-end gap-2">
                          <input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="rol" />
                          <div><label className="label" htmlFor={`r${p.id}`}>Yetki</label>
                            <select id={`r${p.id}`} name="role" className="input" defaultValue={p.role}>
                              {roles.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                              {!roles.some(([k]) => k === p.role) && <option value={p.role}>{label(p.role)}</option>}
                            </select></div>
                          <Submit className="btn">Yetkiyi kaydet</Submit>
                        </form>
                        <form action={passwordChange} className="flex items-end gap-2">
                          <input type="hidden" name="id" value={p.id} />
                          <div><label className="label" htmlFor={`pw${p.id}`}>Yeni parola</label><input id={`pw${p.id}`} name="password" type="password" className="input" minLength={8} autoComplete="new-password" required /></div>
                          <Submit className="btn">Parolayı sıfırla</Submit>
                        </form>
                        <form action={userUpdate}>
                          <input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="durum" />
                          <Submit className="btn btn-danger">Ekipten çıkar</Submit>
                        </form>
                      </div>
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {gone.length > 0 && (
        <details className="card">
          <summary className="h2">Çıkarılanlar <span className="badge ml-1">{gone.length}</span></summary>
          <ul className="mt-2">
            {gone.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
                <span className="text-muted">{p.name} <span className="text-xs">@{p.username} · {label(p.role)}</span></span>
                {(p.role !== "sahip" || owner) && (
                  <form action={userUpdate}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="durum" /><Submit className="btn btn-sm">Yeniden ekle</Submit></form>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
