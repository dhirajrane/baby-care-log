# Baby Care Log: project notes for Claude Code

A family baby tracker for Dhiraj's daughter. It logs feeds, diapers, pumping, growth, temperature, day notes and appointments, sends push reminders to every family phone, and produces a visit report for the doctor. It is installable as a home-screen web app (PWA). The family uses it daily in the Netherlands, so keep it working and treat `main` as production.

- Live: https://baby-care-log.dhiraj-rane2.workers.dev (Cloudflare Workers free plan + D1)
- Deploys: Cloudflare is connected to this GitHub repo; **every push to `main` deploys automatically** (Cloudflare runs `node scripts/build.mjs` then `npx wrangler deploy`).
- Read-only docs page for friends: `/help` (no sign-in needed).

## Working agreement (from the original chat)
- The user sometimes asks to **plan only**. When they say "don't implement / don't push", answer with a plan and change nothing.
- Otherwise: implement, test locally, then commit and push to `main` (that's how the user gets updates). Commit author: `Dhiraj Rane <drrane24@gmail.com>`.
- Test before pushing: build, run the app locally, drive it in a phone-sized headless browser (390×844), and look at screenshots in light and dark mode.
- User-facing copy: plain, short, active voice; Dutch health terms where they're what parents know (consultatiebureau, huisarts, huisartsenpost, GGD).
- Health-related features must stay grounded in sources (listed below) and phrased as guidance, not instructions. Keep the "How it works" page in sync with any calculation change.

## Layout
- `web/`: the React front end (React 18, bundled by esbuild, no other build tool).
  - `web/index.html` (page shell; `/*STYLES*/` is replaced by `web/styles.css` at build time), `web/styles.css`.
  - `web/src/main.jsx`: boot (load saved log, service worker, deep links `/help`, `?tab=`, `?log=`, polling).
  - `web/src/store.js`: one mutable state object `S` plus `render()`/`useApp()` (useSyncExternalStore), API calls, offline outbox and sync, sign-in, push, reminders, sheets and toast.
  - `web/src/lib/`: `util.js` (dates, formatting), `constants.js` (labels, WHO tables, sources), `calc.js` (pure calculations: totals, next-feed suggestion, vaccinations, visit report; each takes the state).
  - `web/src/components/`: `App.jsx` (shell, tabs), `Today`, `History`, `Growth`, `Calendar`, `Baby`, `Report`, `Help`, `Login`, `Sheets` (all bottom-sheet forms), `SuggestCard`, `Reminders` (reminder card, alerts, fever banner), `charts.jsx`, `ui.jsx` (radios, confirm button, list items).
- `public/sw.js`: service worker (offline shell, push display, notification actions "Log feed" / "Snooze 15 min").
- `public/manifest.webmanifest`, icons.
- `src/worker.js`: Cloudflare Worker. Serves the inlined static assets, the JSON API under `/api/*`, and the every-minute cron that sends feed/pump and appointment reminders.
- `src/webpush.js`: Web Push (VAPID + aes128gcm) implemented with WebCrypto.
- `scripts/build.mjs`: bundles `web/src/main.jsx` to `/app.js`, builds the page from `web/index.html` + `web/styles.css`, inlines those and `public/` into `src/assets.js` (generated, git-ignored, only rewritten when it changes so `wrangler dev` doesn't loop), and bundles the worker to `dist/worker.js` (git-ignored).
- `wrangler.toml`: D1 binding `DB` (database `baby-care-log`), cron `* * * * *`.
- Tests (run while `npm run dev` is up; each creates its own families, with a random `cf-connecting-ip` header so rate limits don't trip): `test/e2e.mjs` (API and push), `test/appts.mjs` (appointment reminders), `test/families.mjs` (isolation between families, invites, recovery, removing phones, rate limits, reminders reach only the right family, delete), `test/browser.mjs` (Playwright, 390×844: logging flows and family screens; screenshots in /tmp/bcl-shots). `test/migrate.mjs` builds a one-family (v1) database and starts its own server on port 8788. Push tests use a fake push endpoint and decrypt with `http_ece`.

## Data model
- **Many families per deployment.** Every data row has a `family` column and every query filters on it; primary keys are `(family, id)` so one family can never overwrite another's row with the same id.
- **Sign-in:** each phone has its own random device token (`Authorization: Bearer`), stored only as a SHA-256 hash in `devices`. A family is created with `POST /api/families` (returns the first token and a **recovery code**, shown once, stored hashed in `families.recovery_hash`). Members join with one-time invite links `/join#CODE` (`invites`, hashed, single use, 7 days). `POST /api/recover` trades the recovery code for a token. Members type their name; it's stored on entries as `by`.
- **Rate limits** (table `rate`, per `cf-connecting-ip`): create family 5/day, join 20/h, recover 10/h, invite-info 30/h, invites 30/day per family. Optional Cloudflare Turnstile on create when `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` are set.
- **D1 tables** (created by `ensureSchema`, schema version 2 in `kv.schema`): `kv` (app-wide: VAPID keys, origin, schema, legacy_family), `families`, `family_kv` (per family: profile, rem, legacy_auth), `devices`, `invites`, `events`, `growth`, `appts` (each: family, id, t, data JSON, updated, deleted tombstone), `subs` (push subscriptions with family and device), `due` (feed/pump reminder time per family, mirrored from `rem`), `alarms` (one row per appointment reminder, rebuilt on every appointment write), `sent` (appointment reminders already sent, key `family:id:t:min`), `rate`.
- **Cron** reads only `due` and `alarms` rows that are due, so its cost doesn't grow with the number of families.
- **Migration from v1** (one family, no `family` column): on the first request, `migrateV1` renames the old tables, copies everything into a new family in one batch, keeps the old family key as `legacy_auth`, and builds `due`/`alarms`. Phones with the old key keep working (`x-family-key`) and the app trades it for a token on start (`/api/legacy-login`). Tested by `test/migrate.mjs`.
- `events.type`: `feed` (kind breast|bottle|formula|solids, side, min, ml), `diaper` (kind wet|dirty|both, color, temp, tempSite), `pump` (side, min, ml), `note` (tags[], note).
- `growth`: kg (stored in kg, shown in grams), cm, head.
- `appts`: kind midwife|cb|vaccination|doctor|other, title, t, place, note, remind (minutes before), planned (expected vaccination date: silent until confirmed).
- Profile: name, birth (YYYY-MM-DD), sex, mlPerKg (default 150).
- Client sync: `GET /api/sync?since=` (incremental, tombstones, plus family name and whether it has a recovery code), writes via an offline outbox in localStorage, polling every 30 s while visible and on opening the app.

## Key calculations (see the How it works page for the user-facing version)
- **Suggested next feed**: daily guide = latest weight × mlPerKg (150, Voedingscentrum). Drinking rate (ml per hour) = median of measured feed ml ÷ hours to the next feed over 4 days (needs 5), blended with the guide rate (guide ÷ 24) and fully her own after 10 measured feeds. Next time = last feed start + last ml ÷ rate, clamped to [1.5 h, 1.5 × age gap]; age feeds/day go from 10 (newborn) to 6 (6 months). Breast or unmeasured feeds use the usual gap. Top-ups within 30 min (max 45 min span) merge into one feed. Amount = what's left of today's guide ÷ feeds left before midnight, clamped to −10%/+20% of the typical feed (guide per feed averaged with her recent bottles). **The guide is not a limit**: the user chose "guide, not hard cap" and "blend her pattern with the guide"; night feeds use the same rhythm.
- **Milk totals**: per calendar day, bottle feeds with ml only.
- **Temperature**: ≥38.0 °C fever flag; under 3 months, a banner says to have a doctor see her straight away (huisarts / huisartsenpost). <35.8 °C flagged low. Values outside 30–45 °C are rejected.
- **Vaccinations**: expected dates from the birth date using the Rijksvaccinatieprogramma ages (6–9 weeks, 3, 5, 12, 14 months, 3 years); RSV is left to the GGD.
- **Growth**: WHO weight-for-age 3rd/50th/97th tables for 0–12 months are hard-coded in `WHO`.
- **Visit report**: averages over complete days that have entries for that item; today is excluded from averages; weight gain per week runs from the last weight before the period.

## Sources
- Voedingscentrum bottle feeding guidance via GGD: https://www.ggdgv.nl/wp-content/uploads/sites/2/2024/04/flesvoeding-2023-1.pdf
- WHO Child Growth Standards: https://www.who.int/tools/child-growth-standards
- Rijksvaccinatieprogramma schedule: https://rijksvaccinatieprogramma.nl/sites/default/files/2026-02/Vaccination-schedule.pdf
- Fever in children (Gezondheid en Wetenschap): https://gezondheidenwetenschap.be/richtlijnen/koorts-bij-een-kind

## Run and test locally
```
npm install
npm run build
npx wrangler dev --local --test-scheduled      # http://localhost:8787, fresh local D1
npm test                                       # API tests (e2e, appts, families)
npm run test:browser                           # browser tests (Playwright)
npm run test:migrate                           # v1 -> v2 migration, own server on :8788
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"   # trigger the reminder cron
```
`npm run build` fails on any syntax error in `web/src`.

## Known limits and open ideas
- Multi-family is built (branch work, Nov 2026). Still open before sharing publicly: privacy statement and consent at sign-up, DPIA, EU data location for D1, Cloudflare DPA, the feeding-suggestion wording under EU MDR, a custom domain. iPhone: the home-screen app has its own storage, so people should add it to the home screen before joining.
- Free Cloudflare limits: 100k Worker requests/day; polling every 30 s per open phone (about 120 requests/hour). D1 free limits are enforced since Sept 2026.
- Reminders need notifications enabled per phone; on iPhone only from the home-screen app (iOS 16.4+).
- Planned (not started), discussed with the user: native iOS/Android app via Capacitor for a wider free audience. Prerequisites: multi-family accounts (now built), GDPR work for children's health data (consent, DPIA, EU data location), Apple 4.2 "more than a website", Google Play's 12 testers × 14 days closed test, and a decision on the feeding suggestion under EU MDR (launch without it, reword it as a pattern summary, or get regulatory advice).
