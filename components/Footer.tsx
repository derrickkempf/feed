'use client'

import {useEffect, useState} from 'react'
import type {Settings} from '@/lib/types'

/** © year + blinking “MA:DE” clock link, as on the original. */
export function Footer({link}: {link: Settings['footerLink']}) {
  const [on, setOn] = useState(true)
  useEffect(() => {
    const t = setInterval(() => setOn((v) => !v), 500)
    return () => clearInterval(t)
  }, [])
  const [a, b] = (link.label || 'MA:DE').split(':')
  return (
    <footer className="dl-footer">
      <span className="dl-footer-c" suppressHydrationWarning>
        © {new Date().getFullYear()}
      </span>
      {link.url && (
        <a className="dl-clock" href={link.url} target="_blank" rel="noopener noreferrer">
          {a}
          {b !== undefined && (
            <>
              <span className={`dl-clock-colon ${on ? '' : 'dl-clock-colon-off'}`}>:</span>
              {b}
            </>
          )}
        </a>
      )}
    </footer>
  )
}
