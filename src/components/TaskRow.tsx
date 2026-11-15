import { taskBlock, taskCancel, taskCount, taskDone, taskReopen, taskReview } from "@/lib/actions";
import { can, ROLE_LABEL, type Role, type User } from "@/lib/auth";
import type { TaskV } from "@/lib/queries";
import { EXCEPTION_REASONS, TASK_STATUS, fmtDateTime } from "@/lib/util";
import { Submit } from "./client";

export function TaskRow({ t, user, today }: { t: TaskV; user: User; today: string }) {
  const mine = t.kind !== "is" || t.assignee_id === user.id || t.assignee_role === user.role || can.assignTasks(user);
  const open = t.status === "atandi";
  const badge =
    t.status === "tamamlandi" ? "badge-ok" : t.status === "engellendi" ? "badge-bad" : t.status === "kontrol" ? "badge-warn" : "";
  return (
    <li className="border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-64">
          <p className={`font-medium ${t.status === "tamamlandi" || t.status === "iptal" ? "text-muted line-through" : ""}`}>{t.title}</p>
          <p className="muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {!open && <span className={`badge ${badge}`}>{TASK_STATUS[t.status]}</span>}
            {t.priority === "yuksek" && open && <span className="badge badge-bad">Yüksek öncelik</span>}
            {t.kind === "is" && t.date < today && open && <span className="badge badge-warn">Devreden</span>}
            {t.area && <span>{t.area}</span>}
            {t.stock_name && <span className="badge">Stok sayımı: {t.stock_name}</span>}
            {t.kind === "is" && <span>→ {t.assignee ?? (t.assignee_role ? ROLE_LABEL[t.assignee_role as Role] : "Atanmamış")}</span>}
            {t.needs_review ? <span>Kontrol gerekir</span> : null}
            {t.done_name && <span>{t.done_name}, {fmtDateTime(t.done_at)}</span>}
          </p>
          {t.detail && <p className="mt-1 text-sm">{t.detail}</p>}
          {t.exception_reason && <p className="mt-1 text-sm text-bad">İstisna: {t.exception_reason}</p>}
          {t.note && <p className="mt-1 text-sm text-muted">Not: {t.note}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {open && mine && (t.stock_item_id ? (
            <form action={taskCount} className="flex items-center gap-2">
              <input type="hidden" name="id" value={t.id} />
              <input name="counted" inputMode="decimal" className="input w-28" placeholder={`Sayım (${t.stock_unit})`} aria-label={`${t.stock_name} sayılan miktar`} required />
              <Submit className="btn btn-primary btn-sm">Sayımı kaydet</Submit>
            </form>
          ) : (
            <form action={taskDone}>
              <input type="hidden" name="id" value={t.id} />
              <Submit className="btn btn-primary btn-sm">Tamamla</Submit>
            </form>
          ))}
          {t.status === "kontrol" && can.reviewTasks(user) && t.done_by !== user.id && (
            <form action={taskReview} className="flex gap-2">
              <input type="hidden" name="id" value={t.id} />
              <Submit className="btn btn-primary btn-sm" name="karar" value="onay">Onayla</Submit>
              <Submit className="btn btn-sm" name="karar" value="geri">Geri gönder</Submit>
            </form>
          )}
          {["tamamlandi", "engellendi"].includes(t.status) && (can.assignTasks(user) || t.done_by === user.id) && (
            <form action={taskReopen}>
              <input type="hidden" name="id" value={t.id} />
              <Submit className="btn btn-sm">Geri al</Submit>
            </form>
          )}
        </div>
      </div>
      {open && mine && (
        <details className="mt-2">
          <summary className="text-sm font-medium text-muted underline underline-offset-2">Yapılamıyor / not ekle</summary>
          <div className="mt-2 grid gap-3 rounded-lg bg-bg p-3 sm:grid-cols-2">
            <form action={taskBlock} className="grid gap-2">
              <input type="hidden" name="id" value={t.id} />
              <label className="label" htmlFor={`r${t.id}`}>Neden yapılamıyor?</label>
              <select id={`r${t.id}`} name="reason" className="input" required defaultValue="">
                <option value="" disabled>Neden seçin</option>
                {EXCEPTION_REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>
              <input name="note" className="input" placeholder="Kısa açıklama (isteğe bağlı)" aria-label="Açıklama" />
              <Submit className="btn btn-sm btn-danger">İstisnayla kapat</Submit>
            </form>
            <div className="grid content-start gap-3">
              <form action={taskDone} className="grid gap-2">
                <input type="hidden" name="id" value={t.id} />
                <label className="label" htmlFor={`n${t.id}`}>Notla tamamla</label>
                <input id={`n${t.id}`} name="note" className="input" placeholder="Miktar, açıklama…" required />
                <Submit className="btn btn-sm">Notla tamamla</Submit>
              </form>
              {t.kind === "is" && can.assignTasks(user) && (
                <form action={taskCancel} className="grid gap-2">
                  <input type="hidden" name="id" value={t.id} />
                  <input name="note" className="input" placeholder="İptal nedeni" aria-label="İptal nedeni" required />
                  <Submit className="btn btn-sm btn-danger">Görevi iptal et</Submit>
                </form>
              )}
            </div>
          </div>
        </details>
      )}
    </li>
  );
}
