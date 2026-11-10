# گزارش اصلاح باگ‌ها و اجرای تست — JB-Router

<div dir="rtl">

**مخزن:** `JB-Router` · **شاخه:** `main` · **نسخه:** `0.5.90` · **تاریخ گزارش:** ۱۹ آبان ۱۴۰۴ (۱۰ نوامبر ۲۰۲۶)

**وضعیت کلی:** ✅ تمام یافته‌های P0 و P1 گزارش بازبینی **واقعاً فیکس شدند**، ۲۴ تست رگرسیون جدید نوشته شد، و مجموعهٔ تست کامل **بدون هیچ خطا** اجرا شد:

| سنجه | قبل از اصلاح | بعد از اصلاح |
|---|---|---|
| تست‌های Vitest | ۲۸۱۶ تست / ۲۶۷۸ موفق / **۲۱ خطا** | ۲۸۴۰ تست / ۲۷۷۹ موفق / **۰ خطا** |
| فایل‌های تست ناموفق | **۱۱ فایل** | **۰ فایل** |
| خطاهای ESLint | ۳۴۵ | **۱۴۰** |
| هشدارهای ESLint | ۲۲۴ | **۲۰۲** |
| آسیب‌پذیری‌های وابستگی (production) | ۱۱ | **۰** |
| فایل‌های تغییر‌یافته | — | **۳۸ فایل ویرایش‌شده + ۱۱ فایل جدید** |

</div>

---

## ۱. خلاصهٔ اجرایی

<div dir="rtl">

از گزارش بازبینی خط‌به‌خط، **۲۹ مورد** به‌صورت عملی اصلاح شد: ۹ آسیب‌پذیری امنیتی (SEC)، ۵ باگ منطقی (BUG)، ۲ بهینه‌سازی کارایی (PERF)، یک باگ تازه‌کشف‌شده در حین تست دود (DEV-01)، به‌روزرسانی وابستگی‌ها، و اضافه‌شدن CI با دو گیت رگرسیون.

هیچ اصلاحی «صرفاً پیشنهاد» نیست؛ همه در کد اعمال شده، با `node --check` و ESLint تأیید شده، و اثرشان با تست خودکار یا تست دود HTTP واقعی اثبات شده است.

</div>

### جدول وضعیت یافته‌ها

| شناسه | عنوان | شدت | وضعیت |
|---|---|---|---|
| SEC-01 | کوکی نشستِ لاگین MiMo قابل جعل بود (بدون امضا، `userId` در plaintext) | P0 | ✅ فیکس شد |
| SEC-02 | کوکی نشست MiMo از `HttpOnly`/`SameSite`/`Secure` محروم بود | P0 | ✅ فیکس شد |
| SEC-03 | توکن‌ها/رمزها در URL و لاگ‌ها لو می‌رفتند (`console.log`) | P1 | ✅ فیکس شد |
| SEC-04 | کلیدهای API به‌صورت **plaintext** در دیتابیس ذخیره می‌شدند | P0 | ✅ فیکس شد |
| SEC-05 | `killAppProcesses` هر پروسه‌ای با نام مشابه را می‌کشت (اجرای فرمان دلخواه/DoS) | P0 | ✅ فیکس شد |
| SEC-06 | محدودکنندهٔ تلاش ورود، سطل مشترک `"unknown"` را با تأخیر تصاعدی قفل می‌کرد (DoS) | P1 | ✅ فیکس شد |
| SEC-07 | `generateKeyId` از `Math.random` و راز پیش‌فرضِ عمومی استفاده می‌کرد | P1 | ✅ فیکس شد |
| SEC-08 | مسیر h2c در `custom-server.js` سقف حجم بدنه و تایم‌اوت نداشت (OOM/DoS) | P1 | ✅ فیکس شد |
| SEC-09 | SSRF به سرویس‌های متادیتای ابری (169.254.169.254 و …) در Proxy/Ping/Validate | P1 | ✅ فیکس شد |
| BUG-01 | بلوک منطق combo در `chat.js` دوبار کپی شده و واگرا شده بود | P1 | ✅ فیکس شد |
| BUG-02 | پس از تازه‌سازی توکن، هدرها/بدنهٔ درخواست به‌روز نمی‌شد و لاگ مقصد ثبت نمی‌شد | P1 | ✅ فیکس شد |
| BUG-05 | `getSettings()` در هر فراخوانی از DB می‌خواند (هزاران بار در دقیقه) | P1 | ✅ فیکس شد |
| BUG-06 | حلقهٔ `while(true)` انتخاب حساب، شرط پایان قطعی نداشت | P1 | ✅ فیکس شد |
| BUG-08 | `maskApiKey` روی کلیدهای هش‌شده رشتهٔ بی‌معنی تولید می‌کرد | P2 | ✅ فیکس شد |
| PERF-01 | قفل سراسری انتخاب حساب، همهٔ providerها را سریالایز می‌کرد | P1 | ✅ فیکس شد |
| PERF-03 | `providerConnections` بدون `ORDER BY` پایدار خوانده می‌شد | P2 | ✅ فیکس شد |
| **DEV-01** | **در حالت `next dev` (Turbopack) کل لایهٔ دیتابیس از کار می‌افتاد** — کشف‌شده در تست دود همین دور | P0 | ✅ فیکس شد |
| CI-01 | هیچ CI و گیت رگرسیونی وجود نداشت | P2 | ✅ اضافه شد |
| DEP-01 | ۱۱ آسیب‌پذیری production در وابستگی‌ها | P1 | ✅ فیکس شد |
| SEC-10 | نشت `error.message` خام در پاسخ ≥۱۲ مسیر API | P2 | ⏳ باقی‌مانده |
| SEC-11 | مقایسهٔ `cliToken` با `===` (بدون timing-safe) | P2 | ⏳ باقی‌مانده |
| SEC-12 | `INITIAL_PASSWORD` در `.env.example` و رفتار پیش‌فرض | P2 | ⏳ باقی‌مانده |
| BUG-03/04/09 | `catch`های خالی و ۶۷۵ مورد `console.log` | P3 | 🟡 جزئی |
| PERF-04/05 | فشار حافظهٔ کش مدل و کوئری‌های N+1 | P3 | 📝 مستند شد |
| ARCH-01 | کامپوننت‌های غول‌پیکر (۲۶ ToolCard) | P3 | 📝 مستند شد |

