import type {Metadata} from 'next'
import {Libre_Franklin} from 'next/font/google'
import {getSettings} from '@/lib/sanity'
import {SiteHeader} from '@/components/SiteHeader'
import {Footer} from '@/components/Footer'
import {HashRedirect} from '@/components/HashRedirect'
import './globals.css'

// Fallback for the self-hosted Frankie News / HEX Franklin faces (see globals.css)
const libre = Libre_Franklin({subsets: ['latin'], weight: ['400', '600', '700', '800'], variable: '--font-libre'})

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings()
  const title = `${s.title} — A Daily Record`
  return {
    title: {default: title, template: `%s — ${s.title}`},
    description: s.description,
    openGraph: {title, description: s.description, images: s.ogImage ? [`${s.ogImage}?w=1200&h=630&fit=crop`] : undefined},
    twitter: {card: 'summary_large_image'},
  }
}

export default async function SiteLayout({children}: {children: React.ReactNode}) {
  const settings = await getSettings()
  return (
    <div className={`dl-root ${libre.variable}`}>
      <HashRedirect />
      <SiteHeader settings={settings} />
      {children}
      <Footer link={settings.footerLink} />
    </div>
  )
}
