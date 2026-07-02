/**
 * ORCH-1256 — TESTER-OWNED adversarial regression (mingla-tester).
 *
 * Attacks DIFFERENT angles than the implementor's happy-path suites
 * (businessTodos.profile.test.ts / brandProfileCompleteness.test.ts):
 *
 *   A. Unicode-whitespace predicate bypass — NBSP, ideographic space,
 *      figure space, BOM/ZWNBSP, LS/PS line separators must ALL count as
 *      EMPTY (JS String.prototype.trim strips them); the zero-width space
 *      U+200B is NOT White_Space and therefore counts as FILLED — the
 *      boundary is pinned so silent drift in either direction is caught.
 *   B. False-positive invariant END-TO-END — a brand whose every field is
 *      filled with whitespace-PADDED real content must produce ZERO
 *      profile_* rows through the full derive → build pipeline
 *      (I-PROPOSED-1256-PROFILE-TODOS-NO-FALSE-POSITIVE), and the output
 *      must be deep-equal to the no-profile-input output (band 6 adds
 *      nothing else).
 *   C. Socials permutation matrix — every single network filled alone
 *      suppresses the aggregated row; a whitespace-only network does NOT;
 *      links.custom (even combined with all-blank networks) is ignored.
 *   D. Container edge shapes — contact: {} / links: {} / custom: [] behave
 *      as fully empty.
 *   E. Degraded-state leak — `profile` supplied while the builder is in a
 *      brand-gate early-return state (hasNoBrands / hasBrandsButNoSelection /
 *      brandResolving) must leak ZERO profile rows (no-flash contract from
 *      the builder side, beyond the hook gate).
 *   F. Backward compat — absent AND explicitly-undefined `profile` emit no
 *      profile ids and no "?section=" route anywhere.
 *
 * fails-on-revert: deleting the band-6 block in businessTodos.ts fails B/C/E
 * fixtures that expect rows; deleting `.trim()` from isBlank fails A and B.
 */
import { describe, expect, test } from "@jest/globals";

import type { Brand } from "../../types/brand";
import {
  deriveBrandProfileTodoInput,
  isBlank,
  SOCIAL_TODO_KEYS,
} from "../brandProfileCompleteness";
import {
  buildBusinessTodos,
  type BusinessTodoInput,
} from "../businessTodos";

const baseBrand = (overrides: Partial<Brand> = {}): Brand => ({
  id: "b-adv",
  displayName: "Adversarial Brand",
  slug: "adversarial-brand",
  address: null,
  coverHue: 210,
  role: "owner",
  stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
  currentLiveEvent: null,
  ...overrides,
});

const baseInput: BusinessTodoInput = {
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: "deck_eligible",
  pipelineRoute: "/venue/deck-readiness?brand_id=b-adv",
  venueDraftInProgress: false,
  hasPhysicalLocation: true,
  counts: { total: 2, live: 1, draft: 0 },
  stripeActive: true,
  hasDraftPaidOffering: false,
  stripeRoute: "/brand/b-adv/payments",
  draftRoute: null,
  venueClaimPending: false,
  venueListingRoute: "/brand/b-adv/listing",
  venueClaimOpenFeedbackCount: 0,
  venueFeedbackRoute: "/brand/b-adv/listing?focus=feedback",
};

const EDIT_ROUTE = "/brand/b-adv/edit";

const profileIdsIn = (input: BusinessTodoInput): string[] =>
  buildBusinessTodos(input)
    .map((t) => t.id)
    .filter((id) => id.startsWith("profile_"));

