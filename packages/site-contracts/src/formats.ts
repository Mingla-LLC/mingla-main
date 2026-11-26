/**
 * #4453 milestone 7 (spec v2 §4, §6.2, §6.3, §6.6; spec v2.1 §1.1, §2.4,
 * N4, N5) — business-type formats: which sections a site has, in which
 * order, and which of the ten styles fit it.
 *
 * Pure and dependency-free (only other contract files). Read by:
 *   - Studio's composer v2 (`mingla-site-cms/src/lib/composeFormat.ts`), which
 *     places each section only when `sectionEligibility` says its source holds
 *     real content, and never writes a fact (prices, counts, dates, ratings,
 *     review quotes are live fields filled at render);
 *   - Ari's design pass (the brief, the style check, the confirm cards);
 *   - the Business look picker (fit labels and the "avoid" warning);
 *   - milestones 10 and 11 (the three-style preview and add-a-page), which
 *     reuse `styleFit` / `topStylePicks` unchanged.
 *
 * Every reason sentence is fixed, Mingla-written text (N5): no model call,
 * the same words every time.
 *
 * invariant: I-SITES-ARI-NEVER-PICKS-AVOID — Ari never proposes a style the
 * fit table marks "avoid" for the brand's primary format; owners may, with a
 * warning (test: mingla-site-cms/src/lib/formats.issue4453.test.ts).
 */
import type { BlockType } from "./blocks.ts";
import type { DesignKey } from "./designs.ts";
import type { PlanOfferingKey } from "./sitePlan.ts";
import type { SectionOptions } from "./sectionSources.ts";

/* ───────────────────────── formats ───────────────────────── */

export type FormatKey = "restaurants" | "hotels" | "play" | "art" | "trips" | "events" | "experiences";

/** M1 order (the plan's page order: trips, events, experiences, menu, visit, rooms). */
export const FORMAT_KEYS: readonly FormatKey[] = ["trips", "events", "experiences", "restaurants", "play", "art", "hotels"];

/** v2 §4.1 — each setup tick maps to one format. */
export const FORMAT_FOR_PLAN_OPTION: Readonly<Record<PlanOfferingKey, FormatKey>> = {
  trips: "trips",
  events: "events",
  experiences: "experiences",
  venue_coworking: "play",
  venue_food_drink: "restaurants",
  venue_play: "play",
  venue_creative_arts: "art",
  venue_stay: "hotels",
};

/** The planned page (M1) a format's main action leads to. */
const FORMAT_PLANNED_PAGE: Readonly<Record<FormatKey, string>> = {
  trips: "trips",
  events: "events",
  experiences: "experiences",
  restaurants: "menu",
  play: "visit",
  art: "visit",
  hotels: "rooms",
};

export function isFormatKey(value: unknown): value is FormatKey {
  return typeof value === "string" && (FORMAT_KEYS as readonly string[]).includes(value);
}

/** The formats a set of ticks asks for, in M1 order, each once. */
export function formatsForPlan(offerings: readonly string[] | null | undefined): FormatKey[] {
  const wanted = new Set<FormatKey>();
  for (const key of offerings ?? []) {
    const format = FORMAT_FOR_PLAN_OPTION[key as PlanOfferingKey];
    if (format) wanted.add(format);
  }
  return FORMAT_KEYS.filter((format) => wanted.has(format));
}

export type FormatPlan = {
  readonly offerings_selected: readonly string[] | null | undefined;
  /** The planned page the owner's main action leads to (sitePlan.mainActionPage), or null. */
  readonly main_action_page?: string | null;
};

/**
 * v2 §4.1 rule 2 — the primary format: the format whose page the owner's main
 * action names; else the first ticked format in M1 order. Null with no ticks.
 */
export function primaryFormat(plan: FormatPlan): FormatKey | null {
  const formats = formatsForPlan(plan.offerings_selected);
  if (formats.length === 0) return null;
  const page = plan.main_action_page ?? null;
  if (page) {
    const named = formats.find((format) => FORMAT_PLANNED_PAGE[format] === page);
    if (named) return named;
  }
  return formats[0]!;
}

