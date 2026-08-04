/**
 * Issue #1558 [venue-category-profiles] — implementor happy-path regression.
 *
 * WHAT A GUEST GETS OUT OF THIS, in one line each:
 *   - a gallery, a gym or an unclassified venue is no longer invited to
 *     "Reserve a table";
 *   - a hotel stops publishing `Mon–Sat 09:00–17:00` on the same page whose
 *     booking tab says check-in is at 15:00, and shows check-in/check-out.
 *
 * WHAT THIS FILE ACTUALLY PROVES. Not "the Record has the keys it has" — that
 * assertion is worthless, it can only enumerate what is already there. It
 * proves the COMPILE ERROR: `@ts-expect-error` fails the build when the error
 * it names STOPS happening, so each one below is a live proof that an
 * incomplete map is rejected by the type system. ts-jest type-checks this file
 * (`diagnostics.exclude` covers `**​/packages/**`, never `src/**`), so an
 * unused directive is TS2578 and this suite goes red.
 *
 * Every loop below carries a VACUITY GUARD — an explicit count assertion that
 * fails if the loop observed nothing. A test that iterates an empty collection
 * passes for the wrong reason, and this repo has been bitten by that class
 * repeatedly.
 *
 * DELIBERATELY NOT HERE: whether the two venue surfaces still ROUTE through
 * this table. That is a structural rule about file topology, and a readFileSync
 * pin for it is exactly what I-PROPOSED-1047-BIZ-NO-SOLE-SOURCE-PIN forbids —
 * such pins rot on refactor and caught zero of the #1047 regressions. It is
 * enforced instead by an additive, self-testing CI gate:
 * `.github/scripts/strict-grep/issue-1558-venue-category-profile-single-owner.mjs`
 * (15-case self-test, hard-fails on a missing or comment-only target).
 */
// Relative, NOT the "@mingla/brand-rendering/…" specifier the product code
// uses: `node_modules/@mingla/*` is a workspace symlink, so under a git
// worktree jest would resolve the ANCHOR checkout's copy of this module and
// silently test main instead of this branch. The relative path always tests
// the file in THIS checkout.
import {
  VENUE_CATEGORY_PROFILES,
  VENUE_SECTION_IDS,
  stayClockLabel,
  typicalSpendVisible,
  venueCategoryKey,
  venueCategoryProfile,
  venueMenuTabVisible,
  venueNotTakingReservationsCopy,
  venueShowsTradingHours,
  type VenueCategoryKey,
  type VenueCategoryProfile,
  type VenueSectionId,
} from "../../../../../packages/brand-rendering/venueCategoryProfile";

const ALL_KEYS: readonly VenueCategoryKey[] = [
  "restaurant",
  "play",
  "creative_and_arts",
  "stay",
  "uncategorised",
];

describe("#1558 — the profile table is TOTAL, proven by compile error", () => {
  test("every key resolves to a complete profile (5 arms, none empty)", () => {
    // Positive control: the shipped table satisfies the total Record.
    const total: Record<VenueCategoryKey, VenueCategoryProfile> =
      VENUE_CATEGORY_PROFILES;
    expect(Object.keys(total).sort()).toEqual([...ALL_KEYS].sort());
    expect(Object.keys(total)).toHaveLength(5);

    let inspected = 0;
    for (const key of ALL_KEYS) {
      const profile = total[key];
      expect(profile.key).toBe(key);
      expect(profile.noun.trim().length).toBeGreaterThan(0);
      expect(profile.reserveAction.trim().length).toBeGreaterThan(0);
      expect(profile.tabs.length).toBeGreaterThan(0);
      expect(profile.overview.length).toBeGreaterThan(0);
      inspected += 1;
    }
    // Vacuity guard: the loop must actually have run over all five.
    expect(inspected).toBe(5);
  });

  test("PROOF: an incomplete category map does not compile", () => {
    // @ts-expect-error — dropping `uncategorised` MUST fail. A NULL category is
    // a named arm, not a fall-through into restaurant. If this directive ever
    // becomes unused, the Record stopped being total and CI must go red.
    const missingNullArm: Record<VenueCategoryKey, VenueCategoryProfile> = {
      restaurant: VENUE_CATEGORY_PROFILES.restaurant,
      play: VENUE_CATEGORY_PROFILES.play,
      creative_and_arts: VENUE_CATEGORY_PROFILES.creative_and_arts,
      stay: VENUE_CATEGORY_PROFILES.stay,
    };
    expect(Object.keys(missingNullArm)).toHaveLength(4);
  });

  test("PROOF: adding a FIFTH category is a compile error until it has a profile", () => {
    // The success condition of this issue, stated as a type. A future category
    // key widens the union; the shipped table no longer satisfies it.
    type FutureVenueCategoryKey = VenueCategoryKey | "spa";
    // @ts-expect-error — `spa` has no profile, so the total map is unsatisfied.
    const withFifthCategory: Record<
      FutureVenueCategoryKey,
      VenueCategoryProfile
    > = VENUE_CATEGORY_PROFILES;
    expect(Object.keys(withFifthCategory)).not.toContain("spa");
  });

  test("PROOF: an incomplete SECTION registry does not compile", () => {
    // The second total Record. Both pages type their registry exactly this way,
    // so a listed section id can never resolve to nothing.
    // @ts-expect-error — `gallery` is missing; a section registry must be total.
    const missingRenderer: Record<VenueSectionId, string> = {
      priceLede: "x",
      about: "x",
      location: "x",
      hours: "x",
      stayPolicy: "x",
    };
    expect(Object.keys(missingRenderer)).toHaveLength(5);
  });
});

