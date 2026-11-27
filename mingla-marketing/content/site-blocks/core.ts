// #4636 — default content of the core inner pages (About, Going out, Cities,
// Download, Support, Help, Careers, Free tools), block by block, moved out of
// their page modules under app/ (R1). Copy is the #4339 design's, word for word.
// The direct question and answer stay in each page's record (content/core-pages.ts).
import type { AnswerContent } from '@/components/site-blocks/sections/answer-block'
import type { CitiesRowContent } from '@/components/site-blocks/sections/cities-row-block'
import type { CityLinksContent } from '@/components/site-blocks/sections/city-links-block'
import type { FilterGridContent } from '@/components/site-blocks/sections/filter-grid-block'
import type { GetAppContent } from '@/components/site-blocks/sections/get-app-block'
import type { PageHeroContent } from '@/components/site-blocks/sections/page-hero-block'
import type { ParasContent } from '@/components/site-blocks/sections/paras-block'
import type { QuickLinksContent } from '@/components/site-blocks/sections/quick-links-block'
import type { StepsContent } from '@/components/site-blocks/sections/steps-block'
import type { StillStuckContent } from '@/components/site-blocks/sections/still-stuck-block'
import type { ToolCardsContent } from '@/components/site-blocks/sections/tool-cards-block'
import type { VCardsContent } from '@/components/site-blocks/sections/vcards-block'
import type { WideClipContent } from '@/components/site-blocks/sections/wide-clip-block'
import { CORE_PAGES } from '@/content/core-pages'

const answerOf = (key: 'about' | 'going-out'): AnswerContent => ({
  question: CORE_PAGES[key].directQuestion,
  answer: CORE_PAGES[key].directAnswer,
})

// --------------------------------------------------------------------- About

export const ABOUT_HERO: PageHeroContent = {
  variant: 'centred',
  title: 'Making real life *easier to find.*',
  lead: 'Mingla is the app for what to do, and the operating system for the places that make a city worth going out in.',
}

/** "What is Mingla?" and its direct answer (#4339 round B SEO audit 3). */
export const ABOUT_ANSWER: AnswerContent = answerOf('about')

export const ABOUT_CLIP: WideClipContent = { media: 'v:amb-about' }

export const ABOUT_WHY: ParasContent = {
  heading: 'Good plans shouldn’t be *hard to find.*',
  paragraphs: [
    'The best places in a city are often the hardest to find: the class with ten spots, the gallery late night, the café everyone’s friend knows about. Mingla puts them where people plan.',
    'We don’t match strangers. Mingla is for couples, friends, groups and solo plans: the people you already have, and the plans you haven’t made yet.',
    'And for hosts, Mingla is the growth and operating system that helps places with soul get found and booked.',
  ],
}

/** "For people going out" (the Explorer hand-off, §3) and "For places with soul" (→ /host). */
export const ABOUT_CARDS: VCardsContent = {
  variant: 'about',
  items: [
    {
      media: 'v:ab-explorer',
      wordmark: 'Mingla',
      title: 'For people *going out.*',
      line: 'Find plans that fit the vibe. Save them, schedule them, go.',
      action: { label: 'For people going out', to: 'app:explorer', track: 'about_explorer' },
    },
    {
      media: 'v:ab-host',
      wordmark: 'Mingla Host',
      title: 'For places *with soul.*',
      line: 'Get found, sell out and bring people back.',
      action: { label: 'For places with soul', to: '/host' },
    },
  ],
}

// ----------------------------------------------------------------- Going out

export const GOING_OUT_HERO: PageHeroContent = {
  variant: 'plain',
  title: 'Going out, *sorted.*',
  lead: 'Discover places, events, trips and experiences, inspect the details that change the decision, and save the useful options together.',
}

export const GOING_OUT_ANSWER: AnswerContent = answerOf('going-out')

export const GOING_OUT_GUIDES: FilterGridContent = {
  chips: ['Date ideas', 'With friends', 'Solo', 'Family', 'Side quests'],
  wideMedia: 'v:cozy',
  wideTitle: 'Movie nights, *under the stars.*',
  wideLine: 'Events, trips and places picked for the weekend in your city.',
  wideAction: { label: 'Movie nights, under the stars.', to: '/cities' },
  empty: 'No guides for that yet.',
  items: [
    { media: 'v:g-solo', title: 'Solo Saturday', line: 'Some of the best plans only need you.', tags: ['Solo'], city: null },
    { media: 'v:g-culture', title: 'Lagos, not parties', line: 'Four plans this week that aren’t parties.', tags: ['With friends'], city: 'lagos' },
    { media: 'v:g-under', title: 'Underrated Durham', line: 'The places people tell their friends about.', tags: ['With friends'], city: 'durham-nc' },
    { media: 'v:g-date', title: 'Cary has range', line: 'Not the Cary you remember.', tags: ['Date ideas'], city: 'cary-nc' },
    { media: 'v:g-family', title: 'With the grandparents', line: 'Plans for every age at the table.', tags: ['Family'], city: null },
    { media: 'v:g-quests', title: 'Lagos side quests', line: 'Pottery, paint, galleries and more.', tags: ['Side quests'], city: 'lagos' },
  ],
}

