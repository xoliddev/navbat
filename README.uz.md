<div align="center">

# Navbat

**Oʻzbekistondagi sartaroshxona, goʻzallik saloni, klinika va avtoservislar uchun onlayn navbat
tizimi — Telegram bot, mijozlar uchun Telegram Mini App va jamoa uchun admin panel.**

[English](README.md) · Oʻzbekcha

[![Jonli demo](https://img.shields.io/badge/jonli%20demo-xoliddev.github.io%2Fnavbat-2346d4?style=flat-square)](https://xoliddev.github.io/navbat/)
[![CI](https://github.com/xoliddev/navbat/actions/workflows/ci.yml/badge.svg)](https://github.com/xoliddev/navbat/actions/workflows/ci.yml)
[![Pages](https://github.com/xoliddev/navbat/actions/workflows/pages.yml/badge.svg)](https://github.com/xoliddev/navbat/actions/workflows/pages.yml)
[![Litsenziya: MIT](https://img.shields.io/badge/litsenziya-MIT-f2b233?style=flat-square)](LICENSE)

<img src="docs/media/booking-flow.gif" width="300" alt="Mini Appʼda navbat olish: xizmat, usta, kun, vaqt, sandbox toʻlov va navbat chiptasi" />

</div>

Mijoz botni ochadi, xizmat, usta va vaqtni tanlaydi — va qoʻliga navbat chiptasi tushadi. Bot
navbatni tasdiqlaydi, tashrifdan 24 soat va 2 soat oldin eslatadi, bitta tugma bilan
“kechikyapman” deyish yoki bekor qilish imkonini beradi. Jamoa esa barcha navbatlarni
kalendarda koʻradi: sudrab boshqa vaqtga oʻtkazadi, oʻzi kelgan mijozni qoʻshadi, vaqtni band
qiladi va hisobotlarni kuzatadi.

## Jonli demo

**[xoliddev.github.io/navbat](https://xoliddev.github.io/navbat/)** — server ham, roʻyxatdan oʻtish ham kerak emas.

Chapdagi telefonda navbat oling — tasdiq oʻngdagi bot chatiga keladi. Keyin **Admin panel**ni
oching va navbatingizni kalendardan toping. Uni sudrab boshqa vaqtga qoʻying — mijoz chatiga
“Navbat koʻchirildi” xabari keladi. Rolni *Usta (Jasur)*ga almashtirib, usta nimani koʻrishini
tekshiring yoki *Tahlil* boʻlimidan CSV yuklab oling.

| Demoda nima ishlaydi | Haqiqiymi yoki taqlidmi |
| --- | --- |
| Slot dvigateli, navbat qoidalari, holatlar mashinasi, rollar | **Haqiqiy** — productionʼdagi `@navbat/core` kodining oʻzi |
| Maʼlumotlar bazasi | **Haqiqiy PostgreSQL**, WebAssemblyʼga kompilyatsiya qilingan ([PGlite](https://pglite.dev)): xuddi shu SQL migratsiyalar, `btree_gist` cheklovi bilan; IndexedDBʼda saqlanadi |
| Servislar (yaratish, koʻchirish, bekor qilish, baho, tahlil, CSV) | **Haqiqiy** — API chaqiradigan `@navbat/db` funksiyalari |
| Bot xabarlari | `@navbat/core`dagi **haqiqiy shablonlar**; chat oynasining oʻzi taqlid (Telegram yoʻq) |
| Eslatmalarni yetkazish | Taqlid: vaqti kelgan xabarlar har 2 soniyada yetkaziladi, kelajakdagilarini “Hozir yuborish” bilan koʻrish mumkin |
| Oldindan toʻlov | Sandbox provayder (pul yechilmaydi); Payme, Click va Stars adapterlari APIʼda bor |
| Telegram WebApp | Taqlid: MainButton, BackButton va vibratsiyani sahifaning oʻzi chizadi |

Demo bugungi sanaga nisbatan *Demo Barbershop*ni yaratadi (ikki filial, toʻrt usta, sakkiz
xizmat, 5 haftalik tarix), shuning uchun kalendar va tahlil har doim “jonli” koʻrinadi.
*Demoni tiklash* tugmasi hammasini boshidan boshlaydi.

## Skrinshotlar

| Mini App va bot chati | Admin kalendari |
| --- | --- |
| ![Boʻsh vaqt koʻrsatkichli kalendar va bot chati](docs/media/desktop-calendar.webp) | ![Har bir usta uchun alohida ustunli kunlik koʻrinish](docs/media/admin-calendar.webp) |
| ![Navbat chiptasi va botdagi tasdiq](docs/media/desktop-ticket.webp) | ![Tahlil: navbatlar, tushum, bandlik, ommabop xizmatlar](docs/media/admin-analytics.webp) |
| ![Oldindan toʻlov uchun sandbox oyna](docs/media/desktop-checkout.webp) | ![Tashriflar va kelmaganlar soni bilan mijozlar roʻyxati](docs/media/admin-clients.webp) |

## Imkoniyatlar

**Mijozlar uchun (Telegram Mini App)**
- Xizmat → usta (yoki *istalgan usta*) → kun → vaqt → ism va telefon. Bir tashrifda bir nechta xizmat.
- Oylik kalendar: har bir kun ostidagi firuza chiziq oʻsha kuni qancha boʻsh vaqt qolganini koʻrsatadi.
- Navbatlarim, vaqtni oʻzgartirish, belgilangan muddatgacha bekor qilish, “kechikyapman”, tashrifni baholash.
- Toʻgʻridan-toʻgʻri havolalar: `?startapp=master_<id>`, `service_<id>`, `booking_<id>` (botda `/start master_<id>`).
- Telegramga xos his: MainButton, BackButton, vibratsiya, mavzu ranglari, xavfsiz hududlar;
  oddiy brauzerda esa WebApp taqlidi bilan ishlaydi.

**Bot (grammY)**
- Havola parametri bilan `/start`, til tanlash (oʻzbek / rus / ingliz), `/bookings`, `/language`.
- Tasdiq, 24 soat va 2 soat oldingi eslatmalar (*kechikyapman* va *bekor qilish* tugmalari bilan), baho soʻrovi.
- Yangi, koʻchirilgan va bekor qilingan navbatlar haqida egasi, administrator va ustaga xabar.
- Har bir ustaga ertalab soat 8:00 da kunlik jadvali (sozlanadi).
- Xabarlar tranzaksion outbox orqali yuboriladi: xatoda qayta urinadi, botni bloklagan chatga qayta yozmaydi.

**Jamoa uchun (admin panel, Mini App sifatida ham ochiladi)**
- Har bir usta uchun ustunli kunlik koʻrinish va ustaning haftalik koʻrinishi; navbatni sudrab
  boshqa vaqtga yoki boshqa ustaga oʻtkazish; boʻsh joyni bosib oʻzi kelgan yoki qoʻngʻiroq
  qilgan mijozni yozish; vaqtni band qilish.
- Xizmatlar (davomiylik, narx, tayyorgarlik va tozalash vaqti, kategoriya), jamoa: har bir ustaning
  oʻz xizmatlari, narxi va vaqti, haftalik ish jadvali va tanaffuslar, bayram va dam olish kunlari.
- Mijozlar: tashriflar tarixi, sarflagan summasi va necha marta kelmagani.
- Tahlil: navbatlar, tushum, bandlik, kelmaganlar, oʻrtacha chek, reyting, ommabop xizmatlar,
  ustalar bandligi, navbat manbalari; CSV eksport (UTF-8 BOM bilan — Excelda toʻgʻri ochiladi).
- Rollar: **egasi** (hammasi), **administrator** (jamoa va sozlamalardan tashqari hammasi),
  **usta** (faqat oʻz kalendari).

**Toʻlovga tayyor.** Narxning foizi sifatida ixtiyoriy oldindan toʻlov — `PaymentProvider`
interfeysi orqali: Payme (checkout havolasi va merchant JSON-RPC webhook), Click
(prepare/complete, MD5 imzo), Telegram Stars (invoice havolalar) va demo uchun sandbox.
Kalitlar faqat muhit oʻzgaruvchilaridan olinadi.

**Uch til**: bot, Mini App va admin panelda oʻzbek (lotin), rus va ingliz tillari.

## Arxitektura

```mermaid
flowchart LR
  subgraph Telegram
    U[Mijoz] -->|chat| TG[(Bot API)]
    U -->|ochadi| MA[Mini App]
    S[Egasi / admin / usta] -->|ochadi| AP[Admin panel]
  end
  subgraph apps
    WEB["apps/web<br/>React + Vite + Motion"]
    API["apps/api<br/>Fastify + zod"]
    BOT["apps/bot<br/>grammY + outbox worker"]
  end
  subgraph packages
    CORE["packages/core<br/>slot dvigateli · qoidalar · holatlar<br/>i18n · xabar shablonlari · Telegram auth"]
    DB["packages/db<br/>Kysely sxema · SQL migratsiyalar<br/>servislar (navbatlar, admin, tahlil)"]
  end
  MA --- WEB
  AP --- WEB
  WEB -->|"HTTPS, Authorization: tma initData"| API
  TG <-->|long polling| BOT
  API --> DB
  BOT --> DB
  DB --> CORE
  API --> CORE
  BOT --> CORE
  DB --> PG[("PostgreSQL 16<br/>exclusion constraint<br/>notification_jobs outbox")]
  WEB -. "demo rejim" .-> DEMO["xuddi shu servislar PGliteʼda<br/>(WASMʼdagi PostgreSQL)"]
```

- `packages/core` — sof TypeScript: hech qanday freymvork va I/O yoʻq. Vaqt zonalari faqat `Intl` orqali.
- `packages/db` — sxema, migratsiyalar va **barcha** biznes servislar. API, bot va brauzerdagi demo
  bir xil funksiyalarni chaqiradi, shuning uchun demo productionʼdan farq qila olmaydi.
- API yupqa qatlam: autentifikatsiya, zod bilan tekshiruv, xatolarni HTTP kodlarga aylantirish.
- Navbat oʻzgarganda Telegram xabarlari oʻsha tranzaksiyaning ichida navbatga qoʻyiladi
  (`notification_jobs`); bot worker ularni `FOR UPDATE SKIP LOCKED` bilan oladi — bir nechta
  nusxada ishlatish xavfsiz.

## Slot dvigateli qanday ishlaydi

Bitta mahalliy sana uchun dvigatel (`packages/core/src/slots.ts`):

1. **Rejani tuzadi.** Tanlangan xizmatlar har bir usta uchun ketma-ket zanjirga aylanadi — oʻsha
   ustaning oʻz vaqti va narxi bilan. Ikki xizmat orasidagi tanaffus
   `max(oldingisining tozalash vaqti, keyingisining tayyorgarlik vaqti)`.
2. **Ish vaqtini topadi.** Shu sananing *va oldingi sananing* haftalik oraliqlari (20:00 dan
   02:00 gacha boʻlgan smenaning yarim tundan keyingi qismi ham hisobga olinishi uchun)
   `zonedToUtc` bilan aniq vaqt nuqtalariga aylantiriladi, soʻng tanaffuslar, dam olish kunlari,
   bayramlar va band qilingan vaqtlar ayirib tashlanadi.
3. **Mahalliy toʻr boʻylab yuradi** (`slotStepMin`, masalan 10:00, 10:15…). Boshlanish vaqti
   taklif qilinadi, agar: butun zanjir sigʻsa, soʻralgan sanaga tegishli boʻlsa, minimal
   oldindan yozilish va gorizont qoidalariga mos kelsa, va *band oyna* — xizmat vaqti va uning
   ikki chetidagi tayyorgarlik/tozalash vaqti — shu ustaning boshqa navbati bilan kesishmasa.
   Tozalash vaqti ish vaqtidan chiqib ketishi mumkin (oxirgi mijozdan keyin tozalash normal holat).
4. **Ustalarni birlashtiradi** (*istalgan usta*): har bir vaqt uchun uni olishi mumkin boʻlgan
   barcha ustalar roʻyxati; navbat oʻsha kuni eng kam band boʻlgan ustaga beriladi.

Hamma hisob UTCʼdagi vaqt nuqtalarida. Bahorgi oʻtishda mavjud boʻlmagan vaqt oʻtishdan keyingi
vaqtga suriladi, kuzgi oʻtishda takrorlanadigan soat ikki marta — ikki xil nuqta sifatida taklif
qilinadi. Testlar buni Europe/Berlin va America/New_York misolida tekshiradi (Toshkentda yozgi
vaqt yoʻq).

`checkFit` bitta aniq navbatni aniq sabab bilan tekshiradi (`NOT_WORKING`, `CONFLICT`,
`TOO_SOON` va h.k.) va toʻrdagi har bir vaqt uchun slotlar roʻyxati bilan bir xil natija beradi
(buning uchun alohida test bor).

### Ikki marta band qilish mumkin emas

Dvigatel — birinchi, tushunarli tekshiruv. Soʻnggi soʻzni PostgreSQL aytadi:

```sql
CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
  staff_id WITH =,
  tstzrange(occupied_start, occupied_end, '[)') WITH &&
) WHERE (status <> 'cancelled')
```

Ikki soʻrov bir vaqtda kelsa, bittasining yozuvi `23P01` (yoki `40P01` deadlock) bilan rad
etiladi va servis `409 SLOT_UNAVAILABLE` qaytaradi; *istalgan usta* tanlanganda esa keyingi boʻsh
usta bilan qayta urinadi. Integratsion testlar bitta usta va vaqt uchun 20 ta parallel soʻrov
yuborib, faqat bitta navbat yaratilganini tekshiradi.

## Tez ishga tushirish

Kerak: Docker. Dasturlash uchun Node.js 22+.

```bash
git clone https://github.com/xoliddev/navbat.git && cd navbat
cp .env.example .env            # BOT_TOKEN va SESSION_SECRETni toʻldiring (openssl rand -hex 32)
docker compose up --build
```

- Mini App: <http://localhost:8080> · admin panel: <http://localhost:8080/#/admin>
- API holati: <http://localhost:8080/health>
- `BOT_DRY_RUN=true` (standart) boʻlsa, bot worker Telegramga yubormasdan xabarlarni logga
  chiqaradi — tizim haqiqiy tokensiz ham ishlaydi. Haqiqiy token bilan `false` qiling.

Toʻrtala servis (postgres, api, bot, web) health check bilan; `docker compose up --wait` hammasi
tayyor boʻlganda qaytadi. Portlar `WEB_PORT`, `API_PORT`, `PG_PORT` orqali oʻzgartiriladi.

### Haqiqiy botni ulash

1. [@BotFather](https://t.me/BotFather) orqali bot yarating, tokenni `BOT_TOKEN`ga yozing.
2. `apps/web`ni HTTPSʼda joylang (`web` image har qanday TLS proksi ortida ishlaydi) va `WEBAPP_URL`ni koʻrsating.
3. BotFatherʼda: *Bot Settings → Menu Button* → `WEBAPP_URL`; Telegramdan tashqaridagi admin panel
   uchun Login Widget domenini ham qoʻshing (*Bot Settings → Domain*).
4. Oʻzingizni egasi qilib belgilang: `UPDATE staff SET telegram_user_id = <id> WHERE role = 'owner';`

### Dasturlash

```bash
npm install
docker run -d --name navbat-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16-alpine
npm run dev:web -- --mode demo     # demo rejim: http://localhost:5173/navbat/ (backend shart emas)
DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres BOT_TOKEN=1:x \
  SESSION_SECRET=dev-secret-0123456789abcdef0123456789 SEED_DEMO=true AUTH_DEV_MODE=true npm run dev:api
```

## Sozlamalar

| Oʻzgaruvchi | Kim ishlatadi | Standart | Tavsif |
| --- | --- | --- | --- |
| `DATABASE_URL` | api, bot | — | PostgreSQL ulanish satri (compose uni `POSTGRES_*` dan yigʻadi) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | `navbat` | Baza login-paroli |
| `BOT_TOKEN` | api, bot | — | @BotFather bergan token; API `initData`ni shu bilan tekshiradi |
| `BOT_DRY_RUN` | bot | composeʼda `true` | Xabarlarni yubormasdan logga chiqarish |
| `BOT_USERNAME` | web | — | Login Widget uchun bot nomi |
| `WEBAPP_URL` | api, bot | `http://localhost:8080` | Mini Appʼning ochiq HTTPS manzili (xabar tugmalarida) |
| `BUSINESS_SLUG` | bot, web | `demo` | Bu oʻrnatma qaysi biznesga xizmat qiladi |
| `SESSION_SECRET` | api | — | Web admin sessiyalari uchun 32+ tasodifiy belgi |
| `SEED_DEMO` | api | composeʼda `true` | Birinchi ishga tushishda *Demo Barbershop*ni yaratish |
| `AUTH_DEV_MODE` | api | `false` | `Authorization: dev <telegramId>`ni qabul qilish; productionʼda eʼtiborsiz |
| `PAYME_MERCHANT_ID`, `PAYME_KEY` | api | — | Payme adapterini yoqish |
| `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY` | api | — | Click adapterini yoqish |
| `STARS_ENABLED` | api | `false` | Telegram Stars hisoblarini yoqish |
| `WEB_PORT`, `API_PORT`, `PG_PORT` | compose | 8080, 3000, 5432 | Kompyuterdagi portlar |

Repozitoriyda faqat namunalar bor (`.env.example`). Haqiqiy kalitlar sizning muhitingizda turadi.

## Testlar

```bash
npm run lint && npm run typecheck
npm test                     # core + db + api + bot (PostgreSQL kerak, TEST_DATABASE_URLʼga qarang)
npm run test:e2e             # demo build ustida Playwright
```

| Toʻplam | Joyi | Nimani isbotlaydi |
| --- | --- | --- |
| Slot dvigateli va vaqt (68) | `packages/core/test` | Tanaffuslar, tayyorgarlik/tozalash, bir nechta xizmat, usta narxlari, istalgan usta, oldindan yozilish va gorizont, tungi smenalar va yarim tun, yozgi vaqt oʻtishlari, `checkFit` = slotlar roʻyxati, holatlar mashinasi, rollar, 3 tildagi shablonlar, `initData` / Login Widget / sessiya imzolari |
| PGliteʼdagi servislar (21) | `packages/db/test` | Migratsiyalar, seed, kalendar issiqlik xaritasi, navbat hayoti, exclusion constraint, oldindan toʻlov, koʻchirish/bekor qilish xabarlari, outbox qayta urinishlari, kunlik jadval, tahlil, CSV |
| PostgreSQL 16ʼdagi API (40) | `apps/api/test` | Telegram auth, mijoz va admin yoʻllari, rollar, validatsiya, toʻlov webhooklari (Payme, Click, Stars, sandbox) va **parallellik**: 20 ta parallel soʻrov → bitta navbat; parallel koʻchirish → bitta gʻolib |
| Taqlid Telegram bilan bot (14) | `apps/bot/test` | `/start` + havolalar + til, `/bookings`, inline bekor qilish / kechikish / baho, worker, qayta urinishlar, bloklangan chatlar, kunlik jadval |
| Playwright e2e (7, desktop + 375 px) | `apps/web/e2e` | Navbat → chipta → botdagi tasdiq → adminda paydo boʻladi; sudrab koʻchirish → mijozga xabar; bekor qilish va baholash; rollar, tahlil, CSV; konsolda xato yoʻq |

API testlari har bir fayl uchun `TEST_DATABASE_URL`da vaqtinchalik baza yaratadi
(standart `postgres://postgres:postgres@localhost:55432/postgres`) va PostgreSQL topilmasa, jim
oʻtib ketmasdan xato beradi — CIʼda ular `postgres:16` servis konteyneriga qarshi ishlaydi.

## Loyiha tuzilmasi

```
packages/core   sof domen mantiqi (I/O yoʻq)
packages/db     sxema, migratsiyalar, servislar, PGlite dialekti, demo seed
apps/api        Fastify HTTP API, auth, toʻlov adapterlari
apps/bot        grammY bot va outbox worker
apps/web        Mini App, admin panel, demo qobigʻi (Vite)
deploy/         web image uchun nginx sozlamasi
```

## Litsenziya

[MIT](LICENSE) © 2026 xoliddev