describe("#1558 — what a guest reads, per category", () => {
  test("a gallery, a gym and an unclassified venue are NOT offered a table", () => {
    const notTables: readonly VenueCategoryKey[] = [
      "play",
      "creative_and_arts",
      "uncategorised",
    ];
    let checked = 0;
    for (const key of notTables) {
      const action = VENUE_CATEGORY_PROFILES[key].reserveAction;
      expect(action.toLowerCase()).not.toContain("table");
      expect(action).toBe("Book a visit");
      checked += 1;
    }
    expect(checked).toBe(3); // vacuity guard
    // …and the one category that SHOULD say table still does.
    expect(VENUE_CATEGORY_PROFILES.restaurant.reserveAction).toBe(
      "Reserve a table",
    );
    expect(VENUE_CATEGORY_PROFILES.stay.reserveAction).toBe(
      "Reserve this Stay",
    );
  });

  test("a NULL category is `uncategorised` — never silently a restaurant", () => {
    expect(venueCategoryKey(null)).toBe("uncategorised");
    const resolved = venueCategoryProfile(null);
    expect(resolved.key).toBe("uncategorised");
    // The whole point: it must NOT be the restaurant profile.
    expect(resolved.reserveAction).not.toBe(
      VENUE_CATEGORY_PROFILES.restaurant.reserveAction,
    );
    expect(resolved).not.toBe(VENUE_CATEGORY_PROFILES.restaurant);
    // …while a real category still resolves to itself.
    expect(venueCategoryProfile("stay")).toBe(VENUE_CATEGORY_PROFILES.stay);
    expect(venueCategoryProfile("restaurant").key).toBe("restaurant");
  });

  test("the empty-reservations line reads the category's own noun", () => {
    expect(venueNotTakingReservationsCopy(VENUE_CATEGORY_PROFILES.restaurant))
      .toBe("This restaurant isn’t taking reservations right now.");
    expect(venueNotTakingReservationsCopy(VENUE_CATEGORY_PROFILES.play)).toBe(
      "This venue isn’t taking reservations right now.",
    );
    // Falsifiable: the copy must actually vary with the noun.
    expect(
      venueNotTakingReservationsCopy(VENUE_CATEGORY_PROFILES.restaurant),
    ).not.toBe(venueNotTakingReservationsCopy(VENUE_CATEGORY_PROFILES.play));
  });
});

