import { redirect } from "next/navigation";
import { Submit } from "@/components/client";
import { can, requireUser } from "@/lib/auth";
import { setting, todayStr } from "@/lib/db";
import { debtAdd, debtDelete, debtPay } from "@/lib/pl-actions";
import { debts, type DebtV } from "@/lib/pl";
import { fmtQty, fmtTL } from "@/lib/util";

function DebtCard({ d, today }: { d: DebtV; today: string }) {
  return (
    <li className="border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{d.name}</p>
          <p className="muted">Anapara {fmtTL(d.principal)} · vade {d.start_date} · aylık %{fmtQty(d.monthly_rate)} faiz{d.note ? ` · ${d.note}` : ""}</p>
        </div>
        <div className="text-right">
          <p className="text-xl font-semibold tabular-nums">{fmtTL(d.toplam)}</p>
          <p className="text-xs text-muted tabular-nums">kalan anapara {fmtTL(d.kalanAna)} + faiz {fmtTL(d.faiz)}{d.gunluk ? ` · her gün +${fmtTL(d.gunluk)}` : ""}</p>
        </div>
      </div>
      <form action={debtPay} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="debt_id" value={d.id} />
        <input type="date" name="date" className="input w-40" defaultValue={today} min={d.start_date} max={today} aria-label="Ödeme tarihi" required />
        <input name="amount" inputMode="decimal" className="input w-36" placeholder="Ödeme (TL)" aria-label="Ödeme tutarı" required />
        <input name="note" className="input max-w-48" placeholder="Not" aria-label="Not" />
        <Submit className="btn">Ödeme gir</Submit>
      </form>
      {(
        <details className="mt-2">
          <summary className="text-sm font-medium text-muted underline underline-offset-2">Ödemeler ({d.payments.length}) · toplam {fmtTL(d.odenen)}</summary>
          <ul className="mt-1 grid gap-1 text-sm">
            {d.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span><span className="mr-2 text-muted tabular-nums">{p.date}</span>{fmtTL(p.amount)}{p.note ? <span className="text-muted"> · {p.note}</span> : null}</span>
                <form action={debtDelete}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="kind" value="odeme" /><Submit className="btn btn-sm btn-danger">Sil</Submit></form>
              </li>
            ))}
          </ul>
          <form action={debtDelete} className="mt-2"><input type="hidden" name="id" value={d.id} /><Submit className="btn btn-sm btn-danger">Borç kaydını tümüyle sil</Submit></form>
        </details>
      )}
    </li>
  );
}

export default async function Borclar() {
  const u = await requireUser();
  if (!can.seeFinance(u)) redirect("/");
  const today = todayStr(), list = debts(today), taxRate = setting("tax_debt_rate") || "3.7";
  const vergi = list.filter((d) => d.kind === "vergi"), diger = list.filter((d) => d.kind !== "vergi");
  const sum = (l: DebtV[], k: "toplam" | "faiz" | "gunluk") => l.reduce((s, d) => s + d[k], 0);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Geçmiş borçlar</h1>
        <p className="muted">Toplam <b className="text-ink">{fmtTL(sum(list, "toplam"))}</b> · bunun {fmtTL(sum(list, "faiz"))} kadarı birikmiş faiz · her gün +{fmtTL(sum(list, "gunluk"))}. Tedarikçi borçları Tedarikçiler ekranında.</p>
      </div>

      <section className="card">
        <div className="flex items-baseline justify-between gap-2"><h2 className="h2">Vergi borçları</h2><span className="font-semibold tabular-nums">{fmtTL(sum(vergi, "toplam"))}</span></div>
        <p className="muted">Gecikme zammı basit faizdir: kalan anapara × aylık oran, ay kesri için gün başına oran ÷ 30.</p>
        {vergi.length ? <ul className="mt-1">{vergi.map((d) => <DebtCard key={d.id} d={d} today={today} />)}</ul> : <p className="muted mt-2">Kayıtlı vergi borcu yok.</p>}
      </section>

      <section className="card">
        <div className="flex items-baseline justify-between gap-2"><h2 className="h2">Diğer borçlar</h2><span className="font-semibold tabular-nums">{fmtTL(sum(diger, "toplam"))}</span></div>
        {diger.length ? <ul className="mt-1">{diger.map((d) => <DebtCard key={d.id} d={d} today={today} />)}</ul> : <p className="muted mt-2">Kayıtlı başka borç yok.</p>}
      </section>

      <form action={debtAdd} className="card grid gap-3">
        <h2 className="h2">Borç ekle</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div className="col-span-2"><label className="label" htmlFor="name">Borç adı</label><input id="name" name="name" className="input" placeholder="Örn. 2025/4 KDV" required /></div>
          <div><label className="label" htmlFor="kind">Tür</label>
            <select id="kind" name="kind" className="input"><option value="vergi">Vergi borcu</option><option value="diger">Diğer borç</option></select></div>
          <div><label className="label" htmlFor="principal">Anapara (TL)</label><input id="principal" name="principal" inputMode="decimal" className="input" required /></div>
          <div><label className="label" htmlFor="start_date">Vade (faiz başlangıcı)</label><input id="start_date" type="date" name="start_date" className="input" max={today} required /></div>
          <div><label className="label" htmlFor="monthly_rate">Aylık faiz (%)</label><input id="monthly_rate" name="monthly_rate" inputMode="decimal" className="input" defaultValue={taxRate.replace(".", ",")} /></div>
          <div className="col-span-2 sm:col-span-3"><label className="label" htmlFor="note">Not</label><input id="note" name="note" className="input" /></div>
          <div className="self-end"><Submit>Borcu ekle</Submit></div>
        </div>
        <p className="muted">Vergi borcu için varsayılan oran aylık %{taxRate.replace(".", ",")} (verdiğin gecikme zammı oranı). Faizsiz borçta oranı 0 yaz. Ödeme, o günkü anapara ve birikmiş faize oranlı dağıtılır; kesin tutar için vergi dairesi dökümünü esas al.</p>
      </form>
    </div>
  );
}
