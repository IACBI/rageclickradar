# Contributing to RageClickRadar

**English** · [Türkçe](#türkçe) · [中文](#中文) · [Русский](#русский) · [العربية](#العربية) · [日本語](#日本語)

Thanks for your interest in improving RageClickRadar. This is a small,
privacy-first project with a deliberately tight scope, and contributions of all
sizes are welcome — bug fixes, docs, tests, and well-argued features.

## Development setup

You need **Node 22.5 or newer** (Node 24 LTS recommended). There are no runtime
dependencies; the only dev dependencies are esbuild and Playwright.

```bash
git clone https://github.com/IACBI/rageclickradar.git
cd rageclickradar
npm install
npm run demo
```

`npm run demo` builds the tracker, starts the server, seeds a batch of synthetic
frustration sessions into a local demo database if it is empty, and prints the
dashboard and demo-site URLs to open.

## Running the tests

```bash
npm test                # unit tests (Node built-in test runner)
npm run test:e2e        # Playwright end-to-end tests (chromium)
npm run build:tracker   # rebuild the tracker bundle; fails over the size budget
```

The e2e suite boots its own server on a fixed port with a fresh, per-run SQLite
file — you do not need to start anything first.

> **Note:** the `test` script uses the glob form
> (`node --test test/unit/*.test.js`) because `node --test <directory>` does not
> expand a directory argument reliably on Windows. Keep that form.

## Project layout

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

## Hard rules

These invariants are what make RageClickRadar what it is. A change that breaks
one of them will not be merged.

- **Tracker bundle budget: 5120 bytes, hard.** `npm run build:tracker` measures
  the minified bundle and exits non-zero if it exceeds 5120 bytes. CI runs this,
  so an over-budget bundle fails the build. Keep the snippet small.
- **Zero runtime dependencies for the server.** The server runs on Node built-ins
  only (including `node:sqlite`). Do not add a runtime dependency to
  `package.json`. Dev-only tooling (esbuild, Playwright) is the only exception.
- **Privacy invariants — never weaken them.** The tracker must never read typed
  text or field values (`event.data` / `element.value` are off-limits; only
  input-event *types* are counted). The server must never store an IP address,
  user agent, request header, full URL, or any cross-site identifier. The
  collector writes a strict field whitelist and nothing else. See
  [docs/privacy.md](docs/privacy.md) for the exact wire schema and the enforcing
  test (`test/unit/collect.test.js`). If your change touches collection, it must
  keep that test green.
- **Tests are required for behavior changes.** Any change to detection, storage,
  or the read endpoints needs unit-test coverage (and e2e coverage where it
  affects the dashboard). Bug fixes should come with a test that fails without
  the fix.

## Pull requests

- Keep PRs small and focused — one logical change per PR is much easier to review.
- CI must be green (unit + e2e on the supported Node versions, and the tracker
  bundle within budget) before a PR can merge.
- Update the docs (`README.md`, `docs/`) when behavior or configuration changes.
- Describe what you changed and how you tested it; the PR template has a short
  checklist to follow.

By contributing you agree that your contributions are licensed under the MIT
License, the same as the rest of the project.

---

## Türkçe

[English](#contributing-to-rageclickradar) · **Türkçe** · [中文](#中文) · [Русский](#русский) · [العربية](#العربية) · [日本語](#日本語)

RageClickRadar'ı geliştirmeye gösterdiğiniz ilgi için teşekkürler. Burası
gizliliği önceleyen, kapsamı bilinçli olarak dar tutulmuş küçük bir projedir ve
her boyuttaki katkı memnuniyetle karşılanır — hata düzeltmeleri, dokümantasyon,
testler ve iyi gerekçelendirilmiş özellikler.

### Geliştirme ortamı

**Node 22.5 veya daha yenisine** ihtiyacınız var (Node 24 LTS önerilir). Hiçbir
çalışma zamanı bağımlılığı yoktur; tek geliştirme bağımlılıkları esbuild ve
Playwright'tır.

```bash
git clone https://github.com/IACBI/rageclickradar.git
cd rageclickradar
npm install
npm run demo
```

`npm run demo`, tracker'ı derler, sunucuyu başlatır, yerel demo veritabanı boşsa
içine bir grup sentetik hüsran oturumu ekler ve açılacak dashboard ile demo
sitesi URL'lerini yazdırır.

### Testleri çalıştırma

```bash
npm test                # birim testleri (Node yerleşik test çalıştırıcısı)
npm run test:e2e        # Playwright uçtan uca testleri (chromium)
npm run build:tracker   # tracker paketini yeniden derler; boyut bütçesini aşarsa başarısız olur
```

Uçtan uca test paketi, sabit bir portta ve her çalıştırmada taze bir SQLite
dosyasıyla kendi sunucusunu başlatır — önceden hiçbir şey başlatmanıza gerek
yoktur.

> **Not:** `test` betiği glob biçimini
> (`node --test test/unit/*.test.js`) kullanır çünkü `node --test <directory>`
> Windows'ta bir dizin argümanını güvenilir biçimde genişletmez. Bu biçimi
> koruyun.

### Proje düzeni

```
shared/config.js        Her eşik değerinin tek doğruluk kaynağı
tracker/src/            Tarayıcı tracker kaynağı (radar, dedektörler, seçici, taşıma)
tracker/build.js        esbuild paketi -> tracker/dist/radar.min.js (bütçeyi uygular)
server/                 Sıfır bağımlılıklı Node sunucusu (http, collect, queries, db)
dashboard/              Sade JS dashboard (/ üzerinde sunulur)
demo/                   Kasıtlı tuzaklar içeren "CloudNimbus" demo sitesi (/demo/)
tools/                  Demo başlatıcı ve sentetik oturum tohumlayıcı
test/unit/              Node yerleşik test çalıştırıcısı birim testleri
test/e2e/               Playwright uçtan uca testleri
docs/                   Dokümantasyon (kendi sunucunda barındırma, gizlilik)
```

### Katı kurallar

Bu değişmezler, RageClickRadar'ı RageClickRadar yapan şeydir. Bunlardan birini
bozan bir değişiklik birleştirilmez.

- **Tracker paket bütçesi: 5120 bayt, kesin.** `npm run build:tracker`,
  küçültülmüş paketi ölçer ve 5120 baytı aşarsa sıfırdan farklı çıkış kodu
  döndürür. CI bunu çalıştırır, dolayısıyla bütçeyi aşan bir paket derlemeyi
  başarısız kılar. Snippet'i küçük tutun.
- **Sunucu için sıfır çalışma zamanı bağımlılığı.** Sunucu yalnızca Node
  yerleşikleriyle çalışır (`node:sqlite` dahil). `package.json` dosyasına
  çalışma zamanı bağımlılığı eklemeyin. Yalnızca geliştirme araçları (esbuild,
  Playwright) bu kuralın istisnasıdır.
- **Gizlilik değişmezleri — asla zayıflatmayın.** Tracker, yazılan metni veya
  alan değerlerini asla okumamalıdır (`event.data` / `element.value` yasaktır;
  yalnızca input olayı *türleri* sayılır). Sunucu asla bir IP adresi, kullanıcı
  aracısı (user agent), istek başlığı, tam URL veya herhangi bir siteler arası
  tanımlayıcı saklamamalıdır. Collector, katı bir alan beyaz listesi yazar ve
  başka hiçbir şey yazmaz. Tam kablo şeması ve uygulayan test için
  [docs/privacy.md](docs/privacy.md) dosyasına
  (`test/unit/collect.test.js`) bakın. Değişikliğiniz toplamaya dokunuyorsa bu
  testi yeşil tutmalıdır.
- **Davranış değişiklikleri için testler zorunludur.** Algılama, depolama veya
  okuma uç noktalarındaki her değişiklik birim testi kapsamı gerektirir (ve
  dashboard'u etkiliyorsa e2e kapsamı da). Hata düzeltmeleri, düzeltme olmadan
  başarısız olan bir testle birlikte gelmelidir.

### Pull request'ler

- PR'ları küçük ve odaklı tutun — PR başına tek bir mantıksal değişiklik
  incelemeyi çok kolaylaştırır.
- Bir PR birleştirilebilmeden önce CI yeşil olmalıdır (desteklenen Node
  sürümlerinde birim + e2e ve bütçe içindeki tracker paketi).
- Davranış veya yapılandırma değiştiğinde dokümanları (`README.md`, `docs/`)
  güncelleyin.
- Neyi değiştirdiğinizi ve nasıl test ettiğinizi açıklayın; PR şablonunda
  izlenecek kısa bir kontrol listesi vardır.

Katkıda bulunarak, katkılarınızın projenin geri kalanıyla aynı şekilde MIT
Lisansı altında lisanslandığını kabul etmiş olursunuz.

---

## 中文

[English](#contributing-to-rageclickradar) · [Türkçe](#türkçe) · **中文** · [Русский](#русский) · [العربية](#العربية) · [日本語](#日本語)

感谢你有兴趣改进 RageClickRadar。这是一个小而注重隐私的项目，范围经过刻意收紧，
欢迎各种规模的贡献——缺陷修复、文档、测试，以及经过充分论证的新特性。

### 开发环境搭建

你需要 **Node 22.5 或更高版本**（推荐 Node 24 LTS）。项目没有任何运行时依赖；
唯一的开发依赖是 esbuild 和 Playwright。

```bash
git clone https://github.com/IACBI/rageclickradar.git
cd rageclickradar
npm install
npm run demo
```

`npm run demo` 会构建 tracker、启动服务器，若本地演示数据库为空则向其中植入一批
合成的挫败会话，并打印出可供打开的 dashboard 与演示站点的 URL。

### 运行测试

```bash
npm test                # 单元测试（Node 内置测试运行器）
npm run test:e2e        # Playwright 端到端测试（chromium）
npm run build:tracker   # 重新构建 tracker 包；超出体积预算则失败
```

端到端测试套件会在固定端口上启动它自己的服务器，并为每次运行使用一个全新的
SQLite 文件——你无需事先启动任何东西。

> **注意：** `test` 脚本使用 glob 形式
> （`node --test test/unit/*.test.js`），因为 `node --test <directory>` 在
> Windows 上无法可靠地展开目录参数。请保留这种形式。

### 项目结构

```
shared/config.js        所有阈值的唯一真实来源
tracker/src/            浏览器 tracker 源码（radar、检测器、选择器、传输）
tracker/build.js        esbuild 打包 -> tracker/dist/radar.min.js（强制执行预算）
server/                 零依赖 Node 服务器（http、collect、queries、db）
dashboard/              原生 JS dashboard（在 / 提供）
demo/                   带有刻意陷阱的 "CloudNimbus" 演示站点（/demo/）
tools/                  演示启动器与合成会话植入器
test/unit/              Node 内置测试运行器单元测试
test/e2e/               Playwright 端到端测试
docs/                   文档（自托管、隐私）
```

### 硬性规则

这些不变量正是 RageClickRadar 之所以为 RageClickRadar 的原因。任何破坏其中一条的
改动都不会被合并。

- **Tracker 包体积预算：5120 字节，硬性。** `npm run build:tracker` 会测量压缩后
  的包，若超过 5120 字节则以非零码退出。CI 会运行此项，因此超预算的包会导致构建
  失败。请让代码片段保持精简。
- **服务器零运行时依赖。** 服务器仅依赖 Node 内置模块（包括 `node:sqlite`）。
  不要向 `package.json` 添加运行时依赖。仅开发用的工具（esbuild、Playwright）是
  唯一的例外。
- **隐私不变量——绝不削弱。** tracker 绝不能读取用户键入的文本或字段值
  （`event.data` / `element.value` 属于禁区；只统计 input 事件的*类型*）。服务器
  绝不能存储 IP 地址、user agent、请求头、完整 URL 或任何跨站标识符。collector
  只写入一份严格的字段白名单，别无其他。确切的传输 schema 与强制执行它的测试见
  [docs/privacy.md](docs/privacy.md)（`test/unit/collect.test.js`）。如果你的改动
  触及数据收集，就必须保持该测试为绿色。
- **行为变更必须附带测试。** 对检测、存储或读取端点的任何改动都需要单元测试覆盖
  （若影响 dashboard 还需 e2e 覆盖）。缺陷修复应附带一个在修复前会失败的测试。

### Pull request

- 让 PR 保持小而聚焦——每个 PR 只做一处逻辑改动，会大大方便评审。
- 在 PR 能够合并之前，CI 必须为绿色（受支持的 Node 版本上的单元测试 + e2e，以及
  预算之内的 tracker 包）。
- 当行为或配置发生变化时，更新文档（`README.md`、`docs/`）。
- 描述你改动了什么以及如何测试的；PR 模板中有一份简短的检查清单可供遵循。

通过贡献，你同意你的贡献按 MIT 许可证授权，与项目的其余部分相同。

---

## Русский

[English](#contributing-to-rageclickradar) · [Türkçe](#türkçe) · [中文](#中文) · **Русский** · [العربية](#العربية) · [日本語](#日本語)

Спасибо за интерес к развитию RageClickRadar. Это небольшой проект с приоритетом
приватности и намеренно узкой областью применения, и вклад любого размера
приветствуется — исправления ошибок, документация, тесты и хорошо обоснованные
возможности.

### Настройка среды разработки

Вам понадобится **Node 22.5 или новее** (рекомендуется Node 24 LTS). Никаких
зависимостей времени выполнения нет; единственные зависимости для разработки —
esbuild и Playwright.

```bash
git clone https://github.com/IACBI/rageclickradar.git
cd rageclickradar
npm install
npm run demo
```

`npm run demo` собирает tracker, запускает сервер, засевает пакет синтетических
сессий фрустрации в локальную демонстрационную базу данных, если она пуста, и
выводит URL-адреса dashboard и демо-сайта, которые можно открыть.

### Запуск тестов

```bash
npm test                # модульные тесты (встроенный тест-раннер Node)
npm run test:e2e        # сквозные тесты Playwright (chromium)
npm run build:tracker   # пересборка бандла tracker; падает при превышении бюджета размера
```

Набор сквозных тестов поднимает собственный сервер на фиксированном порту со
свежим SQLite-файлом для каждого запуска — заранее ничего запускать не нужно.

> **Примечание:** скрипт `test` использует форму с glob
> (`node --test test/unit/*.test.js`), потому что `node --test <directory>`
> ненадёжно разворачивает аргумент-каталог в Windows. Сохраняйте эту форму.

### Структура проекта

```
shared/config.js        Единственный источник истины для каждого порога
tracker/src/            Исходники браузерного tracker (radar, детекторы, селектор, транспорт)
tracker/build.js        Бандл esbuild -> tracker/dist/radar.min.js (применяет бюджет)
server/                 Node-сервер без зависимостей (http, collect, queries, db)
dashboard/              Dashboard на чистом JS (обслуживается по /)
demo/                   Демо-сайт "CloudNimbus" с намеренными ловушками (/demo/)
tools/                  Запускатор демо и генератор синтетических сессий
test/unit/              Модульные тесты на встроенном тест-раннере Node
test/e2e/               Сквозные тесты Playwright
docs/                   Документация (самостоятельный хостинг, приватность)
```

### Жёсткие правила

Эти инварианты и есть то, что делает RageClickRadar тем, чем он является.
Изменение, нарушающее хотя бы одно из них, не будет принято.

- **Бюджет бандла tracker: 5120 байт, жёстко.** `npm run build:tracker` измеряет
  минифицированный бандл и завершается с ненулевым кодом, если он превышает 5120
  байт. CI запускает это, поэтому бандл сверх бюджета проваливает сборку.
  Держите сниппет небольшим.
- **Ноль зависимостей времени выполнения для сервера.** Сервер работает только на
  встроенных модулях Node (включая `node:sqlite`). Не добавляйте зависимость
  времени выполнения в `package.json`. Инструменты только для разработки
  (esbuild, Playwright) — единственное исключение.
- **Инварианты приватности — никогда их не ослабляйте.** tracker никогда не
  должен читать введённый текст или значения полей (`event.data` /
  `element.value` под запретом; считаются только *типы* событий input). Сервер
  никогда не должен хранить IP-адрес, user agent, заголовок запроса, полный URL
  или любой межсайтовый идентификатор. Collector записывает строгий белый список
  полей и ничего больше. Точную схему передачи и обеспечивающий её тест смотрите
  в [docs/privacy.md](docs/privacy.md) (`test/unit/collect.test.js`). Если ваше
  изменение затрагивает сбор данных, оно должно сохранять этот тест зелёным.
- **Для изменений поведения обязательны тесты.** Любое изменение в детектировании,
  хранении или конечных точках чтения требует покрытия модульными тестами (и
  покрытия e2e там, где это затрагивает dashboard). Исправления ошибок должны
  сопровождаться тестом, который падает без исправления.

### Pull request'ы

- Держите PR небольшими и сфокусированными — одно логическое изменение на PR
  гораздо легче ревьюить.
- Прежде чем PR можно будет слить, CI должен быть зелёным (модульные + e2e на
  поддерживаемых версиях Node и бандл tracker в пределах бюджета).
- Обновляйте документацию (`README.md`, `docs/`) при изменении поведения или
  конфигурации.
- Опишите, что вы изменили и как это протестировали; в шаблоне PR есть короткий
  чек-лист, которому нужно следовать.

Внося вклад, вы соглашаетесь, что ваши вклады лицензируются по лицензии MIT, как
и остальная часть проекта.

---

## العربية

[English](#contributing-to-rageclickradar) · [Türkçe](#türkçe) · [中文](#中文) · [Русский](#русский) · **العربية** · [日本語](#日本語)

شكرًا لاهتمامك بتحسين RageClickRadar. هذا مشروع صغير يضع الخصوصية أولًا، بنطاق
ضيّق عن قصد، والمساهمات بجميع أحجامها مُرحَّب بها — إصلاحات الأخطاء، والتوثيق،
والاختبارات، والميزات المدعومة بحجج جيدة.

### إعداد بيئة التطوير

تحتاج إلى **Node 22.5 أو أحدث** (يُنصح بـ Node 24 LTS). لا توجد أي تبعيات وقت
تشغيل؛ التبعيتان الوحيدتان للتطوير هما esbuild و Playwright.

```bash
git clone https://github.com/IACBI/rageclickradar.git
cd rageclickradar
npm install
npm run demo
```

يقوم `npm run demo` ببناء الـ tracker، وتشغيل الخادم، وزرع دفعة من جلسات الإحباط
الاصطناعية في قاعدة بيانات تجريبية محلية إذا كانت فارغة، وطباعة عناوين URL الخاصة
بالـ dashboard وموقع العرض التجريبي لفتحها.

### تشغيل الاختبارات

```bash
npm test                # اختبارات الوحدة (مُشغِّل الاختبارات المدمج في Node)
npm run test:e2e        # اختبارات Playwright الشاملة من طرف إلى طرف (chromium)
npm run build:tracker   # إعادة بناء حزمة الـ tracker؛ تفشل عند تجاوز ميزانية الحجم
```

تُشغِّل مجموعة الاختبارات الشاملة خادمها الخاص على منفذ ثابت مع ملف SQLite جديد
لكل تشغيل — لا حاجة لتشغيل أي شيء مسبقًا.

> **ملاحظة:** يستخدم سكربت `test` صيغة الـ glob
> (`node --test test/unit/*.test.js`) لأن `node --test <directory>` لا يوسّع
> وسيط الدليل بشكل موثوق على Windows. حافظ على هذه الصيغة.

### بنية المشروع

```
shared/config.js        مصدر الحقيقة الوحيد لكل عتبة
tracker/src/            مصدر الـ tracker في المتصفح (radar، الكواشف، المحدِّد، النقل)
tracker/build.js        حزمة esbuild -> tracker/dist/radar.min.js (تفرض الميزانية)
server/                 خادم Node بلا تبعيات (http، collect، queries، db)
dashboard/              dashboard بجافاسكربت خالص (يُقدَّم على /)
demo/                   موقع العرض التجريبي "CloudNimbus" بمصائد مقصودة (/demo/)
tools/                  مُشغِّل العرض التجريبي وزارع الجلسات الاصطناعية
test/unit/              اختبارات الوحدة على مُشغِّل الاختبارات المدمج في Node
test/e2e/               اختبارات Playwright الشاملة من طرف إلى طرف
docs/                   التوثيق (الاستضافة الذاتية، الخصوصية)
```

### القواعد الصارمة

هذه الثوابت هي ما يجعل RageClickRadar على ما هو عليه. أي تغيير يكسر واحدًا منها
لن يُدمَج.

- **ميزانية حزمة الـ tracker: 5120 بايت، صارمة.** يقيس `npm run build:tracker`
  الحزمة المُصغَّرة ويخرج برمز غير صفري إذا تجاوزت 5120 بايت. يُشغِّل CI هذا، لذا
  فإن الحزمة التي تتجاوز الميزانية تُفشِل البناء. أبقِ المقتطف صغيرًا.
- **صفر تبعيات وقت تشغيل للخادم.** يعمل الخادم على وحدات Node المدمجة فقط
  (بما في ذلك `node:sqlite`). لا تُضِف تبعية وقت تشغيل إلى `package.json`. أدوات
  التطوير فقط (esbuild و Playwright) هي الاستثناء الوحيد.
- **ثوابت الخصوصية — لا تُضعِفها أبدًا.** يجب ألا يقرأ الـ tracker أبدًا النص
  المُدخَل أو قيم الحقول (`event.data` / `element.value` ممنوعة؛ تُحتسَب *أنواع*
  أحداث input فقط). يجب ألا يخزّن الخادم أبدًا عنوان IP، أو user agent، أو ترويسة
  طلب، أو عنوان URL كاملًا، أو أي مُعرِّف عابر للمواقع. يكتب الـ collector قائمة
  بيضاء صارمة للحقول ولا شيء غيرها. راجع
  [docs/privacy.md](docs/privacy.md) لمعرفة مخطط النقل الدقيق والاختبار الذي
  يفرضه (`test/unit/collect.test.js`). إذا كان تغييرك يمس عملية الجمع، فيجب أن
  يُبقي هذا الاختبار أخضر.
- **الاختبارات مطلوبة لتغييرات السلوك.** أي تغيير في الكشف أو التخزين أو نقاط
  نهاية القراءة يحتاج إلى تغطية باختبارات الوحدة (وتغطية e2e حيثما يؤثر على
  الـ dashboard). ينبغي أن تأتي إصلاحات الأخطاء مع اختبار يفشل من دون الإصلاح.

### طلبات السحب (Pull requests)

- أبقِ طلبات السحب صغيرة ومركّزة — تغيير منطقي واحد لكل طلب سحب أسهل بكثير في
  المراجعة.
- يجب أن يكون CI أخضر قبل أن يُدمَج طلب السحب (الوحدة + e2e على إصدارات Node
  المدعومة، وحزمة الـ tracker ضمن الميزانية).
- حدِّث التوثيق (`README.md`، `docs/`) عند تغيّر السلوك أو الإعدادات.
- صِف ما غيّرته وكيف اختبرته؛ يحتوي قالب طلب السحب على قائمة تحقق قصيرة تتبعها.

بمساهمتك فإنك توافق على أن مساهماتك مرخّصة بموجب رخصة MIT، تمامًا كبقية المشروع.

---

## 日本語

[English](#contributing-to-rageclickradar) · [Türkçe](#türkçe) · [中文](#中文) · [Русский](#русский) · [العربية](#العربية) · **日本語**

RageClickRadar の改善にご関心をお寄せいただきありがとうございます。これは
プライバシーを最優先する小さなプロジェクトで、スコープを意図的に狭く保っており、
規模の大小を問わずあらゆる貢献を歓迎します——バグ修正、ドキュメント、テスト、
そして十分に論拠のある機能です。

### 開発環境のセットアップ

**Node 22.5 以降**が必要です（Node 24 LTS を推奨）。ランタイム依存はありません。
唯一の開発依存は esbuild と Playwright です。

```bash
git clone https://github.com/IACBI/rageclickradar.git
cd rageclickradar
npm install
npm run demo
```

`npm run demo` は tracker をビルドし、サーバーを起動し、ローカルのデモ用
データベースが空であれば合成されたフラストレーションセッションを一括で投入し、
開くべき dashboard とデモサイトの URL を出力します。

### テストの実行

```bash
npm test                # ユニットテスト（Node 組み込みテストランナー）
npm run test:e2e        # Playwright エンドツーエンドテスト（chromium）
npm run build:tracker   # tracker バンドルを再ビルド。サイズ予算を超えると失敗する
```

エンドツーエンドのスイートは、固定ポート上で実行ごとに新しい SQLite ファイルを
使って独自のサーバーを起動します——事前に何かを起動しておく必要はありません。

> **注意：** `test` スクリプトが glob 形式
> （`node --test test/unit/*.test.js`）を使うのは、`node --test <directory>` が
> Windows でディレクトリ引数を確実に展開しないためです。この形式を維持して
> ください。

### プロジェクト構成

```
shared/config.js        すべてのしきい値の唯一の信頼できる情報源
tracker/src/            ブラウザ tracker のソース（radar、検出器、セレクタ、トランスポート）
tracker/build.js        esbuild バンドル -> tracker/dist/radar.min.js（予算を強制）
server/                 依存ゼロの Node サーバー（http、collect、queries、db）
dashboard/              バニラ JS の dashboard（/ で配信）
demo/                   意図的なトラップを仕込んだ "CloudNimbus" デモサイト（/demo/）
tools/                  デモ起動ツールと合成セッションのシーダー
test/unit/              Node 組み込みテストランナーによるユニットテスト
test/e2e/               Playwright エンドツーエンドテスト
docs/                   ドキュメント（セルフホスティング、プライバシー）
```

### 厳格なルール

これらの不変条件こそが RageClickRadar を RageClickRadar たらしめています。
そのいずれかを破る変更はマージされません。

- **tracker バンドル予算：5120 バイト、厳守。** `npm run build:tracker` は
  ミニファイ済みバンドルを計測し、5120 バイトを超えると非ゼロで終了します。CI が
  これを実行するため、予算超過のバンドルはビルドを失敗させます。スニペットは
  小さく保ってください。
- **サーバーのランタイム依存はゼロ。** サーバーは Node 組み込み（`node:sqlite`
  を含む）のみで動作します。`package.json` にランタイム依存を追加しないで
  ください。開発専用ツール（esbuild、Playwright）だけが唯一の例外です。
- **プライバシー不変条件——決して弱めないこと。** tracker は入力されたテキストや
  フィールドの値を決して読み取ってはなりません（`event.data` / `element.value`
  は対象外。input イベントの*種類*のみを数えます）。サーバーは IP アドレス、
  user agent、リクエストヘッダー、完全な URL、あるいは任意のクロスサイト識別子を
  決して保存してはなりません。collector は厳格なフィールドのホワイトリストのみを
  書き込み、それ以外は何も書き込みません。正確なワイヤースキーマとそれを強制する
  テストについては [docs/privacy.md](docs/privacy.md)
  （`test/unit/collect.test.js`）を参照してください。変更が収集に触れる場合は、
  そのテストを green に保たなければなりません。
- **挙動の変更にはテストが必須。** 検出、保存、または読み取りエンドポイントへの
  いかなる変更もユニットテストのカバレッジ（dashboard に影響する場合は e2e
  カバレッジも）を必要とします。バグ修正は、修正なしでは失敗するテストを伴うべき
  です。

### プルリクエスト

- PR は小さく焦点を絞ってください——1 つの PR につき 1 つの論理的な変更にすると、
  レビューがずっと容易になります。
- PR をマージできる前に、CI が green である必要があります（サポート対象の Node
  バージョンでのユニット + e2e、および予算内の tracker バンドル）。
- 挙動や設定が変わったら、ドキュメント（`README.md`、`docs/`）を更新して
  ください。
- 何を変更し、どのようにテストしたかを説明してください。PR テンプレートには
  従うべき短いチェックリストがあります。

貢献することにより、あなたは自分の貢献がプロジェクトの他の部分と同じく MIT
ライセンスの下でライセンスされることに同意したものとみなされます。
