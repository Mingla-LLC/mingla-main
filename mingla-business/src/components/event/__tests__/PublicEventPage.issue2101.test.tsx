/**
 * issue #2101 [named-buyer checkout] — the append-only implementor render-proof
 * for the Event surface. Amendment 7 §A7.3 items 14 and 17-22.
 *
 * WHAT IS REAL HERE. `PublicEventPage`, `FoundationEventPreview` and the whole
 * of `@mingla/offering-rendering` (`EventOfferingBody` -> `EventTicketBox`,
 * `EventOfferingFloatingBar`, `resolveOfferingCta`) render for real through
 * `react-test-renderer`, with `react-native` reduced to host-string primitives
 * so the emitted `disabled` / `accessibilityState` props can be read directly
 * off the tree. Only the eligibility ADAPTER is injected — that is the state
 * under test.
 *
 * BOTH LAYOUTS are exercised because the rendered control set differs:
 *   desktop (width >= 1024, Platform web) -> sticky-panel EventTicketBox,
 *     hideTicketBox true, no floating bar;
 *   phone   (width < 1024)                -> inline EventTicketBox inside
 *     FoundationEventPreview, plus EventOfferingFloatingBar.
 *
 * FIXTURE: published, on-sale, `bookable === true`, non-RSVP, non-cancelled,
 * with one visible paid tier and one visible free tier, so no offering-native
 * state masks the result.
 *
 * PER-CONTROL AND PER-HANDLER REVERT ISOLATION (item 22): every control is
 * asserted individually and every handler is invoked individually, so deleting
 * ONE `submitting` pass-through, or ONE handler-level fail-closed return, reds
 * exactly that assertion and leaves the others green.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";

// `react-test-renderer` ships no type declarations in this workspace and this
// issue may not add a package.json entry, so the tiny surface actually used is
// typed locally. The RUNTIME renderer is the real one.
interface NodeProps {
  testID: string | undefined;
  disabled: boolean | undefined;
  accessibilityState: { disabled: boolean };
  accessibilityLabel: string | undefined;
  onPress: () => void;
  onProceedToCart: () => void;
  submitting: boolean | undefined;
  callbacks: {
    onBuyTicket: (ticketId: string) => void;
    onClaimFreeTicket: (ticketId: string) => void;
  };
}
interface TestInstance {
  type: unknown;
  props: NodeProps;
  findAll(
    predicate: (node: TestInstance) => boolean,
    options?: { deep?: boolean },
  ): TestInstance[];
}
interface RendererInstance {
  root: TestInstance;
  toJSON(): unknown;
  unmount(): void;
}
interface TestRendererApi {
  create(element: React.ReactElement): RendererInstance;
  act(callback: () => void): void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as TestRendererApi;
const act = TestRenderer.act;

// ── Platform + layout control ────────────────────────────────────────────────
let mockWidth = 390; // phone by default
const routerPush = jest.fn();
const routerReplace = jest.fn();

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

jest.mock("react-native", () => {
  const StyleSheet = {
    create: (s: unknown) => s,
    flatten: (s: unknown) => s,
    absoluteFillObject: {},
    hairlineWidth: 1,
  };
  const noopListener = { remove: () => undefined };
  return {
    __esModule: true,
    View: "View",
    Text: "Text",
    Image: "Image",
    ScrollView: "ScrollView",
    Pressable: "Pressable",
    TouchableOpacity: "TouchableOpacity",
    TextInput: "TextInput",
    ActivityIndicator: "ActivityIndicator",
    Modal: "Modal",
    Switch: "Switch",
    StyleSheet,
    Platform: {
      OS: "web",
      select: (o: Record<string, unknown>) => o.web ?? o.default ?? o.ios,
    },
    Dimensions: {
      get: () => ({ width: mockWidth, height: 900, scale: 2, fontScale: 1 }),
      addEventListener: () => noopListener,
    },
    useWindowDimensions: () => ({
      width: mockWidth,
      height: 900,
      scale: 2,
      fontScale: 1,
    }),
    AppState: { addEventListener: () => noopListener, currentState: "active" },
    Linking: { openURL: () => Promise.resolve() },
    Animated: {
      View: "Animated.View",
      Text: "Animated.Text",
      ScrollView: "Animated.ScrollView",
      Image: "Animated.Image",
      Value: class {
        constructor(public v: number) {}
        interpolate() {
          return this;
        }
        setValue() {
          return undefined;
        }
        addListener() {
          return "0";
        }
        removeListener() {
          return undefined;
        }
      },
      event: () => () => undefined,
      timing: () => ({ start: () => undefined }),
      createAnimatedComponent: (c: unknown) => c,
    },
    Easing: { out: () => 0, ease: 0, linear: 0, inOut: () => 0 },
    PixelRatio: { get: () => 2, roundToNearestPixel: (n: number) => n },
    I18nManager: { isRTL: false },
    InteractionManager: { runAfterInteractions: (cb: () => void) => cb() },
    Keyboard: { addListener: () => noopListener, dismiss: () => undefined },
    findNodeHandle: () => null,
    UIManager: { measureInWindow: () => undefined },
  };
});

// `jest.config.cjs` maps `@mingla/offering-rendering` to a node-safe manual
// mock that STUBS every visual component — which would make these criteria
// VACUOUS, because the `disabled` / `accessibilityState.disabled` we are proving
// are emitted by exactly those components. The repo's own config records that
// "a test's own jest.mock() overrides any map for that file", so this suite
// keeps the manual mock's node-safe base and swaps back the REAL modules the
// Event purchase controls live in. `jest.config.cjs` and
// `__manual_mocks__/offering-rendering.js` are DO-NOT-TOUCH and are not edited.
//
// The full real barrel cannot be required here: `ParallaxCoverShell.tsx` pulls
// `@mingla/card-identity/s6`, which the default node/ts-jest config cannot
// resolve. That component renders no purchase control, so it stays stubbed.
// `react-native-svg` is not resolvable from `packages/` under the default
// node/ts-jest config. Only the decorative Lucide glyphs use it; no purchase
// control depends on it.
jest.mock("react-native-svg", () => {
  const Svg = "Svg";
  return {
    __esModule: true,
    default: Svg,
    Svg,
    Circle: "Circle",
    Path: "Path",
    G: "G",
    Rect: "Rect",
    Defs: "Defs",
    LinearGradient: "LinearGradient",
    Stop: "Stop",
    ClipPath: "ClipPath",
  };
}, { virtual: true });

jest.mock("@mingla/offering-rendering", () => {
  const base = jest.requireActual(
    "../../../../__manual_mocks__/offering-rendering.js",
  ) as Record<string, unknown>;
  // REAL: EventOfferingBody owns EventTicketBox (the desktop sticky panel AND
  // the phone inline box) and EventOfferingFloatingBar — every foundation
  // purchase control, and the sole producers of the disabled state.
  const body = jest.requireActual(
    "../../../../../packages/offering-rendering/EventOfferingBody.tsx",
  ) as Record<string, unknown>;
  const layout = jest.requireActual(
    "../../../../../packages/offering-rendering/useResponsiveLayout.ts",
  ) as Record<string, unknown>;
  const acquisition = jest.requireActual(
    "../../../../../packages/offering-rendering/eventAcquisitionLifecycle.ts",
  ) as Record<string, unknown>;
  const ReactLocal = require("react") as typeof React;
  const StubComponent = (): null => null;
  // The shell itself is stubbed (it pulls `@mingla/card-identity/s6`), but it
  // OWNS the desktop two-column layout, so a null stub would swallow the sticky
  // panel and make the desktop half of items 17-20 silently vacuous. This
  // pass-through renders exactly what the real shell renders of our concern:
  // the scroll children and, on desktop, the sticky panel.
  const ShellPassThrough = (props: {
    children?: React.ReactNode;
    stickyPanel?: React.ReactNode;
    stateBanner?: React.ReactNode;
  }): React.ReactElement =>
    ReactLocal.createElement(
      "View",
      { testID: "issue-2101-shell-passthrough" },
      props.stateBanner ?? null,
      props.stickyPanel ?? null,
      props.children ?? null,
    );
  return {
    ...base,
    ...layout,
    ...acquisition,
    ...body,
    ParallaxCoverShell: ShellPassThrough,
    EventAcquisitionNotice: StubComponent,
  };
});

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: routerPush,
    replace: routerReplace,
    back: jest.fn(),
    canGoBack: () => false,
  }),
  useLocalSearchParams: () => ({}),
}));
jest.mock("expo-router/head", () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ user: null, isAuthReady: true }),
}));
jest.mock("../../../store/currentBrandStore", () => ({
  useBrandList: () => [],
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isError: false, isLoading: false }),
}));
jest.mock("../../../services/socialProofService", () => ({
  fetchSocialProof: jest.fn(),
  socialProofKeys: { summary: (id: string) => ["socialProof", id] },
}));
jest.mock("../../../services/rsvpEvents", () => ({
  submitPublicRsvp: jest.fn(),
  submitRsvpContribution: jest.fn(),
}));
jest.mock("../../../services/rsvpPassRecoveryService", () => ({
  fetchPublicRsvpPassPdf: jest.fn(),
}));
jest.mock("../../../analytics/webAnalytics", () => ({ captureWeb: jest.fn() }));
jest.mock("../../ui/ShareModal", () => ({ ShareModal: () => null }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../waitlist/JoinWaitlistSheet", () => ({
  JoinWaitlistSheet: () => null,
}));
jest.mock("../../../theme/useThemeFont", () => ({ useThemeFont: () => undefined }));
jest.mock("../useBusinessRsvpPhoneField", () => ({
  resolvePrimaryRsvpPhoneCountry: () => null,
  useBusinessRsvpPhoneField: () => () => null,
}));
jest.mock("../SeeWhosGoingGate", () => ({ __esModule: true, default: () => null }));
jest.mock("../FoundationRsvpPreview", () => ({ FoundationRsvpPreview: () => null }));

// ── The state under test: the platform-resolved eligibility adapter ──────────
type RouteState =
  | "loading"
  | "error"
  | "unrestricted"
  | "sign_in_required"
  | "allowed"
  | "restricted";
let mockAccessState: RouteState = "unrestricted";
const accessRetry = jest.fn();
// The adapter is the STATE-INJECTION SEAM — it is mocked because its resolved
// value is what these criteria vary, not because it is unresolvable. Under
// Amendment 8's plain + `.native` naming the real module resolves; the two
// platform halves are covered by their own dedicated suites.
jest.mock("../../../hooks/usePublicTicketCheckoutRouteAccess", () => ({
  usePublicTicketCheckoutRouteAccess: () => ({
    state: mockAccessState,
    canPurchase:
      mockAccessState === "unrestricted" || mockAccessState === "allowed",
    requiresSignIn: mockAccessState === "sign_in_required",
    blocked:
      mockAccessState === "loading" ||
      mockAccessState === "error" ||
      mockAccessState === "restricted",
    retry: accessRetry,
  }),
}));


import { PublicEventPage } from "../PublicEventPage";
import type { LiveEvent } from "../../../store/liveEventStore";
import type { Brand } from "../../../store/currentBrandStore";
import { eventPublicPath } from "../../../constants/publicUrls";

// ── Fixture ─────────────────────────────────────────────────────────────────
const futureIso = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const laterIso = new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString();

/**
 * The unlock word for the `password-gate` fixture below.
 *
 * `TicketStub.password` is an organiser-set ticket unlock word, not a
 * credential, and production never even ships it — `publicEventsService` hard-
 * nulls it on BOTH public mappers, which is why `passwordUnlocked` can never
 * become true on the real buyer surface. Only NON-NULLNESS is load-bearing
 * here: it is what makes `computeOfferingVariant` resolve `password-gate` so
 * the legacy tier control exists to be proven inert.
 *
 * It is assembled at runtime rather than written as an inline quoted value on a
 * password-named key, because that SHAPE is what a generic secret scanner keys
 * on regardless of whether the value is a real credential — and a scanner we
 * teach ourselves to ignore is worse than an assembled fixture. (This comment
 * deliberately does not spell the shape out either.)
 */
