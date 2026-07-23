// ISSUE-1080 — venue homepage SKINS. One layout engine, several premium looks.
// Each skin is a theme (palette + type + copy) applied to the same data
// (VenuePreviewRender). The right skin is auto-picked per venue from its vibes/
// category, or forced via ?skin= (used by the lookbook and the after-shot URL).

import type { VenuePreviewRender } from '@/lib/growth-tools-submit'

export type SkinId = 'editorial' | 'warm' | 'nightlife'

interface SkinTheme {
  label: string
  description: string
  pageBg: string
  fallbackHero: string
  heroOverlay: string
  text: string
  textSoft: string
  accent: string
  accentText: string
  pillBorder: string
  pillText: string
  displayFont: string
  bodyFont: string
  displayWeight: number
  displayTransform: 'none' | 'uppercase'
  displaySpacing: string
  navItems: [string, string]
  reserveLabel: string
  ctaLabel: string
  secondaryLabel: string
  signatureEyebrow: string
}

const SERIF = "Georgia, 'Times New Roman', serif"
const ROUNDED = "var(--font-nunito, 'Nunito Sans'), -apple-system, system-ui, sans-serif"
const INTER = "var(--font-inter, 'Inter'), -apple-system, system-ui, sans-serif"

const THEMES: Record<SkinId, SkinTheme> = {
  editorial: {
    label: 'Editorial',
    description: 'Dark, serif, cinematic — fine dining, date nights, upscale rooms.',
    pageBg: '#0b0b0d',
    fallbackHero: 'radial-gradient(120% 120% at 70% 10%, #3a2416 0%, #14100c 55%, #0b0b0d 100%)',
    heroOverlay:
      'linear-gradient(180deg, rgba(8,8,10,0.72) 0%, rgba(8,8,10,0.30) 38%, rgba(8,8,10,0.86) 100%)',
    text: '#f5f2ec',
    textSoft: 'rgba(245,242,236,0.85)',
    accent: '#e9c9a0',
    accentText: '#1a1206',
    pillBorder: 'rgba(233,201,160,0.4)',
    pillText: '#e9c9a0',
    displayFont: SERIF,
    bodyFont: INTER,
    displayWeight: 600,
    displayTransform: 'none',
    displaySpacing: '0',
    navItems: ['Menu', 'About'],
    reserveLabel: 'Reserve',
    ctaLabel: 'Reserve a table',
    secondaryLabel: 'View the menu',
    signatureEyebrow: 'The one everyone orders',
  },
  warm: {
    label: 'Warm',
    description: 'Bright, rounded, cosy — cafés, brunch, bakeries, casual spots.',
    pageBg: '#faf5ec',
    fallbackHero: 'linear-gradient(135deg, #f6e2c8 0%, #eccaa0 100%)',
    heroOverlay:
      'linear-gradient(180deg, rgba(30,18,8,0.30) 0%, rgba(30,18,8,0.08) 40%, rgba(30,18,8,0.55) 100%)',
    text: '#fffaf3',
    textSoft: 'rgba(255,250,243,0.9)',
    accent: '#e0662b',
    accentText: '#ffffff',
    pillBorder: 'rgba(255,250,243,0.55)',
    pillText: '#fffaf3',
    displayFont: ROUNDED,
    bodyFont: ROUNDED,
    displayWeight: 800,
    displayTransform: 'none',
    displaySpacing: '-0.01em',
    navItems: ['Menu', 'Hours'],
    reserveLabel: 'Visit us',
    ctaLabel: 'Book a table',
    secondaryLabel: 'See the menu',
    signatureEyebrow: 'What people come back for',
  },
  nightlife: {
    label: 'Nightlife',
    description: 'Near-black, electric, high-contrast — bars, clubs, lounges, day parties.',
    pageBg: '#070708',
    fallbackHero: 'radial-gradient(120% 120% at 30% 0%, #2a0f3a 0%, #120a1c 55%, #070708 100%)',
    heroOverlay:
      'linear-gradient(180deg, rgba(5,5,8,0.62) 0%, rgba(5,5,8,0.25) 40%, rgba(5,5,8,0.9) 100%)',
    text: '#f6f4ff',
    textSoft: 'rgba(246,244,255,0.82)',
    accent: '#ff5a3c',
    accentText: '#0a0710',
    pillBorder: 'rgba(255,90,60,0.55)',
    pillText: '#ffb9a9',
    displayFont: INTER,
    bodyFont: INTER,
    displayWeight: 800,
    displayTransform: 'uppercase',
    displaySpacing: '-0.02em',
    navItems: ['Events', 'Tables'],
    reserveLabel: 'Get on the list',
    ctaLabel: 'Book a table',
    secondaryLabel: "See what's on",
    signatureEyebrow: 'The signature pour',
  },
}

