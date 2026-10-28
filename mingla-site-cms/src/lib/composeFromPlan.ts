/**
 * #2829 W9a — the deterministic composer (no AI): "Create website draft".
 *
 * Builds a site's pages from the owner's approved plan and Mingla's own
 * brand fields, in the chosen design's layouts:
 *   - Home: the brand's line over a colour panel (no photo is ever invented),
 *     the main action, the main offering's live grid, reviews only when the
 *     brand has confirmed ones, and the email sign-up;
 *   - one page per ticked offering kind: a live list with the honest empty
 *     state from the design contract's rules table and a form;
 *   - About: the bio, else the owner's story answers;
 *   - Contact: the contact form and the contact details Mingla holds.
 * Menu (M1): Home is the logo; then the main offering, the other offerings in
 * fixed order, then About and Contact; the 6th onward under "More".
 *
 * TEXT COMES ONLY FROM BRAND FIELDS AND THE OWNER'S ANSWERS. A block whose
 * source text is missing is left out, never filled with placeholder copy.
 * The only fixed words are Mingla's own: page names, form labels and the
 * empty-state lines (site-contracts emptyStates.ts, verbatim).
 *
 * Additive and safe to run again: a page that already exists at its address
 * is kept exactly as it is (an owner's Studio edits are never overwritten),
 * except a Home page still empty from setup, which is filled.
 */
import {
  PLANNED_PAGE_EMPTY_STATES,
  PLANNED_PAGE_LABELS,
  type PlannedPageKey,
} from "../contracts/generated/emptyStates.ts";
import { mainActionPage, planMenu, plannedPagesFor, type MenuEntryKey } from "../contracts/generated/sitePlan.ts";

export type ComposeBrand = {
  name: string;
  tagline: string | null;
  bio: string | null;
  contact_email: string | null;
  city: string | null;
};

export type ComposePlan = {
  offerings_selected: readonly string[];
  venue_descriptor: string | null;
  story: { who?: string; why?: string; main_action?: string } | null;
};

export type ComposeExistingPage = {
  id: string;
  slug: string;
  /** No parent: a top-level page (the composer only ever looks at those). */
  topLevel: boolean;
  blockCount: number;
};

export type ComposedPageKey = "home" | PlannedPageKey | "about" | "contact";

export type ComposedBlock = Record<string, unknown> & { blockType: string };

export type ComposedPage = {
  key: ComposedPageKey;
  slug: string;
  title: string;
  kind: "standard" | "collection_index";
  collection_kind?: "trips" | "events" | "experiences";
  planned_offering?: "trips" | "events" | "experiences";
  blocks: ComposedBlock[];
};

export type ComposeResult = {
  /** Pages to create (absent at their address). */
  create: ComposedPage[];
  /** Home, when it exists but is still empty from setup. */
  fillHome: ComposedPage | null;
  /** Every page the plan asks for, existing or new (what Core records). */
  pages: ComposedPageKey[];
  /** The header menu in M1 order (addresses; Home is the logo). */
  menu: { items: Array<{ key: MenuEntryKey; label: string; slug: string }>; more: Array<{ key: MenuEntryKey; label: string; slug: string }> };
  /** Text shown in the header when the brand has no logo. */
  wordmark: string;
};

const SLUG: Readonly<Record<Exclude<ComposedPageKey, "home">, string>> = {
  trips: "trips",
  events: "events",
  experiences: "experiences",
  menu: "menu",
  visit: "visit",
  rooms: "rooms",
  about: "about",
  contact: "contact",
};

const GRID_KIND: Readonly<Record<"trips" | "events" | "experiences", "trip" | "event" | "experience">> = {
  trips: "trip",
  events: "event",
  experiences: "experience",
};

