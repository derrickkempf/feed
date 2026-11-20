import {layout, product, inlineText, feedImage, textBlock, quoteBlock, linkBlock, videoBlock, postBlock, cardBlock} from './blocks'
import {day, richBody, work, snippet, about, settings} from './documents'

export const schemaTypes = [
  // documents
  day,
  work,
  snippet,
  about,
  settings,
  // objects
  layout,
  product,
  inlineText,
  richBody,
  feedImage,
  textBlock,
  quoteBlock,
  linkBlock,
  videoBlock,
  postBlock,
  cardBlock,
]

export const singletonTypes = new Set(['settings', 'about'])