/** The other ticked formats (they add their listing page and at most two Home sections). */
export function secondaryFormats(plan: FormatPlan): FormatKey[] {
  const primary = primaryFormat(plan);
  return formatsForPlan(plan.offerings_selected).filter((format) => format !== primary);
}

/** v2 §4.1 rule 3 — venue formats need exactly one verified venue of their category. */
export const VENUE_FORMATS: readonly FormatKey[] = ["restaurants", "play", "art", "hotels"];

/**
 * #4572 item 6 (D6) — the format a site's STYLE is judged by (fit chips, Ari's
 * picks, the "avoid" lines). A gallery that also sells event tickets is still
 * a gallery: when "Creative & arts" is ticked and the primary format is not
 * itself a venue format, styles are judged as "art", so its look is never
 * called "too soft for a club night". Sections and pages keep primaryFormat.
 */
export function styleFormat(plan: FormatPlan): FormatKey | null {
  const primary = primaryFormat(plan);
  if (primary === null || VENUE_FORMATS.includes(primary)) return primary;
  return formatsForPlan(plan.offerings_selected).includes("art") ? "art" : primary;
}

/* ───────────────────────── primary actions ───────────────────────── */

/** The Mingla route kind a format's primary action resolves to (v2 §4.2 →). */
export type FormatActionRoute = "venue_book" | "venue_stay" | "trip" | "event" | "experience";

export type FormatAction = {
  /** Button label (≤ 24). Mingla's own words. */
  readonly label: string;
  /** Header button label (≤ 16, v2.1 §1.4). */
  readonly short: string;
  readonly route: FormatActionRoute;
};

export const FORMAT_PRIMARY_ACTION: Readonly<Record<FormatKey, FormatAction>> = {
  restaurants: { label: "Reserve a table", short: "Reserve", route: "venue_book" },
  hotels: { label: "Book a stay", short: "Book a stay", route: "venue_stay" },
  play: { label: "Book a visit", short: "Book a visit", route: "venue_book" },
  art: { label: "Get tickets", short: "Tickets", route: "event" },
  trips: { label: "Book this trip", short: "Book a trip", route: "trip" },
  events: { label: "Buy tickets", short: "Tickets", route: "event" },
  // #4453 — neutral for any experience brand (an arcade as much as a sound bath).
  experiences: { label: "Book now", short: "Book", route: "experience" },
};

/* ───────────────────────── sections ───────────────────────── */

/** Extras a section takes only when they are eligible on their own (never typed values). */
export type SectionExtra = "booking_bar" | "show_rating" | "fact_badge" | "show_search";

export type FormatSection = {
  readonly type: BlockType;
  /** The section's source options (sectionEligibility reads them). */
  readonly options?: SectionOptions;
  /** Added only when eligible; the section stays without them otherwise. */
  readonly extras?: readonly SectionExtra[];
  /** Short note of what the section is for (Ari's brief; never rendered). */
  readonly role?: string;
};

const s = (type: BlockType, options?: SectionOptions, extras?: readonly SectionExtra[], role?: string): FormatSection => ({
  type,
  ...(options ? { options } : {}),
  ...(extras ? { extras } : {}),
  ...(role ? { role } : {}),
});

/**
 * v2 §4.2 — each format's Home, in order. A section is placed only when
 * eligible (§6.4); v2.1 §1.1's `page_links` teaser sits before
 * `newsletter_signup` (milestone 7b).
 *
 * #4453 booking-first Home (Seth, 2026-11-18, after Gameland Lagos's live
 * Home opened on a plain header and two paragraphs of manifesto): every
 * format that sells a booking opens with the hero, then its booking block
 * (the listing grid and its times, the table times and menu, or the next
 * event and its tickets). A secondary format's offering or booking sections
 * follow straight after that block (composeFormat.ts), then the value
 * points, how it works, pictures and reviews, hours, questions, and the
 * sign-up last. The owner's long "who / why" text no longer sits on these
 * Homes (the hero carries the "why"; About keeps the bio).
 */
