import { redirect } from "next/navigation";
import { Submit } from "@/components/client";
import { passwordChange, settingsSave, userCreate, userUpdate } from "@/lib/actions";
import { can, requireUser, ROLE_LABEL, type Role } from "@/lib/auth";
import { all, setting } from "@/lib/db";

export default async function Ayarlar() {
  const u = await requireUser();
  if (!can.manage(u)) redirect("/");
  const users = all<{ id: number; name: string; username: string; role: Role; active: number }>("SELECT id,name,username,role,active FROM users ORDER BY active DESC, name");
  const roles = Object.entries(ROLE_LABEL).filter(([k]) => k !== "sahip" || u.role === "sahip");
  const owner = u.role === "sahip";

  return (
    <div className="grid gap-4">
      <h1 className="h1">Ayarlar</h1>

      <section className="card">
        <h2 className="h2">İşletme kuralları</h2>
        <form action={settingsSave} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2">
            <label className="label" htmlFor="purchase_limit">Operasyon sorumlusu onay limiti (TL)</label>
            <input id="purchase_limit" name="purchase_limit" inputMode="decimal" className="input" defaultValue={String(Number(setting("purchase_limit")) / 100).replace(".", ",")} readOnly={!owner} required />
            <p className="muted mt-1">Bu tutarın üzerindeki satın almaları yalnızca işletme sahibi onaylar.</p>
          </div>
          <div className="col-span-2">
            <label className="label" htmlFor="count_tolerance_pct">Sayım farkı toleransı (%)</label>
            <input id="count_tolerance_pct" name="count_tolerance_pct" inputMode="decimal" className="input" defaultValue={setting("count_tolerance_pct")} required />
            <p className="muted mt-1">Daha büyük farklar yönetici onayı ister.</p>
          </div>
          <div><label className="label" htmlFor="open_time">Açılış</label><input id="open_time" type="time" name="open_time" className="input" defaultValue={setting("open_time")} required /></div>
          <div><label className="label" htmlFor="close_time">Kapanış</label><input id="close_time" type="time" name="close_time" className="input" defaultValue={setting("close_time")} required /></div>
          <div className="col-span-2 self-end"><Submit>Kaydet</Submit></div>
        </form>
      </section>

      <section className="card">
        <h2 className="h2">Kişiler ve roller</h2>
        <ul className="mt-1">
          {users.map((p) => {
            const locked = (p.role === "sahip" && !owner) || p.id === u.id;
            return (
              <li key={p.id} className="border-b border-line py-3 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={p.active ? "" : "text-muted line-through"}>
                    <b className="font-medium">{p.name}</b> <span className="text-muted">@{p.username}</span>
                  </span>
                  <span className="badge">{ROLE_LABEL[p.role]}{p.active ? "" : " · pasif"}</span>
                </div>
                {!locked && (
                  <details className="mt-1">
                    <summary className="text-sm font-medium text-muted underline underline-offset-2">Düzenle</summary>
                    <div className="mt-2 flex flex-wrap items-end gap-3 rounded-lg bg-bg p-3">
                      <form action={userUpdate} className="flex items-end gap-2">
                        <input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="rol" />
                        <div><label className="label" htmlFor={`role${p.id}`}>Rol</label>
                          <select id={`role${p.id}`} name="role" className="input" defaultValue={p.role}>{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                        <Submit className="btn">Rolü kaydet</Submit>
                      </form>
                      <form action={passwordChange} className="flex items-end gap-2">
                        <input type="hidden" name="id" value={p.id} />
                        <div><label className="label" htmlFor={`pw${p.id}`}>Yeni parola</label><input id={`pw${p.id}`} name="password" type="password" className="input" minLength={8} autoComplete="new-password" required /></div>
                        <Submit className="btn">Parolayı sıfırla</Submit>
                      </form>
                      <form action={userUpdate}>
                        <input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="durum" />
                        <Submit className={`btn ${p.active ? "btn-danger" : ""}`}>{p.active ? "Pasifleştir" : "Etkinleştir"}</Submit>
                      </form>
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h2 className="h2">Yeni kişi</h2>
        <form action={userCreate} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><label className="label" htmlFor="name">Ad soyad</label><input id="name" name="name" className="input" required /></div>
          <div><label className="label" htmlFor="username">Kullanıcı adı</label><input id="username" name="username" className="input" autoCapitalize="none" pattern="[a-z0-9._\-]{3,30}" required /></div>
          <div><label className="label" htmlFor="role">Rol</label>
            <select id="role" name="role" className="input" defaultValue="calisan">{roles.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div><label className="label" htmlFor="password">Başlangıç parolası</label><input id="password" name="password" type="password" className="input" minLength={8} autoComplete="new-password" required /></div>
          <div className="col-span-2"><Submit>Kişiyi ekle</Submit></div>
        </form>
      </section>
    </div>
  );
}
