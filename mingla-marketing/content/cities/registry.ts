import type { RouteLifecycle } from '@/lib/search/route-registry'

export interface CityEvidenceSource {
  readonly id: string
  readonly publisher: string
  readonly title: string
  readonly href: string
  readonly supports: string
  readonly checkedAt: `${number}-${number}-${number}`
  readonly verifiedAt: `${number}-${number}-${number}`
  readonly verifiedBy: 'Mingla content research'
  readonly nextReviewAt: `${number}-${number}-${number}`
  readonly expiresAt: `${number}-${number}-${number}`
}

export interface CityUtilityRecord {
  readonly title: string
  readonly answer: string
  readonly evidenceIds: readonly string[]
}

export interface CityAudienceEntry {
  readonly title: string
  readonly body: string
  readonly cta: string
  readonly evidenceIds: readonly string[]
}

export interface CityFaqRecord {
  readonly question: string
  readonly answer: string
  readonly evidenceIds: readonly string[]
}

export interface CityHostUtilityRecord {
  readonly title: string
  readonly body: string
  readonly evidenceIds: readonly string[]
}

export interface CityHubRecord {
  readonly slug: string
  readonly city: string
  readonly country: string
  readonly countryCode: string
  readonly locale: string
  readonly timezone: string
  readonly currency: string
  readonly marketingDeckCenter?: Readonly<{ lat: number; lng: number }>
  readonly lifecycle: Extract<RouteLifecycle, 'public_noindex' | 'search_ready' | 'stale' | 'expired_archived'>
  readonly wasSearchReady: boolean
  readonly scopeLabel: string
  readonly jurisdictionScope: string
  readonly scopeApproval: 'approved' | 'founder_pending'
  readonly placeSchemaType: 'City' | 'AdministrativeArea'
  readonly directAnswer: string
  readonly utilityHeading: string
  readonly utilitySections: readonly [CityUtilityRecord, CityUtilityRecord, CityUtilityRecord]
  readonly explorer: CityAudienceEntry
  readonly host: CityAudienceEntry
  readonly hostUtilities: readonly [CityHostUtilityRecord, CityHostUtilityRecord]
  readonly faqs: readonly [CityFaqRecord, CityFaqRecord, CityFaqRecord]
  readonly sources: readonly CityEvidenceSource[]
  readonly sourcesCheckedAt: `${number}-${number}-${number}`
  readonly nextReviewAt: `${number}-${number}-${number}`
  readonly localReview:
    | Readonly<{ status: 'pending' }>
    | Readonly<{ status: 'reviewed'; name: string; relationship: string; reviewedAt: `${number}-${number}-${number}` }>
  readonly media: readonly Readonly<{
    src: string
    alt: string
    owner: string
    photographer?: string
    commercialRights: true
    expiresAt: `${number}-${number}-${number}`
  }>[]
  readonly inventory: readonly Readonly<{ title: string; href: string; lifecycle: 'search_ready' }>[]
}

const CHECKED_AT = '2026-09-03' as const
const NEXT_REVIEW_AT = '2027-03-02' as const

function source(
  id: string,
  publisher: string,
  title: string,
  href: string,
  supports: string,
): CityEvidenceSource {
  return {
    id, publisher, title, href, supports, checkedAt: CHECKED_AT,
    verifiedAt: CHECKED_AT,
    verifiedBy: 'Mingla content research',
    nextReviewAt: NEXT_REVIEW_AT,
    expiresAt: NEXT_REVIEW_AT,
  }
}

