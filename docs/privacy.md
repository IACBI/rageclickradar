# Privacy statement

**English** · [Türkçe](#türkçe) · [中文](#中文) · [Русский](#русский) · [العربية](#العربية) · [日本語](#日本語)

RageClickRadar is built to measure *frustration*, not *people*. It computes
behavioral signals inside the browser and sends only anonymous conclusions to the
collector. No text you type, no field values, no IP address, no user agent, and
no cross-site identifier is ever transmitted or stored. This document describes
exactly what is and isn't collected, from both the visitor's and the operator's
point of view.

## Exactly what is collected

Each batch the tracker sends is a small JSON envelope plus a list of events. This
is the **entire** wire schema — every field the collector accepts is listed here;
anything else in a payload is dropped on the server before storage.

### Envelope

| Field | Example | Why it exists |
| --- | --- | --- |
| `v` | `1` | Wire format version (must be `1`). |
| `sid` | `"s_9f3a2b8c1d0e"` | Per-tab session id, random, from `sessionStorage`. Not a cookie; gone when the tab closes. |
| `page` | `"/pricing"` | `location.pathname` only — query string and hash are stripped client-side and again on the server. |
| `vw` | `1280` | Viewport width (px), to bucket heatmaps by screen size. |
| `vh` | `720` | Viewport height (px). |
| `dw` | `1280` | Document width (px), to place coordinates on the page. |
| `dh` | `3400` | Document height (px). |
| `events` | `[ … ]` | The array of frustration signals (below). |

### Event

| Field | Example | Why it exists |
| --- | --- | --- |
| `t` | `"rage"` | Signal type: `rage`, `dead`, `formaband`, or `correction`. |
| `ts` | `4210` | Milliseconds **since page load** — a relative offset, never a wall-clock time. |
| `x` | `512.0` | Click x-coordinate on the page (present for click signals only). |
| `y` | `1180.0` | Click y-coordinate on the page (present for click signals only). |
| `sel` | `"button#buy-now"` | Sanitized CSS selector built from tag / id / class only — never text content. Capped at 120 chars. |
| `n` | `5` | Signal magnitude: clicks in a rage burst, deletions in a correction, engaged fields in an abandonment. |
| `m` | `{ "i": 14 }` | Tiny type-specific meta (e.g. insertion count, last-field selector, dwell ms). Capped at 500 chars, structure only — no text values. |

The server also records three wall-clock timestamps the browser never sends (all
`Date.now()`, in milliseconds). None is tied to any identity:

| Field | Where | Why it exists |
| --- | --- | --- |
| `received_at` | on each event | Arrival time; drives retention (delete rows older than a cutoff). |
| `started_at` | on the session | When the session's first batch arrived. |
| `last_seen` | on the session | Updated on every batch; orders the session list newest-first and lets you prune stale sessions. |

## What is NOT collected

RageClickRadar deliberately never collects, transmits, or stores:

- **Keystrokes or their contents.** Correction and abandonment signals are
  derived by *counting* input-event types (insert vs. delete); the code has no
  path that reads `event.data` or an element's `.value`.
- **Field / form values.** Nothing you type into any input is read or sent.
- **IP addresses.** The client IP is used only for in-memory rate limiting and is
  never logged or stored. The database schema has no IP column.
- **User agent / browser headers.** Not read, not stored.
- **Cookies.** None are set. The per-tab id lives in `sessionStorage`.
- **Full URLs.** Only `location.pathname` — the query string and fragment (which
  often carry tokens or search terms) are stripped.
- **Wall-clock client time.** Event timestamps are relative to page load, so they
  reveal nothing about the visitor's local time or timezone.
- **Cross-site or persistent identifiers.** No fingerprinting; the session id is
  random, per-tab, and discarded when the tab closes.

## From the visitor's perspective

You are **anonymous by design**. There is no cookie, no login, and no persistent
id — the session identifier lives in `sessionStorage`, is a random string with no
personal meaning, and disappears the moment the tab is closed. Reopening the site
in a new tab produces a fresh, unlinkable id. There is no device fingerprinting
and nothing that follows you between sites. The only things recorded are anonymous
facts about *where an interaction happened* (a path, a coordinate, a CSS
selector) and *what kind of friction it was* — never *what you wrote* or *who you
are*.

Site operators can also add `data-radar-ignore` to any element (or a container)
to exclude it from tracking entirely.

## From the operator's perspective

Because RageClickRadar is self-hosted, **you host it and you own the data**.
Nothing is sent to a third party — signals go to your collector and land in your
SQLite file. That also means the responsibilities are yours:

- **Retention is your policy.** Data stays until you delete it. See the retention
  SQL and scheduling examples in [self-hosting.md](self-hosting.md).
- **Access control is yours.** The MVP has no authentication; keep the dashboard
  behind a reverse proxy, VPN, or allow-list.
- **Disclosure is yours.** If your privacy policy enumerates what you collect, the
  "what is collected" table above is the accurate list to mirror.

## GDPR and e-privacy

RageClickRadar is intentionally designed to **avoid processing personal data**:
no cookies (so no cookie-consent trigger under the e-Privacy Directive from *this*
tool), no IP retention, no fingerprinting, and only anonymous per-tab signals.
The goal is analytics that fall outside the scope of consent-gated tracking.

**This is not legal advice.** Whether a given deployment needs consent or a
notice depends on your full stack, your jurisdiction, and how regulators
interpret "anonymous" versus "pseudonymous" data — and interpretations vary. If
you combine RageClickRadar with other systems, embed it in a site that already
identifies users, or operate under a strict regime, review it with someone
qualified. RageClickRadar gives you a privacy-preserving foundation; the
compliance conclusion is yours to make.

## How to verify these claims

Everything here is checkable in the source:

- **The wire schema** is the field whitelist in
  [`server/collect.js`](../server/collect.js) — `normalizeEvent()` and
  `handleCollectBody()` accept only the fields tabled above; the database schema
  is in [`server/db.js`](../server/db.js) (no ip/ua/header columns).
- **The privacy assertions** are enforced by the test
  `privacy: schema has no IP/UA-like columns and meta holds only m` in
  [`test/unit/collect.test.js`](../test/unit/collect.test.js). It scans the
  schema for any `ip` / `agent` / `ua` / `header` column and smuggles fabricated
  IP/UA markers into a payload, then asserts none of them reach any stored value.
- **The "no text is read" property** is visible in the tracker source
  ([`tracker/src/radar.js`](../tracker/src/radar.js) and
  [`tracker/src/detectors.js`](../tracker/src/detectors.js)): only
  `event.inputType` is classified — `event.data` and `element.value` are never
  touched.

Run the tests yourself with `npm test`.

---

## Türkçe

[English](#privacy-statement) · **Türkçe** · [中文](#中文) · [Русский](#русский) · [العربية](#العربية) · [日本語](#日本語)

RageClickRadar, *insanları* değil *hüsranı* ölçmek için tasarlanmıştır.
Davranışsal sinyalleri tarayıcının içinde hesaplar ve toplayıcıya yalnızca
anonim sonuçları gönderir. Yazdığınız hiçbir metin, hiçbir alan değeri, hiçbir IP
adresi, hiçbir kullanıcı aracısı (user agent) ve hiçbir siteler arası
tanımlayıcı asla iletilmez veya saklanmaz. Bu belge, hem ziyaretçinin hem de
operatörün bakış açısından tam olarak neyin toplanıp neyin toplanmadığını
açıklar.

### Tam olarak ne toplanır

İzleyicinin gönderdiği her yığın (batch), küçük bir JSON zarfı ile bir olay
listesinden oluşur. Bu, **tam** tel şemasıdır (wire schema) — toplayıcının kabul
ettiği her alan burada listelenmiştir; bir yükteki (payload) başka her şey,
depolamadan önce sunucuda atılır.

#### Zarf

| Alan | Örnek | Neden var |
| --- | --- | --- |
| `v` | `1` | Tel format sürümü (`1` olmalıdır). |
| `sid` | `"s_9f3a2b8c1d0e"` | Sekme başına oturum kimliği; rastgele, `sessionStorage`'dan alınır. Çerez değildir; sekme kapandığında yok olur. |
| `page` | `"/pricing"` | Yalnızca `location.pathname` — sorgu dizesi ve karma (hash), hem istemci tarafında hem de sunucuda tekrar çıkarılır. |
| `vw` | `1280` | Görünüm alanı genişliği (px); ısı haritalarını ekran boyutuna göre gruplamak için. |
| `vh` | `720` | Görünüm alanı yüksekliği (px). |
| `dw` | `1280` | Belge genişliği (px); koordinatları sayfaya yerleştirmek için. |
| `dh` | `3400` | Belge yüksekliği (px). |
| `events` | `[ … ]` | Hüsran sinyalleri dizisi (aşağıda). |

#### Olay

| Alan | Örnek | Neden var |
| --- | --- | --- |
| `t` | `"rage"` | Sinyal türü: `rage`, `dead`, `formaband` veya `correction`. |
| `ts` | `4210` | **Sayfa yüklenmesinden bu yana** geçen milisaniye — göreli bir konum, asla duvar saati zamanı değil. |
| `x` | `512.0` | Sayfadaki tıklama x koordinatı (yalnızca tıklama sinyallerinde bulunur). |
| `y` | `1180.0` | Sayfadaki tıklama y koordinatı (yalnızca tıklama sinyallerinde bulunur). |
| `sel` | `"button#buy-now"` | Yalnızca etiket / id / sınıftan oluşturulan, temizlenmiş CSS seçici — asla metin içeriği değil. 120 karakterle sınırlıdır. |
| `n` | `5` | Sinyal büyüklüğü: bir öfke patlamasındaki (rage) tıklamalar, bir düzeltmedeki (correction) silmeler, bir terk etmedeki (abandonment) etkileşime girilmiş alanlar. |
| `m` | `{ "i": 14 }` | Türe özgü küçük meta veri (ör. ekleme sayısı, son alan seçicisi, kalış süresi ms). 500 karakterle sınırlı, yalnızca yapı — metin değeri yok. |

Sunucu ayrıca tarayıcının asla göndermediği üç duvar saati zaman damgası kaydeder
(hepsi `Date.now()`, milisaniye cinsinden). Hiçbiri herhangi bir kimliğe bağlı
değildir:

| Alan | Nerede | Neden var |
| --- | --- | --- |
| `received_at` | her olayda | Varış zamanı; saklamayı yönlendirir (bir kesim noktasından eski satırları siler). |
| `started_at` | oturumda | Oturumun ilk yığınının geldiği an. |
| `last_seen` | oturumda | Her yığında güncellenir; oturum listesini en yeniden en eskiye sıralar ve eskimiş oturumları budamanıza olanak tanır. |

### NELERİN toplanmadığı

RageClickRadar kasıtlı olarak asla şunları toplamaz, iletmez veya saklamaz:

- **Tuş vuruşları veya içerikleri.** Düzeltme ve terk etme sinyalleri, girdi
  olayı türlerini (ekleme mi silme mi) *sayarak* elde edilir; kodun `event.data`
  veya bir öğenin `.value` değerini okuyan hiçbir yolu yoktur.
- **Alan / form değerleri.** Herhangi bir girdiye yazdığınız hiçbir şey okunmaz
  veya gönderilmez.
- **IP adresleri.** İstemci IP'si yalnızca bellek içi hız sınırlaması için
  kullanılır ve asla günlüğe kaydedilmez veya saklanmaz. Veritabanı şemasında IP
  sütunu yoktur.
- **Kullanıcı aracısı / tarayıcı başlıkları.** Okunmaz, saklanmaz.
- **Çerezler.** Hiçbiri ayarlanmaz. Sekme başına kimlik `sessionStorage`'da
  yaşar.
- **Tam URL'ler.** Yalnızca `location.pathname` — (genellikle token veya arama
  terimleri taşıyan) sorgu dizesi ve parça (fragment) çıkarılır.
- **Duvar saati istemci zamanı.** Olay zaman damgaları sayfa yüklenmesine
  görelidir, bu nedenle ziyaretçinin yerel saati veya saat dilimi hakkında hiçbir
  şey açığa çıkarmaz.
- **Siteler arası veya kalıcı tanımlayıcılar.** Parmak izi çıkarma yoktur; oturum
  kimliği rastgeledir, sekme başınadır ve sekme kapandığında atılır.

### Ziyaretçinin bakış açısından

**Tasarım gereği anonimsiniz.** Hiçbir çerez, hiçbir oturum açma ve hiçbir kalıcı
kimlik yoktur — oturum tanımlayıcısı `sessionStorage`'da yaşar, kişisel anlamı
olmayan rastgele bir dizedir ve sekme kapatıldığı anda kaybolur. Siteyi yeni bir
sekmede yeniden açmak, birbirine bağlanamayan yepyeni bir kimlik üretir. Cihaz
parmak izi çıkarma yoktur ve sizi siteler arasında takip eden hiçbir şey yoktur.
Kaydedilen tek şeyler, *bir etkileşimin nerede gerçekleştiğine* (bir yol, bir
koordinat, bir CSS seçici) ve *ne tür bir sürtünme olduğuna* dair anonim
gerçeklerdir — asla *ne yazdığınız* veya *kim olduğunuz* değil.

Site operatörleri ayrıca herhangi bir öğeye (veya bir kapsayıcıya)
`data-radar-ignore` ekleyerek onu izlemeden tamamen hariç tutabilir.

### Operatörün bakış açısından

RageClickRadar kendi sunucunuzda barındırıldığından, **onu siz barındırırsınız ve
verinin sahibi sizsiniz**. Üçüncü bir tarafa hiçbir şey gönderilmez — sinyaller
sizin toplayıcınıza gider ve sizin SQLite dosyanıza iner. Bu aynı zamanda
sorumlulukların size ait olduğu anlamına gelir:

- **Saklama sizin politikanızdır.** Veriler siz silene kadar kalır. Saklama SQL'i
  ve zamanlama örnekleri için [self-hosting.md](self-hosting.md) belgesine bakın.
- **Erişim denetimi size aittir.** MVP'de kimlik doğrulama yoktur; panoyu bir ters
  proxy, VPN veya izin listesinin arkasında tutun.
- **Bildirim size aittir.** Gizlilik politikanız neyi topladığınızı sıralıyorsa,
  yukarıdaki "ne toplanır" tablosu yansıtılacak doğru listedir.

### GDPR ve e-gizlilik

RageClickRadar, **kişisel veri işlemekten kaçınacak** şekilde bilinçli olarak
tasarlanmıştır: çerez yok (dolayısıyla *bu* araçtan e-Gizlilik Direktifi
kapsamında çerez onayı tetiklenmez), IP saklama yok, parmak izi çıkarma yok ve
yalnızca anonim sekme başına sinyaller var. Amaç, onaya bağlı izlemenin kapsamı
dışında kalan analitiktir.

**Bu, hukuki tavsiye değildir.** Belirli bir dağıtımın onaya veya bildirime
ihtiyaç duyup duymadığı; tüm teknoloji yığınınıza, yargı yetki alanınıza ve
düzenleyicilerin "anonim" ile "takma adlı (pseudonymous)" veriyi nasıl
yorumladığına bağlıdır — ve yorumlar değişkenlik gösterir. RageClickRadar'ı başka
sistemlerle birleştirir, kullanıcıları zaten tanımlayan bir siteye yerleştirir
veya katı bir rejim altında çalıştırırsanız, konuyu nitelikli biriyle gözden
geçirin. RageClickRadar size gizliliği koruyan bir temel sağlar; uygunluk
sonucunu çıkarmak ise size aittir.

### Bu iddialar nasıl doğrulanır

Buradaki her şey kaynak kodda doğrulanabilir:

- **Tel şeması**, [`server/collect.js`](../server/collect.js) içindeki alan beyaz
  listesidir — `normalizeEvent()` ve `handleCollectBody()` yalnızca yukarıda
  tablolanan alanları kabul eder; veritabanı şeması
  [`server/db.js`](../server/db.js) içindedir (ip/ua/başlık sütunu yoktur).
- **Gizlilik iddiaları**, [`test/unit/collect.test.js`](../test/unit/collect.test.js)
  içindeki `privacy: schema has no IP/UA-like columns and meta holds only m`
  testiyle uygulanır. Bu test, şemayı herhangi bir `ip` / `agent` / `ua` /
  `header` sütunu için tarar ve uydurma IP/UA işaretlerini bir yüke sızdırır,
  ardından hiçbirinin saklanan herhangi bir değere ulaşmadığını doğrular.
- **"Hiçbir metin okunmaz" özelliği**, izleyici kaynağında görünür
  ([`tracker/src/radar.js`](../tracker/src/radar.js) ve
  [`tracker/src/detectors.js`](../tracker/src/detectors.js)): yalnızca
  `event.inputType` sınıflandırılır — `event.data` ve `element.value` değerlerine
  asla dokunulmaz.

Testleri kendiniz `npm test` ile çalıştırın.

---

## 中文

[English](#privacy-statement) · [Türkçe](#türkçe) · **中文** · [Русский](#русский) · [العربية](#العربية) · [日本語](#日本語)

RageClickRadar 旨在衡量*挫败感*，而非*人*。它在浏览器内计算行为信号，只向收集器发送匿名结论。您输入的任何文本、任何字段值、任何 IP 地址、任何用户代理（user agent），以及任何跨站标识符，都绝不会被传输或存储。本文档从访问者和运营者两个角度，准确说明哪些内容会被收集、哪些不会。

### 确切收集了哪些内容

跟踪器发送的每一批（batch）数据都是一个小型 JSON 信封加上一个事件列表。这就是**完整**的传输格式（wire schema）——收集器接受的每一个字段都在此列出；载荷（payload）中的其他任何内容都会在存储之前于服务器端被丢弃。

#### 信封

| 字段 | 示例 | 存在的原因 |
| --- | --- | --- |
| `v` | `1` | 传输格式版本（必须为 `1`）。 |
| `sid` | `"s_9f3a2b8c1d0e"` | 每个标签页的会话 id，随机生成，来自 `sessionStorage`。不是 cookie；标签页关闭时即消失。 |
| `page` | `"/pricing"` | 仅 `location.pathname`——查询字符串和哈希（hash）在客户端被剥离，并在服务器端再次剥离。 |
| `vw` | `1280` | 视口宽度（px），用于按屏幕尺寸对热图分桶。 |
| `vh` | `720` | 视口高度（px）。 |
| `dw` | `1280` | 文档宽度（px），用于在页面上定位坐标。 |
| `dh` | `3400` | 文档高度（px）。 |
| `events` | `[ … ]` | 挫败信号数组（见下）。 |

#### 事件

| 字段 | 示例 | 存在的原因 |
| --- | --- | --- |
| `t` | `"rage"` | 信号类型：`rage`、`dead`、`formaband` 或 `correction`。 |
| `ts` | `4210` | **自页面加载以来**的毫秒数——一个相对偏移量，绝非挂钟时间。 |
| `x` | `512.0` | 页面上的点击 x 坐标（仅点击类信号存在）。 |
| `y` | `1180.0` | 页面上的点击 y 坐标（仅点击类信号存在）。 |
| `sel` | `"button#buy-now"` | 仅由标签／id／类构建的经过净化的 CSS 选择器——绝不包含文本内容。上限 120 个字符。 |
| `n` | `5` | 信号强度：一次愤怒连击（rage）中的点击次数、一次纠正（correction）中的删除次数、一次表单放弃（abandonment）中已交互的字段数。 |
| `m` | `{ "i": 14 }` | 微小的类型专属元数据（例如插入次数、最后字段选择器、停留毫秒数）。上限 500 个字符，仅结构——无文本值。 |

服务器还会记录三个浏览器从不发送的挂钟时间戳（均为 `Date.now()`，以毫秒计）。它们都不与任何身份关联：

| 字段 | 位置 | 存在的原因 |
| --- | --- | --- |
| `received_at` | 每个事件上 | 到达时间；驱动数据保留（删除早于某截止时间的行）。 |
| `started_at` | 会话上 | 该会话第一批数据到达的时刻。 |
| `last_seen` | 会话上 | 每一批数据都会更新；用于将会话列表按从新到旧排序，并让您可以清理陈旧的会话。 |

### 哪些内容不会被收集

RageClickRadar 有意从不收集、传输或存储：

- **按键或其内容。** 纠正与放弃信号是通过*计数*输入事件类型（插入还是删除）得出的；代码中没有任何读取 `event.data` 或元素 `.value` 的路径。
- **字段／表单值。** 您输入到任何输入框中的内容都不会被读取或发送。
- **IP 地址。** 客户端 IP 仅用于内存中的限流，绝不会被记录或存储。数据库模式中没有 IP 列。
- **用户代理／浏览器标头。** 不读取，不存储。
- **Cookie。** 不设置任何 cookie。每个标签页的 id 存放在 `sessionStorage` 中。
- **完整 URL。** 仅 `location.pathname`——查询字符串和片段（fragment，常常携带令牌或搜索词）会被剥离。
- **挂钟客户端时间。** 事件时间戳是相对于页面加载的，因此不会透露访问者的本地时间或时区的任何信息。
- **跨站或持久标识符。** 无指纹识别；会话 id 是随机的、每个标签页独立的，并在标签页关闭时被丢弃。

### 从访问者的角度

**您在设计上即为匿名。** 没有 cookie、没有登录，也没有持久 id——会话标识符存放在 `sessionStorage` 中，是一个没有个人含义的随机字符串，并在标签页关闭的瞬间消失。在新标签页中重新打开该网站会生成一个全新的、无法关联的 id。没有设备指纹识别，也没有任何东西会跨站点跟随您。唯一被记录的，是关于*交互发生在何处*（一个路径、一个坐标、一个 CSS 选择器）以及*属于哪种摩擦*的匿名事实——绝不包括*您写了什么*或*您是谁*。

网站运营者还可以在任何元素（或容器）上添加 `data-radar-ignore`，将其完全排除在跟踪之外。

### 从运营者的角度

由于 RageClickRadar 是自托管的，**由您托管，数据也归您所有**。不会向任何第三方发送任何内容——信号进入您的收集器，并落入您的 SQLite 文件。这也意味着相应的责任由您承担：

- **数据保留由您的策略决定。** 数据会一直保留，直到您删除它。保留 SQL 和调度示例见 [self-hosting.md](self-hosting.md)。
- **访问控制由您负责。** MVP 没有身份验证；请将仪表板置于反向代理、VPN 或允许列表之后。
- **披露由您负责。** 如果您的隐私政策列举了您所收集的内容，上面的“收集哪些内容”表格就是可供参照的准确清单。

### GDPR 与电子隐私

RageClickRadar 有意设计为**避免处理个人数据**：无 cookie（因此*此*工具不会触发《电子隐私指令》下的 cookie 同意要求）、不保留 IP、无指纹识别，且仅有匿名的、每个标签页独立的信号。目标是使分析落在须经同意的跟踪范围之外。

**这不构成法律意见。** 某一具体部署是否需要同意或告知，取决于您的整个技术栈、您所在的司法管辖区，以及监管机构如何解释“匿名”数据与“假名化（pseudonymous）”数据——而各种解释不尽相同。如果您将 RageClickRadar 与其他系统结合、将其嵌入一个已经识别用户身份的网站，或在严格的监管制度下运营，请与具备资质的人士一同审查。RageClickRadar 为您提供一个保护隐私的基础；合规性的结论则须由您自行作出。

### 如何验证这些声明

这里的一切都可以在源代码中核实：

- **传输格式**就是 [`server/collect.js`](../server/collect.js) 中的字段白名单——`normalizeEvent()` 和 `handleCollectBody()` 只接受上表所列的字段；数据库模式位于 [`server/db.js`](../server/db.js)（没有 ip/ua/标头列）。
- **隐私断言**由 [`test/unit/collect.test.js`](../test/unit/collect.test.js) 中的测试 `privacy: schema has no IP/UA-like columns and meta holds only m` 强制保证。它扫描模式以查找任何 `ip` / `agent` / `ua` / `header` 列，并将伪造的 IP/UA 标记偷偷放入载荷，然后断言它们无一到达任何存储值。
- **“不读取任何文本”这一特性**在跟踪器源代码中可见（[`tracker/src/radar.js`](../tracker/src/radar.js) 与 [`tracker/src/detectors.js`](../tracker/src/detectors.js)）：只有 `event.inputType` 会被分类——`event.data` 和 `element.value` 绝不会被触碰。

您可以自己用 `npm test` 运行测试。

---

## Русский

[English](#privacy-statement) · [Türkçe](#türkçe) · [中文](#中文) · **Русский** · [العربية](#العربية) · [日本語](#日本語)

RageClickRadar создан, чтобы измерять *раздражение*, а не *людей*. Он вычисляет
поведенческие сигналы внутри браузера и отправляет сборщику только анонимные
выводы. Никакой введённый вами текст, никакие значения полей, никакой IP-адрес,
никакой user agent и никакой межсайтовый идентификатор никогда не передаются и не
сохраняются. Этот документ точно описывает, что собирается, а что нет, — с точки
зрения как посетителя, так и оператора.

### Что именно собирается

Каждая партия (batch), отправляемая трекером, — это небольшой JSON-конверт плюс
список событий. Это **полная** схема передачи (wire schema): здесь перечислено
каждое поле, которое принимает сборщик; всё остальное в полезной нагрузке
(payload) отбрасывается на сервере до сохранения.

#### Конверт

| Поле | Пример | Зачем оно нужно |
| --- | --- | --- |
| `v` | `1` | Версия формата передачи (должна быть `1`). |
| `sid` | `"s_9f3a2b8c1d0e"` | Идентификатор сессии на вкладку, случайный, из `sessionStorage`. Не cookie; исчезает при закрытии вкладки. |
| `page` | `"/pricing"` | Только `location.pathname` — строка запроса и хеш убираются на стороне клиента и ещё раз на сервере. |
| `vw` | `1280` | Ширина области просмотра (px), чтобы группировать тепловые карты по размеру экрана. |
| `vh` | `720` | Высота области просмотра (px). |
| `dw` | `1280` | Ширина документа (px), чтобы размещать координаты на странице. |
| `dh` | `3400` | Высота документа (px). |
| `events` | `[ … ]` | Массив сигналов раздражения (ниже). |

#### Событие

| Поле | Пример | Зачем оно нужно |
| --- | --- | --- |
| `t` | `"rage"` | Тип сигнала: `rage`, `dead`, `formaband` или `correction`. |
| `ts` | `4210` | Миллисекунды **с момента загрузки страницы** — относительное смещение, никогда не астрономическое (настенное) время. |
| `x` | `512.0` | Координата x клика на странице (присутствует только для сигналов кликов). |
| `y` | `1180.0` | Координата y клика на странице (присутствует только для сигналов кликов). |
| `sel` | `"button#buy-now"` | Очищенный CSS-селектор, построенный только из тега / id / класса — никогда из текстового содержимого. Ограничен 120 символами. |
| `n` | `5` | Величина сигнала: клики в приступе ярости (rage), удаления в исправлении (correction), поля, с которыми взаимодействовали, при отказе от формы (abandonment). |
| `m` | `{ "i": 14 }` | Крошечные метаданные, специфичные для типа (напр. число вставок, селектор последнего поля, время задержки в мс). Ограничены 500 символами, только структура — без текстовых значений. |

Сервер также записывает три астрономических (настенных) отметки времени, которые
браузер никогда не отправляет (все — `Date.now()`, в миллисекундах). Ни одна не
привязана к какой-либо личности:

| Поле | Где | Зачем оно нужно |
| --- | --- | --- |
| `received_at` | на каждом событии | Время поступления; управляет сроком хранения (удаляет строки старше порога). |
| `started_at` | на сессии | Когда пришла первая партия сессии. |
| `last_seen` | на сессии | Обновляется при каждой партии; упорядочивает список сессий от новых к старым и позволяет удалять устаревшие сессии. |

### Что НЕ собирается

RageClickRadar намеренно никогда не собирает, не передаёт и не сохраняет:

- **Нажатия клавиш или их содержимое.** Сигналы исправления и отказа выводятся
  путём *подсчёта* типов входных событий (вставка или удаление); в коде нет пути,
  который читал бы `event.data` или `.value` элемента.
- **Значения полей / форм.** Ничто из введённого вами в любое поле ввода не
  читается и не отправляется.
- **IP-адреса.** IP клиента используется только для ограничения частоты запросов
  в памяти и никогда не логируется и не сохраняется. В схеме базы данных нет
  столбца для IP.
- **User agent / заголовки браузера.** Не читаются, не сохраняются.
- **Cookie.** Не устанавливаются. Идентификатор на вкладку живёт в
  `sessionStorage`.
- **Полные URL.** Только `location.pathname` — строка запроса и фрагмент (которые
  часто несут токены или поисковые запросы) убираются.
- **Астрономическое (настенное) время клиента.** Отметки времени событий
  отсчитываются от загрузки страницы, поэтому не раскрывают ничего о местном
  времени или часовом поясе посетителя.
- **Межсайтовые или постоянные идентификаторы.** Никакого фингерпринтинга;
  идентификатор сессии случайный, на вкладку, и отбрасывается при закрытии
  вкладки.

### С точки зрения посетителя

**Вы анонимны по замыслу.** Нет ни cookie, ни входа в систему, ни постоянного id
— идентификатор сессии живёт в `sessionStorage`, представляет собой случайную
строку без личного смысла и исчезает в тот момент, когда вкладка закрывается.
Повторное открытие сайта в новой вкладке порождает новый, несвязываемый id. Нет
ни снятия отпечатка устройства, ни чего-либо, что следовало бы за вами между
сайтами. Записываются лишь анонимные факты о том, *где произошло взаимодействие*
(путь, координата, CSS-селектор) и *какого рода это было затруднение*, — но
никогда *что вы написали* или *кто вы такой*.

Операторы сайта также могут добавить `data-radar-ignore` к любому элементу (или
контейнеру), чтобы полностью исключить его из отслеживания.

### С точки зрения оператора

Поскольку RageClickRadar размещается на собственном сервере, **вы его размещаете
и вы владеете данными**. Ничто не отправляется третьей стороне — сигналы идут в
ваш сборщик и попадают в ваш файл SQLite. Это также означает, что ответственность
лежит на вас:

- **Хранение — ваша политика.** Данные остаются, пока вы их не удалите. См. SQL
  для хранения и примеры планирования в [self-hosting.md](self-hosting.md).
- **Контроль доступа — ваш.** В MVP нет аутентификации; держите панель за обратным
  прокси, VPN или списком разрешений.
- **Раскрытие — ваше.** Если ваша политика конфиденциальности перечисляет, что вы
  собираете, приведённая выше таблица «что собирается» — это точный список,
  который следует воспроизвести.

### GDPR и e-privacy

RageClickRadar намеренно спроектирован так, чтобы **избегать обработки
персональных данных**: нет cookie (поэтому *этот* инструмент не запускает
требование о согласии на cookie по Директиве о конфиденциальности в электронных
коммуникациях), нет хранения IP, нет фингерпринтинга и только анонимные сигналы
на вкладку. Цель — аналитика, которая выходит за рамки отслеживания, требующего
согласия.

**Это не юридическая консультация.** Требуется ли для конкретного развёртывания
согласие или уведомление, зависит от всего вашего стека, вашей юрисдикции и того,
как регуляторы толкуют «анонимные» данные в противоположность «псевдонимным», — а
толкования расходятся. Если вы объединяете RageClickRadar с другими системами,
встраиваете его в сайт, который уже идентифицирует пользователей, или работаете в
условиях строгого режима, проверьте это с кем-то, имеющим соответствующую
квалификацию. RageClickRadar даёт вам основу, сохраняющую конфиденциальность;
вывод о соответствии требованиям остаётся за вами.

### Как проверить эти утверждения

Всё изложенное можно проверить в исходном коде:

- **Схема передачи** — это белый список полей в
  [`server/collect.js`](../server/collect.js): `normalizeEvent()` и
  `handleCollectBody()` принимают только поля, перечисленные в таблицах выше;
  схема базы данных находится в [`server/db.js`](../server/db.js) (нет столбцов
  ip/ua/заголовков).
- **Утверждения о конфиденциальности** обеспечиваются тестом
  `privacy: schema has no IP/UA-like columns and meta holds only m` в
  [`test/unit/collect.test.js`](../test/unit/collect.test.js). Он сканирует схему
  на наличие любого столбца `ip` / `agent` / `ua` / `header` и подсовывает
  сфабрикованные маркеры IP/UA в полезную нагрузку, а затем утверждает, что ни
  один из них не достигает какого-либо сохранённого значения.
- **Свойство «никакой текст не читается»** видно в исходном коде трекера
  ([`tracker/src/radar.js`](../tracker/src/radar.js) и
  [`tracker/src/detectors.js`](../tracker/src/detectors.js)): классифицируется
  только `event.inputType` — `event.data` и `element.value` никогда не
  затрагиваются.

Запустите тесты сами командой `npm test`.

---

## العربية

[English](#privacy-statement) · [Türkçe](#türkçe) · [中文](#中文) · [Русский](#русский) · **العربية** · [日本語](#日本語)

صُمِّم RageClickRadar لقياس *الإحباط*، لا *الأشخاص*. فهو يحسب الإشارات السلوكية
داخل المتصفِّح ولا يرسل إلى المجمِّع سوى استنتاجات مجهولة الهوية. لا يُنقَل أو
يُخزَّن على الإطلاق أي نص تكتبه، ولا أي قيم للحقول، ولا أي عنوان IP، ولا أي user
agent، ولا أي معرِّف عابر للمواقع. تصف هذه الوثيقة بدقة ما يُجمَع وما لا يُجمَع، من
منظور الزائر والمشغِّل معًا.

### ما الذي يُجمَع بالضبط

كل دفعة (batch) يرسلها المتتبِّع هي مغلَّف JSON صغير مع قائمة من الأحداث. هذا هو
مخطط النقل (wire schema) **الكامل** — كل حقل يقبله المجمِّع مذكور هنا؛ وأي شيء آخر
في الحمولة (payload) يُسقَط على الخادم قبل التخزين.

#### المغلَّف

| الحقل | مثال | سبب وجوده |
| --- | --- | --- |
| `v` | `1` | إصدار صيغة النقل (يجب أن يكون `1`). |
| `sid` | `"s_9f3a2b8c1d0e"` | معرِّف جلسة لكل علامة تبويب، عشوائي، من `sessionStorage`. ليس كوكيًّا؛ يزول عند إغلاق علامة التبويب. |
| `page` | `"/pricing"` | فقط `location.pathname` — تُزال سلسلة الاستعلام والتجزئة (hash) في جانب العميل ومرة أخرى على الخادم. |
| `vw` | `1280` | عرض إطار العرض (px)، لتجميع الخرائط الحرارية حسب حجم الشاشة. |
| `vh` | `720` | ارتفاع إطار العرض (px). |
| `dw` | `1280` | عرض المستند (px)، لوضع الإحداثيات على الصفحة. |
| `dh` | `3400` | ارتفاع المستند (px). |
| `events` | `[ … ]` | مصفوفة إشارات الإحباط (أدناه). |

#### الحدث

| الحقل | مثال | سبب وجوده |
| --- | --- | --- |
| `t` | `"rage"` | نوع الإشارة: `rage` أو `dead` أو `formaband` أو `correction`. |
| `ts` | `4210` | مِلي ثانية **منذ تحميل الصفحة** — إزاحة نسبية، وليست أبدًا وقت ساعة الحائط. |
| `x` | `512.0` | إحداثي x للنقر على الصفحة (موجود لإشارات النقر فقط). |
| `y` | `1180.0` | إحداثي y للنقر على الصفحة (موجود لإشارات النقر فقط). |
| `sel` | `"button#buy-now"` | مُحدِّد CSS منقّى مبني من الوسم / id / الصنف فقط — وليس من المحتوى النصي أبدًا. محدود بـ 120 حرفًا. |
| `n` | `5` | مقدار الإشارة: النقرات في نوبة الغضب (rage)، وعمليات الحذف في التصحيح (correction)، والحقول التي جرى التفاعل معها في هجر النموذج (abandonment). |
| `m` | `{ "i": 14 }` | بيانات وصفية صغيرة خاصة بالنوع (مثل عدد الإدراجات، ومُحدِّد الحقل الأخير، ومدة المكوث بالمِلي ثانية). محدودة بـ 500 حرف، البنية فقط — دون قيم نصية. |

يسجِّل الخادم أيضًا ثلاث طوابع زمنية لساعة الحائط لا يرسلها المتصفِّح أبدًا (جميعها
`Date.now()`، بالمِلي ثانية). ولا يرتبط أيٌّ منها بأي هوية:

| الحقل | المكان | سبب وجوده |
| --- | --- | --- |
| `received_at` | على كل حدث | وقت الوصول؛ يقود سياسة الاحتفاظ (حذف الصفوف الأقدم من حدٍّ فاصل). |
| `started_at` | على الجلسة | وقت وصول أول دفعة للجلسة. |
| `last_seen` | على الجلسة | يُحدَّث مع كل دفعة؛ يرتِّب قائمة الجلسات من الأحدث إلى الأقدم ويتيح لك تشذيب الجلسات القديمة. |

### ما الذي لا يُجمَع

يمتنع RageClickRadar عمدًا عن جمع أو نقل أو تخزين أيٍّ مما يلي على الإطلاق:

- **ضغطات المفاتيح أو محتوياتها.** تُشتَق إشارتا التصحيح والهجر من *عدّ* أنواع
  أحداث الإدخال (إدراج مقابل حذف)؛ ولا يوجد في الكود أي مسار يقرأ `event.data` أو
  `.value` الخاص بعنصر.
- **قيم الحقول / النماذج.** لا يُقرأ أو يُرسَل أي شيء تكتبه في أي حقل إدخال.
- **عناوين IP.** يُستخدَم عنوان IP الخاص بالعميل فقط لتحديد معدّل الطلبات في
  الذاكرة، ولا يُسجَّل أو يُخزَّن أبدًا. ولا يحتوي مخطط قاعدة البيانات على عمود
  لعنوان IP.
- **User agent / ترويسات المتصفِّح.** لا تُقرأ ولا تُخزَّن.
- **الكوكيز.** لا يُضبَط أيٌّ منها. ويعيش معرِّف كل علامة تبويب في `sessionStorage`.
- **عناوين URL الكاملة.** فقط `location.pathname` — وتُزال سلسلة الاستعلام والجزء
  (fragment) (اللذان كثيرًا ما يحملان رموزًا مميزة أو عبارات بحث).
- **وقت العميل بحسب ساعة الحائط.** طوابع الأحداث الزمنية نسبية إلى تحميل الصفحة،
  فلا تكشف شيئًا عن الوقت المحلي للزائر أو منطقته الزمنية.
- **المعرِّفات العابرة للمواقع أو الدائمة.** لا بصمة رقمية؛ فمعرِّف الجلسة عشوائي،
  لكل علامة تبويب، ويُلقى عند إغلاق علامة التبويب.

### من منظور الزائر

**أنت مجهول الهوية بحكم التصميم.** لا يوجد كوكي، ولا تسجيل دخول، ولا معرِّف دائم —
فمعرِّف الجلسة يعيش في `sessionStorage`، وهو سلسلة عشوائية بلا معنى شخصي، ويختفي
لحظة إغلاق علامة التبويب. وإعادة فتح الموقع في علامة تبويب جديدة تُنتج معرِّفًا
جديدًا لا يمكن ربطه بغيره. ولا توجد بصمة للجهاز ولا أي شيء يتبعك بين المواقع.
والأشياء الوحيدة التي تُسجَّل هي حقائق مجهولة الهوية عن *أين حدث التفاعل* (مسار،
إحداثي، مُحدِّد CSS) و*أي نوع من الاحتكاك كان* — وليس أبدًا *ما الذي كتبته* أو *من
أنت*.

يمكن لمشغِّلي الموقع أيضًا إضافة `data-radar-ignore` إلى أي عنصر (أو حاوية)
لاستبعاده من التتبّع تمامًا.

### من منظور المشغِّل

لأن RageClickRadar مستضاف ذاتيًّا، **فأنت من يستضيفه وأنت من يملك البيانات**. ولا
يُرسَل أي شيء إلى طرف ثالث — فالإشارات تذهب إلى مجمِّعك وتستقر في ملف SQLite الخاص
بك. وهذا يعني أيضًا أن المسؤوليات تقع على عاتقك:

- **الاحتفاظ سياستك أنت.** تبقى البيانات حتى تحذفها. راجع SQL الاحتفاظ وأمثلة
  الجدولة في [self-hosting.md](self-hosting.md).
- **التحكّم في الوصول مسؤوليتك.** لا يوجد في الـ MVP أي مصادقة؛ فأبقِ لوحة المعلومات
  خلف وكيل عكسي أو VPN أو قائمة سماح.
- **الإفصاح مسؤوليتك.** إذا كانت سياسة الخصوصية لديك تُعدِّد ما تجمعه، فإن جدول «ما
  الذي يُجمَع» أعلاه هو القائمة الدقيقة التي ينبغي محاكاتها.

### اللائحة العامة لحماية البيانات (GDPR) والخصوصية الإلكترونية

صُمِّم RageClickRadar عن قصد بحيث **يتجنّب معالجة البيانات الشخصية**: لا كوكيز
(وبالتالي لا يُطلِق *هذه* الأداة أي اشتراط لموافقة الكوكيز بموجب توجيه الخصوصية
الإلكترونية)، ولا احتفاظ بعناوين IP، ولا بصمة رقمية، وليست هناك سوى إشارات مجهولة
الهوية لكل علامة تبويب. والهدف هو تحليلات تقع خارج نطاق التتبّع المشروط بالموافقة.

**هذه ليست استشارة قانونية.** إن كون نشرٍ بعينه يحتاج إلى موافقة أو إشعار يعتمد على
مجمل حزمتك التقنية، وعلى ولايتك القضائية، وعلى كيفية تفسير الجهات المنظِّمة للبيانات
«المجهولة الهوية» مقابل «المستعارة الهوية (pseudonymous)» — والتفسيرات متباينة.
وإذا دمجت RageClickRadar مع أنظمة أخرى، أو ضمّنته في موقع يُعرِّف المستخدمين
بالفعل، أو شغّلته في ظل نظام صارم، فراجِعه مع شخص مؤهَّل. يمنحك RageClickRadar
أساسًا حافظًا للخصوصية؛ أما استنتاج الامتثال فهو من شأنك أنت.

### كيف تتحقّق من هذه الادعاءات

كل ما هنا قابل للتحقّق في الكود المصدري:

- **مخطط النقل** هو القائمة البيضاء للحقول في
  [`server/collect.js`](../server/collect.js) — إذ لا تقبل `normalizeEvent()`
  و`handleCollectBody()` سوى الحقول المجدولة أعلاه؛ ومخطط قاعدة البيانات في
  [`server/db.js`](../server/db.js) (بلا أعمدة ip/ua/ترويسات).
- **تأكيدات الخصوصية** يفرضها الاختبار
  `privacy: schema has no IP/UA-like columns and meta holds only m` في
  [`test/unit/collect.test.js`](../test/unit/collect.test.js). فهو يمسح المخطط
  بحثًا عن أي عمود `ip` / `agent` / `ua` / `header`، ويهرِّب علامات IP/UA مُلفّقة
  إلى داخل حمولة، ثم يؤكّد أن أيًّا منها لا يصل إلى أي قيمة مخزَّنة.
- **خاصية «عدم قراءة أي نص»** ظاهرة في مصدر المتتبِّع
  ([`tracker/src/radar.js`](../tracker/src/radar.js)
  و[`tracker/src/detectors.js`](../tracker/src/detectors.js)): إذ لا يُصنَّف سوى
  `event.inputType` — أما `event.data` و`element.value` فلا يُمسّان أبدًا.

شغِّل الاختبارات بنفسك عبر `npm test`.

---

## 日本語

[English](#privacy-statement) · [Türkçe](#türkçe) · [中文](#中文) · [Русский](#русский) · [العربية](#العربية) · **日本語**

RageClickRadar は、*人*ではなく*フラストレーション*を測定するために作られています。ブラウザー内で行動シグナルを計算し、コレクターには匿名の結論のみを送信します。あなたが入力したテキスト、フィールドの値、IP アドレス、user agent、そしてサイト横断的な識別子は、いっさい送信も保存もされません。本書では、訪問者と運用者の双方の視点から、何が収集され何が収集されないのかを正確に説明します。

### 正確に何が収集されるのか

トラッカーが送信する各バッチ（batch）は、小さな JSON エンベロープと一連のイベントで構成されます。これが**すべて**の転送スキーマ（wire schema）です。コレクターが受け付けるフィールドはここに列挙されたものがすべてであり、ペイロード（payload）内のそれ以外のものは保存前にサーバー側で破棄されます。

#### エンベロープ

| フィールド | 例 | 存在理由 |
| --- | --- | --- |
| `v` | `1` | 転送フォーマットのバージョン（`1` でなければならない）。 |
| `sid` | `"s_9f3a2b8c1d0e"` | タブごとのセッション id。ランダムで、`sessionStorage` から取得。Cookie ではなく、タブを閉じると消える。 |
| `page` | `"/pricing"` | `location.pathname` のみ。クエリ文字列とハッシュはクライアント側で除去され、サーバー側でも再度除去される。 |
| `vw` | `1280` | ビューポート幅（px）。ヒートマップを画面サイズごとに分類するため。 |
| `vh` | `720` | ビューポート高さ（px）。 |
| `dw` | `1280` | ドキュメント幅（px）。ページ上に座標を配置するため。 |
| `dh` | `3400` | ドキュメント高さ（px）。 |
| `events` | `[ … ]` | フラストレーションシグナルの配列（下記）。 |

#### イベント

| フィールド | 例 | 存在理由 |
| --- | --- | --- |
| `t` | `"rage"` | シグナル種別：`rage`、`dead`、`formaband`、または `correction`。 |
| `ts` | `4210` | **ページ読み込みからの**ミリ秒。相対的なオフセットであり、実時間（壁時計時刻）ではない。 |
| `x` | `512.0` | ページ上のクリック x 座標（クリック系シグナルのみに存在）。 |
| `y` | `1180.0` | ページ上のクリック y 座標（クリック系シグナルのみに存在）。 |
| `sel` | `"button#buy-now"` | タグ／id／クラスのみから構築された、サニタイズ済みの CSS セレクター。テキスト内容はいっさい含まない。最大 120 文字。 |
| `n` | `5` | シグナルの大きさ：怒りの連打（rage）でのクリック数、修正（correction）での削除数、フォーム離脱（abandonment）で操作されたフィールド数。 |
| `m` | `{ "i": 14 }` | 種別固有のごく小さなメタデータ（例：挿入回数、最後のフィールドのセレクター、滞留ミリ秒）。最大 500 文字、構造のみでテキスト値は含まない。 |

サーバーはさらに、ブラウザーがけっして送信しない 3 つの実時間（壁時計）タイムスタンプを記録します（いずれも `Date.now()`、ミリ秒単位）。いずれもいかなる身元とも結び付けられていません：

| フィールド | 場所 | 存在理由 |
| --- | --- | --- |
| `received_at` | 各イベント上 | 到着時刻。保持期間を制御する（カットオフより古い行を削除）。 |
| `started_at` | セッション上 | そのセッションの最初のバッチが到着した時刻。 |
| `last_seen` | セッション上 | バッチごとに更新される。セッション一覧を新しい順に並べ、古くなったセッションを整理できるようにする。 |

### 収集され「ない」もの

RageClickRadar は、意図的に以下を決して収集・送信・保存しません：

- **キー入力またはその内容。** 修正・離脱シグナルは、入力イベントの種別（挿入か削除か）を*数える*ことで導出されます。コードには `event.data` や要素の `.value` を読み取る経路が存在しません。
- **フィールド／フォームの値。** どの入力欄に入力した内容も、読み取られることも送信されることもありません。
- **IP アドレス。** クライアントの IP はメモリ内のレート制限にのみ使用され、けっしてログ記録も保存もされません。データベーススキーマに IP 列はありません。
- **User agent／ブラウザーのヘッダー。** 読み取りも保存もされません。
- **Cookie。** いっさい設定されません。タブごとの id は `sessionStorage` に存在します。
- **完全な URL。** `location.pathname` のみ。（しばしばトークンや検索語を含む）クエリ文字列とフラグメント（fragment）は除去されます。
- **クライアントの実時間（壁時計時刻）。** イベントのタイムスタンプはページ読み込みからの相対値であり、訪問者の現地時刻やタイムゾーンについて何も明かしません。
- **サイト横断的または永続的な識別子。** フィンガープリンティングはありません。セッション id はランダムでタブごとであり、タブを閉じると破棄されます。

### 訪問者の視点から

**あなたは設計上、匿名です。** Cookie もログインも永続的な id もありません。セッション識別子は `sessionStorage` に存在し、個人的な意味を持たないランダムな文字列であり、タブを閉じた瞬間に消えます。新しいタブでサイトを開き直すと、結び付けることのできない新たな id が生成されます。デバイスのフィンガープリンティングはなく、サイト間であなたを追跡するものもありません。記録されるのは、*どこで操作が起きたか*（パス、座標、CSS セレクター）と*どの種類の摩擦だったか*についての匿名の事実だけであり、*あなたが何を書いたか*や*あなたが誰か*はけっして記録されません。

サイト運用者は、任意の要素（またはコンテナ）に `data-radar-ignore` を追加して、それを追跡から完全に除外することもできます。

### 運用者の視点から

RageClickRadar はセルフホストであるため、**あなたがホストし、あなたがデータを所有します**。第三者には何も送信されません。シグナルはあなたのコレクターへ送られ、あなたの SQLite ファイルに格納されます。それはまた、責任があなたにあることを意味します：

- **保持はあなたのポリシーです。** データは削除するまで残ります。保持用の SQL とスケジューリングの例は [self-hosting.md](self-hosting.md) を参照してください。
- **アクセス制御はあなたの責任です。** MVP には認証がありません。ダッシュボードはリバースプロキシ、VPN、または許可リストの背後に置いてください。
- **開示はあなたの責任です。** プライバシーポリシーで収集内容を列挙する場合、上記の「何が収集されるのか」の表が、そのまま反映すべき正確な一覧です。

### GDPR と e プライバシー

RageClickRadar は、**個人データの処理を避ける**よう意図的に設計されています。Cookie なし（したがって*本*ツールが e プライバシー指令に基づく Cookie 同意を発生させることはありません）、IP の保持なし、フィンガープリンティングなし、そしてタブごとの匿名シグナルのみです。目標は、同意を要する追跡の範囲外に収まる分析です。

**これは法的助言ではありません。** ある特定の導入に同意や通知が必要かどうかは、あなたのスタック全体、あなたの法域、そして規制当局が「匿名」データと「仮名（pseudonymous）」データをどう解釈するかによって決まり、解釈は一様ではありません。RageClickRadar を他のシステムと組み合わせる場合、すでにユーザーを識別しているサイトに埋め込む場合、または厳格な規制下で運用する場合は、有資格者とともに確認してください。RageClickRadar はプライバシーを保護する基盤を提供します。コンプライアンス上の結論を下すのは、あなた自身です。

### これらの主張を検証する方法

ここに書かれていることはすべて、ソースコードで確認できます：

- **転送スキーマ**は [`server/collect.js`](../server/collect.js) 内のフィールドのホワイトリストです。`normalizeEvent()` と `handleCollectBody()` は上表のフィールドのみを受け付けます。データベーススキーマは [`server/db.js`](../server/db.js) にあります（ip/ua/ヘッダー列はありません）。
- **プライバシーに関する主張**は、[`test/unit/collect.test.js`](../test/unit/collect.test.js) 内のテスト `privacy: schema has no IP/UA-like columns and meta holds only m` によって保証されます。このテストはスキーマを走査して `ip` / `agent` / `ua` / `header` の各列を探し、捏造した IP/UA マーカーをペイロードに紛れ込ませたうえで、それらのいずれも保存値に到達しないことを表明します。
- **「テキストはいっさい読み取らない」という性質**は、トラッカーのソース（[`tracker/src/radar.js`](../tracker/src/radar.js) と [`tracker/src/detectors.js`](../tracker/src/detectors.js)）で確認できます。分類されるのは `event.inputType` のみで、`event.data` と `element.value` はけっして触れられません。

テストはご自身で `npm test` を実行して確かめてください。
