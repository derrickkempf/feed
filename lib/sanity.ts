import 'server-only'
import {createClient, defineQuery} from 'next-sanity'
import {apiVersion, dataset, isConfigured, projectId} from '@/sanity/env'
import type {AboutDoc, Day, Settings, WorkDetail, WorkSummary} from './types'

const client = isConfigured ? createClient({projectId, dataset, apiVersion, useCdn: true, perspective: 'published'}) : null

async function sanityFetch<T>(query: string, params: Record<string, unknown> = {}, fallback: T): Promise<T> {
  if (!client) return fallback
  const result = await client.fetch<T>(query, params, {next: {revalidate: 300, tags: ['sanity']}})
  return result ?? fallback
}

/* ---------- projections ---------- */

const IMG = `{"url": asset->url, "w": asset->metadata.dimensions.width, "h": asset->metadata.dimensions.height, "lqip": asset->metadata.lqip}`

const WORK_CARD = `{title, subtitle, "slug": slug.current, "cover": gallery[0].image${IMG}}`

const ITEM = `
  _key, _type, layout,
  _type == "feedImage" => {caption, tags, product, "img": image${IMG}, "project": project->{title, "slug": slug.current}},
  _type in ["textBlock", "quoteBlock"] => {text, cite},
  _type == "linkBlock" => {url, label, "imageUrl": image.asset->url},
  _type == "videoBlock" => {url},
  _type == "postBlock" => {"work": work->${WORK_CARD}}
`

/* ---------- queries ---------- */

export const FEED_QUERY = defineQuery(`*[_type == "day" && count(items) > 0] | order(date desc){
  _id, date,
  "items": items[]{
    ${ITEM},
    _type == "cardBlock" => {"card": snippet->content[0]{${ITEM}}}
  }
}`)

export const WORKS_QUERY = defineQuery(`*[_type == "work" && defined(slug.current)] | order(publishedAt asc){
  title, subtitle, "slug": slug.current,
  "excerpt": coalesce(excerpt, pt::text(body[_type == "block" && style == "normal"][0])),
  "cover": gallery[0].image${IMG}
}`)

export const WORK_QUERY = defineQuery(`*[_type == "work" && slug.current == $slug][0]{
  title, subtitle, "slug": slug.current, excerpt,
  "body": body[]{..., _type == "bodyImage" => {"img": image${IMG}}},
  "gallery": gallery[]{_key, alt, mode, "img": image${IMG}}
}`)

export const SETTINGS_QUERY = defineQuery(`*[_id == "settings"][0]{
  title, tagline, heroLines, description, "ogImage": ogImage.asset->url, footerLink, fourthwall
}`)

export const ABOUT_QUERY = defineQuery(`*[_id == "about"][0]{
  "photo": photo${IMG},
  "body": body[]{..., _type == "bodyImage" => {"img": image${IMG}}}
}`)

/* ---------- fetchers ---------- */

export const DEFAULT_SETTINGS: Settings = {
  title: 'Derrick Kempf',
  tagline: 'Artist & Brand Identity Designer',
  heroLines: ['Art feed'],
  description: "A daily record of what I'm making.",
  footerLink: {label: 'MA:DE', url: 'https://madeartes.com'},
  fourthwall: {shopUrl: 'https://dewd.cool/'},
}

export const getFeed = () => sanityFetch<Day[]>(FEED_QUERY, {}, [])
export const getWorks = () => sanityFetch<WorkSummary[]>(WORKS_QUERY, {}, [])
export const getWork = (slug: string) => sanityFetch<WorkDetail | null>(WORK_QUERY, {slug}, null)
export const getAbout = () => sanityFetch<AboutDoc | null>(ABOUT_QUERY, {}, null)
export async function getSettings(): Promise<Settings> {
  const s = await sanityFetch<Partial<Settings> | null>(SETTINGS_QUERY, {}, null)
  return {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(Object.entries(s || {}).filter(([, v]) => v != null && v !== '')),
  } as Settings
}
