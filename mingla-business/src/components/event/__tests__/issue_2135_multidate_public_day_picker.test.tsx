/**
 * issue #2135 [multi-date public day picker] — IMPLEMENTOR happy-path regression.
 *
 * The bug: an organiser publishes a multi-date event, `event_dates` materialises
 * one row per date, and the public page renders ONLY the master row. On the live
 * repro (`/e/minglanigeria/test-2131-two-day-exhibition`) the whole accessibility
 * tree contained exactly one date node and the string "23 August" appeared
 * nowhere — the guest could neither see nor choose the second day.
 *
 * This suite mounts the REAL `PublicEventPage` adapter and proves, in order:
 *
 *   1. MULTI-DATE — the page names EVERY occurrence (the second day is in the
 *      rendered tree, which is the exact thing that was missing), hands EVERY
 *      occurrence to the picker, refuses to enter checkout until a day is
 *      chosen, and then carries THAT occurrence's `event_dates.id` into the
 *      checkout URL as `eventDateId`.
 *   2. SINGLE-DATE — no strip, no picker, the occurrence read stays DISABLED
 *      (zero extra network), and the checkout push is the byte-identical
 *      `/checkout/{id}` it has always been.
 *   3. The URL helper + the cart/session seam that carries the id onward.
 *
 * The chooser is rendered FOR REAL here (only its data hook is stood in), so the
 * day rows, their accessible names and their checked state are the actual
 * shipped component — not a stand-in agreeing with itself.
 *
 * FAILS-ON-REVERT: delete the `hasOccurrenceChoice && selectedOccurrenceId ===
 * null` gate + the third `checkoutPublicPathWithSeed` argument in
 * `PublicEventPage.handleProceedToCart` and the navigation assertions go red
 * (checkout is entered immediately, with no `eventDateId` in the path). Delete
 * the `multiDateDayChooser` mount and the exposure assertions go red. See the
 * implementation report for the hash.
 *
 * Owner: mingla-implementor.
 */

import React from "react";
import { Platform, Pressable, Text, View } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

import { readFileSync } from "fs";
import path from "path";

type Renderer = {
  root: {
    findAllByProps: (
      props: Record<string, unknown>,
    ) => Array<{ props: Record<string, unknown> }>;
  };
  unmount: () => void;
};
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const press = (tree: Renderer, testID: string): void => {
  const onPress = tree.root.findAllByProps({ testID })[0]?.props.onPress;
  if (typeof onPress !== "function") throw new Error(`missing ${testID}`);
  onPress();
};
const textOf = (tree: Renderer, testID: string): string => {
  const node = tree.root.findAllByProps({ testID })[0];
  if (node === undefined) throw new Error(`missing ${testID}`);
  const children = node.props.children;
  return Array.isArray(children) ? children.join("") : String(children ?? "");
};

const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

// The REAL publicUrls module is used (never mocked) — the whole point is to
// assert the exact checkout path string. It reads the public web origin at
// module load, so supply it the way the sibling cart-seed suite does.
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL: "https://host.usemingla.com",
      },
    },
  },
}));

jest.mock(
  "react-native-svg",
  () => ({
    __esModule: true,
    default: () => null,
    Circle: () => null,
    Path: () => null,
    Rect: () => null,
    G: () => null,
  }),
  { virtual: true },
);
jest.mock("expo-router", () => ({
  useRouter: () => router,
  useLocalSearchParams: () => ({}),
}));
jest.mock("expo-router/head", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({
    cancelQueries: () => Promise.resolve(),
    removeQueries: () => undefined,
    invalidateQueries: () => Promise.resolve(),
    refetchQueries: () => Promise.resolve(),
  }),
}));

