import { redirect } from "next/navigation";
import { Submit } from "@/components/client";
import { MonthNav } from "@/components/MonthNav";
import { can, requireUser } from "@/lib/auth";
import { setting, todayStr } from "@/lib/db";
import { ratesSave, revenueMonth } from "@/lib/pl-actions";
import { dailyRevenue, lumpOf } from "@/lib/pl";
import { fmtTL, isPeriod, periodLabel, tlInput } from "@/lib/util";

const GUN = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

export default async function Ciro({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const u = await requireUser();
  if (!can.seeFinance(u)) redirect("/");
  const today = todayStr(), current = today.slice(0, 7);
  const ay = (await searchParams).ay;
  const period = isPeriod(ay) && ay <= current ? ay : current;
  const days = await dailyRevenue(period), lump = await lumpOf(period);
  const total = days.reduce((s, d) => s + d.cash + d.card, 0) + lump;

  const [vat, tax, pct] = await Promise.all([setting("revenue_vat_pct"), setting("income_tax_pct"), setting("card_commission_pct")]);
  const rates = { vat, tax, pct };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="h1">Ciro</h1>
          <p className="muted">{periodLabel(period)} toplamı: <b className="text-ink">{fmtTL(total)}</b></p>
        </div>
        <MonthNav base="/ciro" period={period} current={current} />
      </div>

      <form action={revenueMonth} className="grid gap-4">
        <input type="hidden" name="period" value={period} />
        <section className="card">
          <h2 className="h2">Gün gün girmeden aylık toplam</h2>
          <p className="muted">Geçmiş bir ayı tek rakamla girmek için. Aşağıdaki günlük tutarlara eklenir; ikisini aynı satış için doldurma.</p>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <div><label className="label" htmlFor="lump">Aylık toplam ciro (TL)</label><input id="lump" name="lump" inputMode="decimal" className="input w-44" defaultValue={lump ? tlInput(lump) : ""} /></div>
            <Submit>Kaydet</Submit>
          </div>
        </section>

        <section className="card overflow-x-auto">
          <h2 className="h2">Günlük ciro</h2>
          <table className="tbl mt-2">
            <thead><tr><th>Gün</th><th>Nakit (TL)</th><th>Kart (TL)</th><th className="num">Toplam</th></tr></thead>
            <tbody>
              {days.map((d) => {
                const future = d.date > today, wd = new Date(d.date + "T00:00:00Z").getUTCDay();
                return (
                  <tr key={d.date} className={d.date === today ? "bg-[#dcefe9]" : ""}>
                    <td className={`whitespace-nowrap ${wd === 0 || wd === 6 ? "font-medium" : ""}`}>{d.day} <span className="text-muted">{GUN[wd]}</span></td>
                    <td><input name={`n_${d.day}`} inputMode="decimal" className="input w-28" defaultValue={d.cash ? tlInput(d.cash) : ""} disabled={future} aria-label={`${d.day}. gün nakit`} /></td>
                    <td><input name={`k_${d.day}`} inputMode="decimal" className="input w-28" defaultValue={d.card ? tlInput(d.card) : ""} disabled={future} aria-label={`${d.day}. gün kart`} /></td>
                    <td className="num">{d.cash + d.card ? fmtTL(d.cash + d.card) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="sticky bottom-0 -mx-4 -mb-4 mt-3 flex items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3">
            <span className="text-sm text-muted">Boş bıraktığın gün 0 sayılır.</span>
            <Submit>Tüm ayı kaydet</Submit>
          </div>
        </section>
      </form>

      <form action={ratesSave} className="card flex flex-wrap items-end gap-3">
        <div className="mr-auto max-w-md">
          <h2 className="h2">Ciro oranları</h2>
          <p className="muted">Ciro KDV dahil girilir. İçindeki KDV bu oranla ayrıştırılır ve alımlarda ödediğin KDV düşülerek “ödenecek KDV” gider olarak yazılır. Kart cirosundan komisyon da gider olarak düşülür. Gelir vergisi, ciro eksi resmi giderlerin bu oranı kadar hesaplanıp net kârdan düşülür.</p>
        </div>
        <div><label className="label" htmlFor="vat">Ciro KDV oranı (%)</label><input id="vat" name="vat" inputMode="decimal" className="input w-24" defaultValue={rates.vat} /></div>
        <div><label className="label" htmlFor="tax">Gelir vergisi (%)</label><input id="tax" name="tax" inputMode="decimal" className="input w-24" defaultValue={rates.tax} /></div>
        <div><label className="label" htmlFor="pct">Kart komisyonu (%)</label><input id="pct" name="pct" inputMode="decimal" className="input w-24" defaultValue={rates.pct} /></div>
        <Submit className="btn">Kaydet</Submit>
      </form>
    </div>
  );
}