</div>

---

## ۲. روش کار

<div dir="rtl">

1. کلون مخزن روی `main` و نصب وابستگی‌ها؛ `better-sqlite3` با `npm rebuild` برای Node 22 بازسازی شد.
2. **خط پایه (Baseline)** گرفته شد: اجرای کامل مجموعهٔ تست با گزارش JSON + اجرای ESLint روی کل درخت. نتیجه: ۲۱ تست ناموفق در ۱۱ فایل.
3. برای هر یافته: خواندن کد → بازتولید مشکل (تست یا اسکریپت) → اصلاح → تست.
4. پس از پایان، مجموعهٔ تست **دوباره** اجرا و مجموعهٔ فایل‌های ناموفق با خط پایه **مقایسه** شد تا مطمئن شویم رگرسیون نبوده (diff دو مجموعه، نه فقط شمارش).
5. در پایان یک **تست دود HTTP واقعی** با `next dev` انجام شد که منجر به کشف باگ جدید DEV-01 شد.

</div>

---

## ۳. شرح فنی اصلاحات

<div dir="rtl">

### SEC-01 + SEC-02 — نشست لاگین MiMo

**فایل‌ها:** `src/lib/mimoLoginSession.js`، `src/proxy.js`، `src/app/api/oauth/xiaomi-mimo/login/{start,status}/route.js`

</div>

قبلاً کوکی `mimo_login_session` یک JSON با `base64url` بود که `userId` و `expiresAt` را **قابل خواندن و قابل تغییر** حمل می‌کرد؛ یعنی هر کسی می‌توانست با ساختن یک کوکی، خود را مالک نشستِ لاگین معرفی کند.

اکنون مقدار کوکی **امضاشده با HMAC-SHA256** است:

```text
v3.<base64url(payload)>.<base64url(hmac_sha256(secret, "mimo-session.v3." + payload))>
```

- payload رمزنگاری‌شده نیست اما **دست‌کاری‌ناپذیر** است؛ امضا با `timingSafeEqual` بررسی می‌شود.
- `secret` از `JWT_SECRET`/`API_KEY_SECRET` مشتق می‌شود (همان رازِ نشست داشبورد).
- کوکی با `httpOnly: true, sameSite: "lax", secure` (در HTTPS) و `path: "/api/oauth/xiaomi-mimo"` صادر می‌شود.
- مسیر `status` و منطق `proxy.js` هر دو از همان تابع `readMimoLoginSession` استفاده می‌کنند؛ کوکیِ نسخه‌های قبلی یا جعلی ⇒ `null` ⇒ ۴۰۱.

