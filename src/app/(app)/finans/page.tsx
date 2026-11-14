import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart } from "@/components/BarChart";
import { Submit } from "@/components/client";
import { MonthNav } from "@/components/MonthNav";
import { can, requireUser } from "@/lib/auth";
import { ensureRecurring, get, todayStr } from "@/lib/db";
import { revenueDay } from "@/lib/pl-actions";
import { dailyRevenue, expenseByCategory, months, purchasesBySupplier, supplierBalances } from "@/lib/pl";
import { fmtQty, fmtTL, isPeriod, periodLabel, tlInput } from "@/lib/util";

const pctOf = (a: number, b: number) => (b ? `%${fmtQty(Math.round((a / b) * 1000) / 10)}` : "–");

function Delta({ cur, prev, good }: { cur: number; prev: number; good: "up" | "down" }) {
  if (!prev) return <span className="text-muted">–</span>;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(d) < 0.5) return <span className="text-muted">aynı</span>;
  const better = (d > 0) === (good === "up");
  return <span className={better ? "text-accent" : "text-bad"}>{d > 0 ? "▲" : "▼"} %{fmtQty(Math.abs(Math.round(d)))}</span>;
}

function Tile({ label, cur, prev, good, prevLabel }: { label: string; cur: number; prev: number; good: "up" | "down"; prevLabel: string }) {
  return (
    <div className="card">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${cur < 0 ? "text-bad" : ""}`}>{fmtTL(cur)}</p>
      <p className="mt-0.5 text-xs text-muted"><Delta cur={cur} prev={prev} good={good} /> {prevLabel}: {fmtTL(prev)}</p>
    </div>
  );
}

function Row({ label, a, b, good, bold, indent, ciro }: { label: string; a: number; b: number; good: "up" | "down"; bold?: boolean; indent?: boolean; ciro: number }) {
  return (
    <tr className={bold ? "font-semibold" : ""}>
      <td className={indent ? "pl-6 text-muted" : ""}>{label}</td>
      <td className={`num ${a < 0 ? "text-bad" : ""}`}>{fmtTL(a || 0)}</td>
      <td className="num text-muted">{pctOf(good === "down" ? Math.abs(a) : a, ciro)}</td>
      <td className="num text-muted">{fmtTL(b || 0)}</td>
      <td className="num">{good === "down" ? <Delta cur={Math.abs(a)} prev={Math.abs(b)} good="down" /> : <Delta cur={a} prev={b} good="up" />}</td>
    </tr>
  );
}

export default async function Panel({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const u = await requireUser();
  if (!can.seeFinance(u)) redirect("/");
  ensureRecurring();
  const today = todayStr(), current = today.slice(0, 7);
  const ay = (await searchParams).ay;
  const period = isPeriod(ay) && ay <= current ? ay : current;
  const series = months(period, 12), cur = series[11], prev = series[10];
  // Geçen ay olup bu ay olmayan kalemler de satır olarak görünsün.
  const catsCur = expenseByCategory(period), catsOld = expenseByCategory(prev.period);
  const catsPrev = new Map(catsOld.map((c) => [`${c.name}|${c.fixed}`, c.total]));
  const cats = [...catsCur, ...catsOld.filter((o) => !catsCur.some((c) => c.name === o.name && c.fixed === o.fixed)).map((o) => ({ ...o, total: 0 }))];
  const supsCur = purchasesBySupplier(period), supsOld = purchasesBySupplier(prev.period);
  const supsPrev = new Map(supsOld.map((s) => [s.name, s.total]));
  const sups = [...supsCur, ...supsOld.filter((o) => !supsCur.some((c) => c.name === o.name)).map((o) => ({ ...o, total: 0 }))];
  const days = dailyRevenue(period);
  const entered = days.filter((d) => d.cash + d.card > 0);
  const avg = entered.length ? (cur.nakit + cur.kart) / entered.length : 0;
  const todayRow = get<{ cash: number; card: number }>("SELECT cash, card FROM revenue_days WHERE date=?", today);
  const debts = supplierBalances(period).filter((s) => s.bakiye !== 0);
  const pl = "Geçen ay";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">Panel</h1>
        <MonthNav base="/finans" period={period} current={current} />
      </div>

      {period === current && (
        <form action={revenueDay} className="card flex flex-wrap items-end gap-3">
          <input type="hidden" name="date" value={today} />
          <div className="mr-auto">
            <h2 className="h2">Bugünün cirosu</h2>
            <p className="muted">{todayRow ? `Kayıtlı: ${fmtTL(todayRow.cash + todayRow.card)}` : "Henüz girilmedi"}</p>
          </div>
          <div><label className="label" htmlFor="cash">Nakit (TL)</label><input id="cash" name="cash" inputMode="decimal" className="input w-32" defaultValue={todayRow?.cash ? tlInput(todayRow.cash) : ""} /></div>
          <div><label className="label" htmlFor="card">Kart (TL)</label><input id="card" name="card" inputMode="decimal" className="input w-32" defaultValue={todayRow?.card ? tlInput(todayRow.card) : ""} /></div>
          <Submit>Kaydet</Submit>
        </form>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Ciro" cur={cur.ciro} prev={prev.ciro} good="up" prevLabel={pl} />
        <Tile label="Tedarikçi alımları" cur={cur.alim} prev={prev.alim} good="down" prevLabel={pl} />
        <Tile label="Giderler" cur={cur.sabit + cur.diger + cur.komisyon} prev={prev.sabit + prev.diger + prev.komisyon} good="down" prevLabel={pl} />
        <Tile label="Net kâr" cur={cur.net} prev={prev.net} good="up" prevLabel={pl} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="h2 mb-2">Son 12 ay: ciro ve toplam gider</h2>
          <BarChart series={["Ciro", "Toplam gider (alım + gider)"]} data={series.map((m) => ({ label: m.label, v: [m.ciro, m.gider] }))} />
        </div>
        <div className="card">
          <h2 className="h2 mb-2">Son 12 ay: net kâr</h2>
          <BarChart series={["Net kâr"]} values data={series.map((m) => ({ label: m.label, v: [m.net] }))} />
        </div>
      </section>

      <section className="card overflow-x-auto">
        <h2 className="h2">Gelir tablosu · {periodLabel(period)}</h2>
        <table className="tbl mt-2">
          <thead><tr><th>Kalem</th><th className="num">{periodLabel(period)}</th><th className="num">Ciroya oranı</th><th className="num">{periodLabel(prev.period)}</th><th className="num">Değişim</th></tr></thead>
          <tbody>
            <Row ciro={cur.ciro} label="Ciro" a={cur.ciro} b={prev.ciro} good="up" bold />
            <Row ciro={cur.ciro} label="Nakit" a={cur.nakit} b={prev.nakit} good="up" indent />
            <Row ciro={cur.ciro} label="Kart" a={cur.kart} b={prev.kart} good="up" indent />
            {(cur.toplu || prev.toplu) ? <Row ciro={cur.ciro} label="Aylık toplam (gün gün girilmeyen)" a={cur.toplu} b={prev.toplu} good="up" indent /> : null}
            <Row ciro={cur.ciro} label="Tedarikçi alımları" a={-cur.alim} b={-prev.alim} good="down" bold />
            {sups.map((s) => <Row ciro={cur.ciro} key={s.name} label={s.name} a={-s.total} b={-(supsPrev.get(s.name) ?? 0)} good="down" indent />)}
            <Row ciro={cur.ciro} label="Brüt kâr" a={cur.ciro - cur.alim} b={prev.ciro - prev.alim} good="up" bold />
            <Row ciro={cur.ciro} label="Sabit giderler" a={-cur.sabit} b={-prev.sabit} good="down" bold />
            {cats.filter((c) => c.fixed).map((c) => <Row ciro={cur.ciro} key={c.name} label={c.name} a={-c.total} b={-(catsPrev.get(`${c.name}|1`) ?? 0)} good="down" indent />)}
            <Row ciro={cur.ciro} label="Diğer giderler" a={-cur.diger} b={-prev.diger} good="down" bold />
            {cats.filter((c) => !c.fixed).map((c) => <Row ciro={cur.ciro} key={c.name} label={c.name} a={-c.total} b={-(catsPrev.get(`${c.name}|0`) ?? 0)} good="down" indent />)}
            {(cur.komisyon || prev.komisyon) ? <Row ciro={cur.ciro} label="Kart komisyonu" a={-cur.komisyon} b={-prev.komisyon} good="down" bold /> : null}
            <Row ciro={cur.ciro} label="Net kâr" a={cur.net} b={prev.net} good="up" bold />
          </tbody>
        </table>
        <p className="muted mt-2">
          Net kâr marjı {pctOf(cur.net, cur.ciro)}. Tutarlar girdiğin gibi (vergi dahil) hesaplanır; alımlar faturanın ait olduğu aya yazılır, ödeme günü dikkate alınmaz. Resmî gelir tablosu değildir.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="card">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="h2">Günlük ciro · {periodLabel(period)}</h2>
            <span className="muted">{entered.length} gün girildi · günlük ortalama {fmtTL(Math.round(avg))}</span>
          </div>
          <BarChart series={["Günlük ciro"]} height={200} data={days.map((d) => ({ label: String(d.day), v: [d.cash + d.card] }))} />
          <Link href={`/ciro?ay=${period}`} className="mt-2 inline-block text-sm font-medium text-accent underline underline-offset-2">Günleri gir veya düzelt</Link>
        </div>
        <div className="card">
          <h2 className="h2">Tedarikçi borçları</h2>
          {debts.length ? (
            <ul className="mt-2 grid gap-1.5 text-sm">
              {debts.map((s) => (
                <li key={s.id} className="flex justify-between gap-2"><span>{s.name}</span>
                  <span className={`tabular-nums ${s.bakiye > 0 ? "font-semibold" : "text-accent"}`}>{s.bakiye > 0 ? fmtTL(s.bakiye) : `${fmtTL(-s.bakiye)} alacak`}</span></li>
              ))}
              <li className="flex justify-between gap-2 border-t border-line pt-1.5 font-semibold"><span>Toplam borç</span><span className="tabular-nums">{fmtTL(debts.reduce((s, x) => s + Math.max(x.bakiye, 0), 0))}</span></li>
            </ul>
          ) : <p className="muted mt-2">Açık borç yok.</p>}
          <Link href="/tedarikciler" className="mt-2 inline-block text-sm font-medium text-accent underline underline-offset-2">Alım veya ödeme gir</Link>
        </div>
      </section>
    </div>
  );
}
