/**
 * issue #3314 follow-up — the Business public event page reads the organiser's
 * "Hide remaining count" from the event bundle first (migration 20270704003314).
 *
 * WHAT BROKE. #3360 made the page fail closed and took the setting from the
 * social-proof read, which answers for PUBLIC events only. An UNLISTED event got
 * no answer, so it never showed a count, even with the setting off.
 *
 * WHAT IS REAL. The Business `PublicEventPage` host and the shared
 * `EventOfferingBody` / `EventTicketBox`, through `react-test-renderer`, with the
 * same harness as the #3360 suite (copied, not imported: that file is a test).
 * Injected: the social-proof query result and the new `bundleHideRemainingCount`
 * prop — the two sources under test.
 *
 * FAILS ON REVERT (each mutation run against this file, see the PR):
 *   - the page ignores the bundle prop (#3360's rule)     → U-1, U-1b, U-2, U-7
 *   - the bundle's "allowed" beats a "hide" elsewhere     → U-4, U-4b
 *   - the prop defaults to "allowed" instead of unknown   → U-5
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

interface NodeProps {
  testID: string | undefined;
  [key: string]: unknown;
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

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let mockWidth = 390;
// The social-proof payload the page receives. `undefined` = still loading.
let mockSocialProof:
  | { hideRemainingCount: boolean; [key: string]: unknown }
  | null
  | undefined;

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

// Virtual: resolved from `packages/`, where Business's node_modules is not seen.
jest.mock(
  "expo-haptics",
  () => ({ selectionAsync: () => Promise.resolve() }),
  { virtual: true },
);

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

jest.mock(
  "react-native-svg",
  () => {
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
  },
  { virtual: true },
);

// Same seam as the #2101 suite: keep the node-safe manual barrel, swap back the
// REAL modules that render the counts.
jest.mock("@mingla/offering-rendering", () => {
  const base = jest.requireActual(
    "../../../../__manual_mocks__/offering-rendering.js",
  ) as Record<string, unknown>;
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
  const ShellPassThrough = (props: {
    children?: React.ReactNode;
    stickyPanel?: React.ReactNode;
    stateBanner?: React.ReactNode;
  }): React.ReactElement =>
    ReactLocal.createElement(
      "View",
      { testID: "issue-3314b-shell-passthrough" },
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
    push: jest.fn(),
    replace: jest.fn(),
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
// THE STATE UNDER TEST: only the social-proof query answers; nothing else on
// this page reads through useQuery in the ticketed branch.
jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: { queryKey: readonly unknown[] }) => ({
    data: options.queryKey[0] === "socialProof" ? mockSocialProof : undefined,
    isError: false,
    isLoading: false,
  }),
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
jest.mock("../../../theme/useThemeFont", () => ({
  useThemeFont: () => undefined,
}));
jest.mock("../useBusinessRsvpPhoneField", () => ({
  resolvePrimaryRsvpPhoneCountry: () => null,
  useBusinessRsvpPhoneField: () => () => null,
}));
jest.mock("../SeeWhosGoingGate", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../FoundationRsvpPreview", () => ({
  FoundationRsvpPreview: () => null,
}));
jest.mock("../../../hooks/usePublicTicketCheckoutRouteAccess", () => ({
  usePublicTicketCheckoutRouteAccess: () => ({
    state: "unrestricted",
    canPurchase: true,
    requiresSignIn: false,
    blocked: false,
    retry: jest.fn(),
  }),
}));

/* eslint-disable import/first */
import { PublicEventPage } from "../PublicEventPage";
import type { LiveEvent } from "../../../store/liveEventStore";
import type { Brand } from "../../../store/currentBrandStore";
/* eslint-enable import/first */

// ── Fixtures ────────────────────────────────────────────────────────────────
const futureIso = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const laterIso = new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString();