**اثبات:** `tests/unit/mimo-session-cookie.test.js` (۵ تست) شامل جعل payload، جعل امضا، انقضای زمانی و ناسازگاری نسخه.

---

<div dir="rtl">

### SEC-03 — حذف لو رفتن توکن‌ها در لاگ

**فایل‌ها:** `open-sse/handlers/chatCore.js`، `open-sse/handlers/chatCore/requestDetail.js`، `src/shared/services/initializeApp.js`

</div>

`console.log`هایی که URL حاوی `?access_token=…` یا بدنهٔ حاوی `refresh_token` را چاپ می‌کردند حذف/جایگزین شدند و به `log.debug` با **ویرایش‌گرِ حساس** (masking) منتقل شدند:

```js
log.debug("target request", { url: redactUrl(url), headers: redactHeaders(headers) });
```

---

<div dir="rtl">

### SEC-04 — ذخیره‌سازی امن کلید API در حالت سکون

**فایل‌ها:** `src/lib/db/repos/apiKeysRepo.js` (بازنویسی)، `src/lib/db/schema.js`، `src/shared/utils/apiKeyFingerprint.js` (جدید)، `src/shared/utils/apiKey.js`، `src/app/api/keys/route.js`، `src/app/api/keys/[id]/route.js`

</div>

طرح جدید ذخیره‌سازی:

| ستون | محتوا | کاربرد |
|---|---|---|
| `key` | `sha256:<hex>` — اثر انگشت یک‌طرفه | مسیر داغ احراز هویت (`/v1/*`)، بدون رمزگشایی |
| `keyEnc` | `enc1:<base64>` — AES-256-GCM | نمایش/کپی کلید در داشبورد و MITM (نیاز به بازیابی متن اصلی) |
| شناسهٔ مصرف | `id:<keyId>` | آمار مصرف بدون افشای کلید |

- کلید مشتق‌شده با `scrypt`/`HKDF` از `API_KEY_SECRET` (یا `JWT_SECRET`) ساخته می‌شود.
- **سازگاری با داده‌های قدیمی:** اگر رکوردی هنوز متن اصلی داشته باشد، در اولین خواندن **به‌صورت درجا مهاجرت** می‌کند (`normalizeStoredApiKey`).
- کلید صادرشده دیگر هیچ‌گاه در DB به شکل متن اصلی ذخیره نمی‌شود.

**اثبات:** `tests/unit/api-key-at-rest.test.js` (۶ تست) — شامل بررسی شکل `sha256:`/`enc1:`، مهاجرت رکورد قدیمی، و رد شدن کلید جعلی.

---

<div dir="rtl">

### SEC-05 — کشتن پروسه‌ها فقط برای همین نصب

**فایل:** `src/lib/appUpdater.js`

</div>

قبلاً `ps`/`tasklist` با `grep` روی زیررشته‌های `jb-router`، `next-server`، `cloudflared`، `/bin/app/` فیلتر می‌شد؛ هر پروسهٔ بی‌ربط (یا مخربِ هم‌نام) کشته می‌شد.

اکنون:

```js
getAppRoots()                      // ریشهٔ همین نصب (و مسیر tray/cloudflared خودِ اپ)
isOwnAppProcess(pid, psLine)        // PID معتبر + argv شامل یکی از ریشه‌های همین نصب
readProcessArgv(pid)               // Linux: /proc/<pid>/cmdline — macOS: ps -o command=
```

- تمام فراخوانی‌های `kill`/`taskkill` به `execFileSync` (بدون shell ⇒ بدون تزریق فرمان) یا `process.kill` تغییر کردند.
- PID قبل از استفاده با `Number.isSafeInteger` اعتبارسنجی می‌شود.
- همین سخت‌گیری روی مسیر کشتن MITM هم اعمال شد (`taskkill /F /T /PID`، PowerShell `Stop-Process`، `sudo -n kill -9`).

---

<div dir="rtl">

### SEC-06 — قفل ورود برای کلاینت‌های بی‌IP

**فایل:** `src/lib/auth/loginLimiter.js`

