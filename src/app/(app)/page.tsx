import Link from "next/link";
import { TaskRow } from "@/components/TaskRow";
import { requireUser } from "@/lib/auth";
import { all, ensureDay, get, todayStr } from "@/lib/db";
import { tasksWhere } from "@/lib/queries";
import { fmtDate, fmtDateTime } from "@/lib/util";

export default async function Bugun() {
  const u = await requireUser();
  const today = todayStr();
  ensureDay(today);
  const closed = get<{ closed_at: string }>("SELECT closed_at FROM day_closings WHERE date=?", today);
  const shifts = all<{ start: string; end: string; area: string; is_lead: number }>(
    "SELECT s.start,s.end,s.is_lead,a.name AS area FROM shifts s JOIN areas a ON a.id=s.area_id WHERE s.date=? AND s.user_id=? ORDER BY s.start", today, u.id);
  const lists = all<{ kind: string; area: string; total: number; done: number; blocked: number }>(
    `SELECT t.kind, a.name AS area, COUNT(*) AS total, SUM(t.status IN ('tamamlandi','kontrol')) AS done, SUM(t.status='engellendi') AS blocked
     FROM tasks t JOIN areas a ON a.id=t.area_id WHERE t.date=? AND t.kind<>'is' GROUP BY t.kind, t.area_id ORDER BY t.kind, t.area_id`, today);
  const mine = tasksWhere("t.kind='is' AND t.status='atandi' AND (t.assignee_id=? OR t.assignee_role=?)", u.id, u.role);
  const handovers = all<{ id: number; area: string; name: string; created_at: string }>(
    `SELECT h.id, a.name AS area, us.name, h.created_at FROM handovers h JOIN areas a ON a.id=h.area_id JOIN users us ON us.id=h.from_user
     WHERE h.accepted_at IS NULL AND h.from_user<>?`, u.id);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="h1">{fmtDate(today)}</h1>
        <p className="muted">
          {closed ? `İşletme ${fmtDateTime(closed.closed_at)} itibarıyla kapandı.` : "İşletme açık."}{" "}
          {shifts.length
            ? "Vardiyan: " + shifts.map((s) => `${s.area} ${s.start}–${s.end}${s.is_lead ? " (sorumlu)" : ""}`).join(", ")
            : "Bugün için planlı vardiyan yok."}
        </p>
      </div>

      {handovers.length > 0 && (
        <section className="card border-[#f0d6a8] bg-[#fdf6e7]">
          <h2 className="h2">Teslim alınmayı bekleyen devir</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {handovers.map((h) => (
              <li key={h.id}>{h.area} · {h.name}, {fmtDateTime(h.created_at)}</li>
            ))}
          </ul>
          <Link href="/devir" className="btn btn-sm mt-3">Devri incele ve teslim al</Link>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        {(["acilis", "kapanis"] as const).map((k) => (
          <Link key={k} href={`/kontrol?tur=${k}`} className="card block hover:border-accent">
            <h2 className="h2">{k === "acilis" ? "Açılış kontrol listeleri" : "Kapanış kontrol listeleri"}</h2>
            <ul className="mt-2 grid gap-1.5 text-sm">
              {lists.filter((l) => l.kind === k).map((l) => (
                <li key={l.area} className="flex items-center justify-between gap-2">
                  <span>{l.area}</span>
                  <span className="flex items-center gap-2">
                    {l.blocked > 0 && <span className="badge badge-bad">{l.blocked} istisna</span>}
                    <span className={`badge ${l.done + l.blocked === l.total ? "badge-ok" : ""}`}>{l.done}/{l.total}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Link>
        ))}
      </section>

      <section className="card">
        <div className="flex items-center justify-between gap-2">
          <h2 className="h2">Bugünkü işlerim</h2>
          <Link href="/gorevler" className="text-sm font-medium text-accent underline underline-offset-2">Tüm görevler</Link>
        </div>
        {mine.length ? (
          <ul className="mt-1">{mine.map((t) => <TaskRow key={t.id} t={t} user={u} today={today} />)}</ul>
        ) : (
          <p className="muted mt-2">Sana atanmış açık iş yok. Kontrol listeleri yukarıda.</p>
        )}
      </section>

      <section className="flex flex-wrap gap-2">
        <Link href="/stok" className="btn">Eksik bildir / stok say</Link>
        <Link href="/gorevler#yeni" className="btn">Sorun bildir</Link>
        <Link href="/devir" className="btn">Vardiya devret</Link>
      </section>
    </div>
  );
}
