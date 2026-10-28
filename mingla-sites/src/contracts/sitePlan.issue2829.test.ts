/*
 * #2829 W9a (T-W9) — the website plan's shared vocabulary: the 8 parts, the
 * seven offering options, the pages ticks ask for, the menu order (M1, incl.
 * more than six → "More"), the empty-state words (verbatim from the design
 * contract's rules table), the tagline/bio split, the story wording, and
 * when an empty planned page is hidden from search (SC-29).
 */
import { describe, expect, it } from "vitest";
import {
  PLAN_OFFERING_OPTIONS,
  PLAN_PARTS,
  mainActionChips,
  mainActionPage,
  planMenu,
  planMenuPreview,
  plannedPagesFor,
  splitBrandDescription,
  storyQuestions,
} from "./generated/sitePlan.ts";
import { PLANNED_PAGE_EMPTY_STATES, PLANNED_PAGE_LABELS, RESERVATIONS_OFF_TEXT } from "./generated/emptyStates.ts";
import { isPlannedOfferingPage, plannedPageIsEmpty } from "./generated/plannedPages.ts";
import type { SiteOffering } from "./generated/offerings.ts";

describe("#2829 W9a plan parts and options", () => {
  it("has the 8 parts in order with part 7 optional", () => {
    expect(PLAN_PARTS.map((part) => part.key)).toEqual([
      "offer", "brand", "look", "story", "approve", "build", "first_offering", "publish",
    ]);
    expect(PLAN_PARTS.filter((part) => part.optional).map((part) => part.key)).toEqual(["first_offering"]);
    // Core accepts exactly these skips (brand_site_plans.skipped_parts CHECK).
    expect(PLAN_PARTS.filter((part) => part.skippable).map((part) => part.key)).toEqual(["look", "first_offering"]);
    expect(PLAN_PARTS.map((part) => part.label)).toEqual([
      "What you'll offer", "Your brand details", "Choose your design", "Your story", "Approve the plan",
      "Build your pages", "Add your first trip or event", "Check and publish",
    ]);
  });

  it("offers seven options in one grid; only Stay depends on stay venues", () => {
    expect(PLAN_OFFERING_OPTIONS.map((option) => option.label)).toEqual([
      "Trips", "Events", "Experiences", "Restaurant, bar or café", "Play", "Creative & arts", "Stay",
    ]);
    expect(PLAN_OFFERING_OPTIONS.filter((option) => option.stay).map((option) => option.key)).toEqual(["venue_stay"]);
  });
});

describe("#2829 W9a pages and menu (M1)", () => {
  it("ticking Trips and Events yields Home, Trips, Events, About, Contact; nothing else", () => {
    expect(plannedPagesFor(["events", "trips"])).toEqual(["trips", "events"]);
    expect(planMenuPreview(["trips", "events"])).toBe("Home · Trips · Events · About · Contact");
    expect(planMenu(["trips"]).items.map((item) => item.label)).toEqual(["Trips", "About", "Contact"]);
  });

  it("ticking nothing yields Home, About and Contact only", () => {
    expect(plannedPagesFor([])).toEqual([]);
    expect(planMenuPreview([])).toBe("Home · About · Contact");
  });

  it("puts the main offering first, the rest in fixed order", () => {
    expect(planMenu(["trips", "events", "experiences"], "Come to an event").items.map((item) => item.key))
      .toEqual(["events", "trips", "experiences", "about", "contact"]);
    expect(mainActionPage("Join the list", ["trips"])).toBeNull();
    expect(mainActionChips(["venue_food_drink"]).map((chip) => chip.label)).toEqual(["Reserve a table", "Join the list", "Get in touch"]);
  });

  it("two venue types sharing a page make it once", () => {
    expect(plannedPagesFor(["venue_play", "venue_creative_arts"])).toEqual(["visit"]);
  });

  it("more than six items: the sixth onward go under More", () => {
    const all = ["trips", "events", "experiences", "venue_food_drink", "venue_play", "venue_stay"];
    const menu = planMenu(all);
    expect(menu.items.map((item) => item.label)).toEqual(["Trips", "Events", "Experiences", "Menu", "Visit"]);
    expect(menu.more.map((item) => item.label)).toEqual(["Rooms", "About", "Contact"]);
    expect(planMenuPreview(all)).toBe("Home · Trips · Events · Experiences · Menu · Visit · More (Rooms, About, Contact)");
    // Exactly six stays flat.
    expect(planMenu(["trips", "events", "experiences", "venue_food_drink"]).more).toEqual([]);
  });
});

