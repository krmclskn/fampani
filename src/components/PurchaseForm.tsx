"use client";

import { useState } from "react";
import { purchaseAdd } from "@/lib/pl-actions";
import { Submit } from "./client";

type L = { name: string; qty: string; price: string };
const num = (v: string) => {
  let s = v.trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const tl = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);

/** Alım girişi: yalnızca toplam tutar ya da ürünleri tek tek yazarak. */
export function PurchaseForm({ supplierId, today }: { supplierId: number; today: string }) {
  const [lines, setLines] = useState<L[]>([]);
  const set = (i: number, k: keyof L, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const total = lines.reduce((s, l) => s + num(l.qty) * num(l.price), 0);
  return (
    <form action={purchaseAdd} className="grid gap-2">
      <input type="hidden" name="supplier_id" value={supplierId} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><label className="label" htmlFor={`pd${supplierId}`}>Tarih</label><input id={`pd${supplierId}`} type="date" name="date" className="input" defaultValue={today} max={today} required /></div>
        <div>
          <label className="label" htmlFor={`pa${supplierId}`}>Toplam tutar (TL)</label>
          {lines.length
            ? <p className="input flex items-center bg-bg font-semibold tabular-nums" aria-live="polite">{tl(total)}</p>
            : <input id={`pa${supplierId}`} name="amount" inputMode="decimal" className="input" required />}
        </div>
        <div className="col-span-2"><label className="label" htmlFor={`pn${supplierId}`}>Not / fatura no</label><input id={`pn${supplierId}`} name="note" className="input" /></div>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_70px_90px_36px] gap-2">
          <input className="input" placeholder="Ürün" aria-label="Ürün adı" value={l.name} onChange={(e) => set(i, "name", e.target.value)} />
          <input className="input" placeholder="Miktar" aria-label="Miktar" inputMode="decimal" value={l.qty} onChange={(e) => set(i, "qty", e.target.value)} />
          <input className="input" placeholder="Birim fiyat" aria-label="Birim fiyat" inputMode="decimal" value={l.price} onChange={(e) => set(i, "price", e.target.value)} />
          <button type="button" className="btn btn-danger px-0" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Satırı sil">×</button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-sm" onClick={() => setLines((ls) => [...ls, { name: "", qty: "1", price: "" }])}>+ Ürün satırı ekle</button>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="paid" className="size-4" /> Aynı gün ödendi</label>
        <Submit className="btn btn-primary ml-auto">Alımı kaydet</Submit>
      </div>
    </form>
  );
}