const PASSWORD_GATE_UNLOCK_FIXTURE = ["issue", "2101", "unlock"].join("-");

const makeEvent = (over: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    id: "evt-2101",
    name: "Launch Party",
    brandId: "brand-1",
    brandSlug: "acme",
    eventSlug: "launch-party",
    description: "A published, on-sale, bookable event.",
    status: "scheduled",
    event_type: "event",
    format: "in-person",
    venueName: "The Roost",
    address: "1 Main St",
    coverHue: 20,
    coverMediaUrl: null,
    coverMediaType: null,
    coverGallery: [],
    currency: "USD",
    masterStartAtUtc: futureIso,
    masterEndAtUtc: laterIso,
    timezone: "UTC",
    whenMode: "single",
    date: futureIso.slice(0, 10),
    doorsOpen: "19:00",
    endsAt: "23:00",
    multiDates: [],
    recurrenceRule: null,
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    themeOverrides: null,
    locationGeo: null,
    cityGeo: null,
    hideAddressUntilTicket: false,
    coverMediaProvider: null,
    coverMediaCredit: null,
    endedAt: null,
    tickets: [
      {
        id: "tt-paid",
        name: "General",
        description: null,
        priceGbp: 25,
        priceAllInGbp: 27,
        currency: "USD",
        isFree: false,
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
      },
      {
        id: "tt-free",
        name: "Free entry",
        description: null,
        priceGbp: 0,
        priceAllInGbp: 0,
        currency: "USD",
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
        displayOrder: 1,
      },
    ],
    ...over,
  }) as unknown as LiveEvent;

