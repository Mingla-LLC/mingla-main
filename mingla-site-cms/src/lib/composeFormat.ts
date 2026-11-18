/**
 * #4453 milestone 7 — composer v2 (spec v2 §4, §6.4, §6.7; spec v2.1 §1.1):
 * the brand's business-type format, in one style, filled only with Mingla's
 * own data and the owner's own answers.
 *
 * Deterministic (no AI). For the primary format it writes Home from
 * FORMAT_RECIPES and every page of FORMAT_PAGE_SETS, in order; each other
 * ticked format adds its listing page and at most two Home sections. A
 * section is placed only when `sectionEligibility` says its source holds real
 * content AND this file has that content in hand; a page whose every section
 * is left out is left out with its menu item, and the result says why.
 *
 * NOTHING IS INVENTED (Constitution 9). The only words written here are
 * Mingla's own (page names, section headings, button labels) and the owner's
 * verbatim answers (story, Q5 value points, Q6 FAQ, Q7 steps, Q8 ticker
 * phrases). No price, count, date, rating or review quote is ever written:
 * those are live fields the runtime fills from Mingla at request time.
 *
 * Every block this writes starts Draft: the compose endpoint and Ari's design
 * pass stamp them (`minglaReviewSource`), and publish is blocked until the
 * owner reviews them (UNREVIEWED_SECTIONS).
 *
 * invariant: I-SITES-COMPOSER-V2-NEVER-INVENTS — composer v2 writes only
 * Mingla's fixed words and the owner's own answers; every fact is a live
 * field (test: mingla-site-cms/src/lib/composeFormat.issue4453.test.ts).
 */
import {
  FORMAT_PAGE_SETS,
  FORMAT_PRIMARY_ACTION,
  FORMAT_RECIPES,
  MAX_SECONDARY_HOME_SECTIONS,
  SECONDARY_HOME_TYPES,
  designFingerprint,
  primaryFormat,
  secondaryFormats,
  type DesignFingerprint,
  type FormatKey,
  type FormatPage,
  type FormatSection,
} from "../contracts/generated/formats.ts";
import { sectionEligibility, type ContentInventory, type SectionReason } from "../contracts/generated/sectionSources.ts";
import { DEFAULT_SITE_ROUTES } from "../contracts/generated/routes.ts";
import { compositionHeader, compositionVariant, DESIGNS, HERO_LAYOUTS_WITH_FACTS, type DesignKey } from "../contracts/generated/designs.ts";
import { BOOKING_BLOCK_NEW_TYPES, isBlockType } from "../contracts/generated/blocks.ts";
import { mainActionPage, tickerPhrases, type FaqItem, type ProcessStep, type QuickFacts, type ValuePoint } from "../contracts/generated/sitePlan.ts";
import { lexicalParagraphs, type ComposeBrand, type ComposedBlock, type ComposeExistingPage } from "./composeFromPlan";

export type ComposeV2Answers = {
  value_points: readonly ValuePoint[];
  faq: readonly FaqItem[];
  process_steps: readonly ProcessStep[];
  quick_facts: QuickFacts | null;
};

export type ComposeV2Plan = {
  offerings_selected: readonly string[];
  venue_descriptor: string | null;
  story: { who?: string; why?: string; main_action?: string } | null;
};

/** Ids the composer may point blocks at (Mingla records and the site's own Studio records). */
export type ComposeV2Sources = {
  cover_media_id: string | null;
  /** Ready photos in the site's Media, newest first (id and its alt text). */
  photos: ReadonlyArray<{ id: string; alt: string | null }>;
  /** Enabled destinations in Studio. */
  destination_ids: readonly string[];
  /** The next bookable offering of each kind (Mingla ids). */
  next_offering: Readonly<Partial<Record<"trip" | "event" | "experience", string>>>;
  /** Bookable future dates or slots of that next offering (0 = none). */
  bookable: Readonly<Partial<Record<"trip" | "event" | "experience", number>>>;
  /** The one verified venue per format category, when there is exactly one. */
  venue_id: Readonly<Partial<Record<"restaurants" | "play" | "art" | "hotels", string>>>;
  /** The first live stay offering (rooms), for the stay availability strip. */
  stay_offering_id: string | null;
  /** The brand's own street address (Mingla brand field), or null. */
  address: string | null;
  /**
   * #4453 — the place's real opening hours, one row per day or range, when
   * Core sends them. Absent today: Core passes only the address.
   */
  hours?: ReadonlyArray<{ day: string; value: string }>;
};

