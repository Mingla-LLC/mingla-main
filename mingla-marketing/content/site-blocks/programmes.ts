// #4636 — Creators (/creators) and Locals (/locals) default content, block by
// block (moved out of app/creators/page.tsx and app/locals/page.tsx, R1).
// The Locals facts are the live page's terms, word for word (#3872 pins them):
// up to three Locals per open city, $150 after approval, paid by Mingla, never
// by the place. Creator setup lives in the Mingla (Explorer) app.
import type { CodedHero } from '@/components/site-blocks/hero-words'
import type { ClipGridContent } from '@/components/site-blocks/sections/clip-grid-block'
import type { FactsContent } from '@/components/site-blocks/sections/facts-block'
import type { FinePrintContent } from '@/components/site-blocks/sections/fine-print-block'
import type { StepsContent } from '@/components/site-blocks/sections/steps-block'
import type { VideoBandContent } from '@/components/site-blocks/sections/video-band-block'

// ------------------------------------------------------------------ Creators

export const CREATORS_HERO: CodedHero = {
  h1: 'Get hired to show people what a city',
  em: 'feels like.',
  lead: 'Mingla Creators make the videos and photos that help people choose. Become a Creator and complete paid gigs for places and events on Mingla.',
  app: { text: 'Get Mingla to join', location: 'creators_join' },
  call: { text: 'Book a call', href: '/schedule/creators' },
}

export const CREATORS_CLIPS: ClipGridContent = {
  items: [{ media: 'v:amapiano' }, { media: 'v:salsa' }, { media: 'v:pottery' }, { media: 'v:beach' }],
}

export const CREATORS_STEPS: StepsContent = {
  variant: 'creators',
  items: [
    {
      title: 'Set up your profile',
      body: 'Build your profile in Mingla. Creator mode stays private until every readiness check is complete.',
    },
    {
      title: 'Get hired',
      body: 'See the city, format, dates and budget before you raise your hand. Host names stay private until a hire is agreed.',
    },
    {
      title: 'Get paid',
      body: 'Your contract, delivery and payout status stay together. Mingla does not turn your earnings into a wallet balance.',
    },
  ],
}

export const CREATORS_BAND: VideoBandContent = {
  variant: 'creators',
  media: 'v:salsa',
  heading: 'Questions *first?*',
  bring: 'Talk to the Creators team',
  primary: { label: 'Book a call', to: '/schedule/creators' },
}

export const CREATORS_FINE: FinePrintContent = {
  before: 'You’ll read and accept the',
  link: { label: 'Creator agreement', to: '/creator-agreement' },
  after: 'inside Mingla before your first gig.',
}

// -------------------------------------------------------------------- Locals

export const LOCALS_HERO: CodedHero = {
  h1: 'One honest review,',
  em: 'every month.',
  lead: 'Mingla chooses up to three Locals in each open city. Complete one useful, independent place review each month and earn $150 after approval.',
  app: { text: 'Get Mingla to apply', location: 'locals_apply' },
  call: { text: 'Book a call', href: '/schedule/locals' },
}

export const LOCALS_STEPS: StepsContent = {
  variant: 'locals',
  heading: 'Independent by design, *paid by Mingla.*',
  items: [
    {
      title: 'Choose one eligible place',
      body: 'Pick somewhere in your city that no Mingla Local has covered recently and where you have no personal or paid connection.',
    },
    {
      title: 'Visit on your own terms',
      body: 'Go during the month and pay for your own visit. The $150 monthly payment is designed to cover the outing and your work.',
    },
    {
      title: 'Publish a useful first-hand review',
      body: 'Share a specific written review, strong photos or a short video, and your disclosed social post. Mingla reviews the work, not the place.',
    },
  ],
}

export const LOCALS_FACTS: FactsContent = {
  items: [
    {
      title: '$150 after approval',
      body: 'Your payout is converted into your payout currency when it is queued, shown to you, and sent through your connected payout provider. It never comes from the place you reviewed.',
    },
    {
      title: 'Trust comes first',
      body: 'You must disclose the Mingla Local relationship. Personal ties and recent paid work with a place make it ineligible. A place may reply publicly, but it cannot choose, pay or silence you.',
    },
  ],
}

export const LOCALS_BAND: VideoBandContent = {
  variant: 'locals',
  media: 'v:amb-locals',
  heading: 'Your city, *in your words.*',
  body: 'Applications appear in Mingla only when a city is open. With three seats per city, a thoughtful sample matters more than a giant following.',
  primary: { label: 'Get Mingla to apply', to: 'app:explorer', track: 'locals_band' },
  secondary: { label: 'Book a call', to: '/schedule/locals' },
}

export const LOCALS_FINE: FinePrintContent = {
  before: 'You’ll read and accept the',
  link: { label: 'Local agreement', to: '/local-agreement' },
  after: 'inside Mingla when you apply.',
}
