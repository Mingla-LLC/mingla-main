// ---------------------------------------------------------------
// #2902 — the seven Host ICPs, as expanding cards.
//
// IMAGERY — settings, no people. Every frame below was viewed on a contact
// sheet before selection; none contains a person.
//
// GENERATION WAS NOT POSSIBLE. There is no image-generation tool in this
// session: no Magnific CLI, no Magnific MCP, no credentials. The Higgsfield
// route is retired outright by the cinematic-ad-director policy and must not
// be used, which also makes my earlier suggestion to authorise it wrong.
//
// So the source model follows that skill's DEFAULT: licensed Envato stock
// first, Mingla's own media where it is strong.
//
//   S  four frames from Envato items already licensed and on disk. Each is a
//      still extracted from licensed FOOTAGE — see the licence note below.
//   U  three frames from Mingla's own Lagos place pool.
//
// No card is labelled with a venue name, so nothing implies a given business
// is a Mingla customer of that category.
//
// ⚠ LICENCE CHECK FOR SETH. The four `S` frames are stills pulled from Envato
// VIDEO items you have already licensed, not from stock photos. Envato's
// licence covers use of the item within an end product, and a frame is a
// derivative of that item — but it is your licence, so confirm it before this
// ships. If you would rather not, the fallback is to license four equivalent
// PHOTOS; the acquisition brief at the foot of this file specifies them.
// ---------------------------------------------------------------

const PHOTO = 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-photos'

export interface IcpCard {
  id: string
  /** Expanded heading — who this is for. */
  title: string
  /** Collapsed rail — what they get. The USP, not the category name. */
  usp: string
  description: string
  imgSrc: string
  href: string
}

export const ICP_CARDS: readonly IcpCard[] = [
  {
    id: 'event-organizers-promoters',
    title: 'Events & promoters',
    usp: 'Sell out the night',
    description: 'Build the page, price the tiers, work the door, and keep the guest list.',
    // S — Envato: an empty theatre auditorium, house lights up. No people.
    imgSrc: '/marketing/host-icp/events-theatre.jpg',
    href: '/cutout/host/event-organizers-promoters',
  },
  {
    id: 'restaurants-cafes',
    title: 'Restaurants & cafés',
    usp: 'Fill the quiet nights',
    description: 'Turn a menu and a slow Tuesday into a plan people book ahead.',
    // S — Envato: a laid fine-dining table. No people.
    imgSrc: '/marketing/host-icp/restaurants-table.jpg',
    href: '/cutout/host/restaurants-cafes',
  },
  {
    id: 'bars-clubs-nightlife',
    title: 'Bars & nightlife',
    usp: 'Own the weekend',
    description: 'Tickets, tables and guest lists for the nights people talk about.',
    // U — Mingla place pool: a lit club floor before doors. No crowd.
    imgSrc: `${PHOTO}/ChIJWXCqRVv0OxARuk8b-Can8bU/2.jpg`,
    href: '/cutout/host/bars-clubs-nightlife',
  },
  {
    id: 'venues-activity-spaces',
    title: 'Venues & spaces',
    usp: 'Book out the room',
    description: 'Show what the space does, take the booking, manage the calendar.',
    // U — Mingla place pool: an indoor activity space, set up and empty.
    imgSrc: `${PHOTO}/ChIJ7f0vkunvOxARAErwKGQjeM0/3.jpg`,
    href: '/cutout/host/venues-activity-spaces',
  },
  {
    id: 'resorts-hotels-retreats',
    title: 'Resorts & hotels',
    usp: 'Sell the whole stay',
    description: 'Stays, day passes and packages, with the local plan attached.',
    // U — Mingla place pool: waterfront at dusk. No people.
    imgSrc: `${PHOTO}/ChIJ4dejO_z0OxARubQD0vzbqiU/2.jpg`,
    href: '/cutout/host/resorts-hotels-retreats',
  },
  {
    id: 'tours-experiences-adventures',
    title: 'Tours & experiences',
    usp: 'Turn a day into a booking',
    description: 'Itinerary, inclusions, meeting point and payment in one page.',
    // S — Envato: open water from the bow, tropical island ahead. No people.
    imgSrc: '/marketing/host-icp/tours-water.jpg',
    href: '/cutout/host/tours-experiences-adventures',
  },
  {
    id: 'pop-ups-independent-creators',
    title: 'Pop-ups & creators',
    usp: 'Live before the moment passes',
    description: 'A page, a drop and a sell-out window, spun up in minutes.',
    // S — Envato: a gallery interior hung with work. No people.
    imgSrc: '/marketing/host-icp/creators-gallery.jpg',
    href: '/cutout/host/pop-ups-independent-creators',
  },
]

/**
 * ENVATO ACQUISITION BRIEF — the remaining gaps.
 *
 * Two slots have no people-free licensed frame on disk and are still using
 * Mingla place-pool imagery. If you want licensed stock in those slots,
 * these are the searches:
 *
 *  BARS & NIGHTLIFE
 *    primary   "empty nightclub interior neon lights no people"
 *    alternate "bar counter at night moody lighting empty"
 *    require   interior, wide or 3/4, lit for the night, bottles or stage
 *              visible, NO people, no legible signage
 *
 *  RESORTS & HOTELS
 *    primary   "empty resort pool terrace golden hour no people"
 *    alternate "hotel terrace sunset loungers empty"
 *    require   exterior, wide, warm low sun, water or terrace, NO people,
 *              no legible branding
 *
 * Technical target for both: landscape, ≥2400px on the long edge, JPEG,
 * colour-consistent with the four frames already in
 * public/marketing/host-icp/. Record the Envato URL, licence/download
 * reference and final filename alongside the file.
 *
 * If the video-frame licence question above resolves the other way, the same
 * format applies to replacing the four `S` frames with equivalent photos:
 *   events      "empty theatre auditorium seats house lights"
 *   restaurants "fine dining table setting empty restaurant"
 *   tours       "kayak bow tropical water island horizon"
 *   creators    "art gallery interior paintings sculptures empty"
 */
