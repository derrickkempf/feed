# Daylog — a daily record of what I'm making

One canvas per day. Drag images onto the page and they land on today's canvas;
days stack into one continuous scroll. Arrange images and floating notes
freely (invisible-grid snap), click any image for a split-screen detail view,
tag things, link deeper-dive project pages, and sell through Fourthwall.

## Stack
Vite + React · Supabase (Postgres + Storage + Auth) · Fourthwall Storefront API

Type: Frankie News (H1/H2, falls back to Libre Franklin) · DEWD Cool Old Sign
(nav/labels) · TT2020 Style E (body). Font files live in `public/fonts/`
as latin subsets that keep TT2020's randomized-glyph typewriter texture.

## Run locally
```bash
npm install
npm run dev
```
With no env vars it runs in LOCAL PREVIEW (browser-only storage) —
log in with the passphrase from `.env` (copy `.env.example`).

## Deploy (Vercel)
1. Push this repo to GitHub, import it in Vercel (framework: Vite).
2. Settings → Environment Variables (Production):
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`  ← required
   - `VITE_OWNER_PASSPHRASE`                        ← local preview only
   - `VITE_FW_STOREFRONT_TOKEN`, `VITE_FW_CHECKOUT_DOMAIN` ← Fourthwall
3. **Redeploy after changing env vars** — Vite bakes them in at build time.

## Supabase setup (once)
1. Create a project → SQL Editor → run `supabase.sql`
   (already ran an older version? run `migrate-v2.sql` instead).
2. Storage → New bucket → name `daylog` → **Public** →
   policies: INSERT/UPDATE/DELETE for `authenticated`.
3. Authentication → Users → Add user (your email + password),
   then Providers → Email → disable new sign-ups.

## Owner login
- Keyboard: ⌘/Ctrl+Shift+L (some browsers reserve this — use the next two)
- Mobile: tap the wordmark 5× quickly
- Fallback: visit `yoursite.com/#login`

## Fourthwall
Products attach to images via the $ action (live catalog picker when the
storefront token is set). Buy buttons create a cart via the Storefront API
and hand off to Fourthwall's hosted checkout — they handle payment,
shipping, and fulfillment.
