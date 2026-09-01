// ---------------------------------------------------------------
// #2902 — the seven Host ICPs, as expanding cards.
//
// IMAGERY. Seth asked for high-production generated shots of SETTINGS with no
// people — an event room, a restaurant, a club, a creative space, a resort, a
// tour, a pop-up. Image generation is not available in this session (the
// Higgsfield connector is unauthenticated), so these are interim stand-ins
// chosen against exactly that brief from Mingla's OWN Lagos place-pool
// photography: every frame below was visually checked and every one is a
// setting with no people in it.
//
// They are unlabelled texture, not claims — no venue is named on a card, so
// none is implied to be a Mingla customer of that category. The production
// brief still stands and is recorded at the bottom of this file.
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
    // An empty event hall, dressed and lit. No people.
    imgSrc: `${PHOTO}/ChIJz72BGjX1OxARtPYos1wBSkc/1.jpg`,
    href: '/cutout/host/event-organizers-promoters',
  },
  {
    id: 'restaurants-cafes',
    title: 'Restaurants & cafés',
    usp: 'Fill the quiet nights',
    description: 'Turn a menu and a slow Tuesday into a plan people book ahead.',
    // A dim dining room, tables laid, empty.
    imgSrc: `${PHOTO}/ChIJf37Oqy31OxAR9MFFkjaEvCE/3.jpg`,
    href: '/cutout/host/restaurants-cafes',
  },
  {
    id: 'bars-clubs-nightlife',
    title: 'Bars & nightlife',
    usp: 'Own the weekend',
    description: 'Tickets, tables and guest lists for the nights people talk about.',
    // A lit club floor before doors. No crowd.
    imgSrc: `${PHOTO}/ChIJWXCqRVv0OxARuk8b-Can8bU/2.jpg`,
    href: '/cutout/host/bars-clubs-nightlife',
  },
  {
    id: 'venues-activity-spaces',
    title: 'Venues & spaces',
    usp: 'Book out the room',
    description: 'Show what the space does, take the booking, manage the calendar.',
    // An indoor activity space, set up and empty.
    imgSrc: `${PHOTO}/ChIJ7f0vkunvOxARAErwKGQjeM0/3.jpg`,
    href: '/cutout/host/venues-activity-spaces',
  },
  {
    id: 'resorts-hotels-retreats',
    title: 'Resorts & hotels',
    usp: 'Sell the whole stay',
    description: 'Stays, day passes and packages, with the local plan attached.',
    // Waterfront at dusk. No people.
    imgSrc: `${PHOTO}/ChIJ4dejO_z0OxARubQD0vzbqiU/2.jpg`,
    href: '/cutout/host/resorts-hotels-retreats',
  },
  {
    id: 'tours-experiences-adventures',
    title: 'Tours & experiences',
    usp: 'Turn a day into a booking',
    description: 'Itinerary, inclusions, meeting point and payment in one page.',
    // A forest walkway. No people.
    imgSrc: `${PHOTO}/ChIJnfWgLfn2OxARZjghHw4IIMA/1.jpg`,
    href: '/cutout/host/tours-experiences-adventures',
  },
  {
    id: 'pop-ups-independent-creators',
    title: 'Pop-ups & creators',
    usp: 'Live before the moment passes',
    description: 'A page, a drop and a sell-out window, spun up in minutes.',
    // A gallery wall. Creative space, no people.
    imgSrc: `${PHOTO}/ChIJecHJJP_0OxARsqN_e4LH4rQ/0.jpg`,
    href: '/cutout/host/pop-ups-independent-creators',
  },
]

/**
 * PRODUCTION ASSET BRIEF — still outstanding.
 *
 * Seven original landscape frames, 2400px on the long edge, one per card:
 * an event room dressed for a night; a restaurant room laid and empty; a club
 * floor lit before doors; an activity space set up; a resort terrace or pool at
 * golden hour; a trail, boat or viewpoint on a tour; a pop-up stall or market
 * stand. Settings only — NO PEOPLE, no legible signage, no readable branding.
 * Owned or licensed with the receipt retained.
 */
