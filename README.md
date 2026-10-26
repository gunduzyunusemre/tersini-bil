# 🔁 Tersine

Söyleyen gizli kelimeyi söyler. Telefon kaydı ters çevirir ve karşı tarafa yalnızca ters halini gönderir. Tahmin eden bu garip sesi taklit eder, telefon taklidi tekrar ters çevirir ve kelime (az çok) geri gelir. Sonra tahmin edilir.

## Oyun nasıl işler?

1. Kurucu odayı kurar ve davet bağlantısını WhatsApp'tan gönderir. Bağlantıya tıklayan sadece adını yazar.
2. Herkes isterse **Sesli sohbete katıl**'a basar. Bu, normal konuşma kanalıdır.
3. Sıra ikili ilerler: A söyler, B tahmin eder. Sonra B söyler, C tahmin eder. En sonda sıra yine A'ya gelir.
4. **Söyleyen** üç öneriden birini seçer ya da kendi kelimesini yazar. Ardından kırmızı **kelime mikrofonuna** basılı tutup kelimeyi söyler.
5. **Tahmin eden** ters sesi dinler, mor düğmeye basılı tutup duyduğunu taklit eder ve taklidinin tersini dinler. Bunu istediği kadar tekrarlayabilir. 3 tahmin hakkı vardır.
6. Tur sonunda herkes ses zincirini dinler: orijinal, ters ses, taklit ve taklidin tersi.

**Puanlama:** 1. denemede bilen 3, 2. denemede bilen 2, 3. denemede bilen 1 puan alır. Kelime bilinirse söyleyen de 1 puan alır. Bu yüzden kelimeyi net söylemek söyleyenin de işine gelir.

## İki mikrofon: orijinal kelime neden kimseye gitmez?

Aynı telefon mikrofonu iki ayrı kanal olarak kullanılır.

- **Sohbet mikrofonu** her zaman açık olan canlı konuşma kanalıdır. Oyuncular birbirine doğrudan bağlanır, ses sunucudan geçmez.
- **Kelime mikrofonu** sadece basılı tutulduğunda kayıt yapar. Kayıt sürerken sohbet mikrofonu kendiliğinden susar. Kayıt telefonun içinde ters çevrilir ve sunucuya **yalnızca ters hali** gider. Orijinal ses telefondan hiç çıkmaz.
- Söyleyene önizleme olarak da sadece ters hal dinletilir. Orijinal hoparlörden çalıp sohbete sızmasın diye bu bilinçli bir tercih.
- Kayıt yapan kişinin adının yanında herkeste 🔴 görünür.

Orijinal ses ancak tur bitince, ters sesin tekrar ters çevrilmesiyle herkese açılır.

## Önemli: https şart

Tarayıcılar mikrofonu yalnızca güvenli (`https://`) adreslerde açar. Bu oyunun tamamı mikrofona dayandığı için yerel `http://192.168…` adresi **işe yaramaz**. Aşağıdaki iki yoldan birini kullan:

- **A. Render (önerilen):** Ücretsizdir ve sabit bir `https://…onrender.com` adresi verir.
- **B. Kendi bilgisayarın + Cloudflare tüneli:** `internet.bat` (Windows) ya da `./baslat.sh --internet` her başlatmada yeni bir `https://…trycloudflare.com` adresi verir.

Sadece kendin denemek istersen bilgisayarda `http://localhost:3000` de çalışır. Ana ekrandaki **Kendi sesini dene** bunun için var.

## A. Bulutta çalıştırma (Render, ücretsiz)

1. GitHub'da yeni bir depo aç ve bu klasörün içindeki her şeyi yükle: `server.js`, `package.json`, `package-lock.json`, `render.yaml`, `public` klasörü ve diğerleri.
2. https://render.com adresinde **GitHub ile giriş yap**. **New +** menüsünden **Blueprint** seç, depoyu bağla ve **Apply**'a bas. Ayarları `render.yaml` kendisi yapar.
3. Birkaç dakika içinde sabit bir adres alırsın. Bu adresi arkadaşlarına bir kere göndermen yeter.

Ücretsiz planda 15 dakika boyunca kimse bağlanmazsa sunucu uyur. İlk açan kişi yaklaşık 1 dakika bekler. Sunucu uyuyunca açık odalar silinir.

## B. Kendi bilgisayarında

1. https://nodejs.org adresinden **LTS** sürümünü kur (18 ya da daha yeni).
2. cloudflared'i kur:
   - Windows: `winget install --id Cloudflare.cloudflared`
   - macOS: `brew install cloudflared`
3. Kurduktan sonra terminali kapatıp yeniden aç.
4. Windows'ta `internet.bat` dosyasına çift tıkla. macOS ve Linux'ta `./baslat.sh --internet` çalıştır.
5. Terminalde çıkan `https://…trycloudflare.com` bağlantısını paylaş.

Terminal penceresi kapanırsa ya da bilgisayar uykuya geçerse oyun durur.

## Sesli sohbet ipuçları

- **Kulaklık önerilir.** Ters sesi hoparlörden çalarsan sohbete de karışır. Bu sorun değil ama kulaklıkla daha temiz olur.
- Bazı mobil operatörler doğrudan bağlantıyı engeller ve kişiler birbirini duyamaz. O zaman bir TURN sunucusu gerekir (Metered, Cloudflare vb.). Bilgilerini Render'da **Environment** bölümüne `TURN_URLS`, `TURN_USERNAME` ve `TURN_CREDENTIAL` olarak ekle.
- Oyun sesleri (ters ses, taklitler) sunucu üzerinden küçük dosyalar halinde gider ve tur bitince silinir.

## Sorun giderme

| Sorun | Çözüm |
|---|---|
| "Mikrofon için sayfa https ile açılmalı" | `http://` adresindesin. Render adresini ya da tünel bağlantısını kullan. |
| Kelime mikrofonuna basınca kayıt olmuyor | Tarayıcının mikrofon iznini ver. Düğmeyi konuştuğun süre boyunca basılı tut, en fazla 5 saniye kaydeder. |
| "Ses alınamadı" | Çok sessiz konuştun ya da çok kısa bastın. Biri takıldıysa kurucu menüden **Bu turu geç** diyebilir. |
| Sesli sohbette biri diğerini duymuyor | İki taraf da çıkıp yeniden katılsın. Sürerse yukarıdaki TURN ayarına bak. |

## Dosyalar

```
server.js          Oyun sunucusu (odalar, sıra, tahmin kontrolü, ses dosyaları)
public/index.html  Oyunun kendisi (kayıt, ters çevirme, arayüz, sesli sohbet)
baslat.bat         Windows, sadece bu bilgisayarda denemek için
internet.bat       Windows, https tüneliyle (arkadaşlarla oynamak için bunu kullan)
baslat.sh          macOS / Linux  (./baslat.sh --internet)
render.yaml        Render bulut ayarları
```
