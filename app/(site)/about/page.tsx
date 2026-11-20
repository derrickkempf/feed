import type {Metadata} from 'next'
import {getAbout} from '@/lib/sanity'
import {imgSrc} from '@/lib/format'
import {RichBody} from '@/components/RichBody'

export const metadata: Metadata = {title: 'About'}

/** Shown until an About document is published in the Studio (same copy as the original default). */
function DefaultAbout() {
  return (
    <>
      <p className="dl-page-text">Hello!</p>
      <p className="dl-page-text">
        I&apos;m Derrick Kempf, an artist and brand identity designer with over two decades of experience shaping brands and translating vision
        into meaningful design. I bring a balance of discipline and creative freedom to both brand consulting and personal art, and I am
        dedicated to helping fellow artists find simplicity and joy in the creative process. I love drawing and the subjects I illustrate
        typically consist of weird, balding men, or Dewds, as I call them. See more of them out at dewd.cool.
      </p>
      <p className="dl-page-text">Let&apos;s make something cool together.</p>
      <p className="dl-page-text">
        <a href="mailto:hello@derrickkempf.com">Email me</a> or connect with me on socials.
      </p>
    </>
  )
}

export default async function AboutPage() {
  const about = await getAbout()
  return (
    <div className="dl-page">
      <div className="dl-about">
        <h1 className="dl-work-title dl-about-title">About</h1>
        <div className="dl-about-cols">
          <div className="dl-about-img">{about?.photo && <img src={imgSrc(about.photo.url, 1200)} alt="" draggable={false} />}</div>
          <div className="dl-about-text">{about?.body?.length ? <RichBody value={about.body} /> : <DefaultAbout />}</div>
        </div>
      </div>
    </div>
  )
}
