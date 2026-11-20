'use client'

import {useEffect, useMemo, useRef, useState} from 'react'
import type {Day, FeedImage, FeedItem, Settings} from '@/lib/types'
import {dayLabel, imgSrc} from '@/lib/format'
import {FeedBlock} from './FeedBlock'
import {ImageDetail} from './ImageDetail'

type Pos = {fx: number; fy: number; fw: number}

const GAP = 3
const isImage = (i: FeedItem): i is FeedImage => i._type === 'feedImage'

/** Rough height (in % of canvas width) for auto-placing blocks; real heights are measured after render. */
function blockH(it: FeedItem, w: number): number {
  const inner = it._type === 'cardBlock' && it.card ? it.card : it
  switch (inner._type) {
    case 'feedImage':
      return w / (inner.img.w / inner.img.h)
    case 'videoBlock':
      return (w * 9) / 16
    case 'postBlock':
      return inner.work?.cover ? w / (inner.work.cover.w / inner.work.cover.h) + 8 : 10
    case 'linkBlock':
      return inner.imageUrl ? 14 : 8
    default:
      return 12
  }
}

/**
 * Masonry + free placement, ported from the original site:
 * items with a saved layout are placed exactly; the rest drop into the shortest column.
 * All units are % of the canvas width.
 */
function computeLayout(items: FeedItem[], cols: number, known: Record<string, number> = {}) {
  const colW = (100 - GAP * (cols + 1)) / cols
  const heights = new Array(cols).fill(0)
  const colX = (c: number) => GAP + c * (colW + GAP)
  const pos = new Map<string, Pos>()
  const ratio = (i: FeedItem) => (isImage(i) && i.img?.w && i.img?.h ? i.img.w / i.img.h : 4 / 3)
  const itemH = (i: FeedItem, w: number) => (isImage(i) ? w / ratio(i) + (i.caption ? 4 : 0) : (known[i._key] ?? blockH(i, w)))

  const occupy = (x: number, y: number, w: number, h: number) => {
    for (let c = 0; c < cols; c++) {
      if (x < colX(c) + colW && x + w > colX(c)) heights[c] = Math.max(heights[c], y + h + GAP)
    }
  }

  for (const it of items) {
    const l = it.layout
    if (l?.x == null) continue
    const w = l.width ?? (isImage(it) ? 30 : 28)
    pos.set(it._key, {fx: l.x, fy: l.y ?? 0, fw: w})
    occupy(l.x, l.y ?? 0, w, itemH(it, w))
  }
  // images first, then blocks — matches the original ordering
  const rest = [...items.filter((i) => isImage(i)), ...items.filter((i) => !isImage(i))]
  for (const it of rest) {
    if (it.layout?.x != null) continue
    if (isImage(it)) {
      const c = heights.indexOf(Math.min(...heights))
      pos.set(it._key, {fx: colX(c), fy: heights[c], fw: colW})
      heights[c] += itemH(it, colW) + GAP
      continue
    }
    // blocks span two columns: pick the adjacent pair with the lowest top
    const span = Math.min(2, cols)
    let best = 0
    let bestTop = Infinity
    for (let c = 0; c <= cols - span; c++) {
      const top = Math.max(...heights.slice(c, c + span))
      if (top < bestTop) [best, bestTop] = [c, top]
    }
    const w = it.layout?.width ?? colW * span + GAP * (span - 1)
    pos.set(it._key, {fx: colX(best), fy: bestTop, fw: w})
    occupy(colX(best), bestTop, w, itemH(it, w))
  }
  return pos
}

function useWidth<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.getBoundingClientRect().width)
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [dep])
  return [ref, w] as const
}

