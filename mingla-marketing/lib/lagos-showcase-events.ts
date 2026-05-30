// ---------------------------------------------------------------
// Lagos Showcase Events — ORCH-0998 [marketing real place cards — DC test run]
//
// Hardcoded snapshot of 4 Lagos-NG events for the event card, mirroring
// dc-showcase-events.ts. TEST DATA — no backend calls at render time.
//
// PROVENANCE: Ticketmaster has NO Nigeria coverage, so these are REPRESENTATIVE
// "On Mingla" samples — real Lagos venues with editorial event titles for the
// marketing test run. Cover images are the EXACT `stored_photo_urls[0]` of each
// named venue from place_pool (Lagos city_id). Prices are NGN (₦). Per operator
// directive (same as DC) ALL events present as "On Mingla".
//
// Same `ShowcaseEvent` shape as dc-showcase-events.ts.
// ---------------------------------------------------------------

import type { ShowcaseEvent } from '@/lib/dc-showcase-events'

const PHOTO_BASE =
  'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos'

export const LAGOS_SHOWCASE_EVENTS: readonly ShowcaseEvent[] = [
  {
    source: 'mingla',
    title: 'Afrobeats Rooftop',
    venue: 'Hard Rock Cafe Lagos',
    dateMonth: 'MAY',
    dateDay: '30',
    weekdayTime: 'Sat · 9:00 PM',
    price: 'from ₦15,000',
    genreOrTags: 'Afrobeats · DJ',
    // Cover = Hard Rock Cafe Lagos venue photo.
    coverImageUrl: `${PHOTO_BASE}/ChIJO9roHBT1OxAR_vBWLr5n384/0.jpg`,
    coverHue: null,
    ticketUrl: '#',
    onMingla: true,
    kind: 'Party',
  },
  {
    source: 'mingla',
    title: 'Freedom Park Jazz Night',
    venue: 'Freedom Park Lagos',
    dateMonth: 'MAY',
    dateDay: '31',
    weekdayTime: 'Sun · 6:00 PM',
    price: 'from ₦10,000',
    genreOrTags: 'Jazz · Live',
    // Cover = Freedom Park Lagos venue photo.
    coverImageUrl: `${PHOTO_BASE}/ChIJaaKZyRmLOxARR-nEcxQBEQ4/0.jpg`,
    coverHue: null,
    ticketUrl: '#',
    onMingla: true,
    kind: 'Concert',
  },
  {
    source: 'mingla',
    title: 'Nike Gallery Art Night',
    venue: 'Nike Art Gallery',
    dateMonth: 'JUN',
    dateDay: '6',
    weekdayTime: 'Sat · 4:00 PM',
    price: 'from ₦5,000',
    genreOrTags: 'Art · Culture',
    // Cover = Nike Art Gallery venue photo.
    coverImageUrl: `${PHOTO_BASE}/ChIJecHJJP_0OxARsqN_e4LH4rQ/0.jpg`,
    coverHue: null,
    ticketUrl: '#',
    onMingla: true,
    kind: 'Event',
  },
  {
    source: 'mingla',
    title: 'Lagos Beach Festival',
    venue: 'Eko Hotels & Suites',
    dateMonth: 'JUN',
    dateDay: '7',
    weekdayTime: 'Sun · 12:00 PM',
    price: 'from ₦20,000',
    genreOrTags: 'Live · Outdoor',
    // Cover = Hakuna Matata Theme Park By Eko Hotels venue photo (Eko Hotels grounds).
    coverImageUrl: `${PHOTO_BASE}/ChIJozcTQv2LOxARDESDAV851LI/0.jpg`,
    coverHue: null,
    ticketUrl: '#',
    onMingla: true,
    kind: 'Festival',
  },
] as const