// ---------------------------------------------------------------------------
// A — Unicode-whitespace bypass hunt
// ---------------------------------------------------------------------------
describe("A — isBlank vs exotic Unicode whitespace", () => {
  const TRIMMED_WHITESPACE: Array<[string, string]> = [
    ["U+00A0 no-break space", "  "],
    ["U+3000 ideographic space", "　"],
    ["U+2007 figure space", "  "],
    ["U+FEFF BOM / zero-width no-break space", "﻿"],
    ["U+2028 line separator", " "],
    ["U+2029 paragraph separator", " "],
    ["mixed exotic soup", " \t 　﻿\n"],
  ];

  test.each(TRIMMED_WHITESPACE)(
    "%s counts as EMPTY (row must still show)",
    (_name, value) => {
      expect(isBlank(value)).toBe(true);
      const derived = deriveBrandProfileTodoInput(
        baseBrand({
          address: value,
          tagline: value,
          bio: value,
          photo: value,
          coverMediaUrl: value,
          contact: { email: value, phone: value },
          links: { instagram: value },
        }),
      );
      // Every predicate stays true — exotic whitespace never fakes "filled".
      expect(derived).toEqual({
        needsCover: true,
        needsPhoto: true,
        needsTagline: true,
        needsDescription: true,
        needsAddress: true,
        needsEmail: true,
        needsPhone: true,
        needsSocials: true,
      });
    },
  );

  test("U+200B zero-width space is NOT White_Space → counts as FILLED (boundary pinned)", () => {
    // Documents the exact edge of the trim rule. If someone "fixes" isBlank
    // to also strip Cf characters (or breaks trim entirely), this fails and
    // forces a conscious decision.
    expect(isBlank("​")).toBe(false);
    const derived = deriveBrandProfileTodoInput(
      baseBrand({ tagline: "​" }),
    );
    expect(derived.needsTagline).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B — false-positive invariant, end-to-end (derive → build)
// ---------------------------------------------------------------------------
describe("B — filled field NEVER shows its row (invariant, end-to-end)", () => {
  const paddedFilledBrand = baseBrand({
    coverMediaUrl: "  https://cdn.example.com/cover.jpg  ",
    photo: "\thttps://cdn.example.com/photo.jpg\n",
    tagline: "  One crisp line  ",
    bio: "  A real story  ",
    address: "  12 Old Street, London  ",
    contact: { email: " hello@brand.com ", phone: "\t+44 7700 900312 " },
    links: { tiktok: "  @brand  " },
  });

  test("whitespace-padded real content in EVERY field → zero profile rows", () => {
    const derived = deriveBrandProfileTodoInput(paddedFilledBrand);
    expect(Object.values(derived).every((v) => v === false)).toBe(true);

    const withProfile = buildBusinessTodos({
      ...baseInput,
      profile: { ...derived, editRoute: EDIT_ROUTE },
    });
    expect(
      withProfile.filter((t) => t.id.startsWith("profile_")),
    ).toEqual([]);
  });

  test("all-false profile output is DEEP-EQUAL to no-profile output (band 6 adds nothing else)", () => {
    const derived = deriveBrandProfileTodoInput(paddedFilledBrand);
    const withProfile = buildBusinessTodos({
      ...baseInput,
      profile: { ...derived, editRoute: EDIT_ROUTE },
    });
    const withoutProfile = buildBusinessTodos({ ...baseInput });
    expect(withProfile).toEqual(withoutProfile);
  });

  test("each single field filled (padded) kills exactly its own row through the FULL pipeline", () => {
    const fieldToId: Array<[Partial<Brand>, string]> = [
      [{ coverMediaUrl: "  https://x/c.jpg " }, "profile_add_cover"],
      [{ photo: " https://x/p.jpg\t" }, "profile_add_photo"],
      [{ tagline: " hi " }, "profile_add_tagline"],
      [{ bio: " story " }, "profile_add_description"],
      [{ address: " somewhere " }, "profile_add_address"],
      [{ contact: { email: " a@b.co " } }, "profile_add_email"],
      [{ contact: { phone: " +1 555 " } }, "profile_add_phone"],
      [{ links: { website: " https://b.co " } }, "profile_add_socials"],
    ];
    for (const [override, killedId] of fieldToId) {
      const derived = deriveBrandProfileTodoInput(baseBrand(override));
      const ids = profileIdsIn({
        ...baseInput,
        profile: { ...derived, editRoute: EDIT_ROUTE },
      });
      expect(ids).not.toContain(killedId);
      expect(ids).toHaveLength(7);
    }
  });
});

// ---------------------------------------------------------------------------
// C — socials permutation matrix
// ---------------------------------------------------------------------------
describe("C — aggregated socials row permutations", () => {
  test.each(SOCIAL_TODO_KEYS.map((k) => [k] as const))(
    "ONLY %s filled → needsSocials false → no socials row",
    (key) => {
      const derived = deriveBrandProfileTodoInput(
        baseBrand({ links: { [key]: "https://example.com/x" } }),
      );
      expect(derived.needsSocials).toBe(false);
      expect(
        profileIdsIn({
          ...baseInput,
          profile: { ...derived, editRoute: EDIT_ROUTE },
        }),
      ).not.toContain("profile_add_socials");
    },
  );

  test("a whitespace-only network does NOT suppress the row", () => {
    const derived = deriveBrandProfileTodoInput(
      baseBrand({ links: { instagram: "   ", x: " " } }),
    );
    expect(derived.needsSocials).toBe(true);
  });

  test("links.custom alone (all 8 networks blank) does NOT suppress the row — custom is ignored", () => {
    const derived = deriveBrandProfileTodoInput(
      baseBrand({
        links: {
          custom: [{ label: "Menu", url: "https://brand.com/menu" }],
          instagram: "  ",
        },
      }),
    );
    expect(derived.needsSocials).toBe(true);
    expect(
      profileIdsIn({
        ...baseInput,
        profile: { ...derived, editRoute: EDIT_ROUTE },
      }),
    ).toContain("profile_add_socials");
  });

  test("custom PLUS one real network → suppressed (the network, not custom, decides)", () => {
    const derived = deriveBrandProfileTodoInput(
      baseBrand({
        links: {
          custom: [{ label: "Menu", url: "https://brand.com/menu" }],
          threads: "@brand",
        },
      }),
    );
    expect(derived.needsSocials).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D — container edge shapes
// ---------------------------------------------------------------------------
describe("D — empty container shapes", () => {
  test("contact: {} and links: {} and custom: [] behave as fully empty", () => {
    const derived = deriveBrandProfileTodoInput(
      baseBrand({ contact: {}, links: { custom: [] } }),
    );
    expect(derived.needsEmail).toBe(true);
    expect(derived.needsPhone).toBe(true);
    expect(derived.needsSocials).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E — degraded-state leak (builder-side no-flash, beyond the hook gate)
// ---------------------------------------------------------------------------
describe("E — profile supplied in brand-gate states leaks ZERO rows", () => {
  const allTrueProfile = {
    ...deriveBrandProfileTodoInput(baseBrand()),
    editRoute: EDIT_ROUTE,
  };

  test("hasNoBrands + profile → only create_brand", () => {
    const ids = buildBusinessTodos({
      ...baseInput,
      hasNoBrands: true,
      hasBrand: false,
      profile: allTrueProfile,
    }).map((t) => t.id);
    expect(ids).toEqual(["create_brand"]);
  });

  test("hasBrandsButNoSelection + profile → only select_brand", () => {
    const ids = buildBusinessTodos({
      ...baseInput,
      hasBrandsButNoSelection: true,
      hasBrand: false,
      profile: allTrueProfile,
    }).map((t) => t.id);
    expect(ids).toEqual(["select_brand"]);
  });

  test("brandResolving + profile → [] (no flash from the builder side)", () => {
    const ids = buildBusinessTodos({
      ...baseInput,
      brandResolving: true,
      profile: allTrueProfile,
    }).map((t) => t.id);
    expect(ids).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// F — backward compat: absent profile emits nothing profile-shaped
// ---------------------------------------------------------------------------
describe("F — absent / explicitly-undefined profile input", () => {
  test.each([
    ["omitted", { ...baseInput }],
    ["explicitly undefined", { ...baseInput, profile: undefined }],
  ] as Array<[string, BusinessTodoInput]>)(
    "profile %s → no profile ids and no ?section= route anywhere",
    (_name, input) => {
      const todos = buildBusinessTodos(input);
      expect(todos.some((t) => t.id.startsWith("profile_"))).toBe(false);
      expect(
        todos.some(
          (t) => t.action.kind === "route" && t.action.route.includes("?section="),
        ),
      ).toBe(false);
    },
  );
});