export type ComposeV2Page = {
  key: string;
  slug: string;
  title: string;
  kind: "standard" | "collection_index";
  collection_kind?: "trips" | "events" | "experiences";
  planned_offering?: "trips" | "events" | "experiences";
  /** The M1 planned page this page stands for (Core ticks it). */
  planned?: string;
  blocks: ComposedBlock[];
};

/** #4453 milestone 7b — the detail-page kinds a listing page can be the base of. */
export type DetailKind = "trips" | "events" | "experiences";

export type ComposeV2Skip = { page: string; type: string; reason: SectionReason | "NO_SOURCE" };

export type ComposeV2Result = {
  format: FormatKey;
  secondary: FormatKey[];
  design: DesignKey;
  /** Every page this composition places, Home first. */
  pages: ComposeV2Page[];
  /** Pages absent at their address (to create). */
  create: ComposeV2Page[];
  /** Existing pages whose blocks are all still unreviewed Drafts (Ari's pass replaces them). */
  replace: Array<{ id: string; page: ComposeV2Page }>;
  /** Home, when it exists but is still empty from setup. */
  fillHome: ComposeV2Page | null;
  menu: { items: Array<{ key: string; label: string; slug: string }>; more: Array<{ key: string; label: string; slug: string }> };
  header_cta: { label: string; slug: string } | null;
  header_variant: string | null;
  wordmark: string;
  /** Sections and pages left out, and why (the plan shows the owner). */
  skipped: ComposeV2Skip[];
  left_out_pages: Array<{ key: string; reason: "NO_ELIGIBLE_SECTIONS" }>;
  fingerprint: DesignFingerprint & { format: FormatKey };
  /** #4453 milestone 7b — detail-page bases this composition sets (only kinds the site may move). */
  routes: Partial<Record<DetailKind, string>>;
};

export type ComposeV2Input = {
  plan: ComposeV2Plan;
  answers: ComposeV2Answers;
  brand: ComposeBrand;
  design: DesignKey;
  inventory: ContentInventory;
  sources: ComposeV2Sources;
  existing: ReadonlyArray<ComposeExistingPage & { allDraft?: boolean }>;
  currentWordmark: string | null;
  /** Ari's design pass may replace pages still entirely Draft; Build never does. */
  replaceDrafts?: boolean;
  fonts?: { display?: string | null; body?: string | null } | null;
  colors?: { primary?: string | null; accent?: string | null } | null;
  /**
   * #4453 milestone 7b (v2.1 §1.2) — the site's stored detail bases and
   * whether composer v2 may move them (Ari's pass on a site that never
   * published). Absent: no base is moved; a listing page is a listing
   * (collection_index) only where its slug already is its kind's base.
   */
  routes?: { stored: Readonly<Partial<Record<DetailKind, string | null>>>; canMove: boolean } | null;
  /**
   * #4453 — SITES_BOOKING_BLOCKS as Core signed it for this compose. False:
   * no booking block (availability, ticket tiers, how it works), no hero
   * booking bar and no Mingla rating is composed, because Studio's page gate
   * would refuse the write. Absent: unchanged (the plan preview never writes).
   */
  bookingBlocks?: boolean;
};

