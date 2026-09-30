// One-time migration: copies everything from your live Supabase project
// into a running Payload instance. Run this AFTER Payload is deployed and
// you've logged in once (to create the owner user), and BEFORE you switch
// VITE_PAYLOAD_URL on in Vercel.
//
// Usage:
//   node migrate-from-supabase.mjs
//
// Reads these env vars (put them in a .env file next to this script, or
// export them in your shell first):
//   SUPABASE_URL, SUPABASE_ANON_KEY   -- your existing Supabase project
//   PAYLOAD_URL                        -- your deployed Payload instance
//   PAYLOAD_EMAIL, PAYLOAD_PASSWORD    -- the owner account you created
//
// This only COPIES data -- it never deletes or modifies anything in
// Supabase, so it's safe to run more than once (you'll just get
// duplicates on a second run; wipe the Payload tables first if you need
// a clean re-run).

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const { SUPABASE_URL, SUPABASE_ANON_KEY, PAYLOAD_URL, PAYLOAD_EMAIL, PAYLOAD_PASSWORD } = process.env;

for (const [name, val] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, PAYLOAD_URL, PAYLOAD_EMAIL, PAYLOAD_PASSWORD })) {
  if (!val) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BASE = PAYLOAD_URL.replace(/\/$/, "");

async function login() {
  const res = await fetch(`${BASE}/api/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: PAYLOAD_EMAIL, password: PAYLOAD_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Payload login failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.token;
}

async function post(path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `JWT ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`  ✗ POST ${path} → ${res.status}: ${(await res.text()).slice(0, 150)}`);
  return res.ok;
}

async function uploadImage(collectionPath, blob, filename, meta, token) {
  const fd = new FormData();
  fd.append("file", blob, filename);
  fd.append("_payload", JSON.stringify(meta));
  const res = await fetch(`${BASE}${collectionPath}`, {
    method: "POST",
    headers: { Authorization: `JWT ${token}` },
    body: fd,
  });
  if (!res.ok) {
    console.error(`  ✗ upload ${filename} → ${res.status}: ${(await res.text()).slice(0, 150)}`);
    return null;
  }
  return (await res.json()).doc;
}

async function main() {
  console.log("Logging in to Payload...");
  const token = await login();
  console.log("✓ Logged in\n");

  console.log("Fetching Supabase data...");
  const [imgs, notes, pages, snippets] = await Promise.all([
    sb.from("images").select("*"),
    sb.from("notes").select("*"),
    sb.from("pages").select("*"),
    sb.from("snippets").select("*"),
  ]);
  if (imgs.error) throw imgs.error;
  console.log(`  ${imgs.data.length} images, ${notes.data?.length || 0} notes, ${pages.data.length} pages, ${snippets.data?.length || 0} snippets\n`);

  const BUCKET_URL = `${SUPABASE_URL}/storage/v1/object/public/daylog`;

  console.log("Migrating canvas images...");
  let ok = 0;
  for (const img of imgs.data) {
    const res = await fetch(`${BUCKET_URL}/${img.path}`);
    if (!res.ok) {
      console.error(`  ✗ couldn't fetch ${img.path}`);
      continue;
    }
    const blob = await res.blob();
    const doc = await uploadImage(
      "/api/images",
      blob,
      `${img.id}.jpg`,
      { uid: img.id, day: img.day, tags: img.tags || [], product: img.product || null, linkedPage: img.page || null, cap: img.cap || "", fx: img.fx, fy: img.fy, fw: img.fw },
      token
    );
    if (doc) ok++;
  }
  console.log(`✓ ${ok}/${imgs.data.length} canvas images migrated\n`);

  console.log("Migrating blocks (notes)...");
  ok = 0;
  for (const n of notes.data || []) {
    const success = await post("/api/blocks", { uid: n.id, day: n.day, text: n.text, kind: n.kind || "text", data: n.data || null, fx: n.fx, fy: n.fy, fw: n.fw }, token);
    if (success) ok++;
  }
  console.log(`✓ ${ok}/${notes.data?.length || 0} blocks migrated\n`);

  console.log("Migrating pages...");
  const pageIdBySlug = {};
  ok = 0;
  for (const p of pages.data) {
    const res = await fetch(`${BASE}/api/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `JWT ${token}` },
      body: JSON.stringify({ slug: p.slug, title: p.title, subtitle: p.subtitle, body: p.body }),
    });
    if (res.ok) {
      const { doc } = await res.json();
      pageIdBySlug[p.slug] = doc.id;
      ok++;
    } else {
      console.error(`  ✗ page ${p.slug} → ${res.status}`);
    }
  }
  console.log(`✓ ${ok}/${pages.data.length} pages migrated\n`);

  console.log("Migrating page images...");
  ok = 0;
  let total = 0;
  for (const p of pages.data) {
    for (const m of p.images || []) {
      total++;
      const res = await fetch(`${BUCKET_URL}/${m.path}`);
      if (!res.ok) {
        console.error(`  ✗ couldn't fetch ${m.path}`);
        continue;
      }
      const blob = await res.blob();
      const doc = await uploadImage(
        "/api/images",
        blob,
        `${m.id}.jpg`,
        { uid: m.id, cap: m.cap || "", mode: m.mode || "regular", page: pageIdBySlug[p.slug] },
        token
      );
      if (doc) ok++;
    }
  }
  console.log(`✓ ${ok}/${total} page images migrated\n`);

  console.log("Migrating snippets...");
  ok = 0;
  for (const s of snippets.data || []) {
    const success = await post("/api/snippets", { uid: s.id, name: s.name, kind: s.kind, data: s.data || null }, token);
    if (success) ok++;
  }
  console.log(`✓ ${ok}/${snippets.data?.length || 0} snippets migrated\n`);

  console.log("Done. Spot-check the Payload admin panel, then flip VITE_PAYLOAD_URL on in Vercel.");
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
