import { redirect } from "next/navigation";
import { Submit } from "@/components/client";
import { MonthNav } from "@/components/MonthNav";
import { can, requireUser } from "@/lib/auth";
import { all, ensureRecurring, todayStr } from "@/lib/db";
import { expenseAmount, expenseQuick, expenseRemove, fixedAdd, fixedRemove } from "@/lib/pl-actions";
import { fmtTL, isPeriod, periodLabel, shiftPeriod, tlInput } from "@/lib/util";

type E = { id: number; date: string; name: string; category: string; amount: number; template_id: number | null; note: string | null };

function CatSelect({ id, cats }: { id: string; cats: { id: number; name: string }[] }) {
  return (
    <select id={id} name="category_id" className="input" required defaultValue="" aria-label="Kategori">
      <option value="" disabled>Kategori</option>
      {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

export default async function Giderler({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const u = await requireUser();
  if (!can.seeFinance(u)) redirect("/");
  ensureRecurring();
  const today = todayStr(), current = today.slice(0, 7);
  const ay = (await searchParams).ay;
  const period = isPeriod(ay) && ay <= current ? ay : current, prevP = shiftPeriod(period, -1);
  const cats = all<{ id: number; name: string }>("SELECT * FROM expense_categories ORDER BY name");
  const rows = (fixed: number) => all<E>(
    `SELECT e.*, c.name AS category FROM expenses e JOIN expense_categories c ON c.id=e.category_id WHERE e.period=? AND e.fixed=? ORDER BY e.date, e.id`, period, fixed);
  const fixed = rows(1), other = rows(0);
  const prevFixed = new Map(all<{ template_id: number; amount: number }>("SELECT template_id, amount FROM expenses WHERE period=? AND template_id IS NOT NULL", prevP).map((r) => [r.template_id, r.amount]));
  const sum = (l: E[]) => l.reduce((s, e) => s + e.amount, 0);
  const prevTotal = all<{ fixed: number; t: number }>("SELECT fixed, SUM(amount) AS t FROM expenses WHERE period=? GROUP BY fixed", prevP);
  const pt = (f: number) => prevTotal.find((r) => r.fixed === f)?.t ?? 0;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="h1">Giderler</h1>
          <p className="muted">{periodLabel(period)}: <b className="text-ink">{fmtTL(sum(fixed) + sum(other))}</b> · geçen ay {fmtTL(pt(1) + pt(0))}. Tedarikçi alımları ayrı ekranda.</p>
        </div>
        <MonthNav base="/giderler" period={period} current={current} />
      </div>

      <section className="card">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="h2">Sabit giderler</h2>
          <span className="tabular-nums font-semibold">{fmtTL(sum(fixed))}</span>
        </div>
        <p className="muted">Bir kez ekle, her ay kendiliğinden gelsin. Tutarı bu ay için ya da bundan sonrası için değiştirebilirsin.</p>
        <ul className="mt-2">
          {fixed.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
              <span className="min-w-40 flex-1">{e.name} <span className="text-muted">· {e.category}</span>
                {e.template_id && prevFixed.has(e.template_id) && prevFixed.get(e.template_id) !== e.amount ? <span className="block text-xs text-muted">Geçen ay {fmtTL(prevFixed.get(e.template_id))}</span> : null}</span>
              <form action={expenseAmount} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={e.id} />
                <input name="amount" inputMode="decimal" className="input w-32" defaultValue={tlInput(e.amount)} aria-label={`${e.name} tutar`} />
                {e.template_id && <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" name="forward" className="size-4" /> sonraki aylar da</label>}
                <Submit className="btn btn-sm">Güncelle</Submit>
              </form>
              {e.template_id ? (
                <form action={fixedRemove}>
                  <input type="hidden" name="id" value={e.template_id} /><input type="hidden" name="from" value={period} />
                  <Submit className="btn btn-sm btn-danger">Bu aydan itibaren çıkar</Submit>
                </form>
              ) : (
                <form action={expenseRemove}><input type="hidden" name="id" value={e.id} /><Submit className="btn btn-sm btn-danger">Sil</Submit></form>
              )}
            </li>
          ))}
          {!fixed.length && <li className="muted py-2">Bu ay sabit gider yok.</li>}
        </ul>
        <form action={fixedAdd} className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-bg p-3 sm:grid-cols-5">
          <input name="name" className="input col-span-2 sm:col-span-1" placeholder="Örn. Kira" aria-label="Sabit gider adı" required />
          <input name="amount" inputMode="decimal" className="input" placeholder="Aylık tutar (TL)" aria-label="Aylık tutar" required />
          <CatSelect id="fc" cats={cats} />
          <div><label className="sr-only" htmlFor="fs">Başlangıç ayı</label><input id="fs" type="month" name="start" className="input" defaultValue={period} max={current} required title="Başlangıç ayı: geçmiş bir ay seçersen o aydan bugüne tüm aylara işlenir" /></div>
          <Submit>Sabit gider ekle</Submit>
        </form>
        <p className="muted mt-1">Başlangıç ayını geçmişe alırsan o aydan bugüne bütün aylara aynı tutar yazılır.</p>
      </section>

      <section className="card">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="h2">Diğer giderler</h2>
          <span className="tabular-nums font-semibold">{fmtTL(sum(other))}</span>
        </div>
        <form action={expenseQuick} className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-bg p-3 sm:grid-cols-5">
          <input type="hidden" name="period" value={period} />
          <input name="name" className="input col-span-2 sm:col-span-1" placeholder="Örn. Makine tamiri" aria-label="Gider adı" required />
          <input name="amount" inputMode="decimal" className="input" placeholder="Tutar (TL)" aria-label="Tutar" required />
          <CatSelect id="oc" cats={cats} />
          <input type="date" name="date" className="input" defaultValue={period === current ? today : `${period}-01`} min={`${period}-01`} max={period === current ? today : `${period}-31`} aria-label="Tarih" />
          <Submit>Gider ekle</Submit>
        </form>
        <ul className="mt-2">
          {other.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2 last:border-0">
              <span className="flex-1"><span className="mr-2 text-muted tabular-nums">{e.date.slice(8)}.{e.date.slice(5, 7)}</span>{e.name} <span className="text-muted">· {e.category}</span></span>
              <span className="tabular-nums">{fmtTL(e.amount)}</span>
              <form action={expenseRemove}><input type="hidden" name="id" value={e.id} /><Submit className="btn btn-sm btn-danger">Sil</Submit></form>
            </li>
          ))}
          {!other.length && <li className="muted py-2">Bu ay başka gider girilmedi.</li>}
        </ul>
      </section>
    </div>
  );
}
