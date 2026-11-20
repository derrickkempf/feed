'use client'

import {useEffect} from 'react'
import {useRouter} from 'next/navigation'

/** Keeps old links working: #/work → /work, #/about → /about, #/p/slug → /work/slug, #login → /studio. */
export function HashRedirect() {
  const router = useRouter()
  useEffect(() => {
    const go = () => {
      const h = window.location.hash
      const m = h.match(/^#\/p\/(.+)$/)
      const to = h === '#/work' ? '/work' : h === '#/about' ? '/about' : h === '#login' ? '/studio' : m ? `/work/${m[1]}` : null
      if (to) router.replace(to)
    }
    go()
    window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [router])
  return null
}
