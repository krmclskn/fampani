"use client";

import { useState } from "react";
import { kasaSale } from "@/lib/finance-actions";
import { Submit } from "./client";

type P = { id: number; name: string; category: string | null; price: number };
const tl = (k: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(k / 100);

export function Kasa({ products, channels, users, me, locked }: {
  products: P[]; channels: { id: number; name: string }[]; users: { id: number; name: string }[]; me: number; locked: boolean;
}) {
  const [cart, setCart] = useState<Record<number, number>>({});
  const [mode, setMode] = useState<string>(channels[0] ? String(channels[0].id) : "ikram");
  const add = (id: number, d: number) =>
    setCart((c) => {
      const n = (c[id] ?? 0) + d;
      const next = { ...c };
      if (n <= 0) delete next[id]; else next[id] = n;
      return next;
    });
  const lines = products.filter((p) => cart[p.id]);
  const count = lines.reduce((s, p) => s + cart[p.id], 0);
  const total = lines.reduce((s, p) => s + cart[p.id] * p.price, 0);
  const ikram = mode === "ikram";
  const cats = [...new Set(products.map((p) => p.category ?? "Diğer"))];

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-4">
        {cats.map((cat) => (
          <section key={cat}>
            <h2 className="label">{cat}</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {products.filter((p) => (p.category ?? "Diğer") === cat).map((p) => (
                <button key={p.id} type="button" onClick={() => add(p.id, 1)} disabled={locked}
                  className={`relative min-h-20 rounded-xl border p-3 text-left active:scale-[0.98] disabled:opacity-50 ${cart[p.id] ? "border-accent bg-[#dcefe9]" : "border-line bg-surface hover:border-accent"}`}>
                  <span className="block pr-8 font-medium leading-tight">{p.name}</span>
                  <span className="mt-1 block text-sm text-muted tabular-nums">{tl(p.price)}</span>
                  {cart[p.id] ? <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-accent text-sm font-semibold text-white">{cart[p.id]}</span> : null}
                </button>
              ))}
            </div>
          </section>
        ))}
        {!products.length && <p className="muted">Satışta ürün yok. Yönetici Ürünler ekranından eklemeli.</p>}
      </div>

      <form action={kasaSale} className="card grid content-start gap-3 md:sticky md:top-32 md:self-start">
        <h2 className="h2">Sepet {count > 0 && <span className="badge ml-1">{count}</span>}</h2>
        <input type="hidden" name="items" value={JSON.stringify(lines.map((p) => ({ id: p.id, qty: cart[p.id] })))} />
        <input type="hidden" name="mode" value={mode} />
        {lines.length ? (
          <ul className="grid gap-2">
            {lines.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 flex-1">{p.name}</span>
                <span className="flex items-center gap-1">
                  <button type="button" className="btn btn-sm w-9" onClick={() => add(p.id, -1)} aria-label={`${p.name} azalt`}>−</button>
                  <span className="w-6 text-center font-semibold tabular-nums">{cart[p.id]}</span>
                  <button type="button" className="btn btn-sm w-9" onClick={() => add(p.id, 1)} aria-label={`${p.name} artır`}>+</button>
                </span>
                <span className="w-20 text-right tabular-nums">{tl(cart[p.id] * p.price)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="muted">Ürünlere dokunarak ekleyin.</p>}

        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <span className="text-sm font-medium text-muted">{ikram ? "İkram (tahsilat yok)" : "Toplam"}</span>
          <span className={`text-2xl font-semibold tabular-nums ${ikram ? "text-muted line-through" : ""}`}>{tl(total)}</span>
        </div>

        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Ödeme türü">
          {channels.map((c) => (
            <button key={c.id} type="button" onClick={() => setMode(String(c.id))} aria-pressed={mode === String(c.id)}
              className={`btn min-h-12 ${mode === String(c.id) ? "btn-primary" : ""}`}>{c.name}</button>
          ))}
          <button type="button" onClick={() => setMode("ikram")} aria-pressed={ikram} className={`btn min-h-12 ${ikram ? "btn-primary" : ""}`}>İkram</button>
        </div>

        {ikram && (
          <div className="grid gap-2 rounded-lg bg-bg p-3">
            <div>
              <label className="label" htmlFor="treat_by">İkramı yapan</label>
              <select id="treat_by" name="treat_by" className="input" defaultValue={me} required>
                {users.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="note">Kime / neden</label>
              <input id="note" name="note" className="input" placeholder="İsteğe bağlı" />
            </div>
          </div>
        )}

        <Submit className="btn btn-primary min-h-14 text-base">{ikram ? "İkramı kaydet" : "Satışı kaydet"}</Submit>
        {count > 0 && <button type="button" className="btn btn-sm" onClick={() => setCart({})}>Sepeti temizle</button>}
        {locked && <p className="text-sm text-bad">Bugün onaylanıp kilitlenmiş; yeni satış girilemez.</p>}
      </form>
    </div>
  );
}
