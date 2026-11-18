// MINGLA-INVARIANT: I-SITES-COMPOSER-V2-NEVER-INVENTS | issue #4453 | composer v2 writes only Mingla's fixed words and the owner's own answers; every fact is a live field, and a section or page with no content is left out.
/*
 * #4453 milestone 7 — composer v2 (SC-F1, SC-F2, SC-N4, v2 §6.2 "never
 * invents"): every format composes its §4.2 Home order and its §1.1 page set
 * on a full fixture, and only always-eligible sections on an empty one; empty
 * sections and pages are left out; nothing typed is a fact.
 *
 * invariant: I-SITES-COMPOSER-V2-NEVER-INVENTS (declared on line 1 of this file).
 */
import { describe, expect, it } from "vitest";
import { composeFormatSite, plannedKeysOf, type ComposeV2Input } from "./composeFormat";
import { FORMAT_DETAIL_BASES, FORMAT_KEYS, FORMAT_PAGE_SETS, FORMAT_RECIPES, type FormatKey } from "../contracts/generated/formats.ts";
import { EMPTY_INVENTORY, type ContentInventory } from "../contracts/generated/sectionSources.ts";
import { STYLE_KEYS } from "../contracts/generated/formats.ts";
import { tickerPhrases } from "../contracts/generated/sitePlan.ts";

