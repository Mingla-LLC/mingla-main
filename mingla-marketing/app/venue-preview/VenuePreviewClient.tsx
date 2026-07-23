'use client'
// ISSUE-1003/1080 — the redesigned "after" homepage. Fetches the run's saved
// data and renders it in one of several premium SKINS (see venueSkins). The
// skin is forced via ?skin= (backend after-shot URL + lookbook) or auto-picked
// from the venue's vibes. Rendered as a fixed full-viewport overlay so the
// screenshot is clean regardless of anything the root layout paints.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fetchVenuePreview, type VenuePreviewRender } from '@/lib/growth-tools-submit'
import { VenueSkin, pickSkin, type SkinId } from './venueSkins'

const VALID_SKINS: SkinId[] = ['editorial', 'warm', 'nightlife']

// Sample content for the lookbook (?sample=1) — lets the skins be reviewed
// without a real run. Not used in production captures.
const SAMPLE_RENDER: VenuePreviewRender = {
  name: 'The Gilded Fig',
  city: 'London',
  tagline:
    'A candlelit corner of Soho where seasonal small plates meet a low-lit cocktail bar — the kind of night that turns into a story.',
  vibes: ['Intimate', 'Seasonal', 'Late-night'],
  occasions: ['Date night', 'Special occasion', 'Drinks after work'],
  signature: 'The fig-leaf martini everyone photographs before they drink it.',
  ai_read: '',
  photos: [],
}

export function VenuePreviewClient() {
  const params = useSearchParams()
  const runId = params.get('run_id') ?? ''
  const sample = params.get('sample') === '1'
  const skinParam = params.get('skin')
  const forcedSkin = VALID_SKINS.includes(skinParam as SkinId) ? (skinParam as SkinId) : null
  const [render, setRender] = useState<VenuePreviewRender | null>(sample ? SAMPLE_RENDER : null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (sample) return
    let alive = true
    if (!runId) {
      setFailed(true)
      return
    }
    fetchVenuePreview(runId).then((res) => {
      if (!alive) return
      if (res.ok) setRender(res.render)
      else setFailed(true)
    })
    return () => {
      alive = false
    }
  }, [runId, sample])

  if (failed) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2147483647,
          background: '#0b0b0d',
          display: 'grid',
          placeItems: 'center',
          color: 'rgba(245,242,236,0.5)',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
        }}
      >
        Preview unavailable.
      </div>
    )
  }

  if (!render) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, background: '#0b0b0d' }} />
    )
  }

  const skin = forcedSkin ?? pickSkin(render)
  return <VenueSkin render={render} skin={skin} />
}
