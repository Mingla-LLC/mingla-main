'use client'
// ISSUE-1003 — the redesigned "after" homepage. A cinematic, editorial venue
// site rendered from the run's saved data (fetched by run_id). Deliberately its
// OWN aesthetic — dark, serif, high-end — so it reads as the venue's brand-new
// site, not as a Mingla surface. Rendered as a fixed full-viewport overlay so
// the screenshot is clean regardless of anything the root layout paints.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fetchVenuePreview, type VenuePreviewRender } from '@/lib/growth-tools-submit'

const SERIF = "Georgia, 'Times New Roman', 'Playfair Display', serif"
const SANS = "var(--font-inter, 'Inter'), -apple-system, system-ui, sans-serif"

export function VenuePreviewClient() {
  const params = useSearchParams()
  const runId = params.get('run_id') ?? ''
  const [render, setRender] = useState<VenuePreviewRender | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
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
  }, [runId])

  const hero = render?.photos?.[0] ?? null
  const gallery = (render?.photos ?? []).slice(1, 4)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        background: '#0b0b0d',
        color: '#f5f2ec',
        fontFamily: SANS,
        overflow: 'auto',
      }}
    >
      {/* HERO — fills the 1280×800 capture fold */}
      <section
        style={{
          position: 'relative',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Background: the venue's real photo, or a warm editorial gradient. */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: hero
              ? `url("${hero}")`
              : 'radial-gradient(120% 120% at 70% 10%, #3a2416 0%, #14100c 55%, #0b0b0d 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(8,8,10,0.72) 0%, rgba(8,8,10,0.30) 38%, rgba(8,8,10,0.86) 100%)',
          }}
        />

        {/* Top bar — makes it read as a real site */}
        <header
          style={{
            position: 'relative',
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '26px clamp(24px, 6vw, 72px)',
          }}
        >
          <span
            style={{
              fontFamily: SERIF,
              fontSize: 22,
              letterSpacing: '0.02em',
              fontWeight: 600,
            }}
          >
            {render?.name ?? ' '}
          </span>
          <nav
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 28,
              fontSize: 13,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.82)',
            }}
          >
            <span style={{ opacity: 0.85 }}>Menu</span>
            <span style={{ opacity: 0.85 }}>About</span>
            <span
              style={{
                border: '1px solid rgba(245,242,236,0.5)',
                borderRadius: 999,
                padding: '9px 18px',
                letterSpacing: '0.14em',
              }}
            >
              Reserve
            </span>
          </nav>
        </header>

        {/* Hero copy */}
        <div
          style={{
            position: 'relative',
            zIndex: 2,
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 clamp(24px, 6vw, 72px)',
            maxWidth: 980,
          }}
        >
          {render?.vibes && render.vibes.length > 0 ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
              {render.vibes.map((v) => (
                <span
                  key={v}
                  style={{
                    fontSize: 12,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: '#e9c9a0',
                    border: '1px solid rgba(233,201,160,0.4)',
                    borderRadius: 999,
                    padding: '6px 14px',
                  }}
                >
                  {v}
                </span>
              ))}
            </div>
          ) : null}

          <h1
            style={{
              fontFamily: SERIF,
              fontSize: 'clamp(44px, 7vw, 88px)',
              lineHeight: 1.02,
              fontWeight: 600,
              margin: 0,
              textWrap: 'balance',
              maxWidth: 14 + 'ch',
            }}
          >
            {render?.name ?? ' '}
          </h1>

          {render?.tagline ? (
            <p
              style={{
                marginTop: 22,
                fontSize: 'clamp(16px, 2vw, 21px)',
                lineHeight: 1.5,
                color: 'rgba(245,242,236,0.9)',
                maxWidth: 620,
              }}
            >
              {render.tagline}
            </p>
          ) : null}

          <div style={{ marginTop: 34, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <span
              style={{
                background: '#e9c9a0',
                color: '#1a1206',
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                borderRadius: 999,
                padding: '15px 30px',
              }}
            >
              Reserve a table
            </span>
            <span
              style={{
                fontSize: 14,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'rgba(245,242,236,0.85)',
                borderBottom: '1px solid rgba(245,242,236,0.4)',
                paddingBottom: 3,
              }}
            >
              View the menu
            </span>
          </div>

          {render?.occasions && render.occasions.length > 0 ? (
            <p
              style={{
                marginTop: 40,
                fontSize: 13,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'rgba(245,242,236,0.6)',
              }}
            >
              {render.city ? `${render.city} · ` : ''}
              {render.occasions.slice(0, 3).join('  ·  ')}
            </p>
          ) : null}
        </div>

        {/* Gallery strip along the very bottom of the fold */}
        {gallery.length > 0 ? (
          <div
            style={{
              position: 'relative',
              zIndex: 2,
              display: 'grid',
              gridTemplateColumns: `repeat(${gallery.length}, 1fr)`,
              gap: 2,
              height: 96,
            }}
          >
            {gallery.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${src}-${i}`}
                src={src}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ))}
          </div>
        ) : null}
      </section>

      {/* Below the fold (not in the capture, nice for a real visit) */}
      {render?.signature ? (
        <section
          style={{
            padding: 'clamp(48px, 9vw, 110px) clamp(24px, 6vw, 72px)',
            textAlign: 'center',
            maxWidth: 760,
            margin: '0 auto',
          }}
        >
          <p style={{ fontSize: 12, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#e9c9a0' }}>
            The one everyone orders
          </p>
          <p style={{ fontFamily: SERIF, fontSize: 'clamp(24px, 4vw, 40px)', lineHeight: 1.25, marginTop: 18 }}>
            {render.signature}
          </p>
        </section>
      ) : null}

      {failed ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'rgba(245,242,236,0.5)',
            fontSize: 14,
          }}
        >
          Preview unavailable.
        </div>
      ) : null}
    </div>
  )
}
