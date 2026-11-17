"use client";

import { useState } from "react";

type G = { key: string; label: string; color: string };
type Bucket = { key: string; label: string; ciro: number; g: Record<string, [number, number]> };
type Gran = "gun" | "hafta" | "ay";
const GRAN: Record<Gran, string> = { gun: "Günlük (30 gün)", hafta: "Haftalık (12 hafta)", ay: "Aylık (12 ay)" };
const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const tl = (k: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(k / 100);
const INK = "#1f2421";

function nice(v: number) {
  if (v <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 4, 5, 8, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p;
}

function Chip({ pressed, onClick, color, children }: { pressed: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium ${pressed ? "border-ink/30 bg-surface" : "border-line bg-bg text-muted line-through"}`}>
      {color && <span className="inline-block size-3 rounded-sm" style={{ background: pressed ? color : "#c9c5b9" }} />}
      {children}
    </button>
  );
}

/** Panel grafikleri: kalemleri tuşlarla ekleyip çıkararak ciro, gider ve net kârı gör. */
export function Explorer({ data, groups }: { data: Record<Gran, Bucket[]>; groups: G[] }) {
  const [gran, setGran] = useState<Gran>("ay");
  const [on, setOn] = useState<Record<string, boolean>>(Object.fromEntries(groups.map((g) => [g.key, true])));
  const [ciroOn, setCiroOn] = useState(true), [fixedOn, setFixedOn] = useState(true);
  const active = groups.filter((g) => on[g.key]);
  const rows = data[gran].map((b) => {
    const parts = active.map((g) => ({ g, v: (fixedOn ? b.g[g.key][0] : 0) + b.g[g.key][1] }));
    const gider = parts.reduce((s, p) => s + p.v, 0), ciro = ciroOn ? b.ciro : 0;
    return { label: b.label, ciro, parts, gider, net: ciro - gider };
  });
  const last = rows[rows.length - 1];
  const sum = (k: "ciro" | "gider" | "net") => rows.reduce((s, r) => s + r[k], 0);
  const allOn = active.length === groups.length && ciroOn && fixedOn;

  const W = 720, H = 250, L = 50, R = 8, T = 14, B = 26, n = rows.length, slot = (W - L - R) / n, bw = Math.max(4, Math.min(26, slot - 6));
  const every = Math.ceil(n / 15);
  const hi = nice(Math.max(...rows.map((r) => Math.max(r.ciro, r.gider)), 0) / 100) || 1;
  const y = (k: number) => T + (1 - k / 100 / hi) * (H - T - B);
  const nHi = nice(Math.max(...rows.map((r) => r.net), 0) / 100), nLo = -nice(Math.max(...rows.map((r) => -r.net), 0) / 100);
  const span = nHi - nLo || 1, H2 = 200, y2 = (k: number) => T + ((nHi - k / 100) / span) * (H2 - T - B);
  return (
    <section className="card grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="h2">Ciro, gider ve net kâr</h2>
        <div className="flex gap-1" role="group" aria-label="Dönem">
          {(Object.keys(GRAN) as Gran[]).map((k) => <button key={k} type="button" aria-pressed={gran === k} onClick={() => setGran(k)} className={`btn btn-sm ${gran === k ? "btn-primary" : ""}`}>{GRAN[k]}</button>)}
        </div>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Hesaba katılan kalemler">
        <Chip pressed={ciroOn} onClick={() => setCiroOn(!ciroOn)} color={INK}>Ciro</Chip>
        {groups.map((g) => <Chip key={g.key} pressed={on[g.key]} onClick={() => setOn({ ...on, [g.key]: !on[g.key] })} color={g.color}>{g.label}</Chip>)}
        <Chip pressed={fixedOn} onClick={() => setFixedOn(!fixedOn)}>Sabit giderler dahil</Chip>
        {!allOn && <button type="button" className="btn btn-sm" onClick={() => { setOn(Object.fromEntries(groups.map((g) => [g.key, true]))); setCiroOn(true); setFixedOn(true); }}>Hepsini aç</button>}
      </div>

      <dl className="grid grid-cols-3 gap-3 text-sm">
        {([["Ciro", "ciro"], ["Seçili giderler", "gider"], ["Net", "net"]] as const).map(([label, k]) => (
          <div key={k} className="rounded-lg bg-bg p-3">
            <dt className="text-xs font-semibold text-muted">{label} · {last.label}</dt>
            <dd className={`text-xl font-semibold tabular-nums ${k === "net" && last.net < 0 ? "text-bad" : ""}`}>{tl(last[k])}</dd>
            <dd className="text-xs text-muted">Grafikteki dönem toplamı {tl(sum(k))}</dd>
          </div>
        ))}
      </dl>

      <figure>
        <figcaption className="mb-1 text-sm text-muted">Her dönemde solda <span className="font-semibold text-ink">ciro</span> (koyu sütun), sağında giderler (renk = tür). Ciro sütunu daha uzunsa kâr var.</figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Dönemlere göre gider türleri ve ciro; aynı veriler aşağıdaki tabloda">
          {[0, 0.5, 1].map((f) => (
            <g key={f}><line x1={L} x2={W - R} y1={y(hi * 100 * f)} y2={y(hi * 100 * f)} stroke={f ? "#e8e4da" : "#a9a495"} />
              <text x={L - 6} y={y(hi * 100 * f) + 4} textAnchor="end" fontSize={11} fill="#68706a">{compact.format(hi * f)}</text></g>
          ))}
          {rows.map((r, i) => {
            // Ciro açıkken iki sütun yan yana: solda ciro, sağda yığılmış giderler.
            const w = ciroOn ? Math.max(3, Math.min(20, (slot - 8) / 2)) : bw;
            const x0 = L + slot * i + (slot - (ciroOn ? 2 * w + 2 : w)) / 2, x = ciroOn ? x0 + w + 2 : x0;
            let acc = 0;
            return (
              <g key={i}>
                {ciroOn && r.ciro > 0 && (
                  <path d={`M${x0},${y(0)}V${y(r.ciro) + Math.min(3, w / 2)}q0,${-Math.min(3, w / 2)} ${Math.min(3, w / 2)},${-Math.min(3, w / 2)}h${w - 2 * Math.min(3, w / 2)}q${Math.min(3, w / 2)},0 ${Math.min(3, w / 2)},${Math.min(3, w / 2)}V${y(0)}Z`} fill={INK}>
                    <title>{`${r.label} · Ciro: ${tl(r.ciro)}`}</title>
                  </path>
                )}
                {r.parts.map((p) => {
                  if (p.v <= 0) return null;
                  const y1 = y(acc + p.v), h = y(acc) - y1; acc += p.v;
                  return h > 0.4 ? <rect key={p.g.key} x={x} y={y1} width={w} height={Math.max(h - 1.5, 0.5)} rx={1.5} fill={p.g.color}><title>{`${r.label} · ${p.g.label}: ${tl(p.v)}`}</title></rect> : null;
                })}
                {i % every === 0 && <text x={L + slot * i + slot / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#68706a">{r.label}</text>}
              </g>
            );
          })}
        </svg>
      </figure>

      <figure>
        <figcaption className="mb-1 text-sm font-semibold">Net kâr <span className="font-normal text-muted">(seçili kalemlerle)</span></figcaption>
        <svg viewBox={`0 0 ${W} ${H2}`} className="w-full" role="img" aria-label="Dönemlere göre net kâr">
          {[...new Set([nHi, 0, nLo])].map((t) => (
            <g key={t}><line x1={L} x2={W - R} y1={y2(t * 100)} y2={y2(t * 100)} stroke={t === 0 ? "#a9a495" : "#e8e4da"} />
              <text x={L - 6} y={y2(t * 100) + 4} textAnchor="end" fontSize={11} fill="#68706a">{compact.format(t)}</text></g>
          ))}
          {rows.map((r, i) => {
            const x = L + slot * i + (slot - bw) / 2, top = y2(Math.max(r.net, 0)), h = Math.abs(y2(r.net) - y2(0));
            return (
              <g key={i}>
                {h > 0.4 && <rect x={x} y={top} width={bw} height={h} rx={2} fill={r.net >= 0 ? "#1f6f5c" : "#b3261e"}><title>{`${r.label} · Net: ${tl(r.net)}`}</title></rect>}
                {n <= 12 && r.net !== 0 && <text x={x + bw / 2} y={r.net >= 0 ? top - 4 : top + h + 12} textAnchor="middle" fontSize={10} fill={INK}>{compact.format(r.net / 100)}</text>}
                {i % every === 0 && <text x={L + slot * i + slot / 2} y={H2 - 8} textAnchor="middle" fontSize={11} fill="#68706a">{r.label}</text>}
              </g>
            );
          })}
        </svg>
      </figure>

      <details>
        <summary className="text-sm font-medium text-accent underline underline-offset-2">Rakamları tablo olarak göster</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Dönem</th><th className="num">Ciro</th>{active.map((g) => <th key={g.key} className="num">{g.label}</th>)}<th className="num">Toplam gider</th><th className="num">Net</th></tr></thead>
            <tbody>
              {[...rows].reverse().map((r, i) => (
                <tr key={i}><td>{r.label}</td><td className="num">{tl(r.ciro)}</td>{r.parts.map((p) => <td key={p.g.key} className="num">{tl(p.v)}</td>)}
                  <td className="num">{tl(r.gider)}</td><td className={`num font-semibold ${r.net < 0 ? "text-bad" : ""}`}>{tl(r.net)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="muted">Günlük ve haftalık görünümde giderler (sabit ve tek seferlik) ile aylık toplamlar ait oldukları ayın günlerine eşit dağıtılır; tedarikçi alımları fatura gününde görünür; ödenecek KDV ve gelir vergisi günlük ciroyla orantılı dağıtılır.</p>
    </section>
  );
}
