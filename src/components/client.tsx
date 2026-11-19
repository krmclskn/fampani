"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

type NavLink = { href: string; label: string; count?: number };

function NavRow({ links, path, small }: { links: NavLink[]; path: string; small?: boolean }) {
  // En uzun eşleşen bağlantı etkin sayılır (/kontrol/duzenle, /kontrol'ü de yakmasın).
  const best = links.filter((l) => path === l.href || (l.href !== "/" && path.startsWith(l.href + "/")) || (l.href !== "/" && path === l.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? (path === "/" ? "/" : undefined);
  return (
    <nav className={`flex gap-1 overflow-x-auto px-3 pb-2 sm:flex-wrap sm:px-6 ${small ? "border-t border-line pt-2" : ""}`} aria-label={small ? "Operasyon menüsü" : "Ana menü"}>
      {links.map((l) => {
        const active = l.href === best;
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 font-medium ${small ? "py-1.5 text-[13px]" : "py-2 text-sm"} ${
              active ? (small ? "bg-[#dcefe9] text-accent" : "bg-accent text-white") : "text-muted hover:bg-[#eeebe3]"}`}>
            {l.label}
            {l.count ? <span className="ml-1.5 rounded-full bg-[#fbe9cf] px-1.5 text-xs text-warn">{l.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Yönetici: finans menüsü + "Operasyon" altında günlük işler. Personel: yalnızca operasyon menüsü. */
export function Nav({ main, ops }: { main: NavLink[]; ops: NavLink[] }) {
  const path = usePathname();
  if (!main.length) return <NavRow links={ops} path={path} />;
  const inOps = !main.some((l) => path.startsWith(l.href));
  const total = ops.reduce((s, l) => s + (l.count ?? 0), 0);
  return (
    <>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 sm:px-6" aria-label="Ana menü">
        {[...main, { href: "/operasyon", label: "Operasyon", count: total }].map((l) => {
          const active = l.href === "/operasyon" ? inOps : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-accent text-white" : "text-muted hover:bg-[#eeebe3]"}`}>
              {l.label}
              {l.count ? <span className={`ml-1.5 rounded-full px-1.5 text-xs ${active ? "bg-white/25" : "bg-[#fbe9cf] text-warn"}`}>{l.count}</span> : null}
            </Link>
          );
        })}
      </nav>
      {inOps && <NavRow links={ops} path={path} small />}
    </>
  );
}

type Msg = { kind: "ok" | "hata"; msg: string; t: number };

function readFlash(): Msg | null {
  try {
    const raw = document.cookie.split("; ").find((c) => c.startsWith("flash="));
    if (!raw) return null;
    document.cookie = "flash=; path=/; max-age=0";
    return JSON.parse(decodeURIComponent(decodeURIComponent(raw.slice(6))));
  } catch { return null; }
}

/**
 * İşlem mesajı: sayfanın altında kısa süre görünen bildirim. Sayfa yerinde yenilendiği için kaydırma yeri korunur.
 * `stamp` her sunucu yenilemesinde değişir; mesaj çerezi o an okunur. Adres çubuğundaki ?ok= / ?hata= de desteklenir.
 */
export function Flash({ stamp }: { stamp?: number }) {
  const sp = useSearchParams();
  const [m, setM] = useState<Msg | null>(null);
  useEffect(() => {
    const fromCookie = readFlash();
    const q = sp.get("hata") ? { kind: "hata" as const, msg: sp.get("hata")!, t: 0 } : sp.get("ok") ? { kind: "ok" as const, msg: sp.get("ok")!, t: 0 } : null;
    const next = fromCookie ?? q;
    if (!next) return;
    // Çerez dış kaynaktan (tarayıcı) okunuyor; durumu burada güncellemek bilinçli.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setM(next);
    const h = setTimeout(() => setM((cur) => (cur === next ? null : cur)), next.kind === "hata" ? 8000 : 3500);
    return () => clearTimeout(h);
  }, [stamp, sp]);
  if (!m) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div
        role={m.kind === "hata" ? "alert" : "status"}
        className={`pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
          m.kind === "hata" ? "border-[#efc4bf] bg-[#f8dcd9] text-bad" : "border-[#bcdcd2] bg-[#dcefe9] text-accent"
        }`}
      >
        <span className="flex-1">{m.msg}</span>
        <button type="button" onClick={() => setM(null)} className="text-xs underline underline-offset-2" aria-label="Bildirimi kapat">Kapat</button>
      </div>
    </div>
  );
}

export function Submit({ children, className = "btn btn-primary", name, value }: {
  children: React.ReactNode; className?: string; name?: string; value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} name={name} value={value}>
      {children}
    </button>
  );
}

/**
 * Açılır-kapanır başlık. Başlığa basınca içerik açılır; açık/kapalı durumu bu cihazda hatırlanır.
 * `id` her bölüm için benzersiz olmalı (ör. "stok:Bar").
 */
export function Fold({ id, title, count, tone, meta, defaultOpen = false, className = "card", children }: {
  id: string; title: React.ReactNode; count?: number; tone?: "warn" | "bad" | "ok"; meta?: React.ReactNode;
  defaultOpen?: boolean; className?: string; children: React.ReactNode;
}) {
  const key = "fold:" + id;
  const restore = (el: HTMLDetailsElement | null) => {
    if (!el || el.dataset.restored) return;
    el.dataset.restored = "1";
    try { const v = localStorage.getItem(key); if (v !== null) el.open = v === "1"; } catch {}
  };
  return (
    <details ref={restore} open={defaultOpen} className={`fold ${className}`}
      onToggle={(e) => { try { localStorage.setItem(key, (e.currentTarget as HTMLDetailsElement).open ? "1" : "0"); } catch {} }}>
      <summary className="flex cursor-pointer list-none items-center gap-2 select-none">
        <svg aria-hidden viewBox="0 0 20 20" className="size-4 shrink-0 text-muted transition-transform [details[open]>summary>&]:rotate-90"><path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="h2 min-w-0 flex-1">{title}</span>
        {meta}
        {count !== undefined && <span className={`badge ${tone ? "badge-" + tone : ""}`}>{count}</span>}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/** Sayım formuna bağlı kaç kutunun doldurulduğunu gösterir. */
export function CountHint({ form }: { form: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const f = document.getElementById(form) as HTMLFormElement | null;
    if (!f) return;
    const count = () => setN([...f.elements].filter((e) => e instanceof HTMLInputElement && e.name.startsWith("c_") && e.value.trim()).length);
    document.addEventListener("input", count);
    f.addEventListener("reset", () => setTimeout(count));
    return () => document.removeEventListener("input", count);
  }, [form]);
  return <span className="text-sm text-muted">{n ? <><b className="text-ink">{n}</b> ürünün sayımı yazıldı</> : "Henüz sayım yazılmadı"}</span>;
}