/** Mingla's own section headings (never a fact). */
const HEADING: Readonly<Record<string, string>> = {
  availability: "Times you can book",
  menu_board: "Menu",
  gallery: "Gallery",
  testimonials: "What people say",
  hours_location: "Find us",
  faq: "Questions",
  feature_cards: "Why come with us",
  process_steps: "How it works",
  destination_grid: "Where we go",
  story_grid: "Stories",
  ticket_tiers: "Tickets",
  newsletter_signup: "Hear about new dates first",
  contact_details: "Get in touch",
  facts_table: "Good to know",
  page_links: "Keep exploring",
};
const GRID_HEADING: Readonly<Record<string, string>> = {
  trip: "Upcoming trips",
  event: "What's on",
  experience: "Sessions",
  stay: "Rooms",
};
const HISTORY_HEADING: Readonly<Record<FormatKey, string>> = {
  restaurants: "Past dinners",
  hotels: "Past stays",
  play: "Past events",
  art: "Past exhibitions",
  trips: "Where we've been",
  events: "Past nights",
  experiences: "Past sessions",
};
const AVAILABILITY_SOURCE: Readonly<Record<string, string>> = {
  venue_slots: "venue_slots",
  stay_nights: "stay_nights",
  experience: "experience_slots",
  event: "event_dates",
  trip: "trip_departures",
};
const VENUE_FORMAT_FOR_SOURCE: Readonly<Partial<Record<FormatKey, "restaurants" | "play" | "art" | "hotels">>> = {
  restaurants: "restaurants",
  play: "play",
  art: "art",
  hotels: "hotels",
};