describe("#2829 W9a empty states (design contract rules table, verbatim)", () => {
  it("pins every empty-state line", () => {
    expect(Object.fromEntries(Object.entries(PLANNED_PAGE_EMPTY_STATES).map(([key, value]) => [key, value.text]))).toEqual({
      trips: "No trips on sale yet. Tell us where you want to go",
      events: "Nothing on the calendar yet. Hear first",
      experiences: "Experiences opening soon",
      menu: "Our menu is on its way",
      visit: "Message to book",
      rooms: "Rooms opening soon",
    });
    expect(RESERVATIONS_OFF_TEXT).toBe("Call or message to book");
    expect(PLANNED_PAGE_LABELS.menu.action).toBe("Reserve a table");
    expect(PLANNED_PAGE_LABELS.visit.action).toBe("Book a visit");
    expect(PLANNED_PAGE_LABELS.rooms.action).toBe("Reserve this stay");
  });
});

describe("#2829 W9a brand words", () => {
  it("splits tagline and bio the way Mingla stores them", () => {
    expect(splitBrandDescription("Travel the world.\n\nWe run small group trips.")).toEqual({ tagline: "Travel the world.", bio: "We run small group trips." });
    expect(splitBrandDescription("We run small group trips.")).toEqual({ tagline: null, bio: "We run small group trips." });
    expect(splitBrandDescription("  ")).toEqual({ tagline: null, bio: null });
  });

  it("words the story questions by what was ticked", () => {
    expect(storyQuestions(["trips"]).who).toBe("Who comes with you?");
    expect(storyQuestions(["venue_food_drink"]).who).toBe("Who walks in?");
    expect(storyQuestions([]).main_action).toBe("What should someone do when they find you?");
  });
});

describe("#2829 W9a SC-29 an empty planned page is hidden from search", () => {
  const trip = (patch: Partial<SiteOffering>): SiteOffering => ({
    id: "11111111-1111-4111-8111-111111111111", kind: "trip", slug: "coast", title: "Coast week", summary: null, cover: null,
    destination_text: null, start_at: "2027-06-20T10:00:00.000Z", end_at: "2027-06-27T10:00:00.000Z", timezone: "UTC",
    status: "scheduled", bookings_closed: false, capacity: 10, spots_left: 5, group_minimum: null, min_price_minor: 1000,
    currency: "USD", has_free_tier: false, public_url: "https://host.usemingla.com/t/b/coast", waitlist_enabled: false,
    installments_available: false, ...patch,
  });
  const now = new Date("2027-01-01T00:00:00Z");
  const tripsPage = {
    kind: "collection_index", collection: "trips",
    blocks: [{ type: "offering_grid", variant: "neutral", kind: "trip", mode: "upcoming", empty_text: "No trips on sale yet. Tell us where you want to go" },
      { type: "newsletter_signup", variant: "neutral", heading: "Hear first", button_label: "Tell me first" }],
  };

  it("is empty with no offerings, and fills itself when the first one is published", () => {
    expect(isPlannedOfferingPage(tripsPage)).toBe(true);
    expect(plannedPageIsEmpty(tripsPage, [], now)).toBe(true);
    expect(plannedPageIsEmpty(tripsPage, [trip({})], now)).toBe(false);
  });

  it("an ended or cancelled trip leaves an upcoming page empty; an event does not fill a Trips page", () => {
    expect(plannedPageIsEmpty(tripsPage, [trip({ start_at: "2026-06-20T10:00:00.000Z", end_at: "2026-06-21T10:00:00.000Z" })], now)).toBe(true);
    expect(plannedPageIsEmpty(tripsPage, [trip({ status: "cancelled" })], now)).toBe(true);
    expect(plannedPageIsEmpty(tripsPage, [trip({ kind: "event" })], now)).toBe(true);
  });

  it("never hides any other page", () => {
    expect(plannedPageIsEmpty({ kind: "standard", blocks: tripsPage.blocks }, [], now)).toBe(false);
    expect(plannedPageIsEmpty({ ...tripsPage, collection: "destinations" }, [], now)).toBe(false);
    // A page with trip history is not empty (a brand's past trips are content).
    expect(plannedPageIsEmpty({ ...tripsPage, blocks: [...tripsPage.blocks, { type: "offering_history", variant: "neutral" }] }, [], now)).toBe(false);
  });
});
