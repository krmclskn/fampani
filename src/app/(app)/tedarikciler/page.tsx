import { redirect } from "next/navigation";
import { Fold, Submit } from "@/components/client";
import { MonthNav } from "@/components/MonthNav";
import { PurchaseForm } from "@/components/PurchaseForm";
import { can, requireUser } from "@/lib/auth";
import { all, todayStr } from "@/lib/db";
import { paymentAdd, purchaseAdd, supplierAdd, supplierEdit, supRecordDelete } from "@/lib/pl-actions";
import { supplierBalances } from "@/lib/pl";
import { VAT_RATES, fmtQty, fmtTL, isPeriod, periodLabel, shiftPeriod } from "@/lib/util";

type Rec = { kind: "alim" | "odeme"; id: number; supplier_id: number; date: string; amount: number; vat: number; monthly: number; note: string | null; period: string };

export default async function Tedarikciler({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const u = await requireUser();
  if (!can.seeFinance(u)) redirect("/");
  const today = todayStr(), current = today.slice(0, 7);
  const ay = (await searchParams).ay;
  const period = isPeriod(ay) && ay <= current ? ay : current;
  const sups = await supplierBalances(period);
  const recs = await all<Rec>(
    `SELECT 'alim' AS kind, id, supplier_id, date, amount, vat, monthly, note, period FROM sup_purchases WHERE period=?
     UNION ALL SELECT 'odeme', id, supplier_id, date, amount, 0, 0, note, substr(date,1,7) FROM sup_payments WHERE substr(date,1,7)=?
     ORDER BY date DESC, id DESC`, period, period);
  const lines = await all<{ purchase_id: number; name: string; qty: number; unit_price: number; vat_rate: number }>(
    "SELECT l.* FROM sup_purchase_lines l JOIN sup_purchases p ON p.id=l.purchase_id WHERE p.period=?", period);
  const tot = (k: "ayAlim" | "ayOdeme" | "bakiye" | "ayKdv") => sups.reduce((s, x) => s + x[k], 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="h1">Tedarikçiler</h1>
          <p className="muted">{periodLabel(period)}: alım <b className="text-ink">{fmtTL(tot("ayAlim"))}</b> (içinde KDV {fmtTL(tot("ayKdv"))}) · ödeme <b className="text-ink">{fmtTL(tot("ayOdeme"))}</b> · toplam borç <b className="text-ink">{fmtTL(tot("bakiye"))}</b></p>
        </div>
        <MonthNav base="/tedarikciler" period={period} current={current} />
      </div>

      {sups.map((s) => {
        const mine = recs.filter((r) => r.supplier_id === s.id);
        return (
          <Fold key={s.id} id={`tedarikci:${s.id}`} title={s.name}
            meta={
                <span className="flex flex-wrap justify-end gap-x-4 text-sm font-normal tabular-nums">
                  <span><span className="text-muted">Bu ay alım</span> {fmtTL(s.ayAlim)}</span>
                  <span><span className="text-muted">ödeme</span> {fmtTL(s.ayOdeme)}</span>
                  <span className={s.bakiye > 0 ? "font-semibold" : ""}><span className="font-normal text-muted">borç</span> {fmtTL(s.bakiye)}</span>
                </span>}>
              <div className="mt-1 grid gap-4">
                <div className="grid gap-3 rounded-lg bg-bg p-3">
                  <h3 className="label">Yeni alım</h3>
                  <PurchaseForm supplierId={s.id} today={today} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <form action={paymentAdd} className="grid content-start gap-2 rounded-lg bg-bg p-3">
                    <h3 className="label">Ödeme yaptım</h3>
                    <input type="hidden" name="supplier_id" value={s.id} />
                    <div className="grid grid-cols-2 gap-2">
                      <input type="date" name="date" className="input" defaultValue={today} max={today} aria-label="Ödeme tarihi" required />
                      <input name="amount" inputMode="decimal" className="input" placeholder="Tutar (TL)" aria-label="Ödeme tutarı" required />
                    </div>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" name="as_purchase" className="mt-0.5 size-4" defaultChecked={s.bakiye <= 0} />
                      <span>Bu ödemenin alımını ayrıca girmedim; gidere de yaz
                        <span className="block text-xs text-muted">{s.bakiye > 0 ? `Açık borç ${fmtTL(s.bakiye)}: işaretlemezsen ödeme bu borçtan düşer.` : "Açık borç yok: işaretli bırakırsan ödeme alım olarak gelir tablosuna girer."}</span></span>
                    </label>
                    <div className="flex items-center gap-2 text-sm"><label htmlFor={`yv${s.id}`} className="text-muted">Gidere yazılırsa KDV oranı</label>
                      <select id={`yv${s.id}`} name="vat_rate" className="input w-24" defaultValue="10">{VAT_RATES.map((r) => <option key={r} value={r}>%{r}</option>)}</select></div>
                    <input name="note" className="input" placeholder="Not (isteğe bağlı)" aria-label="Not" />
                    <Submit className="btn">Ödemeyi kaydet</Submit>
                  </form>
                  <form action={purchaseAdd} className="grid gap-2 rounded-lg bg-bg p-3">
                    <h3 className="label">Tek tek yazmadan: aylık toplam alım</h3>
                    <input type="hidden" name="supplier_id" value={s.id} /><input type="hidden" name="monthly" value="1" />
                    <div className="grid grid-cols-2 gap-2">
                      <input type="month" name="period" className="input" defaultValue={period === current ? shiftPeriod(current, -1) : period} max={current} aria-label="Ay" required />
                      <input name="amount" inputMode="decimal" className="input" placeholder="Toplam, KDV dahil" aria-label="Aylık toplam" required />
                    </div>
                    <div className="flex items-center gap-2 text-sm"><label htmlFor={`mv${s.id}`} className="text-muted">KDV oranı</label>
                      <select id={`mv${s.id}`} name="vat_rate" className="input w-24" defaultValue="10">{VAT_RATES.map((r) => <option key={r} value={r}>%{r}</option>)}</select></div>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="paid" className="size-4" /> Tamamı ödendi</label>
                    <Submit className="btn">Aylık toplamı kaydet</Submit>
                  </form>
                </div>
                <div>
                  <h3 className="label">{periodLabel(period)} hareketleri</h3>
                  {mine.length ? (
                    <ul>
                      {mine.map((r) => (
                        <li key={r.kind + r.id} className="border-b border-line py-2 last:border-0">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span>
                              <span className="mr-2 text-muted tabular-nums">{r.monthly ? "ay toplamı" : `${r.date.slice(8)}.${r.date.slice(5, 7)}`}</span>
                              <span className={`badge ${r.kind === "odeme" ? "badge-ok" : ""}`}>{r.kind === "odeme" ? "Ödeme" : "Alım"}</span>
                              {r.note && <span className="ml-2 text-muted">{r.note}</span>}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="tabular-nums"><b className="font-medium">{fmtTL(r.amount)}</b>{r.kind === "alim" ? <span className="text-muted"> · KDV {fmtTL(r.vat)}</span> : null}</span>
                              <form action={supRecordDelete}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="kind" value={r.kind} /><Submit className="btn btn-sm btn-danger">Sil</Submit></form>
                            </span>
                          </div>
                          {r.kind === "alim" && lines.some((l) => l.purchase_id === r.id) && (
                            <ul className="mt-1 grid gap-0.5 pl-4 text-sm text-muted">
                              {lines.filter((l) => l.purchase_id === r.id).map((l, i) => <li key={i}>{l.name}: {fmtQty(l.qty)} × {fmtTL(l.unit_price)} + %{fmtQty(l.vat_rate)} KDV = {fmtTL(Math.round(l.qty * l.unit_price * (1 + l.vat_rate / 100)))}</li>)}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted">Bu ay hareket yok.</p>}
                </div>
                <details>
                  <summary className="text-sm font-medium text-muted underline underline-offset-2">Adı değiştir / sil</summary>
                  <form action={supplierEdit} className="mt-2 flex flex-wrap gap-2">
                    <input type="hidden" name="id" value={s.id} />
                    <input name="name" className="input max-w-xs" defaultValue={s.name} aria-label="Tedarikçi adı" />
                    <Submit className="btn">Adı kaydet</Submit>
                    <Submit className="btn btn-danger" name="op" value="sil">Tedarikçiyi sil</Submit>
                  </form>
                </details>
              </div>
          </Fold>
        );
      })}

      <form action={supplierAdd} className="card flex flex-wrap items-end gap-3">
        <div className="flex-1"><label className="label" htmlFor="sn">Yeni tedarikçi</label><input id="sn" name="name" className="input" placeholder="Tedarikçi adı" required /></div>
        <Submit>Tedarikçi ekle</Submit>
      </form>
    </div>
  );
}
