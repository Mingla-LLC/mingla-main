/**
 * ORCH-1256 — buildBusinessTodos band 6 (brand-profile completion rows).
 *
 * Implementor happy-path regression (SPEC §7 T-1/T-2/T-3/T-7/T-8). Reverting
 * the band-6 emit in businessTodos.ts fails T-1/T-2/T-3 (fails-on-revert);
 * making the `profile` input required or default-on fails T-7.
 */
import { describe, expect, test } from "@jest/globals";

import type { BusinessTodoProfileInput } from "../brandProfileCompleteness";
import {
  buildBusinessTodos,
  type BusinessTodoInput,
} from "../businessTodos";

const base: BusinessTodoInput = {
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: "deck_eligible",
  pipelineRoute:
    "/venue/deck-readiness?brand_id=b1&focus=review&fix=review_pipeline",
  venueDraftInProgress: false,
  hasPhysicalLocation: true,
  counts: { total: 3, live: 1, draft: 0 },
  stripeActive: true,
  hasDraftPaidOffering: false,
  stripeRoute: "/brand/b1/payments",
  draftRoute: null,
  venueClaimPending: false,
  venueListingRoute: "/brand/b1/listing",
  venueClaimOpenFeedbackCount: 0,
  venueFeedbackRoute: "/brand/b1/listing?focus=feedback",
};

const allTrue: BusinessTodoProfileInput = {
  needsCover: true,
  needsPhoto: true,
  needsTagline: true,
  needsDescription: true,
  needsAddress: true,
  needsEmail: true,
  needsPhone: true,
  needsSocials: true,
};

const EDIT_ROUTE = "/brand/b1/edit";

const PROFILE_IDS = [
  "profile_add_cover",
  "profile_add_photo",
  "profile_add_tagline",
  "profile_add_description",
  "profile_add_address",
  "profile_add_email",
  "profile_add_phone",
  "profile_add_socials",
] as const;

const ids = (input: BusinessTodoInput): string[] =>
  buildBusinessTodos(input).map((t) => t.id);

