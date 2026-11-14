import { Submit } from "@/components/client";
import { purchaseDecide, purchaseOrder, purchasePaid, purchaseReceive, purchaseReview } from "@/lib/actions";
import { can, requireUser, type User } from "@/lib/auth";
import { all, setting, todayStr } from "@/lib/db";
import { PURCHASE_STATUS, fmtDateTime, fmtQty, fmtTL } from "@/lib/util";

type PV = {
  id: number; status: string; item: string; unit: string; stock_qty: number; pref_supplier: number | null; last_price: number | null;
  qty_requested: number; note: string | null; requester: string; requested_at: string;
  supplier: string | null; qty_order: number | null; unit_price: number | null; reviewer: string | null;
  decider: string | null; decided_at: string | null; decision_note: string | null;
  orderer: string | null; ordered_at: string | null; expected_date: string | null;
  receiver: string | null; received_at: string | null; qty_received: number | null; qty_damaged: number | null;
  doc_no: string | null; invoice_amount: number | null; receive_note: string | null; paid_at: string | null;
};

const GROUPS: [string, string[]][] = [
  ["Değerlendirme bekleyen talepler", ["talep"]],
  ["Onay bekleyenler", ["onay_bekliyor"]],
  ["Sipariş verilecekler", ["onaylandi"]],
  ["Teslimat bekleyenler", ["siparis", "eksik_teslim"]],
];

