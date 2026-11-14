import { FEATURES } from "@/lib/util";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Submit } from "@/components/client";
import { can, requireUser } from "@/lib/auth";
import { all, get, todayStr } from "@/lib/db";
import { salesApprove, salesCorrect, salesSave } from "@/lib/finance-actions";
import { products } from "@/lib/finance";
import { fmtDate, fmtDateTime, fmtQty, fmtTL, tlInput } from "@/lib/util";

type Line = { id: number; product_id: number; name: string; qty: number; unit_price: number; discount: number; refund: number; kind: string; note: string | null; ticket_id: number | null };

export default async function Satis({ searchParams }: { searchParams: Promise<{ tarih?: string }> }) {
  const u = await requireUser();
  if (!FEATURES.kasa) redirect("/");
  if (!can.enterSales(u)) redirect("/");
  const today = todayStr();
  const t = (await searchParams).tarih;
  const date = t && /^\d{4}-\d{2}-\d{2}$/.test(t) && t <= today ? t : today;
  const day = get<{ status: string; note: string | null; entered: string | null; approved: string | null; approved_at: string | null }>(
    `SELECT d.status, d.note, e.name AS entered, a.name AS approved, d.approved_at FROM sales_days d
     LEFT JOIN users e ON e.id=d.entered_by LEFT JOIN users a ON a.id=d.approved_by WHERE d.date=?`, date);
  const lines = all<Line>("SELECT l.*, p.name FROM sale_lines l JOIN products p ON p.id=l.product_id WHERE l.date=? ORDER BY l.kind DESC, p.name", date);
  const chans = all<{ id: number; name: string; commission_pct: number; amount: number | null; commission: number | null }>(
    `SELECT c.id, c.name, c.commission_pct, p.amount, p.commission FROM payment_channels c
     LEFT JOIN sale_payments p ON p.channel_id=c.id AND p.date=? WHERE c.active=1 OR p.amount IS NOT NULL ORDER BY c.id`, date);
  const approved = day?.status === "onayli";
  const expected = new Map(all<{ channel_id: number; total: number }>(
    "SELECT channel_id, SUM(total) AS total FROM tickets WHERE date=? AND void_at IS NULL AND channel_id IS NOT NULL GROUP BY channel_id", date).map((r) => [r.channel_id, r.total]));
  const treats = all<{ id: number; at: string; summary: string; note: string | null; treat: string; by: string }>(
    `SELECT t.id, t.at, t.summary, t.note, tb.name AS treat, us.name AS by FROM tickets t JOIN users tb ON tb.id=t.treat_by
     JOIN users us ON us.id=t.user_id WHERE t.date=? AND t.kind='ikram' AND t.void_at IS NULL ORDER BY t.id`, date);
  // Aynı ürün ve türdeki satırları tek satırda topla (kasa fişleri çok satır üretir).
  const grouped = [...lines.reduce((m, l) => {
    const k = `${l.product_id}|${l.kind}|${l.ticket_id ? "kasa" : "elle"}|${l.kind === "duzeltme" ? l.id : ""}`;
    const g = m.get(k) ?? { ...l, qty: 0, discount: 0, refund: 0, gross: 0 };
    g.qty += l.qty; g.discount += l.discount; g.refund += l.refund; g.gross += l.qty * l.unit_price;
    return m.set(k, g);
  }, new Map<string, Line & { gross: number }>()).values()];
  const posLines = grouped.filter((l) => l.ticket_id);
  const prods = products(true);
  const net = lines.reduce((s, l) => s + l.qty * l.unit_price - l.discount - l.refund, 0);
  const paid = chans.reduce((s, c) => s + (c.amount ?? 0), 0);
  const recent = all<{ date: string; status: string; net: number | null }>(
    `SELECT d.date, d.status, (SELECT SUM(qty*unit_price-discount-refund) FROM sale_lines l WHERE l.date=d.date) AS net
     FROM sales_days d ORDER BY d.date DESC LIMIT 10`);
  const prev = todayStr(-1);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="h1">Günlük satış</h1>
          <p className="muted">
            {fmtDate(date)} ·{" "}
            {approved ? `Onaylandı: ${day?.approved}, ${fmtDateTime(day?.approved_at)}` : day ? `Taslak (${day.entered})` : "Henüz giriş yok"}
          </p>
        </div>
        <form className="flex items-end gap-2" action="/satis">
          <div><label className="label" htmlFor="tarih">Gün</label><input id="tarih" type="date" name="tarih" className="input" defaultValue={date} max={today} /></div>
          <button className="btn">Git</button>
          {date !== prev && <Link href={`/satis?tarih=${prev}`} className="btn">Dün</Link>}
        </form>
      </div>

      {posLines.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="h2">Kasadan gelen satışlar</h2>
          <p className="muted">Kasa ekranından girilen fişlerin toplamı. Stokları satış anında düşüldü.</p>
          <table className="tbl mt-2">
            <thead><tr><th>Ürün</th><th className="num">Adet</th><th className="num">Tutar</th></tr></thead>
            <tbody>
              {posLines.map((l) => (
                <tr key={`${l.product_id}${l.kind}`}>
                  <td>{l.name}{l.kind === "ikram" && <span className="badge badge-warn ml-2">İkram</span>}</td>
                  <td className="num">{fmtQty(l.qty)}</td><td className="num">{l.kind === "ikram" ? "–" : fmtTL(l.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {treats.length > 0 && (
            <>
              <h3 className="label mt-4">İkramlar</h3>
              <ul className="grid gap-1 text-sm">
                {treats.map((t) => <li key={t.id}>{fmtDateTime(t.at)} · {t.summary} · <b className="font-medium">ikramı yapan: {t.treat}</b>{t.by !== t.treat ? ` (giren: ${t.by})` : ""}{t.note ? ` · ${t.note}` : ""}</li>)}
              </ul>
            </>
          )}
        </section>
      )}

      {!approved ? (
        <form action={salesSave} className="grid gap-4">
          <input type="hidden" name="date" value={date} />
          <section className="card overflow-x-auto">
            <h2 className="h2">Elle satış girişi</h2>
            <p className="muted">Kasa ekranından geçmeyen satışlar için. Kasadan girilenleri buraya tekrar yazmayın.</p>
            <table className="tbl mt-2">
              <thead><tr><th>Ürün</th><th className="num">Fiyat</th><th>Adet</th><th>İndirim (TL)</th><th>İade/iptal (TL)</th></tr></thead>
              <tbody>
                {prods.map((p) => {
                  const l = lines.find((x) => x.product_id === p.id && x.kind === "satis" && !x.ticket_id);
                  return (
                    <tr key={p.id}>
                      <td>{p.name}{p.recipe_n === 0 && <span className="badge badge-bad ml-2">Reçete yok</span>}</td>
                      <td className="num">{fmtTL(p.price)}</td>
                      <td><input name={`q_${p.id}`} inputMode="decimal" className="input w-20" defaultValue={l?.qty ?? ""} aria-label={`${p.name} adet`} /></td>
                      <td><input name={`d_${p.id}`} inputMode="decimal" className="input w-24" defaultValue={l?.discount ? tlInput(l.discount) : ""} aria-label={`${p.name} indirim`} /></td>
                      <td><input name={`r_${p.id}`} inputMode="decimal" className="input w-24" defaultValue={l?.refund ? tlInput(l.refund) : ""} aria-label={`${p.name} iade`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!prods.length && <p className="muted mt-2">Önce Ürünler ekranından ürün ekleyin.</p>}
          </section>
          <section className="card">
            <h2 className="h2">Tahsilat (kasa / POS kapanışı)</h2>
            <p className="muted">Gün sonunda sayılan nakit ve POS slip toplamını yazın; kasa fişleriyle fark varsa aşağıda görünür.</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {chans.map((c) => (
                <div key={c.id}>
                  <label className="label" htmlFor={`p_${c.id}`}>{c.name} (TL){c.commission_pct > 0 ? ` · %${fmtQty(c.commission_pct)} komisyon` : ""}</label>
                  <input id={`p_${c.id}`} name={`p_${c.id}`} inputMode="decimal" className="input" defaultValue={c.amount ? tlInput(c.amount) : expected.get(c.id) ? tlInput(expected.get(c.id)) : ""} />
                  {expected.get(c.id) ? <p className="muted mt-1">Kasa fişlerine göre: {fmtTL(expected.get(c.id))}</p> : null}
                </div>
              ))}
              <div className="col-span-2">
                <label className="label" htmlFor="note">Kasa farkı / gün notu</label>
                <input id="note" name="note" className="input" defaultValue={day?.note ?? ""} placeholder="Satış ile tahsilat farklıysa açıklama zorunlu" />
              </div>
            </div>
            <div className="mt-3"><Submit>Taslağı kaydet</Submit></div>
          </section>
        </form>
      ) : (
        <section className="card overflow-x-auto">
          <h2 className="h2">Onaylı satış satırları</h2>
          <table className="tbl mt-2">
            <thead><tr><th>Ürün</th><th className="num">Adet</th><th className="num">Brüt</th><th className="num">İndirim</th><th className="num">İade</th><th className="num">Net</th></tr></thead>
            <tbody>
              {grouped.map((l, i) => (
                <tr key={i}>
                  <td>{l.name}{l.kind === "duzeltme" && <span className="badge badge-warn ml-2">Düzeltme: {l.note}</span>}{l.kind === "ikram" && <span className="badge badge-warn ml-2">İkram</span>}</td>
                  <td className="num">{fmtQty(l.qty)}</td><td className="num">{fmtTL(l.gross)}</td><td className="num">{fmtTL(l.discount)}</td>
                  <td className="num">{fmtTL(l.refund)}</td><td className="num">{fmtTL(l.gross - l.discount - l.refund)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {day && (
        <section className="card">
          <h2 className="h2">Gün sonu karşılaştırması</h2>
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-xs font-semibold text-muted">Net satış (vergi dahil)</dt><dd className="text-lg font-semibold tabular-nums">{fmtTL(Math.round(net))}</dd></div>
            <div><dt className="text-xs font-semibold text-muted">Tahsilat toplamı</dt><dd className="text-lg font-semibold tabular-nums">{fmtTL(paid)}</dd></div>
            <div><dt className="text-xs font-semibold text-muted">Fark</dt><dd className={`text-lg font-semibold tabular-nums ${paid - Math.round(net) ? "text-bad" : ""}`}>{fmtTL(paid - Math.round(net))}</dd></div>
            {approved && <div><dt className="text-xs font-semibold text-muted">POS komisyonu</dt><dd className="text-lg font-semibold tabular-nums">{fmtTL(chans.reduce((s, c) => s + (c.commission ?? 0), 0))}</dd></div>}
          </dl>
          {day.note && <p className="mt-2 text-sm">Not: {day.note}</p>}
          {!approved && (can.approveSales(u) ? (
            <form action={salesApprove} className="mt-3">
              <input type="hidden" name="date" value={date} />
              <p className="muted mb-2">Onay, reçetelere göre stoğu düşer ve günü kilitler. Sonraki değişiklikler düzeltme kaydıyla yapılır. Önce taslağı kaydettiğinizden emin olun.</p>
              <Submit>Günü onayla</Submit>
            </form>
          ) : <p className="muted mt-2">Onay için operasyon sorumlusu veya işletme sahibi gerekir.</p>)}
        </section>
      )}

      {approved && can.approveSales(u) && (
        <section className="card">
          <h2 className="h2">Düzeltme kaydı</h2>
          <p className="muted">Onaylı gün değiştirilmez; fark ayrı satır olarak eklenir. Eksiltmek için negatif değer girin.</p>
          <form action={salesCorrect} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input type="hidden" name="date" value={date} />
            <div><label className="label" htmlFor="cp">Ürün</label>
              <select id="cp" name="product_id" className="input" defaultValue=""><option value="">Ürün düzeltmesi yok</option>{prods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label" htmlFor="cq">Adet farkı (±)</label><input id="cq" name="qty" className="input" /></div>
            <div><label className="label" htmlFor="cc">Tahsilat kanalı</label>
              <select id="cc" name="channel_id" className="input" defaultValue=""><option value="">Tahsilat düzeltmesi yok</option>{chans.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="label" htmlFor="ca">Tutar farkı (± TL)</label><input id="ca" name="amount" className="input" /></div>
            <div className="col-span-2 sm:col-span-3"><label className="label" htmlFor="cn">Neden</label><input id="cn" name="note" className="input" required /></div>
            <div className="self-end"><Submit className="btn">Düzeltme ekle</Submit></div>
          </form>
        </section>
      )}

      {recent.length > 0 && (
        <section className="card">
          <h2 className="h2">Son girilen günler</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {recent.map((r) => (
              <li key={r.date} className="flex items-center justify-between">
                <Link href={`/satis?tarih=${r.date}`} className="underline underline-offset-2">{fmtDate(r.date)}</Link>
                <span className="flex items-center gap-2"><span className="tabular-nums">{fmtTL(Math.round(r.net ?? 0))}</span><span className={`badge ${r.status === "onayli" ? "badge-ok" : "badge-warn"}`}>{r.status === "onayli" ? "Onaylı" : "Taslak"}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