describe("buildBusinessTodos — ORCH-1256 profile band (6, tail)", () => {
  // T-1 — fresh brand, all fields empty → the 8 rows, exact order + routes.
  test("T-1: all-true profile → 8 rows in fixed order, each deep-linking ?section=", () => {
    const todos = buildBusinessTodos({
      ...base,
      profile: { ...allTrue, editRoute: EDIT_ROUTE },
    });
    expect(todos.map((t) => t.id)).toEqual([...PROFILE_IDS]);
    const routeOf = (id: string): string => {
      const row = todos.find((t) => t.id === id);
      if (row === undefined || row.action.kind !== "route") {
        throw new Error(`row ${id} missing or not a route action`);
      }
      return row.action.route;
    };
    expect(routeOf("profile_add_cover")).toBe(`${EDIT_ROUTE}?section=cover`);
    expect(routeOf("profile_add_photo")).toBe(`${EDIT_ROUTE}?section=photo`);
    expect(routeOf("profile_add_tagline")).toBe(`${EDIT_ROUTE}?section=about`);
    expect(routeOf("profile_add_description")).toBe(
      `${EDIT_ROUTE}?section=about`,
    );
    expect(routeOf("profile_add_address")).toBe(
      `${EDIT_ROUTE}?section=address`,
    );
    expect(routeOf("profile_add_email")).toBe(`${EDIT_ROUTE}?section=contact`);
    expect(routeOf("profile_add_phone")).toBe(`${EDIT_ROUTE}?section=contact`);
    expect(routeOf("profile_add_socials")).toBe(
      `${EDIT_ROUTE}?section=social`,
    );
  });

  test("T-1b: exact copy — labels/sublabels are the SPEC strings, no badge", () => {
    const todos = buildBusinessTodos({
      ...base,
      profile: { ...allTrue, editRoute: EDIT_ROUTE },
    });
    expect(
      todos.map((t) => [t.id, t.label, t.sublabel, t.badge]),
    ).toEqual([
      ["profile_add_cover", "Add a cover", "Make your public page pop", undefined],
      ["profile_add_photo", "Add a profile photo", "Put a face on your brand", undefined],
      ["profile_add_tagline", "Add a tagline", "One line that says what you do", undefined],
      ["profile_add_description", "Describe your brand", "Tell people what you're about", undefined],
      ["profile_add_address", "Add your address", "Help people find you", undefined],
      ["profile_add_email", "Add a contact email", "So customers can reach you", undefined],
      ["profile_add_phone", "Add a phone number", "Another way to reach you", undefined],
      ["profile_add_socials", "Add your social links", "Instagram, TikTok, your website and more", undefined],
    ]);
  });

  // T-2 — tail placement: profile rows sit AFTER every structural row.
  test("T-2: profile rows come after get_venue_live / connect_stripe / finish_draft", () => {
    const todos = ids({
      ...base,
      pipelineStatus: "needs_fix",
      stripeActive: false,
      counts: { total: 1, live: 0, draft: 1 },
      draftRoute: "/event/d1/edit",
      profile: { ...allTrue, editRoute: EDIT_ROUTE },
    });
    expect(todos).toEqual([
      "get_venue_live",
      "connect_stripe",
      "finish_draft",
      ...PROFILE_IDS,
    ]);
  });

  // T-3 — no-false-positive matrix: each field filled one at a time drops
  // exactly its own row.
  const flagToId: Array<[keyof BusinessTodoProfileInput, string]> = [
    ["needsCover", "profile_add_cover"],
    ["needsPhoto", "profile_add_photo"],
    ["needsTagline", "profile_add_tagline"],
    ["needsDescription", "profile_add_description"],
    ["needsAddress", "profile_add_address"],
    ["needsEmail", "profile_add_email"],
    ["needsPhone", "profile_add_phone"],
    ["needsSocials", "profile_add_socials"],
  ];
  test.each(flagToId)(
    "T-3: %s=false → only %s absent, other 7 present",
    (flag, id) => {
      const todos = ids({
        ...base,
        profile: { ...allTrue, [flag]: false, editRoute: EDIT_ROUTE },
      });
      expect(todos).not.toContain(id);
      expect(todos).toEqual(PROFILE_IDS.filter((p) => p !== id));
    },
  );

  test("all-false profile → zero profile rows (healthy brand stays empty)", () => {
    const allFalse = Object.fromEntries(
      Object.keys(allTrue).map((k) => [k, false]),
    ) as unknown as BusinessTodoProfileInput;
    expect(
      buildBusinessTodos({
        ...base,
        profile: { ...allFalse, editRoute: EDIT_ROUTE },
      }),
    ).toEqual([]);
  });

  // T-7 — the input is OPTIONAL: absent ⇒ zero profile rows, legacy behavior
  // byte-identical (protects every pre-1256 caller/test).
  test("T-7: profile key omitted → zero profile_* rows; healthy brand still []", () => {
    expect(buildBusinessTodos(base)).toEqual([]);
    const busy = ids({
      ...base,
      pipelineStatus: "needs_fix",
      counts: { total: 0, live: 0, draft: 0 },
    });
    expect(busy.some((id) => id.startsWith("profile_"))).toBe(false);
  });

  // T-8 — flash gating: resolving/no-brand early-returns win over profile.
  test("T-8: brandResolving (or !hasBrand) + all-true profile → no profile rows", () => {
    expect(
      buildBusinessTodos({
        ...base,
        brandResolving: true,
        profile: { ...allTrue, editRoute: EDIT_ROUTE },
      }),
    ).toEqual([]);
    expect(
      buildBusinessTodos({
        ...base,
        hasBrand: false,
        profile: { ...allTrue, editRoute: EDIT_ROUTE },
      }),
    ).toEqual([]);
  });
});
