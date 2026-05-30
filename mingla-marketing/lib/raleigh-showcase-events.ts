// ---------------------------------------------------------------
// Raleigh Showcase Events — ORCH-1007 [marketing real place cards — DC test run]
//
// Hardcoded snapshot of 5 Raleigh-NC events for the event card, mirroring
// dc-showcase-events.ts. TEST DATA — no backend calls at render time.
//
// PROVENANCE: titles, venues, dates, and cover-image CDN URLs are REAL
// Ticketmaster data for Raleigh. Per operator directive (same as DC) ALL events
// present as "On Mingla" — NO Ticketmaster attribution anywhere in the UI.
// PRICES are illustrative: Ticketmaster returned TBA for these dates, so the
// "from $X" figures below are tasteful placeholders for the marketing test run
// (USD) — do NOT treat them as live ticket prices.
//
// Same `ShowcaseEvent` shape as dc-showcase-events.ts.
// ---------------------------------------------------------------

import type { ShowcaseEvent } from '@/lib/dc-showcase-events'

export const RALEIGH_SHOWCASE_EVENTS: readonly ShowcaseEvent[] = [
  {
    source: 'mingla',
    title: 'French Montana & Max B',
    venue: 'The Ritz',
    dateMonth: 'MAY',
    dateDay: '29',
    weekdayTime: 'Fri · 7:00 PM',
    price: 'from $45',
    genreOrTags: 'Hip-Hop',
    coverImageUrl:
      'https://s1.ticketm.net/dam/a/b26/a93dc257-c75d-4738-9894-e869c588bb26_TABLET_LANDSCAPE_LARGE_16_9.jpg',
    coverHue: null,
    ticketUrl: '#',
    onMingla: true,
    kind: 'Concert',
  },
  {
    source: 'mingla',
    title: 'Young the Giant — Victory Garden Tour',
    venue: 'Red Hat Amphitheater',
    dateMonth: 'MAY',
    dateDay: '30',
    weekdayTime: 'Sat · 6:30 PM',
    price: 'from $55',
    genreOrTags: 'Rock',
    coverImageUrl:
      'https://s1.ticketm.net/dam/a/7a4/27411d5c-0273-4251-8562-4c56e82a37a4_TABLET_LANDSCAPE_LARGE_16_9.jpg',
    coverHue: null,
    ticketUrl: '#',
    onMingla: true,
    kind: 'Concert',
  },
  {
    source: 'mingla',
    title: 'Linkin Park Experience',
    venue: 'The Ritz',
    dateMonth: 'MAY',
    dateDay: '30',
    weekdayTime: 'Sat · 7:00 PM',
    price: 'from $30',
    genreOrTags: 'Rock',
    coverImageUrl:
      'https://s1.ticketm.net/dam/a/5af/947c8d46-524b-4a8c-926d-589c728055af_SOURCE',
    coverHue: null,
    ticketUrl: '#',
    onMingla: true,
    kind: 'Party',
  },
  {
    source: 'mingla',
    title: 'Ben Folds & A Piano Tour',
    venue: 'Martin Marietta Center',
    dateMonth: 'MAY',
    dateDay: '30',
    weekdayTime: 'Sat · 8:00 PM',
    price: 'from $50',
    genreOrTags: 'Rock',
    coverImageUrl:
      'https://s1.ticketm.net/dam/e/e9e/2755d00e-27ee-43a1-b6b1-6319616b8e9e_SOURCE',
    coverHue: null,
    ticketUrl: '#',
    onMingla: true,
    kind: 'Concert',
  },
  {
    source: 'mingla',
    title: 'MGK: Lost Americana Tour',
    venue: 'Coastal Credit Union Music Park',
    dateMonth: 'JUN',
    dateDay: '2',
    weekdayTime: 'Tue · 7:00 PM',
    price: 'from $60',
    genreOrTags: 'Rock',
    coverImageUrl:
      'https://s1.ticketm.net/dam/a/2c5/32e4b3b1-7ad7-4e43-bd4b-5612b21042c5_SOURCE',
    coverHue: null,
    ticketUrl: '#',
    onMingla: true,
    kind: 'Festival',
  },
] as const