function clean(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

type Ctx = {
  input: ComposeV2Input;
  format: FormatKey;
  /** Slugs placed so far (same-site links must lead to a placed page). */
  placedSlugs: Set<string>;
  skipped: ComposeV2Skip[];
};

/** The inventory as one section sees it (bookable dates of the kind it shows). */
function inventoryFor(ctx: Ctx, section: FormatSection): ContentInventory {
  const source = section.options?.source;
  if (source === "experience" || source === "event" || source === "trip") {
    return { ...ctx.input.inventory, bookable_dates: ctx.input.sources.bookable[source] ?? 0 };
  }
  return ctx.input.inventory;
}

function eligible(ctx: Ctx, section: FormatSection, extra: Record<string, unknown> = {}): SectionReason | null {
  const verdict = sectionEligibility(section.type, inventoryFor(ctx, section), { ...(section.options ?? {}), ...extra });
  return verdict.eligible ? null : verdict.reason;
}

/** One section's block from real content, or null when its content is not in hand. */
function blockFor(ctx: Ctx, section: FormatSection, pageKey: string): ComposedBlock | null {
  const { input, format } = ctx;
  const { brand, answers, sources, plan } = input;
  const design = DESIGNS[input.design];
  const variant = isBlockType(section.type) ? compositionVariant(design, section.type) : undefined;
  const withVariant = (block: ComposedBlock): ComposedBlock => (variant ? { ...block, variant } : block);
  // #4453 — a block the design does not draw is never composed. Atelier is
  // frozen and offers no layout for the shared-only booking blocks
  // (availability, ticket tiers, process steps); the artifact refuses one on
  // an Atelier site, so composing it failed that site's preview and Build.
  if (isBlockType(section.type) && (design.variants[section.type] ?? []).length === 0) return null;
  // #4453 — with SITES_BOOKING_BLOCKS off, a booking block is left out.
  const bookingOff = input.bookingBlocks === false;
  if (bookingOff && (BOOKING_BLOCK_NEW_TYPES as readonly string[]).includes(section.type)) return null;
  const name = clean(brand.name, 120) ?? "";
  const tagline = clean(brand.tagline, 120);
  const who = clean(plan.story?.who, 300);
  const why = clean(plan.story?.why, 300);
  switch (section.type) {
    case "hero": {
      const media = sources.cover_media_id ?? sources.photos[0]?.id ?? null;
      if (!media) return null;
      const block: ComposedBlock = { blockType: "hero", heading: (tagline ?? name).slice(0, 120), media, ctas: [] };
      // The owner's "why" under the headline, unless it is the headline itself.
      if (why && why.toLowerCase() !== String(block.heading).toLowerCase()) block.subheading = why;
      const listing = FORMAT_PAGE_SETS[format].find((entry) => entry.listing);
      if (listing && ctx.placedSlugs.has(listing.slug)) {
        block.ctas = [{ label: FORMAT_PRIMARY_ACTION[format].label, href: `/${listing.slug}` }];
      }
      for (const extra of section.extras ?? []) {
        if (extra === "show_rating" && !bookingOff && eligible(ctx, section, { show_rating: true }) === null) block.show_rating = true;
        if (extra === "show_search" && eligible(ctx, section, { show_search: true }) === null) block.show_search = true;
        // #4453 milestone 7b — the owner's own Quick facts (Q8), verbatim, on hero layouts that draw them.
        if (extra === "fact_badge" && eligible(ctx, section, { fact_badge: true }) === null && variant && HERO_LAYOUTS_WITH_FACTS.includes(variant)) {
          const badges = (answers.quick_facts?.facts ?? []).filter((fact) => fact.big.trim() && fact.small.trim()).slice(0, 3).map((fact) => ({ big: fact.big.trim(), small: fact.small.trim() }));
          if (badges.length) block.fact_badges = badges;
        }
        if (extra === "booking_bar" && !bookingOff && eligible(ctx, section, { booking_bar: true }) === null) {
          const bar = heroBookingBar(ctx);
          if (bar) Object.assign(block, bar);
        }
      }
      return withVariant(block);
    }
    case "page_header":
      return { blockType: "page_header", heading: (tagline ?? name).slice(0, 120) };
    case "marquee": {
      const phrases = tickerPhrases(answers.quick_facts);
      return phrases.length >= 2 ? withVariant({ blockType: "marquee", phrases: phrases.slice(0, 12).map((text) => ({ text })) }) : null;
    }
    case "rich_text": {
      const bio = (brand.bio ?? "").trim();
      const paragraphs = section.options?.page === "about"
        ? (bio ? bio.split(/\n\s*\n/).map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean) : [])
        : [who, why].filter((part): part is string => Boolean(part));
      if (paragraphs.length === 0) return null;
      return withVariant({ blockType: "rich_text", width: "narrow", content: lexicalParagraphs(paragraphs) });
    }
    case "offering_grid": {
      const kind = section.options?.kind ?? "trip";
      return withVariant({
        blockType: "offering_grid",
        heading: GRID_HEADING[kind] ?? "What's on",
        kind,
        mode: "upcoming",
        offering_ids: [],
        ...(pageKey === "home" ? { limit: 3 } : {}),
      });
    }
    case "offering_history":
      return withVariant({ blockType: "offering_history", heading: HISTORY_HEADING[format], kind: "all" });
    case "availability": {
      const source = section.options?.source ?? "venue_slots";
      const block: ComposedBlock = { blockType: "availability", heading: HEADING.availability, source: AVAILABILITY_SOURCE[source] ?? source };
      if (source === "venue_slots") {
        const venueFormat = VENUE_FORMAT_FOR_SOURCE[format];
        const venue = venueFormat ? sources.venue_id[venueFormat] : undefined;
        if (!venue) return null;
        block.offering_id = venue;
      } else if (source === "stay_nights") {
        if (!sources.stay_offering_id) return null;
        block.stay_offering_id = sources.stay_offering_id;
      } else {
        const id = sources.next_offering[source as "trip" | "event" | "experience"];
        if (!id) return null;
        block.offering_id = id;
      }
      return withVariant(block);
    }
    case "ticket_tiers": {
      const id = sources.next_offering.event;
      return id ? withVariant({ blockType: "ticket_tiers", heading: HEADING.ticket_tiers, offering_id: id }) : null;
    }
    case "menu_board":
      return withVariant({ blockType: "menu_board", heading: HEADING.menu_board });
    case "venue_reservation":
      return withVariant({ blockType: "venue_reservation", heading: FORMAT_PRIMARY_ACTION[format].label });
    case "gallery": {
      const photos = sources.photos.slice(0, 8);
      if (photos.length < 3) return null;
      return withVariant({
        blockType: "gallery",
        heading: HEADING.gallery,
        images: photos.map((photo) => (clean(photo.alt, 240) ? { media: photo.id, alt: clean(photo.alt, 240) } : { media: photo.id })),
      });
    }
    case "testimonials": {
      const block: ComposedBlock = { blockType: "testimonials", heading: HEADING.testimonials, from_collection: true, items: [] };
      if (!bookingOff && eligible(ctx, section, { show_rating: true }) === null) block.show_rating = true;
      return withVariant(block);
    }
    case "hours_location": {
      // #4453 — the block needs at least one row of opening hours (the public
      // contract and Studio's own block both refuse an empty list). Composed
      // from the address alone, it failed every venue's plan preview and
      // Build (found live on Gameland Lagos, 2026-11-18). It waits for real
      // hours instead; the address alone is never padded with invented ones.
      const address = clean(sources.address, 300);
      const hours = (sources.hours ?? [])
        .map((row) => ({ day: clean(row.day, 20), value: clean(row.value, 80) }))
        .filter((row): row is { day: string; value: string } => Boolean(row.day && row.value))
        .slice(0, 7);
      return address && hours.length > 0
        ? withVariant({ blockType: "hours_location", heading: HEADING.hours_location, address, hours })
        : null;
    }
    case "faq":
      return answers.faq.length
        ? withVariant({ blockType: "faq", heading: HEADING.faq, items: answers.faq.slice(0, 12).map((item) => ({ question: item.question, answer: item.answer })) })
        : null;
    case "feature_cards":
      return answers.value_points.length >= 2
        ? withVariant({ blockType: "feature_cards", heading: HEADING.feature_cards, cards: answers.value_points.slice(0, 6).map((point) => ({ title: point.title, body: point.sentence })) })
        : null;
    case "process_steps":
      return answers.process_steps.length >= 3
        ? withVariant({
          blockType: "process_steps",
          heading: HEADING.process_steps,
          items: answers.process_steps.slice(0, 5).map((step) => ({ title: step.title, text: step.text, ...(step.time ? { time: step.time } : {}) })),
        })
        : null;
    case "destination_grid":
      return sources.destination_ids.length
        ? withVariant({ blockType: "destination_grid", heading: HEADING.destination_grid, destinations: sources.destination_ids.slice(0, 12).map((id) => ({ destination: id })) })
        : null;
    case "story_grid":
      return withVariant({ blockType: "story_grid", heading: HEADING.story_grid });
    case "contact_details": {
      const email = clean(brand.contact_email, 254);
      const city = clean(brand.city, 120);
      return email || city ? { blockType: "contact_details", heading: HEADING.contact_details, ...(email ? { email } : {}), ...(city ? { location: city } : {}) } : null;
    }
    case "contact_form":
      return { blockType: "contact_form", submit_label: "Send" };
    case "newsletter_signup":
      return { blockType: "newsletter_signup", heading: HEADING.newsletter_signup, button_label: "Sign up" };
    case "cta":
      return ctaFor(ctx, section, pageKey);
    // #4453 milestone 7b — the owner's facts (Q8: the small line names it, the big line is the detail), verbatim.
    case "facts_table": {
      const items = (answers.quick_facts?.facts ?? []).filter((fact) => fact.big.trim() && fact.small.trim()).slice(0, 8).map((fact) => ({ label: fact.small.trim(), value: fact.big.trim() }));
      return items.length ? withVariant({ blockType: "facts_table", heading: HEADING.facts_table, items }) : null;
    }
    // "Keep exploring": the builder fills the pages from the menu at publish.
    case "page_links":
      return withVariant({ blockType: "page_links", heading: HEADING.page_links, mode: section.options?.links === "teaser" ? "teaser" : "next" });
    default:
      return null;
  }
}

