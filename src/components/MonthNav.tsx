import Link from "next/link";
import { periodLabel, shiftPeriod } from "@/lib/util";

export function MonthNav({ base, period, current }: { base: string; period: string; current: string }) {
  const prev = shiftPeriod(period, -1), next = shiftPeriod(period, 1);
  return (
    <div className="flex items-center gap-2">
      <Link href={`${base}?ay=${prev}`} className="btn btn-sm" aria-label={`Önceki ay: ${periodLabel(prev)}`}>←</Link>
      <span className="min-w-32 text-center font-semibold">{periodLabel(period)}</span>
      {next <= current
        ? <Link href={`${base}?ay=${next}`} className="btn btn-sm" aria-label={`Sonraki ay: ${periodLabel(next)}`}>→</Link>
        : <span className="btn btn-sm opacity-40" aria-hidden>→</span>}
      {period !== current && <Link href={base} className="btn btn-sm">Bu ay</Link>}
    </div>
  );
}
