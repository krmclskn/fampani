import { Fold } from "@/components/client";
import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { all, ensureDay, ensureStockRequests, todayStr } from "@/lib/db";
import { stockItems } from "@/lib/queries";
import { fmtDate, fmtQty } from "@/lib/util";

const KIND: Record<string, string> = { acilis: "Açılış", gunici: "Gün içi", kapanis: "Kapanış", is: "Ek iş" };
type T = { id: number; title: string; kind: string; status: string; who: string | null; done_name: string | null; exception_reason: string | null; note: string | null };

export default async function Operasyon() {
  const u = await requireUser();
  if (!can.seeSummary(u)) redirect("/");
  const today = todayStr();
  await ensureDay(today);
  await ensureStockRequests(u.id);
  const tasks = await all<T>(
    `SELECT t.id, t.title, t.kind, t.status, au.name AS who, du.name AS done_name, t.exception_reason, t.note
     FROM tasks t LEFT JOIN users au ON au.id=t.assignee_id LEFT JOIN users du ON du.id=t.done_by
     WHERE (t.date=? AND t.kind<>'is') OR (t.kind='is' AND t.status='atandi')
     ORDER BY t.kind='kapanis', t.kind='gunici', t.kind='is', t.id`, today);
  const people = [...new Set(tasks.map((t) => t.who ?? "Herkes"))].sort((a, b) => (a === "Herkes" ? 1 : b === "Herkes" ? -1 : a.localeCompare(b, "tr")));
  const done = tasks.filter((t) => t.status === "tamamlandi" || t.status === "kontrol").length;
  const blocked = tasks.filter((t) => t.status === "engellendi");
  const items = await stockItems(), low = items.filter((i) => i.min_level > 0 && i.qty < i.min_level);
  const orders = await all<{ status: string; item: string; unit: string; qty_order: number | null }>(
    `SELECT p.status, i.name AS item, i.unit, p.qty_order FROM purchases p JOIN stock_items i ON i.id=p.item_id
     WHERE p.status IN ('talep','onay_bekliyor','onaylandi','siparis','eksik_teslim') ORDER BY p.id`);
  const toOrder = orders.filter((o) => !["siparis", "eksik_teslim"].includes(o.status)), waiting = orders.filter((o) => ["siparis", "eksik_teslim"].includes(o.status));

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Operasyon</h1>
        <p className="muted">{fmtDate(today)} · bugünkü işlerin {done}/{tasks.length} tanesi tamam.</p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/kontrol" className="card block hover:border-accent"><p className="text-xs font-semibold text-muted">Bugünkü işler</p><p className="mt-1 text-2xl font-semibold tabular-nums">{done}/{tasks.length}</p></Link>
        <Link href="/stok" className="card block hover:border-accent"><p className="text-xs font-semibold text-muted">Minimum altı ürün</p><p className={`mt-1 text-2xl font-semibold tabular-nums ${low.length ? "text-bad" : ""}`}>{low.length}</p></Link>
        <Link href="/stok" className="card block hover:border-accent"><p className="text-xs font-semibold text-muted">Sipariş verilecek</p><p className={`mt-1 text-2xl font-semibold tabular-nums ${toOrder.length ? "text-warn" : ""}`}>{toOrder.length}</p></Link>
        <Link href="/stok" className="card block hover:border-accent"><p className="text-xs font-semibold text-muted">Teslimat bekleniyor</p><p className="mt-1 text-2xl font-semibold tabular-nums">{waiting.length}</p></Link>
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="h2">Bugün kim ne yapıyor</h2>
          <Link href="/kontrol/duzenle" className="btn btn-sm">İş ekle / ata</Link>
        </div>
        {tasks.length === 0 && <p className="muted mt-2">Bugün için tanımlı iş yok.</p>}
        <div className="mt-2 grid gap-4 md:grid-cols-2">
          {people.map((p) => {
            const list = tasks.filter((t) => (t.who ?? "Herkes") === p);
            const d = list.filter((t) => t.status === "tamamlandi" || t.status === "kontrol").length;
            const open = list.filter((t) => t.status === "atandi");
            return (
              <div key={p} className="rounded-lg bg-bg p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{p}</h3>
                  <span className={`badge ${d === list.length ? "badge-ok" : ""}`}>{d}/{list.length} tamam</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${list.length ? (d / list.length) * 100 : 0}%` }} /></div>
                {open.length ? (
                  <ul className="mt-2 grid gap-1 text-sm">
                    {open.slice(0, 6).map((t) => <li key={t.id} className="flex justify-between gap-2"><span>{t.title}</span><span className="whitespace-nowrap text-xs text-muted">{KIND[t.kind]}</span></li>)}
                    {open.length > 6 && <li className="text-xs text-muted">ve {open.length - 6} iş daha</li>}
                  </ul>
                ) : <p className="mt-2 text-sm text-muted">Bekleyen iş yok.</p>}
              </div>
            );
          })}
        </div>
      </section>

      {blocked.length > 0 && (
        <section className="card border-[#efc4bf]">
          <h2 className="h2">Yapılamayan işler</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {blocked.map((t) => <li key={t.id}><span className="badge badge-bad mr-2">{t.exception_reason}</span>{t.title}<span className="text-muted"> · {t.done_name}{t.note ? ` · ${t.note}` : ""}</span></li>)}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="h2">Stok akışı</h2>
          <Link href="/stok" className="btn btn-sm">Stok ve siparişi aç</Link>
        </div>
        <div className="mt-2 grid gap-2 text-sm">
          <Fold id="ops:min" title="Minimum altı" count={low.length} tone={low.length ? "bad" : undefined} className="rounded-lg border border-line px-3 py-2">
            {low.length ? <ul className="grid gap-1">{low.map((i) => <li key={i.id}>{i.name}: <b className="font-medium">{fmtQty(i.qty)}</b> / min {fmtQty(i.min_level)} {i.unit}</li>)}</ul> : <p className="muted">Yok.</p>}
          </Fold>
          <Fold id="ops:siparis" title="Sipariş verilecek" count={toOrder.length} tone={toOrder.length ? "warn" : undefined} className="rounded-lg border border-line px-3 py-2">
            {toOrder.length ? <ul className="grid gap-1">{toOrder.map((o, i) => <li key={i}>{o.item}</li>)}</ul> : <p className="muted">Yok.</p>}
          </Fold>
          <Fold id="ops:teslimat" title="Teslimat bekleniyor" count={waiting.length} className="rounded-lg border border-line px-3 py-2">
            {waiting.length ? <ul className="grid gap-1">{waiting.map((o, i) => <li key={i}>{o.item}: {fmtQty(o.qty_order)} {o.unit}</li>)}</ul> : <p className="muted">Yok.</p>}
          </Fold>
        </div>
        <p className="muted mt-3">Akış: ürün minimumun altına iner → sipariş listesine düşer → sipariş verdiğin miktarı yazarsın → teslimatta gelen miktar yazılır ve stoğa eklenir.</p>
      </section>
    </div>
  );
}
