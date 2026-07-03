/**
 * ORCH-1263 [claim-adoption] — TESTER adversarial suite (mingla-tester owned).
 *
 * APPEND-ONLY new file. Attacks DIFFERENT angles than the implementor's
 * happy-path suite (orch1263ClaimAdoption.happy.test.tsx):
 *
 *  A1 — overnight boundary MATRIX in the shared validator (22:00→02:00,
 *       00:00→00:00, 23:59→00:01, 00:01→00:00, mixed-week masking) on BOTH
 *       the claim (c2) and create (s2) arms
 *       (I-PROPOSED-1263-OVERNIGHT-HOURS-VALID).
 *  A2 — VenueSettingsModule predicate source-contract: equality-only, the
 *       reverted `o >= c` shape is DEAD (D-D second file).
 *  A3 — double-claim front-load: blocked sort is stable + total (drops
 *       nothing), pending AND claimed both blocked; sparse-facts honesty
 *       (I-PROPOSED-1263-CLAIMED-STATE-FRONT-LOADED).
 *  A4 — half-claim submit plan matrix + wizard pre-check race honesty
 *       (D-C: resume-not-recreate; catch re-probes ownership before §8.2).
 *  A5 — provenance revert/trim/set-equality flips (chip can never lie).
 *  A6 — claimStepPrefilled HONESTY under invalid/foreign adopted payloads
 *       (banner `n` live math can never over-count).
 *  A7 — dock label adversarial (c4 fixed, c8 D-B7 default, edit flips).
 *  A8 — gallery reorder/removal boundary ops (no drop, no dupe, no crash).
 *  A9 — adoption prefill purity (frozen inputs — copy-on-start means COPY)
 *       + junk price-tier filtering + detailFetched honesty
 *       (I-PROPOSED-1263-CLAIM-ADOPTION-COPY-ON-START).
 *
 * FAILS-ON-REVERT (proven by true line edits, receipts in the QA report):
 *  - restoring the pre-D-D `o >= c` predicate in venueWizardValidation's
 *    hoursError → A1 overnight arms FAIL;
 *  - reverting sortMatchesForGate to identity (no blocked partition) → A3
 *    FAILS.
 */
import { describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

// ---- node-env neutralizers (same shape as the happy suite) ----
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
  Easing: { out: (e: unknown) => e, in: (e: unknown) => e, cubic: {} },
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

/* eslint-disable import/first */
import type { DraftVenueState } from "../src/store/draftVenueStore";
import { provenanceFor } from "../src/store/draftVenueStore";
import {
  claimDockLabel,
  claimPrefilledStepCount,
  claimStepPrefilled,
  resolveClaimSubmitPlan,
  venueStepError,
} from "../src/components/venue/venueWizardValidation";
import { prefillDraftFromAdoption } from "../src/utils/prefillDraftFromPoolMatch";
import {
  claimCardFacts,
  shouldShowReassurance,
  sortMatchesForGate,
} from "../src/components/brand/ClaimMatchCard";
import {
  removedAdoptedUrls,
  reorderGalleryUrls,
} from "../src/components/venue/claim/ClaimStepPhotos";
import type { PoolAdoptionDetail, PoolMatch } from "../src/types/poolMatch";
import type { BrandHourEntry } from "../src/types/brand";
/* eslint-enable import/first */

const src = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const match = (over: Partial<PoolMatch>): PoolMatch => ({
  id: "9b8f2a44-aaaa-bbbb-cccc-444455556666",
  name: "Adversary Tavern",
  address: "13 Elm St",
  city: "Raleigh",
  country: "USA",
  lat: 35.78,
  lng: -78.64,
  googlePlaceId: "ChIJadversary",
  primaryPhotoUrl: null,
  primaryType: "bar",
  types: ["bar"],
  venueCategory: "restaurant",
  openingHours: null,
  photoUrls: [],
  hasHours: false,
  hasPhone: false,
  hasWebsite: false,
  hasRating: false,
  photoCount: 0,
  claimState: "available",
  venueCategoryConfident: false,
  ...over,
});

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

/** A draft with a fully-populated claim.adopted block, override-able. */
const adoptedDraft = (
  adoptedOver: Partial<NonNullable<DraftVenueState["claim"]>["adopted"]> = {},
  draftOver: Partial<DraftVenueState> = {},
): DraftVenueState => {
  const adopted = {
    name: "Adversary Tavern",
    address: "13 Elm St",
    hours: week([{ weekday: 5, openTime: "22:00", closeTime: "02:00", isClosed: false }]),
    phone: "(919) 555-0100",
    website: "https://adversary.example",
    priceTiers: ["comfy", "bougie"],
    facets: { serves_cocktails: true },
    summary: "Late-night cocktails and a dance floor that fills after ten.",
    summarySource: "generative" as const,
    galleryUrls: ["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"],
    category: "restaurant" as const,
    categoryConfident: true,
    reservableHint: false,
    ...adoptedOver,
  };
  return {
    ...baseDraft,
    displayName: adopted.name,
    formattedAddress: adopted.address,
    lat: 35.78,
    lng: -78.64,
    slug: "adversarytavern",
    venueCategory: adopted.category,
    hours: adopted.hours,
    contactPhone: adopted.phone ?? "",
    website: adopted.website ?? "",
    priceTiers: [...adopted.priceTiers],
    description:
      adopted.summarySource === "generative" ? (adopted.summary ?? "") : "",
    claim: {
      adopted,
      keptGalleryUrls: [...adopted.galleryUrls],
      addedGalleryUrls: [],
      coverChoice: null,
      detailFetched: true,
      adoptedAt: "2026-07-02T00:00:00.000Z",
    },
    ...draftOver,
  } as DraftVenueState;
};

// ---------------------------------------------------------------------------
// A1 — overnight boundary matrix, BOTH validator arms (c2 claim + s2 create)
// ---------------------------------------------------------------------------
describe("A1 — D-D overnight boundary matrix (c2 AND s2)", () => {
  const cases: Array<{ open: string; close: string; valid: boolean; label: string }> = [
    { open: "22:00", close: "02:00", valid: true, label: "classic overnight" },
    { open: "00:00", close: "00:00", valid: false, label: "midnight equality" },
    { open: "23:59", close: "00:01", valid: true, label: "2-minute overnight span" },
    { open: "00:01", close: "00:00", valid: true, label: "close at exact midnight (overnight)" },
    { open: "09:00", close: "09:00", valid: false, label: "same-time daytime" },
    { open: "09:00", close: "17:00", valid: true, label: "plain same-day" },
  ];

  for (const arm of ["c2", "s2"] as const) {
    for (const c of cases) {
      test(`${arm}: ${c.label} (${c.open}→${c.close}) → ${c.valid ? "VALID" : "REJECTED"}`, () => {
        const d = {
          ...baseDraft,
          hours: week([
            { weekday: 2, openTime: c.open, closeTime: c.close, isClosed: false },
          ]),
        };
        const err = venueStepError(arm, d);
        if (c.valid) {
          expect(err).toBeNull();
        } else {
          expect(err).toBe("Open and close can't be the same time.");
        }
      });
    }
  }

  test("mixed week: a valid overnight day does NOT mask an equality day", () => {
    const d = {
      ...baseDraft,
      hours: week([
        { weekday: 1, openTime: "22:00", closeTime: "02:00", isClosed: false },
        { weekday: 3, openTime: "11:00", closeTime: "11:00", isClosed: false },
      ]),
    };
    expect(venueStepError("c2", d)).toBe("Open and close can't be the same time.");
    expect(venueStepError("s2", d)).toBe("Open and close can't be the same time.");
  });

  test("closed day with equal times is ignored (isClosed short-circuits)", () => {
    const d = {
      ...baseDraft,
      hours: week([
        { weekday: 4, openTime: "10:00", closeTime: "10:00", isClosed: true },
        { weekday: 5, openTime: "22:00", closeTime: "02:00", isClosed: false },
      ]),
    };
    expect(venueStepError("c2", d)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A2 — VenueSettingsModule predicate: equality-only, `o >= c` DEAD
// ---------------------------------------------------------------------------
describe("A2 — Settings hoursInvalid predicate (D-D second file, source contract)", () => {
  const settingsSrc = src("src/components/venue/VenueSettingsModule.tsx");

  test("contains the equality-only predicate", () => {
    expect(settingsSrc).toMatch(/if\s*\(\s*o\s*===\s*c\s*\)\s*return\s+true/);
  });

  test("the reverted `o >= c` predicate shape is dead in BOTH files", () => {
    expect(settingsSrc).not.toMatch(/o\s*>=\s*c/);
    const validatorSrc = src("src/components/venue/venueWizardValidation.ts");
    expect(validatorSrc).not.toMatch(/o\s*>=\s*c/);
  });
});

// ---------------------------------------------------------------------------
// A3 — double-claim front-load: sort total+stable; sparse facts honesty
// ---------------------------------------------------------------------------
describe("A3 — blocked-state front-load (gate, not the six-step walk)", () => {
  test("sort is TOTAL (drops nothing) and STABLE within partitions", () => {
    const a1 = match({ id: "a1", claimState: "available", name: "A1" });
    const b1 = match({ id: "b1", claimState: "claimed", name: "B1" });
    const a2 = match({ id: "a2", claimState: "available", name: "A2" });
    const b2 = match({ id: "b2", claimState: "pending", name: "B2" });
    const a3 = match({ id: "a3", claimState: "available", name: "A3" });
    const sorted = sortMatchesForGate([a1, b1, a2, b2, a3]);
    expect(sorted.map((m) => m.id)).toEqual(["a1", "a2", "a3", "b1", "b2"]);
    expect(sorted).toHaveLength(5);
  });

  test("pending AND claimed both partition below available (needs-fixes/rejected ride 'pending')", () => {
    const pending = match({ id: "p", claimState: "pending" });
    const claimed = match({ id: "c", claimState: "claimed" });
    const avail = match({ id: "a", claimState: "available" });
    expect(sortMatchesForGate([pending, claimed, avail])[0].id).toBe("a");
  });

  test("blocked variants render WITHOUT a Yes button (source contract: blocked branch precedes and excludes it)", () => {
    const cardSrc = src("src/components/brand/ClaimMatchCard.tsx");
    const blockedIdx = cardSrc.indexOf("if (blocked) {");
    const yesIdx = cardSrc.indexOf(
      'label={fetchError ? "Continue anyway" : "Yes, this is me"}',
    );
    expect(blockedIdx).toBeGreaterThan(-1);
    expect(yesIdx).toBeGreaterThan(-1);
    // The blocked-variant early return sits ABOVE the Yes JSX…
    expect(blockedIdx).toBeLessThan(yesIdx);
    // …and the blocked block routes to support, never to onYes.
    const blockedBlock = cardSrc.slice(blockedIdx, yesIdx);
    expect(blockedBlock).toContain("Message support");
    expect(blockedBlock).not.toContain("onYes");
  });

  test("sparse facts: 1 fact → NO reassurance; 1 photo → singular copy", () => {
    const oneFact = match({ hasHours: true });
    expect(claimCardFacts(oneFact)).toEqual(["Hours"]);
    expect(shouldShowReassurance(oneFact)).toBe(false);
    const onePhoto = match({ photoCount: 1 });
    expect(claimCardFacts(onePhoto)).toEqual(["1 photo"]);
    const zero = match({});
    expect(claimCardFacts(zero)).toEqual([]);
    expect(shouldShowReassurance(zero)).toBe(false);
  });

  test("facts NEVER include a rating value — presence label only", () => {
    const rated = match({ hasRating: true, photoCount: 3, hasHours: true });
    const facts = claimCardFacts(rated);
    expect(facts).toContain("Rated on Google");
    for (const f of facts) {
      expect(f).not.toMatch(/[0-9]\.[0-9]/); // no "4.6"-style value ever
    }
  });
});

// ---------------------------------------------------------------------------
// A4 — half-claim resume plan + race-honest 23505 backstop ordering
// ---------------------------------------------------------------------------
describe("A4 — resolveClaimSubmitPlan matrix + wizard ordering contracts", () => {
  test("no own row → create", () => {
    expect(resolveClaimSubmitPlan(null, null)).toEqual({ kind: "create" });
  });
  test("own row + tier-1 incomplete → RESUME that venue (never createVenue)", () => {
    expect(resolveClaimSubmitPlan("v-1", null)).toEqual({
      kind: "resume",
      venueId: "v-1",
    });
  });
  test("own row + tier-1 complete → already-submitted (route, never resubmit)", () => {
    expect(resolveClaimSubmitPlan("v-1", "2026-07-01T00:00:00Z")).toEqual({
      kind: "already-submitted",
      venueId: "v-1",
    });
  });

  const wizardSrc = src("src/components/venue/VenueCreatorWizard.tsx");

  test("pre-check runs BEFORE createVenue in the claim submit path", () => {
    const planIdx = wizardSrc.indexOf("const plan = resolveClaimSubmitPlan(");
    const createIdx = wizardSrc.indexOf("createVenue.mutateAsync(");
    expect(planIdx).toBeGreaterThan(-1);
    expect(createIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeLessThan(createIdx);
  });

  test("the 23505 catch re-probes ownership (race honesty) before the foreign §8.2 card", () => {
    // The catch must branch own-vs-foreign via findOwnListingForPlace, not
    // blindly show the support card.
    const catchIdx = wizardSrc.indexOf("PlaceClaimConflictError");
    expect(catchIdx).toBeGreaterThan(-1);
    const afterCatch = wizardSrc.slice(catchIdx);
    expect(afterCatch).toContain("findOwnListingForPlace");
  });

  test("typed conflict error exists and is thrown on the place-uniq arm (service source)", () => {
    const svcSrc = src("src/services/venueListingsService.ts");
    expect(svcSrc).toContain("PlaceClaimConflictError");
    expect(svcSrc).toMatch(/23505/);
  });
});

// ---------------------------------------------------------------------------
// A5 — provenance flips can never lie
// ---------------------------------------------------------------------------
describe("A5 — provenanceFor revert/trim/set-equality", () => {
  test("edit then EXACT revert flips edited → adopted (phone)", () => {
    const d0 = adoptedDraft();
    expect(provenanceFor("phone", d0)).toBe("adopted");
    const edited = { ...d0, contactPhone: "(919) 555-9999" };
    expect(provenanceFor("phone", edited)).toBe("edited");
    const reverted = { ...edited, contactPhone: "(919) 555-0100" };
    expect(provenanceFor("phone", reverted)).toBe("adopted");
  });

  test("whitespace padding does not fake an edit (trim equality)", () => {
    const d = adoptedDraft({}, { contactPhone: "  (919) 555-0100  " });
    expect(provenanceFor("phone", d)).toBe("adopted");
  });

  test("price tiers reordered but set-equal stay adopted; a subset is edited", () => {
    const d0 = adoptedDraft({}, { priceTiers: ["bougie", "comfy"] });
    expect(provenanceFor("price", d0)).toBe("adopted");
    const subset = adoptedDraft({}, { priceTiers: ["comfy"] });
    expect(provenanceFor("price", subset)).toBe("edited");
  });

  test("clearing an adopted field yields NO chip (null), never 'edited'", () => {
    const cleared = adoptedDraft({}, { contactPhone: "" });
    expect(provenanceFor("phone", cleared)).toBeNull();
    const clearedPrice = adoptedDraft({}, { priceTiers: [] });
    expect(provenanceFor("price", clearedPrice)).toBeNull();
  });

  test("editorial-only summary: typed pitch is NEW, never 'edited' (OQ-2)", () => {
    const d = adoptedDraft(
      { summarySource: "editorial" as const },
      { description: "A hand-typed pitch about this bar being great fun." },
    );
    expect(provenanceFor("pitch", d)).toBe("new");
  });

  test("unconfident category is CHIPLESS even when a category is picked", () => {
    const d = adoptedDraft({ categoryConfident: false });
    expect(provenanceFor("category", d)).toBeNull();
  });

  test("hours: same rows in different array order stay adopted (weekday-keyed)", () => {
    const d0 = adoptedDraft();
    const shuffled = {
      ...d0,
      hours: [...d0.hours].reverse(),
    };
    expect(provenanceFor("hours", shuffled)).toBe("adopted");
  });
});

// ---------------------------------------------------------------------------
// A6 — claimStepPrefilled honesty (banner `n` cannot over-count)
// ---------------------------------------------------------------------------
describe("A6 — prefill honesty under invalid adopted payloads", () => {
  test("adopted hours with open===close do NOT count as prefilled (c2)", () => {
    const d = adoptedDraft({
      hours: week([{ weekday: 2, openTime: "10:00", closeTime: "10:00", isClosed: false }]),
    });
    expect(claimStepPrefilled("c2", d)).toBe(false);
  });

  test("adopted OVERNIGHT hours DO count as prefilled (c2) — D-D live math", () => {
    const d = adoptedDraft(); // 22:00→02:00 in the fixture
    expect(claimStepPrefilled("c2", d)).toBe(true);
  });

  test("editorial summary never counts as a prefilled pitch (c5, OQ-2)", () => {
    const d = adoptedDraft({ summarySource: "editorial" as const });
    expect(claimStepPrefilled("c5", d)).toBe(false);
  });

  test("generative summary under 20 chars never counts (c5)", () => {
    const d = adoptedDraft({ summary: "Too short." });
    expect(claimStepPrefilled("c5", d)).toBe(false);
  });

  test("c4 (Cover) NEVER counts as prefilled — even with a cover chosen", () => {
    const d0 = adoptedDraft();
    const withCover: DraftVenueState = {
      ...d0,
      claim: {
        ...(d0.claim as NonNullable<DraftVenueState["claim"]>),
        coverChoice: { url: "https://cdn/a.jpg", type: "image", isNew: false },
      },
    };
    expect(claimStepPrefilled("c4", withCover)).toBe(false);
  });

  test("claim === null → zero prefilled steps, count 0", () => {
    expect(claimStepPrefilled("c2", baseDraft)).toBe(false);
    expect(claimPrefilledStepCount(baseDraft)).toBe(0);
  });

  test("banner n for the full fixture counts EXACTLY the passing steps", () => {
    const d = adoptedDraft();
    // c0 (confident) + c1 (name+address) + c2 (valid hours) + c3 (gallery)
    // + c5 (generative ≥20) + c6 (phone) + c7 (tiers) = 7; c8 hint false, c4 never.
    expect(claimPrefilledStepCount(d)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// A7 — dock label adversarial
// ---------------------------------------------------------------------------
describe("A7 — claimDockLabel edge rules", () => {
  test("c4 is ALWAYS 'Continue' — even prefilled-looking states", () => {
    const d0 = adoptedDraft();
    const withCover: DraftVenueState = {
      ...d0,
      claim: {
        ...(d0.claim as NonNullable<DraftVenueState["claim"]>),
        coverChoice: { url: "https://cdn/a.jpg", type: "image", isNew: false },
      },
    };
    expect(claimDockLabel("c4", d0)).toBe("Continue");
    expect(claimDockLabel("c4", withCover)).toBe("Continue");
  });

  test("c8 defaults to 'Keep & continue' with NOTHING adopted (D-B7), flips on change", () => {
    const noHint = adoptedDraft({ reservableHint: false });
    expect(claimDockLabel("c8", noHint)).toBe("Keep & continue");
    const flipped = { ...noHint, wantsReservations: true };
    expect(claimDockLabel("c8", flipped)).toBe("Save & continue");
  });

  test("c9 is 'Submit for review' regardless of draft state", () => {
    expect(claimDockLabel("c9", baseDraft)).toBe("Submit for review");
    expect(claimDockLabel("c9", adoptedDraft())).toBe("Submit for review");
  });

  test("c2 adopted+untouched = Keep; edited hours = Save", () => {
    const d0 = adoptedDraft();
    expect(claimDockLabel("c2", d0)).toBe("Keep & continue");
    const edited = {
      ...d0,
      hours: week([{ weekday: 5, openTime: "21:00", closeTime: "02:00", isClosed: false }]),
    };
    expect(claimDockLabel("c2", edited)).toBe("Save & continue");
  });

  test("typing ONLY an email on c6 flips Keep → Save (email is a change even chipless)", () => {
    const d0 = adoptedDraft();
    expect(claimDockLabel("c6", d0)).toBe("Keep & continue");
    const withEmail = { ...d0, contactEmail: "owner@example.com" };
    expect(claimDockLabel("c6", withEmail)).toBe("Save & continue");
  });
});

// ---------------------------------------------------------------------------
// A8 — gallery ops boundaries
// ---------------------------------------------------------------------------
describe("A8 — reorder/removal boundary ops", () => {
  const urls = ["u1", "u2", "u3", "u4"];

  test("unknown url → identical order; boundary moves are no-ops", () => {
    expect(reorderGalleryUrls(urls, "nope", "first")).toEqual(urls);
    expect(reorderGalleryUrls(urls, "u1", "earlier")).toEqual(urls);
    expect(reorderGalleryUrls(urls, "u4", "later")).toEqual(urls);
  });

  test("'first' from the middle preserves the others' relative order, drops nothing", () => {
    const next = reorderGalleryUrls(urls, "u3", "first");
    expect(next).toEqual(["u3", "u1", "u2", "u4"]);
    expect([...next].sort()).toEqual([...urls].sort());
  });

  test("earlier/later round-trip restores the original order", () => {
    const once = reorderGalleryUrls(urls, "u2", "later");
    const back = reorderGalleryUrls(once, "u2", "earlier");
    expect(back).toEqual(urls);
  });

  test("removedAdoptedUrls: disjoint kept → all removed; superset kept → none", () => {
    expect(removedAdoptedUrls(["a", "b"], ["x"])).toEqual(["a", "b"]);
    expect(removedAdoptedUrls(["a", "b"], ["a", "b", "up1"])).toEqual([]);
    expect(removedAdoptedUrls([], ["x"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A9 — adoption prefill purity + junk filtering
// ---------------------------------------------------------------------------
describe("A9 — copy-on-start means COPY (pure, filtered, honest flags)", () => {
  const detail: PoolAdoptionDetail = {
    id: "9b8f2a44-aaaa-bbbb-cccc-444455556666",
    name: "Adversary Tavern",
    address: "13 Elm St",
    city: "Raleigh",
    country: "USA",
    lat: 35.78,
    lng: -78.64,
    googlePlaceId: "ChIJadversary",
    primaryType: "bar",
    types: ["bar"],
    openingHours: {
      periods: [
        { open: { day: 5, hour: 22, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } },
      ],
    },
    photoUrls: ["https://cdn/a.jpg", "https://cdn/b.jpg"],
    nationalPhoneNumber: "(919) 555-0100",
    website: "https://adversary.example",
    priceTiers: ["comfy", "not_a_tier", "LAVISH", "bougie"],
    priceLevel: "PRICE_LEVEL_EXPENSIVE",
    generativeSummary: "Late-night cocktails and a dance floor that fills after ten.",
    editorialSummary: "Google editors like it.",
    reservable: true,
    facets: { serves_cocktails: true },
    venueCategory: "restaurant",
    venueCategoryConfident: true,
  };

  test("frozen inputs survive prefill (no mutation of match/detail)", () => {
    const m = match({ claimState: "available" });
    Object.freeze(m);
    Object.freeze(m.photoUrls);
    const dFrozen = { ...detail };
    Object.freeze(dFrozen);
    Object.freeze(dFrozen.photoUrls);
    Object.freeze(dFrozen.priceTiers);
    expect(() => prefillDraftFromAdoption(m, dFrozen)).not.toThrow();
  });

  test("junk price tiers are filtered to the canonical vocabulary (case-exact)", () => {
    const prefill = prefillDraftFromAdoption(match({}), detail);
    expect(prefill.priceTiers).toEqual(["comfy", "bougie"]);
  });

  test("adopted snapshot is a distinct copy — later gallery edits cannot reach it", () => {
    const prefill = prefillDraftFromAdoption(match({}), detail);
    const claim = prefill.claim as NonNullable<DraftVenueState["claim"]>;
    expect(claim.adopted.galleryUrls).toEqual(detail.photoUrls);
    expect(claim.adopted.galleryUrls).not.toBe(detail.photoUrls);
    expect(claim.keptGalleryUrls).not.toBe(claim.adopted.galleryUrls);
  });

  test("detailFetched is TRUE on the adoption path and coverChoice starts null", () => {
    const prefill = prefillDraftFromAdoption(match({}), detail);
    const claim = prefill.claim as NonNullable<DraftVenueState["claim"]>;
    expect(claim.detailFetched).toBe(true);
    expect(claim.coverChoice).toBeNull();
  });

  test("editorial summary NEVER lands in the pitch textarea (OQ-2)", () => {
    const editorialOnly: PoolAdoptionDetail = {
      ...detail,
      generativeSummary: null,
    };
    const prefill = prefillDraftFromAdoption(match({}), editorialOnly);
    expect(prefill.description).toBe("");
    const claim = prefill.claim as NonNullable<DraftVenueState["claim"]>;
    expect(claim.adopted.summarySource).toBe("editorial");
    expect(claim.adopted.summary).toBe("Google editors like it.");
  });
});
