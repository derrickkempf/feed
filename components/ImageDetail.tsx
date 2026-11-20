'use client'

import Link from 'next/link'
import type {FeedImage, Product, Settings} from '@/lib/types'
import {dayLabel, imgSrc} from '@/lib/format'

const FW_API = 'https://storefront-api.fourthwall.com/v1'

const normalizeUrl = (u?: string | null) => {
  if (!u) return null
  const s = String(u).trim().replace(/^(https?[:/]+)+/i, '').replace(/\/{2,}/g, '/')
  return s ? `https://${s}` : null
}

/** Same behaviour as the original: try to create a Fourthwall cart → checkout, else open the product URL. */
async function checkoutUrl(product: Product, fw: Settings['fourthwall']) {
  const shop = (fw.shopUrl || '').replace(/^(https?[:/]+)+/i, '').replace(/\/+$/, '')
  if (shop && fw.storefrontToken && product.variantId) {
    try {
      const res = await fetch(`${FW_API}/carts?storefront_token=${fw.storefrontToken}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({items: [{variantId: product.variantId, quantity: 1}]}),
      })
      if (res.ok) {
        const cart = await res.json()
        if (cart?.id) return normalizeUrl(`${shop}/checkout/?cartCurrency=USD&cartToken=${cart.id}`)
      }
    } catch {}
  }
  return normalizeUrl(product.url)
}

export function ImageDetail({
  date,
  item,
  settings,
  onClose,
  onTag,
}: {
  date: string
  item: FeedImage
  settings: Settings
  onClose: () => void
  onTag: (tag: string) => void
}) {
  const buy = async () => {
    // open synchronously so popup blockers allow it, then point it at checkout
    const win = window.open('', '_blank')
    const url = await checkoutUrl(item.product || {}, settings.fourthwall)
    if (url && win) {
      win.opener = null
      win.location.href = url
    } else win?.close()
  }
  return (
    <div className="dl-split" role="dialog" aria-modal="true" aria-label="Image detail">
      <button className="dl-modal-x dl-split-x" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <div className="dl-split-img">
        <img src={imgSrc(item.img.url, 2400)} alt={item.caption || ''} />
      </div>
      <aside className="dl-split-info">
        <p className="dl-split-date" suppressHydrationWarning>
          {dayLabel(date)}
        </p>
        {item.caption && <p className="dl-split-cap">{item.caption}</p>}
        {(item.tags || []).length > 0 && (
          <div className="dl-split-tags">
            {item.tags!.map((t) => (
              <button key={t} className="dl-minitag" onClick={() => onTag(t)}>
                {t}
              </button>
            ))}
          </div>
        )}
        {item.project && (
          <div className="dl-split-block">
            <p className="dl-split-label">Project</p>
            <Link className="dl-split-pagelink" href={`/work/${item.project.slug}`}>
              {item.project.title} ↗
            </Link>
          </div>
        )}
        {item.product && (
          <div className="dl-split-block">
            <p className="dl-split-label">Available</p>
            <p className="dl-split-prodname">{item.product.name}</p>
            {item.product.price && <p className="dl-shopprice">{item.product.price}</p>}
            <button className="dl-buy" onClick={buy}>
              Buy on Fourthwall ↗
            </button>
            <p className="dl-shopnote">Checkout, payment, and shipping handled by Fourthwall.</p>
          </div>
        )}
      </aside>
    </div>
  )
}
