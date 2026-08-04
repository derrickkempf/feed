# Daylog

One canvas per day. Drag images onto the page and they land on today's
canvas; the days stack into one continuous scroll. Tag and filter, link
images to Fourthwall products with hosted checkout, and give any image a
deeper-dive project page (with a Work index and breadcrumbs).

Type: **DEWD Cool Old Sign** (body) · **Compass** (page headlines) ·
**DEWD Vintage** (nav, chips, buttons). Fonts ship in `public/fonts/`.

## Run it locally (zero setup)

```bash
npm install
npm run dev        # → http://localhost:5173
```

With no env vars set, the site runs in **local preview mode** — everything
works, but images are stored in your browser only (a few MB cap). Press
**Cmd/Ctrl + Shift + L** to log in (default passphrase: none until you set
one) and start dropping images.

## Push to GitHub

```bash
git init
git add .
git commit -m "Daylog"
```

Then create an empty repo on github.com and:

```bash
git remote add origin https://github.com/YOUR_USERNAME/daylog.git
git branch -M main
git push -u origin main
```

`.env` is git-ignored — your keys never end up in the repo.

## Go live (Vercel, ~5 minutes)

1. vercel.com → **Add New → Project** → import your `daylog` GitHub repo.
   Vercel auto-detects Vite; the defaults are correct.
2. In the project's **Settings → Environment Variables**, add the variables
   from `.env.example` (at minimum `VITE_OWNER_PASSPHRASE`; add the Supabase
   pair for real storage — see below).
3. Deploy. Every future `git push` redeploys automatically.

Netlify works identically (build command `npm run build`, publish dir `dist`).
GitHub Pages also works since routing is hash-based, but env-var handling is
clumsier there — Vercel/Netlify recommended.

## Real storage: Supabase (the archive)

Local preview mode is browser-only. For the permanent archive with public
image URLs you can use anywhere:

1. Create a free project at supabase.com
2. **SQL Editor** → paste and run `supabase.sql`
3. **Storage → New bucket** → name it `daylog` → check **Public bucket**,
   and allow INSERT/DELETE in the bucket's policies
4. **Settings → API** → copy the URL + anon key into `.env` (locally) and
   into Vercel's environment variables (live), then redeploy

Every image now gets a permanent URL like
`https://YOUR_PROJECT.supabase.co/storage/v1/object/public/daylog/days/2026-08-04/abc.jpg`.
Supabase lets you download the whole bucket anytime — drop that in Google
Drive for a second copy.

## Selling via Fourthwall

1. Fourthwall dashboard → **Settings → For Developers** → copy your
   Storefront token (`ptkn_...`)
2. Set `VITE_FW_STOREFRONT_TOKEN` and `VITE_FW_CHECKOUT_DOMAIN`
   (e.g. `my-shop.fourthwall.com`)
3. Log in on the site, hover an image, hit **$** — your live catalog loads
   in a picker. Visitors tap the Shop chip → Buy → Fourthwall's hosted
   checkout handles payment, fulfillment, and shipping.

No token? Link products manually by name/price/URL.

## Owner mode

**Cmd/Ctrl + Shift + L** toggles between visitor (read-only) and owner
(drag-drop, tags, products, pages). Set `VITE_OWNER_PASSPHRASE` so the
prompt guards it.

## Security — read before sharing widely

- The passphrase is a **client-side** gate and the demo database policies
  allow writes with the public anon key. That keeps honest people out, not
  determined ones — a common and acceptable tradeoff for a personal art
  site, but know it. To lock down properly: enable Supabase Auth (email
  sign-in for just you), switch the RLS policies in `supabase.sql` to
  `auth.role() = 'authenticated'`, make the storage bucket's write policies
  authenticated-only, and sign in via Supabase in `src/backend.js`. Reads
  stay public; only you can write.
- The Fourthwall storefront token is designed to be public (read-only
  catalog). Safe in client code.

## Font licensing note

`public/fonts/` ships with your font files and they'll be publicly served
on the live site. Make sure your license for DEWD Cool Old Sign, Compass,
and DEWD Vintage covers web embedding/self-hosting.
