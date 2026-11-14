<div align="center">

# Navbat

**Online booking for barbershops, beauty salons, clinics and car services in Uzbekistan —
a Telegram bot, a Telegram Mini App for customers and an admin panel for the team.**

English · [Oʻzbekcha](README.uz.md)

[![Live demo](https://img.shields.io/badge/live%20demo-xoliddev.github.io%2Fnavbat-2346d4?style=flat-square)](https://xoliddev.github.io/navbat/)
[![CI](https://github.com/xoliddev/navbat/actions/workflows/ci.yml/badge.svg)](https://github.com/xoliddev/navbat/actions/workflows/ci.yml)
[![Pages](https://github.com/xoliddev/navbat/actions/workflows/pages.yml/badge.svg)](https://github.com/xoliddev/navbat/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-f2b233?style=flat-square)](LICENSE)

<img src="docs/media/booking-flow.gif" width="300" alt="Booking a visit in the Mini App: service, master, day with free-time gauge, time, sandbox deposit, queue ticket" />

</div>

*Navbat* means "queue" or "your turn" in Uzbek. A customer opens the bot, picks a service, a
master and a time, and gets a queue ticket. The bot confirms, reminds 24 h and 2 h before the
visit, and lets them say "I'm running late" or cancel with one tap. The team sees every booking
on a calendar, drags it to another time, adds walk-ins, blocks time and watches the numbers.

## Live demo

**[xoliddev.github.io/navbat](https://xoliddev.github.io/navbat/)** — no server, no sign-up.

Book a visit in the phone on the left, watch the confirmation arrive in the bot chat on the right,
then open **Admin panel** and find your booking on the calendar. Drag it to another time: the
customer chat gets a "Booking moved" message. Switch the role to *Master (Jasur)* to see what a
master sees, or open *Analytics* and export a CSV.

| What runs in the demo | Real or simulated |
| --- | --- |
| Slot engine, booking rules, state machine, role checks | **Real** — the same `@navbat/core` code as production |
| Database | **Real PostgreSQL** compiled to WebAssembly ([PGlite](https://pglite.dev)), the same SQL migrations, `btree_gist` exclusion constraint included; stored in IndexedDB |
| Services (create, reschedule, cancel, review, analytics, CSV) | **Real** — the same `@navbat/db` functions the API calls |
| Bot messages | **Real templates** from `@navbat/core`; the chat window itself is simulated (no Telegram) |
| Reminder delivery | Simulated: due messages are delivered every 2 s, future ones can be sent with "Send now" |
| Prepayment | Sandbox provider (no money moves); Payme, Click and Stars adapters exist in the API |
| Telegram WebApp | Mocked: MainButton, BackButton and haptics are rendered by the page |

The demo seeds *Demo Barbershop* (two branches, four masters, eight services, 5 weeks of history)
relative to today, so the calendar and analytics always look alive. *Reset demo* starts over.

## Screenshots

| Mini App + bot chat | Admin calendar |
| --- | --- |
| ![Mini App with availability heatmap next to the bot chat](docs/media/desktop-calendar.webp) | ![Admin day view with one column per master](docs/media/admin-calendar.webp) |
| ![Queue ticket after booking and the confirmation in the bot](docs/media/desktop-ticket.webp) | ![Analytics: bookings, revenue, utilisation, top services](docs/media/admin-analytics.webp) |
| ![Sandbox checkout for the deposit](docs/media/desktop-checkout.webp) | ![Clients with visits and no-shows](docs/media/admin-clients.webp) |

## Features

**Customers (Telegram Mini App)**
- Service → master (or *any master*) → day → time → name and phone. Several services in one visit.
- A month calendar where each day carries a turquoise gauge of how much free time is left.
- My bookings, reschedule, cancel inside the policy window, "running late", rate a visit.
- Deep links: `?startapp=master_<id>`, `service_<id>`, `booking_<id>` (and `/start master_<id>` in the bot).
- Native Telegram feel: MainButton, BackButton, haptics, theme params, safe areas; works in a
  normal browser with a mocked WebApp.

**Bot (grammY)**
- `/start` with deep-link payloads, language picker (uz / ru / en), `/bookings`, `/language`.
- Confirmation, 24 h and 2 h reminders with *running late* and *cancel* buttons, rating request.
- Alerts to the owner, front desk and master for new, moved and cancelled bookings.
- Every master's schedule for the day at 08:00 (configurable).
- Messages go through a transactional outbox with retries and back-off; blocked chats are not retried.

**Team (admin panel, also opens as a Mini App)**
- Day view with a column per master and week view per master; drag to move a booking to another
  time or master; click an empty spot to add a walk-in or phone booking; block time.
- Services (duration, price, preparation and clean-up buffers, category), team with per-master
  services, prices and durations, weekly hours and breaks, holidays and days off.
- Clients with visit history, total spent and no-show count.
- Analytics: bookings, revenue, utilisation, no-shows, average ticket, rating, top services,
  master utilisation, booking sources; CSV export (UTF-8 with BOM, opens in Excel).
- Roles: **owner** (everything), **admin** (everything except team and settings), **master**
  (own calendar only).

**Payments-ready.** Optional deposit as a percentage of the price through a `PaymentProvider`
interface: Payme (checkout URL + merchant JSON-RPC webhook), Click (prepare/complete with MD5
signatures), Telegram Stars (invoice links) and a sandbox used by the demo. Keys come only from
environment variables.

**Three languages** across bot, Mini App and admin: Uzbek (Latin), Russian, English.

## Architecture

```mermaid
flowchart LR
  subgraph Telegram
    U[Customer] -->|chat| TG[(Bot API)]
    U -->|opens| MA[Mini App]
    S[Owner / admin / master] -->|opens| AP[Admin panel]
  end
  subgraph apps
    WEB["apps/web<br/>React + Vite + Motion"]
    API["apps/api<br/>Fastify + zod"]
    BOT["apps/bot<br/>grammY + outbox worker"]
  end
  subgraph packages
    CORE["packages/core<br/>slot engine · rules · state machine<br/>i18n · message templates · Telegram auth"]
    DB["packages/db<br/>Kysely schema · SQL migrations<br/>services (bookings, admin, analytics)"]
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
  WEB -. "demo mode" .-> DEMO["same services on PGlite<br/>(PostgreSQL in WASM)"]
```

- `packages/core` is pure TypeScript with no framework and no I/O. Time zones use only `Intl`.
- `packages/db` holds the schema, migrations and **all** application services. The API, the bot
  and the browser demo call the same functions, so the demo cannot drift from production.
- The API is thin: authentication, validation with zod, mapping errors to HTTP.
- Booking changes enqueue Telegram messages in the same transaction (`notification_jobs`); the bot
  worker claims due jobs with `FOR UPDATE SKIP LOCKED`, so several replicas are safe.

## How the slot engine works

For one local date the engine (`packages/core/src/slots.ts`):

1. **Builds the plan.** The chosen services become a back-to-back chain for each master, using
   that master's own duration and price. Between two services the gap is
   `max(bufferAfter of the previous, bufferBefore of the next)`.
2. **Finds working time.** Weekly intervals of the date *and of the previous date* (so a shift
   from 20:00 to 02:00 contributes its tail after midnight) are converted to instants with
   `zonedToUtc`, then breaks, days off, holidays and blocks are subtracted.
3. **Walks a local grid** (`slotStepMin`, e.g. 10:00, 10:15…) inside each free interval. A start
   is offered when the whole chain fits, it is on the requested local date, it respects minimum
   notice and the booking horizon, and the *occupied window* — service time widened by the first
   buffer-before and the last buffer-after — does not overlap another booking of that master.
   Buffers may spill outside working hours (cleaning up after the last client is fine).
4. **Merges masters** for *any master*: each start lists every master who can take it; the
   booking goes to the least-loaded one that day.

Everything is computed in UTC instants. Non-existent local times on a spring-forward night move
past the gap, repeated times on a fall-back night are offered twice as distinct instants; tests
cover both using Europe/Berlin and America/New_York (Tashkent itself has no DST).

`checkFit` validates one concrete booking with precise reasons (`NOT_WORKING`, `CONFLICT`,
`TOO_SOON`, …) and agrees with the slot list for every grid start (there is a test for that).

### No double booking

The engine is the friendly first check. The final word belongs to PostgreSQL:

```sql
CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
  staff_id WITH =,
  tstzrange(occupied_start, occupied_end, '[)') WITH &&
) WHERE (status <> 'cancelled')
```

Writers for one master also take a transaction-scoped advisory lock, so racing requests queue
instead of deadlocking on the exclusion index. When two requests race, the loser's insert fails
with `23P01` (a `40P01` deadlock is treated the same way, just in case) and the service answers
`409 SLOT_UNAVAILABLE`; for *any master* it retries with the next free master. The integration
suite fires 20 parallel requests for the same master and slot and asserts exactly one booking.

## Quick start

Requirements: Docker. Node.js 22+ for development.

```bash
git clone https://github.com/xoliddev/navbat.git && cd navbat
cp .env.example .env            # fill BOT_TOKEN and SESSION_SECRET (openssl rand -hex 32)
docker compose up --build
```

- Mini App: <http://localhost:8080> · admin panel: <http://localhost:8080/#/admin>
- API health: <http://localhost:8080/health>
- With `BOT_DRY_RUN=true` (default) the bot worker prints messages instead of calling Telegram,
  so the stack runs without a real token. Set it to `false` with a real token to go live.

All four services (postgres, api, bot, web) have health checks; `docker compose up --wait` returns
when everything is healthy. Ports are configurable with `WEB_PORT`, `API_PORT`, `PG_PORT`.

### Connect a real bot

1. Create a bot with [@BotFather](https://t.me/BotFather), put the token into `BOT_TOKEN`.
2. Host `apps/web` on HTTPS (the `web` image does it behind any TLS proxy) and set `WEBAPP_URL`.
3. In BotFather: *Bot Settings → Menu Button* → your `WEBAPP_URL`; for the web admin outside
   Telegram also set the domain for the Login Widget (*Bot Settings → Domain*).
4. Add yourself as owner: `UPDATE staff SET telegram_user_id = <your id> WHERE role = 'owner';`

### Development

```bash
npm install
docker run -d --name navbat-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16-alpine
npm run dev:web -- --mode demo     # demo mode at http://localhost:5173/navbat/ (no backend needed)
DATABASE_URL=postgres://postgres:postgres@localhost:55432/postgres BOT_TOKEN=1:x \
  SESSION_SECRET=dev-secret-0123456789abcdef0123456789 SEED_DEMO=true AUTH_DEV_MODE=true npm run dev:api
```

## Configuration

| Variable | Used by | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | api, bot | — | PostgreSQL connection string (compose builds it from `POSTGRES_*`) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | `navbat` | Database credentials |
| `BOT_TOKEN` | api, bot | — | Token from @BotFather; the API uses it to verify `initData` |
| `BOT_DRY_RUN` | bot | `true` in compose | Log messages instead of sending them |
| `BOT_USERNAME` | web | — | Bot username for the Login Widget |
| `WEBAPP_URL` | api, bot | `http://localhost:8080` | Public HTTPS URL of the Mini App, used in message buttons |
| `BUSINESS_SLUG` | bot, web | `demo` | Which business this deployment serves |
| `SESSION_SECRET` | api | — | 32+ random characters for web admin sessions |
| `SEED_DEMO` | api | `true` in compose | Seed *Demo Barbershop* on first start |
| `AUTH_DEV_MODE` | api | `false` | Accept `Authorization: dev <telegramId>`; ignored in production |
| `PAYME_MERCHANT_ID`, `PAYME_KEY` | api | — | Enable the Payme adapter |
| `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY` | api | — | Enable the Click adapter |
| `STARS_ENABLED` | api | `false` | Enable Telegram Stars invoices |
| `WEB_PORT`, `API_PORT`, `PG_PORT` | compose | 8080, 3000, 5432 | Host ports |

The repository contains placeholders only (`.env.example`). Real keys belong in your environment.

## Tests

```bash
npm run lint && npm run typecheck
npm test                     # core + db + api + bot (needs PostgreSQL, see TEST_DATABASE_URL)
npm run test:e2e             # Playwright against the demo build
```

| Suite | Where | What it proves |
| --- | --- | --- |
| Slot engine & time (68) | `packages/core/test` | Breaks, buffers, multi-service chains, per-master overrides, any master, notice and horizon, overnight shifts and midnight edges, DST gaps and overlaps, `checkFit` = slot list, state machine, permissions, templates in 3 languages, `initData` / Login Widget / session signatures |
| Services on PGlite (21) | `packages/db/test` | Migrations, seed, availability heatmap, booking lifecycle, exclusion constraint, deposits, reschedule/cancel notifications, outbox retries, digests, analytics, CSV |
| API on PostgreSQL 16 (40) | `apps/api/test` | Telegram auth, customer and admin routes, roles, validation, payment webhooks (Payme, Click, Stars, sandbox) and **concurrency**: 20 parallel requests → exactly one booking; parallel reschedules → one winner |
| Bot with mocked Telegram (14) | `apps/bot/test` | `/start` + deep links + language, `/bookings`, inline cancel / late / rating, worker delivery, retries, blocked chats, digests |
| Playwright e2e (7, desktop + 375 px) | `apps/web/e2e` | Book → ticket → bot confirmation → appears in admin; drag to reschedule → customer notified; cancel and rate; roles, analytics, CSV; no console errors |

API tests create a throwaway database per file on `TEST_DATABASE_URL`
(default `postgres://postgres:postgres@localhost:55432/postgres`) and fail loudly if PostgreSQL
is unreachable — CI runs them against a `postgres:16` service container.

## Project structure

```
packages/core   pure domain logic (no I/O)
packages/db     schema, migrations, services, PGlite dialect, demo seed
apps/api        Fastify HTTP API, auth, payment adapters
apps/bot        grammY bot and outbox worker
apps/web        Mini App, admin panel, demo shell (Vite)
deploy/         nginx config for the web image
```

## License

[MIT](LICENSE) © 2026 xoliddev