/** The hero booking bar's target: the brand's own venue, stay or next experience (Core resolves the page). */
function heroBookingBar(ctx: Ctx): Record<string, unknown> | null {
  const { format, input } = ctx;
  const { sources } = input;
  if (format === "restaurants" || format === "play") {
    const venue = sources.venue_id[format];
    return venue ? { booking_bar: "venue_table", booking_target_id: venue } : null;
  }
  if (format === "hotels") return sources.stay_offering_id ? { booking_bar: "stay", booking_target_id: sources.stay_offering_id } : null;
  if (format === "experiences") {
    const id = sources.next_offering.experience;
    return id ? { booking_bar: "experience", booking_target_id: id } : null;
  }
  return null;
}

/**
 * A `cta` leads only to a page placed on this site. A "request" cta is a
 * question to the brand (never booking words, BOOKING_THROUGH_ENQUIRY); the
 * others lead to the format's booking page.
 */
function ctaFor(ctx: Ctx, section: FormatSection, pageKey: string): ComposedBlock | null {
  const set = FORMAT_PAGE_SETS[ctx.format];
  const isRequest = section.role?.startsWith("a question") === true;
  if (isRequest) {
    const target = ["contact", "visit"].find((slug) => ctx.placedSlugs.has(slug) && slug !== pageKey);
    return target ? { blockType: "cta", heading: "Planning something bigger?", label: "Send a request", href: `/${target}` } : null;
  }
  const booking = set.find((entry) => entry.slug !== pageKey && entry.sections.some((s) => s.type === "venue_reservation" || s.type === "availability" || s.type === "ticket_tiers") && ctx.placedSlugs.has(entry.slug));
  if (booking) return { blockType: "cta", heading: FORMAT_PRIMARY_ACTION[ctx.format].label, label: FORMAT_PRIMARY_ACTION[ctx.format].short, href: `/${booking.slug}` };
  const faq = ctx.placedSlugs.has("faq") && pageKey !== "faq" ? "faq" : null;
  return faq ? { blockType: "cta", heading: "Questions before you book?", label: "Read the FAQ", href: "/faq" } : null;
}