export const FORMAT_RECIPES: Readonly<Record<FormatKey, readonly FormatSection[]>> = {
  restaurants: [
    s("hero", undefined, ["booking_bar", "show_rating"]),
    s("availability", { source: "venue_slots" }, undefined, "table times"),
    s("menu_board"),
    s("marquee"),
    s("offering_grid", { kind: "event", mode: "upcoming" }, undefined, "ticketed dinners"),
    s("gallery"),
    s("testimonials", { from_collection: true }),
    s("hours_location"),
    s("faq"),
    s("page_links", { links: "teaser" }),
    s("newsletter_signup"),
  ],
  hotels: [
    s("hero", undefined, ["booking_bar", "show_rating"]),
    s("offering_grid", { kind: "stay", mode: "upcoming" }, undefined, "rooms"),
    s("availability", { source: "stay_nights" }, undefined, "nightly rates"),
    s("marquee"),
    s("feature_cards", undefined, undefined, "value points"),
    s("gallery"),
    s("testimonials", { from_collection: true }),
    s("hours_location", undefined, undefined, "arrival"),
    s("faq"),
    s("page_links", { links: "teaser" }),
    s("newsletter_signup"),
  ],
  play: [
    s("hero", undefined, ["booking_bar", "show_rating"]),
    s("offering_grid", { kind: "experience", mode: "upcoming" }, undefined, "lanes, rooms, parties"),
    s("availability", { source: "experience" }, undefined, "times you can book"),
    s("marquee"),
    s("feature_cards", undefined, undefined, "value points"),
    s("process_steps"),
    s("gallery"),
    s("offering_history"),
    s("testimonials", { from_collection: true }),
    s("hours_location"),
    s("faq"),
    s("page_links", { links: "teaser" }),
    s("newsletter_signup"),
  ],
  art: [
    s("hero", undefined, ["show_rating"]),
    s("marquee"),
    s("rich_text"),
    s("offering_grid", { kind: "event", mode: "upcoming" }, undefined, "exhibitions and openings"),
    s("availability", { source: "event" }, undefined, "dated events only"),
    s("gallery"),
    s("offering_history", undefined, undefined, "past exhibitions"),
    s("testimonials", { from_collection: true }),
    s("hours_location"),
    s("faq"),
    s("page_links", { links: "teaser" }),
    s("newsletter_signup"),
  ],
  trips: [
    s("hero", undefined, ["show_search", "show_rating"]),
    s("marquee"),
    s("offering_grid", { kind: "trip", mode: "upcoming" }),
    s("feature_cards", undefined, undefined, "value points"),
    s("availability", { source: "trip" }, undefined, "departures"),
    s("destination_grid"),
    s("offering_history"),
    s("testimonials", { from_collection: true }),
    s("story_grid"),
    s("faq"),
    s("page_links", { links: "teaser" }),
    s("newsletter_signup"),
  ],
  events: [
    s("hero", undefined, ["show_rating"]),
    s("offering_grid", { kind: "event", mode: "upcoming" }),
    s("ticket_tiers", undefined, undefined, "next headline event"),
    s("marquee"),
    s("gallery"),
    s("offering_history", undefined, undefined, "past nights"),
    s("testimonials", { from_collection: true }),
    s("faq"),
    s("page_links", { links: "teaser" }),
    s("newsletter_signup"),
  ],
  experiences: [
    s("hero", undefined, ["booking_bar", "fact_badge", "show_rating"]),
    s("offering_grid", { kind: "experience", mode: "upcoming" }),
    s("availability", { source: "experience" }, undefined, "times you can book"),
    s("marquee"),
    s("feature_cards", undefined, undefined, "value points"),
    s("process_steps"),
    s("gallery"),
    s("testimonials", { from_collection: true }),
    s("hours_location"),
    s("faq"),
    s("page_links", { links: "teaser" }),
    s("newsletter_signup"),
  ],
};

