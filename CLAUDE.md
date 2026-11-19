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
- `test/e2e.mjs`, `test/appts.mjs`: API and push tests against a local dev server with a fresh DB (they set up the family key `sunshine-2026`, use a fake push endpoint and decrypt pushes with `http_ece`).

## Data model
- One deployment = one family. Auth is a shared **family key** (salted SHA-256 in `kv`), sent as `x-family-key`. Members type their name; it's stored on entries as `by`.
- D1 tables (created automatically by `ensureSchema`): `kv` (auth, profile, reminder settings `rem`, VAPID keys, origin, notified), `events`, `growth`, `appts` (each: id, t, data JSON, updated, deleted tombstone), `subs` (push subscriptions), `sent` (appointment reminders already sent).
- `events.type`: `feed` (kind breast|bottle|formula|solids, side, min, ml), `diaper` (kind wet|dirty|both, color, temp, tempSite), `pump` (side, min, ml), `note` (tags[], note).
- `growth`: kg (stored in kg, shown in grams), cm, head.
- `appts`: kind midwife|cb|vaccination|doctor|other, title, t, place, note, remind (minutes before), planned (expected vaccination date: silent until confirmed).
- Profile: name, birth (YYYY-MM-DD), sex, mlPerKg (default 150).
- Client sync: `GET /api/sync?since=` (incremental, tombstones), writes via an offline outbox in localStorage, polling every 15 s while visible.

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
node test/e2e.mjs                              # fresh DB
node test/appts.mjs                            # fresh DB
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"   # trigger the reminder cron
```
`npm run build` fails on any syntax error in `web/src`.

## Known limits and open ideas
- One family per deployment; friends need their own copy (README) until multi-family accounts exist.
- Free Cloudflare limits: polling every 15 s per open phone; D1 free limits are enforced since Sept 2026.
- Reminders need notifications enabled per phone; on iPhone only from the home-screen app (iOS 16.4+).
- Planned (not started), discussed with the user: native iOS/Android app via Capacitor for a wider free audience. Prerequisites: multi-family accounts and households, GDPR work for children's health data (consent, DPIA, EU data location), Apple 4.2 "more than a website", Google Play's 12 testers × 14 days closed test, and a decision on the feeding suggestion under EU MDR (launch without it, reword it as a pattern summary, or get regulatory advice).
