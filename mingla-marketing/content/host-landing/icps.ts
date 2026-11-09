// #4339 — the Host landing pages (/host/<slug>), one data object per ICP.
//
// ONE component (components/landing/icp-landing.tsx) renders every page from
// this file, so adding an ICP means adding an entry here and nothing else.
// The copy is the approved design copy (#4339 design contract, version 7),
// word for word; the keys keep the design's names so the two stay traceable.
//
// Markup inside copy: `*words*` is the italic, emphasised half.
// Media: `v:<name>` is the looping clip public/marketing/site/m/<name>.mp4 with
// its poster m/<name>.jpg; `p:<name>` is the still p/<name>.jpg. `bg` (the
// features background) is a plain name for a still from p/, or `v:<name>` for
// a looping clip from m/ (Seth, 8 Nov: every ICP's features background is its
// own `bg-<icp>` loop, starting with bg-events for /host/events).
//
// No store, host or OneLink URL lives here: every "Use Mingla Web" button goes
// through lib/app-handoff.ts, which asks lib/cta-destination.ts (#4137).

// #4339 speed fix: the media reference and its resolver live in
// lib/landing-media-ref.ts, so the client media player does not ship this
// whole file (every landing page's copy). Re-exported here for its callers.
import type { LandingMediaRef } from '../../lib/landing-media-ref'
import { resolveLandingMedia } from '../../lib/landing-media-ref'
export type { LandingMediaRef, ResolvedLandingMedia } from '../../lib/landing-media-ref'
export { resolveLandingMedia } from '../../lib/landing-media-ref'

export type LandingIcon =
  | 'ticket'
  | 'users'
  | 'mail'
  | 'map'
  | 'card'
  | 'chat'
  | 'calendar'
  | 'tag'
  | 'image'
  | 'chart'
  | 'sun'

export interface LandingFeature {
  readonly ic: LandingIcon
  readonly t: string
  readonly m: LandingMediaRef
  readonly p: string
  readonly tags: readonly string[]
}

export type ToolName =
  | 'Venue Website Grader'
  | 'Event Turnout Predictor'
  | 'Quote Any Trip'
  | 'The Undercharging Audit'

export interface LandingTool {
  readonly n: ToolName
  readonly d: string
  readonly cta: string
  /** [label, input kind, example value] */
  readonly f: readonly (readonly [string, 'text' | 'select', string])[]
}

export interface IcpLanding {
  /** The glass CTA bar line. */
  readonly bring: string
  readonly name: string
  readonly short: string
  readonly hero: LandingMediaRef
  /** Features background: a still name from p/, or `v:<name>` for a clip. */
  readonly bg: string
  /** Headline line one (roman) and line two (italic). */
  readonly l1: string
  readonly l2: string
  /**
   * #4339 round B: the search title, keyword first, under 60 characters with
   * " | Mingla Host" (icpLandingMeta). US spelling where US searchers type it.
   */
  readonly seoTitle: string
  /** The hero line, and the meta description (140–160 characters). */
  readonly sub: string
  readonly intro: string
  readonly duo: readonly [string, string]
  readonly big: string
  readonly fh: string
  readonly fp: string
  readonly feats: readonly [LandingFeature, LandingFeature, LandingFeature]
  readonly who: readonly string[]
  readonly tool: LandingTool
  readonly faq: readonly (readonly [string, string])[]
  readonly end: string
  readonly endm: LandingMediaRef
}

/** Each free tool's live page on usemingla.com (internal, same tab). */
export const TOOL_PATH: Readonly<Record<ToolName, string>> = {
  'Venue Website Grader': '/tools/venues',
  'Event Turnout Predictor': '/tools/events',
  'Quote Any Trip': '/tools/trips',
  'The Undercharging Audit': '/tools/pricing',
}

