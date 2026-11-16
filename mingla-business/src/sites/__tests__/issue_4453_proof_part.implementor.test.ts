/**
 * #4453 PR 3 (content foundation) — the Business app's half of the setup part
 * "What guests say and where you've been" and Draft review. Pure, so every
 * rule is pinned without rendering:
 *   - the part shows only while Core lists it (SITES_PROOF_PART off: 8 steps);
 *   - SC-3.2 a review can't be saved without reviewer, quote, month, source
 *     and the "real review" tick; SC-3.3 a past trip must have ended;
 *   - owner answers are saved verbatim (trimmed, empty rows dropped), never
 *     rewritten, and the answers patch only sends Q7 when the format asks it;
 *   - the plan read carries the answers and counts.
 *
 * MINGLA-INVARIANT: I-SITES-NO-INVENTED-PROOF | issue #4453 | nothing from setup renders publicly until the owner confirmed it (the review tick) or reviewed it (Draft); the app never fills an answer in.
 */
import { setupSteps } from "../setupStatus";
import { normalizeSitePlan } from "../sitePlanState";
import { answersPatch, cleanValues, pastTripProblems, stagedProblems, STAGED_FIELDS, stagedTitle } from "../proofForms";
import { reviewCountLabel, sectionName } from "../../components/sites/website/sections/DraftReviewCard";
import { setupStepFromRoute } from "../../screens/ari/setupFlowRoute";

jest.mock("../../components/sites/website/ui", () => ({}));
jest.mock("../contentApi", () => ({ useMarkReviewed: jest.fn(), useReviewStatus: jest.fn() }));
jest.mock("../../services/brandSitesService", () => ({ BrandSitesError: class BrandSitesError extends Error {} }));

const part = (key: string) => ({ key, done: false, skipped: false, fieldCount: 0, openFields: [] });

describe("#4453 the proof step follows Core's flag", () => {
  const base = { fields: [], draftFailed: false, publishFailed: false };
  it("flag off: the 8 steps, no proof", () => {
    const keys = ["offer", "brand", "look", "story", "approve", "build", "first_offering", "publish"];
    const { steps } = setupSteps({ ...base, setupStatus: { parts: keys.map(part) as never, doneCount: 0, nextPart: null, total: 8 } });
    expect(steps.map((s) => s.key)).toEqual(keys);
  });
  it("flag on: proof sits after story", () => {
    const keys = ["offer", "brand", "look", "story", "proof", "approve", "build", "first_offering", "publish"];
    const { steps } = setupSteps({ ...base, setupStatus: { parts: keys.map(part) as never, doneCount: 0, nextPart: null, total: 9 } });
    expect(steps.map((s) => s.key)).toEqual(keys);
    expect(steps[4]!.label).toBe("What guests say and where you've been");
  });
  it("the setup route accepts the proof step", () => {
    expect(setupStepFromRoute("/brand/b1/website/setup?step=proof", "b1")).toBe("proof");
  });
});

