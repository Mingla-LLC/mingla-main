/*
 * #4453 PR 3 — the content-foundation contracts (generated copies of
 * packages/site-contracts): sectionEligibility (spec v1 §4.1, spec v2 §6.4),
 * the setup part in PLAN_PARTS and planBuildBlockers (SC-3.1), and the
 * owner-answer validators that mirror Core's CHECKs (SC-3.7).
 *
 * invariant: I-SITES-SECTION-NEEDS-CONTENT (declared in sectionSources.ts).
 */
import { describe, expect, it } from "vitest";
import { EMPTY_INVENTORY, MINGLA_REVIEWS_MIN, sectionEligibility, type ContentInventory } from "../contracts/generated/sectionSources.ts";
import {
  BUILD_REQUIRED_PARTS, PLAN_PARTS, faqProblem, planBuildBlockers, processStepsProblem, proofAsksProcessSteps,
  quickFactsProblem, tickerPhrases, valuePointsProblem,
} from "../contracts/generated/sitePlan.ts";

const inv = (patch: Partial<ContentInventory>): ContentInventory => ({ ...EMPTY_INVENTORY, ...patch });

describe("#4453 sectionEligibility", () => {
  it("an empty brand gets only the always-eligible sections", () => {
    for (const type of ["hero", "offering_grid", "offering_history", "testimonials", "destination_grid", "story_grid", "video_feature", "feature_cards", "faq", "gallery", "media_feature", "contact_details", "process_steps", "marquee", "venue_reservation", "menu_board", "ticket_tiers", "availability"]) {
      expect(sectionEligibility(type, EMPTY_INVENTORY).eligible, type).toBe(false);
    }
    for (const type of ["newsletter_signup", "contact_form", "page_header", "cta", "divider", "spacer"]) {
      expect(sectionEligibility(type, EMPTY_INVENTORY).eligible, type).toBe(true);
    }
  });

  it("names the reason for each v1 row", () => {
    expect(sectionEligibility("hero", inv({ has_cover: true, upcoming: { trip: 1, event: 0, experience: 0 } }), { show_search: true }).reason).toBe("TOO_FEW_TRIPS_FOR_SEARCH");
    expect(sectionEligibility("hero", inv({ has_cover: true, upcoming: { trip: 2, event: 0, experience: 0 } }), { show_search: true }).eligible).toBe(true);
    expect(sectionEligibility("offering_grid", inv({ upcoming: { trip: 0, event: 1, experience: 0 } }), { mode: "upcoming", kind: "trip" }).reason).toBe("NO_UPCOMING");
    expect(sectionEligibility("offering_grid", inv({ ended: { trip: 1, event: 0, experience: 0 } }), { mode: "past", kind: "trip" }).eligible).toBe(true);
    expect(sectionEligibility("testimonials", inv({ confirmed_reviews: 3 }), { has_typed_items: true }).reason).toBe("REVIEWS_ONLY_FROM_COLLECTION");
    expect(sectionEligibility("testimonials", inv({ confirmed_reviews: 0 }), { from_collection: true }).reason).toBe("NO_CONFIRMED_REVIEWS");
    expect(sectionEligibility("feature_cards", inv({ value_points: 1 })).reason).toBe("TOO_FEW_VALUE_POINTS");
    expect(sectionEligibility("feature_cards", inv({ value_points: 2 })).eligible).toBe(true);
    expect(sectionEligibility("gallery", inv({ ready_photos: 3 }), { layout: "pinned" }).reason).toBe("NO_PHOTOS");
    expect(sectionEligibility("rich_text", EMPTY_INVENTORY, { page: "about" }).reason).toBe("NO_TEXT");
  });

  it("the v2 rows: steps, facts, phrases, Mingla ratings, booking blocks", () => {
    expect(sectionEligibility("process_steps", inv({ process_steps: 2 })).reason).toBe("NO_PROCESS_STEPS");
    expect(sectionEligibility("process_steps", inv({ process_steps: 3 })).eligible).toBe(true);
    expect(sectionEligibility("hero", inv({ has_cover: true }), { fact_badge: true }).reason).toBe("NO_FACTS");
    expect(sectionEligibility("marquee", inv({ ticker_phrases: 1 })).reason).toBe("NO_PHRASES");
    // SC-B3: 19 approved reviews → none; Google ratings are never an input here.
    expect(sectionEligibility("testimonials", inv({ confirmed_reviews: 3, mingla_reviews: MINGLA_REVIEWS_MIN - 1 }), { from_collection: true, show_rating: true }).reason).toBe("TOO_FEW_MINGLA_REVIEWS");
    expect(sectionEligibility("testimonials", inv({ confirmed_reviews: 3, mingla_reviews: MINGLA_REVIEWS_MIN }), { from_collection: true, show_rating: true }).eligible).toBe(true);
    expect(sectionEligibility("availability", inv({ verified_venues: 1, venue_reservations_on: true }), { source: "venue_slots" }).reason).toBe("NO_LIVE_SLOTS");
    expect(sectionEligibility("availability", inv({ verified_venues: 2, venue_reservations_on: true, open_venue_slots: 4 }), { source: "venue_slots" }).reason).toBe("NO_VERIFIED_VENUE");
    expect(sectionEligibility("offering_grid", inv({}), { kind: "stay" }).reason).toBe("NO_ROOMS");
    expect(sectionEligibility("ticket_tiers", inv({ public_ticket_tiers: 1 })).eligible).toBe(true);
    expect(sectionEligibility("hero", inv({ has_cover: true }), { booking_bar: true }).reason).toBe("NO_BOOKING_TARGET");
  });
});

