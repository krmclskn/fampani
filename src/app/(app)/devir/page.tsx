import { Submit } from "@/components/client";
import { handoverAccept, handoverCreate } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { all, get, todayStr } from "@/lib/db";
import { areas } from "@/lib/queries";
import { fmtDateTime } from "@/lib/util";

type H = {
  id: number; area: string; from_name: string; from_user: number; created_at: string; accepted_at: string | null; acc_name: string | null;
  cash_status: string | null; stock_notes: string | null; pending_work: string | null; issues: string | null;
  deliveries: string | null; upcoming: string | null; note: string | null;
};
const FIELDS: [keyof H & string, string, string][] = [
  ["cash_status", "Kasa / POS durumu", "Teslim edilen kasa tutarı, POS durumu"],
  ["stock_notes", "Kritik ürün ve stok eksikleri", "Azalan veya biten ürünler"],
  ["pending_work", "Hazırlanmış fakat tamamlanmamış işler", ""],
  ["issues", "Arıza veya müşteri geri bildirimi", ""],
  ["deliveries", "Bekleyen teslimat", ""],
  ["upcoming", "Yaklaşan etkinlik veya rezervasyon", ""],
  ["note", "Sonraki vardiyaya özel not", ""],
];

export default async function Devir() {
  const u = await requireUser();
  const list = all<H>(
    `SELECT h.*, a.name AS area, f.name AS from_name, ac.name AS acc_name FROM handovers h JOIN areas a ON a.id=h.area_id
     JOIN users f ON f.id=h.from_user LEFT JOIN users ac ON ac.id=h.accepted_by
     WHERE h.accepted_at IS NULL OR h.date>=? ORDER BY (h.accepted_at IS NULL) DESC, h.id DESC LIMIT 20`, todayStr(-2));
  const myArea = get<{ area_id: number }>("SELECT area_id FROM shifts WHERE date=? AND user_id=? ORDER BY start DESC", todayStr(), u.id);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Vardiya devri</h1>
        <p className="muted">Devreden kaydı oluşturur; devralan “Teslim aldım” diyerek kapatır.</p>
      </div>

      {list.map((h) => (
        <section key={h.id} className={`card ${h.accepted_at ? "" : "border-[#f0d6a8] bg-[#fdf6e7]"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="h2">{h.area} · {h.from_name}</h2>
            {h.accepted_at
              ? <span className="badge badge-ok">Teslim alındı: {h.acc_name}, {fmtDateTime(h.accepted_at)}</span>
              : <span className="badge badge-warn">Teslim bekliyor</span>}
          </div>
          <p className="muted">{fmtDateTime(h.created_at)}</p>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            {FIELDS.filter(([k]) => h[k]).map(([k, label]) => (
              <div key={k}><dt className="text-xs font-semibold text-muted">{label}</dt><dd className="whitespace-pre-wrap">{h[k]}</dd></div>
            ))}
          </dl>
          {!h.accepted_at && h.from_user !== u.id && (
            <form action={handoverAccept} className="mt-3">
              <input type="hidden" name="id" value={h.id} />
              <Submit>Teslim aldım</Submit>
            </form>
          )}
        </section>
      ))}

      <section className="card">
        <h2 className="h2">Yeni devir kaydı</h2>
        <form action={handoverCreate} className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="area_id">Devredilen alan</label>
            <select id="area_id" name="area_id" className="input" defaultValue={myArea?.area_id ?? ""} required>
              <option value="" disabled>Seçin</option>
              {areas().map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          {FIELDS.map(([k, label, ph]) => (
            <div key={k} className={k === "note" ? "sm:col-span-2" : ""}>
              <label className="label" htmlFor={k}>{label}</label>
              <textarea id={k} name={k} className="input" rows={2} placeholder={ph} required={k === "cash_status"} />
            </div>
          ))}
          <div className="sm:col-span-2"><Submit>Devir kaydını oluştur</Submit></div>
        </form>
      </section>
    </div>
  );
}
