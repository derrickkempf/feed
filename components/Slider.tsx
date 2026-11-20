'use client'

import {useEffect, useRef, useState} from 'react'

export function Slider({children}: {children: React.ReactNode}) {
  const ref = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      setAtStart(el.scrollLeft <= 4)
      setAtEnd(el.scrollLeft >= el.scrollWidth - el.clientWidth - 4)
    }
    update()
    el.addEventListener('scroll', update, {passive: true})
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  const go = (dir: number) => {
    const el = ref.current
    if (el) el.scrollBy({left: dir * Math.min(el.clientWidth * 0.8, 480), behavior: 'smooth'})
  }

  return (
    <div className="dl-slider-wrap">
      <div className="dl-slider" ref={ref}>
        {children}
      </div>
      <button className="dl-slider-arrow dl-slider-arrow-prev" aria-label="Previous" disabled={atStart} onClick={() => go(-1)}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 19.59 22.05">
          <path d="M19.4,16.36c-.13-1.69-.3-3.39-.24-5.09.11-3.18.52-6.25.41-9.46-.02-.48-.02-1.08-.24-1.48l-.09-.13c-.86-.65-2.11.41-3.01.88-1.23.83-2.42,1.41-3.78,1.98-3.34,1.54-6.61,3.52-9.99,5.21-1.08.57-2.89,1.56-2.39,3.26.56,1.53,2.16,2.01,3.36,2.69,5.1,2.61,10.11,5.91,15.35,7.83.94-.32.72-1.9.76-2.87,0-.94-.07-1.88-.15-2.82Z" />
        </svg>
      </button>
      <button className="dl-slider-arrow dl-slider-arrow-next" aria-label="Next" disabled={atEnd} onClick={() => go(1)}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 19.76 21.93">
          <path d="M19.12,9.55l-.16-.17c-3.46-2.47-7.42-4.05-11.06-6.14C5.63,2.28,3.32.31.94,0,.55.12.35.59.27,1.06c-.59,3.27-.03,6.58.05,9.87s-.23,6.47-.15,9.73c.08.86.5,1.45,1.34,1.21,4.59-1.86,8.87-4.61,13.37-6.85,1.76-1.04,6.59-2.29,4.22-5.47Z" />
        </svg>
      </button>
    </div>
  )
}