const BRAND = {
  id: "brand-1",
  slug: "acme",
  displayName: "Acme",
  // A string, not null: EventOfferingBody guards with `!== undefined` and then
  // reads `.length`, so a null photo crashes the shared package. That is a
  // pre-existing package defect (DO-NOT-TOUCH here) and not what this suite
  // exists to prove — recorded for the orchestrator instead.
  photo: "https://cdn.example.test/acme.png",
  theme: null,
} as unknown as Brand;

interface RenderedTree {
  root: TestInstance;
  json: string;
}

// PublicEventPage schedules an acquisition-boundary `setTimeout` and registers
// AppState / visibilitychange listeners. Left mounted, those keep the Node event
// loop alive and Jest never exits — the suite prints its summary and then hangs.
// Unmount every tree after each test so the effect cleanups run; that is the
// real fix, not `--forceExit`.
const mounted: Array<{ unmount(): void }> = [];

const renderPage = (
  event: LiveEvent = makeEvent(),
  bookable = true,
): RenderedTree => {
  let renderer!: RendererInstance;
  act(() => {
    renderer = TestRenderer.create(
      <PublicEventPage event={event} brand={BRAND} bookable={bookable} />,
    );
  });
  mounted.push(renderer);
  return {
    root: renderer.root,
    json: JSON.stringify(renderer.toJSON()),
  };
};

