# Security Policy

**Read this in:** [English](#english) · [Türkçe](#turkce)

---
<a id="english"></a>
## English

### Supported versions

RageClickRadar is pre-1.0. Security fixes land on the latest `0.x` release, and older
versions do not get backported patches. Before you report anything, check that you are
on the most recent release.

### Reporting a vulnerability

Report security issues **privately**, not in a public issue.

Use GitHub's private vulnerability reporting for this repository: **Security → Report a
vulnerability**, or open it directly at
https://github.com/IACBI/rageclickradar/security/advisories/new. The advisory is visible
only to you and the maintainers.

Do not open a public issue, discussion, or pull request about a suspected vulnerability
until it has been addressed.

We aim to acknowledge a valid report within **7 days**, and we will keep you informed
while we investigate and prepare a fix. When a fix ships, we will credit you in the
advisory unless you would rather stay anonymous.

### Scope

The collector (`/api/collect`) is designed to be reachable without authentication,
because it must accept anonymous beacons from every page you instrument. That means
anyone who can reach your instance can post synthetic signals into your own database.
This is by design, not a vulnerability. The endpoint is validate-only and write-only,
accepts only a strict anonymous whitelist, stores no IP address, user agent, or other
personal data, and is rate limited.

Reports that amount to "I can send data to the open collector" describe expected
behavior and are out of scope. In scope are: the collector storing personal data, a way
to read another origin's data through the read endpoints, injection or remote code
execution, and a way around the field whitelist.

The rate-limit behavior behind a reverse proxy, and how to keep the dashboard private
(it has no built-in authentication), are covered in [docs/self-hosting.md](docs/self-hosting.md).

---
<a id="turkce"></a>
## Türkçe

[English](#english) · **Türkçe**

### Desteklenen sürümler

RageClickRadar 1.0 öncesidir. Güvenlik düzeltmeleri en son `0.x` sürümüne gelir; eski
sürümler için geriye dönük yama çıkarılmaz. Bildirimde bulunmadan önce en güncel sürümde
olduğunuzdan emin olun.

### Güvenlik açığı bildirme

Güvenlik sorunlarını herkese açık bir issue yerine **özel olarak** bildirin.

Bu depoda GitHub'ın özel güvenlik açığı bildirimini kullanın: **Security → Report a
vulnerability**. Doğrudan şu adresten de açabilirsiniz:
https://github.com/IACBI/rageclickradar/security/advisories/new. Oluşturulan advisory
yalnızca size ve bakımcılara görünür.

Sorun giderilene kadar, şüphelenilen bir güvenlik açığı hakkında herkese açık bir issue,
tartışma ya da pull request açmayın.

Geçerli bir bildirimi **7 gün** içinde onaylamayı hedefliyoruz. İnceleme ve düzeltme
sürecinde sizi bilgilendireceğiz. Düzeltme yayımlandığında, anonim kalmayı tercih etmediğiniz
sürece advisory'de adınızı belirtiriz.

### Kapsam

`/api/collect` uç noktası, enstrümante ettiğiniz her sayfadan gelen anonim beacon'ları
kabul etmesi gerektiği için kimlik doğrulaması olmadan erişilebilir olacak şekilde
tasarlanmıştır. Bu yüzden örneğinize erişebilen herkes kendi veritabanınıza sentetik sinyal
gönderebilir. Bu bir güvenlik açığı değil, tasarımın bir parçasıdır. Uç nokta yalnızca
doğrulayan ve yalnızca yazan bir yapıdadır, katı bir anonim beyaz listeyi kabul eder, IP
adresi, user agent ya da başka bir kişisel veri saklamaz ve hız sınırlamasına tabidir.

"Açık toplayıcıya veri gönderebiliyorum" türündeki bildirimler beklenen davranıştır ve kapsam
dışıdır. Toplayıcının kişisel veri sakladığına, okuma uç noktaları üzerinden başka bir
origin'in verisine erişilebildiğine, enjeksiyona ya da uzaktan kod çalıştırmaya, ya da alan
beyaz listesinin atlatılmasına dair bildirimler ise kesinlikle kapsam içindedir.

Ters proxy arkasındaki hız sınırlama davranışı ile panoyu (yerleşik kimlik doğrulaması
olmadığı için) nasıl gizli tutacağınız [docs/self-hosting.md](docs/self-hosting.md)
dosyasında anlatılır.
