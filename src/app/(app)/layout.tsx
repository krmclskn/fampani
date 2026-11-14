import Link from "next/link";
import { Suspense } from "react";
import { Flash, Nav } from "@/components/client";
import { can, requireUser, ROLE_LABEL } from "@/lib/auth";
import { get } from "@/lib/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const c = (sql: string, ...p: (string | number)[]) => get<{ c: number }>(sql, ...p)?.c ?? 0;
  const myTasks = c("SELECT COUNT(*) AS c FROM tasks WHERE kind='is' AND status='atandi' AND (assignee_id=? OR assignee_role=?)", u.id, u.role);
  const handovers = c("SELECT COUNT(*) AS c FROM handovers WHERE accepted_at IS NULL AND from_user<>?", u.id);
  const purchases = can.reviewPurchase(u)
    ? c("SELECT COUNT(*) AS c FROM purchases WHERE status IN ('talep','onay_bekliyor','onaylandi')")
    : 0;
  const main = can.seeFinance(u)
    ? [{ href: "/finans", label: "Panel" }, { href: "/ciro", label: "Ciro" }, { href: "/giderler", label: "Giderler" }, { href: "/tedarikciler", label: "Tedarikçiler" }]
    : [];
  const ops = [
    { href: "/", label: "Bugün" },
    { href: "/kontrol", label: "Kontrol listeleri" },
    { href: "/gorevler", label: "Görevler", count: myTasks },
    { href: "/vardiya", label: "Vardiya" },
    { href: "/devir", label: "Devir", count: handovers },
    { href: "/stok", label: "Stok" },
    { href: "/satinalma", label: "Stok talepleri", count: purchases },
    { href: "/kapanis", label: "Kapanış" },
    ...(can.seeSummary(u) ? [{ href: "/ozet", label: "Operasyon özeti" }] : []),
    ...(can.manage(u) ? [{ href: "/ayarlar", label: "Ayarlar" }] : []),
  ];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          <Link href={main.length ? "/finans" : "/"} className="font-semibold tracking-tight">Fampani <span className="font-normal text-muted">· MekanSAL</span></Link>
          <Link href="/hesap" className="text-right text-sm leading-tight">
            <span className="block font-medium">{u.name}</span>
            <span className="block text-xs text-muted">{ROLE_LABEL[u.role]}</span>
          </Link>
        </div>
        <Nav main={main} ops={ops} />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
        <Suspense fallback={null}><Flash /></Suspense>
        {children}
      </main>
    </div>
  );
}
