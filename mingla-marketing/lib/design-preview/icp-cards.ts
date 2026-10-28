// ---------------------------------------------------------------
// #2902 — the seven Host ICPs, as expanding cards.
//
// IMAGERY (#4137). Full-colour photographs of people in the moment, one
// art-directed pair per card: a 4:5 crop for the desktop strip and a 3:2 crop
// for the stacked phone row. They replace the generated, empty, greyscale rooms
// Seth rejected. Provenance for every file lives in host-imagery.ts (no
// place-pool, Google or AI images). Titles, labels and descriptions are
// unchanged.
// ---------------------------------------------------------------

import { hostImage, type HostImage } from './host-imagery'

export interface IcpCard {
  id: string
  /** Expanded heading — who this is for. */
  title: string
  /**
   * Collapsed pill — ONE word, horizontal. The rotated sentence it replaces
   * was hard to read, had no room at the foot of the card, and forced the
   * collapsed rail narrower than a phone can use.
   */
  usp: string
  description: string
  /** #4137: art-directed pair, sources in host-imagery.ts (C1–C7). */
  imgSrc: { desktop: HostImage; phone: HostImage }
}

export const ICP_CARDS: readonly IcpCard[] = [
  {
    id: 'event-organizers-promoters',
    title: 'Events & promoters',
    usp: 'Events',
    description: 'Build the page, price the tiers, work the door, and keep the guest list.',
    imgSrc: { desktop: hostImage('C1-desktop'), phone: hostImage('C1-phone') },
  },
  {
    id: 'restaurants-cafes',
    title: 'Restaurants & cafés',
    usp: 'Restaurants',
    description: 'Turn a menu and a slow Tuesday into a plan people book ahead.',
    imgSrc: { desktop: hostImage('C2-desktop'), phone: hostImage('C2-phone') },
  },
  {
    id: 'bars-clubs-nightlife',
    title: 'Bars & nightlife',
    usp: 'Clubs',
    description: 'Tickets, tables and guest lists for the nights people talk about.',
    imgSrc: { desktop: hostImage('C3-desktop'), phone: hostImage('C3-phone') },
  },
  {
    id: 'venues-activity-spaces',
    title: 'Venues & spaces',
    usp: 'Venues',
    description: 'Show what the space does, take the booking, manage the calendar.',
    imgSrc: { desktop: hostImage('C4-desktop'), phone: hostImage('C4-phone') },
  },
  {
    id: 'resorts-hotels-retreats',
    title: 'Resorts & hotels',
    usp: 'Stays',
    description: 'Stays, day passes and packages, with the local plan attached.',
    imgSrc: { desktop: hostImage('C5-desktop'), phone: hostImage('C5-phone') },
  },
  {
    id: 'tours-experiences-adventures',
    title: 'Tours & experiences',
    usp: 'Trips',
    description: 'Itinerary, inclusions, meeting point and payment in one page.',
    imgSrc: { desktop: hostImage('C6-desktop'), phone: hostImage('C6-phone') },
  },
  {
    id: 'pop-ups-independent-creators',
    title: 'Pop-ups & creators',
    usp: 'Pop Ups',
    description: 'A page, a drop and a sell-out window, spun up in minutes.',
    imgSrc: { desktop: hostImage('C7-desktop'), phone: hostImage('C7-phone') },
  },
]
