# 📱 Outfit Picker (PWA)

Cloud-synced outfit picker that works on **phone & laptop**, is **installable as an app** (PWA), and deploys to **Vercel**.

## Features
- 👕 Random outfit picking with Google Drive photos
- ☁️ Cloud sync via Supabase (never blocks the UI — background sync + timeouts, so it can't "get stuck")
- ✉️ Email always opens your **device's default mail app** (`mailto:` — same on phone & laptop)
- 💬 WhatsApp sharing with saved recipients
- 📲 Installable: Add to Home Screen on Android/iOS, install banner on laptops
- 📴 App shell cached by a service worker for instant startup; cloud data is never cached (always fresh)

## Deploy on Vercel
1. Push this repo to GitHub.
2. Go to https://vercel.com → **Add New → Project** → import the repo.
3. Framework preset: **Other** (it's a static site — no build needed). Leave build command & output empty.
4. Click **Deploy**. Done — your site is live over HTTPS (required for PWA install).

## Local test
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Configuration
- Supabase keys: edit `js/config.js`
- Delete password: `PASSWORD` in `js/app.js`
- Icons: regenerate PNGs in `icons/` if you replace `icons/icon.svg`

## Rules / item lists
Categories live at the top of `js/app.js` (`FIXED_CATEGORIES`, `DRIVE_FOLDER_LINKS`, `TEST_ITEMS`). Actual items are stored in your Supabase tables (`outfit_items`, `outfit_history`, `outfit_picked`) — delete rows there (or use 🔒 Delete mode in the app) to remove items/rules from every device at once.
