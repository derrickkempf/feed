import Link from 'next/link'
import type {Metadata} from 'next'
import {getWorks} from '@/lib/sanity'
import {imgSrc} from '@/lib/format'

export const metadata: Metadata = {title: 'Works'}

const snip = (s?: string) => (s && s.length > 150 ? s.slice(0, 147).trimEnd() + '…' : s)

export default async function WorksPage() {
  const works = await getWorks()
  return (
    <div className="dl-page">
      <div className="dl-work">
        <h1 className="dl-work-title">Works</h1>
        {works.length === 0 ? (
          <p className="dl-loading">No project pages yet.</p>
        ) : (
          <div className="dl-work-grid">
            {works.map((w) => (
              <Link key={w.slug} className="dl-work-card" href={`/work/${w.slug}`}>
                <span className="dl-work-cover" style={{aspectRatio: w.cover ? `${w.cover.w} / ${w.cover.h}` : '4 / 3'}}>
                  {w.cover ? <img src={imgSrc(w.cover.url, 1000)} alt="" loading="lazy" draggable={false} /> : <span className="dl-work-cover-ph" />}
                </span>
                <span className="dl-work-card-title">{w.title}</span>
                {w.excerpt && <span className="dl-work-card-snip">{snip(w.excerpt)}</span>}
                <span className="dl-work-card-more">Read more</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
