import Link from "next/link";
import { CountHint, Fold, Submit } from "@/components/client";
import { itemSave, orderCancel, orderPlace, orderReceive, stockCountBulk, stockReorder } from "@/lib/actions";
import { can, requireUser } from "@/lib/auth";
import { all, ensureStockRequests } from "@/lib/db";
import { stockItems, type ItemV } from "@/lib/queries";
import { LOCATIONS, UNITS, fmtDateTime, fmtQty } from "@/lib/util";

type Order = { id: number; status: string; item: string; location: string; unit: string; qty: number; min_level: number; qty_requested: number; qty_order: number | null; ordered_at: string | null; orderer: string | null };

function ItemForm({ i }: { i?: ItemV }) {
  const p = i ? `e${i.id}` : "new";
  return (
    <form action={itemSave} className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {i && <input type="hidden" name="id" value={i.id} />}
      <div className="col-span-2"><label className="label" htmlFor={`${p}n`}>Ürün adı</label><input id={`${p}n`} name="name" className="input" defaultValue={i?.name} required /></div>
      <div><label className="label" htmlFor={`${p}u`}>Birim</label>
        <select id={`${p}u`} name="unit" className="input" defaultValue={i?.unit}>{UNITS.map((x) => <option key={x}>{x}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}l`}>Yeri</label>
        <select id={`${p}l`} name="location" className="input" defaultValue={i?.location}>{LOCATIONS.map((x) => <option key={x}>{x}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}m`}>Minimum stok</label><input id={`${p}m`} name="min_level" inputMode="decimal" className="input" defaultValue={i?.min_level ?? ""} required /></div>
      {!i && <div><label className="label" htmlFor="newq">Şu anki miktar</label><input id="newq" name="qty" inputMode="decimal" className="input" defaultValue="0" /></div>}
      <div className="self-end"><Submit className="btn">{i ? "Kaydet" : "Ürünü ekle"}</Submit></div>
    </form>
  );
}

/** Listeyi kategoriye (yere) göre açılır alt başlıklara böler; tek kategori varsa düz gösterir. */
function ByLocation({ id, list, render, sub = "border-line" }: { id: string; list: Order[]; render: (rows: Order[]) => React.ReactNode; sub?: string }) {
  const locs = [...new Set(list.map((o) => o.location))];
  if (locs.length < 2) return <>{render(list)}</>;
  return (
    <div className="grid gap-2">
      {locs.map((loc) => {
        const rows = list.filter((o) => o.location === loc);
        return (
          <Fold key={loc} id={`stok:${id}:${loc}`} title={<span className="text-sm">{loc}</span>} count={rows.length} className={`rounded-lg border bg-surface px-3 py-2 ${sub}`}>
            {render(rows)}
          </Fold>
        );
      })}
    </div>
  );
}