/**
 * #4453 booking-first Home — the section types that make a format's booking
 * block (the run right after the hero). A secondary format's Home sections
 * are placed straight after this run.
 */
export const HOME_BOOKING_TYPES: readonly BlockType[] = ["offering_grid", "availability", "ticket_tiers", "menu_board", "venue_reservation"];

/** The Home sections a secondary format contributes: its first eligible offering or booking section (≤ 2). */
export const SECONDARY_HOME_TYPES: readonly BlockType[] = ["offering_grid", "availability", "ticket_tiers", "menu_board"];
export const MAX_SECONDARY_HOME_SECTIONS = 2;

/* ───────────────────────── page sets (v2.1 §1.1) ───────────────────────── */

export type FormatPage = {
  readonly key: string;
  readonly slug: string;
  /** Menu label (≤ 16). */
  readonly label: string;
  readonly kind: "standard" | "collection_index";
  /** For a listing page: the offering kind it lists. */
  readonly collection?: "trips" | "events" | "experiences";
  /** The M1 planned page this page stands for (Core ticks "Build your pages" from it). */
  readonly planned?: "trips" | "events" | "experiences" | "menu" | "visit" | "rooms";
  /** Sections after the page header. */
  readonly sections: readonly FormatSection[];
  /** A listing page (secondary formats add only these). */
  readonly listing?: boolean;
};

/** v2.1 §1.1 — every inner (menu) page ends with "Keep exploring": the next pages in menu order. */
const NEXT_PAGES = s("page_links", { links: "next" });

const page = (
  key: string,
  label: string,
  sections: readonly FormatSection[],
  more: Partial<Pick<FormatPage, "kind" | "collection" | "planned" | "listing" | "slug">> = {},
): FormatPage => ({ key, slug: more.slug ?? key, label, kind: more.kind ?? "standard", sections: [...sections, NEXT_PAGES], ...more });

const REQUEST = s("cta", undefined, undefined, "a question to the brand, never a booking");

/**
 * v2.1 §1.1 — each format's menu pages, in order. Every inner page starts with
 * `page_header` and ends with `page_links` (milestone 7b). A listing page with
 * a `collection` lists that kind; composer v2 makes it the kind's detail base
 * (`/{slug}/{offering}`) when it may set that base (FORMAT_DETAIL_BASES).
 */
