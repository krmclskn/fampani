import Link from "next/link";
import { Submit } from "@/components/client";
import { dayClose } from "@/lib/actions";
import { can, requireUser } from "@/lib/auth";
import { all, ensureDay, get, todayStr } from "@/lib/db";
import { level, stockItems } from "@/lib/queries";
import { fmtDate, fmtDateTime, fmtQty, fmtTL } from "@/lib/util";

export default async function Kapanis() {
  const u = await requireUser();
  const today = todayStr();
  ensureDay(today);
  const closed = get<{ closed_at: string; name: string; cash_total: number; pos_total: number; cash_diff_note: string | null; note: string | null }>(
    "SELECT d.*, us.name FROM day_closings d JOIN users us ON us.id=d.closed_by WHERE d.date=?", today);
  const lists = all<{ area: string; total: number; open: number; blocked: number }>(
    `SELECT a.name AS area, COUNT(*) AS total, SUM(t.status='atandi') AS open, SUM(t.status='engellendi') AS blocked
     FROM tasks t JOIN areas a ON a.id=t.area_id WHERE t.date=? AND t.kind='kapanis' GROUP BY t.area_id ORDER BY t.area_id`, today);
  const openChecks = lists.reduce((n, l) => n + l.open, 0);
  const carry = all<{ id: number; title: string; priority: string }>("SELECT id,title,priority FROM tasks WHERE kind='is' AND status='atandi' ORDER BY (priority='yuksek') DESC, id");
  const handovers = get<{ c: number }>("SELECT COUNT(*) AS c FROM handovers WHERE accepted_at IS NULL")!.c;
  const critical = stockItems().filter((i) => level(i) === "kritik");
  const history = all<{ date: string; closed_at: string; name: string; cash_total: number; pos_total: number }>(
    "SELECT d.date,d.closed_at,d.cash_total,d.pos_total,us.name FROM day_closings d JOIN users us ON us.id=d.closed_by WHERE d.date<? ORDER BY d.date DESC LIMIT 7", today);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Kapanış</h1>
        <p className="muted">{fmtDate(today)}</p>
      </div>

      {closed && (
        <section className="card border-[#bcdcd2] bg-[#dcefe9]">
          <h2 className="h2">İşletme kapandı</h2>
          <p className="text-sm">{closed.name}, {fmtDateTime(closed.closed_at)} · nakit {fmtTL(closed.cash_total)} · POS {fmtTL(closed.pos_total)}</p>
          {closed.cash_diff_note && <p className="text-sm">Kasa farkı: {closed.cash_diff_note}</p>}
          {closed.note && <p className="text-sm">Not: {closed.note}</p>}
        </section>
      )}

      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="h2">Kapanış kontrol listeleri</h2>
          <Link href="/kontrol?tur=kapanis" className="text-sm font-medium text-accent underline underline-offset-2">Listeyi aç</Link>
        </div>
        <ul className="mt-2 grid gap-1.5 text-sm">
          {lists.map((l) => (
            <li key={l.area} className="flex items-center justify-between">
              <span>{l.area}</span>
              <span className="flex gap-2">
                {l.blocked > 0 && <span className="badge badge-bad">{l.blocked} istisna</span>}
                <span className={`badge ${l.open ? "badge-warn" : "badge-ok"}`}>{l.open ? `${l.open} açık` : "Tamam"}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="card">
          <h2 className="h2">Yarına devredecek işler <span className="badge ml-1">{carry.length}</span></h2>
          {carry.length ? (
            <ul className="mt-2 grid gap-1 text-sm">
              {carry.slice(0, 8).map((t) => <li key={t.id}>{t.priority === "yuksek" && <span className="badge badge-bad mr-1">Yüksek</span>}{t.title}</li>)}
              {carry.length > 8 && <li className="muted">ve {carry.length - 8} iş daha</li>}
            </ul>
          ) : <p className="muted mt-2">Açık iş yok.</p>}
        </div>
        <div className="card">
          <h2 className="h2">Kritik stok <span className="badge ml-1">{critical.length}</span></h2>
          {critical.length ? (
            <ul className="mt-2 grid gap-1 text-sm">
              {critical.map((i) => <li key={i.id}>{i.name}: {fmtQty(i.qty)} {i.unit} {i.open_purchase ? <span className="badge">Talep #{i.open_purchase}</span> : <span className="badge badge-bad">Talep yok</span>}</li>)}
            </ul>
          ) : <p className="muted mt-2">Kritik seviyede kalem yok.</p>}
          {handovers > 0 && <p className="mt-3 text-sm text-warn">{handovers} vardiya devri teslim alınmayı bekliyor.</p>}
        </div>
      </section>

      {!closed && (
        <section className="card">
          <h2 className="h2">Gün sonu kaydı</h2>
          {!can.closeDay(u) ? (
            <p className="muted mt-2">“İşletme kapandı” kaydını vardiya sorumlusu verir.</p>
          ) : (
            <form action={dayClose} className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="cash_total">Nakit kapanış (TL)</label><input id="cash_total" name="cash_total" inputMode="decimal" className="input" required /></div>
              <div><label className="label" htmlFor="pos_total">POS kapanış (TL)</label><input id="pos_total" name="pos_total" inputMode="decimal" className="input" required /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="cash_diff_note">Kasa farkı varsa açıklama</label><input id="cash_diff_note" name="cash_diff_note" className="input" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="note">Ertesi gün için not</label><textarea id="note" name="note" className="input" rows={2} /></div>
              <div className="sm:col-span-2">
                {openChecks > 0 && <p className="mb-2 text-sm text-warn">Kapanış listesinde {openChecks} açık madde var; önce tamamlanmalı veya istisnayla kapatılmalı.</p>}
                <Submit>İşletme kapandı</Submit>
              </div>
            </form>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="h2">Önceki kapanışlar</h2>
          <table className="tbl mt-2">
            <thead><tr><th>Gün</th><th>Kapatan</th><th>Saat</th><th className="num">Nakit</th><th className="num">POS</th></tr></thead>
            <tbody>
              {history.map((h) => <tr key={h.date}><td>{fmtDate(h.date)}</td><td>{h.name}</td><td>{fmtDateTime(h.closed_at)}</td><td className="num">{fmtTL(h.cash_total)}</td><td className="num">{fmtTL(h.pos_total)}</td></tr>)}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
