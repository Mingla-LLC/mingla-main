/**
 * issue #3281 (bundle 3 review) — the REAL public event page with a date the
 * host cancelled.
 *
 *   (a) The day the page leads the guest to (the web reveal's first row) is the
 *       first date still on offer, never a cancelled one.
 *   (b) A chosen date that is then cancelled leaves the guest's day set, so it
 *       never rides to checkout (the page fences the stale choice instead).
 *   (c) A two-date event with one cancelled date still requires the remaining
 *       date to be chosen and carries ITS id to checkout (multi-date checkout
 *       always requires a day: `issue_3313_event_day_choice` requiresChoice).
 *   (d) Every date still to come cancelled: tickets read "Sold out", no day
 *       chooser, and no entry point reaches checkout.
 *
 * Harness copied from issue_2135_multidate_public_day_picker.test.tsx, except
 * the CTA machine (resolveOfferingCta) is the real one.
 */

import React from "react";
import { Platform, Pressable, View } from "react-native";

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

const press = (tree: Renderer, testID: string): void => {
  const onPress = tree.root.findAllByProps({ testID })[0]?.props.onPress;
  if (typeof onPress !== "function") throw new Error(`missing ${testID}`);
  onPress();
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

// Shared Follow double — PublicEventPage mounts
// useBrandFollow; without this the suite loads brandFollowsService → supabase.
jest.mock(
  "../../../hooks/useBrandFollow",
  () => require("./harness/useBrandFollow.publicEventPage.mock"),
);


// The occurrences are a prop of the page (#2160), so the hook module is empty.
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
// The Toast is captured so a test can fire its onPresented (the web reveal).
const toastProps: { current: { visible?: boolean; onPresented?: () => void } } = {
  current: {},
};
jest.mock("../../ui/Toast", () => ({
  Toast: (props: { visible?: boolean; onPresented?: () => void }) => {
    toastProps.current = props;
    return null;
  },
}));
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
  };
});

import { PublicEventPage } from "../PublicEventPage";

type Occ = {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  isMaster: boolean;
  ticketsRemaining: number | null;
  cancelled?: boolean;
};
const DAY_A = "occ-a-3281";
const DAY_B = "occ-b-3281";
const DAY_C = "occ-c-3281";
const occ = (id: string, day: number, cancelled = false): Occ => ({
  id,
  startAt: `2030-08-${day}T10:00:00.000Z`,
  endAt: `2030-08-${day}T17:00:00.000Z`,
  timezone: "Africa/Lagos",
  isMaster: day === 21,
  ticketsRemaining: null,
  ...(cancelled ? { cancelled: true } : {}),
});

const freeTicket = {
  id: "tier-3281",
  name: "Free entry",
  description: null,
  priceGbp: 0,
  priceAllInGbp: 0,
  currency: "NGN",
  isFree: true,
  isUnlimited: true,
  capacity: null,
  visibility: "public",
  passwordProtected: false,
  password: null,
  saleStartAt: null,
  saleEndAt: null,
  approvalRequired: false,
  waitlistEnabled: true,
  availableAt: "online",
  displayOrder: 0,
};

const liveEvent = () => ({
  id: "evt-3281",
  name: "Three day festival",
  brandId: "brand-3281",
  brandSlug: "mingla",
  eventSlug: "three-days",
  description: "Three days",
  event_type: "event",
  status: "scheduled",
  endedAt: null,
  whenMode: "multi_date",
  date: "2030-08-21",
  doorsOpen: "11:00",
  endsAt: "18:00",
  multiDates: null,
  recurrenceRule: null,
  masterStartAtUtc: "2030-08-21T10:00:00.000Z",
  masterEndAtUtc: "2099-08-23T17:00:00.000Z",
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
  id: "brand-3281",
  slug: "mingla",
  displayName: "Mingla",
  photo: null,
  theme: null,
};

let mounted: Renderer[] = [];
const element = (occurrences: Occ[]) => (
  <PublicEventPage
    event={liveEvent() as never}
    brand={brand as never}
    occurrences={occurrences as never}
  />
);
const mount = async (occurrences: Occ[]): Promise<Renderer> => {
  await import("../MultiDateDayChooser");
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(element(occurrences));
  });
  mounted.push(tree);
  return tree;
};
const rerender = async (tree: Renderer, occurrences: Occ[]): Promise<void> => {
  await act(async () => {
    (tree as unknown as { update: (n: React.ReactElement) => void }).update(
      element(occurrences),
    );
  });
};
const has = (tree: Renderer, testID: string): boolean =>
  tree.root.findAllByProps({ testID }).length > 0;
