/** Sayfa geçişlerinde ekran donmuş gibi görünmesin. */
export default function Loading() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Yükleniyor">
      <div className="h-7 w-40 animate-pulse rounded-lg bg-line" />
      <div className="h-24 animate-pulse rounded-xl bg-line/60" />
      <div className="h-24 animate-pulse rounded-xl bg-line/60" />
    </div>
  );
}