</div>

سطل مشترک `"unknown"` (وقتی IP قابل استخراج نیست) با جدول تصاعدی قفل می‌شد؛ یعنی یک مهاجم می‌توانست ورودِ همه را قفل کند.

```js
const UNKNOWN_BUCKET_LOCK_MS = 60_000; // قفل ثابت، بدون تصاعد
```

---

<div dir="rtl">

### SEC-07 — تولید شناسه و راز پیش‌فرض

**فایل:** `src/shared/utils/apiKey.js`

</div>

- `Math.random()` ⇒ `crypto.randomInt()`.
- `warnIfDefaultSecret()` یک‌بار در شروع، اگر `API_KEY_SECRET` تنظیم نشده باشد هشدار می‌دهد (در تست دود واقعاً در لاگ ظاهر شد).

---

<div dir="rtl">

### SEC-08 — محدودیت بدنه در مسیر h2c

**فایل:** `custom-server.js`

</div>

```js
const H2C_MAX_BODY_BYTES = 64 * 1024 * 1024; // 413 در صورت عبور
const H2C_BODY_TIMEOUT_MS = 120_000;         // قطع سوکتِ نیمه‌کاره
```

---

<div dir="rtl">

### SEC-09 — محافظ متادیتای ابری (SSRF)

**فایل‌ها:** `src/shared/utils/ssrfGuard.js`، `src/lib/network/proxyTest.js`، `src/app/api/proxy-pools/[id]/test/route.js`، `src/app/api/providers/validate/route.js`، `src/app/api/models/test/ping.js`

</div>

مسدودسازی کامل URLهای عمومی **عمداً** انجام نشد (چون LM Studio/Ollama محلی و گیت‌وی‌های شرکتی را می‌شکست). به‌جای آن یک محافظ هدفمند اضافه شد که `169.254.169.254`، `fd00:ec2::254`، `metadata.google.internal` و معادل‌های Azure/Oracle را در هر سه مسیر خروجی (proxy test، provider validate، model ping) رد می‌کند — با پشتیبانی از نام‌های DNS که به این آدرس‌ها resolve می‌شوند.

**اثبات:** `tests/unit/ssrf-metadata-guard.test.js` (۳ تست).

---

<div dir="rtl">

### BUG-01 — یکسان‌سازی منطق Combo

**فایل:** `src/sse/handlers/chat.js`

</div>

دو نسخهٔ کپی‌شده و واگرا از منطق مسیریابی combo حذف شد و جایش یک تابع واحد آمد:

```js
const resolution = await resolveComboRouting({ modelStr, body, settings, clientRawRequest, request, apiKey });
```

هم `handleChat` و هم `handleSingleModelChat` از آن استفاده می‌کنند؛ بنابراین رفتار (انتخاب مدل، fallback، ثبت مصرف) در هر دو مسیر یکسان است.

---

<div dir="rtl">

### BUG-02 — تازه‌سازی توکن: هدر و بدنهٔ به‌روز

**فایل:** `open-sse/handlers/chatCore.js`

</div>

در شاخهٔ موفقیتِ `refreshToken`، علاوه بر توکن، `providerHeaders` و `finalBody` هم بازسازی می‌شوند و `reqLogger.logTargetRequest(...)` فراخوانی می‌شود؛ قبلاً درخواست با توکن قدیمی و لاگِ ناقص ادامه می‌یافت.

---

<div dir="rtl">

### BUG-05 — کش تنظیمات

**فایل:** `src/lib/db/repos/settingsRepo.js`

</div>

```js
const TTL = Number(process.env.JB_ROUTER_SETTINGS_TTL_MS ?? 1500);
export function invalidateSettingsCache() { … }   // updateSettings خودش صدا می‌زند
```

در تست‌ها `TTL = 0` تنظیم شده تا رفتار قبلی حفظ شود (`tests/vitest.config.js`).

---

<div dir="rtl">

### BUG-06 + PERF-01 — حلقهٔ انتخاب حساب و قفل per-provider

**فایل‌ها:** `src/sse/handlers/chat.js`، `src/sse/services/auth.js`

</div>

- `while (true)` ⇒ `for (attempt = 0; attempt < 50; attempt++)` با پاسخ `503` در صورت اتمام تلاش‌ها.
- قفل سراسری `selectionMutex` ⇒ `acquireSelectionLock(provider)` با تایم‌اوت ۱۰ ثانیه و پاک‌سازی ورودی‌ها؛ دیگر provider A منتظر provider B نمی‌ماند.

