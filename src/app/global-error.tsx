"use client";

/** Kök düzende bile hata olursa gösterilen son çare ekranı (kendi html/body'sini çizer). */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="tr">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f7f5f0", color: "#1f2421", margin: 0 }}>
        <title>Fampani · bağlantı hatası</title>
        <div style={{ maxWidth: 420, margin: "0 auto", padding: "64px 16px", textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600 }}>Sayfa yüklenemedi</h1>
          <p style={{ color: "#6b6f6a" }}>Bağlantı kısa süreliğine koptu. Tekrar deneyin.</p>
          <button type="button" onClick={() => retry()}
            style={{ background: "#1f6f5c", color: "#fff", border: 0, borderRadius: 8, padding: "10px 16px", fontWeight: 600, cursor: "pointer" }}>
            Tekrar dene
          </button>
        </div>
      </body>
    </html>
  );
}
