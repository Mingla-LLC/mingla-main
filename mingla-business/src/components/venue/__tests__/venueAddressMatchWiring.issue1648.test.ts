/**
 * Issue #1648 — the s0 address match is REACHABLE, and accepting it converts.
 *
 * This suite exists because of a specific failure mode on this very feature:
 * the server half can be perfect, deployed and verified, and still change
 * nothing for a single brand if no screen calls it. "Built" is not "wired". So
 * the first assertion below is the boring one that matters most — the prompt is
 * actually mounted on the step where the address is picked.
 *
 * It also re-pins ORCH-1079's dedup guard ACROSS the new mount. Accepting a
 * match legitimately writes `googlePlaceId` (the pool row's own Google id, which
 * `biz_create_venue_brand_authoring` compares against `place_pool`), while the
 * address handlers must never write it (a Mapbox `mapbox_id` in that column
 * poisons the dedup key). Keeping the conversion in its own file is what lets
 * both be true, so the file boundary itself is asserted.
 *
 * The wizard cannot mount under the node/ts-jest config, so the wiring is
 * pinned source-text style (house precedent: VenueCreatorWizard.ve2.test.ts)
 * and the conversion is replayed BEHAVIOURALLY against the real prefill + the
 * real step model.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import { prefillDraftFromAdoption } from "../../../utils/prefillDraftFromPoolMatch";
import { venueWizardSteps } from "../venueWizardValidation";
import type { PoolAdoptionDetail, PoolMatch } from "../../../types/poolMatch";

const STEP1 = join(__dirname, "..", "VenueStep1Address.tsx");
const PROMPT = join(__dirname, "..", "VenueAddressMatchPrompt.tsx");
const read = (p: string): string => readFileSync(p, "utf8");

/** Strip comments — ours legitimately discuss googlePlaceId at length. */
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("#1648 — the prompt is mounted where the address is picked", () => {
  test("VenueStep1Address renders VenueAddressMatchPrompt", () => {
    const src = codeOnly(read(STEP1));
    expect(src).toContain("import { VenueAddressMatchPrompt }");
    // The mount itself — an import alone would be dead machinery.
    expect(src).toMatch(/<VenueAddressMatchPrompt\s*\/>/);
  });

  test("the prompt asks the endpoint the server half deployed", () => {
    const src = read(PROMPT) + read(join(__dirname, "..", "..", "..", "hooks", "useVenueAddressPoolMatch.ts"));
    expect(src).toContain("useVenueAddressPoolMatch");
    expect(src).toContain("matchPoolByAddress");
  });

  test("both answers are wired: YES adopts, No/Skip remembers and stays put", () => {
    const src = codeOnly(read(PROMPT));
    expect(src).toContain("prefillDraftFromAdoption");
    // The gate's proven fallback when the detail fetch dies — never silent.
    expect(src).toContain("prefillDraftFromPoolMatch");
    expect(src).toContain("PlaceNotAvailableError");
    // No/Skip must NOT navigate — the brand keeps the address they picked.
    expect(src).toContain("onNo={dismiss}");
    expect(src).toContain("onSkip={dismiss}");
    expect(src).not.toContain("router.replace");
  });
});

describe("#1648 — ORCH-1079's dedup guard survives the new mount", () => {
  test("no patch() in VenueStep1Address writes googlePlaceId", () => {
    const src = codeOnly(read(STEP1));
    const patchCalls = src.match(/patch\(\{[\s\S]*?\}\)/g) ?? [];
    expect(patchCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of patchCalls) {
      expect(call).not.toContain("googlePlaceId");
    }
  });

  test("the conversion lives in its own file — that is WHY the guard holds", () => {
    // If a later change inlines the claim prefill into the address step, the
    // test above starts failing. This one says out loud why it must not.
    const step1 = codeOnly(read(STEP1));
    expect(step1).not.toContain("prefillDraftFromAdoption");
    expect(step1).not.toContain("prefillDraftFromPoolMatch");
  });
});

// ── Behavioural: accepting the match really does convert the wizard ──────────

const MATCH: PoolMatch = {
  id: "pool-row-1",
  name: "440 Nightclub",
  address: "440 W Hargett St",
  city: "Raleigh",
  country: "United States",
  lat: 35.7787,
  lng: -78.6438,
  googlePlaceId: "ChIJpoolGooglePlaceId",
  primaryPhotoUrl: null,
  primaryType: "night_club",
  types: ["night_club"],
  venueCategory: "play",
  openingHours: null,
  photoUrls: ["https://cdn/1.jpg"],
  claimState: "available",
  venueCategoryConfident: true,
};

const DETAIL: PoolAdoptionDetail = {
  id: "pool-row-1",
  name: "440 Nightclub",
  address: "440 W Hargett St",
  city: "Raleigh",
  country: "United States",
  lat: 35.7787,
  lng: -78.6438,
  googlePlaceId: "ChIJpoolGooglePlaceId",
  primaryType: "night_club",
  types: ["night_club"],
  openingHours: null,
  photoUrls: ["https://cdn/1.jpg", "https://cdn/2.jpg"],
  nationalPhoneNumber: "(919) 377-0509",
  website: "https://440nightclub.example",
  priceTiers: ["comfy"],
  priceLevel: null,
  generativeSummary: null,
  editorialSummary: null,
  reservable: false,
  facets: {},
  venueCategory: "play",
  venueCategoryConfident: true,
};

describe("#1648 — YES at s0 lands in the same place YES at the name gate lands", () => {
  test("the draft flips to claim mode, carrying the POOL's Google id", () => {
    // What the brand had before pressing Yes: a self-typed address, no identity.
    const before = {
      placePoolId: null as string | null,
      googlePlaceId: null as string | null,
      formattedAddress: "440 W Hargett Street, Raleigh NC",
      claim: null as unknown,
      step: 0,
    };
    const { photoUris: _legacy, ...prefill } = prefillDraftFromAdoption(
      MATCH,
      DETAIL,
    );
    const after = { ...before, ...prefill }; // patch() is a shallow merge.

    expect(after.placePoolId).toBe("pool-row-1");
    // The pool row's OWN Google id — the dedup key the create RPC compares.
    // Never a Mapbox id, which is the whole point of ORCH-1079's guard.
    expect(after.googlePlaceId).toBe("ChIJpoolGooglePlaceId");
    expect(after.claim).not.toBeNull();
    // The pool row is the identity, so its address replaces the typed one.
    expect(after.formattedAddress).toBe("440 W Hargett St");
    expect(after.step).toBe(0);
  });

  test("claim mode swaps the wizard's step map — step 0 becomes c0, not s0", () => {
    const { claim } = prefillDraftFromAdoption(MATCH, DETAIL);
    const isClaim = claim !== null && claim !== undefined;
    expect(isClaim).toBe(true);
    // Before: the create arm starts on the address step the brand was standing on.
    expect(venueWizardSteps(false)[0].id).toBe("s0");
    // After: the 10-step claim walkthrough, from its first step — byte-identical
    // to where the name gate's "Yes, this is me" lands.
    expect(venueWizardSteps(true)[0].id).toBe("c0");
    expect(venueWizardSteps(true)).toHaveLength(9);
  });
});
