'use client'
// #4452 §2.3 — one or two brand-locked buttons: the first primary, the second secondary.
import { formEvent } from '@/components/forms/form-events'
import { openSitePopup } from '@/components/forms/popup-bus'
import './site-blocks.css'

export function ButtonRow({ buttons }: { buttons: Array<{ text: string; href: string; kind: string }> }) {
  return (
    <div className="sb-buttons" data-site-block="buttons">
      {buttons.slice(0, 2).map((b, i) => {
        const external = /^https:\/\//.test(b.href) && !b.href.startsWith('https://usemingla.com')
        return (
          <a
            key={i}
            className={i === 0 ? 'sb-btn sb-btn-primary' : 'sb-btn sb-btn-secondary'}
            href={b.href}
            rel={external ? 'noopener' : undefined}
            onClick={(e) => {
              formEvent('site_block_clicked', null, { block: 'buttons', dest_kind: b.kind })
              if (b.kind === 'popup') {
                e.preventDefault()
                openSitePopup(e.currentTarget)
              }
            }}
          >
            {b.text}
          </a>
        )
      })}
    </div>
  )
}
