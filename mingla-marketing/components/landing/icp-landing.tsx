import { IcpLandingAnalytics } from './icp-landing-analytics'
import { CallButtonAnalytics } from '@/components/forms/call-button-analytics'
import { SiteFooter } from '@/components/marketing/footer'
import { Spot } from '@/components/site-blocks/spot'
import { ChipsBlock } from '@/components/site-blocks/sections/chips-block'
import { FaqBlock } from '@/components/site-blocks/sections/faq-block'
import { IcpFeaturesBlock } from '@/components/site-blocks/sections/icp-features-block'
import { IcpHeroBlock } from '@/components/site-blocks/sections/icp-hero-block'
import { LitAboutBlock } from '@/components/site-blocks/sections/lit-about-block'
import { ToolCardBlock } from '@/components/site-blocks/sections/tool-card-block'
import { VideoBandBlock } from '@/components/site-blocks/sections/video-band-block'
import { SiteNav } from '@/components/site/site-nav'
import '@/components/site/site.css'
import type { IcpSlug } from '@/content/host-landing/icps'
import { icpBlocks } from '@/content/site-blocks/icp'
import { LandingRoot } from './landing-root'
import './landing.css'

// #4339 §2 — the ONE Host landing-page template ("Drift"). Every ICP page is
// this component plus its entry in content/host-landing/icps.ts. Section order
// is fixed by the spec:
//   1. full-screen video hero, 20% shade, two-line serif headline (the second
//      line italic), glass CTA bar;
//   2. paper "about" section overlapping the hero by 25px, words that light
//      up on scroll;
//   3. sticky features: fixed background, sticky left column with three
//      section buttons, three glass video cards;
//   4. who it's for;  5. the free tool;  6. FAQ;  7. closing video band.
// Buttons: "Use Mingla Host" → Host hand-off (§3), "Talk to the team" →
// /schedule?icp=<slug>, "See what's inside" → the features section, the tool →
// its internal /tools page. No privacy link here: the #4318 strip owns that.
//
// #4636: every section is a registry block (components/site-blocks/sections/)
// fed by content/site-blocks/icp.ts, which maps this ICP's icps.ts entry.

export { scheduleHref } from '@/content/site-blocks/icp'

export function IcpLandingPage({ slug }: { slug: IcpSlug }) {
  const b = icpBlocks(slug)

  return (
    <LandingRoot slug={slug}>
      <IcpLandingAnalytics slug={slug} />
      <CallButtonAnalytics />
      <SiteNav surface="host" current="host" />

      {/* 1. Hero */}
      <IcpHeroBlock content={b.hero} blockId="lp-title" />
      <Spot page={slug} id="after-hero" />

      {/* 2. About, over the hero by 25px */}
      <LitAboutBlock content={b.about} colour="cream" blockId="lp-about" />

      {/* 3. Features */}
      <IcpFeaturesBlock content={b.features} blockId="lp-feat-title" />
      <Spot page={slug} id="after-features" />

      {/* 4. Who it's for */}
      <ChipsBlock content={b.who} colour="paper" blockId="lp-who" />

      {/* 5. The free tool */}
      <ToolCardBlock content={b.tool} colour="paper" blockId={`lp-tool-${slug}`} />

      {/* 6. FAQ */}
      <Spot page={slug} id="before-faq" />
      <FaqBlock content={b.faq} colour="paper" blockId="lp-faq" />

      {/* 7. Closing band */}
      <VideoBandBlock content={b.band} blockId="lp-end" />

      <Spot page={slug} id="before-footer" />
      <SiteFooter surface="host" />
    </LandingRoot>
  )
}
