// #4636 — For hosts' (/host) default content, block by block (moved out of
// components/site/host-page.tsx, R1). "Use Mingla Host" is the Host hand-off
// (§3) everywhere, including the two toolkit rows that point at host web.
import type { PromptDemoContent } from '@/components/site-blocks/sections/prompt-demo-block'
import type { ReelHeroContent } from '@/components/site-blocks/sections/reel-hero-block'
import type { TilesContent } from '@/components/site-blocks/sections/tiles-block'
import type { ToolkitContent } from '@/components/site-blocks/sections/toolkit-block'
import type { VCardsContent } from '@/components/site-blocks/sections/vcards-block'
import type { VideoBandContent } from '@/components/site-blocks/sections/video-band-block'
import type { ReelCard } from '@/components/site/reel-stage'
import { ICP_LANDINGS, ICP_SLUGS, icpLandingPath } from '@/content/host-landing/icps'

export const HOST_REEL: readonly ReelCard[] = [
  { media: 'v:amapiano', caption: 'Events' },
  { media: 'v:sailing', caption: 'Trips' },
  { media: 'v:pottery', caption: 'Experiences' },
  { media: 'v:cafe', caption: 'Cafés' },
  { media: 'v:beach', caption: 'Resorts' },
  { media: 'v:hc-gallery', caption: 'Galleries' },
  { media: 'v:nightlife', caption: 'Play spaces' },
  { media: 'v:hostess', caption: 'Restaurants' },
  { media: 'v:salsa', caption: 'Dance socials' },
  { media: 'v:hc-bowling', caption: 'Play spaces' },
]

export const HOST_HERO: ReelHeroContent = {
  lines: ['Everything', '*a host needs.*'],
  sub: 'The growth and operating system for places with soul: get found by people looking for something to do, then run the night, the trip or the room.',
  // No label: the hand-off's own device labels (Get / Use Mingla Host).
  cta: { to: 'app:host', track: 'hero' },
  cards: HOST_REEL,
}

/** The seven host-type tiles (each opens its /host/<icp> landing page) plus Free tools. */
export const HOST_KINDS: TilesContent = {
  heading: 'Built for *every kind* of host.',
  lead: 'Pick yours.',
  items: [
    ...ICP_SLUGS.map((slug) => {
      const d = ICP_LANDINGS[slug]
      return { media: d.hero, title: d.short, line: d.l1, lineEnd: d.l2, action: { label: d.short, to: icpLandingPath(slug) } }
    }),
    { media: 'v:bg-exp', title: 'Free tools', line: 'No sign-up, no sales call.', action: { label: 'Free tools', to: '/tools' }, look: 'tools' },
  ],
}

export const HOST_SITE: PromptDemoContent = {
  heading: 'Prompt your website *into existence.*',
  lead: 'Describe your place and get a free site in seconds, connected to your listings, tickets and bookings.',
  button: 'Make my site',
}

/** Ari: video text cards with the wash (Owned, Shared, Earned, Paid). */
export const ARI_CARDS: VCardsContent = {
  variant: 'ari',
  heading: 'Marketing that *doesn’t sleep.*',
  lead: 'Ari works across every channel you have: the ones you own, the ones people share, the ones you earn and the ones you pay for.',
  items: [
    { media: 'v:cafe', title: 'Owned', line: 'Your site, listings, email and SMS.' },
    { media: 'v:crowd', title: 'Shared', line: 'The posts and links people pass on.' },
    { media: 'v:salsa', title: 'Earned', line: 'Reviews, creators and word of mouth.' },
    { media: 'v:nightlife', title: 'Paid', line: 'Ads that point to pages that convert.' },
  ],
}

export const TOOLKIT: ToolkitContent = {
  heading: 'Run it *all* from one place.',
  items: [
    { title: 'Events', line: 'Ticketing, guest lists, door scanning and an AI demand forecast.', action: { label: 'Events', to: icpLandingPath('events') } },
    { title: 'Trips', line: 'Group chat, instalments and itineraries.', action: { label: 'Trips', to: icpLandingPath('trips') } },
    {
      title: 'Venue management',
      line: 'Reservations, table ordering, menu intelligence and a demand forecast.',
      action: { label: 'Venue management', to: icpLandingPath('restaurants') },
    },
    // app:host: host web, through the Host hand-off.
    { title: 'Marketing', line: 'Email, SMS and CRM nurturing that brings people back.', action: { to: 'app:host', track: 'toolkit' } },
    { title: 'Ari AI', line: 'Owned, shared, earned and paid, in one assistant.', action: { to: 'app:host', track: 'toolkit' } },
  ],
}

export const HOST_BAND: VideoBandContent = {
  variant: 'glass',
  media: 'v:hostess',
  heading: 'Get found. *Get booked.*',
  bring: 'Questions first?',
  primary: { label: 'Book a call', to: '/schedule' },
}
