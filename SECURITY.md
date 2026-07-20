# Security Policy

**English** · [Türkçe](#türkçe) · [中文](#中文) · [Русский](#русский) · [العربية](#العربية) · [日本語](#日本語)

## Supported versions

RageClickRadar is pre-1.0. Security fixes land on the latest `0.x` release; there
are no back-ported patches for older versions. Please make sure you are on the
most recent release before reporting.

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue.

Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**
(https://github.com/IACBI/rageclickradar/security/advisories/new). This opens a
private advisory visible only to you and the maintainers.

Please do **not** open a public issue, discussion, or pull request for a
suspected vulnerability until it has been addressed.

We aim to acknowledge a valid report within **7 days** and will keep you updated
as we investigate and prepare a fix. When a fix ships we are happy to credit you
in the advisory unless you prefer to remain anonymous.

## Scope note

RageClickRadar's collector (`/api/collect`) is **designed to be publicly
reachable without authentication** — it must accept anonymous beacons from any
page you instrument. As a result, anyone who can reach your instance can post
synthetic signals into *your own* database. This data-injection surface is **by
design**, not a vulnerability: the endpoint is validate-only and write-only,
accepts a strict anonymous whitelist, stores no IP/user-agent/PII, and is rate
limited. See [docs/self-hosting.md](docs/self-hosting.md) for the collector's
security model, the rate-limit behavior behind a reverse proxy, and how to keep
the dashboard (which has no built-in auth) private.

Reports that amount to "I can send data to the open collector" are expected
behavior and out of scope. Reports of the collector storing PII, of a way to read
another origin's data through the read endpoints, of injection/RCE, or of a way
to bypass the field whitelist are very much in scope.

---

## Türkçe

[English](#security-policy) · **Türkçe** · [中文](#中文) · [Русский](#русский) · [العربية](#العربية) · [日本語](#日本語)

### Desteklenen sürümler

RageClickRadar 1.0 öncesidir. Güvenlik düzeltmeleri en son `0.x` sürümüne iner;
eski sürümler için geriye dönük yama yoktur. Lütfen bildirim yapmadan önce en
güncel sürümde olduğunuzdan emin olun.

### Bir güvenlik açığını bildirme

Lütfen güvenlik sorunlarını **gizli** olarak bildirin, herkese açık bir issue'da
değil.

Bu depoda GitHub'ın gizli güvenlik açığı bildirimini kullanın:
**Security → Report a vulnerability**
(https://github.com/IACBI/rageclickradar/security/advisories/new). Bu, yalnızca
size ve bakımcılara görünür özel bir advisory açar.

Ele alınana kadar, şüpheli bir güvenlik açığı için lütfen herkese açık bir
issue, tartışma veya pull request **açmayın**.

Geçerli bir bildirimi **7 gün** içinde teyit etmeyi hedefliyoruz ve
araştırırken ve bir düzeltme hazırlarken sizi bilgilendireceğiz. Bir düzeltme
yayınlandığında, anonim kalmayı tercih etmediğiniz sürece sizi advisory'de
memnuniyetle anarız.

### Kapsam notu

RageClickRadar'ın collector'ı (`/api/collect`) **kimlik doğrulaması olmadan
herkese açık şekilde erişilebilir olacak biçimde tasarlanmıştır** — enstrümante
ettiğiniz herhangi bir sayfadan gelen anonim beacon'ları kabul etmek zorundadır.
Sonuç olarak, örneğinize erişebilen herkes *kendi* veritabanınıza sentetik
sinyaller gönderebilir. Bu veri enjeksiyon yüzeyi bir güvenlik açığı değil,
**tasarımın bir parçasıdır**: uç nokta yalnızca doğrulayan ve yalnızca yazan
niteliktedir, katı bir anonim beyaz liste kabul eder, hiçbir IP/user-agent/PII
saklamaz ve hız sınırlıdır. Collector'ın güvenlik modeli, bir ters proxy
arkasındaki hız sınırlama davranışı ve (yerleşik kimlik doğrulaması olmayan)
dashboard'u nasıl gizli tutacağınız için [docs/self-hosting.md](docs/self-hosting.md)
dosyasına bakın.

"Açık collector'a veri gönderebiliyorum" ile özetlenen bildirimler beklenen
davranıştır ve kapsam dışıdır. Collector'ın PII sakladığına, okuma uç noktaları
aracılığıyla başka bir kaynağın (origin) verilerini okumanın bir yoluna,
enjeksiyon/RCE'ye veya alan beyaz listesini atlatmanın bir yoluna dair
bildirimler kesinlikle kapsam içindedir.

---

## 中文

[English](#security-policy) · [Türkçe](#türkçe) · **中文** · [Русский](#русский) · [العربية](#العربية) · [日本語](#日本語)

### 受支持的版本

RageClickRadar 尚未发布 1.0。安全修复只会落地到最新的 `0.x` 版本；不会为旧版本
提供回移补丁。请在报告之前确认你使用的是最新版本。

### 报告漏洞

请**私下**报告安全问题，不要在公开的 issue 中报告。

请使用本仓库的 GitHub 私密漏洞报告功能：
**Security → Report a vulnerability**
(https://github.com/IACBI/rageclickradar/security/advisories/new)。这会开启一个
仅你与维护者可见的私密 advisory。

在问题得到处理之前，对于疑似漏洞，请**不要**开启公开的 issue、讨论或
pull request。

我们力求在 **7 天**内确认一份有效的报告，并会在调查和准备修复的过程中持续向你
通报进展。修复发布后，除非你希望保持匿名，否则我们很乐意在 advisory 中致谢于你。

### 范围说明

RageClickRadar 的 collector（`/api/collect`）**在设计上就是无需认证即可公开
访问的**——它必须接受来自你所埋点的任何页面的匿名 beacon。因此，任何能够访问你
实例的人都可以向*你自己的*数据库投递合成信号。这一数据注入面是**有意为之**，
而非漏洞：该端点仅做校验、只写入，接受一份严格的匿名白名单，不存储任何
IP/user-agent/PII，并且有速率限制。关于 collector 的安全模型、反向代理背后的
速率限制行为，以及如何让（没有内置认证的）dashboard 保持私密，请参见
[docs/self-hosting.md](docs/self-hosting.md)。

归结为“我能向开放的 collector 发送数据”的报告属于预期行为，不在范围之内。而
关于 collector 存储 PII、通过读取端点读取另一来源（origin）数据的途径、
注入/RCE，或绕过字段白名单的途径的报告，则完全在范围之内。

---

## Русский

[English](#security-policy) · [Türkçe](#türkçe) · [中文](#中文) · **Русский** · [العربية](#العربية) · [日本語](#日本語)

### Поддерживаемые версии

RageClickRadar находится в стадии до 1.0. Исправления безопасности выходят в
последнем релизе `0.x`; для более старых версий бэкпортов патчей нет.
Пожалуйста, перед тем как сообщать, убедитесь, что вы используете самый свежий
релиз.

### Сообщение об уязвимости

Пожалуйста, сообщайте о проблемах безопасности **приватно**, а не в публичном
issue.

Используйте приватное сообщение об уязвимости GitHub в этом репозитории:
**Security → Report a vulnerability**
(https://github.com/IACBI/rageclickradar/security/advisories/new). Это откроет
приватный advisory, видимый только вам и сопровождающим.

Пожалуйста, **не** открывайте публичный issue, обсуждение или pull request по
предполагаемой уязвимости, пока она не будет устранена.

Мы стремимся подтвердить получение корректного сообщения в течение **7 дней** и
будем держать вас в курсе, пока проводим расследование и готовим исправление.
Когда исправление выйдет, мы будем рады упомянуть вас в advisory, если только
вы не предпочтёте остаться анонимным.

### Замечание об области действия

Collector RageClickRadar (`/api/collect`) **спроектирован так, чтобы быть
публично доступным без аутентификации** — он должен принимать анонимные beacon'ы
с любой страницы, которую вы инструментируете. Как следствие, любой, кто может
достучаться до вашего экземпляра, может отправлять синтетические сигналы в
*вашу собственную* базу данных. Эта поверхность внедрения данных — **часть
замысла**, а не уязвимость: конечная точка только проверяет и только пишет,
принимает строгий анонимный белый список, не хранит никаких IP/user-agent/PII и
ограничена по частоте запросов. Модель безопасности collector'а, поведение
ограничения частоты за обратным прокси и то, как сохранить приватность
dashboard (у которого нет встроенной аутентификации), смотрите в
[docs/self-hosting.md](docs/self-hosting.md).

Сообщения, сводящиеся к «я могу отправлять данные в открытый collector», — это
ожидаемое поведение и вне области действия. Сообщения о том, что collector
хранит PII, о способе прочитать данные другого источника (origin) через
конечные точки чтения, об инъекции/RCE или о способе обойти белый список полей
— вполне в пределах области действия.

---

## العربية

[English](#security-policy) · [Türkçe](#türkçe) · [中文](#中文) · [Русский](#русский) · **العربية** · [日本語](#日本語)

### الإصدارات المدعومة

RageClickRadar في مرحلة ما قبل 1.0. تنزل إصلاحات الأمان على أحدث إصدار `0.x`؛
ولا توجد ترقيعات معادة النقل للإصدارات الأقدم. يرجى التأكد من أنك على أحدث إصدار
قبل الإبلاغ.

### الإبلاغ عن ثغرة

يرجى الإبلاغ عن مشكلات الأمان **بشكل خاص**، وليس في issue عمومية.

استخدم ميزة الإبلاغ الخاص عن الثغرات في GitHub على هذا المستودع:
**Security ← Report a vulnerability**
(https://github.com/IACBI/rageclickradar/security/advisories/new). يفتح هذا
advisory خاصًا مرئيًا لك وللمشرفين فقط.

يرجى **عدم** فتح issue عمومية أو نقاش أو pull request لثغرة مشتبه بها حتى تتم
معالجتها.

نهدف إلى تأكيد أي بلاغ صحيح خلال **7 أيام**، وسنبقيك على اطلاع بينما نحقق ونُعِدّ
الإصلاح. عند إصدار الإصلاح، يسعدنا أن ننسب إليك الفضل في الـ advisory ما لم تفضّل
البقاء مجهولًا.

### ملاحظة حول النطاق

إن collector الخاص بـ RageClickRadar (`/api/collect`) **مصمَّم ليكون قابلًا
للوصول علنًا دون مصادقة** — إذ يجب أن يقبل beacon مجهولة من أي صفحة تُركِّب عليها
الأداة. ونتيجة لذلك، يمكن لأي شخص يستطيع الوصول إلى نسختك أن يرسل إشارات اصطناعية
إلى قاعدة بياناتك *أنت*. سطح حقن البيانات هذا هو **جزء من التصميم** وليس ثغرة:
فالـ endpoint يتحقق فقط ويكتب فقط، ويقبل قائمة بيضاء مجهولة صارمة، ولا يخزّن أي
IP/user-agent/PII، وهو محدود المعدّل. راجع
[docs/self-hosting.md](docs/self-hosting.md) للاطلاع على نموذج أمان الـ collector،
وسلوك تحديد المعدّل خلف وكيل عكسي (reverse proxy)، وكيفية إبقاء الـ dashboard
(الذي لا يملك مصادقة مدمجة) خاصًا.

البلاغات التي تتلخص في "يمكنني إرسال بيانات إلى الـ collector المفتوح" هي سلوك
متوقع وخارج النطاق. أما البلاغات عن تخزين الـ collector لبيانات PII، أو عن طريقة
لقراءة بيانات مصدر (origin) آخر عبر نقاط نهاية القراءة، أو عن الحقن/RCE، أو عن
طريقة لتجاوز قائمة الحقول البيضاء، فهي بالتأكيد ضمن النطاق.

---

## 日本語

[English](#security-policy) · [Türkçe](#türkçe) · [中文](#中文) · [Русский](#русский) · [العربية](#العربية) · **日本語**

### サポート対象バージョン

RageClickRadar は 1.0 より前の段階です。セキュリティ修正は最新の `0.x`
リリースに適用されます。より古いバージョンへのバックポートパッチはありません。
報告する前に、必ず最新のリリースを使用しているか確認してください。

### 脆弱性の報告

セキュリティ問題は公開の issue ではなく、**非公開**で報告してください。

このリポジトリで GitHub の非公開脆弱性報告を使用してください：
**Security → Report a vulnerability**
(https://github.com/IACBI/rageclickradar/security/advisories/new)。これにより、
あなたとメンテナーだけに見える非公開の advisory が開かれます。

対処が完了するまで、疑わしい脆弱性について公開の issue、ディスカッション、
または pull request を**開かないで**ください。

有効な報告については **7 日**以内に受領を確認することを目標としており、調査し
修正を準備する間、随時状況をお知らせします。修正がリリースされた際には、匿名を
希望されない限り、advisory であなたに謝辞を記すことを歓迎します。

### スコープに関する注記

RageClickRadar の collector（`/api/collect`）は、**認証なしで公開アクセス可能で
あるように設計されています**——計測対象とするあらゆるページからの匿名 beacon を
受け入れなければならないためです。その結果、あなたのインスタンスに到達できる者
なら誰でも、*あなた自身の*データベースに合成シグナルを投稿できます。この
データ注入の面は脆弱性ではなく、**設計によるもの**です。すなわち、この
エンドポイントは検証専用かつ書き込み専用であり、厳格な匿名ホワイトリストのみを
受け入れ、IP/user-agent/PII を一切保存せず、レート制限されています。collector
のセキュリティモデル、リバースプロキシ背後でのレート制限の挙動、そして
（組み込みの認証を持たない）dashboard を非公開に保つ方法については
[docs/self-hosting.md](docs/self-hosting.md) を参照してください。

「開かれた collector にデータを送信できる」という趣旨の報告は想定された挙動で
あり、スコープ外です。collector が PII を保存すること、読み取り
エンドポイントを通じて別のオリジン（origin）のデータを読み取る方法、
インジェクション/RCE、またはフィールドのホワイトリストを回避する方法に関する
報告は、大いにスコープ内です。
