/**
 * issue #2209 — THE PUBLIC PAGE MUST NAME THE DAYS, NOT SAY THERE ARE NONE.
 *
 * ══ WHAT A GUEST SAW ═══════════════════════════════════════════════════════
 * A signed-out guest opening a shared two-day event
 * (host.usemingla.com/e/minglanigeria/we-go-again-two-day-demo, measured
 * 2026-08-18) read:
 *
 *     Date TBD
 *     Multi-date (no dates yet)
 *
 * on an event with two confirmed `event_dates` rows. The eyebrow is built by
 * `formatDraftDateLine` / `formatDraftDateSubline`, which read `multiDates` —
 * the ORGANISER'S DRAFT, stripped out of every public projection. A published
 * event's days live in `event_dates` and arrive as OCCURRENCES. Nothing had
 * ever taught the display layer that a live event has a second source, so it
 * truthfully reported the one it was given: nothing.
 *
 * ══ WHAT IS PROVED (mounting the REAL PublicEventPage adapter) ═════════════
 *   D-1  a two-day event's eyebrow names the FIRST day and both days appear
 *   D-2  the sub-line counts the real days instead of "Multi-date (no dates
 *        yet)"
 *   D-3  the REAL MultiDateDayChooser renders a row per day (the chooser and
 *        the eyebrow read the same label owner, so they cannot disagree)
 *   D-4  HONEST DEGRADE: a multi-date event with ZERO materialised days still
 *        says "Date TBD" / "Multi-date (no dates yet)" and mounts no picker —
 *        a schedule is never invented
 *   D-5  a SINGLE-DATE event's eyebrow is byte-identical to what the draft
 *        formatters produce, so no existing page shifts
 *   D-6  an occurrence list handed over out of order still renders
 *        chronologically — the guest's reading order does not depend on the
 *        transport
 *   D-7  a SIGNED-OUT guest can pick day(s) and that pick reaches CHECKOUT as
 *        `eventDateIds` — while the chooser was dark this whole #2160 path was
 *        unreachable, which is why the page defect is P0 and not cosmetic
 *   D-8  ...and a guest who picks NOTHING is blocked with an explicit prompt
 *        rather than silently sold day one
 *
 * FAILS-ON-REVERT: restore `dateLine: formatDraftDateLine(event)` (and the two
 * siblings) in `mapLiveEventToPublicEvent` and D-1/D-2/D-6 go red while D-4 and
 * D-5 stay green — which is the shape of the claim.
 */

import React from "react";
import { Platform, Pressable, Text, View } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};

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

