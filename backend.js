// Storage layer with two drivers:
//   · Supabase (set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY) — permanent
//     public image URLs, your real archive.
//   · Local preview (no env vars) — browser storage only, so you can run
//     `npm run dev` the moment you clone. Not an archive; ~5MB browser cap.
//
// Interface used by App.jsx:
//   isLocalPreview()
//   fetchAll() → { days:[{date, images:[{id,w,h,tags,product,page,url}]}], pages:[...] }
//   addImage({id, date, blob, w, h}) → meta
//   deleteImage(date, id)
//   patchImage(id, patch)                    // tags / product / page
//   createPage(page) · patchPage(slug,patch) · deletePage(slug)
//   addPageImage({slug, id, blob, w, h}) → meta
//   removePageImage(slug, id)

import { createClient } from "@supabase/supabase-js";

const URL_ = import.meta.env.VITE_SUPABASE_URL;
const KEY_ = import.meta.env.VITE_SUPABASE_ANON_KEY;
const LOCAL = !URL_ || !KEY_;
const BUCKET = "daylog";

export const isLocalPreview = () => LOCAL;

/* ---------------- Supabase driver ---------------- */
const sb = LOCAL ? null : createClient(URL_, KEY_);
const publicUrl = (path) => sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

async function sbFetchAll() {
  const [imgs, nts, pgs] = await Promise.all([
    sb.from("images").select("*").order("day", { ascending: false }).order("created_at", { ascending: true }),
    sb.from("notes").select("*").order("created_at", { ascending: true }),
    sb.from("pages").select("*").order("created_at", { ascending: true }),
  ]);
  if (imgs.error) throw imgs.error;
  if (pgs.error) throw pgs.error;
  const notesData = nts.error ? [] : nts.data; // tolerate pre-migration DBs
  const byDay = new Map();
  const dayOf = (v) => String(v);
  for (const r of imgs.data) {
    const day = dayOf(r.day);
    if (!byDay.has(day)) byDay.set(day, { date: day, images: [], notes: [] });
    byDay.get(day).images.push({
      id: r.id, w: r.w, h: r.h,
      tags: r.tags || [], product: r.product || null, page: r.page || null,
      cap: r.cap || "", fx: r.fx, fy: r.fy, fw: r.fw,
      url: publicUrl(r.path),
    });
  }
  for (const n of notesData) {
    const day = dayOf(n.day);
    if (!byDay.has(day)) byDay.set(day, { date: day, images: [], notes: [] });
    byDay.get(day).notes.push({ id: n.id, text: n.text, fx: n.fx, fy: n.fy, fw: n.fw });
  }
  const days = [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  const pages = pgs.data.map((p) => ({
    slug: p.slug, title: p.title, subtitle: p.subtitle, body: p.body,
    images: (p.images || []).map((m) => ({ ...m, url: publicUrl(m.path) })),
  }));
  return { days, pages };
}

async function sbAddNote({ id, day, text, fx, fy, fw }) {
  const { error } = await sb.from("notes").insert({ id, day, text, fx, fy, fw });
  if (error) throw error;
}
async function sbPatchNote(id, patch) {
  const { error } = await sb.from("notes").update(patch).eq("id", id);
  if (error) throw error;
}
async function sbDeleteNote(id) {
  const { error } = await sb.from("notes").delete().eq("id", id);
  if (error) throw error;
}
// bulk position save after a drag (materializes the whole day's layout)
async function sbSaveLayout(updates) {
  for (const u of updates) {
    const table = u.kind === "note" ? "notes" : "images";
    await sb.from(table).update({ fx: u.fx, fy: u.fy, fw: u.fw }).eq("id", u.id);
  }
}

async function sbAddImage({ id, date, blob, w, h }) {
  const path = `days/${date}/${id}.jpg`;
  const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  const ins = await sb.from("images").insert({ id, day: date, w, h, tags: [], path });
  if (ins.error) throw ins.error;
  return { id, w, h, tags: [], product: null, page: null, url: publicUrl(path) };
}

async function sbDeleteImage(date, id) {
  await sb.storage.from(BUCKET).remove([`days/${date}/${id}.jpg`]);
  const { error } = await sb.from("images").delete().eq("id", id);
  if (error) throw error;
}

async function sbPatchImage(id, patch) {
  const { error } = await sb.from("images").update(patch).eq("id", id);
  if (error) throw error;
}

async function sbCreatePage(page) {
  const { error } = await sb.from("pages").insert({ ...page, images: [] });
  if (error) throw error;
}

async function sbPatchPage(slug, patch) {
  const { error } = await sb.from("pages").update(patch).eq("slug", slug);
  if (error) throw error;
}

async function sbDeletePage(slug) {
  const { data } = await sb.from("pages").select("images").eq("slug", slug).single();
  const paths = (data?.images || []).map((m) => m.path).filter(Boolean);
  if (paths.length) await sb.storage.from(BUCKET).remove(paths);
  const { error } = await sb.from("pages").delete().eq("slug", slug);
  if (error) throw error;
  await sb.from("images").update({ page: null }).eq("page", slug);
}

async function sbAddPageImage({ slug, id, blob, w, h }) {
  const path = `pages/${slug}/${id}.jpg`;
  const up = await sb.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg" });
  if (up.error) throw up.error;
  const { data, error } = await sb.from("pages").select("images").eq("slug", slug).single();
  if (error) throw error;
  const images = [...(data.images || []), { id, w, h, path }];
  const upd = await sb.from("pages").update({ images }).eq("slug", slug);
  if (upd.error) throw upd.error;
  return { id, w, h, path, url: publicUrl(path) };
}

async function sbRemovePageImage(slug, id) {
  const { data, error } = await sb.from("pages").select("images").eq("slug", slug).single();
  if (error) throw error;
  const m = (data.images || []).find((x) => x.id === id);
  if (m?.path) await sb.storage.from(BUCKET).remove([m.path]);
  const images = (data.images || []).filter((x) => x.id !== id);
  await sb.from("pages").update({ images }).eq("slug", slug);
}

/* ---------------- Local preview driver (browser storage) ---------------- */
const LS = {
  get(k, fb) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fb;
    } catch {
      return fb;
    }
  },
  set(k, v) {
    localStorage.setItem(k, JSON.stringify(v));
  },
};
const blobToDataURL = (blob) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });

