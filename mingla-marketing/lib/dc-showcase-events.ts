// ---------------------------------------------------------------
// DC Showcase Events — ORCH-1007 [marketing real place cards — DC test run]
//
// Hardcoded snapshot of 6 Washington-DC events for the THIRD marketing card
// type (the "event card", sibling of the single place card + the intent card).
// Built per DESIGN_ORCH-1007_MARKETING_PLACE_CARD_DC.md "Event Card v1"
// (§E.1–E.11).
//
// POSITIONING (LOCKED): Mingla is an EXPERIENCE / date-planning / social-
// experiences app — NOT a dating app. An event is a TIME-ANCHORED happening
// (a show, a party, a concert, a rooftop session). Date/time is the hero
// data point.
//
// DATA PROVENANCE (honesty):
//  - The 4 Ticketmaster events are REAL — fetched live from the Ticketmaster
//    edge function for Washington DC (real titles, venues, dates, cover-image
//    CDN URLs, and ticket URLs). source: 'ticketmaster'.
//  - The 2 Mingla Business events are REPRESENTATIVE samples (the real
//    business events in the DB are test data, not showable). One ("Rooftop
//    Vinyl Sundays") carries a photo cover; the other ("Lincoln Cottage Jazz
//    Picnic") has NO cover media on purpose, to SHOWCASE the coverHue striped
//    fallback band (per §E.4b, faithful to @mingla/offering-rendering EventCover).
//    source: 'mingla'.
//
// This is TEST DATA — no backend calls, no fetch, no edge function at render
// time. If a future ORCH wires this to live events, replace this array with a
// typed fetch; the consuming <EventCard> only reads the ShowcaseEvent shape.
// ---------------------------------------------------------------

/** Which system an event comes from — drives cover-fallback, source chip, and pill copy. */
export type EventSource = 'mingla' | 'ticketmaster'

/**
 * Event kind — ORCH-1007 hero-pill sync. Drives the headline pill vocabulary
 * (concerts / parties / festivals / events) so the rotating word always matches
 * the front event card. NOT a backend field; assigned per-event in this snapshot.
 */
export type EventKind = 'Concert' | 'Party' | 'Festival' | 'Event'

/**
 * One showcase event. Shape per DESIGN_ORCH-1007 §E.11.2.
 *
 * `coverImageUrl` present → image cover path; null + `coverHue` → striped
 * fallback band (§E.4b); null + no hue → Mingla-mark 404 fallback.
 */
export interface ShowcaseEvent {
  /** Discriminator: 'mingla' (On-Mingla chip) | 'ticketmaster' (genre + attribution). */
  source: EventSource
  /** Display title — verbatim. */
  title: string
  /** Venue name (drives Variant A short ≤16 chars vs Variant B long → white chip). */
  venue: string
  /** 3-letter uppercase month for the calendar tile (e.g. "MAY" / "JUN"). */
  dateMonth: string
  /** Day-of-month for the calendar tile (e.g. "30"). */
  dateDay: string
  /** Weekday + time eyebrow detail (e.g. "Sat · 10:00 PM"). */
  weekdayTime: string
  /** Price string ("$18", "from $15") or null → CTA-only pill (never "TBA"). */
  price: string | null
  /** Genre (TM: "Pop"/"R&B") or Mingla taxonomy tag ("House · Soul") for the eyebrow. */
  genreOrTags: string
  /** Real cover image URL, or null → coverHue band / Mingla-mark fallback. */
  coverImageUrl: string | null
  /** Brand cover hue 0–360 for the striped fallback band (§E.4b), or null. */
  coverHue: number | null
  /** Ticket / event URL (presentational this run — not wired as a live link). */
  ticketUrl: string
  /** True for Mingla Business events (renders the "On Mingla" ink chip). */
  onMingla: boolean
  /**
   * Event kind (ORCH-1007 hero-pill sync). Drives the headline pill word
   * shown in "Find <pill> that fit the vibe" while this event is the front
   * card: Concert → "concerts", Party → "parties", Festival → "festivals",
   * Event → "events". Pill label + icon are resolved from this in the deck.
   */
  kind: EventKind
}

