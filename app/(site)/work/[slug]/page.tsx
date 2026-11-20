import type {Metadata} from 'next'
import {notFound} from 'next/navigation'
import {getWork, getWorks} from '@/lib/sanity'
import {imgSrc} from '@/lib/format'
import type {GalleryImage} from '@/lib/types'
import {RichBody} from '@/components/RichBody'
import {Slider} from '@/components/Slider'
import {PostNav} from '@/components/PostNav'

type Props = {params: Promise<{slug: string}>}

export async function generateStaticParams() {
  return (await getWorks()).map((w) => ({slug: w.slug}))
}

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const work = await getWork((await params).slug)
  if (!work) return {}
  const og = work.gallery?.[0]?.img?.url
  return {
    title: work.title,
    description: work.subtitle || work.excerpt,
    openGraph: og ? {images: [`${og}?w=1200&h=630&fit=crop`]} : undefined,
  }
}

/** Consecutive gallery/slider images collapse into one group, like the original. */
function group(images: GalleryImage[]) {
  const out: {mode: string; items: GalleryImage[]}[] = []
  for (const img of images) {
    const mode = img.mode || 'regular'
    const last = out[out.length - 1]
    if ((mode === 'gallery' || mode === 'slider') && last?.mode === mode) last.items.push(img)
    else out.push({mode, items: [img]})
  }
  return out
}

export default async function WorkPage({params}: Props) {
  const {slug} = await params
  const [work, works] = await Promise.all([getWork(slug), getWorks()])
  if (!work) notFound()

  return (
    <div className="dl-page">
      <div className="dl-page-top" />
      <article className="dl-page-body">
        <h1 className="dl-page-title">{work.title}</h1>
        {work.subtitle && <p className="dl-page-sub">{work.subtitle}</p>}
        <RichBody value={work.body} />
        <div className="dl-page-imgs">
          {group(work.gallery || []).map((g, gi) => {
            const figs = g.items.map((m) => {
              const cls = g.mode === 'wide' ? 'dl-imgw-wide' : g.mode === 'full' ? 'dl-imgw-full' : ''
              const style =
                g.mode === 'regular'
                  ? {aspectRatio: `${m.img.w} / ${m.img.h}`, width: `min(100%, calc(76vh * ${(m.img.w / m.img.h).toFixed(4)}))`}
                  : {aspectRatio: `${m.img.w} / ${m.img.h}`}
              return (
                <figure key={m._key} className={`dl-fig dl-page-fig ${cls}`} style={style}>
                  <img src={imgSrc(m.img.url, g.mode === 'full' ? 2400 : 1800)} alt={m.alt || ''} loading="lazy" draggable={false} />
                </figure>
              )
            })
            if (g.mode === 'gallery') return <div key={gi} className="dl-gal">{figs}</div>
            if (g.mode === 'slider') return <Slider key={gi}>{figs}</Slider>
            return figs
          })}
        </div>
      </article>
      <PostNav works={works} slug={slug} />
    </div>
  )
}