export const FORMAT_PAGE_SETS: Readonly<Record<FormatKey, readonly FormatPage[]>> = {
  restaurants: [
    page("menu", "Menu", [s("menu_board"), s("cta")], { planned: "menu", listing: true }),
    page("reserve", "Reserve", [s("venue_reservation"), s("availability", { source: "venue_slots" }), s("process_steps"), s("faq")]),
    page("private-dining", "Private dining", [s("feature_cards"), s("offering_grid", { kind: "event", mode: "upcoming" }), s("gallery"), REQUEST]),
    page("about", "About", [s("rich_text", { page: "about" }), s("feature_cards"), s("testimonials", { from_collection: true })]),
    page("visit", "Visit", [s("hours_location"), s("contact_details"), s("contact_form"), s("faq"), s("newsletter_signup")]),
  ],
  hotels: [
    page("rooms", "Rooms", [s("offering_grid", { kind: "stay", mode: "upcoming" }), s("feature_cards"), s("testimonials", { from_collection: true })], { planned: "rooms", listing: true }),
    page("rates", "Rates", [s("availability", { source: "stay_nights" }), s("facts_table"), s("faq")]),
    page("experiences", "Experiences", [s("offering_grid", { kind: "experience", mode: "upcoming" }), s("gallery")], { kind: "collection_index", collection: "experiences" }),
    page("the-area", "The area", [s("feature_cards"), s("hours_location")]),
    page("about", "About", [s("rich_text", { page: "about" }), s("testimonials", { from_collection: true }), s("newsletter_signup")]),
    page("contact", "Contact", [s("contact_details"), s("contact_form"), s("faq")]),
  ],
  play: [
    page("play", "Play", [s("offering_grid", { kind: "experience", mode: "upcoming" }), s("feature_cards"), s("offering_history")], { planned: "visit", listing: true, collection: "experiences" }),
    page("times", "Times & prices", [s("availability", { source: "experience" }), s("menu_board"), s("faq")]),
    page("parties", "Parties", [s("feature_cards"), s("offering_grid", { kind: "experience", mode: "upcoming" }), s("testimonials", { from_collection: true }), REQUEST]),
    page("visit", "Visit", [s("hours_location"), s("contact_details"), s("faq"), s("newsletter_signup")]),
  ],
  art: [
    page("exhibitions", "Exhibitions", [s("offering_grid", { kind: "event", mode: "upcoming" }), s("gallery"), s("offering_history")], { planned: "visit", listing: true, collection: "events" }),
    page("workshops", "Workshops", [s("process_steps"), s("offering_grid", { kind: "experience", mode: "upcoming" }), s("testimonials", { from_collection: true })], { collection: "experiences" }),
    page("visit", "Visit", [s("availability", { source: "event" }), s("hours_location"), s("faq")]),
    page("about", "About", [s("rich_text", { page: "about" }), s("feature_cards"), s("newsletter_signup")]),
  ],
  trips: [
    page("trips", "Trips", [s("offering_grid", { kind: "trip", mode: "upcoming" }), s("availability", { source: "trip" }), s("cta")], { kind: "collection_index", collection: "trips", planned: "trips", listing: true }),
    page("destinations", "Destinations", [s("destination_grid"), s("offering_history")]),
    page("stories", "Stories", [s("story_grid"), s("testimonials", { from_collection: true }), s("newsletter_signup")]),
    page("about", "About", [s("feature_cards"), s("rich_text", { page: "about" }), s("offering_history")]),
    page("faq", "FAQ", [s("faq"), s("facts_table")]),
  ],
  events: [
    page("events", "Events", [s("offering_grid", { kind: "event", mode: "upcoming" }), s("offering_history")], { kind: "collection_index", collection: "events", planned: "events", listing: true }),
    page("tickets", "Tickets", [s("ticket_tiers"), s("process_steps"), s("faq")]),
    page("gallery", "Gallery", [s("gallery"), s("testimonials", { from_collection: true })]),
    page("about", "About", [s("rich_text", { page: "about" }), s("feature_cards"), s("newsletter_signup")]),
  ],
  experiences: [
    // #4453 — the slugs `sessions` and `book-a-session` stay (existing sites route on them); the words are neutral.
    page("sessions", "Experiences", [s("offering_grid", { kind: "experience", mode: "upcoming" }), s("process_steps")], { planned: "experiences", listing: true, collection: "experiences" }),
    page("book-a-session", "Book", [s("availability", { source: "experience" }), s("faq")]),
    page("visit", "Visit", [s("destination_grid"), s("hours_location"), s("facts_table")]),
    page("about", "About", [s("rich_text", { page: "about" }), s("gallery"), s("testimonials", { from_collection: true })]),
  ],
};

/**
 * v2.1 §1.2 — the detail-page base each format's listing pages want, per
 * offering kind (restaurants keep `events`; hotels keep `rooms` and
 * `experiences`; trips and events keep theirs). Composer v2 sets a base only
 * where the site may move it (never published, and the owner left it empty);
 * otherwise the listing page stays a standard page and the base is untouched.
 */
export const FORMAT_DETAIL_BASES: Readonly<Record<FormatKey, Readonly<Partial<Record<"trips" | "events" | "experiences", string>>>>> = {
  restaurants: { events: "events" },
  hotels: { experiences: "experiences" },
  play: { experiences: "play" },
  art: { events: "exhibitions", experiences: "workshops" },
  trips: { trips: "trips" },
  events: { events: "events" },
  experiences: { experiences: "sessions" },
};

