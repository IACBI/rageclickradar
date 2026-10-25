<a id="top"></a>
# RageClickRadar

[![CI](https://github.com/IACBI/rageclickradar/actions/workflows/ci.yml/badge.svg)](https://github.com/IACBI/rageclickradar/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.5-brightgreen.svg)](docs/self-hosting.md)

**Read this in:** [English](#english) · [Türkçe](#turkce)

---
<a id="english"></a>
## English

### Overview

RageClickRadar finds the buttons that do nothing, the forms people give up on, and
the spots where users click angrily over and over. It is self-hosted and built to
measure frustration without tracking people: no cookies, no keystroke capture, and
no IP address or user agent is ever stored.

It has three parts. A browser snippet (a 5120-byte budget, enforced in CI) computes
the signals on the page. One Node process with no runtime dependencies receives and
stores them. A SQLite file, which you own, holds the data.

Most session-analytics tools collect as much as they can: full URLs, mouse
recordings, keystrokes, IP-based identities, cross-site cookies. That is a privacy
liability and, in many jurisdictions, a consent-banner problem. RageClickRadar works
the other way. The browser detects a behavioral signal (a rage-click burst, a dead
click, an abandoned form) and sends only the anonymous conclusion: a signal type, a
sanitized CSS selector, a coordinate, and a magnitude. The frustrating parts of your
UI show up. The surveillance never gets built.

#### Privacy

- No cookies. The per-tab id lives in `sessionStorage` and is discarded when the tab closes.
- No typed text, field values, or keystrokes are read. Correction and abandonment
  signals count input-event types only.
- No IP address, user agent, request header, or full URL is stored. The database
  schema has no such column.
- Identifier-like path segments (numbers, UUIDs, tokens, email addresses) are stored as `:id`.
- Any element can be excluded with `data-radar-ignore`.

Whether you need a consent banner depends on your jurisdiction and your stack. The
wire schema, the full list of what is not collected, and the GDPR notes are in
[docs/privacy.md](docs/privacy.md).

#### How it fits together

```
  Browser                          Your server (one Node process)
 +-----------+   POST text/plain   +----------------------------+
 |  radar.js | ------------------> |  /api/collect  (validate,  |
 | (~5 KB)   |   {v,sid,page,...}  |   rate-limit, whitelist)   |
 +-----------+                     +-------------+--------------+
      ^  computes signals                        |
      |  in the browser;                         v
      |  sends conclusions              +------------------+
      |  only (no text/PII)             |  SQLite (WAL)    |
      |                                 |  radar.db        |
      |                                 +--------+---------+
      |   GET /api/pages|heatmap|...             |
 +----+------------------------------------------v---------+
 |  Dashboard (vanilla JS, served from /)                  |
 +--------------------------------------------------------+
```

The collector writes only whitelisted fields. The dashboard reads aggregated data
through the `/api/*` endpoints. The code layout is described in
[CONTRIBUTING.md](CONTRIBUTING.md#project-layout).

### Features

#### Signals

RageClickRadar detects four kinds of frustration. Every threshold is a plain number
in [`shared/config.js`](shared/config.js). You can override any of them per site at
runtime; see [Configuration](#configuration).

| Signal | What it means | Default trigger | Tune via (`window.RadarConfig` keys) |
| --- | --- | --- | --- |
| **Rage click** | The user clicks the same spot repeatedly. | At least 3 clicks, each within 500 ms of the previous one and all within 30 px of the first. The burst is emitted 700 ms after the last click. | `RAGE_MIN_CLICKS`, `RAGE_MAX_GAP_MS`, `RAGE_RADIUS_PX`, `RAGE_SETTLE_MS` |
| **Dead click** | The user clicks something that looks clickable but is not. | The target is not a link, button, form control, or other interactive element and has no `cursor: pointer`. Nothing changes within 600 ms: no DOM mutation, scroll, text selection, or URL change. | `DEAD_WAIT_MS`, `DEAD_MAX_ANCESTORS`, `DEAD_SCROLL_PX`, `DEAD_DRAG_PX` |
| **Form abandonment** | The user works in a form and leaves without submitting. | One field received at least 3 input events, and the form was never submitted. Fires when the page is hidden, or after 30 s of focus elsewhere. A lone search box (one field) never fires it. | `FORM_MIN_INPUTS`, `FORM_BLUR_ABANDON_MS` |
| **Correction** | The user fights a field, deleting and retyping heavily. | In one field engagement: at least 8 deletions, and deletions are at least 0.5 × insertions. Only input-event types are counted; the text is never read. | `CORRECTION_MIN_DELETES`, `CORRECTION_RATIO` |

Each page's **confusion score** is the weighted sum of its signal rows: rage 3,
form abandonment 3, correction 2, dead click 1 (`SCORE_WEIGHTS`, applied on the server).

#### Dashboard

The dashboard at `/` ranks pages by confusion score. From there you can open a page
to see a click heatmap (filterable by signal type, overlaid on a live preview of the
page), selector-level hotspots, and anonymous per-session timelines. A redacted path
such as `/users/:id` is not a real route, so its heatmap falls back to an abstract layout.

#### Single-page apps

The tracker listens to `popstate` and `hashchange`. History API and hash route changes
count as page reactions, so a client-side navigation is not misread as a dead click.

#### Screenshots

![Dashboard: pages ranked by confusion score, with per-type signal counts](docs/img/dashboard-pages.png)

![Click heatmap overlaid on a live preview of the page, filterable by signal type](docs/img/heatmap.png)

![Session timeline: an anonymous per-tab session's signals in order](docs/img/session-timeline.png)

### Requirements

- **Node.js 22.5 or newer.** Node 24 LTS is recommended.
- No other runtime dependency. esbuild and Playwright are development dependencies only.

The server stores data with `node:sqlite`. On Node 22.5–22.12 and 23.0–23.3 that
module needs a flag, so start the server with `node --experimental-sqlite server/index.js`.
The npm scripts do not pass the flag. Node 22.13 and later, and 23.4 and later,
need no flag. The full version matrix is in [docs/self-hosting.md](docs/self-hosting.md#node-version-matrix).

### Installation

#### Try the demo

```bash
git clone https://github.com/IACBI/rageclickradar.git
cd rageclickradar
npm install && npm run demo
```

`npm run demo` builds the tracker if it is missing, starts the server against a
local demo database (`./data/demo.db`), seeds 40 synthetic sessions if the database is
empty, and prints the dashboard and demo-site URLs. The demo site, "CloudNimbus", is a
deliberately confusing three-page SaaS site full of traps. Click around it to produce
your own signals.

#### Run it on your own server

```bash
PORT=9000 DB_PATH=/var/lib/rageclickradar/radar.db npm start
```

The server reads its settings from environment variables (see [Configuration](#configuration)).
For systemd, an HTTPS reverse proxy, backups, and multi-site setups, see
[docs/self-hosting.md](docs/self-hosting.md).

#### Add the snippet to your site

If your pages are served from the same origin as the collector:

```html
<script src="/radar.js" defer></script>
```

If they are served from another origin, point the snippet at the collector:

```html
<script src="https://your-host/radar.js"
        data-endpoint="https://your-host/api/collect" defer></script>
```

That is the whole install.

### Usage

- The dashboard is at `/`. The demo site is at `/demo/`.
- Add `data-radar-ignore` to an element, or to an ancestor, to stop tracking it.
- Add `data-radar-allow-rapid` to suppress rage-click detection on controls where
  repeated clicking is normal.
- The tracker already exempts `input[type=number]`, `[role=spinbutton]`,
  `[role=slider]`, and elements whose class contains `stepper`, `carousel`, or `qty`.
- The dashboard fills in as real traffic arrives. To load synthetic data into a running
  server, run `npm run seed` (see [Contributing](#contributing)).
- There are no user accounts. The dashboard has no authentication of its own, so
  restrict it with a reverse proxy, a VPN, or an allow-list before you expose it.

### Configuration

#### Server environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8639` | HTTP port for the collector and the dashboard. |
| `DB_PATH` | `./data/radar.db` | SQLite file (WAL mode). The parent directory is created if needed. |
| `HOST` | `127.0.0.1` | Interface to bind. Loopback only by default. Set `0.0.0.0` to expose the server, but the read API has no authentication. |
| `TRUST_PROXY` | *(empty)* | Comma-separated IPs of reverse proxies whose `X-Forwarded-For` is trusted for rate limiting. Empty trusts none. |
| `RETENTION_DAYS` | *(off)* | Delete events and sessions older than this many days, at startup and then hourly. Empty or `0` keeps everything. |
| `PATH_REDACTION` | `on` | `off` stores page paths verbatim. Otherwise identifier-like path segments are stored as `:id`. See [docs/privacy.md](docs/privacy.md). |

An invalid value stops the server at startup with a one-line error. The server-side
limits (`DEFAULT_PORT`, `MAX_BODY_BYTES`, `RATE_LIMIT_PER_MIN`, `SCORE_WEIGHTS`) live in
`shared/config.js` and cannot be changed from the browser.

#### Data retention and deletion

Retention is off by default, so data stays until you delete it. To bound the database,
set `RETENTION_DAYS=90` (a common starting point). To erase everything, stop the server
and delete `radar.db` together with its `-wal` and `-shm` files. Backups and `VACUUM`
are covered in [docs/self-hosting.md](docs/self-hosting.md#data-retention).

#### Tracker thresholds

Set `window.RadarConfig` before the snippet loads to override any of these. Each key is
optional and falls back to its default.

```html
<script>
  window.RadarConfig = { RAGE_MIN_CLICKS: 4, DEAD_WAIT_MS: 800 };
</script>
<script src="/radar.js" defer></script>
```

| Key | Default | Meaning |
| --- | --- | --- |
| `RAGE_MIN_CLICKS` | `3` | Clicks needed to qualify as a rage burst. |
| `RAGE_MAX_GAP_MS` | `500` | Maximum ms between consecutive clicks in a burst. |
| `RAGE_RADIUS_PX` | `30` | Maximum px distance from the burst's first click. |
| `RAGE_SETTLE_MS` | `700` | Ms of silence that closes a burst (emitted once). |
| `DEAD_WAIT_MS` | `600` | Reaction window after a click before it counts as dead. |
| `DEAD_MAX_ANCESTORS` | `10` | Ancestor levels checked for interactivity. |
| `DEAD_SCROLL_PX` | `5` | Scroll movement (px) that counts as a page reaction. |
| `DEAD_DRAG_PX` | `5` | Pointer travel between press and release that counts as a text-selection drag. |
| `FORM_MIN_INPUTS` | `3` | Input events on one field before the form counts as engaged. |
| `FORM_BLUR_ABANDON_MS` | `30000` | Ms of focus elsewhere before an engaged form counts as abandoned. |
| `CORRECTION_MIN_DELETES` | `8` | Minimum deletions in one field engagement. |
| `CORRECTION_RATIO` | `0.5` | Deletions must be at least this ratio times insertions. |
| `MAX_EVENTS_PER_PAGEVIEW` | `200` | Hard cap per page view. The tracker goes silent after it. |
| `BATCH_MAX_EVENTS` | `50` | Flush a batch once this many events are buffered. |
| `BATCH_INTERVAL_MS` | `5000` | Periodic flush interval. |
| `SELECTOR_MAX_LEN` | `120` | Hard cap on the length of an emitted CSS selector. |

### Contributing

Set up and run the checks:

```bash
npm test                       # unit tests (Node built-in test runner)
npm run build:tracker          # rebuild tracker/dist/radar.min.js and enforce the 5120-byte budget
npm run test:e2e               # Playwright end-to-end tests (Chromium)
npm run seed -- --sessions 40 --seed 42 --url http://127.0.0.1:8639 --verify
```

The seeder posts synthetic sessions through the real `/api/collect` endpoint, so the
server must be running first. A fixed `--seed` makes the output deterministic, and
`--verify` checks through the read endpoints that the data is ready for a demo.

Contributions are welcome: bug fixes, docs, tests, and well-argued features. Read
[CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup, the project layout, and the rules
that keep the project honest: the tracker budget, zero server runtime dependencies,
and the privacy invariants. Please also follow the [Code of Conduct](CODE_OF_CONDUCT.md).

To report a security issue, use GitHub's private vulnerability reporting rather than a
public issue. See [SECURITY.md](SECURITY.md).

### License

MIT. © 2026 𝓐.𝓒.𝓑. See [LICENSE](LICENSE).

[⬆ Back to top](#top)

---
<a id="turkce"></a>
## Türkçe

### Genel Bakış

RageClickRadar, hiçbir işe yaramayan düğmeleri, yarıda bırakılan formları ve
kullanıcıların öfkeyle üst üste tıkladığı noktaları bulur. Kendi sunucunuzda çalışır ve
insanları izlemeden hüsranı ölçmek için tasarlanmıştır: çerez yoktur, tuş vuruşları
kaydedilmez, IP adresi ya da user agent hiçbir zaman saklanmaz.

Üç parçadan oluşur. Tarayıcıdaki snippet (CI'da uygulanan 5120 baytlık bir bütçe
içinde) sinyalleri sayfada hesaplar. Çalışma zamanı bağımlılığı olmayan tek bir Node
süreci bunları alıp saklar. Verileri, size ait tek bir SQLite dosyası tutar.

Oturum analitiği araçlarının çoğu mümkün olan her şeyi toplar: tam URL'ler, fare
kayıtları, tuş vuruşları, IP'ye dayalı kimlikler, siteler arası çerezler. Bu bir
gizlilik riskidir ve birçok yargı bölgesinde çerez onay penceresi sorunudur.
RageClickRadar tersini yapar. Tarayıcı bir davranış sinyalini (öfke tıklaması serisi,
ölü tıklama, terk edilmiş form) algılar ve yalnızca anonim sonucu gönderir: sinyal
türünü, temizlenmiş bir CSS seçicisini, bir koordinatı ve bir büyüklüğü. Arayüzünüzün
sorunlu yerleri görünür olur; gözetleme mekanizması ise hiç kurulmaz.

#### Gizlilik

- Çerez yoktur. Sekme başına kimlik `sessionStorage` içinde tutulur ve sekme
  kapandığında silinir.
- Yazılan metin, alan değerleri ve tuş vuruşları okunmaz. Düzeltme ve terk sinyalleri
  yalnızca input olayı türlerini sayar.
- IP adresi, user agent, istek başlığı ya da tam URL saklanmaz. Veritabanı şemasında
  bu alanların hiçbiri yoktur.
- Sayı, UUID, belirteç ve e-posta adresi gibi tanımlayıcı yol parçaları `:id` olarak
  saklanır.
- Herhangi bir öğe `data-radar-ignore` ile izlemenin dışında bırakılabilir.

Çerez onayı gerekip gerekmediği yargı bölgenize ve kurulumunuza bağlıdır. Veri şeması,
toplanmayanların tam listesi ve GDPR notları [docs/privacy.md](docs/privacy.md)
dosyasındadır.

#### Nasıl çalışır

```
  Browser                          Your server (one Node process)
 +-----------+   POST text/plain   +----------------------------+
 |  radar.js | ------------------> |  /api/collect  (validate,  |
 | (~5 KB)   |   {v,sid,page,...}  |   rate-limit, whitelist)   |
 +-----------+                     +-------------+--------------+
      ^  computes signals                        |
      |  in the browser;                         v
      |  sends conclusions              +------------------+
      |  only (no text/PII)             |  SQLite (WAL)    |
      |                                 |  radar.db        |
      |                                 +--------+---------+
      |   GET /api/pages|heatmap|...             |
 +----+------------------------------------------v---------+
 |  Dashboard (vanilla JS, served from /)                  |
 +--------------------------------------------------------+
```

Toplayıcı yalnızca beyaz listeye alınmış alanları yazar. Pano, toplanmış verileri
`/api/*` uç noktaları üzerinden okur. Kod düzeni [CONTRIBUTING.md](CONTRIBUTING.md)
dosyasında anlatılır.

### Özellikler

#### Sinyaller

RageClickRadar dört tür hüsran algılar. Her eşik [`shared/config.js`](shared/config.js)
içinde düz bir sayıdır ve site bazında çalışma zamanında geçersiz kılınabilir (bkz.
Yapılandırma bölümü).

| Sinyal | Anlamı | Varsayılan tetikleyici | Ayar anahtarları (`window.RadarConfig`) |
| --- | --- | --- | --- |
| **Öfke tıklaması (Rage click)** | Kullanıcı aynı noktaya üst üste tıklar. | En az 3 tıklama; her biri bir öncekinden en fazla 500 ms sonra, hepsi ilk tıklamadan 30 px içinde. Seri, son tıklamadan 700 ms sonra yayınlanır. | `RAGE_MIN_CLICKS`, `RAGE_MAX_GAP_MS`, `RAGE_RADIUS_PX`, `RAGE_SETTLE_MS` |
| **Ölü tıklama (Dead click)** | Kullanıcı tıklanabilir görünen ama öyle olmayan bir şeye tıklar. | Hedef bir bağlantı, düğme, form denetimi ya da başka bir etkileşimli öğe değildir ve `cursor: pointer` taşımaz. 600 ms içinde DOM değişikliği, kaydırma, metin seçimi ya da URL değişikliği olmaz. | `DEAD_WAIT_MS`, `DEAD_MAX_ANCESTORS`, `DEAD_SCROLL_PX`, `DEAD_DRAG_PX` |
| **Form terk etme (Form abandonment)** | Kullanıcı bir formla çalışır, göndermeden ayrılır. | Bir alan en az 3 input olayı almıştır ve form hiç gönderilmemiştir. Sayfa gizlendiğinde ya da odak 30 sn başka yerde kaldığında tetiklenir. Tek kutulu bir arama alanı bunu tetiklemez. | `FORM_MIN_INPUTS`, `FORM_BLUR_ABANDON_MS` |
| **Düzeltme (Correction)** | Kullanıcı bir alanla boğuşur, çok silip yeniden yazar. | Tek bir alan etkileşiminde: en az 8 silme ve silme sayısı en az ekleme sayısının yarısı. Yalnızca olay türleri sayılır, metin okunmaz. | `CORRECTION_MIN_DELETES`, `CORRECTION_RATIO` |

Her sayfanın **kafa karışıklığı puanı (confusion score)**, sinyal satırlarının türe
göre ağırlıklı toplamıdır: öfke tıklaması 3, form terk etme 3, düzeltme 2, ölü tıklama
1 (`SCORE_WEIGHTS`, sunucu tarafında uygulanır).

#### Pano

`/` adresindeki pano sayfaları kafa karışıklığı puanına göre sıralar. Bir sayfayı
açtığınızda sinyal türüne göre filtrelenebilen bir tıklama ısı haritası (canlı önizlemenin
üzerine bindirilmiş), seçici düzeyinde etkin noktalar ve anonim oturum zaman çizelgeleri
görürsünüz. `/users/:id` gibi gizlenmiş bir yol gerçek bir rota değildir; bu yüzden
ısı haritası o sayfada soyut bir yerleşim gösterir.

#### Tek sayfalık uygulamalar

Tracker `popstate` ve `hashchange` olaylarını dinler. History API ve hash rota
değişiklikleri sayfa tepkisi sayılır; istemci tarafındaki bir gezinme ölü tıklama olarak
yanlış okunmaz.

#### Ekran görüntüleri

![Pano: sayfalar kafa karışıklığı puanına göre sıralı, tür başına sinyal sayılarıyla](docs/img/dashboard-pages.png)

![Tıklama ısı haritası, sayfanın canlı önizlemesinin üzerinde, sinyal türüne göre filtrelenebilir](docs/img/heatmap.png)

![Oturum zaman çizelgesi: anonim bir sekme oturumunun sinyalleri sırayla](docs/img/session-timeline.png)

### Gereksinimler

- **Node.js 22.5 veya daha yeni.** Node 24 LTS önerilir.
- Başka bir çalışma zamanı bağımlılığı yoktur. esbuild ve Playwright yalnızca geliştirme
  bağımlılığıdır.

Sunucu veriyi `node:sqlite` ile saklar. Node 22.5–22.12 ve 23.0–23.3 sürümlerinde bu
modül bayrak gerektirir; sunucuyu `node --experimental-sqlite server/index.js` ile
başlatın. npm betikleri bu bayrağı geçmez. Node 22.13 ve sonrasında, 23.4 ve sonrasında
bayrak gerekmez. Sürüm tablosunun tamamı [docs/self-hosting.md](docs/self-hosting.md)
dosyasındadır.

### Kurulum

#### Demoyu deneyin

```bash
git clone https://github.com/IACBI/rageclickradar.git
cd rageclickradar
npm install && npm run demo
```

`npm run demo`, tracker yoksa onu derler, sunucuyu yerel demo veritabanına (`./data/demo.db`)
karşı başlatır, veritabanı boşsa 40 sentetik oturum ekler ve pano ile demo sitesinin
adreslerini yazdırır. "CloudNimbus" adlı demo sitesi, tuzaklarla dolu ve bilerek kafa
karıştırıcı tasarlanmış üç sayfalık bir SaaS sitesidir. Kendi sinyallerinizi üretmek için
içinde gezinin.

#### Kendi sunucunuzda çalıştırın

```bash
PORT=9000 DB_PATH=/var/lib/rageclickradar/radar.db npm start
```

Sunucu ayarlarını ortam değişkenlerinden okur (bkz. Yapılandırma bölümü). systemd, HTTPS
ters proxy, yedekleme ve çoklu site kurulumları için [docs/self-hosting.md](docs/self-hosting.md)
dosyasına bakın.

#### Snippet'i sitenize ekleyin

Sayfalarınız toplayıcıyla aynı origin'den sunuluyorsa:

```html
<script src="/radar.js" defer></script>
```

Farklı bir origin'den sunuluyorsa snippet'i toplayıcıya yönlendirin:

```html
<script src="https://your-host/radar.js"
        data-endpoint="https://your-host/api/collect" defer></script>
```

Kurulumun tamamı bu kadar.

### Kullanım

- Pano `/` adresinde, demo sitesi `/demo/` adresinde çalışır.
- Bir öğeye, ya da bir üst öğesine `data-radar-ignore` eklerseniz o alan izlenmez.
- Tekrarlı tıklamanın normal olduğu kontrollerde öfke tıklaması algılamasını kapatmak için
  `data-radar-allow-rapid` ekleyin.
- Tracker, `input[type=number]`, `[role=spinbutton]`, `[role=slider]` ve sınıf adında
  `stepper`, `carousel` ya da `qty` geçen öğeleri zaten muaf tutar.
- Pano gerçek trafik geldikçe dolar. Çalışan bir sunucuya sentetik veri eklemek için
  `npm run seed` komutunu kullanın (bkz. Katkı bölümü).
- Kullanıcı hesabı yoktur. Panonun kendi kimlik doğrulaması da yoktur; açmadan önce bir ters
  proxy, VPN ya da izin listesiyle kısıtlayın.

### Yapılandırma

#### Sunucu ortam değişkenleri

| Değişken | Varsayılan | Anlamı |
| --- | --- | --- |
| `PORT` | `8639` | Toplayıcı ve pano için HTTP portu. |
| `DB_PATH` | `./data/radar.db` | SQLite dosyası (WAL modu). Üst dizin gerekirse oluşturulur. |
| `HOST` | `127.0.0.1` | Bağlanılacak arayüz. Varsayılan yalnızca loopback'tir. Sunucuyu dışarı açmak için `0.0.0.0` kullanın; ancak okuma API'sinin kimlik doğrulaması yoktur. |
| `TRUST_PROXY` | *(boş)* | Hız sınırlaması için `X-Forwarded-For` değerine güvenilen ters proxy'lerin virgülle ayrılmış IP'leri. Boşsa hiçbirine güvenilmez. |
| `RETENTION_DAYS` | *(kapalı)* | Bu kadar günden eski olayları ve oturumları başlangıçta, sonra saatte bir siler. Boş ya da `0` her şeyi saklar. |
| `PATH_REDACTION` | `on` | `off` yolları olduğu gibi saklar. Aksi halde tanımlayıcı benzeri yol parçaları `:id` olarak saklanır. Bkz. [docs/privacy.md](docs/privacy.md). |

Geçersiz bir değer, sunucuyu başlangıçta tek satırlık bir hatayla durdurur. Sunucu
tarafı sınırları (`DEFAULT_PORT`, `MAX_BODY_BYTES`, `RATE_LIMIT_PER_MIN`, `SCORE_WEIGHTS`)
`shared/config.js` içinde yer alır ve tarayıcıdan değiştirilemez.

#### Veri saklama ve silme

Saklama varsayılan olarak kapalıdır; veriler siz silene kadar durur. Veritabanını sınırlamak
için `RETENTION_DAYS=90` ayarlayabilirsiniz (yaygın bir başlangıç değeridir). Her şeyi
silmek için sunucuyu durdurun ve `radar.db` dosyasını, yanındaki `-wal` ve `-shm` dosyalarıyla
birlikte silin. Yedekleme ve `VACUUM` için [docs/self-hosting.md](docs/self-hosting.md#data-retention)
dosyasına bakın.

#### Tracker eşikleri

Aşağıdakilerin herhangi birini geçersiz kılmak için snippet yüklenmeden önce `window.RadarConfig`
değerini ayarlayın. Her anahtar isteğe bağlıdır ve belirtilmezse varsayılana döner.

```html
<script>
  window.RadarConfig = { RAGE_MIN_CLICKS: 4, DEAD_WAIT_MS: 800 };
</script>
<script src="/radar.js" defer></script>
```

| Anahtar | Varsayılan | Anlamı |
| --- | --- | --- |
| `RAGE_MIN_CLICKS` | `3` | Bir öfke serisi sayılması için gereken tıklama sayısı. |
| `RAGE_MAX_GAP_MS` | `500` | Bir serideki ardışık tıklamalar arasındaki en fazla ms. |
| `RAGE_RADIUS_PX` | `30` | Serinin ilk tıklamasından en fazla px uzaklık. |
| `RAGE_SETTLE_MS` | `700` | Seriyi kapatan sessizlik süresi (ms). Seri bir kez yayınlanır. |
| `DEAD_WAIT_MS` | `600` | Bir tıklamanın ölü sayılmadan önceki tepki penceresi. |
| `DEAD_MAX_ANCESTORS` | `10` | Etkileşimlilik için kontrol edilen üst öğe seviyesi. |
| `DEAD_SCROLL_PX` | `5` | Sayfa tepkisi sayılan kaydırma miktarı (px). |
| `DEAD_DRAG_PX` | `5` | Basma ve bırakma arasındaki, metin seçimi sürüklemesi sayılan imleç hareketi (px). |
| `FORM_MIN_INPUTS` | `3` | Formun etkileşimli sayılması için tek bir alanda gereken input olayı sayısı. |
| `FORM_BLUR_ABANDON_MS` | `30000` | Odak başka yerdeyken, etkileşimli bir formun terk edilmiş sayılması için gereken süre (ms). |
| `CORRECTION_MIN_DELETES` | `8` | Tek bir alan etkileşiminde gereken en az silme sayısı. |
| `CORRECTION_RATIO` | `0.5` | Silme sayısının, ekleme sayısına bu oranla çarpılmış değerden küçük olmaması gerekir. |
| `MAX_EVENTS_PER_PAGEVIEW` | `200` | Sayfa görüntüleme başına kesin üst sınır. Sınıra ulaşılınca tracker susar. |
| `BATCH_MAX_EVENTS` | `50` | Bu kadar olay biriktiğinde bir batch gönderilir. |
| `BATCH_INTERVAL_MS` | `5000` | Periyodik gönderim aralığı (ms). |
| `SELECTOR_MAX_LEN` | `120` | Gönderilen CSS seçicisinin uzunluğu için kesin üst sınır. |

### Katkı

Kurulum ve kontroller:

```bash
npm test                       # birim testleri (Node yerleşik test çalıştırıcısı)
npm run build:tracker          # tracker/dist/radar.min.js dosyasını yeniden derler ve 5120 bayt bütçesini denetler
npm run test:e2e               # Playwright uçtan uca testleri (Chromium)
npm run seed -- --sessions 40 --seed 42 --url http://127.0.0.1:8639 --verify
```

Tohumlayıcı sentetik oturumları gerçek `/api/collect` uç noktası üzerinden gönderir; bu
yüzden sunucunun önce çalışıyor olması gerekir. Sabit bir `--seed` çıktıyı deterministik
yapar, `--verify` ise verinin demo için hazır olduğunu okuma uç noktalarından denetler.

Katkılar memnuniyetle karşılanır: hata düzeltmeleri, dokümantasyon, testler ve iyi
gerekçelendirilmiş özellikler. Geliştirme ortamı, proje düzeni ve projeyi dürüst tutan
kurallar (tracker bütçesi, sunucuda sıfır çalışma zamanı bağımlılığı ve gizlilik
değişmezleri) için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını okuyun. Lütfen
[Davranış Kuralları](CODE_OF_CONDUCT.md) belgesine de uyun.

Bir güvenlik açığı bulduysanız herkese açık bir issue yerine GitHub'ın özel güvenlik açığı
bildirimini kullanın. Ayrıntılar için [SECURITY.md](SECURITY.md) dosyasına bakın.

### Lisans

MIT. © 2026 𝓐.𝓒.𝓑. Bkz. [LICENSE](LICENSE).

[⬆ Başa Dön](#top)
