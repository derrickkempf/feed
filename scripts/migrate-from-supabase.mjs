#!/usr/bin/env node
/**
 * One-shot migration: old Supabase "daylog" backend → Sanity.
 *
 *   npm run migrate              # reads from SUPABASE_URL + SUPABASE_ANON_KEY
 *   npm run migrate -- --dry     # convert + print a summary, write nothing
 *
 * If SUPABASE_ANON_KEY is empty it reads ./export/{images,notes,pages,snippets}.json instead
 * (a JSON export of each table, e.g. from the Supabase dashboard).
 *
 * Idempotent: documents use deterministic IDs (day-YYYY-MM-DD, work-<slug>, snippet-<id>)
 * and are written with createOrReplace, so re-running overwrites rather than duplicates.
 */
import {createClient} from '@sanity/client'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'

const DRY = process.argv.includes('--dry')
const {
  NEXT_PUBLIC_SANITY_PROJECT_ID: projectId,
  NEXT_PUBLIC_SANITY_DATASET: dataset = 'production',
  SANITY_WRITE_TOKEN: token,
  SUPABASE_URL = 'https://xpkkvpaztnqgzczzflrp.supabase.co',
  SUPABASE_ANON_KEY,
} = process.env
const BUCKET = 'daylog'

if (!DRY && (!projectId || !token)) {
  console.error('Set NEXT_PUBLIC_SANITY_PROJECT_ID and SANITY_WRITE_TOKEN in .env.local (or pass --dry).')
  process.exit(1)
}
const sanity = DRY ? null : createClient({projectId, dataset, token, apiVersion: '2026-11-01', useCdn: false})

/* ---------------- load source ---------------- */

async function loadTable(name, order) {
  if (SUPABASE_ANON_KEY) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${name}?select=*&order=${order}`, {
      headers: {apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`},
    })
    if (!res.ok) throw new Error(`Supabase ${name}: ${res.status} ${await res.text()}`)
    return res.json()
  }
  try {
    return JSON.parse(await readFile(new URL(`../export/${name}.json`, import.meta.url), 'utf8'))
  } catch (e) {
    if (name === 'snippets' || name === 'notes') return [] // optional tables
    throw new Error(`No SUPABASE_ANON_KEY and could not read export/${name}.json: ${e.message}`)
  }
}

const publicUrl = (path) => (/^https?:/.test(path) ? path : `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`)

/* ---------------- helpers ---------------- */

const key = () => randomUUID().replace(/-/g, '').slice(0, 12)
const ref = (_ref) => ({_type: 'reference', _ref})
const workId = (slug) => `work-${slug.replace(/[^a-zA-Z0-9_-]/g, '-')}`
const snippetId = (id) => `snippet-${String(id).replace(/[^a-zA-Z0-9_-]/g, '-')}`

const assetCache = new Map()
let uploads = 0
async function image(url) {
  if (!url) return undefined
  const src = publicUrl(url)
  if (DRY) return {_type: 'image', asset: ref(`dry-${uploads++}`)}
  if (!assetCache.has(src)) {
    assetCache.set(
      src,
      (async () => {
        const res = await fetch(src)
        if (!res.ok) throw new Error(`Download failed ${res.status}: ${src}`)
        const buf = Buffer.from(await res.arrayBuffer())
        const asset = await sanity.assets.upload('image', buf, {filename: src.split('/').pop()})
        uploads++
        process.stdout.write('.')
        return asset._id
      })(),
    )
  }
  return {_type: 'image', asset: ref(await assetCache.get(src))}
}

const layout = (r) =>
  r.fx != null ? {_type: 'layout', x: Number(r.fx), y: Number(r.fy || 0), width: r.fw != null ? Number(r.fw) : undefined} : undefined

/** Inline markdown (**bold**, *em*, [label](https://…)) → Portable Text block. */
function mdBlock(text, style = 'normal') {
  const children = []
  const markDefs = []
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\))/
  let s = String(text || '')
  while (s) {
    const m = s.match(re)
    if (!m) {
      children.push({_type: 'span', _key: key(), text: s, marks: []})
      break
    }
    if (m.index > 0) children.push({_type: 'span', _key: key(), text: s.slice(0, m.index), marks: []})
    if (m[2]) children.push({_type: 'span', _key: key(), text: m[2], marks: ['strong']})
    else if (m[4]) children.push({_type: 'span', _key: key(), text: m[4], marks: ['em']})
    else {
      const k = key()
      markDefs.push({_type: 'link', _key: k, href: m[7]})
      children.push({_type: 'span', _key: key(), text: m[6], marks: [k]})
    }
    s = s.slice(m.index + m[0].length)
  }
  if (!children.length) children.push({_type: 'span', _key: key(), text: '', marks: []})
  return {_type: 'block', _key: key(), style, markDefs, children}
}

const mdParagraphs = (text) =>
  String(text || '')
    .split(/\n\s*\n/)
    .filter((p) => p.trim())
    .map((p) => mdBlock(p.trim()))

/**
 * Page body (the old editor's syntax) → richBody.
 * Returns the body and the set of image indexes it placed inline (those are left out of the gallery).
 */
