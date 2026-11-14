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
Hepsinin başlangıç parolası `.env.local` içindeki `SEED_PASSWORD` değeridir. Gerçek kullanımdan önce
Ayarlar → Kişiler ekranından gerçek kişileri açın, örnek hesapları pasifleştirin ve parolaları değiştirin.

Örnek stok kartları, tedarikçiler, miktarlar, fiyatlar ve vardiyalar **gerçek değildir**; saha verisiyle değiştirilmelidir.
Sıfırdan başlamak için sunucuyu durdurup `data/` klasörünü silin.

## Kapsam

| Ekran | Ne yapar |
|---|---|
| Bugün | Vardiyam, işlerim, kontrol listesi ilerlemesi, bekleyen devir |
| Kontrol listeleri | Alan bazlı açılış/kapanış; yapılamayan iş istisna nedeniyle kapanır ve sorumluya görev açar |
| Görevler | Atama, öncelik, kontrol/onay, iptal; çalışan bildirimi operasyon sorumlusuna düşer |
| Vardiya | 7 günlük plan, vardiya sorumlusu, bar/mutfak için kapsanmayan saat uyarısı |
| Devir | Devreden kaydı oluşturur, devralan “teslim aldım” ile kapatır |
| Stok | Stok kartı, sayım (tolerans üstü fark onaya gider), eksik bildirimi, tedarikçiler |
| Satın alma | Talep → değerlendirme → onay (tutar limitli) → sipariş → teslim alma → ödeme |
| Kapanış | Kapanış listesi tamamlanmadan kapatılamaz; nakit/POS kaydı; açık işler devreder |
| Yönetim özeti | Günlük göstergeler ve kayıt geçmişi (sahip, operasyon) |
| Ayarlar | Onay limiti, sayım toleransı, çalışma saatleri, kişiler ve roller |

Roller ve yetkiler `src/lib/auth.ts`, iş kuralları `src/lib/actions.ts`, şema ve örnek veri `src/lib/db.ts` içindedir.

## Henüz yok

Arıza/bakım akışı (şimdilik istisna → görev), etkinlik ve alan takvimi, eğitim/prosedür kartları, kontrol listesi
şablonlarını arayüzden düzenleme, fotoğraf kanıtı, reçete/fire, POS entegrasyonu, fatura–ödeme ayrıntısı, içerik modülü,
bildirim (push/e-posta), yedekleme.
