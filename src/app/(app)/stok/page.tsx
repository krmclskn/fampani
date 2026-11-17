import { Submit } from "@/components/client";
import { itemSave, orderCancel, orderPlace, orderReceive, stockCount } from "@/lib/actions";
import { can, requireUser } from "@/lib/auth";
import { all, ensureStockRequests } from "@/lib/db";
import { stockItems, type ItemV } from "@/lib/queries";
import { LOCATIONS, UNITS, fmtDateTime, fmtQty } from "@/lib/util";

type Order = { id: number; status: string; item: string; unit: string; qty: number; min_level: number; qty_requested: number; qty_order: number | null; ordered_at: string | null; orderer: string | null };

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

export default async function Stok() {
  const u = await requireUser();
  await ensureStockRequests(u.id);
  const items = await stockItems(), manage = can.orderPurchase(u);
  const orders = await all<Order>(
    `SELECT p.id, p.status, i.name AS item, i.unit, i.qty, i.min_level, p.qty_requested, p.qty_order, p.ordered_at, us.name AS orderer
     FROM purchases p JOIN stock_items i ON i.id=p.item_id LEFT JOIN users us ON us.id=p.ordered_by
     WHERE p.status IN ('talep','onay_bekliyor','onaylandi','siparis','eksik_teslim') ORDER BY p.id`);
  const toOrder = orders.filter((o) => !["siparis", "eksik_teslim"].includes(o.status)), waiting = orders.filter((o) => ["siparis", "eksik_teslim"].includes(o.status));
  const locs = [...new Set(items.map((i) => i.location))];
  const low = items.filter((i) => i.min_level > 0 && i.qty < i.min_level).length;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Stok</h1>
        <p className="muted">{items.length} ürün · {low} tanesi minimumun altında. Minimumun altına inen ürün kendiliğinden sipariş listesine düşer.</p>
      </div>

      {(toOrder.length > 0 || waiting.length > 0) && (
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="card border-[#f0d6a8] bg-[#fdf6e7]">
            <h2 className="h2">1 · Sipariş verilecek <span className="badge badge-warn ml-1">{toOrder.length}</span></h2>
            {toOrder.length ? (
              <ul className="mt-1">
                {toOrder.map((o) => (
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
            ) : <p className="muted mt-2">Sipariş bekleyen ürün yok.</p>}
          </div>
          <div className="card">
            <h2 className="h2">2 · Teslimat bekleniyor <span className="badge ml-1">{waiting.length}</span></h2>
            {waiting.length ? (
              <ul className="mt-1">
                {waiting.map((o) => (
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
            ) : <p className="muted mt-2">Yolda sipariş yok.</p>}
          </div>
        </section>
      )}

      {locs.map((loc) => (
        <section key={loc} className="card">
          <h2 className="h2">{loc}</h2>
          <ul className="mt-1">
            {items.filter((i) => i.location === loc).map((i) => {
              const under = i.min_level > 0 && i.qty < i.min_level;
              return (
                <li key={i.id} className="border-b border-line py-2 last:border-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-40 flex-1">
                      <span className="font-medium">{i.name}</span>
                      <span className="block text-sm text-muted">minimum {fmtQty(i.min_level)} {i.unit}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      {under && <span className="badge badge-bad">Minimum altı</span>}
                      <span className="text-lg font-semibold tabular-nums">{fmtQty(i.qty)} <span className="text-sm font-normal text-muted">{i.unit}</span></span>
                    </span>
                    <form action={stockCount} className="flex items-center gap-2">
                      <input type="hidden" name="item_id" value={i.id} />
                      <input name="counted" inputMode="decimal" className="input w-24" placeholder="Sayım" aria-label={`${i.name} sayılan miktar (${i.unit})`} required />
                      <Submit className="btn btn-sm">Kaydet</Submit>
                    </form>
                  </div>
                  {can.editStock(u) && (
                    <details className="mt-1">
                      <summary className="text-xs font-medium text-muted underline underline-offset-2">Ürünü düzenle</summary>
                      <div className="mt-2 rounded-lg bg-bg p-3"><ItemForm i={i} /></div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {can.editStock(u) && (
        <section className="card">
          <h2 className="h2 mb-3">Yeni ürün</h2>
          <ItemForm />
        </section>
      )}
    </div>
  );
}
