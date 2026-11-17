# Fampani · MekanSAL

MekanSAL için işletme paneli: finans (ciro, giderler, tedarikçiler, borçlar, gelir tablosu) ve operasyon
(iş atamaları, kontrol listeleri, yapılacaklar, stok ve sipariş).

## Mimari

- Next.js 16 (App Router, sunucu bileşenleri ve sunucu eylemleri), TypeScript, Tailwind.
- Veritabanı: **Postgres (Supabase)**. Uygulama yalnızca sunucudan bağlanır; Supabase REST API'si tablolara erişemesin diye
  tüm tablolarda satır güvenliği (RLS) açıktır ve ilke tanımlı değildir.
- `DATABASE_URL` tanımlı değilse yerel geliştirme için gömülü Postgres (PGlite, `data/pg`) kullanılır.
- Barındırma: Vercel, Tokyo bölgesi (`vercel.json`, `hnd1`) — Supabase projesi Tokyo'da (ap-northeast-1). İkisi aynı bölgede olmalı;
  Supabase taşınırsa `vercel.json` da güncellenmeli (Frankfurt için `fra1`).

## Ortam değişkenleri

| Değişken | Nerede | Değer |
|---|---|---|
| `DATABASE_URL` | `.env.local` ve Vercel | Supabase → Connect → **Transaction pooler** adresi (`…pooler.supabase.com:6543/postgres`), parola yerleştirilmiş |

`.env.local` içine `DATABASE_URL` eklendiğinde bu bilgisayardaki `npm run dev` de doğrudan Supabase'deki canlı veriye bağlanır.

## Komutlar

Node.js bu makinede `~/.local/node` altına kuruludur ve PATH'e eklenmemiştir.

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm run dev          # http://localhost:3000
npm run db:baglan    # Supabase bağlantı adresini .env.local'e yazar ve bağlantıyı dener
npm run db:import    # yerel Postgres (data/pg) → DATABASE_URL'deki Supabase; hedef doluysa durur (--force ile üzerine yazar)
npm run db:check     # hedef veritabanındaki tablo satır sayıları
```

Şema `db/schema.sql` içindedir ve tekrar çalıştırılabilir (`CREATE TABLE IF NOT EXISTS`). `db:import` önce şemayı kurar.

## Hesaplar ve yetkiler

Kişiler, Operasyon → Kişiler ekranından eklenir ve çıkarılır. Dört yetki vardır:

| Yetki | Ne görür |
|---|---|
| İşletme sahibi | Her şey: finans paneli dahil tüm ekranlar |
| İşletmeci | Tüm operasyon (iş atama, stok ve sipariş, kişiler); finansı görmez |
| Mutfak şefi | Personel ekranları + stok ürünlerini düzenleme, teslim alma |
| Personel | Bugün, Yapılacaklar, Kontrol listeleri, Stok |

## Ekranlar

| Ekran | Ne yapar |
|---|---|
| Panel | Seçili ayın gelir tablosu geçen ayla karşılaştırmalı; ciro–gider ve net kâr grafikleri günlük/haftalık/aylık; kalemleri tuşlarla ekleyip çıkarma; bugünün cirosunu hızlı girme; borç özetleri |
| Ciro | Ay tablosunda gün gün nakit/kart girişi ya da geçmiş ay için tek rakam; ciro KDV oranı, gelir vergisi oranı, kart komisyonu |
| Giderler | Resmi / resmi olmayan giderler; tek seferlik ya da her ay tekrarlayan gider (KDV oranı ya da tutarıyla); maaş + SGK + elden ödeme; ödeme tarihi |
| Tedarikçiler | Alım: fatura toplamı + KDV oranı ya da ürün ürün; ödeme (istenirse aynı anda gidere yazılır); aylık toplam; borç bakiyesi |
| Borçlar | Vergi borçları ve diğer geçmiş borçlar; günlük basit faiz (aylık oran ÷ 30), ödemeler |
| Operasyon | Genel bakış, İşler ve atamalar (haftalık plan), Yapılacaklar, Bugünkü liste, Stok ve sipariş, Kişiler |

Net kâr = ciro − tedarikçi alımları − resmi giderler (kart komisyonu dahil) − ödenecek KDV − gelir vergisi − resmi olmayan giderler.
Gelir vergisi = (ciro − alımlar − resmi giderler − ödenecek KDV) × oran. Ödenecek KDV = cirodaki KDV − alım ve giderlerde
ödenen KDV − önceki aydan devreden. Yönetim amaçlıdır; KDV, vergi ve gecikme zammı hesapları mali müşavirle doğrulanmalıdır.

Stok akışı: sayım doğrudan stoğa işlenir → minimumun altına inen ürün kendiliğinden sipariş listesine düşer → sipariş verilen
miktar yazılır → teslimatta gelen miktar yazılır ve stoğa eklenir.

Kasa, ürün/reçete, vardiya ve gün kapanışı modülleri kaldırıldı (kodları git geçmişinde, tabloları ve verileri veritabanında duruyor).

Roller ve yetkiler `src/lib/auth.ts`, operasyon kuralları `src/lib/actions.ts`, finans kuralları `src/lib/pl-actions.ts`,
hesaplar `src/lib/pl.ts`, veri katmanı `src/lib/db.ts`.