const OFFERING_FOR: Record<FormatKey, string> = {
  trips: "trips",
  events: "events",
  experiences: "experiences",
  restaurants: "venue_food_drink",
  play: "venue_play",
  art: "venue_creative_arts",
  hotels: "venue_stay",
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const FULL_INVENTORY: ContentInventory = {
  ...EMPTY_INVENTORY,
  upcoming: { trip: 4, event: 3, experience: 3 },
  ended: { trip: 6, event: 5, experience: 2 },
  confirmed_reviews: 8,
  enabled_destinations: 5,
  enabled_stories: 4,
  ready_photos: 10,
  value_points: 3,
  faq_items: 4,
  process_steps: 4,
  quick_facts: 2,
  ticker_phrases: 4,
  mingla_reviews: 25,
  has_bio: true,
  has_tagline: true,
  has_contact_email: true,
  has_city: true,
  has_cover: true,
  verified_venues: 1,
  venue_reservations_on: true,
  open_venue_slots: 12,
  live_stay_offerings: 3,
  sellable_nights: 40,
  bookable_dates: 6,
  public_ticket_tiers: 3,
  published_menu: true,
  booking_target: true,
};

function full(format: FormatKey, design = "voyage" as ComposeV2Input["design"]): ComposeV2Input {
  return {
    plan: { offerings_selected: [OFFERING_FOR[format]], venue_descriptor: null, story: { who: "Small groups of friends", why: "We go further together" } },
    answers: {
      value_points: [{ title: "Two guides", sentence: "Every group has two local guides." }, { title: "Small groups", sentence: "Never more than twelve people." }, { title: "Booked nights", sentence: "Every night is booked for you." }],
      faq: [{ question: "How fit do I need to be?", answer: "You walk about five hours a day." }],
      process_steps: [{ title: "Pick a date", text: "Choose a departure." }, { title: "Pay a deposit", text: "Hold your place." }, { title: "Go", text: "Meet the group." }],
      quick_facts: { facts: [{ big: "12", small: "people per group" }], use_in_ticker: true, ticker: ["Small groups", "Local guides", "Every night booked"] },
    },
    brand: { name: "Young and Stamped", tagline: "Go far. Go together.", bio: "We run small-group trips.\n\nTwo guides on every trip.", contact_email: "hello@example.com", city: "London" },
    design,
    inventory: FULL_INVENTORY,
    sources: {
      cover_media_id: "media-cover",
      photos: Array.from({ length: 10 }, (_, i) => ({ id: `media-${i}`, alt: `Photo ${i}` })),
      destination_ids: ["dest-1", "dest-2"],
      next_offering: { trip: id(1), event: id(2), experience: id(3) },
      bookable: { trip: 4, event: 2, experience: 6 },
      venue_id: { restaurants: id(10), play: id(11), art: id(12), hotels: id(13) },
      stay_offering_id: id(20),
      address: "1 High Street, London",
      hours: [{ day: "Every day", value: "12pm to 12am" }],
    },
    existing: [],
    currentWordmark: null,
  };
}

function empty(format: FormatKey): ComposeV2Input {
  return {
    plan: { offerings_selected: [OFFERING_FOR[format]], venue_descriptor: null, story: null },
    answers: { value_points: [], faq: [], process_steps: [], quick_facts: null },
    brand: { name: "New Brand", tagline: null, bio: null, contact_email: null, city: null },
    design: "voyage",
    inventory: EMPTY_INVENTORY,
    sources: { cover_media_id: null, photos: [], destination_ids: [], next_offering: {}, bookable: {}, venue_id: {}, stay_offering_id: null, address: null },
    existing: [],
    currentWordmark: null,
  };
}

const ALWAYS = new Set(["newsletter_signup", "contact_form", "page_header", "cta", "divider", "spacer"]);

describe("#4453 composer v2 — each format on a full fixture (SC-F2, SC-N4)", () => {
  for (const format of FORMAT_KEYS) {
    it(`${format}: Home follows the §4.2 order and every page of the set is placed in order`, () => {
      const result = composeFormatSite(full(format))!;
      expect(result.format).toBe(format);
      const home = result.pages[0]!;
      expect(home.key).toBe("home");
      const order = FORMAT_RECIPES[format].map((section) => section.type);
      expect(home.blocks.map((block) => block.blockType)).toEqual(order);
      expect(result.pages.slice(1).map((page) => page.slug)).toEqual(FORMAT_PAGE_SETS[format].map((page) => page.slug));
      for (const page of result.pages.slice(1)) {
        expect(page.blocks[0]).toMatchObject({ blockType: "page_header", heading: page.title });
      }
      expect(result.left_out_pages).toEqual([]);
      expect(result.menu.items.length + result.menu.more.length).toBe(FORMAT_PAGE_SETS[format].length);
      expect(result.header_cta?.label.length).toBeLessThanOrEqual(16);
    });
  }
});

describe("#4453 composer v2 — an empty brand (SC-F2)", () => {
  for (const format of FORMAT_KEYS) {
    it(`${format}: only always-eligible sections, and every page without content left out`, () => {
      const result = composeFormatSite(empty(format))!;
      for (const page of result.pages) {
        for (const block of page.blocks) expect(ALWAYS.has(block.blockType), `${page.key}:${block.blockType}`).toBe(true);
      }
      expect(result.pages[0]!.blocks.map((block) => block.blockType)).toEqual(["page_header", "newsletter_signup"]);
      // No page is just a header and a form: a page with no real section is left out with its menu item.
      for (const page of result.pages.slice(1)) {
        expect(page.blocks.some((block) => !["page_header", "cta", "contact_form", "newsletter_signup"].includes(block.blockType))).toBe(true);
      }
      expect(result.menu.items.map((item) => item.slug)).toEqual(result.pages.slice(1).map((page) => page.slug));
      expect(result.skipped.length).toBeGreaterThan(0);
    });
  }
});

describe("#4453 composer v2 — never invents (Constitution 9)", () => {
  it("writes no price, count, date, rating number or review quote; testimonials only from the collection", () => {
    for (const format of FORMAT_KEYS) {
      const result = composeFormatSite(full(format))!;
      const text = JSON.stringify(result.pages);
      expect(text).not.toMatch(/£|\$|€|₦|\bspots? left\b|\btables? left\b|\b\d+(\.\d)?\s*(stars?|★)/i);
      // M8 share view: nothing owner-only rides in a composed page (no samples, owner questions or unconfirmed reviews).
      expect(text).not.toMatch(/"sample"|owner_question|confirmed_real|"review":/);
      for (const page of result.pages) {
        for (const block of page.blocks) {
          for (const banned of ["price", "price_minor", "min_price_minor", "count", "rating", "score", "spots_left", "start_at", "date"]) {
            expect(block, `${format}:${page.key}:${block.blockType}`).not.toHaveProperty(banned);
          }
          if (block.blockType === "testimonials") {
            expect(block.from_collection).toBe(true);
            expect(block.items).toEqual([]);
          }
        }
      }
    }
  });

  it("every typed word is Mingla's own or the owner's verbatim answer", () => {
    const input = full("trips");
    const result = composeFormatSite(input)!;
    const faq = result.pages.flatMap((page) => page.blocks).find((block) => block.blockType === "faq")!;
    expect(faq.items).toEqual(input.answers.faq);
    const steps = composeFormatSite(full("experiences"))!.pages.flatMap((page) => page.blocks).find((block) => block.blockType === "process_steps")!;
    expect((steps.items as Array<{ title: string }>).map((step) => step.title)).toEqual(input.answers.process_steps.map((step) => step.title));
    const marquee = result.pages[0]!.blocks.find((block) => block.blockType === "marquee")!;
    expect(marquee.phrases).toEqual(tickerPhrases(input.answers.quick_facts).map((text) => ({ text })));
    expect(tickerPhrases(input.answers.quick_facts)).toEqual(expect.arrayContaining(input.answers.quick_facts!.ticker));
  });

  it("the hero rating appears only with 20+ approved Mingla reviews", () => {
    const base = full("restaurants");
    expect(composeFormatSite(base)!.pages[0]!.blocks[0]).toMatchObject({ blockType: "hero", show_rating: true });
    const few = { ...base, inventory: { ...base.inventory, mingla_reviews: 19 } };
    expect(composeFormatSite(few)!.pages[0]!.blocks[0]).not.toHaveProperty("show_rating");
  });

  it("every same-site link leads to a page this composition places", () => {
    for (const format of FORMAT_KEYS) {
      for (const input of [full(format), empty(format)]) {
        const result = composeFormatSite(input)!;
        const slugs = new Set(result.pages.map((page) => page.slug));
        const hrefs = result.pages.flatMap((page) => page.blocks).flatMap((block) => [
          ...(typeof block.href === "string" ? [block.href] : []),
          ...((block.ctas as Array<{ href: string }> | undefined) ?? []).map((cta) => cta.href),
        ]);
        for (const href of hrefs) expect(slugs.has(href.replace(/^\//, "")), `${format} ${href}`).toBe(true);
      }
    }
  });

  it("request buttons never use booking words (BOOKING_THROUGH_ENQUIRY)", () => {
    for (const format of ["restaurants", "play"] as const) {
      const ctas = composeFormatSite(full(format))!.pages.flatMap((page) => page.blocks).filter((block) => block.blockType === "cta");
      for (const cta of ctas.filter((block) => block.label === "Send a request")) {
        expect(`${cta.heading} ${cta.label}`).not.toMatch(/\b(book|reserve|ticket|deposit|stay)/i);
      }
    }
  });
});

describe("#4453 composer v2 — formats, secondaries and styles", () => {
  it("primary follows the main action; a second tick adds its listing page and ≤ 2 Home sections", () => {
    const input = full("trips");
    input.plan = { ...input.plan, offerings_selected: ["trips", "events"], story: { ...input.plan.story, main_action: "Come to an event" } };
    const byAction = composeFormatSite(input)!;
    expect(byAction.format).toBe("events");
    expect(byAction.secondary).toEqual(["trips"]);
    const both = composeFormatSite({ ...input, plan: { ...input.plan, story: { why: "x" } } })!;
    expect(both.format).toBe("trips");
    expect(both.secondary).toEqual(["events"]);
    expect(both.pages.map((page) => page.slug)).toContain("events");
    const homeGrids = both.pages[0]!.blocks.filter((block) => block.blockType === "offering_grid");
    expect(homeGrids.map((block) => block.kind)).toEqual(["trip", "event"]);
    expect(plannedKeysOf(both)).toEqual(expect.arrayContaining(["home", "trips", "events", "about"]));
  });

  it("composes in every one of the ten styles with that style's layouts", () => {
    for (const style of STYLE_KEYS) {
      const result = composeFormatSite(full("trips", style))!;
      expect(result.design).toBe(style);
      for (const block of result.pages[0]!.blocks) if (block.variant !== undefined) expect(typeof block.variant).toBe("string");
      expect(result.fingerprint.design).toBe(style);
      expect(result.fingerprint.format).toBe("trips");
    }
  });

  it("keeps existing pages; Ari's pass replaces only pages still entirely Draft", () => {
    const input = full("trips");
    input.existing = [
      { id: "p-home", slug: "", topLevel: true, blockCount: 0 },
      { id: "p-trips", slug: "trips", topLevel: true, blockCount: 3, allDraft: true },
      { id: "p-about", slug: "about", topLevel: true, blockCount: 2, allDraft: false },
    ];
    const build = composeFormatSite(input)!;
    expect(build.fillHome?.key).toBe("home");
    expect(build.replace).toEqual([]);
    expect(build.create.map((page) => page.slug)).not.toContain("trips");
    const pass = composeFormatSite({ ...input, replaceDrafts: true })!;
    expect(pass.replace.map((entry) => entry.id)).toEqual(["p-trips"]);
  });

  it("a venue format with no verified venue drops its venue sections (NO_VERIFIED_VENUE)", () => {
    const input = full("restaurants");
    input.inventory = { ...input.inventory, verified_venues: 0 };
    input.sources = { ...input.sources, venue_id: {} };
    const result = composeFormatSite(input)!;
    const types = result.pages.flatMap((page) => page.blocks).map((block) => block.blockType);
    expect(types).not.toContain("venue_reservation");
    expect(types).not.toContain("availability");
    expect(result.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ type: "venue_reservation", reason: "NO_VERIFIED_VENUE" })]));
  });
});

