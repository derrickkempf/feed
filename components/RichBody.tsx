import {PortableText, type PortableTextComponents} from '@portabletext/react'
import type {BodyBlock, Img} from '@/lib/types'
import {imgSrc} from '@/lib/format'

const Fig = ({img, alt}: {img: Img; alt?: string}) => (
  <figure className="dl-fig dl-page-fig" style={{aspectRatio: `${img.w} / ${img.h}`}}>
    <img src={imgSrc(img.url)} alt={alt || ''} loading="lazy" draggable={false} />
  </figure>
)

const components: PortableTextComponents = {
  block: {
    normal: ({children}) => <p className="dl-page-text">{children}</p>,
    h2: ({children}) => <h2 className="dl-page-h2">{children}</h2>,
    h3: ({children}) => <h3 className="dl-page-h3">{children}</h3>,
    h4: ({children}) => <h4 className="dl-page-h4">{children}</h4>,
    h5: ({children}) => <h5 className="dl-page-h5">{children}</h5>,
    blockquote: ({children}) => (
      <blockquote className="dl-quote">
        <p>{children}</p>
      </blockquote>
    ),
    bigquote: ({children}) => (
      <blockquote className="dl-quote dl-quote-big">
        <p>{children}</p>
      </blockquote>
    ),
  },
  marks: {
    link: ({value, children}) => {
      const href: string = value?.href || ''
      const external = /^https?:/.test(href)
      return (
        <a href={href} {...(external ? {target: '_blank', rel: 'noopener noreferrer'} : {})}>
          {children}
        </a>
      )
    },
  },
  types: {
    bodyImage: ({value}) => {
      if (!value?.img) return null
      const f = value.float || 'inline'
      return (
        <div className={f === 'inline' ? 'dl-imginline' : `dl-float dl-float-${f}`}>
          <Fig img={value.img} alt={value.alt} />
        </div>
      )
    },
    pullQuote: ({value}) => (
      <blockquote className={`dl-quote dl-pull dl-pull-${value.side || 'right'} ${value.big ? 'dl-quote-big' : ''}`}>
        <p>{value.text}</p>
      </blockquote>
    ),
  },
}

export function RichBody({value}: {value?: BodyBlock[] | null}) {
  if (!value?.length) return null
  return <PortableText value={value as never} components={components} />
}
