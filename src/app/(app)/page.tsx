import Link from "next/link";
import { TaskRow } from "@/components/TaskRow";
import { requireUser } from "@/lib/auth";
import { all, ensureDay, todayStr } from "@/lib/db";
import { tasksWhere } from "@/lib/queries";
import { fmtDate } from "@/lib/util";

export default async function Bugun() {
  const u = await requireUser();
  const today = todayStr();
  await ensureDay(today);
  const lists = await all<{ kind: string; area: string; total: number; done: number; blocked: number }>(
    `SELECT t.kind, a.name AS area, COUNT(*) AS total, SUM((t.status IN ('tamamlandi','kontrol'))::int) AS done, SUM((t.status='engellendi')::int) AS blocked
     FROM tasks t JOIN areas a ON a.id=t.area_id WHERE t.date=? AND t.kind<>'is' GROUP BY t.kind, a.id, a.name ORDER BY t.kind, a.id`, today);
  const mine = await tasksWhere("t.status='atandi' AND ((t.kind='is' AND (t.assignee_id=?1 OR t.assignee2_id=?1 OR t.assignee_role=?2)) OR (t.kind<>'is' AND t.date=?3 AND t.assignee_id=?1))", u.id, u.role, today);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="h1">{fmtDate(today)}</h1>
        <p className="muted">Merhaba {u.name.split(" ")[0]}. Bugünkü listeler ve sana atanan işler aşağıda.</p>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        {(["acilis", "gunici", "kapanis"] as const).filter((k) => k !== "gunici" || lists.some((l) => l.kind === k)).map((k) => (
          <Link key={k} href={`/kontrol?tur=${k}`} className="card block hover:border-accent">
            <h2 className="h2">{k === "acilis" ? "Açılış listesi" : k === "gunici" ? "Gün içi işler" : "Kapanış listesi"}</h2>
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
          <h2 className="h2">Bana atanan işler</h2>
        </div>
        {mine.length ? (
          <ul className="mt-1">{mine.map((t) => <TaskRow key={t.id} t={t} user={u} today={today} />)}</ul>
        ) : (
          <p className="muted mt-2">Sana özel atanmış açık iş yok. Herkesin yaptığı işler yukarıdaki listelerde.</p>
        )}
      </section>

      <section className="flex flex-wrap gap-2">
        <Link href="/stok" className="btn">Stok say</Link>
        <Link href="/gorevler" className="btn">Yapılacaklar</Link>
      </section>
    </div>
  );
}