const bannerText = (tree: Renderer): string =>
  JSON.stringify(
    (tree as unknown as { toJSON: () => unknown }).toJSON(),
  );

beforeEach(() => {
  jest.useFakeTimers();
  router.push.mockClear();
  toastProps.current = {};
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
  delete (globalThis as { document?: unknown }).document;
});

describe("issue #3281 — the public page with a cancelled date", () => {
  test("(a) the reveal leads to the first date still on offer, never a cancelled first date", async () => {
    const tree = await mount([occ(DAY_A, 21, true), occ(DAY_B, 22), occ(DAY_C, 23)]);
    // Installed after mount so the page's own effects run as in the other suites.
    const target = { scrollIntoView: jest.fn(), focus: jest.fn() };
    const getElementById = jest.fn(() => target);
    (globalThis as { document?: unknown }).document = {
      getElementById,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      visibilityState: "visible",
    };
    await act(async () => press(tree, "issue-2135-proceed"));
    expect(router.push).not.toHaveBeenCalled();
    expect(toastProps.current.visible).toBe(true);
    await act(async () => toastProps.current.onPresented?.());
    expect(getElementById).toHaveBeenCalledWith(`issue-2160-day-row-${DAY_B}`);
    expect(getElementById).not.toHaveBeenCalledWith(`issue-2160-day-row-${DAY_A}`);
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  test("(b) a chosen date that is then cancelled leaves the day set and never reaches checkout", async () => {
    const tree = await mount([occ(DAY_A, 21), occ(DAY_B, 22), occ(DAY_C, 23)]);
    await act(async () => press(tree, `issue-2135-day-row-${DAY_A}`));
    await act(async () => press(tree, `issue-2135-day-row-${DAY_B}`));
    // The host cancels B while the guest is on the page.
    await rerender(tree, [occ(DAY_A, 21), occ(DAY_B, 22, true), occ(DAY_C, 23)]);
    await act(async () => press(tree, "issue-2135-proceed"));
    const pushed = router.push.mock.calls.map((call) => String(call[0]));
    expect(pushed.some((url) => url.includes(DAY_B))).toBe(false);
    // The stale choice is fenced: the guest is told the dates changed.
    expect(router.push).not.toHaveBeenCalled();
  });

  test("(c) two dates, one cancelled: the other must be chosen and its id reaches checkout", async () => {
    const tree = await mount([occ(DAY_A, 21, true), occ(DAY_B, 22)]);
    expect(has(tree, "issue-2135-day-chooser")).toBe(true);
    await act(async () => press(tree, "issue-2135-proceed"));
    expect(router.push).not.toHaveBeenCalled();
    // The cancelled row is inert.
    await act(async () => press(tree, `issue-2135-day-row-${DAY_A}`));
    await act(async () => press(tree, "issue-2135-proceed"));
    expect(router.push).not.toHaveBeenCalled();
    await act(async () => press(tree, `issue-2135-day-row-${DAY_B}`));
    await act(async () => press(tree, "issue-2135-proceed"));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(String(router.push.mock.calls[0][0])).toBe(
      `/checkout/evt-3281?eventDateIds=${DAY_B}`,
    );
  });

  test("(d) every date still to come cancelled: Sold out, no chooser, no way into checkout", async () => {
    const tree = await mount([occ(DAY_A, 21, true), occ(DAY_B, 22, true)]);
    expect(bannerText(tree)).toContain("Sold out");
    // Not "Join waitlist": there is no date to wait for.
    expect(bannerText(tree)).not.toContain("Join waitlist");
    expect(has(tree, "issue-2135-day-chooser")).toBe(false);
    await act(async () => press(tree, "issue-2135-proceed"));
    expect(router.push).not.toHaveBeenCalled();
  });

  test("(d) one date still on: tickets stay on sale", async () => {
    const tree = await mount([occ(DAY_A, 21, true), occ(DAY_B, 22)]);
    expect(bannerText(tree)).not.toContain("Sold out");
    expect(has(tree, "issue-2135-day-chooser")).toBe(true);
  });
});