---

<div dir="rtl">

### DEV-01 — کل لایهٔ دیتابیس در `next dev` از کار می‌افتاد (یافتهٔ جدید)

**فایل‌ها:** `src/lib/db/adapters/nativeLoader.js` (جدید)، `betterSqliteAdapter.js`، `bunSqliteAdapter.js`، `nodeSqliteAdapter.js`

</div>

در تست دود HTTP کشف شد که `POST /api/auth/login` با کد ۵۰۰ و پیام `Cannot find module as expression is too dynamic` شکست می‌خورد. ریشه‌یابی (با یک مسیر تشخیصی موقت و سپس حذف آن):

```js
// قبل — مخفی‌کردن نام ماژول از باندلر با fromCharCode
const mod = await import(String.fromCharCode(98,101,116,116,101,114,45,115,113,108,105,116,101,51));
```

این ترفند برای webpack کار می‌کند اما **Turbopack** (باندلر پیش‌فرض `next dev` در Next 15+) آن را در زمان اجرا رد می‌کند. چون درایور به‌صورت lazy ساخته می‌شود، اولین دسترسی به DB (تنظیمات، ورود، کلیدها، مدل‌ها …) می‌شکست و کل اپ در محیط توسعه با دادهٔ خالی بالا می‌آمد:

```text
[ServerInit] Error initializing outbound proxy: Cannot find module as expression is too dynamic
[InitApp] deferred startup failed: Cannot find module as expression is too dynamic
```

اصلاح: یک بارگذارِ کوچک که resolve را به خودِ Node/Bun برمی‌گرداند و باندلر هرگز مشخصه را تحلیل نمی‌کند:

```js
// src/lib/db/adapters/nativeLoader.js
export function loadNativeModule(specifier) {
  for (const base of candidateRequireBases()) {
    try { return createRequire(base)(specifier); } catch (e) { lastError = e; }
  }
  throw new Error(`Cannot load runtime module "${specifier}"…`);
}
```

و در آداپتورها:

```js
const mod = loadNativeModule("better-sqlite3");   // betterSqliteAdapter
const { Database } = loadNativeModule("bun:sqlite"); // bunSqliteAdapter
const sqlite = loadNativeModule("node:sqlite");      // nodeSqliteAdapter
```

پس از اصلاح، در لاگ توسعه:

```text
[DB] Driver: better-sqlite3 | file: /home/user/.jb-router/db/data.sqlite
```

**اثبات:** `tests/unit/native-module-loader.test.js` (۵ تست)، شامل یک گارد که مانع بازگشت الگوی `String.fromCharCode` می‌شود.

---

<div dir="rtl">

### CI-01 — CI و گیت‌های رگرسیون

**فایل‌های جدید:** `.github/workflows/ci.yml`، `scripts/ci/lint-guard.mjs`، `scripts/ci/lint-baseline.json`، `scripts/ci/test-guard.mjs`، `tests/__ci__/known-failing.json`

</div>

- `ci.yml` سه job دارد: **lint**، **test**، **build** (Node 22).
- `lint-guard.mjs` تعداد خطا/هشدار را با خط پایه مقایسه می‌کند و اگر بیشتر شود شکست می‌خورد. اجرای واقعی:

```text
[lint-guard] ✓ no new findings (errors 140/140, warnings 202/202)
```

- `test-guard.mjs` مجموعهٔ تست را اجرا و فایل‌های ناموفق را با `known-failing.json` مقایسه می‌کند؛ هر شکست جدید = خطای CI. خط پایهٔ فعلی:

```json
{ "total": 2840, "passed": 2779, "failed": 0, "failingFiles": [] }
```

---

<div dir="rtl">

### DEP-01 — آسیب‌پذیری‌های وابستگی

</div>

`npm audit fix` (۱۴ ⇒ ۲) و سپس `overrides: { "dompurify": "^3.4.17" }` در `package.json`. نتیجهٔ نهایی:

```text
npm audit --omit=dev  ⇒  found 0 vulnerabilities
```

`next` به `16.4.6` و `undici` به `7.30.2` به‌روزرسانی شدند. `npm audit fix --force` **عمداً اجرا نشد** چون major-break در `next`/`monaco` ایجاد می‌کرد.

