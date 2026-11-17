import Link from "next/link";
import { redirect } from "next/navigation";
import { Submit } from "@/components/client";
import { Explorer } from "@/components/Explorer";
import { MonthNav } from "@/components/MonthNav";
import { can, requireUser } from "@/lib/auth";
import { ensureRecurring, get, setting, todayStr } from "@/lib/db";
import { revenueDay } from "@/lib/pl-actions";
import { chartData, debts, expenseByCategory, giderOf, kdvByPeriod, purchasesBySupplier, supplierBalances, type Bucket } from "@/lib/pl";
import { GROUPS, fmtQty, fmtTL, isPeriod, periodLabel, tlInput } from "@/lib/util";

const pctOf = (a: number, b: number) => (b ? `%${fmtQty(Math.round((a / b) * 1000) / 10)}` : "–");
const gsum = (b: Bucket, k: (typeof GROUPS)[number]["key"]) => b.g[k][0] + b.g[k][1];

function Delta({ cur, prev, good }: { cur: number; prev: number; good: "up" | "down" }) {
  if (!prev) return <span className="text-muted">–</span>;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(d) < 0.5) return <span className="text-muted">aynı</span>;
  return <span className={(d > 0) === (good === "up") ? "text-accent" : "text-bad"}>{d > 0 ? "▲" : "▼"} %{fmtQty(Math.abs(Math.round(d)))}</span>;
}

