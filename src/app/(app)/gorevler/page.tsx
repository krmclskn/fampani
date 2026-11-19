import Link from "next/link";
import { Fold, Submit } from "@/components/client";
import { todoAct, todoAdd, todoFinish } from "@/lib/actions";
import { can, requireUser, type User } from "@/lib/auth";
import { all, todayStr } from "@/lib/db";
import { fmtDateTime } from "@/lib/util";

/** Bir aşama (tasks satırı). İş = ilk aşama + ona bağlı devam aşamaları. */
type S = { id: number; title: string; detail: string | null; status: string; due: string | null; assignee_id: number | null;
  assignee2_id: number | null; created_by: number | null; who: string | null; who2: string | null; by_name: string | null;
  done_at: string | null; done_name: string | null; note: string | null; parent_id: number | null; prio: number; urgent: number;
  started_at: string | null; team: string | null; team_ids: string | null };
type Job = { stages: S[]; current: S | null; last: S };
type Person = { id: number; name: string };
type Ctx = { u: User; people: Person[]; today: string };

const dm = (d: string) => `${d.slice(8)}.${d.slice(5, 7)}`;
const PRIO: Record<number, string> = { 1: "Yüksek", 2: "Normal", 3: "Düşük" };
const whoText = (s: S) => (s.who ? s.who + (s.who2 ? " + " + s.who2 : "") : "Sahipsiz");
const mineOf = (s: S | null, u: User) => !!s && (s.assignee_id === u.id || s.assignee2_id === u.id);