/** Tuesday Night Jazz, as the bundle maps it: `capacity` holds what is left. */
const jazzTicket = {
  id: "tt-jazz",
  name: "General",
  description: null,
  priceGbp: 20,
  priceAllInGbp: 22,
  currency: "USD",
  isFree: false,
  isUnlimited: false,
  capacity: 60,
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

const makeLiveEvent = (over: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    id: "evt-3314",
    name: "Tuesday Night Jazz",
    brandId: "brand-1",
    brandSlug: "acme",
    eventSlug: "tuesday-night-jazz",
    description: "Live jazz.",
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
    // The bundle reader's fallback — what every bundle-served page carries.
    hideRemainingCount: false,
    tickets: [jazzTicket],
    ...over,
  }) as unknown as LiveEvent;

const BRAND = {
  id: "brand-1",
  slug: "acme",
  displayName: "Acme",
  photo: "https://cdn.example.test/acme.png",
  theme: null,
} as unknown as Brand;

const mounted: RendererInstance[] = [];
const mount = (element: React.ReactElement): string => {
  let renderer!: RendererInstance;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  mounted.push(renderer);
  return JSON.stringify(renderer.toJSON());
};

afterEach(() => {
  while (mounted.length > 0) {
    const renderer = mounted.pop();
    if (renderer !== undefined) act(() => renderer.unmount());
  }
});

beforeEach(() => {
  mockWidth = 390;
  mockSocialProof = undefined;
});

// ── U — the unlisted case, and the precedence ──────────────────────────────
describe("#3314 follow-up U — PublicEventPage prefers the bundle's setting", () => {
  const renderPage = (
    bundleHideRemainingCount: boolean | null | undefined,
    event: LiveEvent = makeLiveEvent(),
  ): string =>
    mount(
      <PublicEventPage
        event={event}
        brand={BRAND}
        bookable
        {...(bundleHideRemainingCount === undefined
          ? {}
          : { bundleHideRemainingCount })}
      />,
    );

  test("U-1 unlisted event, setting off: social proof has no answer (null) but the bundle allows it, so the count shows", () => {
    mockSocialProof = null;
    const json = renderPage(false);
    expect(json).toContain("60 tickets left");
    expect(json).toContain("60 available");
  });

  test("U-1b the same with social proof still loading (undefined): the bundle alone is enough", () => {
    mockSocialProof = undefined;
    const json = renderPage(false);
    expect(json).toContain("60 tickets left");
  });

  test("U-2 the bundle says hide: no count even if social proof says allow", () => {
    mockSocialProof = { hideRemainingCount: false, goingCount: 0, sample: [] };
    const json = renderPage(true);
    expect(json).not.toContain("60 tickets left");
    expect(json).not.toContain("60 available");
  });

  test("U-3 unlisted event, setting on: the bundle hides it with no social-proof answer", () => {
    mockSocialProof = null;
    const json = renderPage(true);
    expect(json).not.toContain("60 tickets left");
    expect(json).not.toContain("60 available");
  });

  test("U-4 the bundle allows but social proof says hide: any hide wins", () => {
    mockSocialProof = { hideRemainingCount: true, goingCount: 0, sample: [] };
    const json = renderPage(false);
    expect(json).not.toContain("60 tickets left");
  });

  test("U-4b the bundle allows but the organiser setting on the event says hide: hidden", () => {
    mockSocialProof = null;
    const json = renderPage(false, makeLiveEvent({ hideRemainingCount: true }));
    expect(json).not.toContain("60 tickets left");
  });

  test("U-5 no bundle answer (pre-migration payload) and no social-proof answer: still fail-closed", () => {
    mockSocialProof = null;
    expect(renderPage(null)).not.toContain("60 tickets left");
    expect(renderPage(undefined)).not.toContain("60 tickets left");
  });

  test("U-6 no bundle answer falls back to social proof exactly as before", () => {
    mockSocialProof = { hideRemainingCount: false, goingCount: 0, sample: [] };
    expect(renderPage(null)).toContain("60 tickets left");
  });

  test("U-7 desktop sticky panel follows the bundle too", () => {
    mockWidth = 1440;
    mockSocialProof = null;
    const shown = renderPage(false);
    expect(shown).toContain("60 available");
    const hidden = renderPage(true);
    expect(hidden).not.toContain("60 available");
  });
});
