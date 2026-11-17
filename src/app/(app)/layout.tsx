import Link from "next/link";
import { Suspense } from "react";
import { Flash, Nav } from "@/components/client";
import { can, requireUser, ROLE_LABEL } from "@/lib/auth";
import { get } from "@/lib/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const c = async (sql: string, ...p: (string | number)[]) => (await get<{ c: number }>(sql, ...p))?.c ?? 0;
  const myTasks = await c("SELECT COUNT(*) AS c FROM tasks WHERE status='atandi' AND kind='is' AND assignee_id=?", u.id);
  const main = can.seeFinance(u)
    ? [{ href: "/finans", label: "Panel" }, { href: "/ciro", label: "Ciro" }, { href: "/giderler", label: "Giderler" }, { href: "/tedarikciler", label: "Tedarikçiler" }, { href: "/borclar", label: "Borçlar" }]
    : [];
  const orders = can.orderPurchase(u) ? await c("SELECT COUNT(*) AS c FROM purchases WHERE status IN ('talep','onay_bekliyor','onaylandi','siparis','eksik_teslim')") : 0;
  // Yönetici: genel bakış + işler/atamalar + stok. Personel: kendi günü, listeler ve stok.
  // Yönetenler (sahip, işletmeci): genel bakış ve atamalar. Personel: kendi günü, işleri ve stok.
  const ops = can.seeSummary(u)
    ? [
        { href: "/operasyon", label: "Genel bakış" },
        { href: "/kontrol/duzenle", label: "İşler ve atamalar" },
        { href: "/gorevler", label: "Yapılacaklar", count: myTasks },
        { href: "/kontrol", label: "Bugünkü liste" },
        { href: "/stok", label: "Stok ve sipariş", count: orders },
        { href: "/ayarlar", label: "Kişiler" },
      ]
    : [
        { href: "/", label: "Bugün" },
        { href: "/gorevler", label: "Yapılacaklar", count: myTasks },
        { href: "/kontrol", label: "Kontrol listeleri" },
        { href: "/stok", label: "Stok" },
      ];
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          <Link href={main.length ? "/finans" : can.seeSummary(u) ? "/operasyon" : "/"} className="font-semibold tracking-tight">Fampani <span className="font-normal text-muted">· MekanSAL</span></Link>
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