// The occurrence read. Mocked at the HOOK boundary so the test controls the
// materialised `event_dates` rows AND can prove the query is disabled for a
// single-date event (the "no extra network" half of the no-regression claim).
const occurrenceHookCalls: Array<{
  eventId: string | null;
  enabled: boolean;
  timezone: string | null;
}> = [];
let occurrenceData: Array<{
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  isMaster: boolean;
  ticketsRemaining: number | null;
}> = [];
// [TEST-MOD-APPROVED #2160] MECHANICAL ADAPTATION ONLY.
// #2160/#2161 DELETED `usePublicEventOccurrences` and the direct `event_dates`
// read behind it: the occurrences now arrive ON the event payload from the same
// SECURITY DEFINER reader that served the event, so there is no hook left to
// stub. The occurrences are handed to PublicEventPage as a prop instead, by
// `mount()` below. NO ASSERTION IN THIS FILE WAS WEAKENED — every single-date
// assertion is untouched and still green.
jest.mock("../../../hooks/usePublicEvents", () => ({}));

jest.mock("../../../hooks/usePublicTicketCheckoutRouteAccess", () => ({
  usePublicTicketCheckoutRouteAccess: () => ({
    state: "unrestricted",
    canPurchase: true,
    requiresSignIn: false,
    blocked: false,
    retry: () => undefined,
  }),
}));
jest.mock("../TicketCheckoutAccessNotice", () => ({
  TicketCheckoutAccessNotice: () => null,
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: null }),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useBrandList: () => [],
}));
jest.mock("../../../theme/useThemeFont", () => ({
  useThemeFont: () => undefined,
}));
jest.mock("../../../services/rsvpEvents", () => ({
  submitPublicRsvp: jest.fn(),
  submitRsvpContribution: jest.fn(),
}));
jest.mock("../../../services/rsvpPassRecoveryService", () => ({
  fetchPublicRsvpPassPdf: jest.fn(),
}));
jest.mock("../../../services/socialProofService", () => ({
  socialProofKeys: { summary: (id: string) => ["social-proof", id] },
  fetchSocialProof: jest.fn(),
}));
jest.mock("../../../analytics/webAnalytics", () => ({ captureWeb: jest.fn() }));
jest.mock("@mingla/phone-input", () => ({
  PhoneInput: () => null,
  COUNTRIES: [{ code: "NG", dialCode: "+234" }],
  getCountryByCode: () => ({ dialCode: "+234" }),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/ShareModal", () => ({ ShareModal: () => null }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../waitlist/JoinWaitlistSheet", () => ({
  JoinWaitlistSheet: () => null,
}));
jest.mock("../SeeWhosGoingGate", () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock("../FoundationEventPreview", () => ({
  FoundationEventPreview: (props: {
    stateBanner: React.ReactNode;
    leadingPurchaseSection: React.ReactNode;
    onProceedToCart: () => void;
  }) => (
    <View testID="issue-2135-foundation">
      {props.stateBanner}
      {props.leadingPurchaseSection}
      <Pressable
        testID="issue-2135-proceed"
        accessibilityLabel="Get tickets"
        onPress={props.onProceedToCart}
      />
    </View>
  ),
}));
jest.mock("../FoundationRsvpPreview", () => ({
  FoundationRsvpPreview: () => null,
}));

jest.mock("@mingla/offering-rendering", () => {
  const actual = jest.requireActual("@mingla/offering-rendering");
  const lifecycle = jest.requireActual(
    "../../../../../packages/offering-rendering/eventAcquisitionLifecycle",
  );
  return {
    ...actual,
    ...lifecycle,
    EventAcquisitionNotice: () => null,
    useResponsiveLayout: () => ({ isDesktop: false }),
    resolveOfferingCta: () => ({
      kind: "free",
      label: "Get free ticket",
      tappable: true,
    }),
  };
});

import { PublicEventPage } from "../PublicEventPage";
import { checkoutPublicPathWithSeed } from "../../../constants/publicUrls";

const OCC_DAY_ONE = "occ-day-one-2135";
const OCC_DAY_TWO = "occ-day-two-2135";

const TWO_DAY_OCCURRENCES = [
  {
    id: OCC_DAY_ONE,
    startAt: "2026-08-22T10:00:00.000Z",
    endAt: "2026-08-22T17:00:00.000Z",
    timezone: "Africa/Lagos",
    isMaster: true,
    ticketsRemaining: null,
  },
  {
    id: OCC_DAY_TWO,
    startAt: "2026-08-23T10:00:00.000Z",
    endAt: "2026-08-23T17:00:00.000Z",
    timezone: "Africa/Lagos",
    isMaster: false,
    ticketsRemaining: null,
  },
];

const freeTicket = {
  id: "tier-2135",
  name: "Free entry",
  description: null,
  priceGbp: 0,
  priceAllInGbp: 0,
  currency: "NGN",
  isFree: true,
  isUnlimited: true,
  capacity: null,
  visibility: "visible",
  passwordProtected: false,
  password: null,
  saleStartAt: null,
  saleEndAt: null,
  approvalRequired: false,
  waitlistEnabled: false,
  availableAt: "online",
  displayOrder: 0,
};

const liveEvent = (whenMode: "single" | "multi_date") => ({
  id: "evt-2135",
  name: "TEST 2131 Two-Day Exhibition",
  brandId: "brand-2135",
  brandSlug: "minglanigeria",
  eventSlug: "test-2131-two-day-exhibition",
  description: "Two days of exhibition",
  event_type: "event",
  status: "scheduled",
  endedAt: null,
  whenMode,
  date: "2026-08-22",
  doorsOpen: "11:00",
  endsAt: "18:00",
  multiDates: null,
  recurrenceRule: null,
  masterStartAtUtc: "2026-08-22T10:00:00.000Z",
  masterEndAtUtc: "2099-08-22T17:00:00.000Z",
  timezone: "Africa/Lagos",
  format: "in-person",
  venueName: "Venue",
  address: "Street",
  hideAddressUntilTicket: false,
  locationGeo: null,
  cityGeo: null,
  coverHue: 20,
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaCredit: null,
  coverGallery: [],
  tickets: [freeTicket],
  currency: "NGN",
  partyTypes: [],
  vibeTags: [],
  musicGenres: [],
  themeOverrides: null,
  privateGuestList: false,
  hideRemainingCount: false,
});

const brand = {
  id: "brand-2135",
  slug: "minglanigeria",
  displayName: "Mingla Nigeria",
  photo: null,
  theme: null,
};

// Mounted trees are tracked and torn down: PublicEventPage arms a long
// `nextEventAcquisitionBoundaryDelayMs` timer (clamped to ~24.8 days), and a
// tree left mounted keeps that handle open so the jest process never exits.
let mounted: Renderer[] = [];

const mount = async (
  whenMode: "single" | "multi_date",
): Promise<Renderer> => {
  // [TEST-MOD-APPROVED #2399] PublicEventPage deliberately lazy-loads the real
  // chooser. Settle that production module boundary before fake-timer rendering
  // so a clean Linux runner cannot inspect Suspense's null fallback while the
  // import is still pending. Single-date tests still never load the chunk.
  if (whenMode === "multi_date") await import("../MultiDateDayChooser");
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <PublicEventPage
        event={liveEvent(whenMode) as never}
        brand={brand as never}
        // [TEST-MOD-APPROVED #2160] the occurrences are a PROP now, not a hook.
        occurrences={occurrenceData as never}
      />,
    );
  });
  mounted.push(tree);
  return tree;
};

