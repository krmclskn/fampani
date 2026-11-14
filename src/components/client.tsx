"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";

export function Nav({ links }: { links: { href: string; label: string; count?: number }[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-2 sm:px-6" aria-label="Ana menü">
      {links.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
              active ? "bg-accent text-white" : "text-muted hover:bg-[#eeebe3]"
            }`}
          >
            {l.label}
            {l.count ? <span className={`ml-1.5 rounded-full px-1.5 text-xs ${active ? "bg-white/25" : "bg-[#fbe9cf] text-warn"}`}>{l.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function Flash() {
  const sp = useSearchParams();
  const ok = sp.get("ok"), hata = sp.get("hata");
  if (!ok && !hata) return null;
  return (
    <div
      role={hata ? "alert" : "status"}
      className={`mb-4 rounded-lg border px-4 py-3 text-sm font-medium ${
        hata ? "border-[#efc4bf] bg-[#f8dcd9] text-bad" : "border-[#bcdcd2] bg-[#dcefe9] text-accent"
      }`}
    >
      {hata ?? ok}
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