/* ───────────────────────── style fit (v2 §6.3 + v2.1 §2.4, N4) ───────────────────────── */

/** The ten styles Ari and the look picker offer (Atelier stays for gögi only). */
export const STYLE_KEYS: readonly DesignKey[] = ["voyage", "nocturne", "haven", "grid", "pop", "journal", "maison", "sunset", "pulse", "terra"];

export function isStyleKey(value: unknown): value is DesignKey {
  return typeof value === "string" && (STYLE_KEYS as readonly string[]).includes(value);
}

export type StyleFitLevel = "pick" | "fits" | "avoid";

/** The approved gallery's three picks per format, in order (★), with their fixed reasons. */
const PICKS: Readonly<Record<FormatKey, ReadonlyArray<readonly [DesignKey, string]>>> = {
  restaurants: [
    ["nocturne", "Dark, candlelit pages suit a late, wine-led room."],
    ["maison", "Quiet luxury for set menus and private dining."],
    ["journal", "A menu-first front page for a kitchen with a story."],
  ],
  hotels: [
    ["haven", "Calm and airy: it sells rest before it sells rooms."],
    ["maison", "Unhurried luxury for a small, considered stay."],
    ["voyage", "Big, bright photos for a place people travel to."],
  ],
  play: [
    ["pop", "Loud and generous, it already feels like a night out."],
    ["pulse", "Neon and kinetic, made for glow nights."],
    ["sunset", "Retro warmth for parties and group bookings."],
  ],
  art: [
    ["grid", "Swiss and exact: the work brings the colour."],
    ["journal", "Editorial pages for shows with something to say."],
    ["maison", "Gallery-white calm for a considered programme."],
  ],
  trips: [
    ["voyage", "Big landscapes and a sociable voice for group trips."],
    ["terra", "Earthy and handmade for slow, outdoor travel."],
    ["journal", "Stories first, for trips people read about before booking."],
  ],
  events: [
    ["pulse", "Neon and kinetic, built for line-ups and ticket drops."],
    ["nocturne", "Dark and editorial, for nights with taste."],
    ["grid", "Loud in one colour, like a gig poster."],
  ],
  experiences: [
    ["terra", "Organic and handmade, like a sauna by the water."],
    ["haven", "Calm and restorative for slow sessions."],
    ["sunset", "Golden-hour warmth for swims and social sessions."],
  ],
};

/** The pairs Ari never picks (✕), with the format's fixed "skipped" line. */
const AVOID: Readonly<Record<FormatKey, { readonly styles: readonly DesignKey[]; readonly line: string }>> = {
  restaurants: { styles: ["pop", "sunset"], line: "Pop and Sunset: too playful for evening dining." },
  hotels: { styles: ["grid", "pulse"], line: "Grid and Pulse: too loud for a calm stay." },
  play: { styles: ["maison", "haven"], line: "Maison and Haven: too hushed for bowling and karaoke." },
  art: { styles: ["pop"], line: "Pop: the style would compete with the art." },
  trips: { styles: ["pulse", "nocturne"], line: "Pulse and Nocturne: after-dark looks for daylight trips." },
  events: { styles: ["terra", "haven"], line: "Terra and Haven: too soft for a club night." },
  experiences: { styles: ["pulse", "grid"], line: "Pulse and Grid: too loud for a slow ritual." },
};

/** Each style in a few fixed words (for the ○ reasons). */
const STYLE_TRAIT: Readonly<Record<string, string>> = {
  voyage: "Bright photos and a sociable voice",
  nocturne: "Dark, editorial pages",
  haven: "Calm, airy pages",
  grid: "Exact, poster-like pages",
  pop: "Loud, generous colour",
  journal: "Editorial, story-first pages",
  maison: "Quiet, considered luxury",
  sunset: "Retro, golden-hour warmth",
  pulse: "Neon, kinetic energy",
  terra: "Earthy, handmade warmth",
};

