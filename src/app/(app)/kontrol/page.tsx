import Link from "next/link";
import { Fold } from "@/components/client";
import { TaskRow } from "@/components/TaskRow";
import { can, requireUser } from "@/lib/auth";
import { ensureDay, todayStr } from "@/lib/db";
import { tasksWhere } from "@/lib/queries";
import { fmtDate } from "@/lib/util";

export default async function Kontrol({ searchParams }: { searchParams: Promise<{ tur?: string }> }) {
  const u = await requireUser();
  const t = (await searchParams).tur;
  const tur = t === "kapanis" || t === "gunici" ? t : "acilis";
  const today = todayStr();
  await ensureDay(today);
  const tasks = await tasksWhere("t.date=? AND t.kind=?", today, tur);
  const byArea = new Map<string, typeof tasks>();
  for (const t of tasks) byArea.set(t.area ?? "Genel", [...(byArea.get(t.area ?? "Genel") ?? []), t]);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Kontrol listeleri</h1>
        <p className="muted">{fmtDate(today)} · Yapılamayan iş “tamamlandı” işaretlenmez; nedeniyle kapatılır.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["acilis", "gunici", "kapanis"] as const).map((k) => (
          <Link key={k} href={`/kontrol?tur=${k}`} className={`btn ${tur === k ? "btn-primary" : ""}`} aria-current={tur === k ? "page" : undefined}>
            {k === "acilis" ? "Açılış" : k === "gunici" ? "Gün içi" : "Kapanış"}
          </Link>
        ))}
        {can.manage(u) && <Link href="/kontrol/duzenle" className="btn ml-auto">Listeyi düzenle</Link>}
      </div>
      {!tasks.length && <p className="card muted">Bugün bu listede madde yok.</p>}
      {[...byArea].map(([area, list]) => {
        const closed = list.filter((t) => t.status !== "atandi").length;
        return (
          <Fold key={area} id={`kontrol:${tur}:${area}`} title={area} defaultOpen={closed < list.length}
            meta={<span className={`badge ${closed === list.length ? "badge-ok" : ""}`}>{closed === list.length ? "✓ bitti" : `${closed}/${list.length}`}</span>}>
            <ul>{list.map((t) => <TaskRow key={t.id} t={t} user={u} today={today} />)}</ul>
          </Fold>
        );
      })}
    </div>
  );
}