function Card({ p, u, suppliers }: { p: PV; u: User; suppliers: { id: number; name: string }[] }) {
  const total = p.qty_order != null && p.unit_price != null ? Math.round(p.qty_order * p.unit_price) : null;
  const late = p.status === "siparis" && p.expected_date && p.expected_date < todayStr();
  return (
    <li className="border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">#{p.id} · {p.item} <span className="font-normal text-muted">stokta {fmtQty(p.stock_qty)} {p.unit}</span></p>
          <p className="muted">
            {p.requester} {fmtQty(p.qty_requested)} {p.unit} istedi, {fmtDateTime(p.requested_at)}{p.note ? ` · “${p.note}”` : ""}
          </p>
          {p.supplier && can.seePrices(u) && (
            <p className="mt-1 text-sm">
              {p.supplier} · {fmtQty(p.qty_order)} {p.unit} × {fmtTL(p.unit_price)} = <b>{fmtTL(total)}</b>
              {p.reviewer && <span className="text-muted"> · hazırlayan {p.reviewer}</span>}
            </p>
          )}
          {p.decider && <p className="text-sm text-muted">Karar: {p.decider}, {fmtDateTime(p.decided_at)}{p.decision_note ? ` · ${p.decision_note}` : ""}</p>}
          {!p.decider && p.decision_note && <p className="text-sm text-muted">Kapatma nedeni: {p.decision_note}</p>}
          {p.ordered_at && <p className="text-sm text-muted">Sipariş: {p.orderer}, {fmtDateTime(p.ordered_at)} · beklenen {p.expected_date}</p>}
          {p.received_at && (
            <p className="text-sm text-muted">
              Teslim: {p.receiver}, {fmtDateTime(p.received_at)} · gelen {fmtQty(p.qty_received)}, hasarlı {fmtQty(p.qty_damaged)}
              {p.doc_no ? ` · belge ${p.doc_no}` : ""}{can.seePrices(u) ? ` · fatura ${fmtTL(p.invoice_amount)}` : ""}{p.receive_note ? ` · ${p.receive_note}` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {late && <span className="badge badge-bad">Teslimat gecikti</span>}
          {p.received_at && <span className={`badge ${p.paid_at ? "badge-ok" : "badge-warn"}`}>{p.paid_at ? "Ödendi" : "Ödenmedi"}</span>}
          <span className={`badge ${p.status === "teslim_alindi" ? "badge-ok" : p.status === "reddedildi" ? "badge-bad" : ""}`}>{PURCHASE_STATUS[p.status]}</span>
        </div>
      </div>

      {p.status === "talep" && can.reviewPurchase(u) && (
        <div className="mt-2 grid gap-3 rounded-lg bg-bg p-3">
          <form action={purchaseReview} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input type="hidden" name="id" value={p.id} />
            <div className="col-span-2 sm:col-span-1"><label className="label" htmlFor={`sp${p.id}`}>Tedarikçi</label>
              <select id={`sp${p.id}`} name="supplier_id" className="input" defaultValue={p.pref_supplier ?? ""} required>
                <option value="" disabled>Seçin</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div><label className="label" htmlFor={`q${p.id}`}>Sipariş miktarı ({p.unit})</label><input id={`q${p.id}`} name="qty_order" inputMode="decimal" className="input" defaultValue={p.qty_requested} required /></div>
            <div><label className="label" htmlFor={`pr${p.id}`}>Birim fiyat (TL)</label><input id={`pr${p.id}`} name="unit_price" inputMode="decimal" className="input" defaultValue={p.last_price != null ? String(p.last_price / 100).replace(".", ",") : ""} required /></div>
            <div className="col-span-2 self-end sm:col-span-1"><Submit className="btn btn-primary">Onaya gönder</Submit></div>
          </form>
          <form action={purchaseReview} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={p.id} />
            <input name="note" className="input max-w-xs" placeholder="Satın alma gerekmiyor: neden?" aria-label="Kapatma nedeni" required />
            <Submit className="btn btn-danger" name="karar" value="red">Satın almadan kapat</Submit>
          </form>
        </div>
      )}

      {p.status === "onay_bekliyor" && (can.approvePurchase(u, total ?? 0) ? (
        <form action={purchaseDecide} className="mt-2 flex flex-wrap gap-2 rounded-lg bg-bg p-3">
          <input type="hidden" name="id" value={p.id} />
          <input name="note" className="input max-w-xs" placeholder="Not (ret için zorunlu)" aria-label="Karar notu" />
          <Submit className="btn btn-primary" name="karar" value="onay">Onayla</Submit>
          <Submit className="btn btn-danger" name="karar" value="red">Reddet</Submit>
        </form>
      ) : u.role === "operasyon" ? (
        <p className="mt-2 text-sm text-warn">Tutar onay limitinizin ({fmtTL(Number(setting("purchase_limit")))}) üzerinde; işletme sahibi onaylamalı.</p>
      ) : null)}

      {p.status === "onaylandi" && can.orderPurchase(u) && (
        <form action={purchaseOrder} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-bg p-3">
          <input type="hidden" name="id" value={p.id} />
          <div><label className="label" htmlFor={`ex${p.id}`}>Beklenen teslimat</label><input id={`ex${p.id}`} type="date" name="expected_date" className="input" min={todayStr()} required /></div>
          <Submit className="btn btn-primary">Sipariş verildi</Submit>
        </form>
      )}

      {["siparis", "eksik_teslim"].includes(p.status) && can.receivePurchase(u) && (
        <form action={purchaseReceive} className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-bg p-3 sm:grid-cols-4">
          <input type="hidden" name="id" value={p.id} />
          <div><label className="label" htmlFor={`g${p.id}`}>Gelen miktar ({p.unit})</label><input id={`g${p.id}`} name="qty_received" inputMode="decimal" className="input" required /></div>
          <div><label className="label" htmlFor={`h${p.id}`}>Hasarlı / iade</label><input id={`h${p.id}`} name="qty_damaged" inputMode="decimal" className="input" defaultValue="0" /></div>
          <div><label className="label" htmlFor={`d${p.id}`}>Fatura / irsaliye no</label><input id={`d${p.id}`} name="doc_no" className="input" /></div>
          <div><label className="label" htmlFor={`f${p.id}`}>Fatura tutarı (TL)</label><input id={`f${p.id}`} name="invoice_amount" inputMode="decimal" className="input" /></div>
          <div className="col-span-2 sm:col-span-3"><input name="note" className="input" placeholder="Teslimat notu (eksik, hasar…)" aria-label="Teslimat notu" /></div>
          <Submit className="btn btn-primary">{p.status === "eksik_teslim" ? "Kalanı teslim al" : "Teslim al"}</Submit>
        </form>
      )}

      {p.received_at && !p.paid_at && p.invoice_amount != null && can.markPaid(u) && (
        <form action={purchasePaid} className="mt-2">
          <input type="hidden" name="id" value={p.id} />
          <Submit className="btn btn-sm">Ödendi olarak işaretle</Submit>
        </form>
      )}
    </li>
  );
}

export default async function SatinAlma() {
  const u = await requireUser();
  const rows = all<PV>(
    `SELECT p.*, i.name AS item, i.unit, i.qty AS stock_qty, i.supplier_id AS pref_supplier, i.last_price, s.name AS supplier,
      rq.name AS requester, rv.name AS reviewer, dc.name AS decider, od.name AS orderer, rc.name AS receiver
     FROM purchases p JOIN stock_items i ON i.id=p.item_id LEFT JOIN suppliers s ON s.id=p.supplier_id
     JOIN users rq ON rq.id=p.requested_by LEFT JOIN users rv ON rv.id=p.reviewed_by LEFT JOIN users dc ON dc.id=p.decided_by
     LEFT JOIN users od ON od.id=p.ordered_by LEFT JOIN users rc ON rc.id=p.received_by
     ORDER BY p.id DESC LIMIT 200`);
  const suppliers = all<{ id: number; name: string }>("SELECT id,name FROM suppliers ORDER BY name");
  const closed = rows.filter((p) => ["teslim_alindi", "reddedildi"].includes(p.status)).slice(0, 20);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="h1">Satın alma</h1>
        <p className="muted">Talep → değerlendirme → onay → sipariş → teslim alma → ödeme. Her adım ayrı kayıttır.</p>
      </div>
      {GROUPS.map(([title, st]) => {
        const list = rows.filter((p) => st.includes(p.status));
        return (
          <section key={title} className="card">
            <h2 className="h2">{title} <span className="badge ml-1">{list.length}</span></h2>
            {list.length ? <ul className="mt-1">{list.map((p) => <Card key={p.id} p={p} u={u} suppliers={suppliers} />)}</ul> : <p className="muted mt-2">Kayıt yok.</p>}
          </section>
        );
      })}
      {closed.length > 0 && (
        <section className="card">
          <h2 className="h2">Kapananlar</h2>
          <ul className="mt-1">{closed.map((p) => <Card key={p.id} p={p} u={u} suppliers={suppliers} />)}</ul>
        </section>
      )}
    </div>
  );
}