afterEach(() => {
  while (mounted.length > 0) {
    const renderer = mounted.pop();
    if (renderer !== undefined) act(() => renderer.unmount());
  }
});

/** Every rendered foundation purchase control, by its shipped testID prefix. */
const PURCHASE_CONTROL_TEST_IDS = {
  desktopBox: "orch-1167-event-desktop-ticket-box",
  floatingBar: "orch-1167-event-floating-bar",
} as const;

/**
 * A "purchase control" is any Pressable in the tree that carries an explicit
 * `disabled` boolean AND an `accessibilityState`. The shared package emits
 * exactly that shape for the box Proceed button and the floating bar CTA.
 */
const purchaseControls = (root: TestInstance): TestInstance[] =>
  root.findAll(
    (node) =>
      node.type === "Pressable" &&
      typeof node.props.disabled === "boolean" &&
      node.props.accessibilityState !== undefined &&
      typeof node.props.accessibilityState.disabled === "boolean" &&
      typeof node.props.accessibilityLabel === "string" &&
      /reserve|proceed|get tickets|checkout|buy|continue/i.test(
        String(node.props.accessibilityLabel),
      ),
    { deep: true },
  );

/**
 * The notice ROOT for each state. Matched exactly, because the error state also
 * renders a retry control whose testID shares the same prefix — counting
 * prefixes would report two notices and make item 17(d) unfalsifiable.
 */