async function lsFetchAll() {
  const days = LS.get("dl-days", []);
  const pages = LS.get("dl-pages", []);
  const withUrls = (metas, prefix) =>
    metas.map((m) => ({ ...m, url: localStorage.getItem(`${prefix}${m.id}`) || "" }));
  return {
    days: days.map((d) => ({ ...d, notes: d.notes || [], images: withUrls(d.images, "dl-img-") })),
    pages: pages.map((p) => ({ ...p, images: withUrls(p.images, "dl-pgimg-") })),
  };
}

async function lsAddNote({ id, day, text, fx, fy, fw }) {
  const days = LS.get("dl-days", []);
  let d = days.find((x) => x.date === day);
  if (!d) {
    d = { date: day, images: [], notes: [] };
    days.unshift(d);
    days.sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  d.notes = d.notes || [];
  d.notes.push({ id, text, fx, fy, fw });
  LS.set("dl-days", days);
}
async function lsPatchNote(id, patch) {
  const days = LS.get("dl-days", []);
  days.forEach((d) => (d.notes || []).forEach((n) => { if (n.id === id) Object.assign(n, patch); }));
  LS.set("dl-days", days);
}
async function lsDeleteNote(id) {
  const days = LS.get("dl-days", []);
  days.forEach((d) => { d.notes = (d.notes || []).filter((n) => n.id !== id); });
  LS.set("dl-days", days.filter((d) => d.images.length > 0 || (d.notes || []).length > 0));
}
async function lsSaveLayout(updates) {
  const days = LS.get("dl-days", []);
  const map = new Map(updates.map((u) => [u.id, u]));
  days.forEach((d) => {
    d.images.forEach((m) => { const u = map.get(m.id); if (u) Object.assign(m, { fx: u.fx, fy: u.fy, fw: u.fw }); });
    (d.notes || []).forEach((n) => { const u = map.get(n.id); if (u) Object.assign(n, { fx: u.fx, fy: u.fy, fw: u.fw }); });
  });
  LS.set("dl-days", days);
}

async function lsAddImage({ id, date, blob, w, h }) {
  const data = await blobToDataURL(blob);
  localStorage.setItem(`dl-img-${id}`, data);
  const days = LS.get("dl-days", []);
  let d = days.find((x) => x.date === date);
  if (!d) {
    d = { date, images: [] };
    days.unshift(d);
    days.sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  d.images.push({ id, w, h, tags: [], product: null, page: null });
  LS.set("dl-days", days);
  return { id, w, h, tags: [], product: null, page: null, url: data };
}

async function lsDeleteImage(date, id) {
  localStorage.removeItem(`dl-img-${id}`);
  const days = LS.get("dl-days", []).map((d) => ({
    ...d,
    images: d.images.filter((m) => m.id !== id),
  })).filter((d) => d.images.length > 0 || (d.notes || []).length > 0);
  LS.set("dl-days", days);
}

async function lsPatchImage(id, patch) {
  const days = LS.get("dl-days", []);
  days.forEach((d) => d.images.forEach((m) => { if (m.id === id) Object.assign(m, patch); }));
  LS.set("dl-days", days);
}

async function lsCreatePage(page) {
  const pages = LS.get("dl-pages", []);
  pages.push({ ...page, images: [] });
  LS.set("dl-pages", pages);
}

async function lsPatchPage(slug, patch) {
  const pages = LS.get("dl-pages", []);
  pages.forEach((p) => { if (p.slug === slug) Object.assign(p, patch); });
  LS.set("dl-pages", pages);
}

async function lsDeletePage(slug) {
  const pages = LS.get("dl-pages", []);
  const p = pages.find((x) => x.slug === slug);
  (p?.images || []).forEach((m) => localStorage.removeItem(`dl-pgimg-${m.id}`));
  LS.set("dl-pages", pages.filter((x) => x.slug !== slug));
  const days = LS.get("dl-days", []);
  days.forEach((d) => d.images.forEach((m) => { if (m.page === slug) m.page = null; }));
  LS.set("dl-days", days);
}

async function lsAddPageImage({ slug, id, blob, w, h }) {
  const data = await blobToDataURL(blob);
  localStorage.setItem(`dl-pgimg-${id}`, data);
  const pages = LS.get("dl-pages", []);
  const p = pages.find((x) => x.slug === slug);
  if (p) p.images.push({ id, w, h });
  LS.set("dl-pages", pages);
  return { id, w, h, url: data };
}

async function lsRemovePageImage(slug, id) {
  localStorage.removeItem(`dl-pgimg-${id}`);
  const pages = LS.get("dl-pages", []);
  const p = pages.find((x) => x.slug === slug);
  if (p) p.images = p.images.filter((m) => m.id !== id);
  LS.set("dl-pages", pages);
}


/* ---------------- auth (owner sign-in when locked down) ---------------- */
export async function signInOwner(email, password) {
  if (LOCAL) return { error: null };
  const { error } = await sb.auth.signInWithPassword({ email, password });
  return { error };
}
export async function signOutOwner() {
  if (!LOCAL) await sb.auth.signOut();
}
export async function hasSession() {
  if (LOCAL) return false;
  const { data } = await sb.auth.getSession();
  return Boolean(data.session);
}

/* ---------------- exported interface ---------------- */
export const fetchAll = LOCAL ? lsFetchAll : sbFetchAll;
export const addImage = LOCAL ? lsAddImage : sbAddImage;
export const deleteImage = LOCAL ? lsDeleteImage : sbDeleteImage;
export const patchImage = LOCAL ? lsPatchImage : sbPatchImage;
export const createPage = LOCAL ? lsCreatePage : sbCreatePage;
export const patchPage = LOCAL ? lsPatchPage : sbPatchPage;
export const deletePage = LOCAL ? lsDeletePage : sbDeletePage;
export const addPageImage = LOCAL ? lsAddPageImage : sbAddPageImage;
export const removePageImage = LOCAL ? lsRemovePageImage : sbRemovePageImage;
export const addNote = LOCAL ? lsAddNote : sbAddNote;
export const patchNote = LOCAL ? lsPatchNote : sbPatchNote;
export const deleteNote = LOCAL ? lsDeleteNote : sbDeleteNote;
export const saveLayout = LOCAL ? lsSaveLayout : sbSaveLayout;
