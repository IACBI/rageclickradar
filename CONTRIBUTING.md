# Contributing to RageClickRadar

**Read this in:** [English](#english) · [Türkçe](#turkce)

---
<a id="english"></a>
## English

Thanks for wanting to improve RageClickRadar. The project is small, privacy-first, and
deliberately narrow in scope. Contributions of any size are welcome: bug fixes, docs,
tests, and features that come with a clear argument for why they belong.

### Development setup

You need **Node 22.5 or newer**; Node 24 LTS is recommended. The server has no runtime
dependencies. The only dev dependencies are esbuild and Playwright.

```bash
git clone https://github.com/IACBI/rageclickradar.git
cd rageclickradar
npm install
npm run demo
```

`npm run demo` builds the tracker, starts the server, seeds synthetic frustration
sessions into a local demo database if it is empty, and prints the dashboard and
demo-site URLs.

### Running the tests

```bash
npm test                # unit tests (Node built-in test runner)
npm run test:e2e        # Playwright end-to-end tests (Chromium)
npm run build:tracker   # rebuild the tracker bundle; fails if it exceeds the size budget
```

The e2e suite starts its own server on a fixed port, with a fresh SQLite file for each
run, so there is nothing to start beforehand.

> **Note:** The `test` script uses the glob form (`node --test test/unit/*.test.js`).
> `node --test <directory>` does not expand a directory argument reliably on Windows,
> so keep the glob.

### Project layout

```
shared/config.js        Single source of truth for every threshold
tracker/src/            Browser tracker source (radar, detectors, selector, transport)
tracker/build.js        esbuild bundle -> tracker/dist/radar.min.js (enforces the budget)
server/                 Zero-dependency Node server (http, collect, queries, db)
dashboard/              Vanilla-JS dashboard (served at /)
demo/                   "CloudNimbus" demo site with intentional traps (/demo/)
tools/                  Demo launcher and synthetic session seeder
test/unit/              Node built-in test-runner unit tests
test/e2e/               Playwright end-to-end tests
docs/                   Documentation (self-hosting, privacy)
```

### Hard rules

These invariants define what RageClickRadar is. A change that breaks one of them will
not be merged.

- **Tracker bundle budget: 5120 bytes, hard.** `npm run build:tracker` measures the
  minified bundle and exits non-zero if it is larger than 5120 bytes. CI runs this step,
  so an oversized bundle fails the build. Keep the snippet small.
- **Zero runtime dependencies for the server.** The server runs on Node built-ins only,
  including `node:sqlite`. Do not add a runtime dependency to `package.json`. Dev-only
  tooling (esbuild, Playwright) is the only exception.
- **Privacy invariants: never weaken them.** The tracker must never read typed text or
  field values. `event.data` and `element.value` are off-limits; only input-event *types*
  are counted. The server must never store an IP address, user agent, request header,
  full URL, or any cross-site identifier. The collector writes a strict field whitelist
  and nothing else. The wire schema is described in [docs/privacy.md](docs/privacy.md),
  and the test that enforces it is `test/unit/collect.test.js`. If your change touches
  collection, that test must stay green.
- **Behavior changes need tests.** Any change to detection, storage, or the read
  endpoints needs unit-test coverage, plus e2e coverage where it affects the dashboard.
  A bug fix should come with a test that fails without the fix.

### Pull requests

- Keep PRs small and focused. One logical change per PR is much easier to review.
- CI has to pass before a PR can merge: unit tests on Node 22 and 24, the e2e suite on
  Node 24, and a tracker bundle within the budget.
- Update the docs (`README.md`, `docs/`) when behavior or configuration changes.
- Describe what you changed and how you tested it. The PR template includes a short
  checklist.

By contributing, you agree that your contributions are licensed under the MIT License,
like the rest of the project.

---
<a id="turkce"></a>
## Türkçe

[English](#english) · **Türkçe**

RageClickRadar'ı geliştirmek istediğiniz için teşekkürler. Proje küçük, gizliliği öncelik
edinen ve kapsamı bilinçli olarak dar tutulan bir projedir. Her boyutta katkı memnuniyetle
karşılanır: hata düzeltmeleri, dokümantasyon, testler ve neden gerekli olduğunu açıkça
anlatan özellikler.

### Geliştirme ortamı

**Node 22.5 veya daha yeni** bir sürüme ihtiyacınız var; Node 24 LTS önerilir. Sunucunun
çalışma zamanı bağımlılığı yoktur. Yalnızca geliştirme bağımlılıkları esbuild ve Playwright'tır.

```bash
git clone https://github.com/IACBI/rageclickradar.git
cd rageclickradar
npm install
npm run demo
```

`npm run demo` tracker'ı derler, sunucuyu başlatır, yerel demo veritabanı boşsa içine
sentetik hüsran oturumları ekler ve pano ile demo sitesinin adreslerini yazdırır.

### Testleri çalıştırma

```bash
npm test                # birim testleri (Node yerleşik test çalıştırıcısı)
npm run test:e2e        # Playwright uçtan uca testleri (Chromium)
npm run build:tracker   # tracker paketini yeniden derler; boyut bütçesini aşarsa başarısız olur
```

Uçtan uca test paketi, sabit bir portta ve her çalıştırmada yeni bir SQLite dosyasıyla kendi
sunucusunu başlatır; önceden bir şey başlatmanız gerekmez.

> **Not:** `test` betiği glob biçimini kullanır (`node --test test/unit/*.test.js`).
> `node --test <directory>` Windows'ta dizin argümanını güvenilir biçimde genişletmez, bu
> yüzden glob biçimini koruyun.

### Proje düzeni

```
shared/config.js        Her eşiğin tek doğruluk kaynağı
tracker/src/            Tarayıcı tracker kaynağı (radar, detectors, selector, transport)
tracker/build.js        esbuild paketi -> tracker/dist/radar.min.js (bütçeyi uygular)
server/                 Sıfır bağımlılıklı Node sunucusu (http, collect, queries, db)
dashboard/              Vanilla JS pano (/ adresinde sunulur)
demo/                   Kasıtlı tuzaklar içeren "CloudNimbus" demo sitesi (/demo/)
tools/                  Demo başlatıcı ve sentetik oturum tohumlayıcı
test/unit/              Node yerleşik test çalıştırıcısıyla birim testleri
test/e2e/               Playwright uçtan uca testleri
docs/                   Dokümantasyon (kendi sunucunda çalıştırma, gizlilik)
```

### Katı kurallar

Bu değişmezler RageClickRadar'ın ne olduğunu belirler. Bunlardan birini bozan bir değişiklik
birleştirilmez.

- **Tracker paketi bütçesi: 5120 bayt, kesin sınır.** `npm run build:tracker` küçültülmüş
  paketi ölçer ve 5120 baytı aşarsa sıfırdan farklı bir kodla çıkar. CI bu adımı çalıştırır,
  dolayısıyla bütçeyi aşan bir paket derlemeyi başarısız kılar. Snippet'i küçük tutun.
- **Sunucuda sıfır çalışma zamanı bağımlılığı.** Sunucu yalnızca Node yerleşikleriyle
  (`node:sqlite` dahil) çalışır. `package.json` dosyasına çalışma zamanı bağımlılığı
  eklemeyin. Yalnızca geliştirme araçları (esbuild, Playwright) istisnadır.
- **Gizlilik değişmezleri: asla zayıflatmayın.** Tracker, yazılan metni ya da alan değerlerini
  asla okumamalıdır. `event.data` ve `element.value` kullanılamaz; yalnızca input olayı
  *türleri* sayılır. Sunucu bir IP adresi, user agent, istek başlığı, tam URL ya da siteler
  arası bir tanımlayıcı saklamamalıdır. Toplayıcı katı bir alan beyaz listesi yazar, başka
  hiçbir şey yazmaz. Kablo şeması [docs/privacy.md](docs/privacy.md) dosyasında, bunu
  uygulayan test ise `test/unit/collect.test.js` dosyasındadır. Değişikliğiniz toplamaya
  dokunuyorsa bu test yeşil kalmalıdır.
- **Davranış değişiklikleri testle gelir.** Algılama, depolama ya da okuma uç noktalarındaki
  her değişiklik birim testi kapsamı ister; dashboard'u etkiliyorsa e2e kapsamı da gerekir.
  Bir hata düzeltmesi, düzeltme olmadan başarısız olan bir testle birlikte gelmelidir.

### Pull request'ler

- PR'ları küçük ve odaklı tutun. PR başına tek bir mantıksal değişiklik incelemeyi çok
  kolaylaştırır.
- Bir PR'ın birleştirilebilmesi için CI geçmelidir: Node 22 ve 24'te birim testleri, Node
  24'te e2e paketi ve bütçe içinde bir tracker paketi.
- Davranış ya da yapılandırma değiştiğinde dokümanları (`README.md`, `docs/`) güncelleyin.
- Neyi değiştirdiğinizi ve nasıl test ettiğinizi açıklayın. PR şablonunda kısa bir kontrol
  listesi bulunur.

Katkıda bulunarak, katkılarınızın projenin geri kalanı gibi MIT Lisansı altında
lisanslandığını kabul etmiş olursunuz.