// The shared body is stood in ONLY to surface the three date fields the real
// EventOfferingBody renders (`orch-1167-date-line` + its sub-line). The values
// asserted below are produced by the REAL `mapLiveEventToPublicEvent`, which is
// the code #2209 changes; the stand-in adds no logic of its own.
jest.mock("../FoundationEventPreview", () => ({
  FoundationEventPreview: (props: {
    event: {
      dateLine: string;
      dateSubline: string | null;
      datesList: string[];
    };
    stateBanner: React.ReactNode;
    onProceedToCart: () => void;
  }) => (
    <View testID="issue-2209-foundation">
      <Text testID="issue-2209-date-line">{props.event.dateLine}</Text>
      <Text testID="issue-2209-date-subline">
        {props.event.dateSubline ?? "<null>"}
      </Text>
      <Text testID="issue-2209-dates-list">
        {props.event.datesList.join(" | ")}
      </Text>
      {props.stateBanner}
      <Pressable
        testID="issue-2209-proceed"
        accessibilityLabel="Proceed to cart"
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
import {
  formatDraftDateLine,
  formatDraftDateSubline,
} from "../../../utils/eventDateDisplay";

const OCC_DAY_ONE = "occ-2209-day-one";
const OCC_DAY_TWO = "occ-2209-day-two";

const DAY_ONE = {
  id: OCC_DAY_ONE,
  startAt: "2026-08-22T10:00:00.000Z",
  endAt: "2026-08-22T17:00:00.000Z",
  timezone: "Africa/Lagos",
  isMaster: true,
  ticketsRemaining: null,
};
const DAY_TWO = {
  id: OCC_DAY_TWO,
  startAt: "2026-08-23T10:00:00.000Z",
  endAt: "2026-08-23T17:00:00.000Z",
  timezone: "Africa/Lagos",
  isMaster: false,
  ticketsRemaining: null,
};

const freeTicket = {
  id: "tier-2209",
  name: "General Admission",
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

// Shaped exactly like the LiveEvent `detailFromDirectBundle` builds for a
// PUBLISHED event: `multiDates` is NULL because the public projection strips the
// organiser's authoring block. That null is the whole reason the eyebrow read
// "Date TBD".
const liveEvent = (whenMode: "single" | "multi_date") => ({
  id: "evt-2209",
  name: "We Go Again — Two Day Demo",
  brandId: "brand-2209",
  brandSlug: "minglanigeria",
  eventSlug: "we-go-again-two-day-demo",
  description: "Demo two-day exhibition",
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
  venueName: "Art Roost Gallery",
  address: "Street",
  hideAddressUntilTicket: true,
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
  id: "brand-2209",
  slug: "minglanigeria",
  displayName: "Mingla Nigeria",
  photo: null,
  theme: null,
};

let mounted: Renderer[] = [];

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

const mount = async (
  whenMode: "single" | "multi_date",
  occurrences: unknown[],
): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(
      <PublicEventPage
        event={liveEvent(whenMode) as never}
        brand={brand as never}
        occurrences={occurrences as never}
      />,
    );
  });
  mounted.push(tree);
  return tree;
};

beforeEach(() => {
  jest.useFakeTimers();
  router.push.mockClear();
  jest.replaceProperty(Platform, "OS", "web");
});

afterEach(async () => {
  for (const tree of mounted) await act(async () => tree.unmount());
  mounted = [];
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("issue #2209 — a shared multi-day event names its days", () => {
  test("D-1 the eyebrow names the first REAL day instead of 'Date TBD'", async () => {
    const tree = await mount("multi_date", [DAY_ONE, DAY_TWO]);
    const line = textOf(tree, "issue-2209-date-line");
    expect(line).not.toBe("Date TBD");
    // 10:00Z on 22 Aug is 11:00 in Africa/Lagos — the day is rendered in the
    // occurrence's OWN zone, never the viewer's.
    expect(line).toContain("Sat 22 Aug");
  });

  test("D-2 the sub-line COUNTS the real days", async () => {
    const tree = await mount("multi_date", [DAY_ONE, DAY_TWO]);
    expect(textOf(tree, "issue-2209-date-subline")).toBe(
      "2 dates · first Sat 22 Aug",
    );
    const list = textOf(tree, "issue-2209-dates-list");
    expect(list).toContain("Sat 22 Aug");
    expect(list).toContain("Sun 23 Aug");
  });

  test("D-3 the REAL day chooser renders a row per day", async () => {
    const tree = await mount("multi_date", [DAY_ONE, DAY_TWO]);
    expect(
      tree.root.findAllByProps({ testID: "issue-2135-day-chooser" }).length,
    ).toBeGreaterThan(0);
    for (const id of [OCC_DAY_ONE, OCC_DAY_TWO]) {
      const rows = tree.root.findAllByProps({
        testID: `issue-2135-day-row-${id}`,
      });
      expect(rows.length).toBeGreaterThan(0);
    }
    // The chooser row and the eyebrow read the SAME label owner
    // (formatOccurrenceLine), so the first row's accessible name and the
    // eyebrow's date line are the same string. Two copies of this label were
    // exactly how the page came to disagree with itself.
    const firstRow = tree.root.findAllByProps({
      testID: `issue-2135-day-row-${OCC_DAY_ONE}`,
    })[0];
    expect(String(firstRow.props.accessibilityLabel)).toBe(
      textOf(tree, "issue-2209-date-line"),
    );
  });

  test("D-4 zero materialised days still degrades HONESTLY", async () => {
    const tree = await mount("multi_date", []);
    expect(textOf(tree, "issue-2209-date-line")).toBe("Date TBD");
    expect(textOf(tree, "issue-2209-date-subline")).toBe(
      "Multi-date (no dates yet)",
    );
    expect(textOf(tree, "issue-2209-dates-list")).toBe("");
    // No dead affordance: nothing to choose between.
    expect(
      tree.root.findAllByProps({ testID: "issue-2135-day-chooser" }).length,
    ).toBe(0);
  });

  test("D-5 a SINGLE-DATE event's eyebrow is unchanged", async () => {
    const event = liveEvent("single");
    const tree = await mount("single", [DAY_ONE]);
    // Byte-equality against the draft formatters this replaced, computed here
    // from the same fixture — the pre-#2209 output, measured, not asserted.
    expect(textOf(tree, "issue-2209-date-line")).toBe(
      formatDraftDateLine(event as never),
    );
    expect(textOf(tree, "issue-2209-date-subline")).toBe(
      formatDraftDateSubline(event as never) ?? "<null>",
    );
    expect(
      tree.root.findAllByProps({ testID: "issue-2135-day-chooser" }).length,
    ).toBe(0);
  });

  test("D-6 days render chronologically however they arrive", async () => {
    const tree = await mount("multi_date", [DAY_TWO, DAY_ONE]);
    expect(textOf(tree, "issue-2209-date-line")).toContain("Sat 22 Aug");
    const list = textOf(tree, "issue-2209-dates-list").split(" | ");
    expect(list[0]).toContain("Sat 22 Aug");
    expect(list[1]).toContain("Sun 23 Aug");
  });

  // ── THE ACCEPTANCE CRITERION THE DARK CHOOSER MADE UNREACHABLE ───────────
  // `checkoutPublicPathWithSeed` is the REAL module here (never mocked), so the
  // string asserted is the exact URL the router is pushed to, and the checkout
  // route reads `eventDateIds` off it. With the chooser dark, no guest could
  // ever produce this URL — #2160's entire guest-facing day path terminated at
  // an unrendered component.
  test("D-7 a signed-out guest's chosen days reach checkout", async () => {
    const tree = await mount("multi_date", [DAY_ONE, DAY_TWO]);
    await act(async () => press(tree, `issue-2135-day-row-${OCC_DAY_ONE}`));
    await act(async () => press(tree, `issue-2135-day-row-${OCC_DAY_TWO}`));
    await act(async () => press(tree, "issue-2209-proceed"));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(String(router.push.mock.calls[0][0])).toBe(
      `/checkout/evt-2209?eventDateIds=${encodeURIComponent(
        `${OCC_DAY_ONE},${OCC_DAY_TWO}`,
      )}`,
    );
  });

  test("D-8 choosing nothing blocks checkout with an explicit prompt", async () => {
    const tree = await mount("multi_date", [DAY_ONE, DAY_TWO]);
    await act(async () => press(tree, "issue-2209-proceed"));
    expect(router.push).not.toHaveBeenCalled();
    expect(
      tree.root.findAllByProps({ testID: "issue-2135-day-chooser-prompt" })
        .length,
    ).toBeGreaterThan(0);
  });
});