function clean(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

/** Paragraphs → the Lexical tree Studio stores (plain text only, no markup). */
export function lexicalParagraphs(paragraphs: readonly string[]): Record<string, unknown> {
  return {
    root: {
      type: "root",
      format: "",
      indent: 0,
      version: 1,
      direction: "ltr",
      children: paragraphs.map((text) => ({
        type: "paragraph",
        format: "",
        indent: 0,
        version: 1,
        direction: "ltr",
        textFormat: 0,
        textStyle: "",
        children: [{ type: "text", detail: 0, format: 0, mode: "normal", style: "", text, version: 1 }],
      })),
    },
  };
}

function pageHeader(heading: string): ComposedBlock {
  return { blockType: "page_header", heading };
}

function newsletter(page: PlannedPageKey | null): ComposedBlock {
  const words = page ? PLANNED_PAGE_EMPTY_STATES[page] : PLANNED_PAGE_EMPTY_STATES.events;
  return { blockType: "newsletter_signup", heading: words.form_heading, button_label: words.form_button };
}

function offeringPage(page: "trips" | "events" | "experiences"): ComposedPage {
  const words = PLANNED_PAGE_EMPTY_STATES[page];
  const label = PLANNED_PAGE_LABELS[page].menu;
  const grid: ComposedBlock = {
    blockType: "offering_grid",
    kind: GRID_KIND[page],
    mode: "upcoming",
    offering_ids: [],
    empty_text: words.text,
  };
  // Trips ask where people want to go (a message to the owner); events and
  // experiences collect emails to hear first (design contract rules table).
  const form: ComposedBlock = page === "trips"
    ? { blockType: "contact_form", heading: words.form_heading, message_label: "Where do you want to go?", submit_label: words.form_button }
    : newsletter(page);
  return {
    key: page,
    slug: SLUG[page],
    title: label,
    kind: "collection_index",
    collection_kind: page,
    planned_offering: page,
    blocks: [pageHeader(label), grid, form],
  };
}

function venuePage(page: "menu" | "visit" | "rooms"): ComposedPage {
  const words = PLANNED_PAGE_EMPTY_STATES[page];
  const label = PLANNED_PAGE_LABELS[page].menu;
  const blocks: ComposedBlock[] = [pageHeader(label)];
  if (page === "rooms") {
    blocks.push({ blockType: "contact_form", heading: words.text, message_label: "Your dates and who's coming", submit_label: words.form_button });
  } else {
    // #2829 W11 (R1 E28) — until bookings are on, the reservation action is
    // absent and the honest replacement says exactly what the guest can do.
    blocks.push({ blockType: "cta", heading: words.text, label: "Message to book", href: "/contact" });
  }
  return { key: page, slug: SLUG[page], title: label, kind: "standard", blocks };
}

export function composeFromPlan(input: {
  plan: ComposePlan;
  brand: ComposeBrand;
  hasConfirmedTestimonials: boolean;
  existing: readonly ComposeExistingPage[];
  currentWordmark: string | null;
  /** #2829 W11 (A17): the brand's Mingla cover, imported as site media, or null. */
  coverMediaId?: string | null;
}): ComposeResult {
  const { plan, brand } = input;
  const name = clean(brand.name, 120) ?? "";
  const tagline = clean(brand.tagline, 120);
  const bio = (brand.bio ?? "").trim();
  const who = clean(plan.story?.who, 300);
  const why = clean(plan.story?.why, 300);
  const mainAction = clean(plan.story?.main_action, 80);
  const planned = plannedPagesFor(plan.offerings_selected);
  const mainPage = mainActionPage(mainAction, plan.offerings_selected);

  // ── Home ────────────────────────────────────────────────────────────────
  const homeBlocks: ComposedBlock[] = [];
  // #2829 W11 (A17): the brand's own cover photo opens Home when it has one;
  // with none, an intentional colour panel with the brand's own line.
  homeBlocks.push(input.coverMediaId
    ? { blockType: "hero", heading: (tagline ?? name).slice(0, 120), media: input.coverMediaId, ctas: [] }
    : pageHeader(tagline ?? name));
  if (mainAction && mainAction.toLowerCase() !== "join the list") {
    const href = mainPage ? `/${SLUG[mainPage]}` : "/contact";
    // The heading is the owner's own "why" answer, else the brand's name.
    homeBlocks.push({ blockType: "cta", heading: (why ?? name).slice(0, 120), label: mainAction, href });
  }
  const gridPage = (mainPage && (mainPage === "trips" || mainPage === "events" || mainPage === "experiences"))
    ? mainPage
    : planned.find((page): page is "trips" | "events" | "experiences" => page === "trips" || page === "events" || page === "experiences");
  if (gridPage) {
    homeBlocks.push({
      blockType: "offering_grid",
      heading: PLANNED_PAGE_LABELS[gridPage].menu,
      kind: GRID_KIND[gridPage],
      mode: "upcoming",
      offering_ids: [],
      limit: 3,
      empty_text: PLANNED_PAGE_EMPTY_STATES[gridPage].text,
      cta_label: PLANNED_PAGE_LABELS[gridPage].action,
      cta_href: `/${SLUG[gridPage]}`,
    });
  }
  if (input.hasConfirmedTestimonials) {
    homeBlocks.push({ blockType: "testimonials", from_collection: true, items: [] });
  }
  homeBlocks.push(newsletter(null));
  const home: ComposedPage = { key: "home", slug: "", title: "Home", kind: "standard", blocks: homeBlocks };

  // ── Offering pages ──────────────────────────────────────────────────────
  const offeringPages = planned.map((page) =>
    page === "trips" || page === "events" || page === "experiences" ? offeringPage(page) : venuePage(page));

  // ── About ───────────────────────────────────────────────────────────────
  const aboutParagraphs = bio
    ? bio.split(/\n\s*\n/).map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean)
    : [who, why].filter((part): part is string => Boolean(part));
  const about: ComposedPage = {
    key: "about",
    slug: SLUG.about,
    title: "About",
    kind: "standard",
    blocks: [
      pageHeader("About"),
      ...(aboutParagraphs.length ? [{ blockType: "rich_text", width: "narrow", content: lexicalParagraphs(aboutParagraphs) }] : []),
    ],
  };

  // ── Contact ─────────────────────────────────────────────────────────────
  const email = clean(brand.contact_email, 254);
  const city = clean(brand.city, 120);
  const contact: ComposedPage = {
    key: "contact",
    slug: SLUG.contact,
    title: "Contact",
    kind: "standard",
    blocks: [
      pageHeader("Contact"),
      { blockType: "contact_form", submit_label: "Send" },
      ...(email || city
        ? [{ blockType: "contact_details", ...(email ? { email } : {}), ...(city ? { location: city } : {}) }]
        : []),
    ],
  };

  // ── What exists already is kept ─────────────────────────────────────────
  const topLevel = new Map(input.existing.filter((page) => page.topLevel).map((page) => [page.slug, page]));
  const wanted = [home, ...offeringPages, about, contact];
  const create: ComposedPage[] = [];
  let fillHome: ComposedPage | null = null;
  for (const page of wanted) {
    const found = topLevel.get(page.slug);
    if (!found) create.push(page);
    else if (page.key === "home" && found.blockCount === 0) fillHome = page;
  }

  const menu = planMenu(plan.offerings_selected, mainAction);
  const withSlug = (entry: { key: MenuEntryKey; label: string }) => ({ ...entry, slug: SLUG[entry.key] });
  return {
    create,
    fillHome,
    pages: wanted.map((page) => page.key),
    menu: { items: menu.items.map(withSlug), more: menu.more.map(withSlug) },
    wordmark: clean(input.currentWordmark, 60) ?? name.slice(0, 60),
  };
}