/** Places a list of sections (eligibility, then content), recording what was left out. */
function placeSections(ctx: Ctx, sections: readonly FormatSection[], pageKey: string): ComposedBlock[] {
  const blocks: ComposedBlock[] = [];
  for (const section of sections) {
    // "Keep exploring" needs at least 2 OTHER placed pages to link to.
    const reason = section.type === "page_links"
      ? eligible(ctx, section, { other_pages: ctx.placedSlugs.size - (ctx.placedSlugs.has(pageSlugOf(pageKey)) ? 1 : 0) })
      : eligible(ctx, section);
    if (reason) {
      ctx.skipped.push({ page: pageKey, type: section.type, reason });
      continue;
    }
    const block = blockFor(ctx, section, pageKey);
    if (!block) {
      ctx.skipped.push({ page: pageKey, type: section.type, reason: "NO_SOURCE" });
      continue;
    }
    blocks.push(block);
  }
  return blocks;
}

/** Whether a page has at least one placeable section (cta and forms alone do not make a page). */
function pageHasContent(ctx: Ctx, entry: FormatPage): boolean {
  const filler = new Set(["cta", "contact_form", "newsletter_signup", "page_header", "page_links"]);
  return entry.sections.some((section) => !filler.has(section.type) && eligible(ctx, section) === null && blockFor(ctx, section, entry.key) !== null);
}

/** The page's address segment from its key ("home" is the site root). */
function pageSlugOf(key: string): string {
  return key === "home" ? "" : key;
}

