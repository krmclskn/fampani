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
| Panel | Seçili ayın gelir tablosu geçen ayla karşılaştırmalı; ciro–gider ve net kâr grafikleri günlük/haftalık/aylık; kalemleri tuşlarla ekleyip çıkarma (her gider türü kendi renginde); bugünün cirosunu hızlı girme; borç özetleri |
| Ciro | Ay tablosunda gün gün nakit/kart girişi ya da geçmiş ay için tek rakam; ciro KDV oranı ve kart komisyonu |
| Giderler | Resmi / resmi olmayan giderler; tek formdan tek seferlik ya da her ay tekrarlayan gider (KDV oranıyla); maaş + SGK + elden ödeme girişi |
| Tedarikçiler | Alım: fatura toplamı + KDV oranı ya da ürün ürün (satır başına KDV); ödeme (istenirse aynı anda gidere yazılır); aylık toplam; borç bakiyesi |
| Borçlar | Vergi borçları ve diğer geçmiş borçlar; günlük basit faiz (aylık oran ÷ 30), ödemeler |

Gelir tablosu = ciro − tedarikçi alımları − resmi giderler (kart komisyonu dahil) − ödenecek KDV − resmi olmayan giderler.
Tüm tutarlar KDV dahil girilir. Ödenecek KDV = cirodaki KDV − alım ve giderlerde ödenen KDV − önceki aydan devreden.
Yönetim amaçlıdır; KDV, vergi ve gecikme zammı hesapları mali müşavirle doğrulanmalıdır.

**Operasyon** menüsü altında günlük işler durur: Bugün, kontrol listeleri (yönetici maddeleri, günlerini ve stok sayım görevlerini düzenler), görevler, vardiya, stok, stok talepleri,
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

Veritabanı yedeği: sunucu çalışırken veriler `data/fampani.db-wal` içinde durabilir; yedek almadan önce sunucuyu durdurun
ya da üç dosyayı (`.db`, `.db-wal`, `.db-shm`) birlikte kopyalayın.