export const ICP_LANDINGS = {
  events: {
    bring: "Bring your next night to Mingla.",
    name: "Event organisers",
    short: "Events",
    hero: "v:crowd",
    bg: "v:bg-events",
    l1: "Fill the room,",
    l2: "not just the timeline.",
    seoTitle: "Event ticketing & guest lists for organizers",
    sub: "Tickets, guest lists, door scanning and an AI demand forecast, in one place built for the people who throw the night, from the first post to a packed room.",
    intro: "You bring the night. Mingla puts it where people are already deciding what to do this weekend, then gives you the tools to sell it, run the door and bring the same crowd back.",
    duo: ["Posted", "Packed"],
    big: "People don’t search for a category. They search for a plan. Put the *date, the place and the price* together, say what’s included in plain words, and give them *one link to book.*",
    fh: "Everything between *the flyer and the door.*",
    fp: "Built around how events actually run: the build, the sale, the night and the follow-up.",
    feats: [
      { ic: "ticket", t: "Sell it your way", m: "v:salsa", p: "One night, a whole weekend or every Friday. Online, in person or both. Free RSVPs or paid tickets, priced in your currency.", tags: ["One-night", "Multi-day", "Weekly", "Online & hybrid", "Free RSVP"] },
      { ic: "users", t: "Know who’s coming", m: "v:amapiano", p: "Guest lists and groups, ticket scanning at the door, and an AI demand forecast so you can plan the room before you book it.", tags: ["Guest lists", "Groups", "Door scanning", "Demand forecast"] },
      { ic: "mail", t: "Bring them back", m: "v:cozy", p: "Send the next date to the people who came last time, before the flyer. Email campaigns to a group, discount codes and referrals.", tags: ["Email campaigns", "Discount codes", "Referrals"] },
    ],
    who: ["Promoters", "Party series", "Concerts & live music", "Comedy nights", "Dance socials", "Festivals", "Community events", "Conferences"],
    tool: {
      n: "Event Turnout Predictor",
      d: "How many people will actually show up? Get a turnout forecast, and see what your promo budget can buy. Free, in under a minute.",
      cta: "Forecast my turnout",
      f: [
        ["Event type", "select", "Party / club night"],
        ["City", "text", "Lagos"],
        ["Ticket price", "text", "₦9,999"],
        ["Promo budget", "text", "₦50,000"],
      ],
    },
    faq: [
      ["Can I publish a free event without connecting a bank?", "Yes. Free events publish without one. You only connect a bank when you sell paid tickets."],
      ["Can I sell in naira?", "Yes. Nigerian brands price in naira, and your address chooses the payment network that pays you out."],
      ["Does Mingla see my bank details?", "No. Your bank details are handled by the payment provider and never touch Mingla."],
      ["What about weekly or multi-day events?", "Both are built in: set it once as a recurring or multi-day event and sell each date."],
    ],
    end: "Your next night, *on Mingla.*",
    endm: "v:cozy",
  },
  trips: {
    bring: "Bring your next trip to Mingla.",
    name: "Trip organisers",
    short: "Trips",
    hero: "v:hikers",
    bg: "v:bg-trips",
    l1: "Plan the trip,",
    l2: "let the group pay in parts.",
    seoTitle: "Group trip payment plans & itineraries",
    sub: "Itineraries, payment plans and a group chat that keeps everyone on the same page, from the first deposit to the last day of the trip you planned together.",
    intro: "Group trips fall apart in the chat. Mingla gives the plan a home: one page with the itinerary, the price and the way to pay, and one place to talk.",
    duo: ["Planned", "Paid"],
    big: "Price it *per person,* show the *whole day by day,* and let people pay *in parts.* The trip stops being a maybe in a group chat and becomes a plan with a date.",
    fh: "From idea to *wheels up.*",
    fp: "Everything a trip host juggles, in the order it actually happens.",
    feats: [
      { ic: "map", t: "Itineraries people trust", m: "v:f-trip", p: "Lay out every day with times, places and what’s included, so people can see the trip before they commit to it.", tags: ["Day by day", "What’s included", "Shareable page"] },
      { ic: "card", t: "Pay in instalments", m: "v:beach", p: "Take a deposit, then the rest in parts. Fewer drop-outs, and no chasing people for money in DMs.", tags: ["Deposits", "Instalments", "One link to pay"] },
      { ic: "chat", t: "One group chat", m: "v:sailing", p: "Updates, reminders and questions live with the trip, not scattered across five apps.", tags: ["Group chat", "Updates", "Reminders"] },
    ],
    who: ["Group trips", "Weekend getaways", "Boat days", "Hiking & outdoors", "Travel clubs", "Retreats", "Tours", "Festival trips"],
    tool: {
      n: "Quote Any Trip",
      d: "Price a group trip in a minute: real hotels and activities, a full cost sheet, and exactly what to charge per person. Free.",
      cta: "Quote a trip",
      f: [
        ["Destination", "text", "Zanzibar"],
        ["Group size", "text", "12 people"],
        ["Nights", "text", "4"],
        ["Style", "select", "Comfort"],
      ],
    },
    faq: [
      ["Can people pay in instalments?", "Yes. Instalments are built into trips, so people can pay a deposit and then the rest in parts."],
      ["Where does the group talk?", "Each trip has its own group chat, so updates and questions stay with the plan."],
      ["Can I share the itinerary before people book?", "Yes. The trip page shows the day by day, so people can see the plan before they pay."],
    ],
    end: "Your next trip, *booked out.*",
    endm: "v:sailing",
  },
  experiences: {
    bring: "Bring your next session to Mingla.",
    name: "Experience hosts",
    short: "Experiences",
    hero: "v:pottery",
    bg: "v:bg-exp",
    l1: "Your class is the plan,",
    l2: "make it easy to book.",
    seoTitle: "Class & workshop booking software",
    sub: "Workshops, classes, tastings and tours: list the sessions, take bookings, sell the spots and fill the next one with the people who loved the last one.",
    intro: "Experiences sell when people can picture themselves there. Mingla shows the moment, the time and the price in one place, and makes the next step one tap.",
    duo: ["Booked", "Rebooked"],
    big: "Give people three things: *context,* what it is and why it matters; *vibe,* real moments and what to expect; and *a next step,* the date, place, price and one link to book.",
    fh: "Run sessions, *not spreadsheets.*",
    fp: "For the hosts whose product is an afternoon people remember.",
    feats: [
      { ic: "calendar", t: "Sessions on repeat", m: "v:pottery", p: "Set up a weekly class or a one-off workshop, with spots, prices and what’s included on every date.", tags: ["Weekly classes", "Workshops", "Spots per session"] },
      { ic: "tag", t: "Price it properly", m: "v:salsa", p: "Sale prices, automatic discounts and codes for regulars, so a full class doesn’t mean an underpriced one.", tags: ["Sale prices", "Auto discounts", "Codes"] },
      { ic: "mail", t: "Fill the next one", m: "v:bachata", p: "Send the next date to everyone who came before, and let referrals do the rest.", tags: ["Campaigns", "Referrals", "Guest lists"] },
    ],
    who: ["Pottery & craft", "Dance classes", "Cooking classes", "Tastings", "Wellness", "Walking tours", "Workshops", "Kids’ activities"],
    tool: {
      n: "The Undercharging Audit",
      d: "Priced by guilt? See your true cost per head, including your own time, and the price you should actually charge. Free.",
      cta: "Audit my pricing",
      f: [
        ["Experience", "text", "Pottery class"],
        ["Price per person", "text", "₦15,000"],
        ["Spots per session", "text", "10"],
        ["Hours of your time", "text", "4"],
      ],
    },
    faq: [
      ["Can I run the same class every week?", "Yes. Set it up as a recurring event and each date sells on its own."],
      ["Can I offer a discount to regulars?", "Yes: discount codes, sale prices and automatic discounts are built in."],
      ["Can I take free RSVPs for a taster session?", "Yes. Free RSVP events publish without a bank account."],
    ],
    end: "Your next session, *full.*",
    endm: "v:salsa",
  },
  restaurants: {
    bring: "Bring your place to Mingla.",
    name: "Restaurants, cafés & diners",
    short: "Restaurants",
    hero: "v:cafe",
    bg: "v:bg-rest",
    l1: "Get found by people",
    l2: "choosing where to eat.",
    seoTitle: "Restaurant reservations & venue listing",
    sub: "A venue listing that sells the room, with reservations, table ordering, menu intelligence and a demand forecast for the nights ahead, all in one place.",
    intro: "People don’t pick a restaurant from a map pin. They pick a feeling. Mingla matches your place to the people already looking for it, then helps you run the service.",
    duo: ["Listed", "Recommended"],
    big: "Fill in the checklist once: a *hero cover,* at least *five photos,* your website, *typical spend,* the *“best for”* tags that match how people use your place, and a few quick yes-or-no answers. Then Mingla can *match you to the right people.*",
    fh: "From first look to *last table.*",
    fp: "The listing that gets you chosen, and the tools that run the room once they arrive.",
    feats: [
      { ic: "image", t: "A listing that sells the room", m: "v:cafe", p: "A video cover, up to twenty photos, typical spend and “best for” tags, so people see the experience, not just the address.", tags: ["Video cover", "5–20 photos", "Typical spend", "Best for"] },
      { ic: "calendar", t: "Reservations & table ordering", m: "v:hostess", p: "Take bookings and orders in one place, and build your menu once for every surface.", tags: ["Reservations", "Table ordering", "Menu builder"] },
      { ic: "chart", t: "Know the nights ahead", m: "v:grandplace", p: "Menu intelligence and a demand forecast show what’s selling and which nights need a push.", tags: ["Menu intelligence", "Demand forecast"] },
    ],
    who: ["Restaurants", "Cafés", "Diners", "Brunch spots", "Bakeries", "Dessert & ice cream", "Food halls", "Supper clubs"],
    tool: {
      n: "Venue Website Grader",
      d: "Find out what your website says to a first-timer, and exactly what it’s costing you. Free report in 60 seconds.",
      cta: "Grade my website",
      f: [
        ["Your website", "text", "yourplace.com"],
        ["Type of place", "select", "Restaurant"],
      ],
    },
    faq: [
      ["What does Mingla need to recommend my venue?", "A hero cover (a short video stands out most), at least five photos, your website, typical spend, “best for” tags and a few quick yes-or-no questions."],
      ["How many photos can I add?", "At least five and up to twenty."],
      ["Can I build my menu in Mingla?", "Yes. The menu builder sets it up once for your listing and table ordering."],
    ],
    end: "Your best table, *found.*",
    endm: "v:hostess",
  },
  hotels: {
    bring: "Bring your property to Mingla.",
    name: "Hotels & resorts",
    short: "Hotels",
    hero: "v:lp-hotel",
    bg: "v:bg-hotel",
    l1: "Be the reason",
    l2: "they book the weekend.",
    seoTitle: "Hotel day passes & resort events",
    sub: "List the stay, the day passes and the events on your grounds, and market them to the people planning their next getaway or a day by the pool.",
    intro: "A getaway starts as a plan someone makes with friends. Mingla puts your property, your beach days and your events in front of them while they’re still deciding.",
    duo: ["Seen", "Stayed"],
    big: "Sell more than the room. *Beach days, pool parties, brunches* and *weekend packages* are plans people share, and every one of them is a way *back to your property.*",
    fh: "The stay is the start, *not the whole story.*",
    fp: "Turn your grounds into a calendar people want to be part of.",
    feats: [
      { ic: "sun", t: "Days and events on your grounds", m: "v:beach", p: "Sell day passes, beach days and parties as events, with tickets, guest lists and scanning at the gate.", tags: ["Day passes", "Events", "Door scanning"] },
      { ic: "image", t: "A listing that feels like a getaway", m: "v:sailing", p: "Video cover, galleries and “best for” tags show the experience, not just the room types.", tags: ["Video cover", "Gallery", "Best for"] },
      { ic: "mail", t: "Email and SMS that bring them back", m: "v:hikers", p: "Nurture past guests with campaigns for the next season, the next long weekend and the next event.", tags: ["Email", "SMS", "CRM"] },
    ],
    who: ["Resorts", "Boutique hotels", "Beach clubs", "Guesthouses", "Lodges", "Day-pass pools", "Retreat centres", "Glamping"],
    tool: {
      n: "Venue Website Grader",
      d: "Find out what your website says to a first-timer, and exactly what it’s costing you. Free report in 60 seconds.",
      cta: "Grade my website",
      f: [
        ["Your website", "text", "yourresort.com"],
        ["Type of place", "select", "Resort"],
      ],
    },
    faq: [
      ["Can I sell day passes and events, not just stays?", "Yes. Anything on your grounds can be listed and sold as an event with tickets."],
      ["Can I market to past guests?", "Yes. Email and SMS campaigns go to the groups you build from your guest lists."],
      ["Can I price in my own currency?", "Yes. Prices follow your brand’s country, including naira for Nigeria."],
    ],
    end: "Your next season, *booked.*",
    endm: "v:beach",
  },
  art: {
    bring: "Bring your next opening to Mingla.",
    name: "Galleries, museums & art spaces",
    short: "Art & culture",
    hero: "v:lp-art",
    bg: "v:bg-art",
    l1: "Culture is a plan,",
    l2: "make it the obvious one.",
    seoTitle: "Gallery & museum ticketing and RSVPs",
    sub: "Openings, exhibitions, talks and late nights, listed where people plan their weekend, with tickets or free RSVPs and a guest list that comes back.",
    intro: "People want more from a weekend than another dinner. Mingla puts your exhibitions and events in the plan, with the context that makes them easy to say yes to.",
    duo: ["Seen", "Visited"],
    big: "Local discovery is *bigger than restaurants.* Culture competes for the same weekend, and people are really asking: *is it worth leaving the house,* who is it for, and *how do I book?* Answer those and you’re in the plan.",
    fh: "From the opening *to the next visit.*",
    fp: "For spaces whose calendar is the reason to come back.",
    feats: [
      { ic: "calendar", t: "Every opening, listed", m: "v:f-museum", p: "Exhibitions, openings, talks and late nights, each with its own page, date and way in.", tags: ["Exhibitions", "Openings", "Talks", "Late nights"] },
      { ic: "ticket", t: "Tickets or free RSVPs", m: "v:grandplace", p: "Charge for entry or take free RSVPs so you know who’s coming, and scan them in at the door.", tags: ["Tickets", "Free RSVP", "Door scanning"] },
      { ic: "mail", t: "A list that comes back", m: "v:f-stage", p: "Every visitor joins your list, so the next exhibition starts with an audience.", tags: ["Guest lists", "Campaigns"] },
    ],
    who: ["Galleries", "Museums", "Art spaces", "Studios", "Theatres", "Cultural centres", "Libraries", "Pop-up shows"],
    tool: {
      n: "The Undercharging Audit",
      d: "Priced by guilt? See your true cost per head, including your own time, and the price you should actually charge. Free.",
      cta: "Audit my pricing",
      f: [
        ["Event", "text", "Late opening"],
        ["Ticket price", "text", "$20"],
        ["Capacity", "text", "120"],
      ],
    },
    faq: [
      ["Can we take free RSVPs?", "Yes. Free events publish without a bank account, and you still get a guest list."],
      ["Can we list a long-running exhibition?", "Yes. Multi-day and recurring events cover exhibitions and regular late nights."],
      ["Can visitors find us without an event on?", "Yes. Your venue listing stays on Mingla between events."],
    ],
    end: "Your next opening, *full.*",
    endm: "v:grandplace",
  },
  play: {
    bring: "Bring your place to Mingla.",
    name: "Play spaces, bowling & arcades",
    short: "Play",
    hero: "v:nightlife",
    bg: "v:bg-play",
    l1: "Make your place",
    l2: "the group’s yes.",
    seoTitle: "Bowling, arcade & escape room bookings",
    sub: "Bowling, arcades, karaoke, escape rooms and game nights: take bookings for lanes, rooms and parties, and be the answer when a group asks what to do tonight.",
    intro: "Groups are the hardest plans to make and the best customers to win. Mingla puts your place in front of them with the details that get the whole chat to say yes.",
    duo: ["Open", "Booked out"],
    big: "Show the *fun,* not the floor plan. A *short video,* the *typical spend,* who it’s *best for* and one way to *book the group,* and you stop being a maybe.",
    fh: "Nights that sell *themselves.*",
    fp: "From walk-ins to tournament nights, run the busy side of fun.",
    feats: [
      { ic: "image", t: "A listing that shows the fun", m: "v:nightlife", p: "Video cover, galleries and “best for” tags like groups, birthdays and date night.", tags: ["Video cover", "Best for", "Typical spend"] },
      { ic: "ticket", t: "Theme nights & tournaments", m: "v:f-arcade", p: "Sell league nights, tournaments and parties as events with tickets, guest lists and scanning.", tags: ["Tickets", "Guest lists", "Door scanning"] },
      { ic: "calendar", t: "Reservations for groups", m: "v:crowd", p: "Take bookings for lanes, rooms and tables, and see the busy nights coming with a demand forecast.", tags: ["Reservations", "Demand forecast"] },
    ],
    who: ["Bowling", "Arcades", "Karaoke", "Escape rooms", "Mini golf", "Trampoline parks", "Board-game cafés", "Go-karts"],
    tool: {
      n: "Venue Website Grader",
      d: "Find out what your website says to a first-timer, and exactly what it’s costing you. Free report in 60 seconds.",
      cta: "Grade my website",
      f: [
        ["Your website", "text", "yourarcade.com"],
        ["Type of place", "select", "Arcade"],
      ],
    },
    faq: [
      ["Can I sell tournament nights?", "Yes. List them as events with tickets, a guest list and scanning at the door."],
      ["Can groups book ahead?", "Yes. Reservations let groups book lanes, rooms or tables."],
      ["What should my listing show?", "A hero cover (a short video stands out most), at least five photos, typical spend and “best for” tags."],
    ],
    end: "Your busiest night, *next.*",
    endm: "v:nightlife",
  },
} as const satisfies Record<string, IcpLanding>

