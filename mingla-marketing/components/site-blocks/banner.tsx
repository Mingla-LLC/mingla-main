'use client'
// #4452 §2.3 — one line and one button on ink. Hidden after its "Show until"
// date at 23:59 in the visitor's zone (checked after hydration); the server
// keeps it until the date has passed in UTC−12, so no cache shows it stale.
import { useEffect, useState } from 'react'
import { captureMarketing } from '@/components/marketing/marketing-capture'
import { bannerVisible } from '@/lib/site-pages/model'
import { openSitePopup } from '@/components/forms/popup-bus'
import './site-blocks.css'

export function BannerBlock({ text, btn, href, showUntil, kind }: { text: string; btn: string; href: string; showUntil: string | null; kind: string }) {
  const [visible, setVisible] = useState(() => bannerVisible(showUntil, Date.now(), true))
  useEffect(() => setVisible(bannerVisible(showUntil, Date.now(), false)), [showUntil])
  if (!visible) return null
  return (
    <div className="sb-banner" data-site-block="banner">
      <p>{text}</p>
      <a
        className="sb-btn sb-btn-primary"
        href={href}
        onClick={(e) => {
          captureMarketing('site_block_clicked', { block: 'banner', dest_kind: kind })
          if (kind === 'popup') {
            e.preventDefault()
            openSitePopup(e.currentTarget)
          }
        }}
      >
        {btn}
      </a>
    </div>
  )
}
