import type {PortableTextBlock} from 'next-sanity'

export type Img = {url: string; w: number; h: number; lqip?: string}
export type Layout = {x?: number; y?: number; width?: number}
export type Product = {name?: string; price?: string; url?: string; variantId?: string}
export type WorkCard = {title: string; subtitle?: string; slug: string; cover?: Img | null}

type Base = {_key: string; layout?: Layout | null}
export type FeedImage = Base & {
  _type: 'feedImage'
  img: Img
  caption?: string
  tags?: string[]
  product?: Product | null
  project?: {title: string; slug: string} | null
}
export type TextBlock = Base & {_type: 'textBlock'; text?: PortableTextBlock[]}
export type QuoteBlock = Base & {_type: 'quoteBlock'; text?: PortableTextBlock[]; cite?: string}
export type LinkBlock = Base & {_type: 'linkBlock'; url: string; label?: string; imageUrl?: string}
export type VideoBlock = Base & {_type: 'videoBlock'; url: string}
export type PostBlock = Base & {_type: 'postBlock'; work?: WorkCard | null}
export type CardBlock = Base & {_type: 'cardBlock'; card?: Exclude<FeedItem, CardBlock> | null}
export type FeedItem = FeedImage | TextBlock | QuoteBlock | LinkBlock | VideoBlock | PostBlock | CardBlock

export type Day = {_id: string; date: string; items: FeedItem[]}

export type WorkSummary = WorkCard & {excerpt?: string}
export type BodyBlock = PortableTextBlock | {_type: 'bodyImage'; _key: string; img: Img; alt?: string; float?: 'inline' | 'left' | 'right'} | {_type: 'pullQuote'; _key: string; text?: string; side?: 'left' | 'right'; big?: boolean}
export type GalleryImage = {_key: string; img: Img; alt?: string; mode?: 'regular' | 'wide' | 'full' | 'gallery' | 'slider'}
export type WorkDetail = {title: string; subtitle?: string; slug: string; excerpt?: string; body?: BodyBlock[]; gallery?: GalleryImage[]}

export type AboutDoc = {photo?: Img | null; body?: BodyBlock[]}
export type Settings = {
  title: string
  tagline: string
  heroLines: string[]
  description: string
  ogImage?: string
  footerLink: {label?: string; url?: string}
  fourthwall: {shopUrl?: string; storefrontToken?: string}
}