export type IcpSlug = keyof typeof ICP_LANDINGS

export const ICP_SLUGS = Object.keys(ICP_LANDINGS) as IcpSlug[]

export function isIcpSlug(value: string): value is IcpSlug {
  return Object.prototype.hasOwnProperty.call(ICP_LANDINGS, value)
}

export function icpLandingPath(slug: IcpSlug): string {
  return `/host/${slug}`
}

/** Search title and description, from the ICP's own approved copy. */
export function icpLandingMeta(slug: IcpSlug): { title: string; description: string } {
  const d: IcpLanding = ICP_LANDINGS[slug]
  return { title: `${d.seoTitle} | Mingla Host`, description: d.sub }
}

/** The features background as a media reference: `v:<name>` stays a clip, a plain name is a still. */
export function landingBackgroundMedia(bg: string): LandingMediaRef {
  const ref: LandingMediaRef = bg.startsWith('v:') ? (bg as LandingMediaRef) : `p:${bg}`
  resolveLandingMedia(ref)
  return ref
}

/** The features background's still: the poster of a clip, or the photo itself. */
export function landingBackground(bg: string): string {
  return resolveLandingMedia(landingBackgroundMedia(bg)).poster
}

/** Split `*emphasised*` copy into plain and italic runs. */
export function emphasisRuns(copy: string): { text: string; em: boolean }[] {
  return copy
    .split(/(\*[^*]+\*)/)
    .filter((seg) => seg !== '')
    .map((seg) => (seg.startsWith('*') && seg.endsWith('*') ? { text: seg.slice(1, -1), em: true } : { text: seg, em: false }))
}

/** The scroll-lit paragraph as words, each flagged when it sits in an emphasised run. */
export function litWords(copy: string): { word: string; em: boolean }[] {
  return emphasisRuns(copy).flatMap((run) =>
    run.text
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => ({ word, em: run.em })),
  )
}
