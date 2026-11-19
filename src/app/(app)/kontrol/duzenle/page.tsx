import Link from "next/link";
import { redirect } from "next/navigation";
import { Fold, Submit } from "@/components/client";
import { checkItemRemove, checkItemSave } from "@/lib/actions";
import { can, requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { areas } from "@/lib/queries";

const GUN = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const KIND: Record<string, string> = { acilis: "Açılış", gunici: "Gün içi", kapanis: "Kapanış" };
type Item = { id: number; kind: string; area_id: number; area: string; text: string; days: string; stock_item_id: number | null; stock: string | null; assignee_id: number | null; who: string | null };
type Person = { id: number; name: string };

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

function ItemForm({ item, ar, stock, people }: { item?: Item; ar: { id: number; name: string }[]; stock: { id: number; name: string; unit: string }[]; people: Person[] }) {
  const k = item ? `e${item.id}` : "n";
  return (
    <form action={checkItemSave} className="grid gap-3">
      {item && <input type="hidden" name="id" value={item.id} />}
      <div><label className="label" htmlFor={`${k}t`}>Yapılacak iş</label><input id={`${k}t`} name="text" className="input" defaultValue={item?.text} placeholder="Örn. Buzdolabı sıcaklığını kontrol et" required maxLength={160} /></div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><label className="label" htmlFor={`${k}w`}>Kim yapacak</label>
          <select id={`${k}w`} name="assignee_id" className="input" defaultValue={item?.assignee_id ?? ""}>
            <option value="">Herkes (vardiyadaki kişi)</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <div><label className="label" htmlFor={`${k}k`}>Ne zaman</label>
          <select id={`${k}k`} name="kind" className="input" defaultValue={item?.kind ?? "gunici"}>{Object.entries(KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label className="label" htmlFor={`${k}a`}>Alan</label>
          <select id={`${k}a`} name="area_id" className="input" defaultValue={item?.area_id}>{ar.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
        <div><label className="label" htmlFor={`${k}s`}>Stok sayımı istensin mi?</label>
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
  const items = await all<Item>(
    `SELECT c.id, c.kind, c.area_id, a.name AS area, c.text, c.days, c.stock_item_id, s.name AS stock, c.assignee_id, us.name AS who FROM checklist_items c
     JOIN areas a ON a.id=c.area_id LEFT JOIN stock_items s ON s.id=c.stock_item_id LEFT JOIN users us ON us.id=c.assignee_id WHERE c.active=1 ORDER BY c.kind='kapanis', c.kind='gunici', c.area_id, c.position, c.id`);
  const people = await all<Person>("SELECT id,name FROM users WHERE active=1 ORDER BY name");
  const rows: { id: number | null; name: string }[] = [...people.filter((p) => items.some((i) => i.assignee_id === p.id)), { id: null, name: "Herkes" }];
  const ar = await areas(), stock = await all<{ id: number; name: string; unit: string }>("SELECT id,name,unit FROM stock_items WHERE active=1 ORDER BY name");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="h1">İşler ve atamalar</h1>
          <p className="muted">İşi yaz, kimin yapacağını ve hangi günler yapılacağını seç. Seçtiğin günlerde o kişinin listesine kendiliğinden düşer. Stok sayımı seçersen kişi işi miktar yazarak tamamlar.</p>
        </div>
        <Link href="/kontrol" className="btn">Bugünkü listeyi gör</Link>
      </div>

      <Fold id="duzenle:yeni" title="+ Yeni iş ekle">
        <ItemForm ar={ar} stock={stock} people={people} />
      </Fold>

      <Fold id="duzenle:plan" title="Haftalık plan: kim, hangi gün, ne yapıyor" defaultOpen>
        <div className="overflow-x-auto">
        <table className="tbl min-w-[640px]">
          <thead><tr><th>Kişi</th>{GUN.map((g) => <th key={g}>{g}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id ?? 0}>
                <td className="whitespace-nowrap font-medium">{r.name}</td>
                {GUN.map((g, d) => {
                  const list = items.filter((i) => i.assignee_id === r.id && i.days.includes(String(d + 1)));
                  return (
                    <td key={g} className="text-xs">
                      {list.length === 0 ? <span className="text-muted">–</span> : list.length > 4 ? (
                        <details><summary className="font-medium text-accent underline underline-offset-2">{list.length} iş</summary>
                          <ul className="mt-1 grid gap-0.5">{list.map((i) => <li key={i.id}>{i.text}</li>)}</ul></details>
                      ) : <ul className="grid gap-0.5">{list.map((i) => <li key={i.id}>{i.text}</li>)}</ul>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Fold>

      {Object.entries(KIND).map(([kind, label]) => {
        const list = items.filter((i) => i.kind === kind);
        return (
          <Fold key={kind} id={`duzenle:${kind}`} title={`${label} işleri`} count={list.length}>
            {list.length ? (
              <ul>
                {list.map((i) => (
                  <li key={i.id} className="border-b border-line py-2 last:border-0">
                    <details>
                      <summary className="flex flex-wrap items-center justify-between gap-2">
                        <span>{i.text}</span>
                        <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                          {i.stock && <span className="badge">Sayım: {i.stock}</span>}
                          <span className="badge badge-ok">{i.who ?? "Herkes"}</span>
                          <span>{i.area}</span><span className="badge">{daysLabel(i.days)}</span>
                        </span>
                      </summary>
                      <div className="mt-3 grid gap-3 rounded-lg bg-bg p-3">
                        <ItemForm item={i} ar={ar} stock={stock} people={people} />
                        <form action={checkItemRemove}><input type="hidden" name="id" value={i.id} /><Submit className="btn btn-sm btn-danger">Listeden kaldır</Submit></form>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Bu listede madde yok.</p>}
          </Fold>
        );
      })}
    </div>
  );
}