describe("#4453 the setup part (SC-3.1)", () => {
  it("9 parts, proof at index 4, optional and skippable", () => {
    expect(PLAN_PARTS).toHaveLength(9);
    expect(PLAN_PARTS[4]).toMatchObject({ key: "proof", optional: true, skippable: true, label: "What guests say and where you've been" });
    expect(BUILD_REQUIRED_PARTS).not.toContain("proof");
  });

  it("proof never blocks Build, and approve still does (the old slice would have dropped it)", () => {
    const blockers = planBuildBlockers({ partDone: (key) => key !== "approve" && key !== "proof", contextComplete: true, fields: [], labelOf: () => "" });
    expect(blockers.map((b) => b.key)).toEqual(["part:approve"]);
  });

  it("Q7 is asked only for experiences, play and art", () => {
    expect(proofAsksProcessSteps(["trips"])).toBe(false);
    expect(proofAsksProcessSteps(["venue_play"])).toBe(true);
    expect(proofAsksProcessSteps(["experiences"])).toBe(true);
  });

  it("the validators mirror Core's CHECKs (SC-3.7)", () => {
    const point = { title: "Small groups", sentence: "Never more than twelve." };
    expect(valuePointsProblem([point, point])).toBeNull();
    expect(valuePointsProblem([point, point, point, point, point])).toMatch(/4/);
    expect(valuePointsProblem([{ title: "a".repeat(121), sentence: "x" }])).toMatch(/120/);
    expect(valuePointsProblem([{ title: "<b>x</b>", sentence: "x" }])).toMatch(/</);
    expect(faqProblem([{ question: "Q?", answer: "" }])).toMatch(/answer/);
    expect(processStepsProblem([{ title: "a", text: "b" }, { title: "c", text: "d" }])).toMatch(/3/);
    expect(quickFactsProblem({ facts: [{ big: "x".repeat(13), small: "y" }], use_in_ticker: false, ticker: [] })).toMatch(/12/);
    expect(tickerPhrases({ facts: [{ big: "90°C", small: "Sauna" }], use_in_ticker: true, ticker: ["Open late"] })).toEqual(["90°C Sauna", "Open late"]);
    expect(tickerPhrases({ facts: [{ big: "90°C", small: "Sauna" }], use_in_ticker: false, ticker: [] })).toEqual([]);
  });
});
