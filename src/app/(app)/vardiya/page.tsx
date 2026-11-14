import Link from "next/link";
import { Submit } from "@/components/client";
import { shiftAdd, shiftDelete } from "@/lib/actions";
import { can, requireUser } from "@/lib/auth";
import { all, setting, todayStr } from "@/lib/db";
import { activeUsers, areas, gaps } from "@/lib/queries";
import { fmtDate } from "@/lib/util";

type S = { id: number; date: string; start: string; end: string; is_lead: number; area_id: number; area: string; name: string; user_id: number };

export default async function Vardiya({ searchParams }: { searchParams: Promise<{ hafta?: string }> }) {
  const u = await requireUser();
  const week = Math.max(-8, Math.min(8, Number((await searchParams).hafta) || 0));
  const days = Array.from({ length: 7 }, (_, i) => todayStr(week * 7 + i));
  const shifts = all<S>(
    `SELECT s.*, a.name AS area, us.name FROM shifts s JOIN areas a ON a.id=s.area_id JOIN users us ON us.id=s.user_id
     WHERE s.date BETWEEN ? AND ? ORDER BY s.date, s.area_id, s.start`, days[0], days[6]);
  const open = setting("open_time"), close = setting("close_time");
  const ar = areas(), plan = can.planShifts(u);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="h1">Vardiya planı</h1>
          <p className="muted">Çalışma saatleri {open}–{close}. Bar ve mutfakta kapsanmayan saatler işaretlenir.</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/vardiya?hafta=${week - 1}`} className="btn btn-sm">← Önceki 7 gün</Link>
          {week !== 0 && <Link href="/vardiya" className="btn btn-sm">Bugün</Link>}
          <Link href={`/vardiya?hafta=${week + 1}`} className="btn btn-sm">Sonraki 7 gün →</Link>
        </div>
      </div>

      {days.map((d) => {
        const day = shifts.filter((s) => s.date === d);
        const warn = ar.filter((a) => a.needs_cover)
          .map((a) => ({ a: a.name, g: gaps(day.filter((s) => s.area_id === a.id), open, close) }))
          .filter((x) => x.g.length);
        return (
          <section key={d} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="h2">{fmtDate(d)}{d === todayStr() && <span className="badge badge-ok ml-2">Bugün</span>}</h2>
              {warn.map((w) => <span key={w.a} className="badge badge-warn">{w.a} boş: {w.g.join(", ")}</span>)}
            </div>
            {day.length ? (
              <ul className="mt-2 grid gap-1.5 text-sm">
                {day.map((s) => (
                  <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 ${s.user_id === u.id ? "bg-[#dcefe9]" : ""}`}>
                    <span>
                      <span className="inline-block w-24 font-medium tabular-nums">{s.start}–{s.end}</span>
                      <span className="inline-block w-20 text-muted">{s.area}</span>
                      {s.name}{s.is_lead ? <span className="badge ml-2">Vardiya sorumlusu</span> : null}
                    </span>
                    {plan && (
                      <form action={shiftDelete}>
                        <input type="hidden" name="id" value={s.id} />
                        <Submit className="btn btn-sm btn-danger">Sil</Submit>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="muted mt-2">Planlı vardiya yok.</p>}
          </section>
        );
      })}

      {plan && (
        <section className="card">
          <h2 className="h2">Vardiya ekle</h2>
          <form action={shiftAdd} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div><label className="label" htmlFor="date">Tarih</label><input id="date" type="date" name="date" className="input" defaultValue={days[0]} required /></div>
            <div><label className="label" htmlFor="start">Başlangıç</label><input id="start" type="time" name="start" className="input" defaultValue={open} required /></div>
            <div><label className="label" htmlFor="end">Bitiş</label><input id="end" type="time" name="end" className="input" defaultValue="15:00" required /></div>
            <div><label className="label" htmlFor="area_id">Alan</label>
              <select id="area_id" name="area_id" className="input">{ar.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <div><label className="label" htmlFor="user_id">Kişi</label>
              <select id="user_id" name="user_id" className="input">{activeUsers().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="is_lead" className="size-4" /> Vardiya sorumlusu</label>
            <div className="col-span-2 sm:col-span-3"><Submit>Vardiyayı ekle</Submit></div>
          </form>
        </section>
      )}
    </div>
  );
}
