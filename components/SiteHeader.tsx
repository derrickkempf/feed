import Link from 'next/link'
import type {Settings} from '@/lib/types'

export function SiteHeader({settings}: {settings: Settings}) {
  return (
    <header className="dl-top">
      <div className="dl-toprow">
        <Link className="dl-mark" href="/">
          {settings.title}
        </Link>
        <span className="dl-tagline">{settings.tagline}</span>
        <nav className="dl-topright">
          <Link className="dl-navlink" href="/work">
            Works
          </Link>
          <Link className="dl-navlink" href="/about">
            About
          </Link>
        </nav>
      </div>
    </header>
  )
}