export const GOING_OUT_CITIES: CityLinksContent = { heading: 'Plans, *city by city.*', prefix: 'Things to do in' }

// -------------------------------------------------------------------- Cities

export const CITIES_HERO: PageHeroContent = {
  variant: 'plain',
  title: 'Pick a city. *Find a plan.*',
  lead: 'Local plans for the people who live there, and host tools for the places that make it worth it.',
}

export const CITIES_TILES: CitiesRowContent = { variant: 'index' }

// ------------------------------------------------------------------ Download

export const GET_APP: GetAppContent = {
  explorerTitle: 'Get *Mingla.*',
  explorerLead: 'Scan this with your phone, or pick your store.',
  hostTitle: 'Get *Mingla Host.*',
  hostLead: 'Scan this with your phone, pick your store, or run it in your browser.',
  media: 'v:cozy',
}

// ------------------------------------------------------------------- Support

export const SUPPORT_HERO: PageHeroContent = {
  variant: 'plain',
  title: 'How can we *help?*',
  lead: 'The Mingla team reads every support message and aims to respond within 1–2 business days.',
  note: 'For help with your account, app access, or a problem you spotted, email:',
  actions: [{ action: { label: 'support@usemingla.com', to: 'mailto:support@usemingla.com' } }, { action: { label: 'Help centre', to: '/help' } }],
}

export const SUPPORT_LINKS: QuickLinksContent = {
  heading: 'Quick links',
  items: [
    { action: { label: 'Privacy Policy', to: '/privacy-policy' } },
    { action: { label: 'Terms of Service', to: '/terms-of-service' } },
    { action: { label: 'Organiser Terms', to: '/organiser-terms' } },
    { action: { label: 'Delete your account', to: '/delete-account' } },
  ],
  note: 'Account deletion is also available in the app from Settings → Delete Account.',
}

// ---------------------------------------------------------------------- Help

export const HELP_HERO: PageHeroContent = {
  variant: 'plain',
  title: 'How can we *help?*',
  lead: 'Short videos for every step, from your first event to your first payout, on the web, on iPhone and on Android.',
}

export const HELP_STUCK: StillStuckContent = {
  heading: 'Still *stuck?*',
  lead: 'The team reads every message and aims to respond within 1–2 business days.',
  primary: { label: 'support@usemingla.com', to: 'mailto:support@usemingla.com' },
  secondary: { label: 'Book a call', to: '/schedule' },
}

// ------------------------------------------------------------------- Careers

export const CAREERS_HERO: PageHeroContent = {
  variant: 'plain',
  title: 'Build the app for *what to do.*',
  lead: 'We’re a small team making real life easier to find, for the people going out and the places that make it worth it.',
}

export const CAREERS_VALUES: StepsContent = {
  variant: 'values',
  items: [
    { title: 'Plans over pins', body: 'We build for the moment someone decides what to do.' },
    { title: 'Real places first', body: 'Every feature should help a place with soul get found.' },
    { title: 'Say it plainly', body: 'Clear words, honest numbers, no promises we can’t keep.' },
  ],
}

// ---------------------------------------------------------------- Free tools

export const TOOLS_HERO: PageHeroContent = {
  variant: 'plain',
  title: 'Free AI tools for people who *run real places.*',
  lead: 'No sign-up, no sales call. Run one, get something useful in a minute, built by Mingla, the app that helps people find your place.',
}

export const TOOLS_CARDS: ToolCardsContent = {
  items: [
    {
      tool: '/tools/venues',
      title: 'Venue Website Grader',
      body: 'Find out what your website says to a first-timer, and exactly what it’s costing you. Free report in 60 seconds.',
      forWho: 'Restaurants · Bars · Cafés · Clubs',
      cta: 'Grade my website',
      media: 'v:cafe',
    },
    {
      tool: '/tools/events',
      title: 'Event Turnout Predictor',
      body: 'How many people will actually show up? Get a turnout forecast, and see what your promo budget can buy. Free, in under a minute.',
      forWho: 'Event organisers · Promoters',
      cta: 'Forecast my turnout',
      media: 'v:crowd',
    },
    {
      tool: '/tools/trips',
      title: 'Quote Any Trip',
      body: 'Price a group trip in a minute: real hotels and activities, a full cost sheet, and exactly what to charge per person. Free.',
      forWho: 'Travel organisers · Trip hosts',
      cta: 'Quote a trip',
      media: 'v:sailing',
    },
    {
      tool: '/tools/pricing',
      title: 'The Undercharging Audit',
      body: 'Priced by guilt? See your true cost per head, including your own time, and the price you should actually charge. Free.',
      forWho: 'Experience hosts · Activity spaces',
      cta: 'Audit my pricing',
      media: 'v:pottery',
    },
  ],
}
