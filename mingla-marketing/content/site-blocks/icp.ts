// #4636 — the host-type pages' default content as blocks. The copy stays in
// content/host-landing/icps.ts (one data object per ICP, #4339); this maps one
// ICP to the blocks components/landing/icp-landing.tsx renders, in the spec's
// fixed order: hero, about (lit), features, who it's for, free tool, FAQ,
// closing band.
import type { ChipsContent } from '@/components/site-blocks/sections/chips-block'
import type { FaqContent } from '@/components/site-blocks/sections/faq-block'
import type { IcpFeaturesContent } from '@/components/site-blocks/sections/icp-features-block'
import type { IcpHeroContent } from '@/components/site-blocks/sections/icp-hero-block'
import type { LitAboutContent } from '@/components/site-blocks/sections/lit-about-block'
import type { ToolCardContent } from '@/components/site-blocks/sections/tool-card-block'
import type { VideoBandContent } from '@/components/site-blocks/sections/video-band-block'
import { ICP_LANDINGS, landingBackgroundMedia, type IcpSlug } from '@/content/host-landing/icps'

export function scheduleHref(slug: IcpSlug): string {
  return `/schedule?icp=${encodeURIComponent(slug)}`
}

export interface IcpBlocks {
  hero: IcpHeroContent
  about: LitAboutContent
  features: IcpFeaturesContent
  who: ChipsContent
  tool: ToolCardContent
  faq: FaqContent
  band: VideoBandContent
}

export function icpBlocks(slug: IcpSlug): IcpBlocks {
  const d = ICP_LANDINGS[slug]
  return {
    hero: {
      pill: `For ${d.name.toLowerCase()}`,
      line1: d.l1,
      line2: d.l2,
      sub: d.sub,
      media: d.hero,
      call: { label: 'Book a call', to: scheduleHref(slug) },
      app: { to: 'app:host', track: 'hero' },
    },
    about: {
      intro: d.intro,
      call: { label: 'Talk to the team', to: scheduleHref(slug) },
      insideLabel: 'See what’s inside',
      duoA: d.duo[0],
      duoB: d.duo[1],
      big: d.big,
    },
    features: {
      heading: d.fh,
      lead: d.fp,
      background: landingBackgroundMedia(d.bg),
      cta: { to: 'app:host', track: 'features' },
      items: d.feats.map((f) => ({ icon: f.ic, title: f.t, media: f.m, body: f.p, tags: f.tags })),
    },
    who: { heading: `Built for *${d.short.toLowerCase()}* of every size.`, items: d.who },
    tool: { tool: d.tool.n, body: d.tool.d, cta: d.tool.cta, fields: d.tool.f.map(([label, input, example]) => ({ label, input, example })) },
    faq: {
      variant: 'icp',
      heading: 'The *short* answers.',
      action: { label: 'Help centre', to: '/help' },
      items: d.faq.map(([question, answer]) => ({ question, answer })),
    },
    band: { variant: 'icp', media: d.endm, heading: d.end, bring: 'Set it up today.', primary: { to: 'app:host', track: 'band' } },
  }
}
