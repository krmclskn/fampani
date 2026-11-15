import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { all, ensureDay, get, setting, todayStr } from "@/lib/db";
import { areas, gaps, level, stockItems } from "@/lib/queries";
import { PURCHASE_STATUS, fmtDate, fmtDateTime, fmtQty, fmtTL } from "@/lib/util";

function Stat({ label, value, tone, href }: { label: string; value: string; tone?: "bad" | "warn" | "ok"; href: string }) {
  return (
    <Link href={href} className="card block hover:border-accent">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : ""}`}>{value}</p>
    </Link>
  );
}

export default async function Ozet() {
  const u = await requireUser();
  if (!can.seeSummary(u)) redirect("/");
  const today = todayStr();
  ensureDay(today);
  const c = (sql: string, ...p: (string | number)[]) => get<{ c: number }>(sql, ...p)?.c ?? 0;
  const chk = (kind: string) => get<{ total: number; done: number; blocked: number }>(
    "SELECT COUNT(*) AS total, COALESCE(SUM(status IN ('tamamlandi','kontrol')),0) AS done, COALESCE(SUM(status='engellendi'),0) AS blocked FROM tasks WHERE date=? AND kind=?", today, kind)!;
  const ac = chk("acilis"), kp = chk("kapanis");
  const openTasks = c("SELECT COUNT(*) AS c FROM tasks WHERE kind='is' AND status='atandi'");
  const carried = c("SELECT COUNT(*) AS c FROM tasks WHERE kind='is' AND status='atandi' AND date<?", today);
  const review = c("SELECT COUNT(*) AS c FROM tasks WHERE status='kontrol'");
  const closedToday = get("SELECT 1 FROM day_closings WHERE date=?", today);
  const closedYesterday = get("SELECT 1 FROM day_closings WHERE date=?", todayStr(-1));
  const items = stockItems();
  const critical = items.filter((i) => level(i) === "kritik"), low = items.filter((i) => level(i) === "dusuk");
  const pipeline = all<{ status: string; n: number; total: number | null }>(
    `SELECT status, COUNT(*) AS n, SUM(qty_order*unit_price) AS total FROM purchases
     WHERE status IN ('talep','onay_bekliyor','onaylandi','siparis','eksik_teslim') GROUP BY status`);
  const unpaid = get<{ n: number; total: number | null }>(
    "SELECT COUNT(*) AS n, SUM(invoice_amount) AS total FROM purchases WHERE received_at IS NOT NULL AND paid_at IS NULL")!;
  const late = c("SELECT COUNT(*) AS c FROM purchases WHERE status='siparis' AND expected_date<?", today);
  const blocked = all<{ id: number; title: string; exception_reason: string; area: string | null; name: string | null }>(
    `SELECT t.id,t.title,t.exception_reason,a.name AS area,us.name FROM tasks t LEFT JOIN areas a ON a.id=t.area_id LEFT JOIN users us ON us.id=t.done_by
     WHERE t.status='engellendi' AND t.date>=? ORDER BY t.id DESC`, todayStr(-1));
  const shifts = all<{ area_id: number; start: string; end: string }>("SELECT area_id,start,end FROM shifts WHERE date=?", today);
  const cover = areas().filter((a) => a.needs_cover)
    .map((a) => ({ a: a.name, g: gaps(shifts.filter((s) => s.area_id === a.id), setting("open_time"), setting("close_time")) }))
    .filter((x) => x.g.length);
  const log = all<{ id: number; at: string; name: string | null; action: string; detail: string | null }>(
    "SELECT l.id,l.at,l.action,l.detail,us.name FROM audit_log l LEFT JOIN users us ON us.id=l.user_id ORDER BY l.id DESC LIMIT 40");
  const order = ["talep", "onay_bekliyor", "onaylandi", "siparis", "eksik_teslim"];

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Günlük yönetim özeti</h1>
        <p className="muted">
          {fmtDate(today)} · {closedToday ? "Bugün kapatıldı." : "Bugün henüz kapatılmadı."}
          {!closedYesterday && " Dün için kapanış kaydı yok."}
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Açılış listesi" value={`${ac.done}/${ac.total}`} tone={ac.blocked ? "bad" : undefined} href="/kontrol?tur=acilis" />
        <Stat label="Kapanış listesi" value={`${kp.done}/${kp.total}`} tone={kp.blocked ? "bad" : undefined} href="/kontrol?tur=kapanis" />
        <Stat label="Açık iş (devreden)" value={`${openTasks} (${carried})`} tone={carried ? "warn" : undefined} href="/gorevler" />
        <Stat label="Kontrol bekleyen iş" value={String(review)} tone={review ? "warn" : undefined} href="/gorevler" />
        <Stat label="Kritik stok" value={String(critical.length)} tone={critical.length ? "bad" : undefined} href="/stok" />
        <Stat label="Minimum altı stok" value={String(low.length)} tone={low.length ? "warn" : undefined} href="/stok" />
        <Stat label="Geciken teslimat" value={String(late)} tone={late ? "bad" : undefined} href="/satinalma" />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="card">
          <h2 className="h2">Açık satın almalar</h2>
          <table className="tbl mt-2">
            <thead><tr><th>Durum</th><th className="num">Adet</th><th className="num">Tutar</th></tr></thead>
            <tbody>
              {order.map((s) => {
                const r = pipeline.find((p) => p.status === s);
                return <tr key={s}><td>{PURCHASE_STATUS[s]}</td><td className="num">{r?.n ?? 0}</td><td className="num">{r?.total != null ? fmtTL(Math.round(r.total)) : "–"}</td></tr>;
              })}
              <tr><td>Teslim alınmış, ödenmemiş</td><td className="num">{unpaid.n}</td><td className="num">{fmtTL(unpaid.total)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="h2">Bugünkü vardiya kapsaması</h2>
          {cover.length ? (
            <ul className="mt-2 grid gap-1 text-sm">{cover.map((x) => <li key={x.a} className="text-warn">{x.a}: {x.g.join(", ")} arası kimse yok</li>)}</ul>
          ) : <p className="muted mt-2">Bar ve mutfak tüm çalışma saatlerinde kapsanıyor.</p>}
          <h2 className="h2 mt-4">Kritik stok kalemleri</h2>
          {critical.length ? (
            <ul className="mt-2 grid gap-1 text-sm">
              {critical.map((i) => <li key={i.id}>{i.name}: {fmtQty(i.qty)} {i.unit} {i.open_purchase ? <span className="badge">Talep #{i.open_purchase}</span> : <span className="badge badge-bad">Talep yok</span>}</li>)}
            </ul>
          ) : <p className="muted mt-2">Yok.</p>}
        </div>
      </section>

      {blocked.length > 0 && (
        <section className="card">
          <h2 className="h2">İstisnayla kapatılan işler (dün ve bugün)</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {blocked.map((b) => <li key={b.id}><span className="badge badge-bad mr-1">{b.exception_reason}</span>{b.area ? `${b.area}: ` : ""}{b.title} <span className="text-muted">· {b.name}</span></li>)}
          </ul>
        </section>
      )}

      <section className="card overflow-x-auto">
        <h2 className="h2">Kayıt geçmişi</h2>
        <table className="tbl mt-2">
          <thead><tr><th>Zaman</th><th>Kişi</th><th>İşlem</th><th>Ayrıntı</th></tr></thead>
          <tbody>
            {log.map((l) => <tr key={l.id}><td className="whitespace-nowrap">{fmtDateTime(l.at)}</td><td className="whitespace-nowrap">{l.name ?? "–"}</td><td>{l.action}</td><td className="text-muted">{l.detail}</td></tr>)}
          </tbody>
        </table>
      </section>
    </div>
  );
}
