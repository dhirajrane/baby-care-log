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

## 5. Open the app and create your family log
1. Open the address Cloudflare shows, which looks like `https://baby-care-log.<your-name>.workers.dev`.
2. Choose a **family key** with at least 6 characters. Treat it like a password, because anyone with the address and the key can see and add entries.
3. Enter your name and tap **Create family log**.

## 6. On every family phone
1. Send the address and the family key to each person who should log.
2. They open the address, enter the key and their name, and sign in.
3. Install it to the home screen:
   - **iPhone:** open the address in Safari, tap **Share**, then **Add to Home Screen**. Open the app from the new icon. Notifications only work from the icon on iPhone, so this step is needed.
   - **Android:** in Chrome tap **⋮**, then **Add to Home screen** or **Install app**.
4. In the app go to the **Baby** tab and tap **Turn on notifications**, then allow them. A test notification should arrive within a few seconds.
5. In **Baby → Automatic reminders**, choose whether a reminder is set after every feed or pumping session and how many hours later.

When a reminder is due, every phone with notifications on gets an alert, even with the app closed. On Android the alert also has **Log feed** and **Snooze 15 min** buttons.

## Good to know
- **Cost:** nothing on the free plan. A family uses only a tiny fraction of the free limits.
- **Updates:** changes pushed to the `main` branch deploy automatically. Your data stays in the database.
- **Backup:** use **Baby → Export data** now and then. The same screen has **Import data** to load a backup.
- **iPhone requirement:** notifications need iOS 16.4 or newer.
- **If a deploy fails** with a database error, check that the ID in `wrangler.toml` matches the one in D1.

## For developers
```
npm install
npm run dev      # local app at http://localhost:8787 with a local database
npm test         # end-to-end checks against the local app (run while dev is running)
npm run deploy   # deploy from your own machine (after: npx wrangler login)
```

How the code is organized:
- `public/` holds the app screens, the service worker and the icons.
- `src/worker.js` is the API, sync and reminder check.
- `src/webpush.js` sends encrypted push notifications.