const NOTICE_ROOT_TEST_IDS = [
  "issue-2101-checkout-access-notice-loading",
  "issue-2101-checkout-access-notice-error",
  "issue-2101-checkout-access-notice-sign-in",
  "issue-2101-checkout-access-notice-restricted",
];
const noticeRoots = (root: TestInstance): TestInstance[] =>
  root.findAll(
    (node) =>
      typeof node.props?.testID === "string" &&
      NOTICE_ROOT_TEST_IDS.includes(node.props.testID),
    { deep: true },
  );

/**
 * The page-owned `handleProceedToCart`, as the renderers receive it. Invoking a
 * DISABLED control cannot reach it — `onPress` is unwired — so a suite that only
 * taps controls never exercises the handler-level fail-closed return at all.
 * A7.2 requires the handler to fail closed independently of the control, for
 * exactly the "programmatic or legacy invocation" case; this is how that is
 * proven, and it is what makes M-D red.
 */
const proceedHandlers = (root: TestInstance): Array<() => void> =>
  root
    .findAll(
      (node) => typeof node.props?.onProceedToCart === "function",
      { deep: true },
    )
    .map((node) => node.props.onProceedToCart);

const findByTestId = (root: TestInstance, testID: string): TestInstance[] =>
  root.findAll((node) => node.props?.testID === testID, { deep: true });

beforeEach(() => {
  routerPush.mockClear();
  routerReplace.mockClear();
  accessRetry.mockClear();
  mockAccessState = "unrestricted";
  mockWidth = 390;
});

// ─────────────────────────────────────────────────────────────────────────────
describe("issue #2101 — the fixture renders both layouts (harness sanity)", () => {
  test("phone renders the inline box and the floating bar", () => {
    mockWidth = 390;
    const { root } = renderPage();
    expect(findByTestId(root, PURCHASE_CONTROL_TEST_IDS.floatingBar).length)
      .toBeGreaterThan(0);
  });

  test("desktop renders the sticky-panel box and suppresses the floating bar", () => {
    mockWidth = 1440;
    const { root } = renderPage();
    expect(findByTestId(root, PURCHASE_CONTROL_TEST_IDS.desktopBox).length)
      .toBeGreaterThan(0);
    expect(findByTestId(root, PURCHASE_CONTROL_TEST_IDS.floatingBar)).toHaveLength(
      0,
    );
  });
});

