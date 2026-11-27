// #4636 — Home's default content, block by block (moved out of
// components/site/home-page.tsx, R1). Copy is the #4339 design's, word for word.
// `*words*` is the italic half. Every "Use Mingla" is the Explorer hand-off.
import type { ReelHeroContent } from '@/components/site-blocks/sections/reel-hero-block'
import type { StepsContent } from '@/components/site-blocks/sections/steps-block'
import type { TilesContent } from '@/components/site-blocks/sections/tiles-block'
import type { CitiesRowContent } from '@/components/site-blocks/sections/cities-row-block'
import type { MarqueeContent } from '@/components/site-blocks/sections/marquee-block'
import type { VideoBandContent } from '@/components/site-blocks/sections/video-band-block'
import type { ReelCard } from '@/components/site/reel-stage'

/** The headline's middle line, in the design's order. */
export const HOME_PHRASES = ['romantic plans', 'weekend plans', 'side quests', 'group plans', 'solo plans'] as const

export const HOME_REEL: readonly ReelCard[] = [
  { media: 'v:amapiano', caption: 'Amapiano night' },
  { media: 'v:h-boat', caption: 'Boat day' },
  { media: 'v:salsa', caption: 'Salsa social' },
  { media: 'v:h-arcade', caption: 'Arcade night' },
  { media: 'v:cozy', caption: 'Movie under the stars' },
  { media: 'v:h-garden', caption: 'Garden walk' },
  { media: 'v:grandplace', caption: 'Old-town evening' },
  { media: 'v:h-pottery', caption: 'Pottery class' },
  { media: 'v:beach', caption: 'Beach day' },
  { media: 'v:h-music', caption: 'Live music' },
]

export const HOME_HERO: ReelHeroContent = {
  lines: ['Find', 'that fit the vibe.'],
  phrases: HOME_PHRASES,
  srTitle: 'Find plans that fit the vibe.',
  sub: 'Mingla is the app for what to do. Real places, events and experiences, picked for the mood you’re in, in the city you’re in.',
  cta: { label: 'Use Mingla', to: 'app:explorer', track: 'hero' },
  cards: HOME_REEL,
}

export const HOME_HOW: StepsContent = {
  variant: 'home',
  heading: 'From *“what should we do?”* to a date in the calendar.',
  lead: 'Discover places, events, trips and experiences, compare the details that change the decision, and save the good ones together.',
  items: [
    { title: 'Pick a *vibe.*', body: 'Tell Mingla the mood. It shows real plans nearby, not a wall of map pins.', visual: 'pills', words: ['Chill', 'Romantic', 'Adventurous'] },
    { title: 'Keep the *good ones.*', body: 'Everything you like goes to your Saved tab, ready when the group chat wakes up.', visual: 'saved', words: ['Saved · 12 plans'] },
    { title: 'Pick a *date.*', body: 'Tap Schedule and it’s on your Calendar. The date is the plan.', visual: 'scheduled', words: ['Sat · Scheduled'] },
  ],
}

export const AUDIENCES: TilesContent = {
  heading: 'Not a dating app. *A plans app.*',
  lead: 'Mingla doesn’t match strangers. It finds the plan for the people you already have, or for just you.',
  items: [
    { media: 'v:bachata', title: 'Couples', line: 'Date nights that aren’t dinner again.', action: { label: 'Couples', to: '/going-out' } },
    { media: 'v:a-friends', title: 'Friends', line: 'The plan the whole chat agrees on.', action: { label: 'Friends', to: '/going-out' } },
    { media: 'v:a-family', title: 'Family', line: 'Something for every age.', action: { label: 'Family', to: '/going-out' } },
    { media: 'v:a-solo', title: 'Solo', line: 'Some of the best plans only need you.', action: { label: 'Solo', to: '/going-out' } },
  ],
}

/** The cities row: every live Mingla city, A to Z (lib/live-cities.ts). */
export const HOME_CITIES: CitiesRowContent = {
  variant: 'home',
  heading: 'Your city, *but better.*',
  action: { label: 'All cities', to: '/cities' },
}

export const MARQUEE: MarqueeContent = {
  words: ['Date night', 'Side quests', 'Live music', 'Brunch', 'Boat day', 'Gallery hop', 'Game night', 'Solo Saturday'],
}

export const HOME_BAND: VideoBandContent = {
  variant: 'plain',
  media: 'v:crowd',
  heading: 'Run a place *with soul?*',
  body: 'Mingla Host is the growth and operating system that helps the right people find and book you.',
  primary: { label: 'See Mingla Host', to: '/host' },
}
