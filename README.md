# Baby Care Log: putting it online for free

The app runs on Cloudflare's free plan, deployed straight from this GitHub repository. You get one web address the whole family opens. It also includes a small database for the log and a check every minute that sends reminder notifications to every phone that has them turned on. Every change pushed to GitHub redeploys the app on its own.

Setup takes about 15 minutes. A laptop is easier, but a phone browser works too.

## 1. Create a free Cloudflare account
Go to **dash.cloudflare.com** and sign up. You don't need a credit card or your own domain.

## 2. Create the database
1. In the left menu open **Storage & Databases → D1 SQL Database**.
2. Click **Create** and name it `baby-care-log`.
3. Copy the **Database ID** shown on its page. It's a long code like `a1b2c3d4-…`.

The app creates its own tables the first time it runs.

## 3. Database ID
Already done. The ID is in `wrangler.toml`. If you ever recreate the database, put the new ID there.

## 4. Connect the repository to Cloudflare
1. In Cloudflare open **Workers & Pages → Create → Import a repository**.
2. Connect your GitHub account and pick `baby-care-log`.
3. Keep the suggested settings. The project name should be `baby-care-log`, and the deploy command should be `npx wrangler deploy`.
4. Click **Deploy**.

The every-minute reminder check and the database connection come from `wrangler.toml`, so you don't need to set them by hand.

## 5. Open the app and create a family log
1. Open the address Cloudflare shows, which looks like `https://baby-care-log.<your-name>.workers.dev`.
2. Tap **Create a family log**, enter a family name and your name.
3. **Save the recovery code** the app shows. If every phone in the family signs out or gets lost, it's the only way back into the log.

One deployment can hold many families. Each family only sees its own log, so friends can create their own family log at the same address.

## 6. On every family phone
1. In **Baby → Family**, tap **Invite a family member** and send the link (WhatsApp, Messages, email). Each link works for one person and expires after 7 days.
2. Install the app to the home screen. On iPhone do this **before** opening the invite link, because the home-screen app keeps its own sign-in:
   - **iPhone:** open the address in Safari, tap **Share**, then **Add to Home Screen**. Open the app from the new icon, tap **Join with an invite link** and paste the link. Notifications only work from the icon on iPhone.
   - **Android:** open the invite link in Chrome and join, then tap **⋮** → **Add to Home screen** or **Install app**.
3. **Baby → Family** lists every phone with access. Remove a phone there if it's lost or shouldn't see the log anymore.
4. In the app go to the **Baby** tab and tap **Turn on notifications**, then allow them. A test notification should arrive within a few seconds.
5. In **Baby → Automatic reminders**, choose whether a reminder is set after every feed or pumping session and how many hours later.
6. In **Calendar**, add midwife, consultatiebureau and doctor appointments, or add the expected Dutch vaccination dates from her birth date. Each appointment can remind the whole family a week, a day, 3 hours or 1 hour before, or at the time itself.

When a reminder is due, every phone with notifications on gets an alert, even with the app closed. On Android the alert also has **Log feed** and **Snooze 15 min** buttons.

## Good to know
- **Cost:** nothing on the free plan for a handful of families. Each open phone checks for updates every 30 seconds; the free plan allows 100,000 requests a day, which is roughly 100–150 phones that keep the app open for a few hours a day. Beyond that, the Workers paid plan ($5 a month) is needed.
- **Privacy contact:** the privacy statement at `/privacy` shows who runs the app and how to reach them. In the Worker → **Settings → Variables and Secrets**, add `PRIVACY_CONTACT_NAME` and `PRIVACY_CONTACT_EMAIL` (type **Secret**, so deploys keep them). Do this for the staging Worker too.
- **Optional bot check:** to stop scripts from creating families, add a Cloudflare Turnstile widget and set `TURNSTILE_SITE_KEY` (a variable) and `TURNSTILE_SECRET` (a secret) on the Worker. Without them, creating a family is limited to 5 per day per internet address.
- **Updates:** changes pushed to the `main` branch deploy automatically. Your data stays in the database.
- **Backup:** use **Baby → Export data** now and then. The same screen has **Import data** to load a backup, and **Delete family log** to remove a family and everything in it.
- **Upgrading from the one-family version:** the first request after deploying moves the existing log into a family of its own. Phones that are signed in with the old family key keep working and switch to their own sign-in the next time the app opens. Then make a recovery code under **Baby → Family**.
- **iPhone requirement:** notifications need iOS 16.4 or newer.
- **If a deploy fails** with a database error, check that the ID in `wrangler.toml` matches the one in D1.

## Staging copy (for trying changes first)
A second Worker, `baby-care-log-staging`, with its **own database**, so tests never touch the real log. It shows a red "Staging copy" banner and installs as "Baby Log TEST".
1. **Storage & Databases → D1 → Create** a database named `baby-care-log-staging`, and put its ID in `wrangler.toml` under `[env.staging]`.
2. **Workers & Pages → Create → Start with Hello World**, name it `baby-care-log-staging` and deploy it, so the Worker exists. Then open it → **Settings → Builds → Connect**, pick this repository, set the production branch to the branch you're testing, the build command to `npm run build` and the deploy command to `npx wrangler deploy --env staging`. On the **Previews Base** tab, turn off **Builds for Preview branches**.
3. In the **real** Worker (`baby-care-log`) → **Settings → Builds → Previews Base**, turn off **Builds for Preview branches**. Otherwise Cloudflare makes preview versions of other branches that use the real database.

## For developers
```
npm install
npm run dev      # local app at http://localhost:8787 with a local database
npm test         # API checks against the local app (run while dev is running; each creates its own family)
npm run test:browser   # phone-sized browser checks of the screens (needs Playwright)
npm run test:migrate   # migration from the one-family database (starts its own server on port 8788)
npm run deploy   # deploy from your own machine (after: npx wrangler login)
```

How the code is organized:
- `web/` holds the app screens: a React app in `web/src` (components in `web/src/components`, calculations in `web/src/lib`).
- `public/` holds the service worker, the manifest and the icons.
- `src/worker.js` is the API, sync and reminder check.
- `src/webpush.js` sends encrypted push notifications.