function toPage(entry: FormatPage, blocks: ComposedBlock[], listing: boolean): ComposeV2Page {
  return {
    key: entry.key,
    slug: entry.slug,
    title: entry.label,
    // #4453 milestone 7b — a listing page lists its kind (and is its detail base) only where that base is its slug.
    kind: listing ? "collection_index" : "standard",
    ...(listing && entry.collection ? { collection_kind: entry.collection, planned_offering: entry.collection } : {}),
    ...(entry.planned ? { planned: entry.planned } : {}),
    blocks: [{ blockType: "page_header", heading: entry.label }, ...blocks],
  };
}

export function composeFormatSite(input: ComposeV2Input): ComposeV2Result | null {
  const mainAction = clean(input.plan.story?.main_action, 80);
  const formatPlan = { offerings_selected: input.plan.offerings_selected, main_action_page: mainActionPage(mainAction, input.plan.offerings_selected) };
  const format = primaryFormat(formatPlan);
  if (!format) return null;
  const secondary = secondaryFormats(formatPlan);
  const ctx: Ctx = { input, format, placedSlugs: new Set<string>(), skipped: [] };

  // ── Which pages have content (decided before any block, so links only lead to placed pages) ──
  const leftOut: Array<{ key: string; reason: "NO_ELIGIBLE_SECTIONS" }> = [];
  const primaryEntries = FORMAT_PAGE_SETS[format];
  const secondaryEntries: FormatPage[] = [];
  for (const other of secondary) {
    const listing = FORMAT_PAGE_SETS[other].find((entry) => entry.listing);
    if (listing && !primaryEntries.some((entry) => entry.slug === listing.slug) && !secondaryEntries.some((entry) => entry.slug === listing.slug)) {
      secondaryEntries.push(listing);
    }
  }
  const allEntries = [...primaryEntries, ...secondaryEntries.slice(0, 2)];
  const placedEntries: FormatPage[] = [];
  for (const entry of allEntries) {
    // A secondary format's listing is judged in that format's own terms.
    const owner = secondaryEntries.includes(entry) ? secondary.find((other) => FORMAT_PAGE_SETS[other].includes(entry)) ?? format : format;
    const judge: Ctx = { ...ctx, format: owner };
    if (pageHasContent(judge, entry)) {
      placedEntries.push(entry);
      ctx.placedSlugs.add(entry.slug);
    } else {
      leftOut.push({ key: entry.key, reason: "NO_ELIGIBLE_SECTIONS" });
    }
  }

  // ── Detail bases (v2.1 §1.2): a listing page is its kind's base only where it may be ──
  const routes: Partial<Record<DetailKind, string>> = {};
  const listingOf = (entry: FormatPage): boolean => {
    const kind = entry.collection;
    if (!kind) return false;
    const stored = clean(input.routes?.stored[kind] ?? null, 60);
    if (routes[kind] !== undefined) return routes[kind] === entry.slug;
    if ((stored ?? DEFAULT_SITE_ROUTES[kind]) === entry.slug) return true;
    // Moved only on a site that never published, where the owner left the base empty.
    if (input.routes?.canMove === true && stored === null) {
      routes[kind] = entry.slug;
      return true;
    }
    return false;
  };
  const listingSlugs = new Set(placedEntries.filter(listingOf).map((entry) => entry.slug));

  // ── Home ────────────────────────────────────────────────────────────────
  const recipe = FORMAT_RECIPES[format];
  const homeBlocks = placeSections(ctx, recipe, "home");
  if (homeBlocks[0]?.blockType !== "hero") homeBlocks.unshift(blockFor(ctx, { type: "page_header" }, "home")!);
  // Each secondary format adds at most two of its offering or booking sections, before the sign-up.
  const extras: ComposedBlock[] = [];
  for (const other of secondary) {
    const sub: Ctx = { ...ctx, format: other };
    const picked = FORMAT_RECIPES[other].filter((section) => SECONDARY_HOME_TYPES.includes(section.type));
    const placed = placeSections(sub, picked, "home").filter((block) =>
      !homeBlocks.some((existing) => existing.blockType === block.blockType && existing.kind === block.kind && existing.source === block.source));
    extras.push(...placed.slice(0, MAX_SECONDARY_HOME_SECTIONS));
  }
  const signUp = homeBlocks.findIndex((block) => block.blockType === "newsletter_signup");
  homeBlocks.splice(signUp < 0 ? homeBlocks.length : signUp, 0, ...extras);
  const home: ComposeV2Page = { key: "home", slug: "", title: "Home", kind: "standard", blocks: homeBlocks };

  // ── The page set ────────────────────────────────────────────────────────
  const inner = placedEntries.map((entry) => {
    const owner = secondaryEntries.includes(entry) ? secondary.find((other) => FORMAT_PAGE_SETS[other].includes(entry)) ?? format : format;
    return toPage(entry, placeSections({ ...ctx, format: owner }, entry.sections, entry.key), listingSlugs.has(entry.slug));
  });
  const pages = [home, ...inner];

  // ── What exists already is kept (Ari's pass may replace all-Draft pages) ──
  const topLevel = new Map(input.existing.filter((page) => page.topLevel).map((page) => [page.slug, page]));
  const create: ComposeV2Page[] = [];
  const replace: Array<{ id: string; page: ComposeV2Page }> = [];
  let fillHome: ComposeV2Page | null = null;
  for (const page of pages) {
    const found = topLevel.get(page.slug);
    if (!found) create.push(page);
    else if (found.blockCount === 0 && page.key === "home") fillHome = page;
    else if (input.replaceDrafts === true && (found.blockCount === 0 || found.allDraft === true)) replace.push({ id: found.id, page });
  }

  // ── Menu: primary pages in order, secondary listings, then About / Contact / FAQ last ──
  const last = new Set(["about", "contact", "faq"]);
  const ordered = [
    ...inner.filter((page) => !last.has(page.key) && !secondaryEntries.some((entry) => entry.slug === page.slug)),
    ...inner.filter((page) => secondaryEntries.some((entry) => entry.slug === page.slug)),
    ...inner.filter((page) => last.has(page.key)),
  ].slice(0, 8).map((page) => ({ key: page.key, label: page.title.slice(0, 16), slug: page.slug }));
  const menu = ordered.length > 6 ? { items: ordered.slice(0, 5), more: ordered.slice(5) } : { items: ordered, more: [] };

  const action = FORMAT_PRIMARY_ACTION[format];
  const bookingPage = placedEntries.find((entry) => entry.listing) ?? null;
  const design = DESIGNS[input.design];
  const header = compositionHeader(design);
  const heroBlock = homeBlocks.find((block) => block.blockType === "hero");
  const fingerprint = {
    ...designFingerprint({
      design: input.design,
      header,
      hero: typeof heroBlock?.variant === "string" ? heroBlock.variant : null,
      home: homeBlocks.map((block) => ({ type: block.blockType, variant: typeof block.variant === "string" ? block.variant : null })),
      fonts: input.fonts ?? { display: design.fonts.display?.family ?? null, body: design.fonts.body?.family ?? null },
      primary: input.colors?.primary ?? null,
      accent: input.colors?.accent ?? null,
    }),
    format,
  };
  return {
    format,
    secondary,
    design: input.design,
    pages,
    create,
    replace,
    fillHome,
    menu,
    header_cta: bookingPage ? { label: action.short, slug: bookingPage.slug } : null,
    header_variant: header,
    wordmark: clean(input.currentWordmark, 60) ?? (clean(input.brand.name, 60) ?? ""),
    skipped: ctx.skipped,
    left_out_pages: leftOut,
    fingerprint,
    routes,
  };
}

/** The planned (M1) page keys a v2 composition stands for: what Core may tick. */
export function plannedKeysOf(result: ComposeV2Result): string[] {
  const keys = new Set<string>(["home"]);
  for (const page of result.pages) {
    if (page.planned) keys.add(page.planned);
    if (page.key === "about" || page.key === "contact") keys.add(page.key);
  }
  return [...keys];
}
