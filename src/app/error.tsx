"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Kendiliğinden yeniden denemeyi seyrek tut: hata sürüyorsa döngüye girmesin.
let lastAuto = 0;

/** Sayfa yüklenirken hata olursa (çoğunlukla anlık bağlantı kopması) boş ekran yerine bu görünür. */
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const [auto] = useState(() => Date.now() - lastAuto > 15000);
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;

  useEffect(() => {
    console.error(error);
    if (!auto) return;
    const t = setTimeout(() => { lastAuto = Date.now(); retry(); }, 1000);
    return () => clearTimeout(t);
  }, [error, retry, auto]);

  return (
    <div className="mx-auto grid max-w-md gap-3 px-4 py-16 text-center">
      <h1 className="h1">Sayfa yüklenemedi</h1>
      <p className="muted">
        {auto ? "Bağlantı kısa süreliğine koptu, yeniden deneniyor…" : "Bağlantı kurulamadı. Birkaç saniye sonra tekrar deneyin."}
      </p>
      <div className="flex justify-center gap-2">
        <button type="button" className="btn btn-primary" onClick={() => retry()}>Tekrar dene</button>
        <Link href="/" className="btn">Ana sayfa</Link>
      </div>
      {digest && <p className="text-xs text-muted">Hata kodu: {digest}</p>}
    </div>
  );
}
