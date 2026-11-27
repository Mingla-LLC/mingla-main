// #4636 block `icpHero` — the host-type pages' full-screen video hero, moved
// as-is (R1) from components/landing/icp-landing.tsx: the clip with a 20%
// shade, the pill, the two-line headline (second line italic) and the glass
// bar with "Book a call" (the call) and the Host hand-off.
import Link from 'next/link'
import { HostHandoffButton } from '@/components/landing/host-handoff'
import { LandingMedia } from '@/components/landing/landing-media'
import type { LandingMediaRef } from '@/lib/landing-media-ref'
import type { BlockAction, BlockProps } from './shared'

export interface IcpHeroContent {
  pill: string
  line1: string
  line2: string
  sub: string
  media: LandingMediaRef
  call: BlockAction
  app: BlockAction
}

export function IcpHeroBlock({ content: d }: BlockProps<IcpHeroContent>) {
  return (
    <section className="lp-hero" aria-labelledby="lp-title">
      <LandingMedia media={d.media} hero kenBurns />
      <div className="shade" aria-hidden="true" />
      <div className="in wrap">
        <span className="pill glass">
          <span className="dot" aria-hidden="true" />
          {d.pill}
        </span>
        <h1 id="lp-title">
          <span>{d.line1}</span>
          <span>
            <em>{d.line2}</em>
          </span>
        </h1>
        <div className="bottom">
          <p>{d.sub}</p>
          <div className="glassbar">
            {/* #4452 §2.12: the text half is the call. */}
            <Link className="btn bring-call" href={d.call.to} data-icp-event="icp_talk_to_team_clicked" data-call-button="cta_bar">
              {d.call.label}
            </Link>
            <HostHandoffButton location={d.app.track ?? 'hero'} className="btn white">
              {d.app.label}
            </HostHandoffButton>
          </div>
        </div>
      </div>
    </section>
  )
}
