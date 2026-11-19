import { redirect } from "next/navigation";
import { Fold, Submit } from "@/components/client";
import { MonthNav } from "@/components/MonthNav";
import { can, requireUser } from "@/lib/auth";
import { ensureRecurring, todayStr } from "@/lib/db";
import { expenseAdd, expenseAmount, expensePay, expenseRemove, fixedRemove, salaryAdd } from "@/lib/pl-actions";
import { categories, expenseRows } from "@/lib/pl";
import { GROUPS, VAT_RATES, fmtTL, isPeriod, periodLabel, tlInput } from "@/lib/util";

type Row = Awaited<ReturnType<typeof expenseRows>>[number];

function List({ rows, period, empty, today, id }: { rows: Row[]; period: string; empty: string; today: string; id: string }) {
  if (!rows.length) return <p className="muted py-2">{empty}</p>;
  const groups = GROUPS.filter((g) => rows.some((r) => r.grp === g.key));
  return (
    <div className="grid gap-1">
      {groups.map((g) => {
        const list = rows.filter((r) => r.grp === g.key);
        return (
          <Fold key={g.key} id={`gider:${id}:${g.key}`} className="rounded-lg border border-line px-3 py-2"
            title={<span className="flex items-center gap-2 text-sm"><span className="inline-block size-3 rounded-sm" style={{ background: g.color }} />{g.label}</span>}
            meta={<>
              <span className="hidden text-xs text-muted sm:inline">{list.length} kalem{list.some((r) => !r.paid_at) ? ` · ${list.filter((r) => !r.paid_at).length} ödenmemiş` : ""}</span>
              <span className="text-sm font-semibold tabular-nums">{fmtTL(list.reduce((s, r) => s + r.amount, 0))}</span>
            </>}>
            <ul>
              {list.map((e) => (
                <li key={e.id} className="border-b border-line py-2 last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-40 flex-1 text-sm">
                      {e.name}{e.fixed ? <span className="badge ml-2">Her ay</span> : <span className="ml-2 text-muted tabular-nums">{e.date.slice(8)}.{e.date.slice(5, 7)}</span>}
                      <span className="block text-xs text-muted">{e.category}{e.vat ? ` · içinde KDV ${fmtTL(e.vat)} (KDV hariç ${fmtTL(e.amount - e.vat)})` : ""}</span>
                    </span>
                    <span className="font-medium tabular-nums">{fmtTL(e.amount)}</span>
                    {e.paid_at ? (
                      <form action={expensePay} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={e.id} /><input type="hidden" name="op" value="geri" />
                        <span className="badge badge-ok">Ödendi {e.paid_at.slice(8)}.{e.paid_at.slice(5, 7)}.{e.paid_at.slice(0, 4)}</span>
                        <Submit className="btn btn-sm">Geri al</Submit>
                      </form>
                    ) : (
                      <form action={expensePay} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={e.id} />
                        <input type="date" name="paid_at" className="input w-36" defaultValue={today} max={today} aria-label={`${e.name} ödeme tarihi`} required />
                        <Submit className="btn btn-sm">Ödendi</Submit>
                      </form>
                    )}
                  </div>
                  <details className="mt-1">
                    <summary className="text-xs font-medium text-muted underline underline-offset-2">Tutarı / KDV’yi / tarihi düzenle{e.template_id ? ", çıkar" : ", sil"}</summary>
                    <div className="mt-2 flex flex-wrap items-end gap-3 rounded-lg bg-bg p-3">
                      <form action={expenseAmount} className="flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={e.id} />
                        <div><label className="label" htmlFor={`a${e.id}`}>Toplam (KDV dahil)</label><input id={`a${e.id}`} name="amount" inputMode="decimal" className="input w-32" defaultValue={tlInput(e.amount)} /></div>
                        {e.official ? <div><label className="label" htmlFor={`v${e.id}`}>İçindeki KDV (TL)</label><input id={`v${e.id}`} name="vat" inputMode="decimal" className="input w-28" defaultValue={tlInput(e.vat)} /></div> : null}
                        {!e.template_id && <div><label className="label" htmlFor={`d${e.id}`}>Tarih</label><input id={`d${e.id}`} type="date" name="date" className="input w-40" defaultValue={e.date} min={`${period}-01`} max={`${period}-31`} /></div>}
                        {e.template_id && <label className="flex items-center gap-1 pb-2 text-xs text-muted"><input type="checkbox" name="forward" className="size-4" /> sonraki aylar da</label>}
                        <Submit className="btn btn-sm">Güncelle</Submit>
                      </form>
                      {e.template_id ? (
                        <form action={fixedRemove}><input type="hidden" name="id" value={e.template_id} /><input type="hidden" name="from" value={period} />
                          <Submit className="btn btn-sm btn-danger">Bu aydan çıkar</Submit></form>
                      ) : (
                        <form action={expenseRemove}><input type="hidden" name="id" value={e.id} /><Submit className="btn btn-sm btn-danger">Sil</Submit></form>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </Fold>
        );
      })}
    </div>
  );
}

export default async function Giderler({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const u = await requireUser();
  if (!can.seeFinance(u)) redirect("/");
  await ensureRecurring();
  const today = todayStr(), current = today.slice(0, 7);
  const ay = (await searchParams).ay;
  const period = isPeriod(ay) && ay <= current ? ay : current;
  const cats = await categories(), rows = await expenseRows(period);
  const resmi = rows.filter((r) => r.official), gayri = rows.filter((r) => !r.official);
  const sum = (l: Row[]) => l.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="h1">Giderler</h1>
          <p className="muted">{periodLabel(period)}: resmi <b className="text-ink">{fmtTL(sum(resmi))}</b> · resmi olmayan <b className="text-ink">{fmtTL(sum(gayri))}</b> · ödenmemiş <b className="text-ink">{fmtTL(rows.filter((r) => !r.paid_at).reduce((x, r) => x + r.amount, 0))}</b>. Tedarikçi alımları ve ödenecek KDV ayrıca hesaplanır.</p>
        </div>
        <MonthNav base="/giderler" period={period} current={current} />
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <Fold id="gider:ekle" title="+ Gider ekle" className="card self-start">
        <form action={expenseAdd} className="grid content-start gap-3">
          <input type="hidden" name="period" value={period} />
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="label" htmlFor="category_id">Tür</label>
              <select id="category_id" name="category_id" className="input" required defaultValue="">
                <option value="" disabled>Seç</option>
                <optgroup label="Resmi giderler">{cats.filter((c) => c.official).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
                <optgroup label="Resmi olmayan giderler">{cats.filter((c) => !c.official).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
              </select>
            </div>
            <div><label className="label" htmlFor="amount">Tutar (KDV dahil, TL)</label><input id="amount" name="amount" inputMode="decimal" className="input" required /></div>
            <div><label className="label" htmlFor="vat_rate">KDV oranı</label>
              <select id="vat_rate" name="vat_rate" className="input" defaultValue="0">{VAT_RATES.map((r) => <option key={r} value={r}>{r ? `%${r}` : "KDV yok"}</option>)}</select></div>
            <div><label className="label" htmlFor="vat_amount">ya da KDV tutarı (TL)</label><input id="vat_amount" name="vat_amount" inputMode="decimal" className="input" placeholder="Faturadaki KDV" /></div>
            <div><label className="label" htmlFor="date">Gider / fatura tarihi</label><input id="date" type="date" name="date" className="input" defaultValue={period === current ? today : `${period}-01`} min={`${period}-01`} max={period === current ? today : `${period}-31`} /></div>
            <div><label className="label" htmlFor="paid_at">Ödeme tarihi (ödendiyse)</label><input id="paid_at" type="date" name="paid_at" className="input" max={today} /></div>
            <div className="col-span-2"><label className="label" htmlFor="name">Açıklama (boşsa tür adı yazılır)</label><input id="name" name="name" className="input" placeholder="Örn. Kasım elektrik faturası" /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="repeat" className="size-4" /> Her ay tekrarla (sabit gider)</label>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="label" htmlFor="start">Tekrarlıyorsa başlangıç ayı</label><input id="start" type="month" name="start" className="input" defaultValue={period} max={current} /></div>
            <Submit className="btn btn-primary ml-auto">Gideri ekle</Submit>
          </div>
          <p className="muted">Kira gibi KDV’li giderde toplamı (kira + KDV) yaz; oranı seç ya da faturadaki KDV tutarını elle gir. KDV, ödenecek KDV’den düşülür. Ödeme tarihini sonradan satırdaki “Ödendi” ile de girebilirsin. Resmi olmayan türlerde KDV uygulanmaz.</p>
        </form>
        </Fold>

        <Fold id="gider:maas" title="+ Maaş ekle" className="card self-start">
        <form action={salaryAdd} className="grid content-start gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2"><label className="label" htmlFor="person">Çalışan</label><input id="person" name="person" className="input" required /></div>
            <div><label className="label" htmlFor="maas">Bordrodaki net maaş (TL)</label><input id="maas" name="maas" inputMode="decimal" className="input" /></div>
            <div><label className="label" htmlFor="sgk">SGK + vergi primi (TL)</label><input id="sgk" name="sgk" inputMode="decimal" className="input" /></div>
            <div><label className="label" htmlFor="elden">Elden / SGK’sız ödeme (TL)</label><input id="elden" name="elden" inputMode="decimal" className="input" /></div>
            <div><label className="label" htmlFor="sstart">Başlangıç ayı</label><input id="sstart" type="month" name="start" className="input" defaultValue={period} max={current} required /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="repeat" className="size-4" defaultChecked /> Her ay tekrarla</label>
          <Submit className="btn btn-primary justify-self-end">Maaşı ekle</Submit>
          <p className="muted">Doldurduğun her alan ayrı kalem olur: maaş “Maaşlar”a, prim “SGK / Bağkur”a, elden ödeme “Resmi olmayan”a yazılır. Boş bıraktığın alan atlanır.</p>
        </form>
        </Fold>
      </section>

      <Fold id="gider:resmi" title="Resmi giderler" defaultOpen meta={<span className="font-semibold tabular-nums">{fmtTL(sum(resmi))}</span>}>
        <List id="resmi" rows={resmi} period={period} today={today} empty="Bu ay resmi gider yok." />
      </Fold>

      <Fold id="gider:gayri" title="Resmi olmayan giderler" defaultOpen meta={<span className="font-semibold tabular-nums">{fmtTL(sum(gayri))}</span>}>
        <p className="muted mb-2">SGK’sız maaşlar, part-time ödemeler, faturasız ödemeler.</p>
        <List id="gayri" rows={gayri} period={period} today={today} empty="Bu ay resmi olmayan gider yok." />
      </Fold>
    </div>
  );
}
