import { FEATURES } from "@/lib/util";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Submit } from "@/components/client";
import { can, requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { productSave, recipeRemove, recipeSet } from "@/lib/finance-actions";
import { productStats, products, unitMargin, type ProductV } from "@/lib/finance";
import { fmtQty, fmtTL, tlInput } from "@/lib/util";

const pct = (n: number | null) => (n == null ? "–" : `%${fmtQty(Math.round(n * 10) / 10)}`);

function ProductForm({ p }: { p?: ProductV }) {
  const k = p ? `p${p.id}` : "pn";
  return (
    <form action={productSave} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="col-span-2"><label className="label" htmlFor={`${k}n`}>Ürün adı</label><input id={`${k}n`} name="name" className="input" defaultValue={p?.name} required /></div>
      <div><label className="label" htmlFor={`${k}c`}>Kategori</label><input id={`${k}c`} name="category" className="input" defaultValue={p?.category ?? ""} /></div>
      <div><label className="label" htmlFor={`${k}f`}>Satış fiyatı (TL, vergi dahil)</label><input id={`${k}f`} name="price" inputMode="decimal" className="input" defaultValue={tlInput(p?.price)} required /></div>
      <div><label className="label" htmlFor={`${k}t`}>Vergi oranı (%)</label><input id={`${k}t`} name="tax_rate" inputMode="decimal" className="input" defaultValue={p?.tax_rate ?? ""} required /></div>
      <div><label className="label" htmlFor={`${k}a`}>Reçete dışı ambalaj (TL)</label><input id={`${k}a`} name="packaging_cost" inputMode="decimal" className="input" defaultValue={tlInput(p?.packaging_cost ?? 0)} /></div>
      {p && <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="active" className="size-4" defaultChecked={!!p.active} /> Satışta</label>}
      <div className="self-end"><Submit className="btn">{p ? "Ürünü kaydet" : "Ürün ekle"}</Submit></div>
    </form>
  );
}

export default async function Urunler({ searchParams }: { searchParams: Promise<{ gun?: string }> }) {
  const u = await requireUser();
  if (!FEATURES.kasa) redirect("/");
  if (!can.editProducts(u)) redirect("/");
  const days = [7, 30, 90, 365].includes(Number((await searchParams).gun)) ? Number((await searchParams).gun) : 30;
  const list = products();
  const recipes = all<{ id: number; product_id: number; item_id: number; qty: number; name: string; unit: string; last_price: number | null }>(
    "SELECT r.*, i.name, i.unit, i.last_price FROM recipe_items r JOIN stock_items i ON i.id=r.item_id ORDER BY i.name");
  const items = all<{ id: number; name: string; unit: string }>("SELECT id,name,unit FROM stock_items WHERE active=1 ORDER BY name");
  const stats = can.seeFinance(u) ? productStats(days) : [];

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Ürünler ve reçeteler</h1>
        <p className="muted">Reçete, satış onaylandığında stoktan düşülecek malzemeyi ve ürün maliyetini belirler. Maliyet son alış fiyatından hesaplanır.</p>
      </div>

      {can.seeFinance(u) && (
        <section className="card overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="h2">Ürün kârlılığı · son {days} gün</h2>
            <div className="flex gap-1">
              {[7, 30, 90, 365].map((d) => <Link key={d} href={`/urunler?gun=${d}`} className={`btn btn-sm ${d === days ? "btn-primary" : ""}`}>{d} gün</Link>)}
            </div>
          </div>
          {stats.length ? (
            <table className="tbl mt-2">
              <thead><tr><th>Ürün</th><th className="num">Adet</th><th className="num">İkram</th><th className="num">Net satış (vergi hariç)</th><th className="num">İndirim/iade</th><th className="num">Reçete + ambalaj</th><th className="num">POS komisyonu</th><th className="num">Katkı payı</th><th className="num">Marj</th></tr></thead>
              <tbody>
                {stats.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td><td className="num">{fmtQty(s.adet)}</td><td className="num">{fmtQty(s.ikram)}</td><td className="num">{fmtTL(Math.round(s.netHaric))}</td>
                    <td className="num">{fmtTL(s.indirim)}</td><td className="num">{fmtTL(Math.round(s.maliyet))}</td><td className="num">{fmtTL(Math.round(s.komisyon))}</td>
                    <td className={`num font-semibold ${s.katki < 0 ? "text-bad" : ""}`}>{fmtTL(Math.round(s.katki))}</td><td className="num">{pct(s.marj)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted mt-2">Bu dönemde onaylanmış satış yok.</p>}
          <p className="muted mt-2">Katkı payı = vergi hariç net satış − reçete ve ambalaj − ürüne düşen POS komisyonu. İkramların maliyeti ürünün maliyetine eklenir. Kira, personel gibi genel giderler dahil değildir. Sıralama katkı payına göredir; “çok satan” ile “çok kazandıran” aynı olmayabilir.</p>
        </section>
      )}

      {list.map((p) => {
        const m = unitMargin(p), rec = recipes.filter((r) => r.product_id === p.id);
        return (
          <section key={p.id} className="card">
            <details>
              <summary className="flex flex-wrap items-center justify-between gap-2">
                <span className={`font-medium ${p.active ? "" : "text-muted line-through"}`}>{p.name} <span className="font-normal text-muted">{p.category}</span></span>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  {p.recipe_n === 0 && <span className="badge badge-bad">Reçete yok</span>}
                  {p.missing_price > 0 && <span className="badge badge-warn">{p.missing_price} malzemenin alış fiyatı yok</span>}
                  <span>{fmtTL(p.price)}</span>
                  <span className="text-muted">maliyet {fmtTL(Math.round(m.cost))} · birim katkı {fmtTL(Math.round(m.katki))} ({pct(m.marj)})</span>
                </span>
              </summary>
              <div className="mt-3 grid gap-4 rounded-lg bg-bg p-3">
                <div>
                  <h3 className="label">Reçete (1 satış için)</h3>
                  {rec.length ? (
                    <ul className="grid gap-1 text-sm">
                      {rec.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                          <span>{r.name}: {fmtQty(r.qty)} {r.unit} <span className="text-muted">× {fmtTL(r.last_price)} = {r.last_price != null ? fmtTL(Math.round(r.qty * r.last_price)) : "fiyat yok"}</span></span>
                          <form action={recipeRemove}><input type="hidden" name="id" value={r.id} /><Submit className="btn btn-sm btn-danger">Çıkar</Submit></form>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="muted">Reçete tanımlı değil; satışta stok düşülmez ve maliyet 0 görünür.</p>}
                  <form action={recipeSet} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="product_id" value={p.id} />
                    <div><label className="label" htmlFor={`ri${p.id}`}>Malzeme</label>
                      <select id={`ri${p.id}`} name="item_id" className="input">{items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></div>
                    <div><label className="label" htmlFor={`rq${p.id}`}>Miktar</label><input id={`rq${p.id}`} name="qty" inputMode="decimal" className="input w-28" required /></div>
                    <Submit className="btn">Ekle / güncelle</Submit>
                  </form>
                </div>
                <ProductForm p={p} />
              </div>
            </details>
          </section>
        );
      })}

      <section className="card">
        <h2 className="h2">Yeni ürün</h2>
        <div className="mt-3"><ProductForm /></div>
      </section>
    </div>
  );
}