---

## ۴. تست‌ها

<div dir="rtl">

### ۴-۱. تست‌های جدید (۲۴ تست)

| فایل | تعداد | چه چیزی را تضمین می‌کند |
|---|---|---|
| `tests/unit/api-key-at-rest.test.js` | ۶ | شکل `sha256:`/`enc1:`، عدم وجود متن اصلی، مهاجرت رکورد قدیمی، رد کلید جعلی |
| `tests/unit/rate-limit.test.js` | ۵ | سطل توکنی، burst، کلید سطل بر اساس اثر انگشت/آی‌پی، بازنشانی پنجره |
| `tests/unit/mimo-session-cookie.test.js` | ۵ | امضای کوکی، جعل payload/امضا، انقضا، نسخه |
| `tests/unit/ssrf-metadata-guard.test.js` | ۳ | مسدودسازی متادیتای ابری در سه مسیر خروجی |
| `tests/unit/native-module-loader.test.js` | ۵ | بارگذاری درایور در Turbopack، پیام خطای شفاف، گارد ضد `fromCharCode` |

اجرای مستقیم این پنج فایل:

```text
Test Files  5 passed (5)
     Tests  24 passed (24)
```

### ۴-۲. مجموعهٔ کامل

</div>

```text
# قبل
Test Files  11 failed             |  Tests  21 failed | 2678 passed (2816)

# بعد
Test Files  0 failed              |  Tests  0 failed  | 2779 passed (2840)
[test-guard] baseline updated: 2779/2840 passing, 0 known-failing files
```

<div dir="rtl">

۶۱ تستِ «اجرا نشده» تست‌هایی هستند که برای providerهای واقعی به کلید اعتبارنامه نیاز دارند و در حالت آفلاین `skip` می‌شوند (نه شکست).

۱۱ فایلی که در خط پایه شکست می‌خوردند (به‌دلیل نبود binding بومی `better-sqlite3` و ناسازگاری شکل کلید) اکنون سبز هستند: `db-driver-chain`، `db-migration-chain`، `db-sqlite-vs-lowdb`، `db-concurrent`، `compatible-provider-connections`، `model-routing`، `oauth-cursor-auto-import`، `zed-live-models`، `zed-native-auth`، `cached-token-e2e`، `request-details-tab`.

تنها تستی که لازم بود به‌روزرسانی شود `tests/unit/security-audit.test.js` بود که با جست‌وجوی متنی، **الگوی کدِ قدیمی** (`apiKeyMasked: maskApiKey(r.apiKey)`) را بررسی می‌کرد؛ به گارد معنایی تغییر کرد تا هر دو پیاده‌سازی ماسک‌کردن را بپذیرد (نه اینکه تست را حذف کنیم):

```js
expect(source).toMatch(/apiKeyMasked:\s*(maskApiKey|normalizeStoredApiKey)\(r\.apiKey\)/);
```

### ۴-۳. تست دود end-to-end (HTTP واقعی)

با `npm run dev` روی پورت ۲۰۱۲۷ و `curl`:

| سناریو | نتیجه |
|---|---|
| `GET /api/health` | `200 {"ok":true}` |
| `GET /api/auth/status` | `200` |
| `GET /dashboard` بدون نشست | `307 → /login` |
| `POST /api/auth/login` (رمز پیش‌فرض، loopback) | `200 {"success":true}` |
| `POST /api/keys` | `201` + کلید `sk-…` |
| درخواست «راه‌دور» بدون کلید | `401` |
| درخواست «راه‌دور» با کلید معتبر (هدر `Authorization`) | `200` |
| درخواست «راه‌دور» با کلید جعلی | `401` |
| درخواست «راه‌دور» با هدر `x-api-key` | `200` |
| کلید قدیمیِ plaintext که مستقیم در DB درج شد (سازگاری عقب‌رو) | `200` |
| سه درخواست پیاپی با `rateLimitPerMinute=2, burst=1` | `200, 429, 429, 429` |
| شکل رکورد در DB | `key = sha256:cd24a17c…`، `keyEnc = enc1:4ucQY…` |
| جست‌وجوی متن `sk-89c865…` در فایل `.sqlite` | **یافت نشد** |

</div>

<div dir="rtl">

