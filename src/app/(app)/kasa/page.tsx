import { FEATURES } from "@/lib/util";
import { redirect } from "next/navigation";
import { Submit } from "@/components/client";
import { Kasa } from "@/components/Kasa";
import { can, requireUser } from "@/lib/auth";
import { all, get, todayStr } from "@/lib/db";
import { kasaVoid } from "@/lib/finance-actions";
import { activeUsers } from "@/lib/queries";
import { fmtDate, fmtDateTime, fmtTL } from "@/lib/util";

type T = { id: number; at: string; kind: string; total: number; summary: string; note: string | null; void_at: string | null;
  by: string; user_id: number; channel: string | null; treat: string | null };

export default async function KasaPage() {
  const u = await requireUser();
  if (!FEATURES.kasa) redirect("/");
  const today = todayStr(), manager = can.approveSales(u);
  const locked = !!get("SELECT 1 FROM sales_days WHERE date=? AND status='onayli'", today);
  const products = all<{ id: number; name: string; category: string | null; price: number }>(
    "SELECT id,name,category,price FROM products WHERE active=1 ORDER BY category, name");
  const channels = all<{ id: number; name: string }>("SELECT id,name FROM payment_channels WHERE active=1 ORDER BY id");
  const tickets = all<T>(
    `SELECT t.*, us.name AS by, c.name AS channel, tb.name AS treat FROM tickets t JOIN users us ON us.id=t.user_id
     LEFT JOIN payment_channels c ON c.id=t.channel_id LEFT JOIN users tb ON tb.id=t.treat_by
     WHERE t.date=? AND (?=1 OR t.user_id=?) ORDER BY t.id DESC LIMIT 30`, today, manager ? 1 : 0, u.id);
  const last = get<{ id: number }>("SELECT MAX(id) AS id FROM tickets")?.id ?? 0;
  const sums = manager
    ? all<{ label: string; n: number; total: number }>(
        `SELECT COALESCE(c.name,'İkram') AS label, COUNT(*) AS n, SUM(t.total) AS total FROM tickets t
         LEFT JOIN payment_channels c ON c.id=t.channel_id WHERE t.date=? AND t.void_at IS NULL GROUP BY label ORDER BY t.kind DESC, label`, today)
    : [];

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="h1">Kasa</h1>
        <p className="muted">{fmtDate(today)} · Satılan ürüne dokun, ödeme türünü seç, kaydet. Her fiş stoğu reçeteye göre anında düşer ve günün satış kaydına eklenir.</p>
      </div>

      <Kasa key={last} products={products} channels={channels} users={activeUsers()} me={u.id} locked={locked} />

      {sums.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {sums.map((s) => (
            <div key={s.label} className="card">
              <p className="text-xs font-semibold text-muted">{s.label} · {s.n} fiş</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{s.label === "İkram" ? "–" : fmtTL(s.total)}</p>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2 className="h2">{manager ? "Bugünkü fişler" : "Bugün girdiğim fişler"}</h2>
        {tickets.length ? (
          <ul className="mt-1">
            {tickets.map((t) => (
              <li key={t.id} className="border-b border-line py-2 last:border-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className={t.void_at ? "text-muted line-through" : ""}>
                    <p className="font-medium">{t.summary}</p>
                    <p className="muted">
                      #{t.id} · {fmtDateTime(t.at)} · {t.by}
                      {t.kind === "ikram" ? ` · ikramı yapan: ${t.treat}` : ""}{t.note ? ` · ${t.note}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {t.void_at ? <span className="badge badge-bad">İptal</span>
                      : t.kind === "ikram" ? <span className="badge badge-warn">İkram</span>
                      : <span className="badge">{t.channel} · {fmtTL(t.total)}</span>}
                  </div>
                </div>
                {!t.void_at && !locked && (manager || t.user_id === u.id) && (
                  <details className="mt-1">
                    <summary className="text-sm font-medium text-muted underline underline-offset-2">Fişi iptal et</summary>
                    <form action={kasaVoid} className="mt-2 flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={t.id} />
                      <input name="note" className="input max-w-xs" placeholder="İptal nedeni" aria-label="İptal nedeni" required />
                      <Submit className="btn btn-danger">İptal et, stoğu geri al</Submit>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="muted mt-2">Bugün henüz fiş yok.</p>}
      </section>
    </div>
  );
}