const FORMAT_NOUN: Readonly<Record<FormatKey, string>> = {
  restaurants: "a restaurant or bar",
  hotels: "a place to stay",
  play: "a place to play",
  art: "a gallery or studio",
  trips: "group trips",
  events: "events and nights out",
  experiences: "experiences and activities",
};

/** The fixed words shown when an owner picks an "avoid" style (D6). Never blocks. */
export const STYLE_AVOID_WARNING = "This style is built for other kinds of places. Your bookings will still work.";

/** The fixed "Ari skipped" line for a format. */
export function skippedLine(format: FormatKey): string {
  return `Ari skipped ${AVOID[format].line}`;
}

/** The fixed fit level of one style for one format. */
export function styleFitLevel(format: FormatKey, style: DesignKey): StyleFitLevel {
  if (AVOID[format].styles.includes(style)) return "avoid";
  return PICKS[format].some(([key]) => key === style) ? "pick" : "fits";
}

/** The fixed reason sentence for one style × format (70 in all; N5: never a model call). */
export function styleFitReason(format: FormatKey, style: DesignKey): string {
  const pick = PICKS[format].find(([key]) => key === style);
  if (pick) return pick[1];
  if (AVOID[format].styles.includes(style)) return `${STYLE_TRAIT[style] ?? "This style"}: built for other kinds of places than ${FORMAT_NOUN[format]}.`;
  return `${STYLE_TRAIT[style] ?? "This style"}: also right for ${FORMAT_NOUN[format]}.`;
}

/** Mood signals from the owner's own answers (v2 §6.3 rule 2). */
export type StyleSignals = {
  /** The owner's descriptor chip (sitePlan VENUE_DESCRIPTOR_CHIPS). */
  readonly venue_descriptor?: string | null;
  /** Styles whose every candidate is within distance 1 of a live site (§6.6: they drop behind ○). */
  readonly taken?: ReadonlySet<DesignKey> | readonly DesignKey[];
};

/** Descriptor chip → the styles it leans towards (v2 §6.3 rule 2). */
export const MOOD_STYLES: Readonly<Record<string, readonly DesignKey[]>> = {
  Nightclub: ["pulse", "nocturne"],
  Rooftop: ["pulse", "nocturne"],
  "Cocktail bar": ["nocturne"],
  Gallery: ["grid", "journal"],
  "Café": ["terra", "sunset"],
  Studio: ["journal", "grid"],
  "Activity centre": ["pop", "sunset"],
};

export type StyleFit = {
  readonly style: DesignKey;
  readonly fit: StyleFitLevel;
  /** Fixed, Mingla-written sentence. */
  readonly reason: string;
  /** True when every candidate of this style is within distance 1 of a live site. */
  readonly taken: boolean;
};

/**
 * The ten styles for a format, ranked: ★ picks (mood first, then the gallery
 * order), ○ styles (mood first, then STYLE_KEYS order), then taken ★ and ○
 * styles, then ✕ last. Deterministic for the same inputs.
 */
export function styleFit(format: FormatKey, signals: StyleSignals = {}): StyleFit[] {
  const mood = MOOD_STYLES[signals.venue_descriptor ?? ""] ?? [];
  const taken = new Set<DesignKey>(signals.taken ?? []);
  const pickOrder = PICKS[format].map(([key]) => key);
  const rank = (style: DesignKey): number => {
    const level = styleFitLevel(format, style);
    const levelRank = level === "avoid" ? 4 : (taken.has(style) ? 2 : 0) + (level === "pick" ? 0 : 1);
    const moodRank = mood.includes(style) ? 0 : 1;
    const order = level === "pick" ? pickOrder.indexOf(style) : STYLE_KEYS.indexOf(style);
    return levelRank * 1000 + moodRank * 100 + order;
  };
  return [...STYLE_KEYS]
    .sort((a, b) => rank(a) - rank(b))
    .map((style) => ({ style, fit: styleFitLevel(format, style), reason: styleFitReason(format, style), taken: taken.has(style) }));
}

