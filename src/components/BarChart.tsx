/** Sütun grafik: 1–2 seri, tek eksen, sıfır tabanlı; negatif değerler taban çizgisinin altına iner. Değerler kuruş. */
const C = ["#2a78d6", "#eb6834"];
const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 });

function nice(v: number) {
  if (v <= 0) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 4, 5, 8, 10].map((m) => m * p).find((m) => m >= v) ?? 10 * p;
}

export function BarChart({ data, series, values = false, height = 240 }: {
  data: { label: string; v: number[] }[]; series: string[]; values?: boolean; height?: number;
}) {
  const W = 720, H = height, L = 50, R = 8, T = 18, B = 28;
  const all = data.flatMap((d) => d.v.map((x) => x / 100));
  const hi = nice(Math.max(...all, 0)) || 1, lo = -nice(Math.max(...all.map((x) => -x), 0));
  const y = (tl: number) => T + ((hi - tl) / (hi - lo)) * (H - T - B);
  const n = series.length, slot = (W - L - R) / data.length;
  const bw = Math.max(3, Math.min(22, (slot - 6 - (n - 1) * 2) / n));
  const every = Math.ceil(data.length / 16);
  const ticks = [hi, hi / 2, 0, ...(lo < 0 ? [lo] : [])];
  return (
    <figure>
      {n > 1 && (
        <figcaption className="mb-2 flex flex-wrap gap-4 text-sm">
          {series.map((s, i) => <span key={s} className="flex items-center gap-1.5"><span className="inline-block size-3 rounded-sm" style={{ background: C[i] }} />{s}</span>)}
        </figcaption>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${series.join(" ve ")} grafiği`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#a9a495" : "#e8e4da"} strokeWidth={1} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#68706a">{compact.format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = L + slot * i + (slot - (n * bw + (n - 1) * 2)) / 2;
          return (
            <g key={i}>
              {d.v.map((kurus, k) => {
                const tl = kurus / 100, top = y(Math.max(tl, 0)), h = Math.abs(y(tl) - y(0)), x = x0 + k * (bw + 2), r = Math.min(4, h, bw / 2);
                if (h < 0.5) return null;
                const path = tl >= 0
                  ? `M${x},${top + h}V${top + r}q0,${-r} ${r},${-r}h${bw - 2 * r}q${r},0 ${r},${r}V${top + h}Z`
                  : `M${x},${top}V${top + h - r}q0,${r} ${r},${r}h${bw - 2 * r}q${r},0 ${r},${-r}V${top}Z`;
                return (
                  <g key={k}>
                    <path d={path} fill={C[k]}><title>{`${d.label} · ${series[k]}: ${full.format(tl)}`}</title></path>
                    {values && <text x={x + bw / 2} y={tl >= 0 ? top - 4 : top + h + 12} textAnchor="middle" fontSize={10} fill="#1f2421">{compact.format(tl)}</text>}
                  </g>
                );
              })}
              {i % every === 0 && <text x={L + slot * i + slot / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="#68706a">{d.label}</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
