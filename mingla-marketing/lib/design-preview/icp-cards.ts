// ---------------------------------------------------------------
// #2902 — the seven Host ICPs, as expanding cards.
//
// IMAGERY — generated, settings only, no people.
//
// All seven frames were generated with Freepik Mystic using Seth's Magnific /
// Freepik key, then reviewed on a contact sheet before selection. Every frame
// is an empty setting: no people, no legible signage, no readable branding.
//
// A CORRECTION WORTH KEEPING. Twice I told Seth generation was impossible here
// — first pointing at Higgsfield (which the cinematic-ad-director policy
// RETIRES outright), then concluding no generator existed at all. Both were
// wrong. The master-keys doc files this key under "Magnific (AI image
// upscaling)", which is what I took at face value; the key in fact
// authenticates against Freepik Mystic, a text-to-image generator, and that
// only surfaced when the endpoint was actually called. The doc is stale.
//
// ai_generated = TRUE for every frame below, per the skill's disclosure rule.
// They are illustrative settings — no card is labelled with a venue name, and
// nothing here depicts or claims a real place.
//
// Prompt spine shared by all seven: cinematic wide interior photograph, high
// production commercial photography, warm natural colour grade, soft golden
// light, shallow depth of field, completely empty with no people, no text, no
// signage, no logos, no watermark. Generated 4:3 at 2k, downsized to 1600px
// JPEG q78 for the web — the full set is 2.5MB, which matters on a page whose
// Core Web Vitals this issue exists to fix.

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
    // An empty event hall, stage rigged and lit, before doors.
    imgSrc: '/marketing/host-icp/events-hall.jpg',
    href: '/cutout/host/event-organizers-promoters',
  },
  {
    id: 'restaurants-cafes',
    title: 'Restaurants & cafés',
    usp: 'Fill the quiet nights',
    description: 'Turn a menu and a slow Tuesday into a plan people book ahead.',
    // A dining room laid for service at golden hour.
    imgSrc: '/marketing/host-icp/restaurants-room.jpg',
    href: '/cutout/host/restaurants-cafes',
  },
  {
    id: 'bars-clubs-nightlife',
    title: 'Bars & nightlife',
    usp: 'Own the weekend',
    description: 'Tickets, tables and guest lists for the nights people talk about.',
    // A bar room at night, bottle shelf lit, before the crowd.
    imgSrc: '/marketing/host-icp/nightlife-bar.jpg',
    href: '/cutout/host/bars-clubs-nightlife',
  },
  {
    id: 'venues-activity-spaces',
    title: 'Venues & spaces',
    usp: 'Book out the room',
    description: 'Show what the space does, take the booking, manage the calendar.',
    // A high-ceilinged event space, chairs set aside, light pouring in.
    imgSrc: '/marketing/host-icp/venues-space.jpg',
    href: '/cutout/host/venues-activity-spaces',
  },
  {
    id: 'resorts-hotels-retreats',
    title: 'Resorts & hotels',
    usp: 'Sell the whole stay',
    description: 'Stays, day passes and packages, with the local plan attached.',
    // A resort pool terrace at golden hour.
    imgSrc: '/marketing/host-icp/resorts-terrace.jpg',
    href: '/cutout/host/resorts-hotels-retreats',
  },
  {
    id: 'tours-experiences-adventures',
    title: 'Tours & experiences',
    usp: 'Turn a day into a booking',
    description: 'Itinerary, inclusions, meeting point and payment in one page.',
    // A boardwalk trail through forest, morning light.
    imgSrc: '/marketing/host-icp/tours-trail.jpg',
    href: '/cutout/host/tours-experiences-adventures',
  },
  {
    id: 'pop-ups-independent-creators',
    title: 'Pop-ups & creators',
    usp: 'Live before the moment passes',
    description: 'A page, a drop and a sell-out window, spun up in minutes.',
    // A pop-up gallery and market room, work hung, tables set.
    imgSrc: '/marketing/host-icp/creators-popup.jpg',
    href: '/cutout/host/pop-ups-independent-creators',
  },
]

/**
 * ASSET RECORD.
 *
 * Source     Freepik Mystic (Magnific / Freepik key from MINGLA_MASTER_KEYS.md)
 * Model      mystic, aspect_ratio classic_4_3, resolution 2k
 * Delivered  1600px JPEG q78, public/marketing/host-icp/
 * Disclosure ai_generated = true. Materially synthetic visuals, per the
 *            cinematic-ad-director rule. They depict no real place and no card
 *            names a venue.
 * Reviewed   all seven viewed on a contact sheet before selection; each is an
 *            empty setting with no people, no signage and no readable text.
 *
 * The master-keys doc still describes this key as "Magnific (AI image
 * upscaling)". That is stale — it authenticates against Freepik Mystic and
 * generates. Worth correcting in the doc so the next person does not conclude,
 * as I did, that generation was unavailable.
 */