export default async function Stok({ searchParams }: { searchParams: Promise<{ sirala?: string }> }) {
  const u = await requireUser();
  const canSort = can.editStock(u), sortMode = canSort && (await searchParams).sirala === "1";
  await ensureStockRequests(u.id);
  const items = await stockItems(), manage = can.orderPurchase(u);
  const orders = await all<Order>(
    `SELECT p.id, p.status, i.name AS item, i.location, i.unit, i.qty, i.min_level, p.qty_requested, p.qty_order, p.ordered_at, us.name AS orderer
     FROM purchases p JOIN stock_items i ON i.id=p.item_id LEFT JOIN users us ON us.id=p.ordered_by
     WHERE p.status IN ('talep','onay_bekliyor','onaylandi','siparis','eksik_teslim') ORDER BY i.location, i.name`);
  const toOrder = orders.filter((o) => !["siparis", "eksik_teslim"].includes(o.status)), waiting = orders.filter((o) => ["siparis", "eksik_teslim"].includes(o.status));
  const locs = [...new Set(items.map((i) => i.location))];
  const low = items.filter((i) => i.min_level > 0 && i.qty < i.min_level).length;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Stok</h1>
        <p className="muted">{items.length} ürün · {low} tanesi minimumun altında. Minimumun altına inen ürün kendiliğinden sipariş listesine düşer.</p>
      </div>

      <Fold id="stok:siparis" title="Sipariş verilecek" count={toOrder.length} tone={toOrder.length ? "warn" : undefined}
        className={`card ${toOrder.length ? "border-[#f0d6a8] bg-[#fdf6e7]" : ""}`}>
        {toOrder.length ? <ByLocation id="siparis" list={toOrder} sub="border-[#f0d6a8]" render={(rows) => (
          <ul>
            {rows.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f0d6a8] py-2 last:border-0">
                <span className="text-sm"><b className="font-medium">{o.item}</b><span className="block text-muted">stokta {fmtQty(o.qty)} {o.unit} · minimum {fmtQty(o.min_level)}</span></span>
                {manage ? (
                  <form action={orderPlace} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={o.id} />
                    <input name="qty" inputMode="decimal" className="input w-24" defaultValue={fmtQty(Math.ceil(o.qty_requested))} aria-label={`${o.item} sipariş miktarı (${o.unit})`} required />
                    <span className="text-sm text-muted">{o.unit}</span>
                    <Submit className="btn btn-primary btn-sm">Sipariş verdim</Submit>
                  </form>
                ) : <span className="badge badge-warn">Yönetici sipariş verecek</span>}
              </li>
            ))}
          </ul>
        )} /> : <p className="muted">Sipariş bekleyen ürün yok.</p>}
      </Fold>

      <Fold id="stok:teslimat" title="Teslimat bekleniyor" count={waiting.length}>
        {waiting.length ? <ByLocation id="teslimat" list={waiting} render={(rows) => (
          <ul>
            {rows.map((o) => (
              <li key={o.id} className="border-b border-line py-2 last:border-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm"><b className="font-medium">{o.item}</b><span className="block text-muted">{fmtQty(o.qty_order)} {o.unit} sipariş edildi · {o.orderer}, {fmtDateTime(o.ordered_at)}</span></span>
                  {can.receivePurchase(u) ? (
                    <form action={orderReceive} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={o.id} />
                      <input name="qty" inputMode="decimal" className="input w-24" defaultValue={fmtQty(o.qty_order)} aria-label={`${o.item} gelen miktar (${o.unit})`} required />
                      <span className="text-sm text-muted">{o.unit} geldi</span>
                      <Submit className="btn btn-primary btn-sm">Teslim aldım</Submit>
                    </form>
                  ) : <span className="badge">Yolda</span>}
                </div>
                {manage && <form action={orderCancel} className="mt-1"><input type="hidden" name="id" value={o.id} /><Submit className="text-xs text-muted underline underline-offset-2">Siparişi iptal et</Submit></form>}
              </li>
            ))}
          </ul>
        )} /> : <p className="muted">Yolda sipariş yok.</p>}
      </Fold>

      <section className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <h2 className="h2">Stok ürünleri <span className="muted font-normal">· {items.length} ürün, {locs.length} kategori</span></h2>
          {canSort && (sortMode
            ? <Link href="/stok" className="btn btn-sm btn-primary">Sıralama bitti</Link>
            : <Link href="/stok?sirala=1" className="btn btn-sm">↕ Sırayı düzenle</Link>)}
        </div>
        {sortMode
          ? <p className="muted px-1">Okları kullanarak ürünlerin sayım listesindeki sırasını ayarla. Değişiklik hemen kaydedilir.</p>
          : <p className="muted px-1">Saydığın ürünlerin miktarını yaz, en alttaki <b className="text-ink">Sayımı kaydet</b> ile hepsini birden kaydet. Boş bıraktığın ürün değişmez.</p>}
        {locs.map((loc) => {
          const list = items.filter((i) => i.location === loc);
          const lowHere = list.filter((i) => i.min_level > 0 && i.qty < i.min_level).length;
          return (
            <Fold key={loc} id={`stok:yer:${loc}`} title={loc} count={list.length} defaultOpen={sortMode}
              meta={lowHere ? <span className="badge badge-bad">{lowHere} minimum altı</span> : null}>
              <ul>
                {list.map((i, idx) => {
                  const under = i.min_level > 0 && i.qty < i.min_level;
                  return (
                    <li key={i.id} className="border-b border-line py-2 last:border-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        {sortMode && (
                          <form action={stockReorder} className="flex gap-1">
                            <button type="submit" name="move" value={`${i.id}:top`} className="btn btn-sm px-2" disabled={idx === 0} aria-label={`${i.name} en üste`} title="En üste">⤒</button>
                            <button type="submit" name="move" value={`${i.id}:up`} className="btn btn-sm px-2" disabled={idx === 0} aria-label={`${i.name} yukarı`} title="Yukarı">↑</button>
                            <button type="submit" name="move" value={`${i.id}:down`} className="btn btn-sm px-2" disabled={idx === list.length - 1} aria-label={`${i.name} aşağı`} title="Aşağı">↓</button>
                          </form>
                        )}
                        <span className="min-w-40 flex-1">
                          <span className="font-medium">{i.name}</span>
                          <span className="block text-sm text-muted">minimum {fmtQty(i.min_level)} {i.unit}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          {under && <span className="badge badge-bad">Minimum altı</span>}
                          <span className="text-lg font-semibold tabular-nums">{fmtQty(i.qty)} <span className="text-sm font-normal text-muted">{i.unit}</span></span>
                        </span>
                        {!sortMode && (
                          <label className="flex items-center gap-2">
                            <input form="sayim" name={`c_${i.id}`} inputMode="decimal" className="input w-24" placeholder="Sayım" aria-label={`${i.name} sayılan miktar (${i.unit})`} autoComplete="off" />
                            <span className="w-10 text-sm text-muted">{i.unit}</span>
                          </label>
                        )}
                      </div>
                      {!sortMode && can.editStock(u) && (
                        <details className="mt-1">
                          <summary className="text-xs font-medium text-muted underline underline-offset-2">Ürünü düzenle</summary>
                          <div className="mt-2 rounded-lg bg-bg p-3"><ItemForm i={i} /></div>
                        </details>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Fold>
          );
        })}
        {!sortMode && (
          <form id="sayim" action={stockCountBulk} className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface p-3 shadow-md">
            <CountHint form="sayim" />
            <Submit className="btn btn-primary">Sayımı kaydet</Submit>
          </form>
        )}
      </section>

      {can.editStock(u) && !sortMode && (
        <Fold id="stok:yeni" title="+ Yeni ürün ekle">
          <ItemForm />
        </Fold>
      )}
    </div>
  );
}