export const CITY_HUBS = [
  {
    slug: 'lagos', city: 'Lagos', country: 'Nigeria', countryCode: 'NG', locale: 'en-NG', timezone: 'Africa/Lagos', currency: 'NGN', marketingDeckCenter: { lat: 6.6137395, lng: 3.3552568 },
    lifecycle: 'public_noindex', wasSearchReady: false, scopeLabel: 'Lagos State',
    jurisdictionScope: 'Recommended editorial inclusion area: Lagos State. Founder approval and an authoritative boundary record are still required before indexing.',
    scopeApproval: 'founder_pending', placeSchemaType: 'AdministrativeArea',
    directAnswer: 'Lagos plans work better when the outing and the journey are chosen together. Mingla helps you shape a culture stop, waterside day, food plan, music night or event only after its exact area, timing, entry and return route are clear—and helps Hosts publish those details in one place.',
    utilityHeading: 'Make the Lagos plan work from start to return.',
    utilitySections: [
      { title: 'Decide which Lagos you mean.', answer: '“Lagos” can hide a long journey. Start with the exact locality and address, then keep every stop inside the launch boundary shown on this page. A state, transport network or venue label is not a substitute for a meeting point.', evidenceIds: ['LAG-SCOPE-01'] },
      { title: 'Make the return part of the plan.', answer: 'Before the group commits, check the current rail or bus information from LAMATA and write down how people will arrive, meet and get back. Mingla should never freeze a route or timetable into evergreen copy.', evidenceIds: ['LAG-MOVE-01'] },
      { title: 'Let the organiser own the live facts.', answer: 'Lagos State tourism notices can surface an idea, but the named organiser or venue must confirm the date, entry action, price, access and status. Save that primary link with the plan.', evidenceIds: ['LAG-CULT-01', 'LAG-EVENT-01'] },
    ],
    explorer: { title: 'Turn the outing into one plan.', body: 'Pick the mood, compare places by the area and journey that work for your people, then save and share the plan before the group chat starts another committee meeting.', cta: 'Explore Lagos in Mingla', evidenceIds: ['LAG-SCOPE-01', 'LAG-MOVE-01'] },
    host: { title: 'Give people a reason to cross Lagos for it.', body: 'Publish the exact locality, what the experience feels like, when to arrive, how entry works and what guests should know—then connect the supported ticket, RSVP or booking action.', cta: 'Host in Lagos', evidenceIds: ['LAG-SCOPE-01', 'LAG-EVENT-01'] },
    hostUtilities: [
      { title: 'Publish one complete invitation', body: 'Name the exact locality and official venue, describe what the experience feels like, and give guests the current timing, arrival notes and supported join action. Keep the locality inside the approved page scope so the invitation never asks a guest to infer which “Lagos” the Host means.', evidenceIds: ['LAG-SCOPE-01', 'LAG-EVENT-01'] },
      { title: 'Keep live facts with their owners', body: 'Link guests to the current organiser or venue page for entry details and status, and to LAMATA when transport information matters. Mingla can carry the public invitation and supported booking, RSVP or ticket action; it does not replace the responsible authority, venue rules or organiser obligations.', evidenceIds: ['LAG-EVENT-01', 'LAG-MOVE-01'] },
    ],
    faqs: [
      { question: 'What area does this Lagos guide cover?', answer: 'The recommended first scope is Lagos State, shown clearly on the page. Final scope needs founder approval before search indexing.', evidenceIds: ['LAG-SCOPE-01'] },
      { question: 'Does Mingla guarantee Lagos event or transport information?', answer: 'No. Time-sensitive details come from the current organiser, venue or LAMATA source and carry their own checked date.', evidenceIds: ['LAG-MOVE-01', 'LAG-EVENT-01'] },
      { question: 'Can a venue or promoter publish on Mingla?', answer: 'Yes. A Host can present the experience and supported join action; Mingla does not replace permits, venue rules or organiser obligations.', evidenceIds: ['LAG-EVENT-01'] },
    ],
    sources: [
      source('LAG-SCOPE-01', 'Lagos State Government', 'Official state identity and tourism and culture notices', 'https://lagosstate.gov.ng/', 'Lagos State identity and the proposed coverage label'),
      source('LAG-CULT-01', 'Lagos State', 'Lagos Resilience Strategy', 'https://lasbca.lagosstate.gov.ng/wp-content/uploads/2021/05/Lagos_Resilience_Strategy.pdf', 'State, metropolitan and cultural context'),
      source('LAG-MOVE-01', 'Lagos Metropolitan Area Transport Authority', 'Current transport owner and service links', 'https://www.lamata-ng.com/', 'Live transport planning ownership'),
      source('LAG-EVENT-01', 'Lagos State Ministry of Tourism, Arts & Culture', 'Official ministry channel', 'https://tourismartandculture.lagosstate.gov.ng/', 'Event discovery and organiser verification context'),
    ],
    sourcesCheckedAt: CHECKED_AT, nextReviewAt: NEXT_REVIEW_AT, localReview: { status: 'pending' }, media: [], inventory: [],
  },
  {
    slug: 'durham-nc', city: 'Durham', country: 'United States', countryCode: 'US', locale: 'en-US', timezone: 'America/New_York', currency: 'USD',
    lifecycle: 'public_noindex', wasSearchReady: false, scopeLabel: 'City of Durham corporate limits', jurisdictionScope: 'City of Durham corporate limits; Durham County and any combined regional identity are excluded.', scopeApproval: 'approved', placeSchemaType: 'City',
    directAnswer: 'Durham gives you several different kinds of day without leaving its own identity behind: performance, sport, campus culture, public art and parks. Mingla helps you choose the occasion first, verify the current event and journey, and turn the pieces into a plan your people can actually use.',
    utilityHeading: 'Build a Bull City day around a real anchor.',
    utilitySections: [
      { title: 'Choose the Durham anchor before the category.', answer: 'The City’s own visitor page points to Durham Performing Arts Center, Durham Bulls Athletic Park, the Nasher Museum at Duke, city parks and annual festivals. Start with the kind of day—show, game, museum, festival or park—then verify the named institution’s current details.', evidenceIds: ['DUR-CULT-01'] },
      { title: 'Keep Durham city and county truth separate.', answer: 'A Durham postal address or Discover Durham listing does not by itself prove a stop is inside the City of Durham. Check the current corporate-limit source before a place becomes city inventory.', evidenceIds: ['DUR-BOUND-01', 'DUR-EVENT-01'] },
      { title: 'Plan the bus and the event from live owners.', answer: 'Use GoDurham for current maps and schedules. Use Discover Durham or the City calendar to discover an event, then confirm date, venue, entry and status with the organiser.', evidenceIds: ['DUR-MOVE-01', 'DUR-EVENT-01', 'DUR-EVENT-02'] },
    ],
    explorer: { title: 'Build a Bull City day that fits your people.', body: 'Start with a show, game, museum, festival or park; check the real time and journey; then save the plan and send one useful link.', cta: 'Explore Durham in Mingla', evidenceIds: ['DUR-CULT-01', 'DUR-MOVE-01'] },
    host: { title: 'Make the Durham experience easy to understand and join.', body: 'Show the format, exact venue, audience, time and entry action. If the event may draw visitors, keep its organiser-owned page current alongside any City or Discover Durham submission.', cta: 'Host in Durham', evidenceIds: ['DUR-EVENT-01', 'DUR-EVENT-02'] },
    hostUtilities: [
      { title: 'Make the Durham experience easy to join', body: 'State the format, exact venue, intended audience, current time and single entry action. Keep the organiser-owned page current alongside any City of Durham or Discover Durham listing, so a guest can move from discovery to the responsible source without guessing which detail controls.', evidenceIds: ['DUR-EVENT-01', 'DUR-EVENT-02'] },
      { title: 'Keep city, event and journey facts separate', body: 'Confirm that the venue sits inside Durham city limits, let the organiser or venue own the live date and entry status, and direct guests to GoDurham for current travel information. Each source answers a different practical question; the Mingla invitation should connect them clearly.', evidenceIds: ['DUR-BOUND-01', 'DUR-EVENT-01', 'DUR-MOVE-01'] },
    ],
    faqs: [
      { question: 'Is this a Durham County guide?', answer: 'No. The route covers the City of Durham corporate limits.', evidenceIds: ['DUR-BOUND-01'] },
      { question: 'Where are current Durham events checked?', answer: 'City and Discover Durham calendars are discovery sources; the organiser or venue owns the final date, entry and status.', evidenceIds: ['DUR-EVENT-01', 'DUR-EVENT-02'] },
      { question: 'How should I plan local transport?', answer: 'Check GoDurham’s current map, schedule and service information for the exact day of the plan.', evidenceIds: ['DUR-MOVE-01'] },
    ],
    sources: [
      source('DUR-BOUND-01', 'City of Durham Public Works GIS', 'Annexations and City Limits', 'https://webgis2.durhamnc.gov/portal/home/item.html?id=e27c6d7d587b4cd2bdae8181a6a53ae1', 'Durham corporate-limit checks'),
      source('DUR-CULT-01', 'City of Durham', 'Things to Do in Durham', 'https://www.durhamnc.gov/35/Things-to-Do-in-Durham', 'City-owned visitor and cultural context'),
      source('DUR-EVENT-01', 'Discover Durham', 'Events', 'https://www.discoverdurham.com/events/', 'Event discovery candidates'),
      source('DUR-EVENT-02', 'City of Durham', 'Calendar', 'https://www.durhamnc.gov/Calendar.aspx', 'City event discovery candidates'),
      source('DUR-MOVE-01', 'GoDurham', 'Maps and Schedules', 'https://godurhamtransit.org/maps-and-schedules/', 'Live local transport planning'),
    ], sourcesCheckedAt: CHECKED_AT, nextReviewAt: NEXT_REVIEW_AT, localReview: { status: 'pending' }, media: [], inventory: [],
  },
  {
    slug: 'cary-nc', city: 'Cary', country: 'United States', countryCode: 'US', locale: 'en-US', timezone: 'America/New_York', currency: 'USD',
    lifecycle: 'public_noindex', wasSearchReady: false, scopeLabel: 'Town of Cary corporate limits', jurisdictionScope: 'Town of Cary corporate limits; Raleigh, Wake County and a combined regional identity are excluded.', scopeApproval: 'approved', placeSchemaType: 'City',
    directAnswer: 'Cary is strongest as its own town plan: a downtown park, town arts spaces, greenways, classes, concerts and community events that can fit an easy afternoon or evening. Mingla helps you choose the pace, confirm the Town or venue details, and share a plan without turning Cary into “near Raleigh.”',
    utilityHeading: 'Use Cary’s own places, pace and practical details.',
    utilitySections: [
      { title: 'Start with Cary’s town-run places.', answer: 'Downtown Cary Park, Cary Arts Center, The Cary Theater, Page-Walker Arts & History Center, Bond Park and the Town’s cultural programmes create distinct starting points for a park day, class, film, performance or festival. Check the owning facility for current details.', evidenceIds: ['CARY-CULT-01', 'CARY-CULT-02'] },
      { title: 'Use the corporate line, not the marketing region.', answer: 'Cary has its own official corporate-limits data. A Wake County or Visit Raleigh listing must be inside that boundary before it becomes Cary inventory.', evidenceIds: ['CARY-BOUND-01'] },
      { title: 'Check the Town calendar and the practical action.', answer: 'Use Cary’s calendar for municipal programmes and current events, then follow the named facility or organiser for registration, tickets, access and changes. Use GoCary for the current trip, not a copied timetable.', evidenceIds: ['CARY-EVENT-01', 'CARY-MOVE-01'] },
    ],
    explorer: { title: 'Pick the pace of the Cary plan.', body: 'Choose downtown, arts, a park, a class or a community event; confirm the current action; then save the route and bring the people who said “anything is fine.”', cta: 'Explore Cary in Mingla', evidenceIds: ['CARY-CULT-01', 'CARY-EVENT-01'] },
    host: { title: 'Turn a Cary programme or place into a clear invitation.', body: 'Publish the exact location, occasion, schedule and join action. Keep Town permits, venue rules and vendor approvals separate from the Mingla listing.', cta: 'Host in Cary', evidenceIds: ['CARY-EVENT-01'] },
    hostUtilities: [
      { title: 'Turn the Cary programme into a clear invitation', body: 'Publish the exact Cary location, occasion, current schedule and one supported join action. When a Town programme or facility is involved, connect the invitation to the current Town calendar and the owning facility, so guests can confirm the details at their responsible source.', evidenceIds: ['CARY-EVENT-01', 'CARY-CULT-01'] },
      { title: 'Separate publication from approval', body: 'A Mingla page can explain the experience and how a guest joins, but it does not grant a Town, facility or vendor approval. Keep those requirements with their responsible owners, and keep the listing inside Cary’s corporate boundary rather than folding it into a Raleigh or regional page.', evidenceIds: ['CARY-BOUND-01', 'CARY-CULT-01'] },
    ],
    faqs: [
      { question: 'Is Cary included inside the Raleigh page?', answer: 'No. Cary has its own route, corporate boundary, sources and editorial review.', evidenceIds: ['CARY-BOUND-01'] },
      { question: 'Where should I confirm a Cary programme or ticket?', answer: 'Use the current Town calendar, then the owning facility or authorised organiser page.', evidenceIds: ['CARY-EVENT-01'] },
      { question: 'Does publishing on Mingla approve an event in Cary?', answer: 'No. Town permits, facility approvals and vendor requirements still apply.', evidenceIds: ['CARY-EVENT-01'] },
    ],
    sources: [
      source('CARY-BOUND-01', 'Town of Cary Open Data', 'Cary Corporate Limits', 'https://data.townofcary.org/explore/assets/cary-corporate-limits/', 'Cary corporate-limit checks'),
      source('CARY-CULT-01', 'Town of Cary', 'Arts & Culture', 'https://www.carync.gov/recreation-enjoyment/arts-culture', 'Town cultural facilities and programmes'),
      source('CARY-CULT-02', 'Town of Cary', 'Downtown Cary Park', 'https://www.carync.gov/recreation-enjoyment/parks-greenways-environment/parks/downtown-park', 'Downtown Cary Park context'),
      source('CARY-EVENT-01', 'Town of Cary', 'Calendar', 'https://www.carync.gov/connect-engage/calendar', 'Current Town programmes and events'),
      source('CARY-MOVE-01', 'Town of Cary', 'GoCary', 'https://www.carync.gov/recreation-enjoyment/go-cary', 'Live local transport planning'),
    ], sourcesCheckedAt: CHECKED_AT, nextReviewAt: NEXT_REVIEW_AT, localReview: { status: 'pending' }, media: [], inventory: [],
  },
  {
    slug: 'raleigh-nc', city: 'Raleigh', country: 'United States', countryCode: 'US', locale: 'en-US', timezone: 'America/New_York', currency: 'USD', marketingDeckCenter: { lat: 35.7795897, lng: -78.6381787 },
    lifecycle: 'public_noindex', wasSearchReady: false, scopeLabel: 'Raleigh city limits', jurisdictionScope: 'Current City of Raleigh corporate limits; the ETJ and the rest of Wake County are excluded unless a record is proven inside the city.', scopeApproval: 'approved', placeSchemaType: 'City',
    directAnswer: 'Raleigh can move from a downtown square or gallery to a greenway, museum, park programme or live performance, but the useful plan is the one that names the exact place and journey. Mingla keeps Raleigh’s City sources, current event facts and the group’s next action together.',
    utilityHeading: 'Connect Raleigh culture to City limits and live facts.',
    utilitySections: [
      { title: 'Build from Raleigh’s public culture network.', answer: 'Raleigh Arts connects City calendars, galleries, public art and performing-arts venues; Moore Square and Dix Park publish their own programmes. Choose one anchor, then verify the facility’s current page instead of promising a permanent schedule.', evidenceIds: ['RAL-CULT-01', 'RAL-CULT-02', 'RAL-CULT-03'] },
      { title: 'Do not confuse Raleigh with Wake County.', answer: 'The City’s map distinguishes current city limits from the extraterritorial jurisdiction. Visit Raleigh is useful for discovery but covers Wake County, so every named stop needs a Raleigh boundary check.', evidenceIds: ['RAL-BOUND-01', 'RAL-EVENT-02'] },
      { title: 'Check the event and movement owners.', answer: 'Use the City calendar and named organiser for event truth, and GoRaleigh for current trip planning, routes and service notices.', evidenceIds: ['RAL-EVENT-01', 'RAL-MOVE-01'] },
    ],
    explorer: { title: 'Make Raleigh feel like a plan, not a list.', body: 'Choose the park, arts, performance or city event that fits the occasion; check the route and timing; then save and share one decision-ready plan.', cta: 'Explore Raleigh in Mingla', evidenceIds: ['RAL-CULT-01', 'RAL-MOVE-01'] },
    host: { title: 'Help Raleigh understand why it should show up.', body: 'Publish the audience, exact venue, timing, entry and guest details. For events using City streets, plazas or parks, keep the relevant City approval path outside Mingla and up to date.', cta: 'Host in Raleigh', evidenceIds: ['RAL-EVENT-01'] },
    hostUtilities: [
      { title: 'Give Raleigh one clear reason to show up', body: 'Lead with the intended audience and occasion, then state the exact venue, current timing, entry action and guest details. If a City or Visit Raleigh calendar helps people discover the event, keep the organiser or venue page as the source for final live facts.', evidenceIds: ['RAL-EVENT-01', 'RAL-EVENT-02'] },
      { title: 'Keep the City approval path outside Mingla', body: 'For an event using City streets, plazas or parks, keep the relevant City process and venue requirements current outside the public listing. Mingla helps a guest understand and join the experience; it does not replace the approval controlled by the City or venue.', evidenceIds: ['RAL-CULT-02', 'RAL-CULT-03', 'RAL-EVENT-01'] },
    ],
    faqs: [
      { question: 'Does this Raleigh page include all of Wake County?', answer: 'No. It covers verified records inside Raleigh city limits.', evidenceIds: ['RAL-BOUND-01'] },
      { question: 'Where are Raleigh events confirmed?', answer: 'The City or Visit Raleigh calendar may surface them; the named organiser or venue provides the final current facts.', evidenceIds: ['RAL-EVENT-01', 'RAL-EVENT-02'] },
      { question: 'Can Mingla replace a Raleigh special-event permit?', answer: 'No. Mingla helps people discover and join; the City and venue still control approvals.', evidenceIds: ['RAL-EVENT-01'] },
    ],
    sources: [
      source('RAL-BOUND-01', 'City of Raleigh', 'Map Gallery and City Limit Maps', 'https://raleighnc.gov/apps-maps-and-open-data/services/map-gallery', 'Raleigh city limits and Wake County separation'),
      source('RAL-CULT-01', 'City of Raleigh', 'Arts and Cultural Events', 'https://raleighnc.gov/arts/services/arts-and-cultural-events', 'City arts and cultural context'),
      source('RAL-CULT-02', 'City of Raleigh', 'Moore Square', 'https://raleighnc.gov/parks-and-recreation/places/moore-square', 'Moore Square programmes'),
      source('RAL-CULT-03', 'City of Raleigh', 'Dix Park', 'https://raleighnc.gov/parks-and-recreation/places/dix-park', 'Dix Park programmes'),
      source('RAL-EVENT-01', 'City of Raleigh', 'Events', 'https://raleighnc.gov/events/calendar', 'City event discovery'),
      source('RAL-EVENT-02', 'Greater Raleigh Convention and Visitors Bureau', 'Events', 'https://www.visitraleigh.com/events/', 'Wake County discovery with city-boundary verification'),
      source('RAL-MOVE-01', 'GoRaleigh', 'Official transit site', 'https://goraleigh.org/', 'Live local transport planning'),
    ], sourcesCheckedAt: CHECKED_AT, nextReviewAt: NEXT_REVIEW_AT, localReview: { status: 'pending' }, media: [], inventory: [],
  },
  {
    slug: 'new-york-city', city: 'New York City', country: 'United States', countryCode: 'US', locale: 'en-US', timezone: 'America/New_York', currency: 'USD',
    lifecycle: 'public_noindex', wasSearchReady: false, scopeLabel: 'New York City’s five boroughs', jurisdictionScope: 'The five boroughs of New York City; the wider New York metropolitan area is excluded.', scopeApproval: 'approved', placeSchemaType: 'City',
    directAnswer: 'In New York City, the borough and the journey are part of the plan. Mingla helps you choose the occasion, keep the venue in one of the five boroughs, check live event and MTA information, and share a plan that says more than “somewhere downtown.”',
    utilityHeading: 'Make the borough and journey part of the New York plan.',
    utilitySections: [
      { title: 'Start with the borough, then narrow the neighbourhood.', answer: 'New York City is one city across the Bronx, Brooklyn, Manhattan, Queens and Staten Island. Every place and event record must carry a borough, exact address and five-borough boundary result.', evidenceIds: ['NYC-BOUND-01'] },
      { title: 'Use the City event map as a starting point.', answer: 'NYC’s Find Events service lets people filter public events in streets, parks and piers by borough, agency and event type. Follow the selected event to the owning agency, organiser or venue before showing live details.', evidenceIds: ['NYC-EVENT-01'] },
      { title: 'Check the ride on the day.', answer: 'Use MTA’s current trip, alert and accessibility information for the actual route. A cross-borough plan should not inherit a static journey promise from Mingla copy.', evidenceIds: ['NYC-MOVE-01'] },
    ],
    explorer: { title: 'Choose the borough before the group chat chooses “midtown, I guess.”', body: 'Find the plan that fits the people, pin the exact venue and journey, then save and share the version everyone can act on.', cta: 'Explore New York City in Mingla', evidenceIds: ['NYC-BOUND-01', 'NYC-MOVE-01'] },
    host: { title: 'Make your corner of New York easy to choose.', body: 'Publish the borough, neighbourhood, exact venue, format, timing and join action. Keep agency permits and venue approvals current outside the listing.', cta: 'Host in New York City', evidenceIds: ['NYC-HOST-01'] },
    hostUtilities: [
      { title: 'Make your corner of New York specific', body: 'Name the borough, neighbourhood and exact venue before describing the format, current timing and join action. That keeps the invitation inside the five-borough city scope and gives guests the local detail they need without presenting the wider metropolitan area as one place.', evidenceIds: ['NYC-BOUND-01', 'NYC-EVENT-01'] },
      { title: 'Keep permits and live details with the owner', body: 'Use the responsible organiser or venue page for current event facts and the relevant NYC agency route for permits or approvals. A Mingla listing can explain the invitation and connect its supported entry action, but it does not replace agency or venue authority.', evidenceIds: ['NYC-EVENT-01', 'NYC-HOST-01'] },
    ],
    faqs: [
      { question: 'Does this include New Jersey, Long Island or the wider metro area?', answer: 'No. The hub covers New York City’s five boroughs only.', evidenceIds: ['NYC-BOUND-01'] },
      { question: 'How are current NYC events checked?', answer: 'City and destination calendars are discovery sources; the responsible agency, organiser or venue owns the live facts.', evidenceIds: ['NYC-EVENT-01'] },
      { question: 'Where should I check travel and accessibility?', answer: 'Use MTA’s current journey, alerts, elevator and escalator, and accessibility information for the chosen route.', evidenceIds: ['NYC-MOVE-01'] },
    ],
    sources: [
      source('NYC-BOUND-01', 'NYC Department of City Planning', 'Borough Boundary metadata and open-data owner', 'https://www.nyc.gov/assets/planning/download/pdf/data-maps/open-data/nybb_metadata.pdf?ver=21a', 'Five-borough boundary definition'),
      source('NYC-EVENT-01', 'NYC Mayor’s Office of Citywide Event Coordination and Management', 'Find an Event', 'https://www.nyc.gov/site/cecm/support/find-an-event.page', 'Public-event discovery'),
      source('NYC-MOVE-01', 'Metropolitan Transportation Authority', 'Official MTA service', 'https://www.mta.info/', 'Live journey and accessibility planning'),
      source('NYC-HOST-01', 'NYC311', 'Events and permit routes', 'https://portal.311.nyc.gov/article/?kanumber=KA-01892', 'Event and permit ownership'),
    ], sourcesCheckedAt: CHECKED_AT, nextReviewAt: NEXT_REVIEW_AT, localReview: { status: 'pending' }, media: [], inventory: [],
  },
  {
    slug: 'brussels', city: 'Brussels', country: 'Belgium', countryCode: 'BE', locale: 'en-BE', timezone: 'Europe/Brussels', currency: 'EUR',
    lifecycle: 'public_noindex', wasSearchReady: false, scopeLabel: 'Brussels-Capital Region', jurisdictionScope: 'Recommended editorial inclusion area: all 19 municipalities of the Brussels-Capital Region. Founder approval is still required before indexing.', scopeApproval: 'founder_pending', placeSchemaType: 'AdministrativeArea',
    directAnswer: 'Brussels plans cross municipal and language boundaries, so the useful details are the municipality, exact venue, local name and transport stop—not “central Brussels.” Mingla helps Explorers keep those pieces together and helps Hosts publish an experience in language people can recognise and act on.',
    utilityHeading: 'Keep the Brussels municipality, language and journey together.',
    utilitySections: [
      { title: 'Name the municipality.', answer: 'The Brussels-Capital Region contains 19 municipalities, including the City of Brussels. Every record needs the selected region or municipality scope, exact address and containment result instead of relying on a Brussels postal label.', evidenceIds: ['BRU-BOUND-01'] },
      { title: 'Keep local names usable.', answer: 'Preserve official French and Dutch place and station forms where they matter, even though this first page is in English. STIB-MIVB’s district maps and textual descriptions provide local station surroundings and connections.', evidenceIds: ['BRU-MOVE-01'] },
      { title: 'Use the right agenda, then verify the organiser.', answer: 'The City agenda covers municipal listings; visit.brussels covers the region. Either can surface an idea, but the venue or organiser must confirm the live date, language, entry and access details.', evidenceIds: ['BRU-EVENT-01', 'BRU-EVENT-02'] },
    ],
    explorer: { title: 'Choose the Brussels plan with the municipality attached.', body: 'Match the mood, save the exact address and stop names, check the organiser’s language and entry details, then share a plan that survives the journey.', cta: 'Explore Brussels in Mingla', evidenceIds: ['BRU-BOUND-01', 'BRU-MOVE-01'] },
    host: { title: 'Make the Brussels experience legible across the city.', body: 'Publish the municipality, official venue name, language, timing and join action. Use the responsible municipality or regional owner for permits; a Mingla page is not authorisation.', cta: 'Host in Brussels', evidenceIds: ['BRU-BOUND-01', 'BRU-HOST-01', 'BRU-HOST-02'] },
    hostUtilities: [
      { title: 'Make the Brussels invitation locally legible', body: 'Name the municipality, official venue name, language, current timing and join action. Keep official French or Dutch names where guests need them to recognise the place, and connect the event to the matching City, regional, organiser or venue source for confirmation.', evidenceIds: ['BRU-BOUND-01', 'BRU-EVENT-01', 'BRU-EVENT-02'] },
      { title: 'Use the authority that matches the scope', body: 'Keep a public-space process with the responsible municipality or regional owner, and keep Mingla’s page separate from authorisation. The City of Brussels event process applies to that municipality; a regional event source does not silently expand its authority across all 19 municipalities.', evidenceIds: ['BRU-BOUND-01', 'BRU-HOST-01', 'BRU-HOST-02'] },
    ],
    faqs: [
      { question: 'Does “Brussels” mean the City or the Region?', answer: 'The recommended launch scope is the 19-municipality Brussels-Capital Region, but founder approval is required before indexing.', evidenceIds: ['BRU-BOUND-01'] },
      { question: 'Why show French and Dutch names on an English page?', answer: 'Official local names help people recognise venues, streets and stops. No unreviewed translation or hreflang route should be invented.', evidenceIds: ['BRU-MOVE-01'] },
      { question: 'Where are current events confirmed?', answer: 'Start with the matching City or regional agenda, then verify the venue or organiser’s current page.', evidenceIds: ['BRU-EVENT-01', 'BRU-EVENT-02'] },
    ],
    sources: [
      source('BRU-BOUND-01', 'Brussels-Capital Region', 'Municipalities', 'https://be.brussels/en/about-region/structure-and-organisations/local-authorities-and-municipalities/municipalities', 'The Region’s 19 municipalities and scope'),
      source('BRU-EVENT-01', 'City of Brussels', 'Agenda', 'https://www.brussels.be/agenda', 'Municipal event discovery'),
      source('BRU-EVENT-02', 'visit.brussels', 'Agenda', 'https://www.visit.brussels/en/visitors/agenda', 'Regional event discovery'),
      source('BRU-MOVE-01', 'STIB-MIVB', 'Network and District Maps', 'https://www.stib-mivb.be/travel/network-and-district-maps', 'Local stop names and live journey planning'),
      source('BRU-HOST-01', 'City of Brussels', 'Organising an event in a public space', 'https://www.brussels.be/organising-event', 'City-municipality event authorisation'),
      source('BRU-HOST-02', 'visit.brussels', 'Adding a regional event', 'https://www.visit.brussels/en/professionals/partners/faq-partners/faq-adding-an-event', 'Regional event submission'),
    ], sourcesCheckedAt: CHECKED_AT, nextReviewAt: NEXT_REVIEW_AT, localReview: { status: 'pending' }, media: [], inventory: [],
  },
  {
    slug: 'paris', city: 'Paris', country: 'France', countryCode: 'FR', locale: 'en-FR', timezone: 'Europe/Paris', currency: 'EUR',
    lifecycle: 'public_noindex', wasSearchReady: false, scopeLabel: 'Ville de Paris', jurisdictionScope: 'The Commune or Ville de Paris, represented by its 20 municipal arrondissements; the wider Île-de-France region is excluded.', scopeApproval: 'approved', placeSchemaType: 'City',
    directAnswer: 'Paris plans become manageable when the arrondissement, meeting point and last journey are decided with the activity. Mingla helps you turn a municipal event, exhibition, class, performance or local outing into one shareable plan while keeping regional transport information clearly separate from the city boundary.',
    utilityHeading: 'Build the Paris plan from arrondissement to last journey.',
    utilitySections: [
      { title: 'Use the arrondissement as part of the answer.', answer: 'Paris is divided into 20 municipal arrondissements. Every named stop needs its arrondissement and exact address so “Paris” does not hide where the plan actually happens.', evidenceIds: ['PAR-BOUND-01'] },
      { title: 'Discover through the City, confirm at the source.', answer: '“Que faire à Paris” can surface current activities, places, events and outings. The named organiser, venue or municipal record must still own the live date, language, price, entry and access details.', evidenceIds: ['PAR-EVENT-01'] },
      { title: 'Keep Paris and Île-de-France transport scopes honest.', answer: 'RATP’s journey, map, traffic and accessibility tools cover Paris and the wider region. Use them for the selected route, but never turn their service area into the hub boundary.', evidenceIds: ['PAR-MOVE-01', 'PAR-MOVE-02'] },
    ],
    explorer: { title: 'Pick the arrondissement, then build the moment.', body: 'Choose the outing, check the exact meeting point and return, and save one plan with the French venue and station names intact.', cta: 'Explore Paris in Mingla', evidenceIds: ['PAR-BOUND-01', 'PAR-MOVE-01'] },
    host: { title: 'Give Paris the complete invitation.', body: 'Publish the arrondissement, official venue name, language, schedule and join action. If the event uses public space, confirm who manages that space before treating a City process as sufficient.', cta: 'Host in Paris', evidenceIds: ['PAR-HOST-01'] },
    hostUtilities: [
      { title: 'Give Paris the complete invitation', body: 'Publish the arrondissement, official venue name, language, current schedule and one join action. Preserve the local names guests need on signs and official sources, then connect the invitation to the responsible organiser, venue or City page for the live details.', evidenceIds: ['PAR-BOUND-01', 'PAR-EVENT-01'] },
      { title: 'Match public-space guidance to its owner', body: 'If an event uses public space, confirm which City, State, transport or private-space manager controls that location before treating one process as sufficient. Mingla can explain the experience and entry action, but it does not approve the event or replace the responsible authority.', evidenceIds: ['PAR-HOST-01', 'PAR-BOUND-01'] },
    ],
    faqs: [
      { question: 'Does this Paris guide include the whole Île-de-France region?', answer: 'No. The hub covers the Ville or Commune de Paris; regional transport is labelled separately.', evidenceIds: ['PAR-BOUND-01', 'PAR-MOVE-01'] },
      { question: 'Why keep French venue and station names?', answer: 'They are the names people need on local signs and official sources. English copy does not authorise auto-translation.', evidenceIds: ['PAR-MOVE-01'] },
      { question: 'Does Mingla approve a Paris public-space event?', answer: 'No. The responsible City, State, transport or private-space manager controls authorisation.', evidenceIds: ['PAR-HOST-01'] },
    ],
    sources: [
      source('PAR-BOUND-01', 'Ville de Paris Open Data', 'Arrondissements', 'https://opendata.paris.fr/explore/dataset/arrondissements/information/', 'Paris municipal scope and arrondissements'),
      source('PAR-EVENT-01', 'Ville de Paris', 'Que faire à Paris', 'https://www.paris.fr/quefaire', 'Current activity and event discovery'),
      source('PAR-MOVE-01', 'RATP', 'Traveller’s Guide', 'https://www.ratp.fr/en/visiting-paris/travelers-guide', 'Live regional journey planning'),
      source('PAR-MOVE-02', 'RATP', 'Accessible Maps', 'https://www.ratp.fr/en/plans-accessibles', 'Accessibility planning'),
      source('PAR-HOST-01', 'Ville de Paris', 'Organising events in public space', 'https://www.paris.fr/pages/evenements-dans-l-espace-public-33659', 'Public-space event authorisation'),
    ], sourcesCheckedAt: CHECKED_AT, nextReviewAt: NEXT_REVIEW_AT, localReview: { status: 'pending' }, media: [], inventory: [],
  },
  {
    slug: 'london', city: 'London', country: 'United Kingdom', countryCode: 'GB', locale: 'en-GB', timezone: 'Europe/London', currency: 'GBP',
    lifecycle: 'public_noindex', wasSearchReady: false, scopeLabel: 'Greater London', jurisdictionScope: 'Greater London: the 32 London boroughs plus the City of London; commuter towns and the wider travel-to-work region are excluded.', scopeApproval: 'approved', placeSchemaType: 'AdministrativeArea',
    directAnswer: 'London is too large for “somewhere central” to be a plan. Mingla helps you choose the borough and area, check the actual venue and TfL journey, and keep the occasion, timing and join action in one place for everyone coming.',
    utilityHeading: 'Choose the London people can actually reach.',
    utilitySections: [
      { title: 'Name the borough and area.', answer: 'Greater London has 32 boroughs plus the City of London Corporation. Each record needs its borough, exact address and Greater London boundary result; the City of London is one local authority, not a synonym for all London.', evidenceIds: ['LON-BOUND-01', 'LON-BOUND-02'] },
      { title: 'Make the journey fit the occasion.', answer: 'TfL provides current Journey Planner, status, visitor maps and step-free planning across bus, Tube, rail, cycle and river services. Use the live tools for the chosen time rather than making an evergreen route promise.', evidenceIds: ['LON-MOVE-01', 'LON-MOVE-02'] },
      { title: 'Treat the London calendar as discovery.', answer: 'Visit London can surface city events and area guides, but the organiser or venue must own the current date, address, entry, access and availability facts.', evidenceIds: ['LON-EVENT-01'] },
    ],
    explorer: { title: 'Choose the London people can actually reach.', body: 'Pick the borough, mood and occasion; check the live journey and venue action; then share a plan with fewer “wait, which branch?” messages.', cta: 'Explore London in Mingla', evidenceIds: ['LON-BOUND-01', 'LON-MOVE-01'] },
    host: { title: 'Turn your part of London into the plan.', body: 'Publish the borough, area, exact venue, audience, timing and join action so people can judge the experience and the journey together.', cta: 'Host in London', evidenceIds: ['LON-BOUND-01', 'LON-EVENT-01'] },
    hostUtilities: [
      { title: 'Turn your part of London into the plan', body: 'Publish the borough, area, exact venue, intended audience, current timing and join action. Keep the record inside Greater London and make the local area visible, so guests can judge the invitation and its journey without confusing the whole city with the Square Mile.', evidenceIds: ['LON-BOUND-01', 'LON-BOUND-02'] },
      { title: 'Connect the invitation to live owners', body: 'Let the named organiser or venue own current event facts, even when Visit London helps people discover the event. Direct guests to TfL’s current journey and accessibility tools for travel information rather than copying a route into evergreen Host copy.', evidenceIds: ['LON-EVENT-01', 'LON-MOVE-01', 'LON-MOVE-02'] },
    ],
    faqs: [
      { question: 'Does London mean only the Square Mile?', answer: 'No. This hub covers Greater London; the City of London is one of its local authorities.', evidenceIds: ['LON-BOUND-01', 'LON-BOUND-02'] },
      { question: 'Where should I check the journey?', answer: 'Use TfL’s current planner, status and accessibility tools for the selected time and route.', evidenceIds: ['LON-MOVE-01', 'LON-MOVE-02'] },
      { question: 'How are London events verified?', answer: 'Visit London is a discovery source; the named organiser or venue owns the live facts.', evidenceIds: ['LON-EVENT-01'] },
    ],
    sources: [
      source('LON-BOUND-01', 'Greater London Authority', 'Statistical GIS Boundary Files for London', 'https://data.london.gov.uk/dataset/statistical-gis-boundary-files-for-london-20od9', 'Greater London boundaries'),
      source('LON-BOUND-02', 'London City Hall', 'How we work for London', 'https://www.london.gov.uk/who-we-are/how-we-work-london', 'London authority structure'),
      source('LON-EVENT-01', 'Visit London', 'London Events Calendar', 'https://www.visitlondon.com/things-to-do/whats-on/special-events/london-events-calendar', 'Event discovery'),
      source('LON-MOVE-01', 'Transport for London', 'Visiting London', 'https://tfl.gov.uk/travel-information/visiting-london/', 'Live journey planning'),
      source('LON-MOVE-02', 'Transport for London', 'Plan an Accessible Journey', 'https://tfl.gov.uk/transport-accessibility/plan-an-accessible-journey', 'Accessibility planning'),
    ], sourcesCheckedAt: CHECKED_AT, nextReviewAt: NEXT_REVIEW_AT, localReview: { status: 'pending' }, media: [], inventory: [],
  },
  {
    slug: 'fort-lauderdale', city: 'Fort Lauderdale', country: 'United States', countryCode: 'US', locale: 'en-US', timezone: 'America/New_York', currency: 'USD',
    lifecycle: 'public_noindex', wasSearchReady: false, scopeLabel: 'City of Fort Lauderdale municipal limits', jurisdictionScope: 'City of Fort Lauderdale municipal boundary; Broward County and Greater Fort Lauderdale are excluded as city boundaries.', scopeApproval: 'approved', placeSchemaType: 'City',
    directAnswer: 'Fort Lauderdale plans often need the place and the event impact checked together: exact city location, waterfront or street access, parking or road effects, and the real organiser action. Mingla helps Explorers keep those practical details with the outing and helps Hosts explain what changes around the event.',
    utilityHeading: 'Plan the Fort Lauderdale outing and its edges.',
    utilitySections: [
      { title: 'Keep the city separate from the destination region.', answer: 'Visit Lauderdale is Broward County’s tourism agency and accepts events across the county. A “Greater Fort Lauderdale” listing must pass the City of Fort Lauderdale municipal-boundary check before it becomes city inventory.', evidenceIds: ['FTL-BOUND-01', 'FTL-EVENT-02'] },
      { title: 'Check the City’s event-impact view.', answer: 'Fort Lauderdale’s Parks and Recreation event surface links city-permitted and city-produced events with information such as road or bridge closures, parking effects and after-hours impacts. Use the current record for the chosen date; do not copy an impact into evergreen text.', evidenceIds: ['FTL-EVENT-01'] },
      { title: 'Label county transport as county transport.', answer: 'Broward County Transit can help with the trip, but its service area is wider than Fort Lauderdale. Confirm the exact stop, route and service status for the plan.', evidenceIds: ['FTL-MOVE-01'] },
    ],
    explorer: { title: 'Plan the Fort Lauderdale outing and its edges.', body: 'Choose the city experience, check the exact address, organiser action and any event impacts, then save the meeting point and route with the plan.', cta: 'Explore Fort Lauderdale in Mingla', evidenceIds: ['FTL-BOUND-01', 'FTL-EVENT-01'] },
    host: { title: 'Show guests how the Fort Lauderdale event really works.', body: 'Publish the exact venue, timing, entry, access and arrival notes. City permits and impact reporting stay with the City even when Mingla carries the public page.', cta: 'Host in Fort Lauderdale', evidenceIds: ['FTL-EVENT-01'] },
    hostUtilities: [
      { title: 'Show guests how the event works', body: 'Publish the exact Fort Lauderdale venue, current timing, entry action, access details and arrival notes. Keep the record inside the City boundary, so a county-wide discovery or submission source does not silently turn a Broward County event into Fort Lauderdale city inventory.', evidenceIds: ['FTL-BOUND-01', 'FTL-EVENT-02'] },
      { title: 'Keep City responsibilities with the City', body: 'A Mingla page can carry the public invitation and supported join action, but it does not replace Fort Lauderdale’s outdoor-event process or impact reporting. Keep those requirements with the City and keep the organiser or venue source current for the guest-facing facts.', evidenceIds: ['FTL-EVENT-01'] },
    ],
    faqs: [
      { question: 'Does this page cover all of Broward County?', answer: 'No. It covers verified records inside the City of Fort Lauderdale.', evidenceIds: ['FTL-BOUND-01'] },
      { question: 'Why can’t every Visit Lauderdale item appear here?', answer: 'Visit Lauderdale serves Broward County, so each item needs a municipal-boundary check and organiser verification.', evidenceIds: ['FTL-EVENT-02', 'FTL-BOUND-01'] },
      { question: 'Does a Mingla listing replace an outdoor-event permit?', answer: 'No. Fort Lauderdale’s Parks and Recreation process remains the authority.', evidenceIds: ['FTL-EVENT-01'] },
    ],
    sources: [
      source('FTL-BOUND-01', 'City of Fort Lauderdale GIS', 'Municipal Boundary Line', 'https://gis.fortlauderdale.gov/server/rest/services/MunicipalBoundaryLine/FeatureServer/0', 'City municipal boundary'),
      source('FTL-EVENT-01', 'City of Fort Lauderdale Parks and Recreation', 'Events and Event Impact Dashboard', 'https://www.parks.fortlauderdale.gov/special-events', 'City events, impacts and permit ownership'),
      source('FTL-EVENT-02', 'Visit Lauderdale', 'Submit your event', 'https://www.visitlauderdale.com/partners/submit-your-event/', 'Broward County destination scope'),
      source('FTL-MOVE-01', 'Broward County Transit', 'Official transit service', 'https://www.broward.org/BCT', 'Live county transport planning'),
    ], sourcesCheckedAt: CHECKED_AT, nextReviewAt: NEXT_REVIEW_AT, localReview: { status: 'pending' }, media: [], inventory: [],
  },
  {
    slug: 'washington-dc', city: 'Washington, DC', country: 'United States', countryCode: 'US', locale: 'en-US', timezone: 'America/New_York', currency: 'USD', marketingDeckCenter: { lat: 38.9072873, lng: -77.0369274 },
    lifecycle: 'public_noindex', wasSearchReady: false, scopeLabel: 'District of Columbia boundary', jurisdictionScope: 'District of Columbia boundary; Maryland, Virginia and the wider DMV or metropolitan area are excluded.', scopeApproval: 'approved', placeSchemaType: 'AdministrativeArea',
    directAnswer: 'Washington, DC is more useful when the plan names the neighbourhood and institution, not only the monument or the Metro stop. Mingla helps you connect a District event, museum, performance, tour, restaurant or gathering with its real entry details and regional journey without turning the DMV into one city.',
    utilityHeading: 'Connect the District place, institution and regional journey.',
    utilitySections: [
      { title: 'Keep DC inside the District.', answer: 'Every named place needs an address and District-boundary result. A WMATA route or “Washington area” label does not make a Maryland or Virginia stop part of this city hub.', evidenceIds: ['DC-BOUND-01', 'DC-MOVE-01'] },
      { title: 'Name the neighbourhood and the institution.', answer: 'Destination DC organises current discovery around District neighbourhoods and events. Follow each selected record to the museum, venue, organiser or responsible institution for current entry, access and status.', evidenceIds: ['DC-EVENT-01'] },
      { title: 'Plan regional transport without changing the city.', answer: 'WMATA provides current trip planning, maps, arrivals, alerts and accessibility across a regional network. Use it for the actual journey and label the network’s wider scope.', evidenceIds: ['DC-MOVE-01'] },
    ],
    explorer: { title: 'Find the DC beyond a pin on the Mall.', body: 'Choose the neighbourhood, institution and occasion; check the live entry and Metro details; then save a plan that gets everyone to the same Washington.', cta: 'Explore Washington, DC in Mingla', evidenceIds: ['DC-EVENT-01', 'DC-MOVE-01'] },
    host: { title: 'Make the District experience clear from invitation to arrival.', body: 'Publish the neighbourhood, exact venue, responsible organiser, timing and join action. Keep venue, agency and public-space approvals outside Mingla and current.', cta: 'Host in Washington, DC', evidenceIds: ['DC-HOST-01', 'DC-AUTH-01'] },
    hostUtilities: [
      { title: 'Make the District invitation precise', body: 'Name the DC neighbourhood, exact venue, responsible organiser, current timing and one join action. Keep the venue inside the District boundary and use its official name, so guests can distinguish the event itself from the wider regional journey used to reach it.', evidenceIds: ['DC-BOUND-01', 'DC-EVENT-01'] },
      { title: 'Keep venue and agency authority intact', body: 'Connect the invitation to the responsible institution, organiser or venue page for current facts and booking paths. Keep venue, agency and public-space approvals outside Mingla; the listing helps guests understand and join, but it does not grant or replace those approvals.', evidenceIds: ['DC-HOST-01', 'DC-AUTH-01'] },
    ],
    faqs: [
      { question: 'Does this include the whole DMV?', answer: 'No. The hub covers the District of Columbia only.', evidenceIds: ['DC-BOUND-01'] },
      { question: 'Where should I confirm a museum, tour or event?', answer: 'Use the responsible institution, organiser or venue page; destination calendars are discovery sources.', evidenceIds: ['DC-EVENT-01'] },
      { question: 'Why is WMATA described as regional?', answer: 'Its network crosses the District boundary. It supports the journey but does not define the city page.', evidenceIds: ['DC-MOVE-01'] },
    ],
    sources: [
      source('DC-BOUND-01', 'DCGIS Open Data', 'District Boundary', 'https://opendata.dc.gov/datasets/DCGIS::district-boundary/about', 'District of Columbia boundary'),
      source('DC-EVENT-01', 'Destination DC', 'Official District visitor and event source', 'https://washington.org/', 'District neighbourhood and event discovery'),
      source('DC-HOST-01', 'Events DC', 'Venues and booking paths', 'https://eventsdc.com/venues', 'Venue and booking ownership'),
      source('DC-MOVE-01', 'Washington Metropolitan Area Transit Authority', 'Official regional transport service', 'https://www.wmata.com/', 'Live regional journey planning'),
      source('DC-AUTH-01', 'District Government', 'Destination DC referral', 'https://dc.gov/external-link/destination-dc', 'Destination authority relationship'),
    ], sourcesCheckedAt: CHECKED_AT, nextReviewAt: NEXT_REVIEW_AT, localReview: { status: 'pending' }, media: [], inventory: [],
  },
] as const satisfies readonly CityHubRecord[]

