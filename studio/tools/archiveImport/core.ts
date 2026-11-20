/**
 * Archive import — the logic, kept free of React so it can be tested on its own.
 *
 * 1. readCaptureDate(): EXIF DateTimeOriginal → CreateDate → DateTime(Modify), falling back to the
 *    file's last-modified time.
 * 2. groupByDay(): bucket files by local calendar date (YYYY-MM-DD), oldest first within a day.
 * 3. planDayWrites(): given the days that already exist (published and/or draft), produce the
 *    mutations that append new images — never touching existing items.
 */
import exifr from 'exifr'

export type DateSource = 'exif' | 'file'

export type Candidate = {
  file: File
  takenAt: Date
  source: DateSource
}

export type Mode = 'publish' | 'draft'

export type ExistingDay = {_id: string; date: string; items?: unknown[]; [k: string]: unknown}

export type NewItem = {
  _type: 'feedImage'
  _key: string
  image: {_type: 'image'; asset: {_type: 'reference'; _ref: string}}
  takenAt: string
}

export type Mutation =
  | {createIfNotExists: Record<string, unknown> & {_id: string}}
  | {create: Record<string, unknown> & {_id: string}}
  | {patch: {id: string; setIfMissing: {items: []}; insert: {after: 'items[-1]'; items: NewItem[]}}}

const EXIF_FIELDS = ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized', 'ModifyDate', 'DateTime']

export const IMAGE_TYPES = /^image\/(jpeg|png|webp|gif|tiff|avif|heic|heif)$/i
export const IMAGE_EXT = /\.(jpe?g|png|webp|gif|tiff?|avif|heic|heif)$/i
export const isImageFile = (f: File) => IMAGE_TYPES.test(f.type) || IMAGE_EXT.test(f.name)

/** Capture time from EXIF if present, otherwise the file's modified time. */
export async function readCaptureDate(file: File): Promise<Candidate> {
  // EXIF normally sits in the first few KB; only read the whole file if the head has no date (e.g. some HEIC/PNG).
  const HEAD = 512 * 1024
  const attempts = file.size > HEAD ? [file.slice(0, HEAD), file] : [file]
  for (const blob of attempts) {
    try {
      const tags = await exifr.parse(await blob.arrayBuffer(), {pick: EXIF_FIELDS, reviveValues: true})
      for (const f of EXIF_FIELDS) {
        const v = tags?.[f]
        if (v instanceof Date && !isNaN(v.getTime()) && v.getFullYear() > 1900) return {file, takenAt: v, source: 'exif'}
      }
    } catch {
      // unreadable / no EXIF in this chunk — try the next, then fall back
    }
  }
  return {file, takenAt: new Date(file.lastModified), source: 'file'}
}

/** Local calendar day. EXIF times have no time zone, so “the day the photo says” is the local day. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function groupByDay<T extends {takenAt: Date}>(items: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const it of [...items].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime())) {
    const k = dayKey(it.takenAt)
    if (!out.has(k)) out.set(k, [])
    out.get(k)!.push(it)
  }
  // newest day first, like the feed
  return new Map([...out.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)))
}

export const randomKey = () => Math.random().toString(36).slice(2, 14)

export function makeItem(assetId: string, takenAt: Date, key = randomKey()): NewItem {
  return {
    _type: 'feedImage',
    _key: key,
    image: {_type: 'image', asset: {_type: 'reference', _ref: assetId}},
    takenAt: takenAt.toISOString(),
  }
}

const isDraft = (id: string) => id.startsWith('drafts.')
const baseId = (id: string) => id.replace(/^drafts\./, '')

/**
 * Mutations for one date.
 *
 * - Existing versions (published and/or draft) are appended to, never replaced.
 * - Publish mode, no existing day → create the published day.
 * - Draft mode → items land in the draft. If only a published day exists, the draft starts as a copy
 *   of it (that's how Sanity drafts work), so nothing goes live until you hit Publish.
 */
export function planDayWrites(date: string, items: NewItem[], existing: ExistingDay[], mode: Mode): Mutation[] {
  if (!items.length) return []
  const append = (id: string): Mutation => ({
    patch: {id, setIfMissing: {items: []}, insert: {after: 'items[-1]', items}},
  })

  const published = existing.find((d) => !isDraft(d._id))
  const draft = existing.find((d) => isDraft(d._id))
  const id = baseId((published || draft)?._id || `day-${date}`)

  if (mode === 'publish') {
    const muts: Mutation[] = []
    if (published) muts.push(append(published._id))
    else muts.push({createIfNotExists: {_id: id, _type: 'day', date, items}})
    if (draft) muts.push(append(draft._id)) // keep an open draft in sync so publishing it later doesn't drop the images
    return muts
  }

  if (draft) return [append(draft._id)]
  if (published) {
    const {_rev, _updatedAt, _createdAt, ...rest} = published as Record<string, unknown> & ExistingDay
    void _rev, void _updatedAt, void _createdAt
    return [
      {
        create: {
          ...rest,
          _id: `drafts.${id}`,
          items: [...((published.items as unknown[]) || []), ...items],
        },
      },
    ]
  }
  return [{create: {_id: `drafts.${id}`, _type: 'day', date, items}}]
}