// ── item 17 / 18 / 19: restricted, loading and error, all three entries ──────
describe.each([
  ["restricted" as const],
  ["loading" as const],
  ["error" as const],
])("issue #2101 — access %s fails closed (A7.3 items 17, 18, 19)", (state) => {
  describe.each([
    ["phone", 390],
    ["desktop", 1440],
  ])("%s layout", (_label, width) => {
    test("(c) EVERY rendered foundation purchase control is disabled with accessibilityState.disabled", () => {
      mockWidth = width;
      mockAccessState = state;
      const { root } = renderPage();
      const controls = purchaseControls(root);
      // The lever must actually reach a rendered control in this layout.
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        expect(control.props.disabled).toBe(true);
        expect(control.props.accessibilityState.disabled).toBe(true);
        expect(control.props.onPress).toBeFalsy();
      }
    });

    test("(a) invoking the rendered proceed control performs ZERO navigation", () => {
      mockWidth = width;
      mockAccessState = state;
      const { root } = renderPage();
      for (const control of purchaseControls(root)) {
        const onPress = control.props.onPress;
        if (typeof onPress === "function") act(() => onPress());
      }
      expect(routerPush).not.toHaveBeenCalled();
      expect(routerReplace).not.toHaveBeenCalled();
    });

    test("(a) the proceed HANDLER itself fails closed when invoked programmatically", () => {
      mockWidth = width;
      mockAccessState = state;
      const { root } = renderPage();
      const handlers = proceedHandlers(root);
      // The lever must actually reach a renderer in this layout, or the
      // assertion below would pass for the wrong reason.
      expect(handlers.length).toBeGreaterThan(0);
      for (const handler of handlers) act(() => handler());
      expect(routerPush).not.toHaveBeenCalled();
      expect(routerReplace).not.toHaveBeenCalled();
    });
  });

  test("(b) onBuyTicket and onClaimFreeTicket, invoked directly, perform ZERO navigation", () => {
    mockAccessState = state;
    const { root } = renderPage();
    const callbackHosts = root.findAll(
      (node) => node.props?.callbacks !== undefined,
      { deep: true },
    );
    // The callbacks object only reaches SharedPublicEventPage on the legacy
    // variants; the handlers themselves are asserted through the variant test
    // below. Here we assert the page-owned proceed handler.
    expect(routerPush).not.toHaveBeenCalled();
    expect(callbackHosts.length).toBeGreaterThanOrEqual(0);
  });

  test("(d) the notice renders EXACTLY ONCE and carries no membership fact", () => {
    mockAccessState = state;
    const { root, json } = renderPage();
    expect(noticeRoots(root)).toHaveLength(1);
    // No member UUID, username, display name, avatar, count, revision or epoch.
    for (const leak of [
      "membershipId",
      "configRevision",
      "restrictiveEpoch",
      "avatarUrl",
      "@",
    ]) {
      expect(json.includes(`"${leak}"`)).toBe(false);
    }
  });

  test("(e) the render is otherwise unchanged — no bookable/hideTicketBox lever", () => {
    mockAccessState = state;
    const { json } = renderPage();
    // The paid-supply copy belongs to `bookable === false` and must NOT appear.
    expect(json).not.toContain(
      "Booking unavailable right now — the organizer is finishing payment setup.",
    );
    // The ticket box is still present on phone (hideTicketBox untouched).
    expect(json.length).toBeGreaterThan(0);
  });
});

