# Fampani · MekanSAL pilotu

MekanSAL işletim planının ilk hattı: **günlük vardiya → stok talebi → satın alma → teslim alma → kapanış**.

## Çalıştırma

Node.js bu makinede `~/.local/node` altına kuruludur ve PATH'e eklenmemiştir.

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npm run dev        # http://localhost:3000
```

Üretim için `npm run build && npm run start`.

## İlk giriş

Veritabanı (`data/fampani.db`, SQLite) ilk açılışta oluşur ve örnek veriyle doldurulur.
Örnek kullanıcılar: `sahip`, `operasyon`, `sef`, `stok`, `bar`, `calisan1`, `calisan2`, `mutfak1`.
Hepsinin başlangıç parolası `.env.local` içindeki `SEED_PASSWORD` değeridir.

Ayrıca iki hazır hesap vardır: `admin` (işletme sahibi yetkisi, parola `ADMIN_PASSWORD`) ve `personel`
(vardiya çalışanı yetkisi, parola `PERSONEL_PASSWORD`). Bu değerler yalnızca hesap ilk oluşturulurken kullanılır;
sonradan parola Hesabım veya Ayarlar ekranından değiştirilir. Gerçek kullanımdan önce
Ayarlar → Kişiler ekranından gerçek kişileri açın, örnek hesapları pasifleştirin ve parolaları değiştirin.

Örnek stok kartları, tedarikçiler, miktarlar, fiyatlar ve vardiyalar **gerçek değildir**; saha verisiyle değiştirilmelidir.
Sıfırdan başlamak için sunucuyu durdurup `data/` klasörünü silin.

## Kapsam

Yönetici (işletme sahibi, operasyon sorumlusu) girişte **Panel**'e düşer. Finans tarafı dört ekrandır:

| Ekran | Ne yapar |
|---|---|
| Panel | Seçili ayın gelir tablosu (P&L) geçen ayla karşılaştırmalı; son 12 ay ciro/gider ve net kâr grafikleri; günlük ciro grafiği; tedarikçi borçları; bugünün cirosunu hızlı girme |
| Ciro | Ay tablosunda gün gün nakit/kart girişi ya da geçmiş ay için tek rakamla aylık toplam; kart komisyon oranı |
| Giderler | Sabit giderler (bir kez ekle, her ay gelsin; geçmiş aydan başlat; bu aydan itibaren çıkar) ve tek seferlik giderler |
| Tedarikçiler | Tedarikçi başına alım (toplam tutar ya da ürün satırlarıyla), ödeme, aylık toplam alım ve borç bakiyesi |

Gelir tablosu = ciro − tedarikçi alımları − sabit ve diğer giderler − kart komisyonu. Tutarlar girildiği gibi (vergi dahil)
hesaplanır; yönetim amaçlıdır, resmî tablo değildir.

**Operasyon** menüsü altında günlük işler durur: Bugün, kontrol listeleri, görevler, vardiya, devir, stok, stok talepleri,
kapanış, operasyon özeti, ayarlar. Personel yalnızca bu menüyü görür.

Kapalı modüller: kasa, ürün bazlı günlük satış ve ürün/reçete ekranları (`src/lib/util.ts` içinde `FEATURES.kasa`).
Kodları ve tabloları duruyor; açıkken girilen veriler Panel'deki gelir tablosuna dahil değildir.

Roller ve yetkiler `src/lib/auth.ts`, iş kuralları `src/lib/actions.ts`, şema ve örnek veri `src/lib/db.ts` içindedir.

## Henüz yok

Arıza/bakım akışı (şimdilik istisna → görev), etkinlik ve alan takvimi, eğitim/prosedür kartları, kontrol listesi
şablonlarını arayüzden düzenleme, fotoğraf kanıtı, POS entegrasyonu, çok satırlı fatura ve ürün–tedarikçi paket/birim dönüşümü,
Excel çıktıları, toplantı notları, dosyalama, personelin alan bazlı görünürlüğü, reçete sürüm geçmişi, satış kanalı ayrımı,
içerik modülü, bildirim (push/e-posta), yedekleme.

Finans rakamları yönetim amaçlıdır; vergi oranları ürün kartında elle girilir ve mali müşavirle doğrulanmalıdır.