export const DC_SHOWCASE_EVENTS: readonly ShowcaseEvent[] = [
  // ---- Ticketmaster events (REAL — live from the Ticketmaster edge function, Washington DC) ----
  {
    source: 'ticketmaster',
    title: '"Off The Wall" — A Michael Jackson Tribute',
    venue: 'Howard Theatre',
    dateMonth: 'MAY',
    dateDay: '30',
    weekdayTime: 'Sat · 10:00 PM',
    price: 'from $18',
    genreOrTags: 'Pop',
    coverImageUrl:
      'https://s1.ticketm.net/dam/c/4f2/0109888a-61b5-4525-8432-b026ef04f4f2_105631_TABLET_LANDSCAPE_LARGE_16_9.jpg',
    coverHue: null,
    ticketUrl:
      'https://www.ticketweb.com/event/off-the-wall-a-michael-howard-theatre-tickets/14920733',
    onMingla: false,
    kind: 'Party',
  },
  {
    source: 'ticketmaster',
    title: 'Alex Isley — When The City Sleeps',
    venue: 'Warner Theatre',
    dateMonth: 'MAY',
    dateDay: '29',
    weekdayTime: 'Fri · 8:00 PM',
    price: 'from $45',
    genreOrTags: 'R&B',
    coverImageUrl:
      'https://s1.ticketm.net/dam/a/929/868a946f-8525-4a3c-aa3a-329c04fdc929_SOURCE',
    coverHue: null,
    ticketUrl:
      'https://www.ticketmaster.com/alex-isley-when-the-city-sleeps-washington-district-of-columbia-05-29-2026/event/15006470178EE92C',
    onMingla: false,
    kind: 'Concert',
  },
  {
    source: 'ticketmaster',
    title: "National Symphony Orchestra: Appalachian Spring & Mahler's First",
    venue: 'Kennedy Center · Concert Hall',
    dateMonth: 'MAY',
    dateDay: '29',
    weekdayTime: 'Fri · 8:00 PM',
    price: 'from $39',
    genreOrTags: 'Classical',
    coverImageUrl:
      'https://s1.ticketm.net/dam/a/7ff/acbe1a66-2777-4a79-8770-4dcd73ab17ff_TABLET_LANDSCAPE_LARGE_16_9.jpg',
    coverHue: null,
    ticketUrl: 'https://www.ticketmaster.com/event/Z7r9jZ1A7jvuE',
    onMingla: false,
    kind: 'Concert',
  },
  {
    source: 'ticketmaster',
    title: 'The Knocks x Dragonette x Aquaria',
    venue: '9:30 CLUB',
    dateMonth: 'MAY',
    dateDay: '29',
    weekdayTime: 'Fri · 8:00 PM',
    price: 'from $30',
    genreOrTags: 'Pop',
    coverImageUrl:
      'https://s1.ticketm.net/dam/a/6e5/231540ba-47db-405b-aa6f-d1ca689966e5_SOURCE',
    coverHue: null,
    ticketUrl:
      'https://www.ticketmaster.com/the-knocks-x-dragonette-x-aquaria-washington-district-of-columbia-05-29-2026/event/1500644DB27AC49B',
    onMingla: false,
    kind: 'Party',
  },

  // ---- Mingla Business events (REPRESENTATIVE samples — real DB events are test data) ----
  {
    source: 'mingla',
    title: 'Rooftop Vinyl Sundays',
    venue: 'Hip Flask Rooftop · DC',
    dateMonth: 'JUN',
    dateDay: '7',
    weekdayTime: 'Sun · 4:00 PM',
    price: 'from $15',
    genreOrTags: 'House · Soul',
    // Photo-cover sample — a real public place-photo from Supabase Storage.
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJPzCbrlbJt4kREaJ0zBPbv9c/0.jpg',
    coverHue: 25,
    ticketUrl: '#',
    onMingla: true,
    kind: 'Party',
  },
  {
    source: 'mingla',
    title: 'Lincoln Cottage Jazz Picnic',
    venue: "President Lincoln's Cottage",
    dateMonth: 'JUN',
    dateDay: '13',
    weekdayTime: 'Sat · 5:00 PM',
    price: 'from $20',
    genreOrTags: 'Jazz · Picnic',
    // Photo-cover sample — the real President Lincoln's Cottage place-photo.
    coverImageUrl:
      'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos/ChIJYXXbqgvIt4kRsTOXeP0bXTA/0.jpg',
    coverHue: 200,
    ticketUrl: '#',
    onMingla: true,
    kind: 'Festival',
  },
] as const
