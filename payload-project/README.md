# Feed — Payload backend

This is the Payload CMS backend for the Feed site, tested locally end-to-end
(build, boot, auth, every read/write operation the frontend needs) but not
yet deployed anywhere public. Here's the full setup, start to finish.

**The stack:** Render hosts the app itself; Neon hosts the Postgres
database. They're independent -- Payload just needs a `DATABASE_URL`, and
doesn't care who's behind it. Neon's free tier has no expiration date and
auto-wakes on traffic, which is why it's the recommended database here
instead of Render's own free Postgres (deleted after 30 days) or Supabase's
(pauses after 7 days idle and needs a manual restore click to wake back up).

## 1. Create the database on Neon

1. Sign up at [neon.tech](https://neon.tech) (GitHub login works)
2. Create a project -- name it anything (e.g. `feed`)
3. On the project's dashboard, copy the **connection string** shown under
   "Connection Details." It looks like:
   `postgres://user:password@ep-something.region.aws.neon.tech/neondb?sslmode=require`
4. Keep this tab open -- you'll need this string twice (once for the local
   migration in step 3, once as `DATABASE_URL` in Render)

Nothing else to configure. Neon's free tier is ready to use as soon as the
project exists.

## 2. Deploy the app on Render

1. Sign up at [render.com](https://render.com) (GitHub login works)
2. **New +** -> **Web Service** -> connect your GitHub account -> select
   `derrickkempf/feed`
3. Fill in:
   - **Root Directory**: `payload-project` (this repo has other things at
     the top level -- this field is what tells Render where the actual app
     lives)
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: Free is fine to start
4. Under **Environment Variables**, add:
   - `DATABASE_URL` -> paste the Neon connection string from step 1
   - `PAYLOAD_SECRET` -> any long random string -- generate one with
     `openssl rand -base64 32` in Terminal, or ask me to generate one
5. **Create Web Service**. First deploy takes a few minutes -- watch the
   logs for "Live" at the top.

## 3. Run the database migration once

The tables don't exist in the fresh Neon database yet. From your own
machine, with this repo cloned:

```bash
cd payload-project
npm install
DATABASE_URL="<the same Neon connection string>" PAYLOAD_SECRET="<the same secret you put in Render>" npx payload migrate
```

This only needs to run once (and again in the future only if the
collections themselves change).

## 4. Create your owner login

Once Render shows "Live," visit `https://your-service-name.onrender.com/admin`
and follow the "create your first user" prompt. This is the account
`signInOwner` in `backend-payload.js` logs into -- the same login flow your
site's existing owner-mode UI already calls, just pointed at Payload now.

## 5. Bring your existing content over (optional)

If you have live content in Supabase you want to keep:

```bash
cd payload-project
npm install dotenv @supabase/supabase-js
cat > .env << EOF
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
PAYLOAD_URL=https://your-service-name.onrender.com
PAYLOAD_EMAIL=you@example.com
PAYLOAD_PASSWORD=your-owner-password
EOF
node migrate-from-supabase.mjs
```

Only reads from Supabase, only writes to Payload -- safe to run, never
touches your existing Supabase data.

## 6. Point the live site at Payload

In Vercel -> your `feed` project -> **Environment Variables**, add:

```
VITE_PAYLOAD_URL=https://your-service-name.onrender.com
```

Redeploy (or push any commit -- Vercel rebuilds automatically). That env
var is the actual switch: `src/backend.js` picks Payload the moment it's
present, with zero frontend code changes. Leave `VITE_SUPABASE_URL` in
place -- the dispatcher only reaches for Payload when its own env var is
set, so you can unset `VITE_PAYLOAD_URL` at any time to fall back to
Supabase instantly if something looks wrong.

## What's already verified, locally

Everything below was tested against a real running Payload + Postgres
instance in the build environment, not just written and assumed correct:

- Production build (`next build`) compiles clean
- Owner login/logout via `/api/users/login`
- Every operation `backend-payload.js` exposes: image upload with
  metadata, canvas notes/blocks, bulk drag-position saves, post pages
  with embedded images, reusable snippet cards, deletes
- Access control: writes are rejected before login and after logout;
  reads work for a completely anonymous visitor with no credentials

The only things that haven't been tested against your actual accounts are
Neon and Render themselves (I can't create accounts on your behalf) and
the migration script's Supabase-reading half (needs your real project
credentials).