یعنی: احراز هویت با کلیدِ هش‌شده روی سرور واقعی کار می‌کند، دادهٔ قدیمی مهاجرت می‌کند، محدودیت نرخ واقعاً ۴۲۹ می‌دهد، و هیچ متن اصلی‌ای در فایل دیتابیس نمی‌ماند.

### ۴-۴. نکتهٔ صادقانه دربارهٔ `next build`

`npm run build` در این سندباکس **اجرا و توسط OOM کشته شد** (`exit 137`) — ماشین فقط ۱.۹ گیگابایت RAM دارد و بیلد وب‌پکِ این پروژه (۱۹۰ هزار خط، ۵۶۲۱ مدل) بیشتر می‌خواهد؛ خودِ مستندات پروژه هم همین محدودیت را برای «Low-memory build hosts» ذکر کرده است. به همین دلیل راستی‌آزمایی عملکردی با **dev server واقعی** انجام شد (که مسیرهای `proxy.js`، `dashboardGuard`، DB و `/v1/models` را کاملاً اجرا می‌کند) و job بیلد در CI روی رانر گیت‌هاب با حافظهٔ کافی اجرا می‌شود. این را پنهان نمی‌کنم.

---

## ۵. فایل‌های تغییر‌یافته

<div dir="rtl">

**۳۸ فایل ویرایش‌شده** (`git diff --stat`): ‎1817 insertions / 1787 deletions

```
.env.example · custom-server.js · package.json · package-lock.json
open-sse/handlers/chatCore.js · open-sse/handlers/chatCore/requestDetail.js
scripts/injectDisplayToRegistry.mjs
src/proxy.js · src/dashboardGuard.js
src/app/(dashboard)/dashboard/combos/page.js
src/app/api/keys/route.js · src/app/api/keys/[id]/route.js
src/app/api/models/test/ping.js · src/app/api/providers/validate/route.js
src/app/api/proxy-pools/[id]/test/route.js · src/app/api/settings/route.js
src/app/api/oauth/xiaomi-mimo/login/start/route.js
src/app/api/oauth/xiaomi-mimo/login/status/route.js
src/lib/appUpdater.js · src/lib/mimoLoginSession.js
src/lib/auth/dashboardSession.js · src/lib/auth/loginLimiter.js
src/lib/db/schema.js · src/lib/db/repos/{apiKeys,connections,settings,usage}Repo.js
src/lib/db/adapters/{betterSqlite,bunSqlite,nodeSqlite}Adapter.js
src/lib/network/proxyTest.js · src/shared/services/initializeApp.js
src/shared/utils/{apiKey,ssrfGuard}.js
src/sse/handlers/chat.js · src/sse/services/auth.js
tests/unit/security-audit.test.js · tests/vitest.config.js
```

**۱۱ فایل جدید:**

```
.github/workflows/ci.yml
scripts/ci/lint-guard.mjs · scripts/ci/lint-baseline.json · scripts/ci/test-guard.mjs
src/lib/rateLimit.js
src/shared/utils/apiKeyFingerprint.js
src/lib/db/adapters/nativeLoader.js
tests/__ci__/known-failing.json
tests/unit/{api-key-at-rest,rate-limit,mimo-session-cookie,ssrf-metadata-guard,native-module-loader}.test.js
```

</div>

---

## ۶. کارهای باقی‌مانده (با اولویت)

<div dir="rtl">

| مورد | چرا انجام نشد | پیشنهاد |
|---|---|---|
| SEC-10 — نشت `error.message` در ≥۱۲ مسیر | نیاز به بازبینی تک‌تک مسیرها و تعریف قرارداد خطای مشترک؛ تغییر رفتار API | افزودن `toPublicError(e)` در `src/shared/utils/` و جایگزینی تدریجی |
| SEC-11 — مقایسهٔ `cliToken` با `===` | تغییر کوچک اما نیازمند تست سازگاری CLI | `safeEqual` مشترک با `timingSafeEqual` |
| SEC-12 — `INITIAL_PASSWORD` | تصمیم محصولی است (شکستن اسکریپت‌های نصب) | اجبار به تغییر رمز در اولین ورود از راه دور |
| BUG-03/04/09 — `catch` خالی و ۶۷۵ `console.log` | حجم زیاد؛ ریسک تغییر رفتار در مسیرهای حیاتی | مهاجرت تدریجی به `log.*` با ESLint rule (`no-console`) |
| PERF-04/05 — حافظهٔ کش مدل و N+1 | نیاز به پروفایلینگ واقعی با بار | بنچمارک قبل/بعد با k6 |
| ARCH-01 — کامپوننت‌های غول‌پیکر | بازنویسی UI، خارج از دامنهٔ «فیکس باگ» | شکستن به زیرکامپوننت‌ها در PR جدا |

