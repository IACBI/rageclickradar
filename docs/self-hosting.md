# Self-hosting RageClickRadar

**English** · [Türkçe](#türkçe) · [中文](#中文) · [Русский](#русский) · [العربية](#العربية) · [日本語](#日本語)

RageClickRadar is one Node process with **zero runtime dependencies** and a
single SQLite file. Storage is `node:sqlite`, so there is nothing to install
beyond a recent Node. This guide covers the Node version matrix, running it as a
service, putting it behind HTTPS, backups, retention, and multi-site setups.

## Node version matrix

The server stores data through Node's built-in `node:sqlite` module. Its
availability depends on the Node version:

| Node version | `node:sqlite` | How to start |
| --- | --- | --- |
| < 22.5 | Not available | Not supported — upgrade Node. |
| 22.5 – 23.3 | Behind a flag | `node --experimental-sqlite server/index.js` |
| 23.4 – 24.x | Available unflagged | `node server/index.js` (i.e. `npm start`) |
| **24 LTS** | Available unflagged | **Recommended.** `npm start` |

> The npm scripts (`npm start`, `npm run demo`, `npm run seed`) do **not** pass
> `--experimental-sqlite`. On Node 22.5–23.3 you must invoke the server directly
> with the flag, e.g. `node --experimental-sqlite server/index.js`. On Node 23.4
> and newer (including 24 LTS) `npm start` works as-is. If `node:sqlite` is
> missing at startup the server prints the exact flag/version it needs and exits.

## Running it

The server reads these environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8639` | HTTP listen port. |
| `DB_PATH` | `./data/radar.db` | SQLite file path (parent directory is created automatically). |
| `HOST` | `127.0.0.1` | Interface to bind. Loopback only by default. Set `0.0.0.0` to expose the process; the read API has no authentication, so do that only behind a firewall or proxy. |
| `TRUST_PROXY` | *(empty)* | Comma-separated exact IPs of reverse proxies you run. Their `X-Forwarded-For` is trusted for rate limiting. Empty trusts none. |
| `RETENTION_DAYS` | *(off)* | Delete events and sessions older than this many days, at startup and hourly. Empty or `0` keeps everything. |
| `PATH_REDACTION` | `on` | `off` stores page paths verbatim. Otherwise identifier-like segments (numbers, UUIDs, tokens) are stored as `:id`. See [privacy.md](privacy.md). |

Run on a different port and database path:

```bash
PORT=9000 DB_PATH=/var/lib/rageclickradar/radar.db npm start
```

On Windows PowerShell, set the variables first:

```powershell
$env:PORT='9000'; $env:DB_PATH='C:\rageclickradar\radar.db'; npm start
```

The database is opened in WAL mode, so you will see `radar.db`, `radar.db-wal`,
and `radar.db-shm` files next to each other in normal operation.

### systemd unit

Create `/etc/systemd/system/rageclickradar.service`:

```ini
[Unit]
Description=RageClickRadar
After=network.target

[Service]
Type=simple
User=rageradar
WorkingDirectory=/opt/rageclickradar
# Bind to localhost; a reverse proxy terminates TLS and forwards to it.
Environment=HOST=127.0.0.1
Environment=PORT=8639
Environment=DB_PATH=/var/lib/rageclickradar/radar.db
# The proxy runs on this host, so its address is the one to trust for X-Forwarded-For.
Environment=TRUST_PROXY=127.0.0.1
# Node 24 LTS: no flag needed. On Node 22.5-23.3 use:
#   ExecStart=/usr/bin/node --experimental-sqlite server/index.js
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
# The process ignores SIGINT/SIGTERM cleanly (closes the DB, then exits).
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rageclickradar
```

## Reverse proxy (HTTPS)

Run the Node process bound to localhost and let a proxy terminate TLS. You must
serve **both** the dashboard/static assets *and* `/api/collect` through the same
host so the snippet's default same-origin endpoint works.

### Caddy

Caddy gets you HTTPS in two lines (automatic certificates):

```caddy
analytics.example.com {
    # Caddy sets X-Forwarded-For to the client address by default.
    reverse_proxy 127.0.0.1:8639
}
```

### nginx

```nginx
server {
    listen 443 ssl;
    server_name analytics.example.com;

    ssl_certificate     /etc/letsencrypt/live/analytics.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analytics.example.com/privkey.pem;

    # One block covers everything: /, /radar.js, /api/collect, /api/pages, ...
    location / {
        proxy_pass http://127.0.0.1:8639;
        proxy_set_header Host $host;
        # Appends the client address. With TRUST_PROXY set to this proxy, the collector reads it.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> **Warning: with `TRUST_PROXY`, the proxy must append to `X-Forwarded-For`, never pass the client's value through.** With `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, nginx adds the address it saw to whatever the client sent, and the collector reads the rightmost untrusted entry. Do not use `$http_x_forwarded_for` for this header: it forwards the client's own value unchanged, so clients can choose their bucket. Caddy's `reverse_proxy` sets `X-Forwarded-For` from the client address and ignores `X-Forwarded-*` headers sent by clients unless `trusted_proxies` is configured. Keep that default and do not copy the incoming header.

The collector never stores the client IP, but the in-memory rate limiter needs a key per client. By default it keys on the socket's remote address and ignores `X-Forwarded-For`, so a client cannot spoof its way into a fresh bucket. Behind a reverse proxy that address is the proxy itself, so **all** clients share one bucket per budget. To fix that, set `TRUST_PROXY` to the proxy's exact IP address (or a comma-separated list of proxies you run). When the immediate peer is one of them, the limiter reads `X-Forwarded-For` and walks it right to left, skipping trusted proxies, so the first address that is not a trusted proxy is the client. A client cannot pick its own bucket by prepending addresses, and a header from any other peer is ignored. Keep `TRUST_PROXY` empty when clients connect to the process directly.

## CORS note

`/api/collect` responds with `Access-Control-Allow-Origin: *` **by design** — it
must accept beacons from any page you instrument, including cross-origin sites
that set `data-endpoint`. This is safe because the endpoint is *validate-only and
write-only*: it accepts a strictly whitelisted anonymous payload, returns `204`
with no readable body, and is rate limited per IP (60 requests/minute by
default, in-memory). None of the read/aggregation endpoints (`/api/pages`,
`/api/heatmap`, ...) send CORS headers, so browsers on other origins cannot read
your data. Keep the dashboard itself private (proxy auth, VPN, or an allow-list)
since the MVP has no built-in authentication.

## API limits

Two independent per-IP rate limits protect the process, both in-memory. The key is the client address: the socket address, or the forwarded client address when `TRUST_PROXY` names the peer (see the reverse proxy section above):

| Endpoint(s) | Limit | Where |
| --- | --- | --- |
| `/api/collect` (write) | 60 req/min | `RATE_LIMIT_PER_MIN` (`shared/config.js`) |
| `/api/pages`, `/api/heatmap`, `/api/hotspots`, `/api/sessions`, `/api/session` (read) | 300 req/min | `READ_RATE_LIMIT_PER_MIN` (`server/http.js`) |

The read endpoints also cap result size to bound response size and query cost on
busy pages (constants in `server/queries.js`). Rows are ordered *before* the cap,
so each response keeps the top-N under its ordering:

| Endpoint | Cap | Ordering kept |
| --- | --- | --- |
| `/api/pages` | 200 pages | Highest confusion score first. |
| `/api/hotspots` | 200 selectors per page | Highest confusion score first; equal scores by selector name. |
| `/api/heatmap` | 20,000 points | Oldest events first (by insert id). |
| `/api/session` | 5,000 events | Earliest events first (by `ts`). |

`/api/hotspots` also returns `totals`: per-type signal counts for the whole page. It is not limited by the cap and includes NULL and empty selectors. Use it for page-wide figures, because summing `hotspots[].counts` undercounts once the cap applies.

## Backups

The database is a single SQLite file. Because WAL mode keeps recent writes in the
`-wal` sidecar, do **not** just copy `radar.db` alone while the server is running
— you may miss committed data. Use one of:

- **Stop, copy, start.** Stop the service, copy `radar.db` (and, to be safe, the
  `-wal` / `-shm` files), start it again. Simplest and always correct.
- **Checkpoint first.** Force a WAL checkpoint so everything is folded into the
  main file, then copy `radar.db`:
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db "PRAGMA wal_checkpoint(TRUNCATE);"
  cp /var/lib/rageclickradar/radar.db /backups/radar-$(date +%F).db
  ```
- **Online backup (no downtime).** SQLite's backup API is consistent even while
  the server writes:
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db ".backup '/backups/radar-$(date +%F).db'"
  ```

## Data retention

Retention is off by default: rows stay until you delete them. To bound the database,
set `RETENTION_DAYS` to the number of days to keep. 90 is a sensible starting point:

```bash
RETENTION_DAYS=90 npm start
```

The server runs the sweep once at startup and then every hour. It deletes:

- events whose `received_at` (arrival time) is older than the cutoff, and
- sessions whose `last_seen` is older than the cutoff.

Both deletes run in one transaction, and an index on `events.received_at` keeps the
sweep from scanning the whole table. Events are judged one by one, so a session that
is still active keeps its row and loses only its older events. The sweep writes to
stdout only when it removes something.

`RETENTION_DAYS` must be a whole number of days. Any other value (for example `90d`)
stops the server at startup with a one-line error.

SQLite does not shrink the file when rows are deleted; freed pages are reused for new
data. To return the space to the operating system, run `VACUUM` while the server is
stopped:

```bash
sqlite3 /var/lib/rageclickradar/radar.db "VACUUM;"
```

To wipe everything, stop the server and delete `radar.db` along with its `-wal` and
`-shm` siblings.

## Multiple sites

The events table keys pages by **path only** (`location.pathname`; query and hash
are stripped). It stores no host. That has one consequence for multi-site setups:

- **One collector per site (recommended for the MVP).** Run a separate process
  with its own `DB_PATH` per site. Clean separation, no path collisions.
- **One shared collector for several sites.** Works, and cross-origin sites can
  post via `data-endpoint`. The caveat: two sites that share a path (both have a
  `/pricing`, say) will have their signals merged under that one path, because
  the store cannot tell them apart. Only share a collector across sites whose
  paths don't overlap, or accept the merge.

---

## Türkçe

[English](#self-hosting-rageclickradar) · **Türkçe** · [中文](#中文) · [Русский](#русский) · [العربية](#العربية) · [日本語](#日本語)

RageClickRadar, **çalışma zamanında hiçbir bağımlılığı olmayan** tek bir Node
sürecidir ve tek bir SQLite dosyası kullanır. Depolama katmanı `node:sqlite`
olduğundan, güncel bir Node dışında kurulacak hiçbir şey yoktur. Bu kılavuz Node
sürüm matrisini, uygulamayı bir servis olarak çalıştırmayı, HTTPS arkasına
almayı, yedeklemeyi, veri saklamayı ve çok siteli kurulumları kapsar.

### Node sürüm matrisi

Sunucu verileri Node'un yerleşik `node:sqlite` modülü aracılığıyla saklar. Bu
modülün kullanılabilirliği Node sürümüne bağlıdır:

| Node sürümü | `node:sqlite` | Nasıl başlatılır |
| --- | --- | --- |
| < 22.5 | Kullanılamaz | Desteklenmiyor — Node'u yükseltin. |
| 22.5 – 23.3 | Bir bayrak ardında | `node --experimental-sqlite server/index.js` |
| 23.4 – 24.x | Bayraksız kullanılabilir | `node server/index.js` (yani `npm start`) |
| **24 LTS** | Bayraksız kullanılabilir | **Önerilir.** `npm start` |

> npm betikleri (`npm start`, `npm run demo`, `npm run seed`)
> `--experimental-sqlite` bayrağını **geçmez**. Node 22.5–23.3 üzerinde sunucuyu
> doğrudan bu bayrakla çağırmalısınız; örn. `node --experimental-sqlite
> server/index.js`. Node 23.4 ve üzerinde (24 LTS dâhil) `npm start` olduğu gibi
> çalışır. Başlangıçta `node:sqlite` bulunamazsa sunucu ihtiyaç duyduğu tam
> bayrağı/sürümü yazdırıp çıkar.

### Çalıştırma

Sunucu şu ortam değişkenlerini okur:

| Değişken | Varsayılan | Anlamı |
| --- | --- | --- |
| `PORT` | `8639` | HTTP dinleme portu. |
| `DB_PATH` | `./data/radar.db` | SQLite dosya yolu (üst dizin otomatik oluşturulur). |
| `HOST` | `127.0.0.1` | Bağlanılacak arayüz. Varsayılan yalnızca loopback'tir. Süreci dışarı açmak için `0.0.0.0` ayarlayın; okuma API'sinin kimlik doğrulaması yoktur, bu yüzden bunu yalnızca bir güvenlik duvarı veya proxy arkasında yapın. |
| `TRUST_PROXY` | *(boş)* | Çalıştırdığınız ters proxy'lerin virgülle ayrılmış tam IP'leri. Bunların `X-Forwarded-For` başlığı hız sınırlaması için güvenilir kabul edilir. Boşsa hiçbir proxy güvenilmez. |
| `RETENTION_DAYS` | *(kapalı)* | Bu gün sayısından eski olayları ve oturumları başlangıçta ve saatte bir siler. Boş veya `0` her şeyi saklar. |
| `PATH_REDACTION` | `on` | `off` yolları olduğu gibi saklar; aksi halde tanımlayıcı benzeri parçalar (sayılar, UUID'ler, belirteçler) `:id` olarak saklanır. Bkz. [privacy.md](privacy.md). |

Farklı bir port ve veritabanı yolunda çalıştırma:

```bash
PORT=9000 DB_PATH=/var/lib/rageclickradar/radar.db npm start
```

Windows PowerShell'de değişkenleri önce ayarlayın:

```powershell
$env:PORT='9000'; $env:DB_PATH='C:\rageclickradar\radar.db'; npm start
```

Veritabanı WAL modunda açılır; bu nedenle normal çalışmada `radar.db`,
`radar.db-wal` ve `radar.db-shm` dosyalarını yan yana görürsünüz.

#### systemd birimi

`/etc/systemd/system/rageclickradar.service` dosyasını oluşturun:

```ini
[Unit]
Description=RageClickRadar
After=network.target

[Service]
Type=simple
User=rageradar
WorkingDirectory=/opt/rageclickradar
# Bind to localhost; a reverse proxy terminates TLS and forwards to it.
Environment=HOST=127.0.0.1
Environment=PORT=8639
Environment=DB_PATH=/var/lib/rageclickradar/radar.db
# The proxy runs on this host, so its address is the one to trust for X-Forwarded-For.
Environment=TRUST_PROXY=127.0.0.1
# Node 24 LTS: no flag needed. On Node 22.5-23.3 use:
#   ExecStart=/usr/bin/node --experimental-sqlite server/index.js
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
# The process ignores SIGINT/SIGTERM cleanly (closes the DB, then exits).
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

Ardından:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rageclickradar
```

### Ters proxy (HTTPS)

Node sürecini localhost'a bağlı olarak çalıştırın ve TLS'i bir proxy'nin
sonlandırmasına izin verin. Snippet'in varsayılan aynı köken (same-origin)
uç noktasının çalışması için **hem** panoyu/statik varlıkları **hem de**
`/api/collect` uç noktasını aynı ana bilgisayar üzerinden sunmalısınız.

#### Caddy

Caddy iki satırda HTTPS sağlar (otomatik sertifikalar):

```caddy
analytics.example.com {
    # Caddy sets X-Forwarded-For to the client address by default.
    reverse_proxy 127.0.0.1:8639
}
```

#### nginx

```nginx
server {
    listen 443 ssl;
    server_name analytics.example.com;

    ssl_certificate     /etc/letsencrypt/live/analytics.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analytics.example.com/privkey.pem;

    # One block covers everything: /, /radar.js, /api/collect, /api/pages, ...
    location / {
        proxy_pass http://127.0.0.1:8639;
        proxy_set_header Host $host;
        # Appends the client address. With TRUST_PROXY set to this proxy, the collector reads it.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> **Uyarı: `TRUST_PROXY` kullanırken proxy `X-Forwarded-For` başlığına ekleme yapmalıdır; istemcinin gönderdiği değeri asla olduğu gibi iletmemelidir.** `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` ile nginx, gördüğü adresi istemcinin gönderdiği değerin sonuna ekler ve toplayıcı en sağdaki güvenilmeyen girdiyi okur. Bu başlık için `$http_x_forwarded_for` kullanmayın: istemcinin kendi değerini değiştirmeden iletir, böylece istemciler kendi kovasını seçebilir. Caddy'nin `reverse_proxy` özelliği `X-Forwarded-For` değerini istemci adresinden ayarlar ve `trusted_proxies` yapılandırılmadıkça istemcilerin gönderdiği `X-Forwarded-*` başlıklarını yok sayar. Bu varsayılanı koruyun ve gelen başlığı kopyalamayın.

Toplayıcı istemci IP'sini asla saklamaz, ancak bellek içi hız sınırlayıcının her istemci için bir anahtara ihtiyacı vardır. Varsayılan olarak bu anahtar soketin uzak adresidir ve `X-Forwarded-For` başlığı yok sayılır; böylece bir istemci sahte başlıkla yeni bir kovaya geçemez. Ters proxy arkasında bu adres proxy'nin kendisidir, dolayısıyla **tüm** istemciler bütçe başına tek bir kovayı paylaşır. Bunu önlemek için `TRUST_PROXY` değerini proxy'nin tam IP adresine (ya da çalıştırdığınız proxy'lerin virgülle ayrılmış listesine) ayarlayın. Doğrudan bağlanan eş bu listedeyse sınırlayıcı `X-Forwarded-For` başlığını okur ve sağdan sola tarar; güvenilen proxy'leri atlayarak ilk güvenilmeyen adresi istemci sayar. İstemci, başına adres ekleyerek kendi kovasını seçemez; başka bir eşten gelen başlık yok sayılır. İstemciler doğrudan işleme bağlanıyorsa `TRUST_PROXY` boş bırakılmalıdır.

### CORS notu

`/api/collect`, `Access-Control-Allow-Origin: *` ile yanıt verir — bu
**tasarım gereğidir**: `data-endpoint` ayarlayan çapraz köken siteler dâhil,
enstrümante ettiğiniz her sayfadan gelen işaretçileri (beacon) kabul etmelidir.
Bu güvenlidir çünkü uç nokta *yalnızca doğrulayan ve yalnızca yazan* bir uç
noktadır: kesin biçimde beyaz listelenmiş anonim bir veri yükünü kabul eder,
okunabilir bir gövde olmadan `204` döndürür ve IP başına hız sınırlıdır
(varsayılan olarak dakikada 60 istek, bellek içi). Okuma/toplama uç noktalarının
hiçbiri (`/api/pages`, `/api/heatmap`, ...) CORS başlıkları göndermez; dolayısıyla
diğer kökenlerdeki tarayıcılar verilerinizi okuyamaz. MVP'nin yerleşik kimlik
doğrulaması olmadığından panonun kendisini özel tutun (proxy kimlik doğrulaması,
VPN veya bir izin listesi).

### API sınırları

Süreci koruyan, ikisi de bellek içi olan iki bağımsız IP başına hız sınırı vardır. Anahtar istemci adresidir: soket adresi veya `TRUST_PROXY` doğrudan eşi adlandırdığında iletilen istemci adresi (yukarıdaki ters proxy bölümüne bakın):

| Uç nokta(lar) | Sınır | Nerede |
| --- | --- | --- |
| `/api/collect` (yazma) | 60 istek/dk | `RATE_LIMIT_PER_MIN` (`shared/config.js`) |
| `/api/pages`, `/api/heatmap`, `/api/hotspots`, `/api/sessions`, `/api/session` (okuma) | 300 istek/dk | `READ_RATE_LIMIT_PER_MIN` (`server/http.js`) |

Okuma uç noktaları ayrıca, yoğun sayfalarda yanıt boyutunu ve sorgu maliyetini
sınırlamak için sonuç boyutunu da sınırlar (sabitler `server/queries.js`
içindedir). Satırlar sınırdan *önce* sıralanır; böylece her yanıt kendi
sıralamasına göre ilk N kaydı korur:

| Uç nokta | Sınır | Korunan sıralama |
| --- | --- | --- |
| `/api/pages` | 200 sayfa | En yüksek karışıklık (confusion) puanı önce. |
| `/api/hotspots` | Sayfa başına 200 seçici | En yüksek karışıklık puanı önce; eşit puanda seçici adına göre. |
| `/api/heatmap` | 20.000 nokta | En eski olaylar önce (ekleme id'sine göre). |
| `/api/session` | 5.000 olay | En erken olaylar önce (`ts` alanına göre). |

`/api/hotspots` ayrıca `totals` döndürür: sayfanın tamamı için tür başına sinyal sayıları. Sınırdan etkilenmez ve NULL ile boş seçicileri de kapsar. Sayfa geneli rakamlar için bunu kullanın; sınır uygulandığında `hotspots[].counts` değerlerini toplamak eksik sayar.

### Yedeklemeler

Veritabanı tek bir SQLite dosyasıdır. WAL modu son yazmaları `-wal` yan
dosyasında tuttuğu için, sunucu çalışırken yalnızca `radar.db` dosyasını
kopyalamayın — kaydedilmiş veriyi kaçırabilirsiniz. Şunlardan birini kullanın:

- **Durdur, kopyala, başlat.** Servisi durdurun, `radar.db` dosyasını (ve emin
  olmak için `-wal` / `-shm` dosyalarını) kopyalayın, ardından yeniden başlatın.
  En basit ve her zaman doğru olan yöntem.
- **Önce checkpoint.** Her şeyin ana dosyaya katlanması için bir WAL checkpoint
  işlemini zorlayın, sonra `radar.db` dosyasını kopyalayın:
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db "PRAGMA wal_checkpoint(TRUNCATE);"
  cp /var/lib/rageclickradar/radar.db /backups/radar-$(date +%F).db
  ```
- **Çevrimiçi yedekleme (kesintisiz).** SQLite'ın yedekleme API'si, sunucu yazma
  yaparken bile tutarlıdır:
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db ".backup '/backups/radar-$(date +%F).db'"
  ```

### Veri saklama

Saklama varsayılan olarak kapalıdır: satırlar siz silene kadar kalır. Veritabanını
sınırlamak için `RETENTION_DAYS` değerini tutulacak gün sayısına ayarlayın. 90 makul
bir başlangıç noktasıdır:

```bash
RETENTION_DAYS=90 npm start
```

Sunucu temizliği başlangıçta bir kez, sonrasında her saat çalıştırır. Şunları siler:

- `received_at` (geliş zamanı) eşik değerinden eski olan olaylar ve
- `last_seen` eşik değerinden eski olan oturumlar.

İki silme işlemi tek bir transaction içinde çalışır; `events.received_at` üzerindeki
dizin, temizliğin tüm tabloyu taramasını önler. Olaylar tek tek değerlendirilir; bu
yüzden hâlâ aktif olan bir oturum satırını korur ve yalnızca daha eski olaylarını
kaybeder. Temizlik yalnızca bir şey sildiğinde stdout'a yazar.

`RETENTION_DAYS` tam gün sayısı olmalıdır. Başka bir değer (ör. `90d`) sunucuyu
başlangıçta tek satırlık bir hatayla durdurur.

SQLite, satırlar silindiğinde dosyayı küçültmez; boşalan sayfalar yeni veriler için
yeniden kullanılır. Alanı işletim sistemine geri vermek için sunucu durdurulmuşken
`VACUUM` çalıştırın:

```bash
sqlite3 /var/lib/rageclickradar/radar.db "VACUUM;"
```

Her şeyi silmek için sunucuyu durdurun ve `radar.db` ile birlikte `-wal` ve `-shm`
eşlerini silin.

### Birden çok site

Olaylar (events) tablosu sayfaları **yalnızca yola göre** anahtarlar
(`location.pathname`; sorgu ve hash bölümü çıkarılır). Ana bilgisayarı saklamaz.
Bunun çok siteli kurulumlar için tek bir sonucu vardır:

- **Site başına bir toplayıcı (MVP için önerilir).** Her site için kendi
  `DB_PATH` değerine sahip ayrı bir süreç çalıştırın. Temiz bir ayrım, yol
  çakışması olmaz.
- **Birden çok site için tek bir paylaşılan toplayıcı.** Çalışır ve çapraz
  köken siteler `data-endpoint` aracılığıyla gönderim yapabilir. Uyarı: aynı
  yolu paylaşan iki site (örneğin ikisinin de bir `/pricing` sayfası varsa)
  sinyallerini o tek yol altında birleştirir; çünkü depo onları birbirinden
  ayırt edemez. Bir toplayıcıyı yalnızca yolları çakışmayan siteler arasında
  paylaşın veya birleştirmeyi kabul edin.

---

## 中文

[English](#self-hosting-rageclickradar) · [Türkçe](#türkçe) · **中文** · [Русский](#русский) · [العربية](#العربية) · [日本語](#日本語)

RageClickRadar 是一个**无运行时依赖**的单一 Node 进程，只使用一个 SQLite 文件。
存储层为 `node:sqlite`，因此除了较新版本的 Node 之外无需安装任何东西。本指南
涵盖 Node 版本矩阵、将其作为服务运行、置于 HTTPS 之后、备份、数据保留以及多站点
部署。

### Node 版本矩阵

服务器通过 Node 内置的 `node:sqlite` 模块存储数据。该模块的可用性取决于 Node
版本：

| Node 版本 | `node:sqlite` | 如何启动 |
| --- | --- | --- |
| < 22.5 | 不可用 | 不支持 —— 请升级 Node。 |
| 22.5 – 23.3 | 需要标志 | `node --experimental-sqlite server/index.js` |
| 23.4 – 24.x | 无需标志即可用 | `node server/index.js`（即 `npm start`） |
| **24 LTS** | 无需标志即可用 | **推荐。** `npm start` |

> npm 脚本（`npm start`、`npm run demo`、`npm run seed`）**不会**传递
> `--experimental-sqlite`。在 Node 22.5–23.3 上，你必须直接使用该标志调用
> 服务器，例如 `node --experimental-sqlite server/index.js`。在 Node 23.4
> 及更高版本（包括 24 LTS）上，`npm start` 可直接使用。如果启动时找不到
> `node:sqlite`，服务器会打印出它所需的确切标志/版本并退出。

### 运行

服务器读取以下环境变量：

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `PORT` | `8639` | HTTP 监听端口。 |
| `DB_PATH` | `./data/radar.db` | SQLite 文件路径（父目录会自动创建）。 |
| `HOST` | `127.0.0.1` | 绑定的网络接口。默认仅回环地址。设为 `0.0.0.0` 即对外暴露进程；读取 API 没有身份验证，因此只应在防火墙或代理之后这样做。 |
| `TRUST_PROXY` | *（空）* | 你运行的反向代理的精确 IP，以逗号分隔。它们的 `X-Forwarded-For` 会被用于速率限制。为空则不信任任何代理。 |
| `RETENTION_DAYS` | *（关闭）* | 启动时及每小时删除早于该天数的事件和会话。留空或为 `0` 则全部保留。 |
| `PATH_REDACTION` | `on` | `off` 原样存储页面路径；否则类似标识符的路径段（数字、UUID、令牌）存储为 `:id`。参见 [privacy.md](privacy.md)。 |

在不同的端口和数据库路径上运行：

```bash
PORT=9000 DB_PATH=/var/lib/rageclickradar/radar.db npm start
```

在 Windows PowerShell 上，先设置这些变量：

```powershell
$env:PORT='9000'; $env:DB_PATH='C:\rageclickradar\radar.db'; npm start
```

数据库以 WAL 模式打开，因此在正常运行时你会看到 `radar.db`、`radar.db-wal`
和 `radar.db-shm` 这几个文件并排存在。

#### systemd 单元

创建 `/etc/systemd/system/rageclickradar.service`：

```ini
[Unit]
Description=RageClickRadar
After=network.target

[Service]
Type=simple
User=rageradar
WorkingDirectory=/opt/rageclickradar
# Bind to localhost; a reverse proxy terminates TLS and forwards to it.
Environment=HOST=127.0.0.1
Environment=PORT=8639
Environment=DB_PATH=/var/lib/rageclickradar/radar.db
# The proxy runs on this host, so its address is the one to trust for X-Forwarded-For.
Environment=TRUST_PROXY=127.0.0.1
# Node 24 LTS: no flag needed. On Node 22.5-23.3 use:
#   ExecStart=/usr/bin/node --experimental-sqlite server/index.js
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
# The process ignores SIGINT/SIGTERM cleanly (closes the DB, then exits).
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

然后：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rageclickradar
```

### 反向代理（HTTPS）

让 Node 进程绑定到 localhost 运行，并由代理终止 TLS。你必须通过**同一个**主机
同时提供仪表盘/静态资源**和** `/api/collect`，这样代码片段默认的同源
（same-origin）端点才能正常工作。

#### Caddy

Caddy 只需两行即可为你启用 HTTPS（自动签发证书）：

```caddy
analytics.example.com {
    # Caddy sets X-Forwarded-For to the client address by default.
    reverse_proxy 127.0.0.1:8639
}
```

#### nginx

```nginx
server {
    listen 443 ssl;
    server_name analytics.example.com;

    ssl_certificate     /etc/letsencrypt/live/analytics.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analytics.example.com/privkey.pem;

    # One block covers everything: /, /radar.js, /api/collect, /api/pages, ...
    location / {
        proxy_pass http://127.0.0.1:8639;
        proxy_set_header Host $host;
        # Appends the client address. With TRUST_PROXY set to this proxy, the collector reads it.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> **警告：使用 `TRUST_PROXY` 时，代理必须追加到 `X-Forwarded-For`，而不能原样转发客户端发送的值。** 使用 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` 时，nginx 会把它看到的地址追加到客户端发送的值之后，收集器读取最右侧不受信任的条目。不要为此头使用 `$http_x_forwarded_for`：它会原样转发客户端自己的值，客户端就能选择自己的速率限制桶。Caddy 的 `reverse_proxy` 会根据客户端地址设置 `X-Forwarded-For`，并且除非配置了 `trusted_proxies`，否则会忽略客户端发送的 `X-Forwarded-*` 头。请保留该默认行为，不要复制传入的头。

采集器从不存储客户端 IP，但内存中的速率限制器需要为每个客户端提供一个键。默认情况下，它以套接字的远程地址为键，并忽略 `X-Forwarded-For`，以防客户端通过伪造该头进入一个全新的桶。在反向代理之后，该地址就是代理本身，因此**所有**客户端会共享每个配额的同一个桶。要解决这个问题，请将 `TRUST_PROXY` 设置为代理的精确 IP 地址（或你运行的代理的逗号分隔列表）。当直接相连的对端属于该列表时，速率限制器会读取 `X-Forwarded-For` 并从右向左遍历，跳过受信任的代理，第一个非受信任代理的地址即为客户端。客户端无法通过在头中前置地址来选择自己的桶，来自其他对端的头会被忽略。若客户端直接连接进程，请保持 `TRUST_PROXY` 为空。

### CORS 说明

`/api/collect` 以 `Access-Control-Allow-Origin: *` 响应 —— 这是**有意设计的**：
它必须接受来自你所埋点的任何页面的信标（beacon），包括设置了 `data-endpoint`
的跨域站点。这是安全的，因为该端点是*仅校验且仅写入*的：它只接受严格白名单化的
匿名负载，返回 `204` 且不含可读正文，并按 IP 进行速率限制（默认每分钟 60 个
请求，内存中）。所有读取/聚合端点（`/api/pages`、`/api/heatmap` ……）都不发送
CORS 头，因此其他源上的浏览器无法读取你的数据。由于 MVP 没有内置身份验证，请将
仪表盘本身保持私有（代理认证、VPN 或允许列表）。

### API 限制

有两个独立的按 IP 速率限制在保护该进程，二者都在内存中。其键为客户端地址：套接字地址，或当 `TRUST_PROXY` 指定了对端时的转发客户端地址（参见上文的反向代理一节）：

| 端点 | 限制 | 位置 |
| --- | --- | --- |
| `/api/collect`（写入） | 60 请求/分钟 | `RATE_LIMIT_PER_MIN`（`shared/config.js`） |
| `/api/pages`、`/api/heatmap`、`/api/hotspots`、`/api/sessions`、`/api/session`（读取） | 300 请求/分钟 | `READ_RATE_LIMIT_PER_MIN`（`server/http.js`） |

读取端点还会限制结果大小，以约束繁忙页面上的响应体积和查询成本（常量位于
`server/queries.js`）。行会在截断*之前*排序，因此每个响应都会按其排序保留前
N 条：

| 端点 | 上限 | 保留的排序 |
| --- | --- | --- |
| `/api/pages` | 200 个页面 | 困惑度（confusion）得分最高的在前。 |
| `/api/hotspots` | 每页 200 个选择器 | 困惑度得分最高的在前；得分相同则按选择器名称排序。 |
| `/api/heatmap` | 20,000 个点 | 最早的事件在前（按插入 id）。 |
| `/api/session` | 5,000 个事件 | 最早的事件在前（按 `ts`）。 |

`/api/hotspots` 还会返回 `totals`：整个页面按类型统计的信号数。它不受上限限制，并包含 NULL 和空的选择器。需要页面整体数字时请使用它；一旦应用上限，对 `hotspots[].counts` 求和会偏低。

### 备份

数据库是单个 SQLite 文件。由于 WAL 模式会将最近的写入保存在 `-wal` 附属文件中，
因此在服务器运行时**不要**只单独复制 `radar.db` —— 你可能会遗漏已提交的数据。
请使用以下方法之一：

- **停止、复制、启动。** 停止服务，复制 `radar.db`（为保险起见也复制 `-wal` /
  `-shm` 文件），然后重新启动。最简单且始终正确。
- **先做检查点。** 强制执行一次 WAL 检查点，将所有内容折叠回主文件，然后复制
  `radar.db`：
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db "PRAGMA wal_checkpoint(TRUNCATE);"
  cp /var/lib/rageclickradar/radar.db /backups/radar-$(date +%F).db
  ```
- **在线备份（无停机）。** 即使服务器正在写入，SQLite 的备份 API 也能保持
  一致：
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db ".backup '/backups/radar-$(date +%F).db'"
  ```

### 数据保留

默认关闭：数据会一直保留，直到您删除它。若要限制数据库大小，请将 `RETENTION_DAYS`
设为要保留的天数。90 是合理的起点：

```bash
RETENTION_DAYS=90 npm start
```

服务器会在启动时执行一次清理，此后每小时执行一次，删除：

- `received_at`（到达时间）早于截止时间的事件；
- `last_seen` 早于截止时间的会话。

两次删除在同一事务中执行，`events.received_at` 上的索引避免清理扫描整张表。事件逐条
判断，因此仍在活跃的会话会保留其行，只丢失较早的事件。仅当确实删除了内容时，清理才会
在 stdout 输出日志。

`RETENTION_DAYS` 必须是整数天数。其他值（例如 `90d`）会使服务器在启动时以一行错误信息
退出。

删除行后 SQLite 不会缩小文件；空出的页面会被新数据复用。若要把空间归还操作系统，请在
服务器停止时运行 `VACUUM`：

```bash
sqlite3 /var/lib/rageclickradar/radar.db "VACUUM;"
```

若要清空全部数据，请停止服务器，并删除 `radar.db` 及其 `-wal`、`-shm` 文件。

### 多个站点

事件（events）表**仅按路径**为页面建立键（`location.pathname`；查询串和 hash
会被剥离）。它不存储主机名。这对多站点部署有一个影响：

- **每个站点一个采集器（MVP 推荐）。** 为每个站点运行一个拥有各自 `DB_PATH`
  的独立进程。干净地隔离，不会发生路径冲突。
- **多个站点共用一个采集器。** 可行，且跨域站点可以通过 `data-endpoint` 发送
  数据。注意事项：共享同一路径的两个站点（比如两者都有 `/pricing`）会把它们的
  信号合并到那一条路径下，因为存储无法区分它们。仅在路径互不重叠的站点之间共用
  采集器，或者接受这种合并。

---

## Русский

[English](#self-hosting-rageclickradar) · [Türkçe](#türkçe) · [中文](#中文) · **Русский** · [العربية](#العربية) · [日本語](#日本語)

RageClickRadar — это один процесс Node **без зависимостей во время выполнения** и
единственный файл SQLite. Уровень хранения — `node:sqlite`, поэтому кроме
свежего Node устанавливать ничего не нужно. Это руководство охватывает матрицу
версий Node, запуск в качестве службы, размещение за HTTPS, резервное
копирование, хранение данных и конфигурации с несколькими сайтами.

### Матрица версий Node

Сервер хранит данные через встроенный модуль Node `node:sqlite`. Его доступность
зависит от версии Node:

| Версия Node | `node:sqlite` | Как запускать |
| --- | --- | --- |
| < 22.5 | Недоступен | Не поддерживается — обновите Node. |
| 22.5 – 23.3 | За флагом | `node --experimental-sqlite server/index.js` |
| 23.4 – 24.x | Доступен без флага | `node server/index.js` (то есть `npm start`) |
| **24 LTS** | Доступен без флага | **Рекомендуется.** `npm start` |

> Скрипты npm (`npm start`, `npm run demo`, `npm run seed`) **не** передают
> `--experimental-sqlite`. На Node 22.5–23.3 вы должны запускать сервер напрямую
> с этим флагом, например `node --experimental-sqlite server/index.js`. На Node
> 23.4 и новее (включая 24 LTS) `npm start` работает как есть. Если при запуске
> `node:sqlite` отсутствует, сервер выводит точный флаг/версию, которые ему
> нужны, и завершает работу.

### Запуск

Сервер читает следующие переменные окружения:

| Переменная | По умолчанию | Значение |
| --- | --- | --- |
| `PORT` | `8639` | Порт прослушивания HTTP. |
| `DB_PATH` | `./data/radar.db` | Путь к файлу SQLite (родительский каталог создаётся автоматически). |
| `HOST` | `127.0.0.1` | Интерфейс для привязки. По умолчанию только loopback. Чтобы открыть процесс, задайте `0.0.0.0`; у API чтения нет аутентификации, поэтому делайте это только за файрволом или прокси. |
| `TRUST_PROXY` | *(пусто)* | Точные IP-адреса ваших обратных прокси через запятую. Их `X-Forwarded-For` доверяется при ограничении частоты. Если пусто, не доверяется ни один прокси. |
| `RETENTION_DAYS` | *(выкл.)* | Удаляет события и сессии старше указанного числа дней при запуске и затем ежечасно. Пустое значение или `0` означает хранить всё. |
| `PATH_REDACTION` | `on` | `off` сохраняет пути страниц как есть; иначе сегменты, похожие на идентификаторы (числа, UUID, токены), сохраняются как `:id`. См. [privacy.md](privacy.md). |

Запуск на другом порту и с другим путём к базе данных:

```bash
PORT=9000 DB_PATH=/var/lib/rageclickradar/radar.db npm start
```

В Windows PowerShell сначала задайте переменные:

```powershell
$env:PORT='9000'; $env:DB_PATH='C:\rageclickradar\radar.db'; npm start
```

База данных открывается в режиме WAL, поэтому при обычной работе рядом вы увидите
файлы `radar.db`, `radar.db-wal` и `radar.db-shm`.

#### Модуль systemd

Создайте `/etc/systemd/system/rageclickradar.service`:

```ini
[Unit]
Description=RageClickRadar
After=network.target

[Service]
Type=simple
User=rageradar
WorkingDirectory=/opt/rageclickradar
# Bind to localhost; a reverse proxy terminates TLS and forwards to it.
Environment=HOST=127.0.0.1
Environment=PORT=8639
Environment=DB_PATH=/var/lib/rageclickradar/radar.db
# The proxy runs on this host, so its address is the one to trust for X-Forwarded-For.
Environment=TRUST_PROXY=127.0.0.1
# Node 24 LTS: no flag needed. On Node 22.5-23.3 use:
#   ExecStart=/usr/bin/node --experimental-sqlite server/index.js
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
# The process ignores SIGINT/SIGTERM cleanly (closes the DB, then exits).
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

Затем:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rageclickradar
```

### Обратный прокси (HTTPS)

Запускайте процесс Node привязанным к localhost и позвольте прокси завершать
TLS. Вы должны отдавать **как** панель/статические ресурсы, **так и**
`/api/collect` через один и тот же хост, чтобы работала используемая сниппетом
по умолчанию конечная точка того же источника (same-origin).

#### Caddy

Caddy даёт HTTPS в две строки (автоматические сертификаты):

```caddy
analytics.example.com {
    # Caddy sets X-Forwarded-For to the client address by default.
    reverse_proxy 127.0.0.1:8639
}
```

#### nginx

```nginx
server {
    listen 443 ssl;
    server_name analytics.example.com;

    ssl_certificate     /etc/letsencrypt/live/analytics.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analytics.example.com/privkey.pem;

    # One block covers everything: /, /radar.js, /api/collect, /api/pages, ...
    location / {
        proxy_pass http://127.0.0.1:8639;
        proxy_set_header Host $host;
        # Appends the client address. With TRUST_PROXY set to this proxy, the collector reads it.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> **Предупреждение: при `TRUST_PROXY` прокси должен добавлять адрес к `X-Forwarded-For`, а не передавать значение клиента без изменений.** С `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` nginx дописывает увиденный адрес к тому, что прислал клиент, а сборщик читает самую правую недоверенную запись. Не используйте для этого заголовка `$http_x_forwarded_for`: он передаёт собственное значение клиента без изменений, и клиенты смогут выбирать свою корзину. `reverse_proxy` в Caddy задаёт `X-Forwarded-For` по адресу клиента и игнорирует заголовки `X-Forwarded-*`, присланные клиентами, пока не настроен `trusted_proxies`. Оставьте это поведение по умолчанию и не копируйте входящий заголовок.

Сборщик никогда не хранит IP-адрес клиента, но ограничителю частоты в памяти нужен ключ для каждого клиента. По умолчанию ключом служит удалённый адрес сокета, а `X-Forwarded-For` игнорируется, чтобы клиент не мог подделкой заголовка получить свежую корзину. За обратным прокси этот адрес — сам прокси, поэтому **все** клиенты делят одну корзину на каждый бюджет. Чтобы это исправить, задайте `TRUST_PROXY` — точный IP-адрес прокси (или список прокси, которые вы эксплуатируете, через запятую). Если непосредственный партнёр входит в этот список, ограничитель читает `X-Forwarded-For` и идёт по нему справа налево, пропуская доверенные прокси; первый адрес, который не является доверенным прокси, считается клиентом. Клиент не может выбрать свою корзину, дописывая адреса, а заголовок от любого другого партнёра игнорируется. Если клиенты подключаются к процессу напрямую, оставьте `TRUST_PROXY` пустым.

### Замечание о CORS

`/api/collect` отвечает заголовком `Access-Control-Allow-Origin: *` — это
**сделано намеренно**: он должен принимать маяки (beacon) с любой страницы, где
вы установили счётчик, включая кросс-доменные сайты, задающие `data-endpoint`.
Это безопасно, потому что конечная точка *только проверяет и только пишет*: она
принимает строго занесённую в белый список анонимную полезную нагрузку,
возвращает `204` без читаемого тела и ограничена по частоте на каждый IP (по
умолчанию 60 запросов в минуту, в памяти). Ни одна из конечных точек
чтения/агрегации (`/api/pages`, `/api/heatmap`, ...) не отправляет заголовки
CORS, поэтому браузеры на других источниках не могут прочитать ваши данные.
Держите саму панель приватной (аутентификация на прокси, VPN или список
разрешённых адресов), поскольку в MVP нет встроенной аутентификации.

### Лимиты API

Процесс защищают два независимых лимита частоты на каждый IP, оба в памяти. Ключом служит адрес клиента: адрес сокета или, когда `TRUST_PROXY` указывает партнёра, переданный адрес клиента (см. раздел об обратном прокси выше):

| Конечная точка(и) | Лимит | Где |
| --- | --- | --- |
| `/api/collect` (запись) | 60 запр./мин | `RATE_LIMIT_PER_MIN` (`shared/config.js`) |
| `/api/pages`, `/api/heatmap`, `/api/hotspots`, `/api/sessions`, `/api/session` (чтение) | 300 запр./мин | `READ_RATE_LIMIT_PER_MIN` (`server/http.js`) |

Конечные точки чтения также ограничивают размер результата, чтобы ограничить
размер ответа и стоимость запроса на нагруженных страницах (константы в
`server/queries.js`). Строки упорядочиваются *до* усечения, поэтому каждый ответ
сохраняет верхние N в своём порядке:

| Конечная точка | Лимит | Сохраняемый порядок |
| --- | --- | --- |
| `/api/pages` | 200 страниц | Сначала наивысший показатель растерянности (confusion). |
| `/api/hotspots` | 200 селекторов на страницу | Сначала наивысший показатель; при равенстве — по имени селектора. |
| `/api/heatmap` | 20 000 точек | Сначала самые старые события (по id вставки). |
| `/api/session` | 5 000 событий | Сначала самые ранние события (по `ts`). |

`/api/hotspots` также возвращает `totals`: число сигналов каждого типа по всей странице. Оно не ограничено лимитом и включает селекторы NULL и пустые. Для значений по всей странице используйте его: суммирование `hotspots[].counts` при действующем лимите занижает итог.

### Резервное копирование

База данных — это единственный файл SQLite. Поскольку режим WAL держит недавние
записи во вспомогательном файле `-wal`, **не** копируйте один только `radar.db`,
пока сервер работает, — вы можете упустить зафиксированные данные. Используйте
один из способов:

- **Остановить, скопировать, запустить.** Остановите службу, скопируйте
  `radar.db` (и, на всякий случай, файлы `-wal` / `-shm`), затем запустите
  снова. Самый простой и всегда корректный способ.
- **Сначала контрольная точка.** Принудительно выполните контрольную точку WAL,
  чтобы всё было свёрнуто в основной файл, затем скопируйте `radar.db`:
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db "PRAGMA wal_checkpoint(TRUNCATE);"
  cp /var/lib/rageclickradar/radar.db /backups/radar-$(date +%F).db
  ```
- **Онлайн-резервирование (без простоя).** API резервного копирования SQLite
  согласован даже когда сервер пишет:
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db ".backup '/backups/radar-$(date +%F).db'"
  ```

### Хранение данных

Хранение по умолчанию выключено: строки остаются, пока вы их не удалите. Чтобы ограничить
базу, задайте в `RETENTION_DAYS` число дней хранения. Хорошая отправная точка — 90:

```bash
RETENTION_DAYS=90 npm start
```

Сервер выполняет очистку один раз при запуске и затем каждый час. Он удаляет:

- события, у которых `received_at` (время поступления) старше границы, и
- сессии, у которых `last_seen` старше границы.

Оба удаления выполняются в одной транзакции, а индекс по `events.received_at` не даёт
очистке сканировать всю таблицу. События оцениваются по отдельности, поэтому активная
сессия сохраняет свою строку и теряет только более старые события. Очистка пишет в stdout
только тогда, когда что-то удалила.

`RETENTION_DAYS` должно быть целым числом дней. Любое другое значение (например, `90d`)
останавливает сервер при запуске с однострочной ошибкой.

SQLite не уменьшает файл при удалении строк: освободившиеся страницы повторно используются
для новых данных. Чтобы вернуть место операционной системе, выполните `VACUUM`, когда
сервер остановлен:

```bash
sqlite3 /var/lib/rageclickradar/radar.db "VACUUM;"
```

Чтобы стереть всё, остановите сервер и удалите `radar.db` вместе с файлами `-wal` и `-shm`.

### Несколько сайтов

Таблица событий (events) ключует страницы **только по пути** (`location.pathname`;
строка запроса и хеш отсекаются). Она не хранит хост. Для конфигураций с
несколькими сайтами это имеет одно следствие:

- **Один сборщик на сайт (рекомендуется для MVP).** Запускайте отдельный процесс
  со своим `DB_PATH` для каждого сайта. Чистое разделение, без коллизий путей.
- **Один общий сборщик для нескольких сайтов.** Работает, и кросс-доменные сайты
  могут отправлять данные через `data-endpoint`. Оговорка: два сайта с общим
  путём (скажем, у обоих есть `/pricing`) объединят свои сигналы под этим единым
  путём, потому что хранилище не может их различить. Используйте общий сборщик
  только между сайтами, пути которых не пересекаются, либо смиритесь со
  слиянием.

---

## العربية

[English](#self-hosting-rageclickradar) · [Türkçe](#türkçe) · [中文](#中文) · [Русский](#русский) · **العربية** · [日本語](#日本語)

RageClickRadar هو عملية Node واحدة **بدون أي اعتماديات وقت تشغيل**، ويستخدم ملف
SQLite واحدًا. طبقة التخزين هي `node:sqlite`، لذا لا يوجد ما يُثبَّت سوى إصدار
حديث من Node. يغطي هذا الدليل مصفوفة إصدارات Node، وتشغيله كخدمة، ووضعه خلف
HTTPS، والنسخ الاحتياطي، والاحتفاظ بالبيانات، وإعدادات المواقع المتعددة.

### مصفوفة إصدارات Node

يخزّن الخادم البيانات عبر وحدة Node المدمجة `node:sqlite`. يعتمد توفّر هذه الوحدة
على إصدار Node:

| إصدار Node | `node:sqlite` | كيفية البدء |
| --- | --- | --- |
| < 22.5 | غير متوفر | غير مدعوم — رقِّ Node. |
| 22.5 – 23.3 | خلف علامة (flag) | `node --experimental-sqlite server/index.js` |
| 23.4 – 24.x | متوفر بدون علامة | `node server/index.js` (أي `npm start`) |
| **24 LTS** | متوفر بدون علامة | **موصى به.** `npm start` |

> إن سكربتات npm (`npm start` و`npm run demo` و`npm run seed`) **لا** تمرّر
> `--experimental-sqlite`. على Node 22.5–23.3 يجب استدعاء الخادم مباشرةً مع
> العلامة، مثل `node --experimental-sqlite server/index.js`. على Node 23.4
> والأحدث (بما في ذلك 24 LTS) يعمل `npm start` كما هو. إذا كان `node:sqlite`
> مفقودًا عند بدء التشغيل، يطبع الخادم العلامة/الإصدار الدقيق الذي يحتاجه ثم
> يخرج.

### التشغيل

يقرأ الخادم متغيرات البيئة التالية:

| المتغير | الافتراضي | المعنى |
| --- | --- | --- |
| `PORT` | `8639` | منفذ الاستماع لـ HTTP. |
| `DB_PATH` | `./data/radar.db` | مسار ملف SQLite (يُنشأ الدليل الأصل تلقائيًا). |
| `HOST` | `127.0.0.1` | واجهة الربط. الافتراضي loopback فقط. اضبط `0.0.0.0` لإتاحة العملية للشبكة؛ واجهة القراءة بلا مصادقة، لذا افعل ذلك خلف جدار ناري أو وكيل فقط. |
| `TRUST_PROXY` | *(فارغ)* | عناوين IP الدقيقة للوكلاء العكسيين التي تشغّلها، مفصولة بفواصل. يُوثَق بترويسة `X-Forwarded-For` الخاصة بها لتحديد المعدل. وإذا كانت فارغة فلا يُوثَق بأي وكيل. |
| `RETENTION_DAYS` | *(معطّل)* | يحذف الأحداث والجلسات الأقدم من هذا العدد من الأيام عند البدء ثم كل ساعة. القيمة الفارغة أو `0` تُبقي كل شيء. |
| `PATH_REDACTION` | `on` | `off` يُخزِّن مسارات الصفحات كما هي؛ وإلا فإن المقاطع الشبيهة بالمعرّفات (أرقام، UUID، رموز) تُخزَّن كـ `:id`. راجع [privacy.md](privacy.md). |

التشغيل على منفذ ومسار قاعدة بيانات مختلفين:

```bash
PORT=9000 DB_PATH=/var/lib/rageclickradar/radar.db npm start
```

على Windows PowerShell، اضبط المتغيرات أولًا:

```powershell
$env:PORT='9000'; $env:DB_PATH='C:\rageclickradar\radar.db'; npm start
```

تُفتح قاعدة البيانات في وضع WAL، لذا سترى ملفات `radar.db` و`radar.db-wal`
و`radar.db-shm` بجانب بعضها في التشغيل الطبيعي.

#### وحدة systemd

أنشئ `/etc/systemd/system/rageclickradar.service`:

```ini
[Unit]
Description=RageClickRadar
After=network.target

[Service]
Type=simple
User=rageradar
WorkingDirectory=/opt/rageclickradar
# Bind to localhost; a reverse proxy terminates TLS and forwards to it.
Environment=HOST=127.0.0.1
Environment=PORT=8639
Environment=DB_PATH=/var/lib/rageclickradar/radar.db
# The proxy runs on this host, so its address is the one to trust for X-Forwarded-For.
Environment=TRUST_PROXY=127.0.0.1
# Node 24 LTS: no flag needed. On Node 22.5-23.3 use:
#   ExecStart=/usr/bin/node --experimental-sqlite server/index.js
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
# The process ignores SIGINT/SIGTERM cleanly (closes the DB, then exits).
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

ثم:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rageclickradar
```

### الوكيل العكسي (HTTPS)

شغّل عملية Node مرتبطةً بـ localhost ودع الوكيل ينهي TLS. يجب أن تقدّم **كلًّا**
من لوحة المعلومات/الأصول الساكنة **و** `/api/collect` عبر المضيف نفسه حتى تعمل
نقطة النهاية الافتراضية ذات المصدر نفسه (same-origin) الخاصة بالمقتطف.

#### Caddy

يمنحك Caddy تشفير HTTPS في سطرين (شهادات تلقائية):

```caddy
analytics.example.com {
    # Caddy sets X-Forwarded-For to the client address by default.
    reverse_proxy 127.0.0.1:8639
}
```

#### nginx

```nginx
server {
    listen 443 ssl;
    server_name analytics.example.com;

    ssl_certificate     /etc/letsencrypt/live/analytics.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analytics.example.com/privkey.pem;

    # One block covers everything: /, /radar.js, /api/collect, /api/pages, ...
    location / {
        proxy_pass http://127.0.0.1:8639;
        proxy_set_header Host $host;
        # Appends the client address. With TRUST_PROXY set to this proxy, the collector reads it.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> **تحذير: عند استخدام `TRUST_PROXY` يجب أن يُلحق الوكيل عنوانه بترويسة `X-Forwarded-For`، لا أن يمرّر قيمة العميل كما هي.** مع `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` يُلحق nginx العنوان الذي رآه بما أرسله العميل، ويقرأ المجمِّع أقصى اليمين من الإدخالات غير الموثوقة. لا تستخدم `$http_x_forwarded_for` لهذه الترويسة: فهو يمرّر قيمة العميل نفسها دون تغيير، فيستطيع العملاء اختيار حاويتهم. و`reverse_proxy` في Caddy يضبط `X-Forwarded-For` من عنوان العميل، ويتجاهل ترويسات `X-Forwarded-*` التي يرسلها العملاء ما لم يُضبط `trusted_proxies`. أبقِ هذا الإعداد الافتراضي ولا تنسخ الترويسة الواردة.

لا يخزّن المجمِّع عنوان IP للعميل أبدًا، لكن محدِّد المعدل في الذاكرة يحتاج إلى مفتاح لكل عميل. افتراضيًا يستخدم المفتاح عنوان الطرف البعيد للمقبس ويتجاهل `X-Forwarded-For`، حتى لا يتمكن العميل من الحصول على حاوية جديدة بتزوير الترويسة. خلف وكيل عكسي يكون هذا العنوان هو الوكيل نفسه، فيتشارك **جميع** العملاء حاوية واحدة لكل ميزانية. لإصلاح ذلك اضبط `TRUST_PROXY` على عنوان IP الدقيق للوكيل (أو قائمة مفصولة بفواصل للوكلاء التي تشغّلها). عندما يكون الطرف المباشر أحدها، يقرأ المحدِّد ترويسة `X-Forwarded-For` ويمرّ عليها من اليمين إلى اليسار متجاوزًا الوكلاء الموثوقة، فيكون أول عنوان ليس وكيلًا موثوقًا هو العميل. ولا يستطيع العميل اختيار حاويته بإضافة عناوين أمامها، وتُتجاهل الترويسة القادمة من أي طرف آخر. أبقِ `TRUST_PROXY` فارغًا عندما يتصل العملاء بالعملية مباشرة.

### ملاحظة حول CORS

يستجيب `/api/collect` بالترويسة `Access-Control-Allow-Origin: *` — وهذا **بتصميم
مقصود**: إذ يجب أن يقبل الإشارات (beacon) من أي صفحة تضع فيها الأداة، بما في ذلك
المواقع عبر الأصول التي تضبط `data-endpoint`. وهذا آمن لأن نقطة النهاية *للتحقق
فقط وللكتابة فقط*: فهي تقبل حمولة مجهولة مُدرجة في قائمة سماح صارمة، وتعيد `204`
دون جسم قابل للقراءة، وهي محدودة المعدل لكل IP (60 طلبًا في الدقيقة افتراضيًا، في
الذاكرة). ولا ترسل أيٌّ من نقاط نهاية القراءة/التجميع (`/api/pages`
و`/api/heatmap`، ...) ترويسات CORS، لذا لا تستطيع المتصفحات على الأصول الأخرى
قراءة بياناتك. أبقِ لوحة المعلومات نفسها خاصة (مصادقة عبر الوكيل، أو VPN، أو قائمة
سماح)، لأن نسخة MVP لا تتضمن مصادقة مدمجة.

### حدود واجهة برمجة التطبيقات (API)

يحمي العمليةَ حدّان مستقلان للمعدل لكل IP، وكلاهما في الذاكرة، ويكون المفتاح هو عنوان العميل: عنوان المقبس، أو عنوان العميل المُعاد توجيهه عندما يحدّد `TRUST_PROXY` الطرف المباشر (راجع قسم الوكيل العكسي أعلاه):

| نقطة/نقاط النهاية | الحد | الموضع |
| --- | --- | --- |
| `/api/collect` (كتابة) | 60 طلبًا/دقيقة | `RATE_LIMIT_PER_MIN` (`shared/config.js`) |
| `/api/pages` و`/api/heatmap` و`/api/hotspots` و`/api/sessions` و`/api/session` (قراءة) | 300 طلب/دقيقة | `READ_RATE_LIMIT_PER_MIN` (`server/http.js`) |

كما تحدّ نقاط نهاية القراءة من حجم النتيجة لتقييد حجم الاستجابة وتكلفة الاستعلام
على الصفحات المزدحمة (الثوابت في `server/queries.js`). تُرتَّب الصفوف *قبل* تطبيق
الحد، فتحتفظ كل استجابة بأعلى N وفق ترتيبها:

| نقطة النهاية | الحد | الترتيب المحفوظ |
| --- | --- | --- |
| `/api/pages` | 200 صفحة | الأعلى في درجة الارتباك (confusion) أولًا. |
| `/api/hotspots` | 200 محدِّدًا لكل صفحة | الأعلى في درجة الارتباك أولًا؛ وعند التساوي حسب اسم المحدِّد. |
| `/api/heatmap` | 20٬000 نقطة | الأحداث الأقدم أولًا (حسب معرّف الإدراج). |
| `/api/session` | 5٬000 حدث | الأحداث الأبكر أولًا (حسب `ts`). |

تُرجع `/api/hotspots` أيضًا الحقل `totals`: عدد الإشارات لكل نوع على مستوى الصفحة كلها. وهو غير مقيَّد بالحد، ويشمل المحدِّدات NULL والفارغة. استخدمه للأرقام على مستوى الصفحة، لأن جمع `hotspots[].counts` يقلّل العدد بعد تطبيق الحد.

### النسخ الاحتياطي

قاعدة البيانات ملف SQLite واحد. وبما أن وضع WAL يحتفظ بأحدث عمليات الكتابة في ملف
`-wal` الجانبي، **لا** تكتفِ بنسخ `radar.db` وحده بينما الخادم يعمل — فقد تفوتك
بيانات مُثبَّتة. استخدم إحدى الطرق التالية:

- **أوقِف، انسخ، شغّل.** أوقف الخدمة، وانسخ `radar.db` (ومن باب الحيطة ملفَّي
  `-wal` / `-shm`)، ثم شغّلها من جديد. أبسط طريقة وصحيحة دائمًا.
- **نقطة تفتيش أولًا.** افرض تنفيذ نقطة تفتيش WAL حتى يُطوى كل شيء داخل الملف
  الرئيسي، ثم انسخ `radar.db`:
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db "PRAGMA wal_checkpoint(TRUNCATE);"
  cp /var/lib/rageclickradar/radar.db /backups/radar-$(date +%F).db
  ```
- **نسخ احتياطي أثناء التشغيل (دون توقف).** واجهة النسخ الاحتياطي في SQLite
  متسقة حتى أثناء كتابة الخادم:
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db ".backup '/backups/radar-$(date +%F).db'"
  ```

### الاحتفاظ بالبيانات

الاحتفاظ معطّل افتراضيًا: تبقى الصفوف حتى تحذفها. لتحديد حجم قاعدة البيانات، اضبط
`RETENTION_DAYS` على عدد الأيام المراد الاحتفاظ بها. القيمة 90 نقطة بداية معقولة:

```bash
RETENTION_DAYS=90 npm start
```

يُجري الخادم التنظيف مرة عند البدء ثم كل ساعة، فيحذف:

- الأحداث التي يكون `received_at` (وقت الوصول) فيها أقدم من الحد الزمني، و
- الجلسات التي يكون `last_seen` فيها أقدم من الحد الزمني.

يُنفَّذ الحذفان في معاملة واحدة، ويمنع الفهرس على `events.received_at` التنظيفَ من مسح
الجدول بأكمله. تُقيَّم الأحداث واحدًا واحدًا، فتحتفظ الجلسة النشطة بصفّها وتفقد أحداثها
الأقدم فقط. يُسجَّل التنظيف على stdout فقط عندما يحذف شيئًا.

يجب أن تكون `RETENTION_DAYS` عددًا صحيحًا من الأيام. أي قيمة أخرى (مثل `90d`) توقف
الخادم عند البدء برسالة خطأ من سطر واحد.

لا يُصغِّر SQLite الملف عند حذف الصفوف؛ فالصفحات المحرَّرة تُعاد استخدامها للبيانات
الجديدة. لاستعادة المساحة لنظام التشغيل، شغّل `VACUUM` والخادم متوقف:

```bash
sqlite3 /var/lib/rageclickradar/radar.db "VACUUM;"
```

لمحو كل شيء، أوقِف الخادم واحذف `radar.db` مع ملفيه `-wal` و`-shm`.

### مواقع متعددة

يفهرس جدول الأحداث (events) الصفحات **بحسب المسار فقط** (`location.pathname`؛
تُزال سلسلة الاستعلام والـ hash). وهو لا يخزّن المضيف. ولهذا أثر واحد على إعدادات
المواقع المتعددة:

- **مُجمِّع واحد لكل موقع (موصى به لنسخة MVP).** شغّل عملية منفصلة لها `DB_PATH`
  خاص بها لكل موقع. فصل نظيف، ودون تصادم في المسارات.
- **مُجمِّع واحد مشترك لعدة مواقع.** يعمل، ويمكن للمواقع عبر الأصول أن ترسل عبر
  `data-endpoint`. التنبيه: موقعان يتشاركان المسار نفسه (لكليهما `/pricing` مثلًا)
  ستُدمج إشاراتهما تحت ذلك المسار الواحد، لأن المخزن لا يستطيع التمييز بينهما.
  لا تشارك مُجمِّعًا إلا بين المواقع التي لا تتداخل مساراتها، أو تقبَّل الدمج.

---

## 日本語

[English](#self-hosting-rageclickradar) · [Türkçe](#türkçe) · [中文](#中文) · [Русский](#русский) · [العربية](#العربية) · **日本語**

RageClickRadar は**実行時依存ゼロ**の単一 Node プロセスであり、単一の SQLite
ファイルを使用します。ストレージ層は `node:sqlite` なので、新しめの Node 以外に
インストールするものはありません。本ガイドでは、Node のバージョン対応表、
サービスとしての実行、HTTPS の背後への配置、バックアップ、データ保持、そして
マルチサイト構成を扱います。

### Node バージョン対応表

サーバーは Node 組み込みの `node:sqlite` モジュールを通じてデータを保存します。
このモジュールが利用可能かどうかは Node のバージョンに依存します。

| Node バージョン | `node:sqlite` | 起動方法 |
| --- | --- | --- |
| < 22.5 | 利用不可 | 非対応 — Node をアップグレードしてください。 |
| 22.5 – 23.3 | フラグの背後 | `node --experimental-sqlite server/index.js` |
| 23.4 – 24.x | フラグなしで利用可 | `node server/index.js`（つまり `npm start`） |
| **24 LTS** | フラグなしで利用可 | **推奨。** `npm start` |

> npm スクリプト（`npm start`、`npm run demo`、`npm run seed`）は
> `--experimental-sqlite` を**渡しません**。Node 22.5–23.3 では、
> `node --experimental-sqlite server/index.js` のように、このフラグを付けて
> サーバーを直接起動する必要があります。Node 23.4 以降（24 LTS を含む）では
> `npm start` がそのまま動作します。起動時に `node:sqlite` が見つからない場合、
> サーバーは必要な正確なフラグ／バージョンを出力して終了します。

### 実行

サーバーは次の環境変数を読み取ります。

| 変数 | デフォルト | 意味 |
| --- | --- | --- |
| `PORT` | `8639` | HTTP のリッスンポート。 |
| `DB_PATH` | `./data/radar.db` | SQLite ファイルのパス（親ディレクトリは自動的に作成されます）。 |
| `HOST` | `127.0.0.1` | バインドするインターフェース。既定はループバックのみです。`0.0.0.0` を設定するとプロセスを公開します。読み取り API には認証がないため、ファイアウォールやプロキシの背後でのみ行ってください。 |
| `TRUST_PROXY` | *（空）* | 運用するリバースプロキシの IP アドレスをカンマ区切りで正確に指定します。これらのプロキシの `X-Forwarded-For` をレート制限で信頼します。空の場合はどのプロキシも信頼しません。 |
| `RETENTION_DAYS` | *（無効）* | 起動時と以後 1 時間ごとに、この日数より古いイベントとセッションを削除します。空または `0` の場合はすべて保持します。 |
| `PATH_REDACTION` | `on` | `off` はページのパスをそのまま保存します。それ以外では識別子らしいセグメント（数値、UUID、トークン）が `:id` として保存されます。[privacy.md](privacy.md) を参照。 |

別のポートとデータベースパスで実行する場合：

```bash
PORT=9000 DB_PATH=/var/lib/rageclickradar/radar.db npm start
```

Windows PowerShell では、先に変数を設定します。

```powershell
$env:PORT='9000'; $env:DB_PATH='C:\rageclickradar\radar.db'; npm start
```

データベースは WAL モードで開かれるため、通常運用時には `radar.db`、
`radar.db-wal`、`radar.db-shm` の各ファイルが隣り合って並んでいるのが見えます。

#### systemd ユニット

`/etc/systemd/system/rageclickradar.service` を作成します。

```ini
[Unit]
Description=RageClickRadar
After=network.target

[Service]
Type=simple
User=rageradar
WorkingDirectory=/opt/rageclickradar
# Bind to localhost; a reverse proxy terminates TLS and forwards to it.
Environment=HOST=127.0.0.1
Environment=PORT=8639
Environment=DB_PATH=/var/lib/rageclickradar/radar.db
# The proxy runs on this host, so its address is the one to trust for X-Forwarded-For.
Environment=TRUST_PROXY=127.0.0.1
# Node 24 LTS: no flag needed. On Node 22.5-23.3 use:
#   ExecStart=/usr/bin/node --experimental-sqlite server/index.js
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
# The process ignores SIGINT/SIGTERM cleanly (closes the DB, then exits).
KillSignal=SIGTERM

[Install]
WantedBy=multi-user.target
```

続いて：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rageclickradar
```

### リバースプロキシ（HTTPS）

Node プロセスを localhost にバインドして実行し、TLS はプロキシに終端させます。
スニペットのデフォルトの同一オリジン（same-origin）エンドポイントが機能する
ように、ダッシュボード／静的アセット**と** `/api/collect` の**両方**を同じ
ホスト経由で配信しなければなりません。

#### Caddy

Caddy なら 2 行で HTTPS が得られます（証明書は自動）。

```caddy
analytics.example.com {
    # Caddy sets X-Forwarded-For to the client address by default.
    reverse_proxy 127.0.0.1:8639
}
```

#### nginx

```nginx
server {
    listen 443 ssl;
    server_name analytics.example.com;

    ssl_certificate     /etc/letsencrypt/live/analytics.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/analytics.example.com/privkey.pem;

    # One block covers everything: /, /radar.js, /api/collect, /api/pages, ...
    location / {
        proxy_pass http://127.0.0.1:8639;
        proxy_set_header Host $host;
        # Appends the client address. With TRUST_PROXY set to this proxy, the collector reads it.
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> **警告：`TRUST_PROXY` を使う場合、プロキシは `X-Forwarded-For` に追記しなければならず、クライアントが送った値をそのまま転送してはいけません。** `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` では、nginx が見た送信元アドレスをクライアントが送った値の末尾に追記し、コレクターは信頼されていない最も右の要素を読みます。この目的で `$http_x_forwarded_for` を使わないでください。クライアント自身の値を変更せずに渡すため、クライアントが自分のバケットを選べてしまいます。Caddy の `reverse_proxy` は、クライアントのアドレスから `X-Forwarded-For` を設定し、`trusted_proxies` を設定しない限り、クライアントが送った `X-Forwarded-*` ヘッダーを無視します。既定の動作のままにし、受信したヘッダーをコピーしないでください。

コレクターはクライアント IP を一切保存しませんが、メモリ内のレートリミッターにはクライアントごとのキーが必要です。既定では、ソケットのリモートアドレスをキーにし、`X-Forwarded-For` は無視します。クライアントが偽装して新しいバケットに入り込むのを防ぐためです。リバースプロキシの背後では、このアドレスはプロキシ自身になるため、**すべての**クライアントが（予算ごとに）1 つのバケットを共有します。これを解決するには、`TRUST_PROXY` にプロキシの IP アドレス（または運用するプロキシのカンマ区切りリスト）を設定します。直接の接続相手がその一覧に含まれる場合、レートリミッターは `X-Forwarded-For` を読み、右から左へたどって、信頼されたプロキシ以外で最初のアドレスをクライアントとみなします。クライアントは先頭にアドレスを足して自分のバケットを選ぶことはできず、他の接続相手からのヘッダーは無視されます。クライアントがプロセスに直接接続する場合は、`TRUST_PROXY` を空のままにしてください。

### CORS に関する注記

`/api/collect` は `Access-Control-Allow-Origin: *` を返します — これは**設計上
意図的なもの**です。`data-endpoint` を設定したクロスオリジンのサイトを含め、
計測対象のあらゆるページからのビーコンを受け付けなければならないためです。
このエンドポイントは*検証のみ・書き込みのみ*なので安全です。すなわち、厳格に
ホワイトリスト化された匿名のペイロードを受け取り、読み取り可能な本文なしに
`204` を返し、IP ごとにレート制限されています（デフォルトで毎分 60 リクエスト、
メモリ内）。読み取り／集計エンドポイント（`/api/pages`、`/api/heatmap` など）は
いずれも CORS ヘッダーを送出しないため、他オリジンのブラウザがあなたのデータを
読み取ることはできません。MVP には組み込みの認証がないため、ダッシュボード自体
は非公開に保ってください（プロキシ認証、VPN、または許可リスト）。

### API の制限

プロセスを保護する、IP ごとの独立したレート制限が 2 つあり、いずれもメモリ内にあります。キーはクライアントアドレスです。ソケットアドレスか、`TRUST_PROXY` が接続相手を指定している場合は転送されたクライアントアドレスを使います（上記のリバースプロキシの節を参照）。

| エンドポイント | 制限 | 場所 |
| --- | --- | --- |
| `/api/collect`（書き込み） | 60 リクエスト/分 | `RATE_LIMIT_PER_MIN`（`shared/config.js`） |
| `/api/pages`、`/api/heatmap`、`/api/hotspots`、`/api/sessions`、`/api/session`（読み取り） | 300 リクエスト/分 | `READ_RATE_LIMIT_PER_MIN`（`server/http.js`） |

読み取りエンドポイントは、混雑したページでのレスポンスサイズとクエリコストを
抑えるために結果サイズにも上限を設けています（定数は `server/queries.js` 内）。
行は上限適用の*前に*並べ替えられるため、各レスポンスはその並び順で上位 N 件を
保持します。

| エンドポイント | 上限 | 保持される並び順 |
| --- | --- | --- |
| `/api/pages` | 200 ページ | 混乱（confusion）スコアが高い順。 |
| `/api/hotspots` | ページごとに 200 セレクター | 混乱（confusion）スコアが高い順。同点はセレクター名順。 |
| `/api/heatmap` | 20,000 ポイント | 古いイベント順（挿入 id 順）。 |
| `/api/session` | 5,000 イベント | 早いイベント順（`ts` 順）。 |

`/api/hotspots` は `totals` も返します。これはページ全体のシグナル種別ごとの件数で、上限の影響を受けず、NULL や空のセレクターも含みます。ページ全体の数値にはこちらを使ってください。上限が適用されると、`hotspots[].counts` の合計は少なくなります。

### バックアップ

データベースは単一の SQLite ファイルです。WAL モードは最近の書き込みを `-wal`
サイドカーに保持するため、サーバーの稼働中に `radar.db` だけをコピーしては
**いけません** — コミット済みのデータを取りこぼす可能性があります。次のいずれ
かを使ってください。

- **停止・コピー・起動。** サービスを停止し、`radar.db`（念のため `-wal` /
  `-shm` ファイルも）をコピーしてから、再度起動します。最も単純で、常に正しい
  方法です。
- **先にチェックポイント。** すべてを本体ファイルに畳み込むよう WAL チェック
  ポイントを強制してから、`radar.db` をコピーします。
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db "PRAGMA wal_checkpoint(TRUNCATE);"
  cp /var/lib/rageclickradar/radar.db /backups/radar-$(date +%F).db
  ```
- **オンラインバックアップ（無停止）。** SQLite のバックアップ API は、サーバー
  が書き込み中でも一貫性を保ちます。
  ```bash
  sqlite3 /var/lib/rageclickradar/radar.db ".backup '/backups/radar-$(date +%F).db'"
  ```

### データ保持

データ保持は既定で無効です。行は削除するまで残ります。データベースの大きさを抑えるには、
`RETENTION_DAYS` に保持する日数を設定します。90 が妥当な出発点です：

```bash
RETENTION_DAYS=90 npm start
```

サーバーは起動時に一度、その後は 1 時間ごとに整理を実行し、次のものを削除します：

- `received_at`（到着時刻）がカットオフより古いイベント
- `last_seen` がカットオフより古いセッション

両方の削除は 1 つのトランザクションで実行され、`events.received_at` のインデックスに
より整理がテーブル全体をスキャンすることはありません。イベントは 1 件ずつ判定されるため、
まだ活動中のセッションは行を保持し、古いイベントだけを失います。整理は実際に何かを削除
したときにのみ stdout に記録されます。

`RETENTION_DAYS` は整数の日数である必要があります。それ以外の値（例：`90d`）を指定すると、
サーバーは起動時に 1 行のエラーを出して終了します。

SQLite は行を削除してもファイルを縮小しません。解放されたページは新しいデータに再利用
されます。領域を OS に返すには、サーバーを停止した状態で `VACUUM` を実行します：

```bash
sqlite3 /var/lib/rageclickradar/radar.db "VACUUM;"
```

すべて消去するには、サーバーを停止して `radar.db` と `-wal`・`-shm` のファイルを削除します。

### 複数サイト

events テーブルは、ページを**パスのみ**でキー付けします（`location.pathname`。
クエリとハッシュは除去されます）。ホストは保存しません。これはマルチサイト構成に
1 つの帰結をもたらします。

- **サイトごとに 1 つのコレクター（MVP では推奨）。** サイトごとに、それぞれ
  独自の `DB_PATH` を持つ別プロセスを実行します。きれいに分離でき、パスの衝突も
  ありません。
- **複数サイトで 1 つの共有コレクター。** 動作しますし、クロスオリジンのサイトも
  `data-endpoint` 経由で送信できます。注意点：同じパスを共有する 2 つのサイト
  （たとえば両方に `/pricing` がある場合）は、ストアがそれらを区別できないため、
  そのシグナルがその 1 つのパスの下に統合されてしまいます。パスが重複しない
  サイト同士でのみコレクターを共有するか、統合を受け入れてください。