/** The top `count` styles Ari may suggest (never ✕). Milestone 10's three picks. */
export function topStylePicks(format: FormatKey, signals: StyleSignals = {}, count = 3): StyleFit[] {
  return styleFit(format, signals).filter((entry) => entry.fit !== "avoid").slice(0, count);
}

/* ───────────────────────── uniqueness (v2 §6.6) ───────────────────────── */

export type DesignFingerprint = {
  readonly design: string;
  readonly header: string | null;
  readonly hero: string | null;
  /** Home's `type:variant` sequence. */
  readonly home: readonly string[];
  /** `display|body` font families. */
  readonly fonts: string;
  /** Primary and accent colours, bucketed (`h<hue/30>l<lightness/34>`). */
  readonly colors: string;
};

/** A colour bucket: hue in 12 steps and lightness in 3, so near shades match. */
export function colorBucket(hex: string | null | undefined): string {
  const match = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!match) return "none";
  const value = parseInt(match[1]!, 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const grey = max - min < 0.08;
  return `${grey ? "g" : `h${Math.floor(hue / 30)}`}l${Math.min(2, Math.floor(light * 3))}`;
}

export function designFingerprint(input: {
  design: string;
  header?: string | null;
  hero?: string | null;
  home: ReadonlyArray<{ type: string; variant?: string | null }>;
  fonts?: { display?: string | null; body?: string | null } | null;
  primary?: string | null;
  accent?: string | null;
}): DesignFingerprint {
  return {
    design: input.design,
    header: input.header ?? null,
    hero: input.hero ?? null,
    home: input.home.map((block) => `${block.type}:${block.variant ?? ""}`).slice(0, 60),
    fonts: `${input.fonts?.display ?? ""}|${input.fonts?.body ?? ""}`,
    colors: `${colorBucket(input.primary)}/${colorBucket(input.accent)}`,
  };
}

/** How many of the six parts differ (0 = the same look; Ari needs ≥ 2 from every live site). */
export function fingerprintDistance(a: DesignFingerprint, b: DesignFingerprint): number {
  let distance = 0;
  if (a.design !== b.design) distance += 1;
  if (a.header !== b.header) distance += 1;
  if (a.hero !== b.hero) distance += 1;
  if (a.home.join(",") !== b.home.join(",")) distance += 1;
  if (a.fonts !== b.fonts) distance += 1;
  if (a.colors !== b.colors) distance += 1;
  return distance;
}

export const UNIQUE_MIN_DISTANCE = 2;

/** The fixed warning when a look is within distance 1 of a live Mingla site (D7: warns, never blocks). */
export const SIMILAR_TO_LIVE_SITE = "SIMILAR_TO_LIVE_SITE";
export const SIMILAR_TO_LIVE_SITE_MESSAGE = "Another live Mingla website looks very like this one. You can still use it, or change the opening picture layout or colours to stand out.";

/** The live fingerprints within distance 1 of a candidate (a count only: never which brands). */
export function similarLiveSites(candidate: DesignFingerprint, live: readonly DesignFingerprint[]): number {
  return live.filter((other) => fingerprintDistance(candidate, other) < UNIQUE_MIN_DISTANCE).length;
}

/** Parses a stored fingerprint (Core's `brand_sites.design_fingerprint`), or null. */
export function parseFingerprint(value: unknown): DesignFingerprint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 200) : null);
  if (typeof raw.design !== "string" || !Array.isArray(raw.home)) return null;
  return {
    design: raw.design.slice(0, 40),
    header: str(raw.header),
    hero: str(raw.hero),
    home: raw.home.filter((item): item is string => typeof item === "string").slice(0, 60).map((item) => item.slice(0, 80)),
    fonts: str(raw.fonts) ?? "|",
    colors: str(raw.colors) ?? "none/none",
  };
}
