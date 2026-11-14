# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-11-14

First public release.

### Added
- **Slot engine** (`packages/core`): DST-safe availability from weekly hours, breaks, days off,
  holidays, time blocks and existing bookings; buffers before/after; multi-service chains;
  per-master prices and durations; "any master" with least-loaded assignment; minimum notice and
  booking horizon; overnight shifts.
- **Booking state machine** with role-aware transitions (customer, master, admin, owner) and a
  free-cancellation window.
- **PostgreSQL schema** with an exclusion constraint (`btree_gist`) that makes double booking
  impossible, plus a transactional notification outbox.
- **API** (Fastify): Telegram `initData` HMAC validation, Login Widget sessions for the web admin,
  customer and admin routes, CSV export, Payme / Click / Telegram Stars / sandbox payment adapters.
- **Bot** (grammY): `/start` with deep links, uz/ru/en, my bookings, inline cancel / running late /
  rating, 24 h and 2 h reminders, staff alerts, morning digest for every master, Stars payments.
- **Web** (React + Vite + Motion): Telegram Mini App (MainButton, BackButton, haptics, theme
  params, safe areas) and an admin panel with a drag-to-reschedule calendar, walk-ins, time
  blocks, services, team and schedules, clients, analytics and settings.
- **Live demo** on GitHub Pages: the real services on PGlite (PostgreSQL in WebAssembly) with the
  same migrations, plus a simulated bot chat built from the real templates.
- Docker Compose stack with health checks, GitHub Actions CI (lint, typecheck, tests against
  PostgreSQL 16, Playwright, Docker smoke test) and a Pages deployment workflow.
