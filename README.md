# Derrick Kempf — A Daily Record (Sanity edition)

A rebuild of [derrickkempf.art](https://derrickkempf.art) on **Next.js 16 + Sanity**. The old site was a Vite SPA with a Supabase backend and an in-page owner editor. This version keeps the same design (CSS, fonts, layout logic) and moves all editing into an embedded **Sanity Studio at `/studio`**.

| Old | New |
| --- | --- |
| `#/` feed | `/` |
| `#/work` | `/work` |
| `#/p/<slug>` | `/work/<slug>` |
| `#/about` | `/about` |
| `#login` (owner mode) | `/studio` |

Old hash links redirect automatically (`components/HashRedirect.tsx`).

## Content model (`sanity/schemaTypes`)

- **Day**: one per date. `items[]` can hold:
  - **Image**: caption, tags, linked Work, Fourthwall product
  - **Text** / **Quote**: rich text with bold, italic, and links
  - **Link card**, **Video** (YouTube/Vimeo), **Work card**, **Saved card**

  Each item has an optional **Position** (left/top/width in % of the canvas). Leave it empty and the item is auto-placed in the masonry columns.
- **Work**: title, slug, subtitle, rich body (headings, quotes, inline or floated images, pull quotes), and an image list with `regular | wide | full | gallery | slider` modes.
- **Saved card**: a reusable item you can drop into any day.
- **About** (singleton): photo and body.
- **Site settings** (singleton): wordmark, tagline, feed headline, SEO and share image, footer link, and the Fourthwall shop URL and storefront token.

## Setup

```bash
npm install
cp .env.example .env.local
```

The Sanity project is **`ppc8ofpe`** (dataset `production`), already filled in `.env.example`.

1. In sanity.io/manage → **API → CORS origins**, make sure `http://localhost:3000` (with credentials) and your production URL are listed.
2. Run `npm run dev`, then open http://localhost:3000/studio.
3. Add the Fourthwall storefront token in **Site settings** to turn on one-click checkout.

## Repo layout

- **Repo root**: the Next.js website, with a Studio built in at `/studio`. This is what Vercel deploys.
- **`studio/`**: a standalone copy of the Studio (from `npm create sanity`) that you can host on `*.sanity.studio`:

  ```bash
  cd studio && npm install
  npm run dev      # http://localhost:3333
  npm run deploy   # publish to <name>.sanity.studio
  ```

Both Studios edit the same content. The content types live in `sanity/schemaTypes`. After changing them, run `npm run sync-schema` to copy them into `studio/`.

## Migrating the old content

The old Supabase project (`xpkkvpaztnqgzczzflrp`) was **not reachable** when this was built (DNS failure and 503s, so it looks paused). After you restore it in the Supabase dashboard:

```bash
# .env.local needs SANITY_WRITE_TOKEN (Editor) + SUPABASE_ANON_KEY
npm run migrate -- --dry   # preview
npm run migrate            # write
```

Without Supabase access, export the `images`, `notes`, `pages`, and `snippets` tables as JSON into `./export/`, leave `SUPABASE_ANON_KEY` blank, and run the same command. Image files still download from the `daylog` storage bucket. You can also put full URLs in `path`.

The migration:
- uploads every image to Sanity assets
- converts the old markdown-ish bodies (`**bold**`, `[[2>]]` image floats, `>>` pull quotes, `##` headings) to Portable Text
- keeps each item's saved canvas position
- uses deterministic IDs, so re-running it is safe

## Deploying (Vercel)

Set `NEXT_PUBLIC_SANITY_PROJECT_ID`, `NEXT_PUBLIC_SANITY_DATASET`, and `SANITY_REVALIDATE_SECRET` in the Vercel project settings. Pages cache for 5 minutes. For instant updates, add a GROQ webhook in sanity.io/manage → API → Webhooks:

- URL: `https://<your-domain>/api/revalidate`
- Trigger on: create, update, delete. Filter: `_type in ["day","work","snippet","about","settings"]`
- Secret: same value as `SANITY_REVALIDATE_SECRET`

## Not carried over

- **Drag-to-arrange on the live page.** Positions are now number fields in the Studio. Adding a drag-to-arrange tool would be a good next step.
- `share.jpg` and favicons were missing on the old server (404), so set a share image in Site settings.