async function pageBody(text, images) {
  const used = new Set()
  const out = []
  for (const raw of String(text || '').split(/\n\s*\n/).filter(Boolean)) {
    const p = raw.trim()
    const img = p.match(/^\[\[(\d+)(<|>)?\]\]$/)
    if (img) {
      const i = parseInt(img[1], 10) - 1
      const src = images[i]
      if (!src) continue
      used.add(i)
      out.push({
        _type: 'bodyImage',
        _key: key(),
        image: await image(src.path),
        float: img[2] === '<' ? 'left' : img[2] === '>' ? 'right' : 'inline',
      })
      continue
    }
    if (p.startsWith('>> ') || p.startsWith('<< ')) {
      let t = p.slice(3).replace(/^(>>|<<) ?/gm, '')
      const big = t.startsWith('## ')
      if (big) t = t.slice(3)
      out.push({_type: 'pullQuote', _key: key(), text: t.replace(/\*\*|\*/g, ''), side: p.startsWith('>>') ? 'right' : 'left', big})
      continue
    }
    const h = p.match(/^(#{2,5}) (.*)$/s)
    if (h) {
      out.push(mdBlock(h[2], `h${h[1].length}`))
      continue
    }
    if (p.startsWith('> ')) {
      const t = p.replace(/^> ?/gm, '')
      out.push(t.startsWith('## ') ? mdBlock(t.slice(3), 'bigquote') : mdBlock(t, 'blockquote'))
      continue
    }
    out.push(mdBlock(p))
  }
  return {body: out, used}
}

/** A note / snippet → feed item object. */
async function feedItem(kind, text, data = {}) {
  data = data || {}
  switch (kind) {
    case 'quote':
      return {_type: 'quoteBlock', text: mdParagraphs(text ?? data.text), cite: data.cite || undefined}
    case 'link':
      return data.url
        ? {_type: 'linkBlock', url: data.url, label: data.label || undefined, image: data.img ? await image(data.img) : undefined}
        : null
    case 'video':
      return data.url ? {_type: 'videoBlock', url: data.url} : null
    case 'post':
      return data.slug && pageSlugs.has(data.slug) ? {_type: 'postBlock', work: ref(workId(data.slug))} : null
    case 'card':
      return data.snippetId && snippetIds.has(String(data.snippetId)) ? {_type: 'cardBlock', snippet: ref(snippetId(data.snippetId))} : null
    case 'image':
      return data.url ? {_type: 'feedImage', image: await image(data.url), caption: data.cap || undefined} : null
    default:
      return {_type: 'textBlock', text: mdParagraphs(text ?? data.text)}
  }
}

const strip = (o) => JSON.parse(JSON.stringify(o)) // drop undefined

/* ---------------- run ---------------- */

const [images, notes, pages, snippets] = await Promise.all([
  loadTable('images', 'day.desc,created_at.asc'),
  loadTable('notes', 'created_at.asc'),
  loadTable('pages', 'created_at.asc'),
  loadTable('snippets', 'created_at.asc'),
])
console.log(`Source: ${images.length} images, ${notes.length} notes, ${pages.length} pages, ${snippets.length} snippets`)

const docs = []
const pageSlugs = new Set(pages.map((p) => p.slug))
const snippetIds = new Set(snippets.map((s) => String(s.id)))

// Works + About
for (const p of pages) {
  const imgs = p.images || []
  if (p.slug === '__about__') {
    docs.push({
      _id: 'about',
      _type: 'about',
      photo: imgs[0] ? await image(imgs[0].path) : undefined,
      body: (await pageBody(p.body, imgs)).body,
    })
    continue
  }
  const {body, used} = await pageBody(p.body, imgs)
  const gallery = []
  for (const [i, im] of imgs.entries()) {
    if (used.has(i)) continue
    gallery.push({_type: 'pageImage', _key: key(), image: await image(im.path), mode: im.mode || 'regular'})
  }
  docs.push({
    _id: workId(p.slug),
    _type: 'work',
    title: p.title || p.slug,
    slug: {_type: 'slug', current: p.slug},
    subtitle: p.subtitle || undefined,
    publishedAt: p.created_at || undefined,
    body,
    gallery,
  })
}

// Saved cards
for (const s of snippets) {
  const item = await feedItem(s.kind, s.data?.text, s.data)
  if (!item) continue
  docs.push({_id: snippetId(s.id), _type: 'snippet', name: s.name || 'Card', content: [{...item, _key: key()}]})
}

// Days
const days = new Map()
const dayOf = (d) => {
  const date = String(d).slice(0, 10)
  if (!days.has(date)) days.set(date, [])
  return days.get(date)
}
for (const im of images) {
  dayOf(im.day).push({
    _type: 'feedImage',
    _key: key(),
    image: await image(im.path),
    caption: im.cap || undefined,
    tags: im.tags?.length ? im.tags : undefined,
    project: im.page && pageSlugs.has(im.page) ? ref(workId(im.page)) : undefined,
    product: im.product
      ? {_type: 'product', name: im.product.name, price: im.product.price, url: im.product.url, variantId: im.product.variantId}
      : undefined,
    layout: layout(im),
  })
}
for (const n of notes) {
  const item = await feedItem(n.kind || 'text', n.text, n.data)
  if (item) dayOf(n.day).push({...item, _key: key(), layout: layout(n)})
}
for (const [date, items] of days) docs.push({_id: `day-${date}`, _type: 'day', date, items})

console.log(`\nPrepared ${docs.length} documents (${days.size} days), ${uploads} image uploads.`)

if (DRY) {
  console.log(JSON.stringify(strip(process.env.DRY_ALL ? docs : docs.slice(0, 3)), null, 2).slice(0, process.env.DRY_ALL ? 1e6 : 4000))
  process.exit(0)
}

// Write in batches; refs to works/snippets are strong, so create those before days.
const order = {work: 0, about: 0, snippet: 1, day: 2}
docs.sort((a, b) => order[a._type] - order[b._type])
for (let i = 0; i < docs.length; i += 50) {
  const tx = sanity.transaction()
  for (const d of docs.slice(i, i + 50)) tx.createOrReplace(strip(d))
  await tx.commit({visibility: 'async'})
  console.log(`Wrote ${Math.min(i + 50, docs.length)}/${docs.length}`)
}
console.log('Done. Open /studio to review.')
