"use client";

import { useState } from "react";
import { purchaseAdd } from "@/lib/pl-actions";
import { Submit } from "./client";

type L = { name: string; qty: string; price: string; vat: string };
const RATES = ["0", "1", "10", "20"];
const num = (v: string) => {
  let s = v.trim();
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const tl = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);

/** Alım: fatura toplamı + KDV oranı, ya da ürün ürün (birim fiyat KDV hariç, satır başına KDV). */
export function PurchaseForm({ supplierId, today }: { supplierId: number; today: string }) {
  const [lines, setLines] = useState<L[]>([]);
  const [amount, setAmount] = useState(""), [rate, setRate] = useState("10");
  const set = (i: number, k: keyof L, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const net = lines.reduce((s, l) => s + num(l.qty) * num(l.price), 0);
  const vat = lines.length ? lines.reduce((s, l) => s + (num(l.qty) * num(l.price) * num(l.vat)) / 100, 0) : (num(amount) * num(rate)) / (100 + num(rate));
  const total = lines.length ? net + vat : num(amount);
  return (
    <form action={purchaseAdd} className="grid gap-2">
      <input type="hidden" name="supplier_id" value={supplierId} />
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div><label className="label" htmlFor={`pd${supplierId}`}>Fatura tarihi</label><input id={`pd${supplierId}`} type="date" name="date" className="input" defaultValue={today} max={today} required /></div>
        {!lines.length && (
          <>
            <div><label className="label" htmlFor={`pa${supplierId}`}>Fatura toplamı (KDV dahil)</label>
              <input id={`pa${supplierId}`} name="amount" inputMode="decimal" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
            <div><label className="label" htmlFor={`pr${supplierId}`}>KDV oranı</label>
              <select id={`pr${supplierId}`} name="vat_rate" className="input" value={rate} onChange={(e) => setRate(e.target.value)}>{RATES.map((r) => <option key={r} value={r}>%{r}</option>)}</select></div>
          </>
        )}
        <div className={lines.length ? "col-span-2 sm:col-span-3" : ""}><label className="label" htmlFor={`pn${supplierId}`}>Not / fatura no</label><input id={`pn${supplierId}`} name="note" className="input" /></div>
      </div>
      {lines.length > 0 && (
        <div className="grid gap-2">
          <div className="hidden grid-cols-[1fr_64px_96px_72px_96px_36px] gap-2 text-xs font-semibold text-muted sm:grid">
            <span>Ürün</span><span>Miktar</span><span>Birim fiyat (KDV hariç)</span><span>KDV</span><span className="text-right">Tutar (KDV dahil)</span><span />
          </div>
          {lines.map((l, i) => {
            const n = num(l.qty) * num(l.price);
            return (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_64px_96px_72px_96px_36px]">
                <input className="input col-span-2 sm:col-span-1" placeholder="Ürün" aria-label="Ürün adı" value={l.name} onChange={(e) => set(i, "name", e.target.value)} />
                <input className="input" placeholder="Miktar" aria-label="Miktar" inputMode="decimal" value={l.qty} onChange={(e) => set(i, "qty", e.target.value)} />
                <input className="input" placeholder="Birim fiyat" aria-label="Birim fiyat, KDV hariç" inputMode="decimal" value={l.price} onChange={(e) => set(i, "price", e.target.value)} />
                <select className="input" aria-label="KDV oranı" value={l.vat} onChange={(e) => set(i, "vat", e.target.value)}>{RATES.map((r) => <option key={r} value={r}>%{r}</option>)}</select>
                <span className="self-center text-right text-sm tabular-nums">{tl(n + (n * num(l.vat)) / 100)}</span>
                <button type="button" className="btn btn-danger px-0" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Satırı sil">×</button>
              </div>
            );
          })}
        </div>
      )}
      <p className="rounded-lg bg-surface px-3 py-2 text-sm tabular-nums" aria-live="polite">
        {lines.length ? <>Ara toplam {tl(net)} · </> : null}KDV <b>{tl(vat)}</b> · Fatura toplamı <b>{tl(total)}</b>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-sm" onClick={() => setLines((ls) => [...ls, { name: "", qty: "1", price: "", vat: ls[ls.length - 1]?.vat ?? rate }])}>
          {lines.length ? "+ Satır ekle" : "Ürün ürün yaz"}
        </button>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="paid" className="size-4" /> Aynı gün ödendi</label>
        <Submit className="btn btn-primary ml-auto">Alımı kaydet</Submit>
      </div>
    </form>
  );
}