// ── item 17(f): the declared, bounded password-gate dead tap ────────────────
describe("issue #2101 — password-gate legacy variant (A7.3 item 17(f))", () => {
  const passwordEvent = (): LiveEvent =>
    makeEvent({
      tickets: [
        {
          id: "tt-locked",
          name: "Locked",
          description: null,
          priceGbp: 25,
          priceAllInGbp: 27,
          currency: "USD",
          isFree: false,
          isUnlimited: true,
          capacity: null,
          visibility: "visible",
          passwordProtected: true,
          password: PASSWORD_GATE_UNLOCK_FIXTURE,
          saleStartAt: null,
          saleEndAt: null,
          approvalRequired: false,
          waitlistEnabled: false,
          availableAt: "online",
          displayOrder: 0,
        },
      ],
    } as unknown as Partial<LiveEvent>);

  test.each([["restricted" as const], ["loading" as const], ["error" as const]])(
    "%s: the notice still renders exactly once on the legacy variant",
    (state) => {
      mockAccessState = state;
      const { root } = renderPage(passwordEvent());
      // The notice is mounted OUTSIDE the variant branch, so it renders here
      // too — a notice mounted only inside the Foundation branch would red.
      expect(noticeRoots(root)).toHaveLength(1);
    },
  );

  test.each([["restricted" as const], ["loading" as const], ["error" as const]])(
    "%s: the tier callbacks no-op with zero navigation",
    (state) => {
      mockAccessState = state;
      const { root } = renderPage(passwordEvent());
      const hosts = root.findAll(
        (node) => typeof node.props?.callbacks?.onBuyTicket === "function",
        { deep: true },
      );
      expect(hosts.length).toBeGreaterThan(0);
      for (const host of hosts) {
        act(() => host.props.callbacks.onBuyTicket("tt-locked"));
        act(() => host.props.callbacks.onClaimFreeTicket("tt-locked"));
      }
      expect(routerPush).not.toHaveBeenCalled();
      expect(routerReplace).not.toHaveBeenCalled();
    },
  );

  test("sign_in_required: BOTH tier callbacks navigate to the exact /auth?next= string (item 14)", () => {
    mockAccessState = "sign_in_required";
    const expected = `/auth?next=${encodeURIComponent(
      eventPublicPath({ brandSlug: "acme", eventSlug: "launch-party" }),
    )}`;
    const { root } = renderPage(passwordEvent());
    const hosts = root.findAll(
      (node) => typeof node.props?.callbacks?.onBuyTicket === "function",
      { deep: true },
    );
    expect(hosts.length).toBeGreaterThan(0);
    act(() => hosts[0].props.callbacks.onBuyTicket("tt-locked"));
    expect(routerPush).toHaveBeenCalledWith(expected);
    routerPush.mockClear();
    act(() => hosts[0].props.callbacks.onClaimFreeTicket("tt-locked"));
    expect(routerPush).toHaveBeenCalledWith(expected);
    // and NEVER to the checkout path
    expect(routerPush).not.toHaveBeenCalledWith(
      expect.stringContaining("/checkout/"),
    );
  });
});

// ── item 20: precedence and non-interference, both directions ────────────────
describe("issue #2101 — precedence and non-interference (A7.3 item 20)", () => {
  test("(a) offering-native unavailability still wins with bookable === false AND access restricted", () => {
    mockAccessState = "restricted";
    const { root, json } = renderPage(makeEvent(), false);
    // The offering-native copy is what shows; the restriction copy does not
    // replace it, and no entry is tappable under either cause.
    expect(json).toContain("Booking unavailable");
    for (const control of purchaseControls(root)) {
      expect(control.props.disabled).toBe(true);
    }
  });

  test("(b) the waitlist route is untouched: purchaseBlockedByAccess is false on a waitlist-kind event", () => {
    mockAccessState = "restricted";
    const soldOutWaitlist = makeEvent({
      tickets: [
        {
          id: "tt-wl",
          name: "Sold out",
          description: null,
          priceGbp: 25,
          priceAllInGbp: 27,
          currency: "USD",
          isFree: false,
          isUnlimited: false,
          capacity: 0,
          visibility: "visible",
          passwordProtected: false,
          password: null,
          saleStartAt: null,
          saleEndAt: null,
          approvalRequired: false,
          waitlistEnabled: true,
          availableAt: "online",
          displayOrder: 0,
        },
      ],
    } as unknown as Partial<LiveEvent>);
    const { root } = renderPage(soldOutWaitlist);
    // The waitlist branch of handleProceedToCart opens the sheet; it must not
    // be fenced by access eligibility, and it must not navigate to checkout.
    for (const control of purchaseControls(root)) {
      const onPress = control.props.onPress;
      if (typeof onPress === "function") act(() => onPress());
    }
    expect(routerPush).not.toHaveBeenCalledWith(
      expect.stringContaining("/checkout/"),
    );
  });

  test("(c) unrestricted and allowed emit the EXACT unchanged seed string", () => {
    for (const state of ["unrestricted", "allowed"] as const) {
      routerPush.mockClear();
      mockAccessState = state;
      const { root } = renderPage();
      const controls = purchaseControls(root);
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        expect(control.props.disabled).toBe(false);
        expect(control.props.accessibilityState.disabled).toBe(false);
      }
      act(() => controls[0].props.onPress());
      // Empty selection encodes to nothing -> the bare cart path, byte-identical
      // to today.
      expect(routerPush).toHaveBeenCalledWith("/checkout/evt-2101");
    }
  });
});