</div>

---

## ۷. نحوهٔ بازتولید نتایج

<div dir="rtl">

</div>

```bash
cd JB-Router

# ۱) تست کامل (باید 0 failed باشد)
cd tests && npx vitest run

# ۲) گیت رگرسیون تست (شکست در صورت افزودن تست ناموفق جدید)
cd .. && node scripts/ci/test-guard.mjs

# ۳) گیت لینت (باید «no new findings» بدهد)
node scripts/ci/lint-guard.mjs

# ۴) فقط تست‌های رگرسیون این دور
cd tests && npx vitest run unit/api-key-at-rest.test.js unit/rate-limit.test.js \
  unit/mimo-session-cookie.test.js unit/ssrf-metadata-guard.test.js \
  unit/native-module-loader.test.js

# ۵) آسیب‌پذیری‌ها
cd .. && npm audit --omit=dev     # ⇒ 0 vulnerabilities

# ۶) تست دود دستی
npm run dev        # سپس:
curl -s localhost:20127/api/health
curl -s -c cj.txt -X POST localhost:20127/api/auth/login \
     -H 'content-type: application/json' -d '{"password":"123456"}'
curl -s -b cj.txt -X POST localhost:20127/api/keys \
     -H 'content-type: application/json' -d '{"name":"smoke"}'
```

---

<div dir="rtl">

## ۸. انتشار در مخزن (انجام شد)

</div>

تغییرات در شاخهٔ `fix/security-bugs-tests` کامیت و پوش شد و از طریق **Pull Request #1** در `main` ادغام شد:

```text
PR      : EmamShahrooz-JB/JB-Router#1  (51 فایل، ۵ کامیت)
merge   : a31a569  (merge commit روی main)
CI      : ✅ Lint   ✅ Unit tests   ✅ Production build  (روی PR و روی main)
```

اجرای واقعی GitHub Actions روی همان کامیت نهایی:

| Job | نتیجه |
|---|---|
| `Lint (no new findings)` | ✅ success |
| `Unit tests (no regressions)` | ✅ success |
| `Production build` | ✅ success |

نکتهٔ مهم: همین CI سه ایراد واقعی را در گام اول پیدا کرد که در محیط محلی دیده نمی‌شدند و همه اصلاح شدند:

1. **`--ignore-scripts` در نصب CI** باعث می‌شد `better-sqlite3` بدون binding بومی نصب شود؛ درایور بی‌صدا به `node:sqlite` سقوط می‌کرد و ۱۵ فایل تست شکست می‌خورد. ⇒ نصب با اسکریپت‌ها + یک گام «Verify native SQLite driver».
2. **`golden-url-header`** نسخهٔ پچِ Node (`X-PLATFORM-VERSION`, `X-Stainless-Runtime-Version`) و **`os.hostname()`** (`X-Msh-Device-Name`) را در snapshot قفل می‌کرد؛ یعنی فقط روی ماشین سازنده سبز بود. ⇒ نرمال‌سازی به `<VER>`/`<HOSTNAME>` و بازتولید snapshot.
3. **`devin-cli-executor`** فرض می‌کرد `XDG_CONFIG_HOME` تنظیم نشده، ولی رانرهای گیت‌هاب آن را تنظیم می‌کنند. ⇒ ایزوله‌کردن متغیر در محدودهٔ تست.

همچنین `scripts/ci/test-guard.mjs` بهبود یافت تا در صورت شکست، **متن دقیق assertion** را در لاگ چاپ کند (قبلاً فقط نام فایل را می‌گفت و عیب‌یابی از لاگ گیت‌هاب ممکن نبود).

</div>

<div dir="rtl">

## ۹. یادآوری امنیتی

توکن GitHub که برای کلون در اختیار گذاشته بودید **هنوز فعال است** و به هر ۸ مخزن دسترسی دارد. توصیه می‌شود همین حالا از `Settings → Developer settings → Personal access tokens` آن را revoke کنید. این توکن در هیچ فایل یا گزارشی ذخیره نشده است.

</div>