function WhoSelect({ name, people, u, def, label, allowOthers }: { name: string; people: Person[]; u: User; def: string; label: string; allowOthers: boolean }) {
  return (
    <select name={name} className="input" defaultValue={def} aria-label={label}>
      <option value="ben">Bana</option>
      <option value="havuz">Sahipsiz (isteyen üstlenir)</option>
      {allowOthers && people.filter((p) => p.id !== u.id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

function PrioFields({ prio = 2, urgent = 0, idp }: { prio?: number; urgent?: number; idp: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select name="prio" className="input w-36" defaultValue={String(prio)} aria-label="Öncelik">
        {[1, 2, 3].map((n) => <option key={n} value={n}>Öncelik {n} · {PRIO[n]}</option>)}
      </select>
      <label htmlFor={`${idp}u`} className="flex items-center gap-1.5 text-sm font-medium text-bad">
        <input id={`${idp}u`} type="checkbox" name="urgent" className="size-4 accent-[#b3261e]" defaultChecked={!!urgent} /> Acil
      </label>
    </div>
  );
}

/** İşi bitirirken kimlerin dahil olduğu: üstlenenler ve işaretleyen kişi hazır seçili gelir. */
function TeamPicker({ s, c, idp }: { s: S; c: Ctx; idp: string }) {
  const pre = new Set([s.assignee_id, s.assignee2_id, c.u.id]);
  return (
    <fieldset>
      <legend className="label">Kimler dahil oldu?</legend>
      <div className="flex flex-wrap gap-1">
        {c.people.map((p) => (
          <label key={p.id} className="cursor-pointer">
            <input type="checkbox" name="p" value={p.id} defaultChecked={pre.has(p.id)} className="peer sr-only" id={`${idp}${p.id}`} />
            <span className="inline-flex min-h-8 items-center rounded-full border border-line bg-surface px-2.5 text-xs font-medium text-muted peer-checked:border-accent peer-checked:bg-accent peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              {p.id === c.u.id ? "Ben" : p.name}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Flags({ s }: { s: S }) {
  return (
    <>
      {s.urgent ? <span className="badge badge-bad">ACİL</span> : null}
      {s.prio !== 2 && <span className={`badge ${s.prio === 1 ? "badge-warn" : ""}`}>Öncelik {s.prio}</span>}
    </>
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
                  <span className={`badge ${st.who ? "badge-ok" : ""}`}>{whoText(st)}</span>
                  {st.due && <span className={`badge ${late ? "badge-bad" : ""}`}>{late ? "Gecikti: " : "Son: "}{dm(st.due)}</span>}
                </>
              ) : <span>✓ {st.team ?? st.done_name ?? st.who}, {fmtDateTime(st.done_at)}</span>}
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
  const mine = mineOf(cur, u);
  const canWork = !!cur && (mine || boss || !cur.assignee_id);
  const canMove = !!cur && (boss || mine || cur.created_by === u.id);
  const canCancel = !!cur && (boss || root.created_by === u.id);
  const canJoin = !!cur && !mine && (!cur.assignee_id || !cur.assignee2_id);
  const started = !!cur && (job.stages.length > 1 || !!cur.started_at);
  const multi = job.stages.length > 1;
  const late = cur?.due && cur.due < today;
  const flagged = cur ?? job.last;
  return (
    <li className={`rounded-lg border bg-surface p-3 ${cur?.urgent ? "border-[#e5a59e] border-l-4 border-l-bad" : "border-line"}`}>
      <div className="grid gap-2">
        <div className="min-w-0">
          {cur && (cur.urgent || cur.prio !== 2) ? <p className="mb-1 flex flex-wrap gap-1"><Flags s={flagged} /></p> : null}
          <p className={`font-medium ${cur ? "" : "text-muted line-through"}`}>{root.title}</p>
          {root.detail && <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{root.detail}</p>}
          {!multi && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              {cur ? <span className={`badge ${cur.who ? "badge-ok" : ""}`}>{whoText(cur)}</span> : null}
              {cur?.due && <span className={`badge ${late ? "badge-bad" : ""}`}>{late ? "Gecikti: " : "Son: "}{dm(cur.due)}</span>}
              {root.by_name && root.by_name !== root.who && <span>açan {root.by_name}</span>}
              {!cur && <span>✓ {job.last.team ?? job.last.done_name}, {fmtDateTime(job.last.done_at)}</span>}
            </p>
          )}
          {!multi && !cur && root.note && <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-[#dcefe9] px-2 py-1 text-sm">“{root.note}”</p>}
          {multi && <p className="mt-0.5 text-xs text-muted">{job.stages.length} aşama{root.by_name ? ` · açan ${root.by_name}` : ""}</p>}
        </div>
        <form action={todoAct} className="flex flex-wrap gap-1.5 empty:hidden">
          <input type="hidden" name="id" value={(cur ?? job.last).id} />
          {canJoin && <Submit className="btn btn-sm" name="op" value="ustlen">{cur!.assignee_id ? "Ben de katılayım" : "Üstlen"}</Submit>}
          {cur && !started && canWork && <Submit className="btn btn-sm" name="op" value="basla">▶ Başladım</Submit>}
          {!cur && (mineOf(job.last, u) || boss) && <Submit className="btn btn-sm" name="op" value="gerial">Geri al</Submit>}
        </form>
      </div>

      {multi && <Timeline job={job} today={today} />}

      {canWork && cur && (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <details className="group">
            <summary className="btn btn-primary btn-sm group-open:hidden">✓ Tamamla</summary>
            <form action={todoFinish} className="grid gap-2 rounded-lg border border-line bg-bg p-3 sm:w-[30rem]">
              <input type="hidden" name="id" value={cur.id} />
              <TeamPicker s={cur} c={c} idp={`f${cur.id}p`} />
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
              <TeamPicker s={cur} c={c} idp={`d${cur.id}p`} />
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

      {cur && (canMove || canCancel || mine) && (
        <details className="mt-2">
          <summary className="text-xs font-medium text-muted underline underline-offset-2">Kişiler, öncelik{canCancel ? ", iptal" : ""}</summary>
          <div className="mt-2 grid gap-2 rounded-lg bg-bg p-3">
            {canMove && (
              <form action={todoAct} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={cur.id} /><input type="hidden" name="op" value="ata" />
                <select name="assignee" className="input w-44" defaultValue={cur.assignee_id ?? "havuz"} aria-label="Birinci kişi">
                  <option value="havuz">Sahipsiz bırak</option>
                  {(boss || mine ? people : people.filter((p) => p.id === u.id)).map((p) => <option key={p.id} value={p.id}>{p.id === u.id ? "Ben" : p.name}</option>)}
                </select>
                <span className="text-sm text-muted">+</span>
                <select name="assignee2" className="input w-44" defaultValue={cur.assignee2_id ?? "yok"} aria-label="İkinci kişi">
                  <option value="yok">İkinci kişi yok</option>
                  {(boss || mine ? people : people.filter((p) => p.id === u.id)).map((p) => <option key={p.id} value={p.id}>{p.id === u.id ? "Ben" : p.name}</option>)}
                </select>
                <Submit className="btn btn-sm">Kaydet</Submit>
              </form>
            )}
            {canMove && (
              <form action={todoAct} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={cur.id} /><input type="hidden" name="op" value="oncelik" />
                <PrioFields prio={cur.prio} urgent={cur.urgent} idp={`o${cur.id}`} />
                <Submit className="btn btn-sm">Önceliği kaydet</Submit>
              </form>
            )}
            <form action={todoAct} className="flex flex-wrap gap-2">
              <input type="hidden" name="id" value={cur.id} />
              {mine && <Submit className="btn btn-sm" name="op" value="birak">İşi bırak</Submit>}
              {canCancel && <Submit className="btn btn-sm btn-danger" name="op" value="sil">İşi iptal et</Submit>}
            </form>
          </div>
        </details>
      )}
    </li>
  );
}

function Column({ id, title, hint, list, c, tone }: { id: string; title: string; hint: string; list: Job[]; c: Ctx; tone?: "warn" | "ok" }) {
  return (
    <Fold id={`pano:${id}`} title={title} count={list.length} tone={tone} defaultOpen className="rounded-xl bg-[#eeebe3] p-3">
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

const FILTERS = [["hepsi", "Herkesin işleri"], ["ben", "Bende"], ["sahipsiz", "Sahipsiz"]] as const;

export default async function Yapilacaklar({ searchParams }: { searchParams: Promise<{ kim?: string }> }) {
  const u = await requireUser();
  const today = todayStr(), boss = can.assignTasks(u);
  const k = (await searchParams).kim;
  const kim = k === "ben" || k === "sahipsiz" ? k : "hepsi";
  const people = await all<Person>("SELECT id,name FROM users WHERE active=1 ORDER BY name");
  const rows = await all<S>(
    `SELECT t.id, t.title, t.detail, t.status, t.due, t.assignee_id, t.assignee2_id, t.created_by, t.done_at, t.note, t.parent_id,
       t.prio, t.urgent, t.started_at, au.name AS who, au2.name AS who2, cu.name AS by_name, du.name AS done_name,
       (SELECT string_agg(pu.name, ', ' ORDER BY pu.name) FROM task_participants tp JOIN users pu ON pu.id=tp.user_id WHERE tp.task_id=t.id) AS team,
       (SELECT string_agg(tp.user_id::text, ',') FROM task_participants tp WHERE tp.task_id=t.id) AS team_ids
     FROM tasks t LEFT JOIN users au ON au.id=t.assignee_id LEFT JOIN users au2 ON au2.id=t.assignee2_id
       LEFT JOIN users cu ON cu.id=t.created_by LEFT JOIN users du ON du.id=t.done_by
     WHERE t.kind='is' ORDER BY t.id`);
  const jobs = buildJobs(rows);

  const involved = (j: Job) => j.stages.some((s) => s.assignee_id === u.id || s.assignee2_id === u.id || s.created_by === u.id
    || (s.team_ids ?? "").split(",").includes(String(u.id)));
  const pick = (j: Job) => {
    const s = j.current ?? j.last;
    if (kim === "ben") return j.current ? mineOf(s, u) : involved(j);
    if (kim === "sahipsiz") return !!j.current && !s.assignee_id;
    return true;
  };
  // Acil olanlar en üstte, sonra öncelik (1 en yüksek), sonra son tarih, sonra en yeni.
  const rank = (a: Job, b: Job) => {
    const x = a.current!, y = b.current!;
    return y.urgent - x.urgent || x.prio - y.prio || (x.due ?? "9999").localeCompare(y.due ?? "9999") || b.stages[0].id - a.stages[0].id;
  };
  const open = jobs.filter((j) => j.current && pick(j)).sort(rank);
  const notStarted = open.filter((j) => j.stages.length === 1 && !j.current!.started_at);
  const going = open.filter((j) => !notStarted.includes(j));
  const allDone = jobs.filter((j) => !j.current && pick(j) && (boss || involved(j)))
    .sort((a, b) => (b.last.done_at ?? "").localeCompare(a.last.done_at ?? ""));
  const weekAgo = todayStr(-7);
  const recent = allDone.filter((j) => (j.last.done_at ?? "") >= weekAgo);
  const c: Ctx = { u, people, today };
  const urgentCount = open.filter((j) => j.current!.urgent).length;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Yapılacaklar</h1>
        <p className="muted">İşi aç. Tek seferde bitiyorsa <b className="text-ink">Tamamla</b>; bitmiyorsa <b className="text-ink">+ Devam aşaması</b> ile sıradaki adımı ekle, iş “devam ediyor”a geçer. Bir işi iki kişi üstlenebilir; bitirirken kimlerin dahil olduğunu işaretle. Acil ve öncelikli işler en üstte durur.</p>
      </div>

      <form action={todoAdd} className="card grid gap-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_180px_160px_auto]">
          <input name="title" className="input" placeholder="Yeni iş…" aria-label="Yeni iş" required maxLength={160} />
          <WhoSelect name="assignee" people={people} u={u} def="ben" label="Kime" allowOthers={boss} />
          <input type="date" name="due" className="input" min={today} aria-label="Son tarih (isteğe bağlı)" title="Son tarih (isteğe bağlı)" />
          <Submit>İş aç</Submit>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PrioFields idp="new" />
          <details>
            <summary className="text-xs font-medium text-muted underline underline-offset-2">Not ekle</summary>
            <textarea name="detail" className="input mt-2" rows={2} placeholder="Ayrıntı, hatırlatma…" aria-label="Not" />
          </details>
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([v, l]) => (
          <Link key={v} href={v === "hepsi" ? "/gorevler" : `/gorevler?kim=${v}`} aria-current={kim === v ? "page" : undefined}
            className={`btn btn-sm ${kim === v ? "btn-primary" : ""}`}>{l}</Link>
        ))}
        {urgentCount > 0 && <span className="badge badge-bad ml-auto">{urgentCount} acil iş</span>}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Column id="baslamadi" title="Başlamadı" hint="Başlamayı bekleyen iş yok." list={notStarted} c={c} tone={notStarted.length ? "warn" : undefined} />
        <Column id="devam" title="Devam ediyor" hint="Devam eden iş yok." list={going} c={c} />
        <Column id="bitti" title="Bitti (son 7 gün)" hint="Son 7 günde biten iş yok." list={recent.slice(0, 20)} c={c} tone="ok" />
      </div>

      {allDone.length > 0 && (
        <Fold id="pano:tum-biten" title="Tamamlanan tüm işler" count={allDone.length}>
          <ul className="grid gap-2">{allDone.slice(0, 300).map((j) => <JobCard key={j.stages[0].id} job={j} c={c} />)}</ul>
          {allDone.length > 300 && <p className="muted mt-2">En yeni 300 iş gösteriliyor.</p>}
        </Fold>
      )}
    </div>
  );
}