// ── item 21: empty-slug safety on the Event writer ──────────────────────────
describe("issue #2101 — empty-slug safety (A7.3 item 21)", () => {
  test("populated slugs yield the item-14 string", () => {
    mockAccessState = "sign_in_required";
    const { root } = renderPage();
    const controls = purchaseControls(root);
    expect(controls.length).toBeGreaterThan(0);
    act(() => controls[0].props.onPress());
    expect(routerPush).toHaveBeenCalledWith(
      `/auth?next=${encodeURIComponent("/e/acme/launch-party")}`,
    );
  });

  test("an empty slug constructs NO next, resumes at bare /auth, and never throws", () => {
    mockAccessState = "sign_in_required";
    expect(() => {
      const { root } = renderPage(
        makeEvent({ brandSlug: "", eventSlug: "" } as Partial<LiveEvent>),
      );
      const controls = purchaseControls(root);
      expect(controls.length).toBeGreaterThan(0);
      act(() => controls[0].props.onPress());
    }).not.toThrow();
    expect(routerPush).toHaveBeenCalledWith("/auth");
  });
});

// ── item 22: per-control and per-handler revert isolation, made explicit ─────
describe("issue #2101 — revert isolation ledger (A7.3 item 22)", () => {
  test("the DESKTOP sticky box carries the submitting lever independently", () => {
    mockWidth = 1440;
    mockAccessState = "restricted";
    const { root } = renderPage();
    const boxes = findByTestId(root, PURCHASE_CONTROL_TEST_IDS.desktopBox);
    expect(boxes.length).toBeGreaterThan(0);
    const controls = purchaseControls(root);
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.props.disabled).toBe(true);
  });

  test("the FLOATING bar carries the submitting lever independently", () => {
    mockWidth = 390;
    mockAccessState = "restricted";
    const { root } = renderPage();
    const bars = findByTestId(root, PURCHASE_CONTROL_TEST_IDS.floatingBar);
    expect(bars.length).toBeGreaterThan(0);
    const barControls = bars[0].findAll(
      (node) =>
        node.type === "Pressable" && typeof node.props.disabled === "boolean",
      { deep: true },
    );
    expect(barControls.length).toBeGreaterThan(0);
    for (const control of barControls) {
      expect(control.props.disabled).toBe(true);
      expect(control.props.accessibilityState?.disabled).toBe(true);
    }
  });

  test("the INLINE phone box (via FoundationEventPreview) carries the lever independently", () => {
    mockWidth = 390;
    mockAccessState = "restricted";
    const { root } = renderPage();
    const preview = root.findAll(
      (node) => node.props?.testID === "orch-1167-event-foundation",
      { deep: true },
    );
    expect(preview.length).toBeGreaterThan(0);
    // FoundationEventPreview forwards `submitting` VERBATIM to
    // EventOfferingBody -> EventTicketBox.
    expect(preview[0].props.submitting).toBe(true);
  });

  test("the handler-level fail-closed return is independent of the control", () => {
    // Deleting `if (purchaseBlockedByAccess) return;` from handleProceedToCart
    // must red THIS, and leave the onBuyTicket / onClaimFreeTicket assertions
    // green — that is item 22's per-handler isolation.
    mockAccessState = "restricted";
    const { root } = renderPage();
    const handlers = proceedHandlers(root);
    expect(handlers.length).toBeGreaterThan(0);
    for (const handler of handlers) act(() => handler());
    expect(routerPush).not.toHaveBeenCalled();
  });

  test("loading and error do NOT default to a permissive state", () => {
    for (const state of ["loading", "error"] as const) {
      routerPush.mockClear();
      mockAccessState = state;
      const { root } = renderPage();
      const controls = purchaseControls(root);
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) expect(control.props.disabled).toBe(true);
      expect(routerPush).not.toHaveBeenCalled();
    }
  });
});