function useIsMobile() {
  const [m, setM] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 700px)')
    setM(mq.matches)
    const on = (e: MediaQueryListEvent) => setM(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

function HoverBar({item}: {item: FeedImage}) {
  if (!item.product && !item.project) return null
  return (
    <div className="dl-hoverbar">
      <span className="dl-hoverbar-text">
        {item.product ? item.product.name : 'Project'}
        {item.product?.price ? <em> {item.product.price}</em> : null}
      </span>
      <span className="dl-hoverbar-btn">{item.product ? 'Shop' : 'View'}</span>
    </div>
  )
}

function Figure({item, onOpen, className, style}: {item: FeedImage; onOpen: () => void; className: string; style?: React.CSSProperties}) {
  return (
    <figure className={className} style={style} onClick={onOpen}>
      <span className="dl-imgbox" style={{aspectRatio: `${item.img.w} / ${item.img.h}`}}>
        <img
          src={imgSrc(item.img.url)}
          alt={item.caption || ''}
          loading="lazy"
          draggable={false}
          style={item.img.lqip ? {backgroundImage: `url(${item.img.lqip})`, backgroundSize: 'cover'} : undefined}
        />
        <HoverBar item={item} />
      </span>
      {item.caption && <figcaption className="dl-itemcap">{item.caption}</figcaption>}
    </figure>
  )
}

function DaySection({day, flat, onOpen}: {day: Day; flat: boolean; onOpen: (date: string, item: FeedImage) => void}) {
  const [ref, width] = useWidth<HTMLDivElement>(flat)
  const [measured, setMeasured] = useState(0)
  // real block heights (% of canvas width), fed back into the layout after first render
  const [known, setKnown] = useState<Record<string, number>>({})
  const pos = useMemo(() => computeLayout(day.items, width && width < 860 ? 2 : 6, known), [day.items, width, known])

  // Canvas height = bottom of the lowest child (text blocks have unknown height until rendered)
  useEffect(() => {
    const el = ref.current
    if (!el || flat) return
    const measure = () => {
      let h = 0
      const next: Record<string, number> = {}
      for (const c of Array.from(el.children) as HTMLElement[]) {
        h = Math.max(h, c.offsetTop + c.offsetHeight)
        if (c.dataset.block && width) next[c.dataset.block] = (c.offsetHeight / width) * 100
      }
      setMeasured(h)
      setKnown((cur) =>
        Object.keys(next).some((k) => Math.abs((cur[k] ?? -99) - next[k]) > 0.5) ? next : cur,
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    for (const c of Array.from(el.children)) ro.observe(c)
    return () => ro.disconnect()
  }, [ref, pos, flat, width])

  const images = day.items.filter(isImage)
  const blocks = day.items.filter((i) => !isImage(i))

  return (
    <section className="dl-day">
      <header className="dl-dayhead">
        <span className="dl-daylabel" suppressHydrationWarning>
          {dayLabel(day.date)}
        </span>
      </header>
      {flat ? (
        <div className="dl-grid">
          {images.map((it) => (
            <Figure key={it._key} item={it} className="dl-fig" onOpen={() => onOpen(day.date, it)} />
          ))}
          {blocks.map((it) => (
            <div key={it._key} className="dl-note-flat">
              <FeedBlock item={it} />
            </div>
          ))}
        </div>
      ) : (
        <div ref={ref} className="dl-canvas" style={{height: measured || undefined, minHeight: 120}}>
          {width > 0 &&
            day.items.map((it) => {
              const p = pos.get(it._key) || {fx: 4, fy: 2, fw: 30}
              const style: React.CSSProperties = {left: `${p.fx}%`, top: `${(p.fy / 100) * width}px`, width: `${p.fw}%`}
              return isImage(it) ? (
                <Figure key={it._key} item={it} className="dl-item dl-item-img" style={style} onOpen={() => onOpen(day.date, it)} />
              ) : (
                <div key={it._key} data-block={it._key} className="dl-item dl-item-note" style={{...style, zIndex: 2}}>
                  <FeedBlock item={it} />
                </div>
              )
            })}
        </div>
      )}
    </section>
  )
}

export function Feed({days, settings}: {days: Day[]; settings: Settings}) {
  const isMobile = useIsMobile()
  const [tags, setTags] = useState<string[]>([])
  const [detail, setDetail] = useState<{date: string; key: string} | null>(null)

  const filtered = useMemo(() => {
    if (!tags.length) return days
    return days
      .map((d) => ({...d, items: d.items.filter((i) => isImage(i) && (i.tags || []).some((t) => tags.includes(t)))}))
      .filter((d) => d.items.length > 0)
  }, [days, tags])
  const count = tags.length ? filtered.reduce((n, d) => n + d.items.length, 0) : 0

  const detailItem = detail
    ? (days.find((d) => d.date === detail.date)?.items.find((i) => i._key === detail.key) as FeedImage | undefined)
    : undefined

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDetail(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <h1 className="dl-hero">
        {settings.heroLines.map((l, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {l}
          </span>
        ))}
      </h1>
      <main className="dl-scroll">
        {tags.length > 0 && (
          <p className="dl-filternote">
            {count === 0 ? 'No images match this filter.' : `${count} image${count === 1 ? '' : 's'} tagged ${tags.join(', ')}`}{' '}
            <button className="dl-clear" onClick={() => setTags([])}>
              Clear
            </button>
          </p>
        )}
        {filtered.length === 0 ? (
          <p className="dl-loading">Nothing here yet.</p>
        ) : (
          filtered.map((d) => (
            <DaySection key={d._id} day={d} flat={isMobile || tags.length > 0} onOpen={(date, it) => setDetail({date, key: it._key})} />
          ))
        )}
        {filtered.length > 0 && tags.length === 0 && (
          <>
            <p className="dl-end">— beginning of the scroll —</p>
            <img className="dl-endmark" src="/feed-footer.svg" alt="Feed" loading="lazy" />
          </>
        )}
      </main>
      {detail && detailItem && (
        <ImageDetail
          date={detail.date}
          item={detailItem}
          settings={settings}
          onClose={() => setDetail(null)}
          onTag={(t) => {
            setDetail(null)
            setTags((cur) => (cur.includes(t) ? cur : [...cur, t]))
            window.scrollTo({top: 0})
          }}
        />
      )}
    </>
  )
}
