import { Fold, Submit } from "@/components/client";
import { todoAct, todoAdd, todoFinish } from "@/lib/actions";
import { can, requireUser, type User } from "@/lib/auth";
import { all, todayStr } from "@/lib/db";
import { fmtDateTime } from "@/lib/util";

/** Bir aşama (tasks satırı). İş = ilk aşama + ona bağlı devam aşamaları. */
type S = { id: number; title: string; detail: string | null; status: string; due: string | null; assignee_id: number | null;
  created_by: number | null; who: string | null; by_name: string | null; done_at: string | null; done_name: string | null;
  note: string | null; parent_id: number | null };
type Job = { stages: S[]; current: S | null; last: S };
type Person = { id: number; name: string };
type Ctx = { u: User; people: Person[]; today: string };

const dm = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}`;

function WhoSelect({ name, people, u, def, label, allowOthers }: { name: string; people: Person[]; u: User; def: string; label: string; allowOthers: boolean }) {
  return (
    <select name={name} className="input" defaultValue={def} aria-label={label}>
      <option value="ben">Bana</option>
      <option value="havuz">Sahipsiz (isteyen üstlenir)</option>
      {allowOthers && people.filter((p) => p.id !== u.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

/** İşin aşamaları: biten aşamalar notlarıyla, açık aşama vurgulu. */
function Timeline({ job, today }: { job: Job; today: string }) {
  return (
    <ol className="mt-2 grid gap-1.5 border-l-2 border-line pl-3">
      {job.stages.map((st, i) => {
        const open = st.status === "atandi", late = open && st.due && st.due < today;
        return (
          <li key={st.id} className="relative text-sm">
            <span className={`absolute -left-[19px] top-1 inline-block size-3 rounded-full border-2 ${open ? "border-accent bg-surface" : "border-accent bg-accent"}`} aria-hidden />
            <span className="text-xs font-semibold text-muted">{i + 1}. aşama{open ? " · şu an" : ""}</span>
            <p className={open ? "font-medium" : "text-muted"}>{st.title}</p>
            <p className="flex flex-wrap gap-x-2 text-xs text-muted">
              {open ? (
                <>
                  <span className={`badge ${st.who ? "badge-ok" : ""}`}>{st.who ?? "Sahipsiz"}</span>
                  {st.due && <span className={`badge ${late ? "badge-bad" : ""}`}>{late ? "Gecikti: " : "Son: "}{dm(st.due)}</span>}
                </>
              ) : <span>✓ {st.done_name ?? st.who}, {fmtDateTime(st.done_at)}</span>}
            </p>
            {st.note && <p className="mt-0.5 whitespace-pre-wrap rounded-md bg-[#dcefe9] px-2 py-1 text-xs">“{st.note}”</p>}
          </li>
        );
      })}
    </ol>
  );
}

function JobCard({ job, c }: { job: Job; c: Ctx }) {
  const { u, people, today } = c;
  const root = job.stages[0], cur = job.current, boss = can.assignTasks(u);
  const mine = cur?.assignee_id === u.id;
  const canWork = !!cur && (mine || boss || !cur.assignee_id);
  const canMove = !!cur && (boss || mine || cur.created_by === u.id);
  const canCancel = !!cur && (boss || root.created_by === u.id);
  const multi = job.stages.length > 1;
  const late = cur?.due && cur.due < today;
  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={`font-medium ${cur ? "" : "text-muted line-through"}`}>{root.title}</p>
          {root.detail && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{root.detail}</p>}
          {!multi && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {cur ? <span className={`badge ${cur.who ? "badge-ok" : ""}`}>{cur.who ?? "Sahipsiz"}</span> : null}
              {cur?.due && <span className={`badge ${late ? "badge-bad" : ""}`}>{late ? "Gecikti: " : "Son: "}{dm(cur.due)}</span>}
              {root.by_name && root.by_name !== root.who && <span>açan {root.by_name}</span>}
              {!cur && <span>✓ {job.last.done_name}, {fmtDateTime(job.last.done_at)}</span>}
            </p>
          )}
          {!multi && !cur && root.note && <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-[#dcefe9] px-2 py-1 text-sm">“{root.note}”</p>}
          {multi && <p className="mt-0.5 text-xs text-muted">{job.stages.length} aşama{root.by_name ? ` · açan ${root.by_name}` : ""}</p>}
        </div>
        <form action={todoAct} className="flex flex-wrap gap-1.5">
          <input type="hidden" name="id" value={(cur ?? job.last).id} />
          {cur && !mine && (!cur.assignee_id || boss) && <Submit className="btn btn-sm" name="op" value="ustlen">Üstlen</Submit>}
          {!cur && (job.last.assignee_id === u.id || boss) && <Submit className="btn btn-sm" name="op" value="gerial">Geri al</Submit>}
        </form>
      </div>

      {multi && <Timeline job={job} today={today} />}

      {canWork && cur && (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <details className="group">
            <summary className="btn btn-primary btn-sm group-open:hidden">✓ Tamamla</summary>
            <form action={todoFinish} className="grid gap-2 rounded-lg border border-line bg-bg p-3 sm:w-96">
              <input type="hidden" name="id" value={cur.id} />
              <label className="label" htmlFor={`t${cur.id}`}>Not (isteğe bağlı)</label>
              <textarea id={`t${cur.id}`} name="note" className="input" rows={2} placeholder="Örn. Raflar geldi, takıldı" />
              <Submit className="btn btn-primary justify-self-start">İşi tamamla</Submit>
            </form>
          </details>
          <details className="group">
            <summary className="btn btn-sm group-open:hidden">+ Devam aşaması</summary>
            <form action={todoFinish} className="grid gap-2 rounded-lg border border-line bg-bg p-3 sm:w-[30rem]">
              <input type="hidden" name="id" value={cur.id} /><input type="hidden" name="mode" value="devam" />
              <label className="label" htmlFor={`d${cur.id}`}>Bu aşamada ne oldu? (isteğe bağlı)</label>
              <textarea id={`d${cur.id}`} name="note" className="input" rows={2} placeholder="Örn. Rafçı ölçü istedi" />
              <label className="label" htmlFor={`x${cur.id}`}>Sıradaki aşama</label>
              <input id={`x${cur.id}`} name="next_title" className="input" placeholder="Örn. Raf ölçüsü verilecek" required maxLength={160} />
              <div className="grid gap-2 sm:grid-cols-2">
                <WhoSelect name="next_assignee" people={people} u={u} def="ben" label="Sıradaki aşama kimde" allowOthers />
                <input type="date" name="next_due" className="input" min={today} aria-label="Son tarih (isteğe bağlı)" title="Son tarih (isteğe bağlı)" />
              </div>
              <Submit className="btn btn-primary justify-self-start">Aşamayı ekle</Submit>
            </form>
          </details>
        </div>
      )}

      {(canMove || canCancel) && cur && (
        <details className="mt-2">
          <summary className="text-xs font-medium text-muted underline underline-offset-2">Başkasına aktar{canCancel ? " / iptal et" : ""}</summary>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {canMove && (
              <form action={todoAct} className="flex items-center gap-2">
                <input type="hidden" name="id" value={cur.id} /><input type="hidden" name="op" value="ata" />
                <select name="assignee" className="input w-48" defaultValue={cur.assignee_id ?? "havuz"} aria-label="Kime aktarılsın">
                  <option value="havuz">Sahipsiz bırak</option>
                  {(boss || mine ? people : people.filter((p) => p.id === u.id)).map((p) => <option key={p.id} value={p.id}>{p.id === u.id ? "Ben" : p.name}</option>)}
                </select>
                <Submit className="btn btn-sm">Aktar</Submit>
              </form>
            )}
            {canCancel && (
              <form action={todoAct}><input type="hidden" name="id" value={cur.id} /><Submit className="btn btn-sm btn-danger" name="op" value="sil">İşi iptal et</Submit></form>
            )}
          </div>
        </details>
      )}
    </li>
  );
}

function Column({ id, title, hint, list, c, open = true }: { id: string; title: string; hint: string; list: Job[]; c: Ctx; open?: boolean }) {
  return (
    <Fold id={`isler:${id}`} title={title} count={list.length} defaultOpen={open} className="rounded-xl bg-[#eeebe3] p-3">
      {list.length ? <ul className="grid gap-2">{list.map((j) => <JobCard key={j.stages[0].id} job={j} c={c} />)}</ul> : <p className="muted px-1">{hint}</p>}
    </Fold>
  );
}

/** Aşamaları işlere toplar: ilk aşamadan başlayıp devam aşamalarını sırayla izler. */
function buildJobs(rows: S[]): Job[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const kids = new Map<number, S[]>();
  for (const r of rows) if (r.parent_id && byId.has(r.parent_id)) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r]);
  const jobs: Job[] = [];
  for (const root of rows.filter((r) => !r.parent_id || !byId.has(r.parent_id))) {
    const stages = [root];
    for (let s = root; ; ) {
      const next = (kids.get(s.id) ?? []).sort((a, b) => a.id - b.id)[0];
      if (!next) break;
      stages.push(next); s = next;
    }
    const last = stages[stages.length - 1];
    if (last.status === "iptal") continue;
    jobs.push({ stages: stages.filter((x) => x.status !== "iptal"), current: last.status === "atandi" ? last : null, last });
  }
  return jobs;
}

export default async function Yapilacaklar() {
  const u = await requireUser();
  const today = todayStr(), boss = can.assignTasks(u);
  const people = await all<Person>("SELECT id,name FROM users WHERE active=1 ORDER BY name");
  const rows = await all<S>(
    `SELECT t.id, t.title, t.detail, t.status, t.due, t.assignee_id, t.created_by, t.done_at, t.note, t.parent_id,
       au.name AS who, cu.name AS by_name, du.name AS done_name
     FROM tasks t LEFT JOIN users au ON au.id=t.assignee_id LEFT JOIN users cu ON cu.id=t.created_by LEFT JOIN users du ON du.id=t.done_by
     WHERE t.kind='is' ORDER BY t.id`);
  const jobs = buildJobs(rows);
  const byDue = (a: Job, b: Job) => (a.current!.due ?? "9999").localeCompare(b.current!.due ?? "9999") || b.stages[0].id - a.stages[0].id;
  const open = jobs.filter((j) => j.current).sort(byDue);
  const mine = open.filter((j) => j.current!.assignee_id === u.id);
  const pool = open.filter((j) => !j.current!.assignee_id);
  const others = open.filter((j) => j.current!.assignee_id && j.current!.assignee_id !== u.id);
  const weekAgo = todayStr(-7);
  const done = jobs
    .filter((j) => !j.current && (j.last.done_at ?? "") >= weekAgo && (boss || j.stages.some((s) => s.assignee_id === u.id || s.created_by === u.id)))
    .sort((a, b) => (b.last.done_at ?? "").localeCompare(a.last.done_at ?? "")).slice(0, 20);
  const c: Ctx = { u, people, today };

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Yapılacaklar</h1>
        <p className="muted">İşi aç. Tek seferde bitiyorsa <b className="text-ink">Tamamla</b>; bitmiyorsa <b className="text-ink">+ Devam aşaması</b> ile sıradaki adımı ekle ve istersen başkasına aktar. Her aşama yine tamamlanabilir ya da devam edebilir.</p>
      </div>

      <form action={todoAdd} className="card grid gap-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_180px_160px_auto]">
          <input name="title" className="input" placeholder="Yeni iş…" aria-label="Yeni iş" required maxLength={160} />
          <WhoSelect name="assignee" people={people} u={u} def="ben" label="Kime" allowOthers={boss} />
          <input type="date" name="due" className="input" min={today} aria-label="Son tarih (isteğe bağlı)" title="Son tarih (isteğe bağlı)" />
          <Submit>İş aç</Submit>
        </div>
        <details>
          <summary className="text-xs font-medium text-muted underline underline-offset-2">Not ekle</summary>
          <textarea name="detail" className="input mt-2" rows={2} placeholder="Ayrıntı, hatırlatma…" aria-label="Not" />
        </details>
      </form>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Column id="bende" title="Bende" hint="Sende bekleyen iş yok." list={mine} c={c} />
        <Column id="sahipsiz" title="Sahipsiz" hint="Üstlenilmeyi bekleyen iş yok." list={pool} c={c} />
        <Column id="baskalari" title="Başkalarında" hint="Başkasında bekleyen iş yok." list={others} c={c} />
      </div>

      {done.length > 0 && (
        <Fold id="isler:biten" title="Son 7 günde tamamlanan işler" count={done.length}>
          <ul className="grid gap-2">{done.map((j) => <JobCard key={j.stages[0].id} job={j} c={c} />)}</ul>
        </Fold>
      )}
    </div>
  );
}