describe("#1558 — a hotel keeps time differently, and that is DATA", () => {
  test("a Stay lists stayPolicy and NEVER hours; a restaurant is the reverse", () => {
    expect(VENUE_CATEGORY_PROFILES.stay.timekeeping).toBe("checkInOut");
    expect(VENUE_CATEGORY_PROFILES.stay.overview).toContain("stayPolicy");
    expect(VENUE_CATEGORY_PROFILES.stay.overview).not.toContain("hours");

    expect(VENUE_CATEGORY_PROFILES.restaurant.timekeeping).toBe("tradingHours");
    expect(VENUE_CATEGORY_PROFILES.restaurant.overview).toContain("hours");
    expect(VENUE_CATEGORY_PROFILES.restaurant.overview).not.toContain(
      "stayPolicy",
    );
  });

  test("timekeeping and the overview array can never disagree", () => {
    let checked = 0;
    for (const key of ALL_KEYS) {
      const profile = VENUE_CATEGORY_PROFILES[key];
      const listsHours = profile.overview.includes("hours");
      const listsPolicy = profile.overview.includes("stayPolicy");
      if (profile.timekeeping === "tradingHours") {
        expect(listsHours).toBe(true);
        expect(listsPolicy).toBe(false);
      } else {
        expect(listsPolicy).toBe(true);
        expect(listsHours).toBe(false);
      }
      checked += 1;
    }
    expect(checked).toBe(5); // vacuity guard
    // Both branches must be exercised, or the loop proves nothing.
    const models = ALL_KEYS.map((k) => VENUE_CATEGORY_PROFILES[k].timekeeping);
    expect(models).toContain("tradingHours");
    expect(models).toContain("checkInOut");
  });

  test("the trading-hours gate is what suppresses the desktop 'Open today' line", () => {
    expect(venueShowsTradingHours(VENUE_CATEGORY_PROFILES.stay)).toBe(false);
    expect(venueShowsTradingHours(VENUE_CATEGORY_PROFILES.restaurant)).toBe(
      true,
    );
    expect(venueShowsTradingHours(VENUE_CATEGORY_PROFILES.uncategorised)).toBe(
      true,
    );
  });

  test("stayClockLabel renders a stay clock and never fabricates one", () => {
    expect(stayClockLabel("15:00:00")).toBe("15:00");
    expect(stayClockLabel("11:00")).toBe("11:00");
    expect(stayClockLabel(" 09:30:00 ")).toBe("09:30");
    expect(stayClockLabel("9:05:00")).toBe("09:05");
    // Not a clock → returned as-is, never invented.
    expect(stayClockLabel("flexible")).toBe("flexible");
  });
});

describe("#1558 — the gates that used to be hardcoded booleans", () => {
  test("the Menu tab gate is ONE function over profile.tabs (unblocks #1536)", () => {
    // Was `!isStay && menuItemCount > 0`, hardcoded in two forks.
    expect(venueMenuTabVisible(VENUE_CATEGORY_PROFILES.restaurant, 3)).toBe(
      true,
    );
    expect(venueMenuTabVisible(VENUE_CATEGORY_PROFILES.restaurant, 0)).toBe(
      false,
    );
    // A Stay has no Menu tab even WITH items — and #1536 flips that by adding
    // "menu" to the stay profile's `tabs`, not by editing either page.
    expect(venueMenuTabVisible(VENUE_CATEGORY_PROFILES.stay, 12)).toBe(false);
    expect(VENUE_CATEGORY_PROFILES.stay.tabs).not.toContain("menu");
    expect(VENUE_CATEGORY_PROFILES.play.tabs).toContain("menu");
  });

  test("the typical-spend lede is gated by the PRICING MODEL, not by !isStay", () => {
    expect(typicalSpendVisible(VENUE_CATEGORY_PROFILES.restaurant, true)).toBe(
      true,
    );
    expect(typicalSpendVisible(VENUE_CATEGORY_PROFILES.restaurant, false)).toBe(
      false,
    );
    // A Stay prices nightly; even WITH a spend range on the wire it must not
    // render a restaurant's band (#1562 owns the Stay "from" rate).
    expect(typicalSpendVisible(VENUE_CATEGORY_PROFILES.stay, true)).toBe(false);
    expect(VENUE_CATEGORY_PROFILES.stay.pricing).toBe("nightlyFrom");
  });

  test("every category names a booking body — no category is actionless", () => {
    let checked = 0;
    for (const key of ALL_KEYS) {
      expect(["table", "stay"]).toContain(
        VENUE_CATEGORY_PROFILES[key].bookingBody,
      );
      checked += 1;
    }
    expect(checked).toBe(5);
    expect(VENUE_CATEGORY_PROFILES.stay.bookingBody).toBe("stay");
    expect(VENUE_CATEGORY_PROFILES.uncategorised.bookingBody).toBe("table");
  });
});

describe("#1558 — no dead section ids, no unrenderable ones", () => {
  test("every VenueSectionId is used by at least one profile", () => {
    expect(VENUE_SECTION_IDS.length).toBeGreaterThanOrEqual(6); // vacuity guard
    const used = new Set<VenueSectionId>();
    for (const key of ALL_KEYS) {
      for (const id of VENUE_CATEGORY_PROFILES[key].overview) used.add(id);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const id of VENUE_SECTION_IDS) {
      expect(Array.from(used)).toContain(id);
    }
  });

  test("every id in every profile.overview is a registered section id", () => {
    const known = new Set<string>(VENUE_SECTION_IDS);
    let checked = 0;
    for (const key of ALL_KEYS) {
      for (const id of VENUE_CATEGORY_PROFILES[key].overview) {
        expect(known.has(id)).toBe(true);
        checked += 1;
      }
    }
    // Vacuity guard: five profiles × five sections each.
    expect(checked).toBeGreaterThanOrEqual(25);
  });
});