function Tile({ label, cur, prev, good }: { label: string; cur: number; prev: number; good: "up" | "down" }) {
  return (
    <div className="card">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${cur < 0 ? "text-bad" : ""}`}>{fmtTL(cur)}</p>
      <p className="mt-0.5 text-xs text-muted"><Delta cur={cur} prev={prev} good={good} /> Geçen ay: {fmtTL(prev)}</p>
    </div>
  );
}

/** Gelir tablosu satırı. Gider satırları eksi gösterilir; değişim artış/azalışa göre renklenir. */
function Row({ label, a, b, cost, bold, indent, ciro, color }: { label: string; a: number; b: number; cost?: boolean; bold?: boolean; indent?: boolean; ciro: number; color?: string }) {
  const sa = cost ? -a : a, sb = cost ? -b : b;
  return (
    <tr className={bold ? "font-semibold" : ""}>
      <td className={indent ? "pl-6 text-muted" : ""}>{color && <span className="mr-2 inline-block size-3 rounded-sm align-[-1px]" style={{ background: color }} />}{label}</td>
      <td className={`num ${sa < 0 ? "text-bad" : ""}`}>{fmtTL(sa || 0)}</td>
      <td className="num text-muted">{pctOf(a, ciro)}</td>
      <td className="num text-muted">{fmtTL(sb || 0)}</td>
      <td className="num"><Delta cur={a} prev={b} good={cost ? "down" : "up"} /></td>
    </tr>
  );
}

export default async function Panel({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const u = await requireUser();
  if (!can.seeFinance(u)) redirect("/");
  await ensureRecurring();
  const today = todayStr(), current = today.slice(0, 7);
  const ay = (await searchParams).ay;
  const period = isPeriod(ay) && ay <= current ? ay : current;
  const data = await chartData(period), cur = data.ay[11], prev = data.ay[10];
  const net = (b: Bucket) => b.ciro - giderOf(b);
  const kdv = (await kdvByPeriod(period)).get(period) ?? { out: 0, inp: 0, devir: 0, odenecek: 0, devreden: 0 };
  const catsCur = await expenseByCategory(period), catsOld = new Map((await expenseByCategory(prev.key)).map((c) => [c.name, c]));
  const cats = [...catsCur, ...[...catsOld.values()].filter((o) => !catsCur.some((c) => c.name === o.name)).map((o) => ({ ...o, total: 0 }))];
  const supsCur = await purchasesBySupplier(period), supsOld = new Map((await purchasesBySupplier(prev.key)).map((s) => [s.name, s.total]));
  const sups = [...supsCur, ...[...supsOld].filter(([n]) => !supsCur.some((c) => c.name === n)).map(([name]) => ({ name, total: 0 }))];
  const pct = Number(await setting("card_commission_pct")) || 0, kom = (b: Bucket) => Math.round((b.kart * pct) / 100);
  const todayRow = await get<{ cash: number; card: number }>("SELECT cash, card FROM revenue_days WHERE date=?", today);
  const supDebt = (await supplierBalances(period)).reduce((s, x) => s + Math.max(x.bakiye, 0), 0);
  const ds = await debts(), taxDebt = ds.filter((d) => d.kind === "vergi").reduce((s, d) => s + d.toplam, 0), otherDebt = ds.filter((d) => d.kind !== "vergi").reduce((s, d) => s + d.toplam, 0);
  const resmiCats = cats.filter((c) => c.official), gayriCats = cats.filter((c) => !c.official);
  const resmiTot = (b: Bucket) => gsum(b, "kira") + gsum(b, "maas") + gsum(b, "sgk") + gsum(b, "vergi") - b.tax + gsum(b, "resmi");
  const taxPct = Number(await setting("income_tax_pct")) || 0, vatPct = Number(await setting("revenue_vat_pct"));
  const col = (k: string) => GROUPS.find((g) => g.key === k)?.color;

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
        <Tile label={`Ciro · ${periodLabel(period)}`} cur={cur.ciro} prev={prev.ciro} good="up" />
        <Tile label="Toplam gider" cur={giderOf(cur)} prev={giderOf(prev)} good="down" />
        <Tile label="Ödenecek KDV" cur={kdv.odenecek} prev={gsum(prev, "kdv")} good="down" />
        <Tile label="Net kâr (vergi sonrası)" cur={net(cur)} prev={net(prev)} good="up" />
      </section>

      <Explorer key={period} data={data} groups={GROUPS.map((g) => ({ ...g }))} />

      <section className="card overflow-x-auto">
        <h2 className="h2">Gelir tablosu · {periodLabel(period)}</h2>
        <table className="tbl mt-2">
          <thead><tr><th>Kalem</th><th className="num">{periodLabel(period)}</th><th className="num">Ciroya oranı</th><th className="num">{periodLabel(prev.key)}</th><th className="num">Değişim</th></tr></thead>
          <tbody>
            <Row ciro={cur.ciro} label="Ciro (KDV dahil)" a={cur.ciro} b={prev.ciro} bold />
            <Row ciro={cur.ciro} label="Nakit" a={cur.nakit} b={prev.nakit} indent />
            <Row ciro={cur.ciro} label="Kart" a={cur.kart} b={prev.kart} indent />
            {(cur.toplu || prev.toplu) ? <Row ciro={cur.ciro} label="Aylık toplam (gün gün girilmeyen)" a={cur.toplu} b={prev.toplu} indent /> : null}

            <Row ciro={cur.ciro} label="Tedarikçi alımları" a={gsum(cur, "tedarik")} b={gsum(prev, "tedarik")} cost bold color={col("tedarik")} />
            {sups.map((s) => <Row ciro={cur.ciro} key={s.name} label={s.name} a={s.total} b={supsOld.get(s.name) ?? 0} cost indent />)}

            <Row ciro={cur.ciro} label="Resmi giderler" a={resmiTot(cur)} b={resmiTot(prev)} cost bold />
            {resmiCats.map((c) => <Row ciro={cur.ciro} key={c.name} label={c.name} a={c.total} b={catsOld.get(c.name)?.total ?? 0} cost indent color={col(c.grp)} />)}
            {(kom(cur) || kom(prev)) ? <Row ciro={cur.ciro} label={`Kart komisyonu (%${fmtQty(pct)})`} a={kom(cur)} b={kom(prev)} cost indent color={col("resmi")} /> : null}

            <Row ciro={cur.ciro} label="Ödenecek KDV" a={kdv.odenecek} b={gsum(prev, "kdv")} cost bold color={col("kdv")} />
            <tr><td className="pl-6 text-muted" colSpan={5}>
              Cirodaki KDV (%{fmtQty(vatPct)}) {fmtTL(kdv.out)} − alım ve giderlerde ödenen KDV {fmtTL(kdv.inp)}
              {kdv.devir ? ` − geçen aydan devreden ${fmtTL(kdv.devir)}` : ""}{kdv.devreden ? ` → sonraki aya devreden ${fmtTL(kdv.devreden)}` : ""}
            </td></tr>

            <Row ciro={cur.ciro} label="Vergi öncesi kâr (ciro − resmi giderler)" a={cur.taxBase} b={prev.taxBase} bold />
            <Row ciro={cur.ciro} label={`Gelir vergisi (%${fmtQty(taxPct)})`} a={cur.tax} b={prev.tax} cost bold color={col("vergi")} />

            <Row ciro={cur.ciro} label="Resmi olmayan giderler" a={gsum(cur, "gayri")} b={gsum(prev, "gayri")} cost bold color={col("gayri")} />
            {gayriCats.map((c) => <Row ciro={cur.ciro} key={c.name} label={c.name} a={c.total} b={catsOld.get(c.name)?.total ?? 0} cost indent />)}

            <Row ciro={cur.ciro} label="Net kâr (vergi sonrası)" a={net(cur)} b={net(prev)} bold />
          </tbody>
        </table>
        <p className="muted mt-2">Tüm tutarlar KDV dahildir; KDV farkı “Ödenecek KDV” satırında ayrıca gider yazılır. Gelir vergisi = (ciro − alımlar − resmi giderler − ödenecek KDV) × oran; resmi olmayan giderler vergiden düşülmez, zarar varsa vergi 0 alınır. Alımlar fatura ayına yazılır. Yönetim amaçlıdır; KDV ve vergi hesabını mali müşavirinle doğrula.</p>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <Link href="/tedarikciler" className="card block hover:border-accent"><p className="text-xs font-semibold text-muted">Tedarikçi borcu</p><p className="mt-1 text-xl font-semibold tabular-nums">{fmtTL(supDebt)}</p></Link>
        <Link href="/borclar" className="card block hover:border-accent"><p className="text-xs font-semibold text-muted">Vergi borcu (faiz dahil)</p><p className="mt-1 text-xl font-semibold tabular-nums">{fmtTL(taxDebt)}</p></Link>
        <Link href="/borclar" className="card block hover:border-accent"><p className="text-xs font-semibold text-muted">Diğer geçmiş borçlar</p><p className="mt-1 text-xl font-semibold tabular-nums">{fmtTL(otherDebt)}</p></Link>
      </section>
    </div>
  );
}
