import { LandingRoot } from '@/components/landing/landing-root'
import { PromptDemoBlock } from '@/components/site-blocks/sections/prompt-demo-block'
import { ReelHeroBlock } from '@/components/site-blocks/sections/reel-hero-block'
import { TilesBlock } from '@/components/site-blocks/sections/tiles-block'
import { ToolkitBlock } from '@/components/site-blocks/sections/toolkit-block'
import { VCardsBlock } from '@/components/site-blocks/sections/vcards-block'
import { VideoBandBlock } from '@/components/site-blocks/sections/video-band-block'
import { ARI_CARDS, HOST_BAND, HOST_HERO, HOST_KINDS, HOST_SITE, TOOLKIT } from '@/content/site-blocks/host'
import { SiteFooterLive, SiteNavLive } from './site-chrome'
import '@/components/landing/landing.css'
import './site.css'

// #4339 phase 2a — Mingla Host (/host), in the approved design's order:
//   dark Reelmark hero ("Everything / a host needs.", Use Mingla Host) → the
//   seven host-type tiles (each opens its /host/<icp> landing page) plus Free
//   tools → "Prompt your website into existence" (visual demo, §5) → the Ari
//   cards (Owned, Shared, Earned, Paid) on video with the text-card wash →
//   the toolkit list → the closing band with "Book a call" (/schedule).
//
// #4636: every section is a registry block (components/site-blocks/sections/),
// rendered with this page's default content (content/site-blocks/host.ts).
// "Use Mingla Host" is the Host hand-off (§3) everywhere, including the two
// toolkit rows that point at host web (Marketing, Ari AI).

export { HOST_REEL } from '@/content/site-blocks/host'

export function HostPage() {
  return (
    <LandingRoot>
      <SiteNavLive surface="host" current="host" />
      <ReelHeroBlock content={HOST_HERO} colour="night" blockId="rm-title" />
      {/* Host types */}
      <TilesBlock content={HOST_KINDS} colour="paper" blockId="host-kinds" />
      {/* Prompt your website into existence (visual demo, §5) */}
      <PromptDemoBlock content={HOST_SITE} colour="cream" blockId="host-site" />
      {/* Ari: video text cards with the wash */}
      <VCardsBlock content={ARI_CARDS} colour="night" blockId="host-ari" />
      {/* Toolkit */}
      <ToolkitBlock content={TOOLKIT} colour="paper" blockId="host-kit" />
      {/* Closing band */}
      <VideoBandBlock content={HOST_BAND} blockId="host-end" />
      <SiteFooterLive surface="host" />
    </LandingRoot>
  )
}