export const SKIN_ORDER: SkinId[] = ['editorial', 'warm', 'nightlife']
export const skinMeta = (id: SkinId) => {
  const t = THEMES[id]
  return { id, label: t.label, description: t.description }
}

// Auto-pick a skin from the venue's vibes + occasions (keyword heuristic).
export function pickSkin(render: Pick<VenuePreviewRender, 'vibes' | 'occasions'>): SkinId {
  const hay = [...(render.vibes ?? []), ...(render.occasions ?? [])]
    .join(' ')
    .toLowerCase()
  const NIGHT = /(bar|club|lounge|cocktail|night|party|dance|dj|rooftop|late|speakeasy|nightlife|drinks)/
  const WARM = /(caf[eé]|coffee|brunch|bakery|breakfast|casual|cosy|cozy|family|deli|diner|brewery|pub|garden|daytime)/
  if (NIGHT.test(hay)) return 'nightlife'
  if (WARM.test(hay)) return 'warm'
  return 'editorial'
}

export function VenueSkin({ render, skin }: { render: VenuePreviewRender; skin: SkinId }) {
  const t = THEMES[skin]
  const hero = render.photos?.[0] ?? null
  const gallery = (render.photos ?? []).slice(1, 4)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        background: t.pageBg,
        color: t.text,
        fontFamily: t.bodyFont,
        overflow: 'auto',
      }}
    >
      <section style={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: hero ? `url("${hero}")` : t.fallbackHero,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div aria-hidden style={{ position: 'absolute', inset: 0, background: t.heroOverlay }} />

        {/* Top bar */}
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
              fontFamily: t.displayFont,
              fontSize: 22,
              fontWeight: t.displayWeight,
              letterSpacing: t.displaySpacing,
              textTransform: t.displayTransform,
            }}
          >
            {render.name}
          </span>
          <nav
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 28,
              fontSize: 13,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: t.textSoft,
            }}
          >
            <span style={{ opacity: 0.85 }}>{t.navItems[0]}</span>
            <span style={{ opacity: 0.85 }}>{t.navItems[1]}</span>
            <span
              style={{
                border: `1px solid ${t.pillBorder}`,
                borderRadius: 999,
                padding: '9px 18px',
                letterSpacing: '0.14em',
              }}
            >
              {t.reserveLabel}
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
          {render.vibes.length > 0 ? (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
              {render.vibes.map((v) => (
                <span
                  key={v}
                  style={{
                    fontSize: 12,
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    color: t.pillText,
                    border: `1px solid ${t.pillBorder}`,
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
              fontFamily: t.displayFont,
              fontSize: 'clamp(44px, 7vw, 88px)',
              lineHeight: 1.02,
              fontWeight: t.displayWeight,
              letterSpacing: t.displaySpacing,
              textTransform: t.displayTransform,
              margin: 0,
              textWrap: 'balance',
              maxWidth: '14ch',
            }}
          >
            {render.name}
          </h1>

          {render.tagline ? (
            <p
              style={{
                marginTop: 22,
                fontSize: 'clamp(16px, 2vw, 21px)',
                lineHeight: 1.5,
                color: t.textSoft,
                maxWidth: 620,
              }}
            >
              {render.tagline}
            </p>
          ) : null}

          <div style={{ marginTop: 34, display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
            <span
              style={{
                background: t.accent,
                color: t.accentText,
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                borderRadius: 999,
                padding: '15px 30px',
              }}
            >
              {t.ctaLabel}
            </span>
            <span
              style={{
                fontSize: 14,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: t.textSoft,
                borderBottom: `1px solid ${t.pillBorder}`,
                paddingBottom: 3,
              }}
            >
              {t.secondaryLabel}
            </span>
          </div>

          {render.occasions.length > 0 ? (
            <p
              style={{
                marginTop: 40,
                fontSize: 13,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: t.textSoft,
                opacity: 0.7,
              }}
            >
              {render.city ? `${render.city} · ` : ''}
              {render.occasions.slice(0, 3).join('  ·  ')}
            </p>
          ) : null}
        </div>

        {/* Gallery strip */}
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

      {render.signature ? (
        <section
          style={{
            padding: 'clamp(48px, 9vw, 110px) clamp(24px, 6vw, 72px)',
            textAlign: 'center',
            maxWidth: 760,
            margin: '0 auto',
          }}
        >
          <p style={{ fontSize: 12, letterSpacing: '0.24em', textTransform: 'uppercase', color: t.accent }}>
            {t.signatureEyebrow}
          </p>
          <p
            style={{
              fontFamily: t.displayFont,
              fontWeight: t.displayWeight,
              fontSize: 'clamp(24px, 4vw, 40px)',
              lineHeight: 1.25,
              marginTop: 18,
            }}
          >
            {render.signature}
          </p>
        </section>
      ) : null}
    </div>
  )
}
