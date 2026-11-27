// #4636 block `icpFeatures` — the host-type pages' sticky features: a fixed
// background clip, a sticky left column with three section buttons and the
// Host hand-off, and three glass video cards (`data-feat`, driven by
// LandingRoot). Moved as-is (R1) from components/landing/icp-landing.tsx.
import type { ReactNode } from 'react'
import { Calendar, ChartLine, CreditCard, Image as ImageIcon, Mail, Map as MapIcon, MessageCircle, Sun, Tag, Ticket, Users } from 'lucide-react'
import { HostHandoffButton } from '@/components/landing/host-handoff'
import { LandingMedia } from '@/components/landing/landing-media'
import type { LandingIcon } from '@/content/host-landing/icps'
import type { LandingMediaRef } from '@/lib/landing-media-ref'
import { FEATURES_ID } from './lit-about-block'
import { EmSpans, type BlockAction, type BlockProps } from './shared'

const ICONS: Record<LandingIcon, ReactNode> = {
  ticket: <Ticket aria-hidden="true" />,
  users: <Users aria-hidden="true" />,
  mail: <Mail aria-hidden="true" />,
  map: <MapIcon aria-hidden="true" />,
  card: <CreditCard aria-hidden="true" />,
  chat: <MessageCircle aria-hidden="true" />,
  calendar: <Calendar aria-hidden="true" />,
  tag: <Tag aria-hidden="true" />,
  image: <ImageIcon aria-hidden="true" />,
  chart: <ChartLine aria-hidden="true" />,
  sun: <Sun aria-hidden="true" />,
}

export interface IcpFeatureItem {
  icon: LandingIcon
  title: string
  media: LandingMediaRef
  body: string
  tags: readonly string[]
}

export interface IcpFeaturesContent {
  heading: string
  lead: string
  /** A still or a muted looping clip under the same video rules as every other clip. */
  background: LandingMediaRef
  cta: BlockAction
  items: readonly IcpFeatureItem[]
}

export function IcpFeaturesBlock({ content: d }: BlockProps<IcpFeaturesContent>) {
  return (
    <section className="feat" id={FEATURES_ID} data-feat="" aria-labelledby="lp-feat-title">
      <div className="feat-bg" aria-hidden="true">
        {/* A still, or a muted looping clip under the same video rules as every
            other clip (preload none until on screen; poster only under
            reduced motion or Save-Data). */}
        <LandingMedia media={d.background} />
      </div>
      <div className="wrap feat-grid">
        <div className="feat-left">
          <h2 id="lp-feat-title">
            <EmSpans text={d.heading} />
          </h2>
          <p>{d.lead}</p>
          <div className="fnav">
            {d.items.map((f, i) => (
              <button key={f.title} type="button" data-go={i} className={i === 0 ? 'on' : undefined} aria-current={i === 0 ? 'true' : undefined}>
                <b>0{i + 1}</b>
                {f.title}
              </button>
            ))}
          </div>
          <HostHandoffButton location={d.cta.track ?? 'features'} className="btn cta" withArrow>
            {d.cta.label}
          </HostHandoffButton>
        </div>
        <div className="fcards">
          {d.items.map((f, i) => (
            <article className="fcard" data-i={i} key={f.title}>
              <div className="top">
                <span className="logo">{ICONS[f.icon]}</span>
                <h3>{f.title}</h3>
              </div>
              <div className="media">
                <LandingMedia media={f.media} />
              </div>
              <p>{f.body}</p>
              <ul>
                {f.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
