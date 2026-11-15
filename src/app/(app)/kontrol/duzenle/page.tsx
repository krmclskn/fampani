import Link from "next/link";
import { redirect } from "next/navigation";
import { Submit } from "@/components/client";
import { checkItemRemove, checkItemSave } from "@/lib/actions";
import { can, requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { areas } from "@/lib/queries";

const GUN = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const KIND: Record<string, string> = { acilis: "Açılış", gunici: "Gün içi", kapanis: "Kapanış" };
type Item = { id: number; kind: string; area_id: number; area: string; text: string; days: string; stock_item_id: number | null; stock: string | null };

function daysLabel(d: string) {
  if (d.length === 7) return "Her gün";
  if (d === "12345") return "Hafta içi";
  if (d === "67") return "Hafta sonu";
  return `Haftada ${d.length}: ${d.split("").map((x) => GUN[Number(x) - 1]).join(", ")}`;
}

function Days({ value }: { value: string }) {
  return (
    <fieldset className="flex flex-wrap gap-1">
      <legend className="label">Hangi günler</legend>
      {GUN.map((g, i) => (
        <label key={g} className="cursor-pointer">
          <input type="checkbox" name={`d${i + 1}`} defaultChecked={value.includes(String(i + 1))} className="peer sr-only" />
          <span className="inline-flex min-h-9 min-w-11 items-center justify-center rounded-lg border border-line bg-surface px-2 text-sm font-medium text-muted peer-checked:border-accent peer-checked:bg-accent peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent">{g}</span>
        </label>
      ))}
    </fieldset>
  );
}

function ItemForm({ item, ar, stock }: { item?: Item; ar: { id: number; name: string }[]; stock: { id: number; name: string; unit: string }[] }) {
  const k = item ? `e${item.id}` : "n";
  return (
    <form action={checkItemSave} className="grid gap-3">
      {item && <input type="hidden" name="id" value={item.id} />}
      <div><label className="label" htmlFor={`${k}t`}>Yapılacak iş</label><input id={`${k}t`} name="text" className="input" defaultValue={item?.text} placeholder="Örn. Buzdolabı sıcaklığını kontrol et" required maxLength={160} /></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div><label className="label" htmlFor={`${k}k`}>Liste</label>
          <select id={`${k}k`} name="kind" className="input" defaultValue={item?.kind ?? "gunici"}>{Object.entries(KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label className="label" htmlFor={`${k}a`}>Alan</label>
          <select id={`${k}a`} name="area_id" className="input" defaultValue={item?.area_id}>{ar.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div className="col-span-2 sm:col-span-1"><label className="label" htmlFor={`${k}s`}>Stok sayımı istensin mi?</label>
          <select id={`${k}s`} name="stock_item_id" className="input" defaultValue={item?.stock_item_id ?? ""}>
            <option value="">Hayır, normal iş</option>
            {stock.map((s) => <option key={s.id} value={s.id}>Say: {s.name} ({s.unit})</option>)}
          </select></div>
      </div>
      <Days value={item?.days ?? "1234567"} />
      <div><Submit className={item ? "btn" : "btn btn-primary"}>{item ? "Kaydet" : "Maddeyi ekle"}</Submit></div>
    </form>
  );
}

export default async function Duzenle() {
  const u = await requireUser();
  if (!can.manage(u)) redirect("/kontrol");
  const items = all<Item>(
    `SELECT c.id, c.kind, c.area_id, a.name AS area, c.text, c.days, c.stock_item_id, s.name AS stock FROM checklist_items c
     JOIN areas a ON a.id=c.area_id LEFT JOIN stock_items s ON s.id=c.stock_item_id WHERE c.active=1 ORDER BY c.kind='kapanis', c.kind='gunici', c.area_id, c.position, c.id`);
  const ar = areas(), stock = all<{ id: number; name: string; unit: string }>("SELECT id,name,unit FROM stock_items WHERE active=1 ORDER BY name");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="h1">Kontrol listesini düzenle</h1>
          <p className="muted">Buraya yazdığın işler seçtiğin günlerde personelin listesine kendiliğinden düşer. Stok sayımı seçersen personel işi miktar yazarak tamamlar.</p>
        </div>
        <Link href="/kontrol" className="btn">Bugünkü listeye dön</Link>
      </div>

      <section className="card">
        <h2 className="h2 mb-3">Yeni madde</h2>
        <ItemForm ar={ar} stock={stock} />
      </section>

      {Object.entries(KIND).map(([kind, label]) => {
        const list = items.filter((i) => i.kind === kind);
        return (
          <section key={kind} className="card">
            <h2 className="h2">{label} <span className="badge ml-1">{list.length}</span></h2>
            {list.length ? (
              <ul className="mt-1">
                {list.map((i) => (
                  <li key={i.id} className="border-b border-line py-2 last:border-0">
                    <details>
                      <summary className="flex flex-wrap items-center justify-between gap-2">
                        <span>{i.text}</span>
                        <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                          {i.stock && <span className="badge">Sayım: {i.stock}</span>}
                          <span>{i.area}</span><span className="badge">{daysLabel(i.days)}</span>
                        </span>
                      </summary>
                      <div className="mt-3 grid gap-3 rounded-lg bg-bg p-3">
                        <ItemForm item={i} ar={ar} stock={stock} />
                        <form action={checkItemRemove}><input type="hidden" name="id" value={i.id} /><Submit className="btn btn-sm btn-danger">Listeden kaldır</Submit></form>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            ) : <p className="muted mt-2">Bu listede madde yok.</p>}
          </section>
        );
      })}
    </div>
  );
}
