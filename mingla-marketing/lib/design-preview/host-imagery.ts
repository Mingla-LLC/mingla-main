// ---------------------------------------------------------------
// #4137 — provenance record for every photograph on /host.
//
// RULES (spec §5.1, blocking):
//   - NO place-pool or Google Places photos. The place pool downloads Google
//     Places Photos, which we have no licence to republish as marketing, and
//     those photos show real venues, which breaks "no host names or brands".
//     The first mockup used exactly such photos; none of them ship.
//   - NO AI-generated images (Seth rejected the "grey AI rooms").
//   - NO image showing a brand, logo, readable sign, flyer, menu or a host.
//   - Files live in public/marketing/host/ and go through next/image. Never
//     Supabase storage or /render/image (spend-cap hold #1643).
//
// Every slot in spec §5.2 appears here exactly once. Seth supplied the source
// photos for this phase and they were checked and cropped on #4137. Licence
// evidence is kept privately by Seth, never in this public repo, so the
// reference here is the placeholder `supplied-by-seth` until he records one.
//
// Decorative images (hero wall, builder demo, Start hosting) carry `alt: ''`.
// No caption or credit text is ever rendered for these photos.
// ---------------------------------------------------------------

export type HostImageSource = 'envato' | 'mingla_owned' | 'seth_supplied'

export interface HostImage {
  /** Spec §5.2 slot, e.g. `H1`, `C3-desktop`, `T2`. */
  slot: string
  /** Public path under /marketing/host/. */
  file: string
  width: number
  height: number
  alt: string
  source: HostImageSource
  /** Envato item URL, shoot id, or `supplied-by-seth`. */
  sourceRef: string
}

const SETH = { source: 'seth_supplied', sourceRef: 'supplied-by-seth' } as const

function img(slot: string, name: string, width: number, height: number, alt = ''): HostImage {
  return { slot, file: `/marketing/host/${name}.jpg`, width, height, alt, ...SETH }
}

export const HOST_IMAGERY: readonly HostImage[] = [
  img('H1', 'hero-1', 1600, 1200),
  img('H2', 'hero-2', 1600, 1200),
  img('H3', 'hero-3', 1600, 1200),
  img('H4', 'hero-4', 1600, 1200),
  img('H5', 'hero-5', 1600, 1200),
  img('H6', 'hero-6', 1600, 1200),
  img('C1-desktop', 'card-event-organizers-promoters-desktop', 1000, 1250, 'A crowd dancing at a live event under stage lights'),
  img('C1-phone', 'card-event-organizers-promoters-phone', 1200, 800, 'A crowd dancing at a live event under stage lights'),
  img('C2-desktop', 'card-restaurants-cafes-desktop', 1000, 1250, 'Friends sharing dishes in a busy restaurant'),
  img('C2-phone', 'card-restaurants-cafes-phone', 1200, 800, 'Friends sharing dishes in a busy restaurant'),
  img('C3-desktop', 'card-bars-clubs-nightlife-desktop', 1000, 1250, 'People on a dance floor at a bar at night'),
  img('C3-phone', 'card-bars-clubs-nightlife-phone', 1200, 800, 'People on a dance floor at a bar at night'),
  img('C4-desktop', 'card-venues-activity-spaces-desktop', 1000, 1250, 'A bright event space with people gathering'),
  img('C4-phone', 'card-venues-activity-spaces-phone', 1200, 800, 'A bright event space with people gathering'),
  img('C5-desktop', 'card-resorts-hotels-retreats-desktop', 1000, 1250, 'Guests relaxing on a resort terrace at sunset'),
  img('C5-phone', 'card-resorts-hotels-retreats-phone', 1200, 800, 'Guests relaxing on a resort terrace at sunset'),
  img('C6-desktop', 'card-tours-experiences-adventures-desktop', 1000, 1250, 'A small group on a guided walk outdoors'),
  img('C6-phone', 'card-tours-experiences-adventures-phone', 1200, 800, 'A small group on a guided walk outdoors'),
  img('C7-desktop', 'card-pop-ups-independent-creators-desktop', 1000, 1250, 'Visitors browsing a pop-up market stall'),
  img('C7-phone', 'card-pop-ups-independent-creators-phone', 1200, 800, 'Visitors browsing a pop-up market stall'),
  img('T1', 'tool-events', 600, 600, 'A bar ready for a busy night'),
  img('T2', 'tool-trips', 1200, 800, 'Friends arriving on a group trip'),
  img('T3', 'tool-venue', 1200, 400, 'A restaurant floor laid for the evening'),
  img('T4', 'tool-marketing', 400, 300, 'Drinks on a table, shown in an email preview'),
  img('B1', 'builder-hero', 1200, 430),
  img('B2', 'builder-menu-1', 480, 360),
  img('B3', 'builder-menu-2', 480, 360),
  img('B4', 'builder-menu-3', 480, 360),
  img('P1', 'start-1', 900, 1200),
  img('P2', 'start-2', 900, 1200),
  img('P3', 'start-3', 900, 1200),
]

/** Look up a slot. Throws on a typo so a missing image fails the build, not the page. */
export function hostImage(slot: string): HostImage {
  const found = HOST_IMAGERY.find((image) => image.slot === slot)
  if (!found) throw new Error(`#4137 host-imagery: unknown slot ${slot}`)
  return found
}