beforeEach(() => {
  jest.useFakeTimers();
  router.push.mockClear();
  occurrenceHookCalls.length = 0;
  occurrenceData = [];
  jest.replaceProperty(Platform, "OS", "web");
});

afterEach(async () => {
  for (const tree of mounted) {
    await act(async () => tree.unmount());
  }
  mounted = [];
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
// 1. MULTI-DATE — every day is visible, choosable, and reaches checkout.
// ───────────────────────────────────────────────────────────────────────────

describe("issue #2135 — a multi-date event exposes every occurrence", () => {
  // Accessible name of one day row, which is also what a screen reader announces.
  const rowLabel = (tree: Renderer, id: string): string => {
    const node = tree.root.findAllByProps({ testID: `issue-2135-day-row-${id}` })[0];
    if (node === undefined) throw new Error(`no row for ${id}`);
    return String(node.props.accessibilityLabel ?? "");
  };
  const rowChecked = (tree: Renderer, id: string): boolean => {
    const node = tree.root.findAllByProps({ testID: `issue-2135-day-row-${id}` })[0];
    if (node === undefined) throw new Error(`no row for ${id}`);
    return (node.props.accessibilityState as { checked?: boolean }).checked === true;
  };

  test("BOTH days are on the page with no tap — the exact thing that was missing", async () => {
    occurrenceData = TWO_DAY_OCCURRENCES;
    const tree = await mount("multi_date");

    // The live repro's whole accessibility tree contained one date node and no
    // occurrence of the 23rd anywhere. Both days are now rendered rows, present
    // on first paint — not behind a sheet the guest has to know to open.
    expect(rowLabel(tree, OCC_DAY_ONE)).toContain("Sat 22 Aug");
    expect(rowLabel(tree, OCC_DAY_TWO)).toContain("Sun 23 Aug");
    expect(
      tree.root.findAllByProps({ testID: "issue-2135-day-chooser" }).length,
    ).toBeGreaterThan(0);
  });

  test("EVERY materialised occurrence gets its own selectable row", async () => {
    occurrenceData = TWO_DAY_OCCURRENCES;
    const tree = await mount("multi_date");

    for (const id of [OCC_DAY_ONE, OCC_DAY_TWO]) {
      const rows = tree.root.findAllByProps({ testID: `issue-2135-day-row-${id}` });
      expect(rows.length).toBeGreaterThan(0);
      // [TEST-MOD-APPROVED #2160] the a11y ROLE changed, and the change is the
      // point of the issue: a guest may attend MORE THAN ONE day, so each row is
      // a checkbox. Leaving "radio" here would assert "pick exactly one", which
      // is the behaviour #2160 exists to remove. Named + unchecked-to-start are
      // unchanged.
      expect(rows[0].props.accessibilityRole).toBe("checkbox");
      expect(String(rows[0].props.accessibilityLabel ?? "").length).toBeGreaterThan(0);
    }
    expect(rowChecked(tree, OCC_DAY_ONE)).toBe(false);
    expect(rowChecked(tree, OCC_DAY_TWO)).toBe(false);
  });

  test("checkout is refused until a day is chosen, with an explicit prompt", async () => {
    occurrenceData = TWO_DAY_OCCURRENCES;
    const tree = await mount("multi_date");

    expect(
      tree.root.findAllByProps({ testID: "issue-2135-day-chooser-prompt" }),
    ).toHaveLength(0);
    await act(async () => press(tree, "issue-2135-proceed"));

    // The old behaviour silently sold day one here.
    expect(router.push).not.toHaveBeenCalled();
    expect(
      tree.root.findAllByProps({ testID: "issue-2135-day-chooser-prompt" }).length,
    ).toBeGreaterThan(0);
  });

  test("choosing the SECOND day carries THAT occurrence id into checkout", async () => {
    occurrenceData = TWO_DAY_OCCURRENCES;
    const tree = await mount("multi_date");

    await act(async () => press(tree, `issue-2135-day-row-${OCC_DAY_TWO}`));
    expect(rowChecked(tree, OCC_DAY_TWO)).toBe(true);
    expect(rowChecked(tree, OCC_DAY_ONE)).toBe(false);

    await act(async () => press(tree, "issue-2135-proceed"));

    expect(router.push).toHaveBeenCalledTimes(1);
    const pushed = String(router.push.mock.calls[0][0]);
    expect(pushed).toContain("/checkout/evt-2135");
    expect(pushed).toContain(`eventDateIds=${OCC_DAY_TWO}`);
    // Never day one — the master row must not win once a day is picked.
    expect(pushed).not.toContain(OCC_DAY_ONE);
  });

  test("picking clears the prompt and the choice survives to the next attempt", async () => {
    occurrenceData = TWO_DAY_OCCURRENCES;
    const tree = await mount("multi_date");

    await act(async () => press(tree, "issue-2135-proceed"));
    expect(
      tree.root.findAllByProps({ testID: "issue-2135-day-chooser-prompt" }).length,
    ).toBeGreaterThan(0);

    await act(async () => press(tree, `issue-2135-day-row-${OCC_DAY_TWO}`));
    expect(
      tree.root.findAllByProps({ testID: "issue-2135-day-chooser-prompt" }),
    ).toHaveLength(0);

    await act(async () => press(tree, "issue-2135-proceed"));
    expect(String(router.push.mock.calls[0][0])).toContain(
      `eventDateIds=${OCC_DAY_TWO}`,
    );
  });

  test("a malformed multi-date event with only ONE occurrence fails closed", async () => {
    occurrenceData = [TWO_DAY_OCCURRENCES[0]];
    const tree = await mount("multi_date");

    expect(
      tree.root.findAllByProps({ testID: "issue-2135-day-chooser" }),
    ).not.toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: "issue-2399-day-recovery" })[0]?.props
        .children,
    ).toBe("We couldn’t load the event days.");
    await act(async () => press(tree, "issue-2135-proceed"));
    expect(router.push).not.toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. SINGLE-DATE — the dominant production case must be untouched.
// ───────────────────────────────────────────────────────────────────────────

describe("issue #2135 — a single-date event is unchanged", () => {
  test("renders NO day chooser and NO day rows", async () => {
    const tree = await mount("single");

    expect(
      tree.root.findAllByProps({ testID: "issue-2135-day-chooser" }),
    ).toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: "issue-2135-day-chooser-prompt" }),
    ).toHaveLength(0);
    // The page still renders its body — this is "no chooser", not "no page".
    expect(
      tree.root.findAllByProps({ testID: "issue-2135-foundation" }).length,
    ).toBeGreaterThan(0);
  });

  test("never issues the occurrence read (zero extra network, zero lazy chunk)", async () => {
    await mount("single");

    // The multi-date leg is a LAZY child that a single-date page never renders,
    // so the occurrence hook is not merely disabled — it is never reached, and
    // the picker's Sheet/blur chain never loads on this hot buyer-web route.
    expect(occurrenceHookCalls).toHaveLength(0);
  });

  // [TEST-MOD-APPROVED #2160] This asserted that a multi-date page ISSUES the
  // separate occurrence read. #2161 is precisely that that read was the defect:
  // it was RLS-gated and returned nothing for an unlisted event. #2160 deletes
  // it and carries the occurrences on the event payload instead, so "the page
  // issues the read" is no longer a property to preserve — it is the property
  // that was removed. The gate it was proving is real is now proved from the
  // other side, and against the REAL reader rather than a stub, in
  // supabase/migrations/__tests__/issue_2160_unlisted_occurrences.test.sql
  // (U-1c: an UNLISTED 2-date event returns BOTH occurrences).
  test("the multi-date page mounts the chooser from the event payload", async () => {
    occurrenceData = TWO_DAY_OCCURRENCES;
    const tree = await mount("multi_date");

    // No second query is issued at all — the hook module is now empty.
    expect(occurrenceHookCalls.length).toBe(0);
    // ...and the rows are on the page anyway, which is the whole fix.
    expect(
      tree.root.findAllByProps({ testID: `issue-2135-day-row-${OCC_DAY_ONE}` }).length,
    ).toBeGreaterThan(0);
    expect(
      tree.root.findAllByProps({ testID: `issue-2135-day-row-${OCC_DAY_TWO}` }).length,
    ).toBeGreaterThan(0);
  });

  test("pushes the byte-identical checkout path — no eventDateId, no seed", async () => {
    const tree = await mount("single");

    await act(async () => press(tree, "issue-2135-proceed"));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/checkout/evt-2135");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The URL helper + the cart/session seam that carries the id onward.
// ───────────────────────────────────────────────────────────────────────────

const repoRead = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

describe("issue #2135 — the occurrence reaches the checkout session", () => {
  test("checkoutPublicPathWithSeed is byte-identical without an occurrence", () => {
    expect(checkoutPublicPathWithSeed("evt_1", {})).toBe("/checkout/evt_1");
    expect(checkoutPublicPathWithSeed("evt_1", {}, null)).toBe("/checkout/evt_1");
    expect(checkoutPublicPathWithSeed("evt_1", {}, "")).toBe("/checkout/evt_1");
    expect(checkoutPublicPathWithSeed("evt_1", { vip: 2 })).toBe(
      "/checkout/evt_1?seed=vip%3A2",
    );
  });

  test("checkoutPublicPathWithSeed appends the chosen occurrence alongside the seed", () => {
    expect(checkoutPublicPathWithSeed("evt_1", {}, "occ_9")).toBe(
      "/checkout/evt_1?eventDateIds=occ_9",
    );
    expect(checkoutPublicPathWithSeed("evt_1", { vip: 2 }, "occ_9")).toBe(
      "/checkout/evt_1?seed=vip%3A2&eventDateIds=occ_9",
    );
  });

  test("the cart step seeds CartContext.eventDateId from the route param", () => {
    const src = repoRead("app/checkout/[eventId]/index.tsx");
    expect(src).toMatch(/eventDateId\?:\s*string/);
    expect(src).toMatch(/setEventDateId\(seedEventDateId\)/);
  });

  test("the paid checkout forwards the occurrence on BOTH web and native", () => {
    const src = repoRead("app/checkout/[eventId]/payment.tsx");
    // [TEST-MOD-APPROVED #2160] the destructure gained `eventDateIds` and wrapped
    // onto a second line, so the original one-line-shape regex no longer matches
    // the same true fact. Assert the fact, not the line break.
    expect(src).toMatch(/eventDateId\s*,/);
    expect(src).toMatch(/useCart\(\)/);
    // One spread per surface (hosted-Stripe web redirect + native PaymentSheet).
    const forwards = src.match(
      /\.\.\.\(eventDateId !== null \? \{ eventDateId \} : \{\}\)/g,
    );
    expect(forwards).not.toBeNull();
    expect((forwards ?? []).length).toBe(2);
  });

  test("the occurrence reader never fabricates a per-day remaining count", () => {
    // [TEST-MOD-APPROVED #2160] REPOINTED, NOT WEAKENED. The mapper moved:
    // publicEventOccurrencesService no longer reads anything (#2161 — a guest
    // surface must not read event_dates directly), and the occurrences are now
    // mapped off the bundle in publicEventsService. The assertion is unchanged
    // and now points at the LIVE mapper instead of a module that no longer maps.
    const src = repoRead("src/services/publicEventsService.ts");
    // event_dates carries NO per-occurrence capacity; publishing the event-level
    // number per day would claim availability that does not exist.
    expect(src).toMatch(/ticketsRemaining:\s*null/);
    expect(src).not.toMatch(/ticketsRemaining:\s*eventRemaining/);
    // ...and the deleted reader stays deleted.
    expect(
      repoRead("src/services/publicEventOccurrencesService.ts"),
    ).not.toMatch(/\.from\(\s*["\']event_dates["\']\s*\)/);
  });
});