describe("#4453 milestone 7b — page-set blocks, fact badges and detail bases", () => {
  it("every placed inner page ends with page_links (next) and Home has the teaser before the sign-up", () => {
    for (const format of FORMAT_KEYS) {
      const result = composeFormatSite(full(format))!;
      const inner = result.pages.filter((page) => page.key !== "home");
      expect(inner.length, format).toBeGreaterThanOrEqual(3);
      for (const page of inner) {
        const last = page.blocks[page.blocks.length - 1]!;
        expect(last, `${format}/${page.slug}`).toMatchObject({ blockType: "page_links", mode: "next", heading: "Keep exploring" });
        expect(Object.keys(last).sort(), "items are never stored").not.toContain("items");
      }
      const home = result.pages[0]!.blocks.map((block) => block.blockType);
      const teaser = home.indexOf("page_links");
      expect(teaser, format).toBeGreaterThan(0);
      expect(result.pages[0]!.blocks[teaser]).toMatchObject({ mode: "teaser" });
      const signUp = home.indexOf("newsletter_signup");
      if (signUp >= 0) expect(teaser, format).toBeLessThan(signUp);
    }
  });

  it("page_links is left out when fewer than 2 other pages are placed (NO_OTHER_PAGES)", () => {
    const input = full("trips");
    const bare = composeFormatSite({ ...input, inventory: { ...EMPTY_INVENTORY, has_cover: true, faq_items: 1 }, answers: { ...input.answers, value_points: [], process_steps: [], quick_facts: null } })!;
    // Two inner pages: Home can link to both; each inner page has only one other, so it gets none.
    expect(bare.pages.map((page) => page.slug)).toEqual(["", "trips", "faq"]);
    for (const page of bare.pages.slice(1)) expect(page.blocks.some((block) => block.blockType === "page_links"), page.slug).toBe(false);
    expect(bare.pages[0]!.blocks.some((block) => block.blockType === "page_links")).toBe(true);
    expect(bare.skipped.some((skip) => skip.type === "page_links" && skip.reason === "NO_OTHER_PAGES")).toBe(true);
  });

  it("facts_table is the owner's Q8 facts verbatim (small names it, big is the detail), and absent without facts", () => {
    const result = composeFormatSite(full("trips"))!;
    const faq = result.pages.find((page) => page.slug === "faq")!;
    expect(faq.blocks.find((block) => block.blockType === "facts_table")).toMatchObject({ items: [{ label: "people per group", value: "12" }] });
    const input = full("trips");
    const none = composeFormatSite({ ...input, inventory: { ...input.inventory, quick_facts: 0 }, answers: { ...input.answers, quick_facts: null } })!;
    expect(none.pages.flatMap((page) => page.blocks).some((block) => block.blockType === "facts_table")).toBe(false);
  });

  it("hero fact badges come only from Q8, only on hero layouts that draw them", () => {
    const shared = composeFormatSite(full("experiences", "terra"))!;
    const hero = shared.pages[0]!.blocks.find((block) => block.blockType === "hero")!;
    if (["fullbleed", "editorial", "arch"].includes(String(hero.variant))) {
      expect(hero.fact_badges).toEqual([{ big: "12", small: "people per group" }]);
    } else {
      expect(hero.fact_badges).toBeUndefined();
    }
    // Voyage's own cover layout does not draw badges: never placed there.
    const voyage = composeFormatSite(full("trips", "voyage"))!;
    const voyageHero = voyage.pages[0]!.blocks.find((block) => block.blockType === "hero")!;
    if (!["fullbleed", "editorial", "arch"].includes(String(voyageHero.variant))) expect(voyageHero.fact_badges).toBeUndefined();
    for (const style of STYLE_KEYS) {
      const hero = composeFormatSite(full("experiences", style))!.pages[0]!.blocks.find((block) => block.blockType === "hero")!;
      expect(Boolean(hero.fact_badges), style).toBe(["fullbleed", "editorial", "arch"].includes(String(hero.variant)));
    }
    const input = full("experiences", "terra");
    const noFacts = composeFormatSite({ ...input, inventory: { ...input.inventory, quick_facts: 0 }, answers: { ...input.answers, quick_facts: null } })!;
    expect(noFacts.pages[0]!.blocks.find((block) => block.blockType === "hero")!.fact_badges).toBeUndefined();
  });

  it("detail bases: moved only on a never-published site whose base is empty; otherwise the listing stays a standard page", () => {
    const stored = { trips: null, events: null, experiences: null };
    const fresh = composeFormatSite({ ...full("experiences"), routes: { stored, canMove: true } })!;
    expect(fresh.routes).toEqual({ experiences: "sessions" });
    expect(fresh.pages.find((page) => page.slug === "sessions")).toMatchObject({ kind: "collection_index", collection_kind: "experiences" });
    const art = composeFormatSite({ ...full("art"), routes: { stored, canMove: true } })!;
    expect(art.routes).toEqual({ events: "exhibitions", experiences: "workshops" });
    // The bases the composer sets are exactly the contract's per-format defaults (where they differ from today's).
    for (const format of FORMAT_KEYS) {
      const moved = composeFormatSite({ ...full(format), routes: { stored, canMove: true } })!.routes;
      for (const [kind, base] of Object.entries(moved)) expect(FORMAT_DETAIL_BASES[format][kind as "events"], `${format} ${kind}`).toBe(base);
    }
    // Published (cannot move): no base changes, the listing is a standard page.
    const published = composeFormatSite({ ...full("experiences"), routes: { stored, canMove: false } })!;
    expect(published.routes).toEqual({});
    expect(published.pages.find((page) => page.slug === "sessions")).toMatchObject({ kind: "standard" });
    expect(published.pages.find((page) => page.slug === "sessions")).not.toHaveProperty("collection_kind");
    // The owner set a base: it is never moved.
    const owned = composeFormatSite({ ...full("experiences"), routes: { stored: { ...stored, experiences: "classes" }, canMove: true } })!;
    expect(owned.routes).toEqual({});
    // Trips keep their default base (no change needed).
    const trips = composeFormatSite({ ...full("trips"), routes: { stored, canMove: true } })!;
    expect(trips.routes).toEqual({});
    expect(trips.pages.find((page) => page.slug === "trips")).toMatchObject({ kind: "collection_index", collection_kind: "trips" });
  });
});