export type CityHubSlug = (typeof CITY_HUBS)[number]['slug']

export function cityHubForSlug(slug: string): CityHubRecord | null {
  return CITY_HUBS.find((record) => record.slug === slug) ?? null
}

export function isCityHubSearchReady(record: CityHubRecord): boolean {
  if (record.lifecycle !== 'search_ready') return false
  if (record.scopeApproval !== 'approved' || record.localReview.status !== 'reviewed') return false
  if (record.utilitySections.length !== 3 || record.hostUtilities.length !== 2 || record.faqs.length !== 3) return false
  if (record.media.some((item) => !item.commercialRights)) return false
  if (record.inventory.some((item) => item.lifecycle !== 'search_ready')) return false
  const evidenceIds = new Set(record.sources.map((entry) => entry.id))
  return [...record.utilitySections, ...record.hostUtilities, record.explorer, record.host, ...record.faqs]
    .every((claim) => claim.evidenceIds.length > 0 && claim.evidenceIds.every((id) => evidenceIds.has(id)))
}

export function allCityHubsSearchReady(): boolean {
  return CITY_HUBS.length === 10 && CITY_HUBS.every(isCityHubSearchReady)
}

export function cityHubPath(record: Pick<CityHubRecord, 'slug'>): `/cities/${string}` {
  return `/cities/${record.slug}`
}
