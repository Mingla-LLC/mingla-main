/**
 * ORCH-1263 [claim-adoption] Leg B — implementor HAPPY-PATH regression tests
 * (SPEC §7 jest rows T-B1..T-B8). The tester owns the adversarial angles.
 *
 * Invariants exercised: I-PROPOSED-1263-CLAIM-ADOPTION-COPY-ON-START (T-B2),
 * I-PROPOSED-1263-CLAIMED-STATE-FRONT-LOADED (T-B5/T-B6),
 * I-PROPOSED-1263-OVERNIGHT-HOURS-VALID (T-B3).
 *
 * FAILS-ON-REVERT (proven by TRUE LINE DELETION, see the implementation
 * report):
 *  - deleting the D-D equality check from venueWizardValidation's hoursError
 *    → T-B3's open==close rejection FAILS;
 *  - deleting the CLAIM_STEPS map from venueWizardSteps → T-B1 FAILS.
 *
 * APPEND-ONLY — new file; modifies/deletes no existing test.
 */
import { describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ---- node-env neutralizers (default ts-jest config has no RN runtime) ----
jest.mock("react-native", () => ({
  __esModule: true,
  Platform: {
    OS: "ios",
    select: (o: Record<string, unknown>) => o.ios ?? o.default,
  },
  StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
  Pressable: () => null,
  Text: () => null,
  View: () => null,
  TextInput: () => null,
  Image: () => null,
  Modal: () => null,
  Switch: () => null,
}));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: { View: () => null, Text: () => null },
  useSharedValue: (v: unknown) => ({ value: v }),
  useAnimatedStyle: () => ({}),
  useReducedMotion: () => true,
  withTiming: (v: unknown) => v,
  withDelay: (_d: number, v: unknown) => v,
  cancelAnimation: () => undefined,
  Easing: {
    out: (e: unknown) => e,
    in: (e: unknown) => e,
    cubic: {},
  },
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock("../src/services/venueGalleryService", () => ({
  __esModule: true,
  pickGalleryPhotos: jest.fn(async () => []),
  uploadGalleryPhoto: jest.fn(async () => "https://cdn/up.jpg"),
  VenueGalleryError: class VenueGalleryError extends Error {},
}));
jest.mock("../src/components/ui/Button", () => ({
  __esModule: true,
  Button: () => null,
  default: () => null,
}));
jest.mock("../src/components/ui/GlassCard", () => ({
  __esModule: true,
  GlassCard: () => null,
  default: () => null,
}));
jest.mock("../src/components/ui/Icon", () => ({
  __esModule: true,
  Icon: () => null,
  default: () => null,
}));
jest.mock("../src/components/ui/EventCoverMedia", () => ({
  __esModule: true,
  EventCoverMedia: () => null,
}));

// Import AFTER the mocks.
/* eslint-disable import/first */
import type { DraftVenueState } from "../src/store/draftVenueStore";
import { provenanceFor } from "../src/store/draftVenueStore";
import {
  CLAIM_FILLABLE_TOTAL,
  claimDockLabel,
  claimPrefilledStepCount,
  claimStepPrefilled,
  resolveClaimSubmitPlan,
  venueStepError,
  venueWizardSteps,
} from "../src/components/venue/venueWizardValidation";
import {
  prefillDraftFromAdoption,
  prefillDraftFromPoolMatch,
} from "../src/utils/prefillDraftFromPoolMatch";
import {
  claimCardFacts,
  shouldShowReassurance,
  sortMatchesForGate,
} from "../src/components/brand/ClaimMatchCard";
import {
  removedAdoptedUrls,
  reorderGalleryUrls,
} from "../src/components/venue/claim/ClaimStepPhotos";
import { buildClaimReviewRows } from "../src/components/venue/claim/ClaimStepReview";
import { adoptionBannerBody } from "../src/components/venue/claim/ClaimAdoptionBanner";
import type { PoolAdoptionDetail, PoolMatch } from "../src/types/poolMatch";
import type { BrandHourEntry } from "../src/types/brand";
/* eslint-enable import/first */

const src = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fullMatch: PoolMatch = {
  id: "9b8f2a44-1111-2222-3333-444455556666",
  name: "Night Owl Social",
  address: "12 Glenwood Ave",
  city: "Raleigh",
  country: "USA",
  lat: 35.78,
  lng: -78.64,
  googlePlaceId: "ChIJnightowl",
  primaryPhotoUrl: "https://cdn/1.jpg",
  primaryType: "bowling_alley",
  types: ["bowling_alley"],
  venueCategory: "play",
  openingHours: {
    periods: [
      {
        open: { day: 5, hour: 22, minute: 0 },
        close: { day: 6, hour: 2, minute: 0 },
      },
    ],
  },
  photoUrls: ["https://cdn/1.jpg", "https://cdn/2.jpg", "https://cdn/3.jpg"],
  hasHours: true,
  hasPhone: true,
  hasWebsite: true,
  hasRating: true,
  photoCount: 6,
  claimState: "available",
  venueCategoryConfident: true,
};

const fullDetail: PoolAdoptionDetail = {
  id: fullMatch.id,
  name: "Night Owl Social",
  address: "12 Glenwood Ave",
  city: "Raleigh",
  country: "USA",
  lat: 35.78,
  lng: -78.64,
  googlePlaceId: "ChIJnightowl",
  primaryType: "bowling_alley",
  types: ["bowling_alley"],
  openingHours: fullMatch.openingHours,
  photoUrls: [
    "https://cdn/1.jpg",
    "https://cdn/2.jpg",
    "https://cdn/3.jpg",
    "https://cdn/4.jpg",
    "https://cdn/5.jpg",
    "https://cdn/6.jpg",
  ],
  nationalPhoneNumber: "(919) 555-0100",
  website: "https://nightowl.example",
  priceTiers: ["comfy", "bougie", "not_a_tier"],
  priceLevel: "PRICE_LEVEL_MODERATE",
  generativeSummary:
    "Late-night bowling, cocktails and a dance floor that fills up after ten.",
  editorialSummary: null,
  reservable: true,
  facets: { serves_cocktails: true, good_for_groups: true },
  venueCategory: "play",
  venueCategoryConfident: true,
};

const baseDraft: DraftVenueState = {
  placePoolId: null,
  workingName: "",
  venueCategory: null,
  displayName: "",
  slug: "",
  formattedAddress: "",
  googlePlaceId: null,
  lat: null,
  lng: null,
  city: null,
  countryCode: null,
  hours: [],
  contactEmail: "",
  contactPhone: "",
  tagline: "",
  description: "",
  website: "",
  priceTiers: [],
  wantsReservations: false,
  claim: null,
  step: 0,
};

const claimDraft = (): DraftVenueState => {
  const { photoUris: _legacy, ...prefill } = prefillDraftFromAdoption(
    fullMatch,
    fullDetail,
  );
  return { ...baseDraft, ...prefill } as DraftVenueState;
};

const week = (
  rows: Array<Partial<BrandHourEntry> & { weekday: number }>,
): BrandHourEntry[] => {
  const byDay = new Map(rows.map((r) => [r.weekday, r]));
  const out: BrandHourEntry[] = [];
  for (let w = 0; w <= 6; w++) {
    const r = byDay.get(w);
    out.push({
      weekday: w,
      openTime: r?.openTime ?? null,
      closeTime: r?.closeTime ?? null,
      isClosed: r?.isClosed ?? true,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// T-B1 — venueWizardSteps: 10 vs 6, IDs stable, create byte-identical.
// ---------------------------------------------------------------------------
describe("T-B1 — venueWizardSteps step model", () => {
  // META-ORCH-1290 supersession (D-1): create folds into ONE submit mirroring
  // claim (deck-readiness leg removed). #1062 B2 drift-to-truth: ORCH-1304
  // then REMOVED the owner-side Pitch step (create s6 / claim c5) — Mingla
  // writes the pitch at approve — so both arms are now NINE steps with the
  // s6/c5 id intentionally GAPPED. [TEST-MOD-APPROVED META-ORCH-1290]
  test("create = the folded nine steps (ORCH-1304 dropped Pitch; s6 gapped), IDs + labels byte-stable", () => {
    const steps = venueWizardSteps(false);
    expect(steps.map((s) => s.id)).toEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s7",
      "s8",
      "s9",
    ]);
    expect(steps.map((s) => s.label)).toEqual([
      "Address",
      "Name",
      "Hours",
      "Photos",
      "Cover",
      "Contact",
      "Price",
      "Bookings",
      "Review",
    ]);
  });

  test("claim = the c0–c9 walkthrough minus the dropped Pitch (c5 gapped, ORCH-1304) — DESIGN §1 step map", () => {
    const steps = venueWizardSteps(true);
    expect(steps.map((s) => s.id)).toEqual([
      "c0",
      "c1",
      "c2",
      "c3",
      "c4",
      "c6",
      "c7",
      "c8",
      "c9",
    ]);
    expect(steps.map((s) => s.label)).toEqual([
      "Category",
      "Place",
      "Hours",
      "Photos",
      "Cover",
      "Contact",
      "Price",
      "Bookings",
      "Review",
    ]);
    // #1062 B2 drift-to-truth: ORCH-1304 dropped the fillable Pitch step, so
    // the banner denominator is 8 (was 9).
    expect(CLAIM_FILLABLE_TOTAL).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// T-B2 — prefillDraftFromAdoption + lean fallback (D-B copy-on-start, OQ-2).
// ---------------------------------------------------------------------------
describe("T-B2 — adoption prefill (copy-on-start)", () => {
  test("full detail fills the claim block, contact, price, pitch", () => {
    const d = claimDraft();
    expect(d.claim).not.toBeNull();
    expect(d.claim?.detailFetched).toBe(true);
    expect(d.claim?.keptGalleryUrls).toEqual(fullDetail.photoUrls);
    expect(d.claim?.addedGalleryUrls).toEqual([]);
    expect(d.claim?.coverChoice).toBeNull();
    expect(d.contactPhone).toBe("(919) 555-0100");
    expect(d.website).toBe("https://nightowl.example");
    // Unknown tier ids are filtered to the c7 vocabulary.
    expect(d.priceTiers).toEqual(["comfy", "bougie"]);
    // Our generative summary pre-fills the pitch.
    expect(d.description).toBe(fullDetail.generativeSummary);
    expect(d.claim?.adopted.summarySource).toBe("generative");
    // Confident mapping → preselected category.
    expect(d.venueCategory).toBe("play");
    // Overnight hours mapped: Friday (weekday 4) 22:00 → 02:00.
    const fri = d.hours.find((h) => h.weekday === 4);
    expect(fri).toEqual({
      weekday: 4,
      openTime: "22:00",
      closeTime: "02:00",
      isClosed: false,
    });
    // The claim starts on c0 regardless of a stale prior step.
    expect(d.step).toBe(0);
  });

  test("editorial-only summary NEVER pre-fills the pitch (OQ-2)", () => {
    const detail: PoolAdoptionDetail = {
      ...fullDetail,
      generativeSummary: null,
      editorialSummary: "A Google-authored blurb about the venue.",
    };
    const { photoUris: _legacy, ...p } = prefillDraftFromAdoption(
      fullMatch,
      detail,
    );
    expect(p.description).toBe("");
    expect(p.claim?.adopted.summary).toBe(
      "A Google-authored blurb about the venue.",
    );
    expect(p.claim?.adopted.summarySource).toBe("editorial");
  });

  test("unconfident category arrives UNSELECTED (OQ-D7 bars ruling)", () => {
    const detail: PoolAdoptionDetail = {
      ...fullDetail,
      venueCategory: "restaurant",
      venueCategoryConfident: false,
    };
    const { photoUris: _legacy, ...p } = prefillDraftFromAdoption(
      fullMatch,
      detail,
    );
    expect(p.venueCategory).toBeNull();
    expect(p.claim?.adopted.categoryConfident).toBe(false);
  });

  test("lean fallback (Continue anyway) sets claim with detailFetched:false", () => {
    const { photoUris: _legacy, ...p } = prefillDraftFromPoolMatch(fullMatch);
    expect(p.claim?.detailFetched).toBe(false);
    expect(p.claim?.adopted.phone).toBeNull();
    expect(p.claim?.adopted.website).toBeNull();
    expect(p.claim?.adopted.galleryUrls).toEqual(fullMatch.photoUrls);
    expect(p.contactPhone).toBe("");
    expect(p.website).toBe("");
  });
});

// ---------------------------------------------------------------------------
// T-B3 — D-D overnight in BOTH validators (I-PROPOSED-1263-OVERNIGHT-HOURS-VALID).
// ---------------------------------------------------------------------------
describe("T-B3 — overnight hours valid, equality rejected (both validators)", () => {
  const withHours = (
    open: string,
    close: string,
    stepId: string,
  ): string | null =>
    venueStepError(stepId, {
      ...baseDraft,
      hours: week([
        { weekday: 0, openTime: open, closeTime: close, isClosed: false },
      ]),
    });

  test("22:00→02:00 passes c2 AND s2 (overnight is a valid span)", () => {
    expect(withHours("22:00", "02:00", "c2")).toBeNull();
    expect(withHours("22:00", "02:00", "s2")).toBeNull();
  });

  test("open === close rejected with the NEW copy in both arms", () => {
    expect(withHours("09:00", "09:00", "c2")).toBe(
      "Open and close can't be the same time.",
    );
    expect(withHours("09:00", "09:00", "s2")).toBe(
      "Open and close can't be the same time.",
    );
  });

  test("normal day still valid; missing times still rejected", () => {
    expect(withHours("09:00", "17:00", "c2")).toBeNull();
    expect(
      venueStepError("c2", {
        ...baseDraft,
        hours: week([
          { weekday: 0, openTime: "09:00", closeTime: null, isClosed: false },
        ]),
      }),
    ).toBe("Open and close times are required for open days.");
  });

  test("VenueSettingsModule mirrors D-D (no reverted o >= c predicate)", () => {
    const settings = src("src/components/venue/VenueSettingsModule.tsx");
    expect(/\(\s*o\s*>=\s*c\s*\)/.test(settings)).toBe(false);
    expect(settings).toContain("o === c");
  });

  test("BrandHoursEditor: new equality copy + the dead overnight copy is gone + next-day line", () => {
    const editor = src("src/components/venue/BrandHoursEditor.tsx");
    expect(editor).toContain("Open and close can't be the same time.");
    expect(editor).not.toContain("supported yet");
    expect(editor).toContain("next day");
  });
});

// ---------------------------------------------------------------------------
// T-B4 — c4 cover gating + c3 gallery ops.
// ---------------------------------------------------------------------------
describe("T-B4 — cover gating + gallery keep/remove/undo/reorder", () => {
  test("c4 blocks until a cover is chosen; unblocks with one", () => {
    const d = claimDraft();
    expect(venueStepError("c4", d)).toBe("Pick a cover to continue");
    const chosen: DraftVenueState = {
      ...d,
      claim: d.claim === null
        ? null
        : {
            ...d.claim,
            coverChoice: {
              url: "https://cdn/1.jpg",
              type: "image",
              isNew: false,
            },
          },
    };
    expect(venueStepError("c4", chosen)).toBeNull();
  });

  test("move menu semantics: earlier / later / first", () => {
    const urls = ["a", "b", "c", "d"];
    expect(reorderGalleryUrls(urls, "c", "earlier")).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
    expect(reorderGalleryUrls(urls, "b", "later")).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
    expect(reorderGalleryUrls(urls, "d", "first")).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
    // No-ops: first item earlier, last item later, unknown url.
    expect(reorderGalleryUrls(urls, "a", "earlier")).toEqual(urls);
    expect(reorderGalleryUrls(urls, "d", "later")).toEqual(urls);
    expect(reorderGalleryUrls(urls, "zz", "first")).toEqual(urls);
  });

  test("remove stages an adopted photo (derivable undo set); undo restores", () => {
    const adopted = ["a", "b", "c"];
    expect(removedAdoptedUrls(adopted, ["a", "c"])).toEqual(["b"]);
    // Undo = putting it back in kept — the removed set empties.
    expect(removedAdoptedUrls(adopted, ["a", "c", "b"])).toEqual([]);
    // Operator uploads never appear in the removed strip.
    expect(removedAdoptedUrls(adopted, ["a", "b", "c", "https://cdn/up.jpg"]))
      .toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T-B5 — ClaimMatchCard states (facts, reassurance, blocked variants, sort).
// ---------------------------------------------------------------------------
describe("T-B5 — ClaimMatchCard facts + blocked-at-the-gate", () => {
  test("facts render in the DESIGN §4.1 order, presence-only", () => {
    expect(claimCardFacts(fullMatch)).toEqual([
      "6 photos",
      "Hours",
      "Phone",
      "Website",
      "Rated on Google",
    ]);
  });

  test("sparse place: zero facts, no reassurance (never overpromise)", () => {
    const sparse: PoolMatch = {
      ...fullMatch,
      hasHours: false,
      hasPhone: false,
      hasWebsite: false,
      hasRating: false,
      photoCount: 0,
    };
    expect(claimCardFacts(sparse)).toEqual([]);
    expect(shouldShowReassurance(sparse)).toBe(false);
    const oneFact: PoolMatch = { ...sparse, hasHours: true };
    expect(shouldShowReassurance(oneFact)).toBe(false);
    expect(shouldShowReassurance(fullMatch)).toBe(true);
  });

  test("blocked variants sort BELOW available (DESIGN §4.5, stable)", () => {
    const a = { ...fullMatch, id: "a", claimState: "claimed" as const };
    const b = { ...fullMatch, id: "b", claimState: "available" as const };
    const c = { ...fullMatch, id: "c", claimState: "pending" as const };
    const d = { ...fullMatch, id: "d", claimState: "available" as const };
    expect(sortMatchesForGate([a, b, c, d]).map((m) => m.id)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  test("source contract: blocked variants exist, Yes only for available, support path routed", () => {
    const card = src("src/components/brand/ClaimMatchCard.tsx");
    expect(card).toContain('match.claimState === "claimed"');
    expect(card).toContain('match.claimState === "pending"');
    expect(card).toContain("Message support");
    expect(card).toContain("This place is already managed on Mingla.");
    expect(card).toContain(
      "Someone's claim for this place is being reviewed.",
    );
    expect(card).toContain("Continue anyway");
    // The blocked-politely return renders BEFORE the Yes button JSX — the
    // six-step dead walk is designed out at the gate (the earlier "Yes, this
    // is me" occurrence is a props docstring, so anchor on the JSX label).
    const yesJsx = 'label={fetchError ? "Continue anyway" : "Yes, this is me"}';
    expect(card.indexOf("if (blocked)")).toBeGreaterThan(-1);
    expect(card.indexOf(yesJsx)).toBeGreaterThan(-1);
    expect(card.indexOf("if (blocked)")).toBeLessThan(card.indexOf(yesJsx));
    const gate = src("app/venue/create.tsx");
    expect(gate).toContain("/support/inbox");
    expect(gate).toContain("sortMatchesForGate");
    expect(gate).toContain("fetchPlaceAdoptionDetail");
  });
});

// ---------------------------------------------------------------------------
// T-B6 — half-claim resume-not-recreate (D-C/R-7).
// ---------------------------------------------------------------------------
describe("T-B6 — claim submit plan + 23505 backstop wiring", () => {
  test("plan matrix: create / resume / already-submitted", () => {
    expect(resolveClaimSubmitPlan(null, null)).toEqual({ kind: "create" });
    expect(resolveClaimSubmitPlan("v1", null)).toEqual({
      kind: "resume",
      venueId: "v1",
    });
    expect(resolveClaimSubmitPlan("v1", "2026-07-02T00:00:00Z")).toEqual({
      kind: "already-submitted",
      venueId: "v1",
    });
  });

  test("wizard runs the own-row pre-check BEFORE createVenue; 23505 branches own/foreign", () => {
    const wizard = src("src/components/venue/VenueCreatorWizard.tsx");
    const preCheck = wizard.indexOf("findOwnListingForPlace(");
    const create = wizard.indexOf("createVenue.mutateAsync(");
    expect(preCheck).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(-1);
    expect(preCheck).toBeLessThan(create);
    expect(wizard).toContain("resolveClaimSubmitPlan(");
    // Foreign vs own-row branching on the typed 23505.
    expect(wizard).toContain("PlaceClaimConflictError");
    expect(wizard).toContain('{ kind: "retry" }');
    expect(wizard).toContain('{ kind: "foreign" }');
    // Claim success NEVER enters the inline deck-readiness leg — and #1062 B2
    // drift-to-truth: META-ORCH-1290 Leg B (D-1) RETIRED that inline leg for
    // the create path too (create now lands directly on the management page via
    // onDone, exactly like claim), so the old setCreatedVenue({...}) inline
    // deck-readiness completion is gone entirely.
    expect(wizard.indexOf("if (claimMode) {")).toBeGreaterThan(-1);
    expect(wizard).not.toContain("setCreatedVenue");
  });

  test("review step carries the §8.2 foreign card + §8.3 retry card", () => {
    const review = src("src/components/venue/claim/ClaimStepReview.tsx");
    expect(review).toContain("already claiming this place");
    expect(review).toContain("Saved — but the last step hiccuped");
    expect(review).toContain("Try again");
    expect(review).toContain("Back to my venues");
  });
});

// ---------------------------------------------------------------------------
// T-B7 — provenance transitions + dock CTA labels + review groups.
// ---------------------------------------------------------------------------
describe("T-B7 — provenanceFor + claimDockLabel (DESIGN §3/§5.3)", () => {
  test("adopted → edited → adopted (revert flips the chip back)", () => {
    const d = claimDraft();
    expect(provenanceFor("phone", d)).toBe("adopted");
    const edited = { ...d, contactPhone: "(919) 555-9999" };
    expect(provenanceFor("phone", edited)).toBe("edited");
    const reverted = { ...edited, contactPhone: "(919) 555-0100" };
    expect(provenanceFor("phone", reverted)).toBe("adopted");
  });

  test("new = operator-added where nothing was seeded; empty = no chip", () => {
    const lean = {
      ...baseDraft,
      ...(() => {
        const { photoUris: _l, ...p } = prefillDraftFromPoolMatch(fullMatch);
        return p;
      })(),
    } as DraftVenueState;
    expect(provenanceFor("phone", lean)).toBeNull();
    expect(provenanceFor("phone", { ...lean, contactPhone: "123" })).toBe(
      "new",
    );
    expect(provenanceFor("pitch", lean)).toBeNull();
    expect(
      provenanceFor("pitch", { ...lean, description: "typed by hand" }),
    ).toBe("new");
  });

  test("dock labels: Keep / Save / Continue per state; c4+c9 fixed", () => {
    const d = claimDraft();
    // Untouched adopted + valid → the zero-effort keep IS the CTA.
    expect(claimDockLabel("c2", d)).toBe("Keep & continue");
    expect(claimDockLabel("c6", d)).toBe("Keep & continue");
    // Operator changed the step → Save.
    expect(
      claimDockLabel("c6", { ...d, contactPhone: "(919) 555-9999" }),
    ).toBe("Save & continue");
    // Nothing adopted for the step → Continue (create parity).
    const noSummary = claimDraft();
    if (noSummary.claim !== null) {
      noSummary.claim = {
        ...noSummary.claim,
        adopted: {
          ...noSummary.claim.adopted,
          summary: null,
          summarySource: null,
        },
      };
    }
    noSummary.description = "";
    expect(claimDockLabel("c5", noSummary)).toBe("Continue");
    // c4 is always Continue (disabled-until-chosen is the dock's job).
    expect(claimDockLabel("c4", d)).toBe("Continue");
    // c8 off-state is itself a valid keep (DESIGN §6.9).
    expect(claimDockLabel("c8", d)).toBe("Keep & continue");
    expect(claimDockLabel("c8", { ...d, wantsReservations: true })).toBe(
      "Save & continue",
    );
    expect(claimDockLabel("c9", d)).toBe("Submit for review");
  });

  test("review rows land in KEPT / CHANGED / ADDED correctly", () => {
    const d = claimDraft();
    const withCover: DraftVenueState = {
      ...d,
      contactEmail: "owner@nightowl.example",
      claim: d.claim === null
        ? null
        : {
            ...d.claim,
            coverChoice: {
              url: "https://cdn/1.jpg",
              type: "image",
              isNew: false,
            },
          },
    };
    const rows = buildClaimReviewRows(withCover);
    const byKey = new Map(rows.map((r) => [r.key, r.group]));
    expect(byKey.get("name")).toBe("kept");
    expect(byKey.get("hours")).toBe("kept");
    expect(byKey.get("photos")).toBe("kept");
    expect(byKey.get("cover")).toBe("added");
    expect(byKey.get("email")).toBe("added");
    expect(byKey.get("pitch")).toBe("kept");
    // Edit the pitch → CHANGED.
    const edited = { ...withCover, description: "A whole new pitch, hand-written by the owner." };
    const editedRows = buildClaimReviewRows(edited);
    expect(editedRows.find((r) => r.key === "pitch")?.group).toBe("changed");
    // Rows jump to their steps.
    expect(rows.find((r) => r.key === "cover")?.stepId).toBe("c4");
    expect(rows.find((r) => r.key === "price")?.stepId).toBe("c7");
  });
});

// ---------------------------------------------------------------------------
// T-B8 — banner `n` computation + sparse copy swap (DESIGN §5.1).
// ---------------------------------------------------------------------------
describe("T-B8 — adoption banner live math", () => {
  test("fully-seeded fixture: n counts every validation-passing adopted step", () => {
    const d = claimDraft();
    // #1062 B2 drift-to-truth: ORCH-1304 dropped the c5 Pitch step, so the
    // fully-seeded count is 7 (was 8): c0 confident + c1 place + c2
    // overnight-valid hours + c3 gallery + c6 phone + c7 tiers + c8 hint = 7
    // (c4 never; c5 removed).
    expect(claimPrefilledStepCount(d)).toBe(7);
    expect(claimStepPrefilled("c4", d)).toBe(false);
    expect(adoptionBannerBody(7)).toBe(
      "7 of 8 steps are filled from your listing. Keep what's right, fix what's not.",
    );
  });

  test("sparse place: n ≤ 2 swaps to the no-bragging copy", () => {
    const lean = {
      ...baseDraft,
      ...(() => {
        const { photoUris: _l, ...p } = prefillDraftFromPoolMatch({
          ...fullMatch,
          openingHours: null,
          photoUrls: [],
          venueCategoryConfident: false,
        });
        return p;
      })(),
    } as DraftVenueState;
    // Only c1 (name+address) survives on a sparse lean prefill.
    expect(claimPrefilledStepCount(lean)).toBe(1);
    expect(adoptionBannerBody(1)).toBe(
      "We've filled in what we have — the rest is yours.",
    );
    expect(adoptionBannerBody(2)).toBe(
      "We've filled in what we have — the rest is yours.",
    );
  });

  test("invalid adopted hours do NOT count as a filled step (live math, honest)", () => {
    const d = claimDraft();
    if (d.claim !== null) {
      d.claim = {
        ...d.claim,
        adopted: {
          ...d.claim.adopted,
          hours: week([
            {
              weekday: 0,
              openTime: "09:00",
              closeTime: "09:00",
              isClosed: false,
            },
          ]),
        },
      };
    }
    expect(claimStepPrefilled("c2", d)).toBe(false);
    // #1062 B2 drift-to-truth: with the c5 Pitch step dropped (ORCH-1304), the
    // invalid-hours count is 6 (was 7).
    expect(claimPrefilledStepCount(d)).toBe(6);
  });
});
