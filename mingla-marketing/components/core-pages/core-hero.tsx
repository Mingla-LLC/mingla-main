import type { ReactNode } from 'react'
import { CutoutEyebrow, CutoutSection, DeviceCta } from '@/components/cutout'

export function CoreHero({ eyebrow, title, answer, visual, primary = 'explorer', secondary = 'host' }: {
  readonly eyebrow: string
  readonly title: string
  readonly answer: string
  readonly visual: ReactNode
  readonly primary?: 'explorer' | 'host'
  readonly secondary?: 'explorer' | 'host'
}) {
  return (
    <CutoutSection rhythm="hero" band="dark" className="core-hero">
      <div className="core-hero-grid">
        <div className="core-hero-copy">
          <CutoutEyebrow>{eyebrow}</CutoutEyebrow>
          <h1>{title}</h1>
          <p>{answer}</p>
          <div className="core-hero-actions">
            <DeviceCta surface={primary} location="core_hero_primary" variant="primary" label={primary === 'host' ? 'Host Your City' : 'Explore Your City'} />
            <DeviceCta surface={secondary} location="core_hero_secondary" variant="quiet" label={secondary === 'host' ? 'Host Your City' : 'Explore Your City'} />
          </div>
        </div>
        <div className="core-hero-visual">{visual}</div>
      </div>
    </CutoutSection>
  )
}
