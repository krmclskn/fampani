import Link from "next/link";
import { Submit } from "@/components/client";
import { countDecide, itemSave, shortageReport, stockCount, supplierSave } from "@/lib/actions";
import { can, requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { level, stockItems, type ItemV } from "@/lib/queries";
import { LOCATIONS, UNITS, fmtDateTime, fmtQty, fmtTL } from "@/lib/util";

function ItemForm({ i, suppliers }: { i?: ItemV; suppliers: { id: number; name: string }[] }) {
  const p = i ? `e${i.id}` : "new";
  return (
    <form action={itemSave} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {i && <input type="hidden" name="id" value={i.id} />}
      <div className="col-span-2"><label className="label" htmlFor={`${p}n`}>Ürün adı</label><input id={`${p}n`} name="name" className="input" defaultValue={i?.name} required /></div>
      <div><label className="label" htmlFor={`${p}c`}>Kategori</label><input id={`${p}c`} name="category" className="input" defaultValue={i?.category ?? ""} /></div>
      <div><label className="label" htmlFor={`${p}u`}>Birim</label>
        <select id={`${p}u`} name="unit" className="input" defaultValue={i?.unit}>{UNITS.map((x) => <option key={x}>{x}</option>)}</select></div>
      <div className="col-span-2"><label className="label" htmlFor={`${p}l`}>Depo / konum</label>
        <select id={`${p}l`} name="location" className="input" defaultValue={i?.location}>{LOCATIONS.map((x) => <option key={x}>{x}</option>)}</select></div>
      <div><label className="label" htmlFor={`${p}m`}>Minimum seviye</label><input id={`${p}m`} name="min_level" inputMode="decimal" className="input" defaultValue={i?.min_level ?? ""} required /></div>
      <div><label className="label" htmlFor={`${p}k`}>Kritik seviye</label><input id={`${p}k`} name="critical_level" inputMode="decimal" className="input" defaultValue={i?.critical_level ?? ""} required /></div>
      <div className="col-span-2"><label className="label" htmlFor={`${p}s`}>Tercih edilen tedarikçi</label>
        <select id={`${p}s`} name="supplier_id" className="input" defaultValue={i?.supplier_id ?? ""}>
          <option value="">Yok</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select></div>
      {!i && <div><label className="label" htmlFor="newq">Açılış miktarı</label><input id="newq" name="qty" inputMode="decimal" className="input" defaultValue="0" /></div>}
      <div className="col-span-2 self-end sm:col-span-1"><Submit className="btn">{i ? "Kartı kaydet" : "Stok kartı aç"}</Submit></div>
    </form>
  );
}

export default async function Stok() {
  const u = await requireUser();
  const items = stockItems();
  const suppliers = all<{ id: number; name: string; delivery_days: string | null; payment_terms: string | null }>("SELECT * FROM suppliers ORDER BY name");
  const pending = can.approveCount(u)
    ? all<{ id: number; name: string; unit: string; previous: number; counted: number; note: string | null; by: string; counted_at: string }>(
        `SELECT c.*, i.name, i.unit, us.name AS by FROM stock_counts c JOIN stock_items i ON i.id=c.item_id JOIN users us ON us.id=c.counted_by
         WHERE c.status='onay_bekliyor' ORDER BY c.id`)
    : [];
  const locs = [...new Set(items.map((i) => i.location))];
  const crit = items.filter((i) => level(i) === "kritik").length, low = items.filter((i) => level(i) === "dusuk").length;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Stok</h1>
        <p className="muted">
          {crit} kritik, {low} minimum altında kalem. Bir kalemi açıp sayım girebilir veya eksik bildirebilirsin.
        </p>
      </div>

      {pending.length > 0 && (
        <section className="card border-[#f0d6a8] bg-[#fdf6e7]">
          <h2 className="h2">Onay bekleyen sayım farkları</h2>
          <ul className="mt-2 grid gap-3">
            {pending.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  <b>{c.name}</b>: kayıt {fmtQty(c.previous)} → sayım {fmtQty(c.counted)} {c.unit}{" "}
                  <span className="text-bad">({c.counted - c.previous > 0 ? "+" : ""}{fmtQty(c.counted - c.previous)})</span>
                  <span className="muted block">{c.by}, {fmtDateTime(c.counted_at)} · {c.note}</span>
                </span>
                <form action={countDecide} className="flex gap-2">
                  <input type="hidden" name="id" value={c.id} />
                  <Submit className="btn btn-primary btn-sm" name="karar" value="onay">Farkı onayla</Submit>
                  <Submit className="btn btn-sm" name="karar" value="red">Yeniden sayılsın</Submit>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {locs.map((loc) => (
        <section key={loc} className="card">
          <h2 className="h2">{loc}</h2>
          <ul className="mt-1">
            {items.filter((i) => i.location === loc).map((i) => {
              const lv = level(i);
              return (
                <li key={i.id} className="border-b border-line py-2 last:border-0">
                  <details>
                    <summary className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{i.name} <span className="font-normal text-muted">{i.category}</span></span>
                      <span className="flex items-center gap-2">
                        {i.open_purchase && <span className="badge">Talep #{i.open_purchase}</span>}
                        {lv !== "ok" && <span className={`badge ${lv === "kritik" ? "badge-bad" : "badge-warn"}`}>{lv === "kritik" ? "Kritik" : "Minimum altı"}</span>}
                        <span className="tabular-nums">{fmtQty(i.qty)} {i.unit}</span>
                      </span>
                    </summary>
                    <div className="mt-2 grid gap-3 rounded-lg bg-bg p-3">
                      <p className="muted">
                        Minimum {fmtQty(i.min_level)} · kritik {fmtQty(i.critical_level)} {i.unit} · tedarikçi: {i.supplier ?? "–"} · son alış: {fmtTL(i.last_price)}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <form action={stockCount} className="grid content-start gap-2">
                          <input type="hidden" name="item_id" value={i.id} />
                          <label className="label" htmlFor={`c${i.id}`}>Sayım: fiziksel miktar ({i.unit})</label>
                          <input id={`c${i.id}`} name="counted" inputMode="decimal" className="input" required />
                          <input name="note" className="input" placeholder="Fark varsa nedeni" aria-label="Fark nedeni" />
                          <Submit className="btn btn-sm">Sayımı kaydet</Submit>
                        </form>
                        <form action={shortageReport} className="grid content-start gap-2">
                          <input type="hidden" name="item_id" value={i.id} />
                          <label className="label" htmlFor={`s${i.id}`}>Eksik bildir: ihtiyaç ({i.unit})</label>
                          <input id={`s${i.id}`} name="qty" inputMode="decimal" className="input" required />
                          <input name="note" className="input" placeholder="Not (isteğe bağlı)" aria-label="Not" />
                          {i.open_purchase && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="force" className="size-4" /> Açık talep var, yine de yeni talep aç</label>}
                          <Submit className="btn btn-sm">Eksik bildir</Submit>
                        </form>
                      </div>
                      {can.editStock(u) && (
                        <details>
                          <summary className="text-sm font-medium text-muted underline underline-offset-2">Stok kartını düzenle</summary>
                          <div className="mt-3"><ItemForm i={i} suppliers={suppliers} /></div>
                        </details>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {can.editStock(u) && (
        <section className="card">
          <h2 className="h2">Yeni stok kartı</h2>
          <div className="mt-3"><ItemForm suppliers={suppliers} /></div>
        </section>
      )}

      <section className="card">
        <h2 className="h2">Tedarikçiler</h2>
        <ul className="mt-2 grid gap-1 text-sm">
          {suppliers.map((s) => <li key={s.id}>{s.name} <span className="text-muted">· teslimat: {s.delivery_days ?? "–"} · {s.payment_terms ?? "–"}</span></li>)}
        </ul>
        {can.reviewPurchase(u) && (
          <form action={supplierSave} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input name="name" className="input" placeholder="Tedarikçi adı" aria-label="Tedarikçi adı" required />
            <input name="contact" className="input" placeholder="İletişim" aria-label="İletişim" />
            <input name="delivery_days" className="input" placeholder="Teslimat günleri" aria-label="Teslimat günleri" />
            <input name="payment_terms" className="input" placeholder="Ödeme koşulu" aria-label="Ödeme koşulu" />
            <div className="col-span-2"><Submit className="btn">Tedarikçi ekle</Submit></div>
          </form>
        )}
      </section>
      <p className="muted">Açık taleplerin durumu için <Link href="/satinalma" className="underline">Satın alma</Link> sayfasına bak.</p>
    </div>
  );
}
