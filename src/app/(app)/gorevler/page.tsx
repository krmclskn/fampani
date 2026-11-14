import { Submit } from "@/components/client";
import { TaskRow } from "@/components/TaskRow";
import { taskCreate } from "@/lib/actions";
import { can, requireUser, ROLE_LABEL, type User } from "@/lib/auth";
import { todayStr } from "@/lib/db";
import { activeUsers, areas, tasksWhere, type TaskV } from "@/lib/queries";

function Section({ title, list, empty, u, today }: { title: string; list: TaskV[]; empty?: string; u: User; today: string }) {
  if (!list.length && !empty) return null;
  return (
    <section className="card">
      <h2 className="h2">{title} {list.length > 0 && <span className="badge ml-1">{list.length}</span>}</h2>
      {list.length ? <ul className="mt-1">{list.map((t) => <TaskRow key={t.id} t={t} user={u} today={today} />)}</ul> : <p className="muted mt-2">{empty}</p>}
    </section>
  );
}

export default async function Gorevler() {
  const u = await requireUser();
  const today = todayStr();
  const mine = tasksWhere("t.kind='is' AND t.status='atandi' AND (t.assignee_id=? OR t.assignee_role=?)", u.id, u.role);
  const review = can.reviewTasks(u) ? tasksWhere("t.status='kontrol'") : [];
  const others = can.assignTasks(u)
    ? tasksWhere("t.kind='is' AND t.status='atandi' AND NOT (COALESCE(t.assignee_id,0)=? OR COALESCE(t.assignee_role,'')=?)", u.id, u.role)
    : [];
  const closed = tasksWhere(
    "t.kind='is' AND t.status IN ('tamamlandi','iptal','kontrol') AND substr(t.done_at,1,10)>=? AND (?=1 OR t.done_by=? OR t.created_by=?)",
    todayStr(-1), can.assignTasks(u) ? 1 : 0, u.id, u.id);

  return (
    <div className="grid gap-4">
      <h1 className="h1">Görevler</h1>
      <Section u={u} today={today} title="Bana atananlar" list={mine} empty="Açık işin yok." />
      <Section u={u} today={today} title="Kontrol bekleyenler" list={review} />
      <Section u={u} today={today} title="Diğer açık işler" list={others} />
      <Section u={u} today={today} title="Son kapananlar" list={closed} />

      <section className="card" id="yeni">
        <h2 className="h2">{can.assignTasks(u) ? "Yeni görev" : "Sorun / ihtiyaç bildir"}</h2>
        {!can.assignTasks(u) && <p className="muted">Bildirimin operasyon sorumlusuna görev olarak düşer. Stok eksikleri için Stok sayfasını kullan.</p>}
        <form action={taskCreate} className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="title">Başlık</label>
            <input id="title" name="title" className="input" required maxLength={140} />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="detail">Açıklama</label>
            <textarea id="detail" name="detail" className="input" rows={2} />
          </div>
          <div>
            <label className="label" htmlFor="area_id">Alan</label>
            <select id="area_id" name="area_id" className="input" defaultValue="">
              <option value="">Belirtilmedi</option>
              {areas().map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="priority">Öncelik</label>
            <select id="priority" name="priority" className="input">
              <option value="normal">Normal</option>
              <option value="yuksek">Yüksek</option>
            </select>
          </div>
          {can.assignTasks(u) && (
            <>
              <div>
                <label className="label" htmlFor="assignee">Sorumlu</label>
                <select id="assignee" name="assignee" className="input" required defaultValue="">
                  <option value="" disabled>Seçin</option>
                  <optgroup label="Rol">
                    {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={`rol:${k}`}>{v}</option>)}
                  </optgroup>
                  <optgroup label="Kişi">
                    {activeUsers().map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </optgroup>
                </select>
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" name="needs_review" className="size-4" /> Tamamlanınca kontrol/onay gerekir
              </label>
            </>
          )}
          <div className="sm:col-span-2"><Submit>{can.assignTasks(u) ? "Görevi aç" : "Bildir"}</Submit></div>
        </form>
      </section>
    </div>
  );
}
