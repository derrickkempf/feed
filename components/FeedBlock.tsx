import Link from 'next/link'
import {PortableText, type PortableTextComponents} from '@portabletext/react'
import type {FeedItem, LinkBlock, PostBlock} from '@/lib/types'
import {imgSrc, videoEmbed} from '@/lib/format'

export const inlineComponents: PortableTextComponents = {
  block: {normal: ({children}) => <p className="dl-note-text">{children}</p>},
  marks: {
    link: ({value, children}) => (
      <a href={value?.href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
  },
}

function LinkCard({item}: {item: LinkBlock}) {
  let host = ''
  try {
    host = new URL(item.url).hostname.replace(/^www\./, '')
  } catch {}
  return (
    <a className={`dl-linkcard ${item.imageUrl ? 'dl-linkcard-withimg' : ''}`} href={item.url} target="_blank" rel="noopener noreferrer">
      <span className="dl-linkcard-body">
        <span className="dl-linkcard-label">{item.label || item.url}</span>
        {host && <span className="dl-linkcard-host">{host} ↗</span>}
      </span>
      {item.imageUrl && (
        <span className="dl-linkcard-img">
          <img src={imgSrc(item.imageUrl, 720)} alt="" loading="lazy" />
        </span>
      )}
    </a>
  )
}

export function PostCard({item}: {item: PostBlock}) {
  const w = item.work
  if (!w) return null
  return (
    <Link className="dl-postcard" href={`/work/${w.slug}`}>
      {w.cover && (
        <span className="dl-postcard-cover" style={{aspectRatio: `${w.cover.w} / ${w.cover.h}`}}>
          <img src={imgSrc(w.cover.url, 900)} alt="" loading="lazy" />
        </span>
      )}
      <span className="dl-postcard-title">{w.title}</span>
      {w.subtitle && <span className="dl-postcard-sub">{w.subtitle}</span>}
      <span className="dl-work-card-more">Read more</span>
    </Link>
  )
}

/** Non-image feed items (text, quote, link, video, work card, saved card). */
export function FeedBlock({item}: {item: FeedItem}) {
  switch (item._type) {
    case 'textBlock':
      return <PortableText value={item.text || []} components={inlineComponents} />
    case 'quoteBlock':
      return (
        <blockquote className="dl-quote">
          <PortableText value={item.text || []} components={{...inlineComponents, block: {normal: ({children}) => <p>{children}</p>}}} />
          {item.cite && <cite>— {item.cite}</cite>}
        </blockquote>
      )
    case 'linkBlock':
      return <LinkCard item={item} />
    case 'videoBlock': {
      const src = videoEmbed(item.url || '')
      return src ? (
        <span className="dl-videobox">
          <iframe
            src={src}
            title="Embedded video"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </span>
      ) : null
    }
    case 'postBlock':
      return <PostCard item={item} />
    case 'cardBlock': {
      const c = item.card
      if (!c) return null
      if (c._type === 'feedImage')
        return (
          <span className="dl-snipimg" style={{aspectRatio: `${c.img.w} / ${c.img.h}`}}>
            <img src={imgSrc(c.img.url)} alt={c.caption || ''} loading="lazy" />
            {c.caption && <span className="dl-itemcap">{c.caption}</span>}
          </span>
        )
      return <FeedBlock item={c} />
    }
    default:
      return null
  }
}