describe("#4453 SC-3.2 a review needs every field and the tick", () => {
  const full = { reviewer: "Tolu A.", quote: "Best week of my year.", review_date: "2026-03", source: "Google, March 2026" };
  it("refuses without the tick, and names each missing field", () => {
    expect(Object.keys(stagedProblems("review", full, false))).toEqual(["confirmed"]);
    expect(Object.keys(stagedProblems("review", {}, true)).sort()).toEqual(["quote", "review_date", "reviewer", "source"]);
    expect(stagedProblems("review", { ...full, review_date: "March" }, true).review_date).toMatch(/2026-03/);
    expect(stagedProblems("review", { ...full, review_date: "2999-01" }, true).review_date).toMatch(/hasn't happened/);
    expect(stagedProblems("review", { ...full, quote: "<b>great</b>" }, true).quote).toMatch(/</);
    expect(stagedProblems("review", full, true)).toEqual({});
  });
  it("saves the words verbatim (trimmed only), never rewritten", () => {
    expect(cleanValues(STAGED_FIELDS.review, { ...full, quote: "  Best week of my year.  ", trip_name: "  " })).toEqual(full);
    expect(stagedTitle("review", full)).toEqual({ title: "Tolu A.", line: "“Best week of my year.”" });
  });
});

describe("#4453 SC-3.3 past trips must have ended", () => {
  const trip = { title: "Porto in spring", where: "Porto", start_date: "2026-04-01", end_date: "2026-04-05" };
  it("refuses an end date today or later with the agreed words", () => {
    expect(pastTripProblems({ ...trip, end_date: "2026-11-16" }, "2026-11-16").end_date).toBe("Past trips must have ended. Add upcoming trips from Create.");
    expect(pastTripProblems({ ...trip, end_date: "2026-03-01" }, "2026-11-16").end_date).toMatch(/after the first/);
    expect(pastTripProblems(trip, "2026-11-16")).toEqual({});
  });
});

describe("#4453 the answers patch", () => {
  const empty = { facts: [], use_in_ticker: false, ticker: [] };
  it("drops empty rows, sends null for no answer, and leaves Q7 out when not asked", () => {
    const { patch, problem } = answersPatch({ valuePoints: [{ title: " Small groups ", sentence: "Never more than twelve." }, { title: "", sentence: "" }], faq: [], processSteps: null, quickFacts: empty });
    expect(problem).toBeNull();
    expect(patch).toEqual({ value_points: [{ title: "Small groups", sentence: "Never more than twelve." }], faq: null, quick_facts: null });
  });
  it("names the first problem (Q7 needs 3 steps)", () => {
    const { problem } = answersPatch({ valuePoints: [], faq: [], processSteps: [{ title: "Arrive", text: "Tea." }], quickFacts: empty });
    expect(problem).toMatch(/3/);
  });
});

describe("#4453 the plan read carries the answers", () => {
  it("normalizes value_points, quick_facts, proof_enabled and proof_counts", () => {
    const state = normalizeSitePlan("b1", {
      entitled: true,
      plan: { revision: 3, value_points: [{ title: "A", sentence: "B", extra: 1 }], quick_facts: { facts: [{ big: "90°C", small: "Sauna" }], use_in_ticker: true, ticker: ["Open late"] } },
      status: { parts: [] },
      proof_enabled: true,
      proof_counts: { reviews: 2, past_trips: 1, destinations: 0, stories: 3 },
    });
    expect(state.plan?.valuePoints).toEqual([{ title: "A", sentence: "B" }]);
    expect(state.plan?.quickFacts).toEqual({ facts: [{ big: "90°C", small: "Sauna" }], use_in_ticker: true, ticker: ["Open late"] });
    expect(state.proofEnabled).toBe(true);
    expect(state.proofCounts).toEqual({ reviews: 2, pastTrips: 1, destinations: 0, stories: 3 });
  });
});

describe("#4453 Draft review copy", () => {
  it("counts and names sections plainly", () => {
    expect(reviewCountLabel(1)).toBe("1 section to review");
    expect(reviewCountLabel(3)).toBe("3 sections to review");
    expect(sectionName("feature_cards")).toBe("What makes you different");
    expect(sectionName("unknown_block")).toBe("Section");
  });
});

describe("#4453 the label font slot in the look model", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const look = require("../siteLook") as typeof import("../siteLook");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ATELIER } = require("../../../../packages/site-contracts/src/designs.ts") as typeof import("../../../../packages/site-contracts/src/designs.ts");
  it("labels follow the design's label face, else the owner's body font; the owner never edits them", () => {
    const withLabel = { ...ATELIER, fonts: { ...ATELIER.fonts, label: { family: "Space Mono", source: "google" } } } as never;
    expect(look.slotFamily(withLabel, { body: { family: "Inter", source: "google" } } as never, "label")).toBe("Space Mono");
    expect(look.slotFamily({ ...ATELIER, fonts: { ...ATELIER.fonts, label: null } } as never, { body: { family: "Inter", source: "google" } } as never, "label")).toBe("Inter");
    expect(look.designSlotFamily(ATELIER, "label")).toBe(ATELIER.fonts.label?.family ?? ATELIER.fonts.body.family);
    expect(look.isOwnerFontSlot("label")).toBe(false);
    expect(look.isOwnerFontSlot("accent")).toBe(true);
    expect(Object.keys(look.lookControls(ATELIER, look.resolveLook(ATELIER, {}), {}).fonts).sort()).toEqual(["accent", "body", "display", "label"]);
  });
});
