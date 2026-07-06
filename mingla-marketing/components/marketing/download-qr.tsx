'use client'
// ORCH-1319 — the device-smart download QR. Reused by the nav QR panel AND the
// /download desktop page.
//
// It encodes DOWNLOAD_URL (`${SITE_ORIGIN}/download`, from lib/site.ts) — the §4.2
// smart-redirect route on the canonical marketing origin, NOT a store URL
// directly. That is the whole point: ONE QR serves both platforms — an iPhone
// scanning it hits /download with an iOS UA → App Store; an Android phone → Play.
//
// react-qr-code renders a PURE inline <svg> with NO network calls, so it is safe
// in a client component and inside the server /download page alike.

import QRCode from 'react-qr-code'
import { DOWNLOAD_URL } from '@/lib/site'

interface DownloadQrProps {
  /** Rendered edge length in px. Default 200 (nav panel); 220 on /download. */
  size?: number
  className?: string
}

const MIN_SIZE = 160

export function DownloadQr({ size = 200, className }: DownloadQrProps) {
  const px = Math.max(MIN_SIZE, size)
  return (
    <div className={className}>
      <div
        role="img"
        aria-label="QR code — scan with your phone camera to download the Mingla app"
        style={{ width: px, height: px }}
      >
        {/* Near-black on solid white — high contrast is mandatory for scanners. */}
        <QRCode
          value={DOWNLOAD_URL}
          size={px}
          fgColor="#0E0E10"
          bgColor="#FFFFFF"
          level="M"
          style={{ height: '100%', width: '100%', display: 'block' }}
        />
      </div>
      {/* Manual-entry fallback — the raw URL as small selectable text. */}
      <p
        className="mt-2 select-all text-center text-[12px] leading-tight text-text-muted"
        style={{ maxWidth: px }}
      >
        {DOWNLOAD_URL}
      </p>
    </div>
  )
}
