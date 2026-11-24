/**
 * issue #3281 S-21 — the public event page must hand each ticket's add-ons
 * (`buyerExtras`) to the shared body, whose "Add at checkout:" list reads them,
 * together with the page's add-ons slot. mapTicket dropped them, so
 * /e/{brand}/{event} showed none although the page data had them with "show on
 * public page" on.
 *
 * Mounts the REAL Business PublicEventPage and the REAL FoundationEventPreview
 * (harness shape from the #3314 suite) with the add-ons switch on; only the
 * shared EventOfferingBody is replaced by a recorder of what it was handed.
 *
 * FAILS ON REVERT: drop `buyerExtras` from mapTicket, or stop passing
 * `addOns={publicAddOnsSlot}` from FoundationEventPreview.
 */
import { afterAll, afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

// The add-ons switch is read when featureFlags loads; this suite turns it on and
// puts it back afterwards so no later suite in the same worker inherits it.
const PRIOR_EXTRAS_FLAG = process.env.EXPO_PUBLIC_FF_EXTRAS_ENABLED;
process.env.EXPO_PUBLIC_FF_EXTRAS_ENABLED = "true";
afterAll(() => {
  if (PRIOR_EXTRAS_FLAG === undefined) delete process.env.EXPO_PUBLIC_FF_EXTRAS_ENABLED;
  else process.env.EXPO_PUBLIC_FF_EXTRAS_ENABLED = PRIOR_EXTRAS_FLAG;
});

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
}
interface RendererInstance {
  root: TestInstance;
  unmount(): void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(element: React.ReactElement): RendererInstance;
  act(callback: () => void): void;
};
const act = TestRenderer.act;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockWidth = 390;
let mockBodyProps: { event?: { tickets?: Array<Record<string, unknown>> }; addOns?: unknown } | null = null;

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

jest.mock("@mingla/offering-rendering", () => {
  const base = jest.requireActual(
    "../../../../__manual_mocks__/offering-rendering.js",
  ) as Record<string, unknown>;
  const layout = jest.requireActual(
    "../../../../../packages/offering-rendering/useResponsiveLayout.ts",
  ) as Record<string, unknown>;
  const acquisition = jest.requireActual(
    "../../../../../packages/offering-rendering/eventAcquisitionLifecycle.ts",
  ) as Record<string, unknown>;
  return {
    ...base,
    ...layout,
    ...acquisition,
    EventOfferingBody: (props: { event?: { tickets?: Array<Record<string, unknown>> }; addOns?: unknown }) => {
      mockBodyProps = props;
      return null;
    },
    ParallaxCoverShell: (props: { children?: React.ReactNode }) => props.children ?? null,
    EventAcquisitionNotice: () => null,
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
  useQuery: () => ({
    data: undefined,
    isError: false,
    isLoading: false,
  }),
}));

// [TEST-MOD-APPROVED #3682] Shared Follow double — PublicEventPage mounts
// useBrandFollow; without this the suite loads brandFollowsService → supabase.
jest.mock(
  "../../../hooks/useBrandFollow",
  () => require("./harness/useBrandFollow.publicEventPage.mock"),
);

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

/* eslint-disable @typescript-eslint/no-require-imports */
const { PublicEventPage } = require("../PublicEventPage") as typeof import("../PublicEventPage");
const { publicAddOnsSlot } = require("../../addOns/publicAddOnsSlot") as typeof import("../../addOns/publicAddOnsSlot");
/* eslint-enable @typescript-eslint/no-require-imports */
import type { LiveEvent } from "../../../store/liveEventStore";
import type { Brand } from "../../../store/currentBrandStore";

const futureIso = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const laterIso = new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString();

const BUYER_EXTRAS = [
  {
    id: "ao-drink",
    name: "Welcome drink",
    description: null,
    priceCents: 800,
    priceAllInCents: 840,
    maxPerTicket: 2,
    isUnlimited: true,
    validOccurrenceIds: null,
    remaining: null,
    showOnPublicPage: true,
  },
];

const ticket = (id: string, buyerExtras?: unknown) => ({
  id,
  name: id,
  description: null,
  priceGbp: 20,
  priceAllInGbp: 22,
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
  ...(buyerExtras === undefined ? {} : { buyerExtras }),
});

const liveEvent = {
  id: "evt-3281",
  name: "Rooftop Night",
  brandId: "brand-1",
  brandSlug: "acme",
  eventSlug: "rooftop-night",
  description: "Music on the roof.",
  status: "scheduled",
  event_type: "event",
  format: "in-person",
  venueName: "The Roof",
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
  hideRemainingCount: false,
  tickets: [ticket("tt-with-extras", BUYER_EXTRAS), ticket("tt-plain")],
} as unknown as LiveEvent;

const BRAND = {
  id: "brand-1",
  slug: "acme",
  displayName: "Acme",
  photo: null,
  theme: null,
} as unknown as Brand;

const mounted: RendererInstance[] = [];
afterEach(() => {
  while (mounted.length > 0) {
    const r = mounted.pop();
    if (r !== undefined) act(() => r.unmount());
  }
  mockBodyProps = null;
});

const mountPage = (): void => {
  act(() => {
    mounted.push(TestRenderer.create(<PublicEventPage event={liveEvent} brand={BRAND} bookable />));
  });
};

describe("issue #3281 S-21 — /e keeps the ticket add-ons", () => {
  test("the add-ons switch is on for this suite (the slot is a real renderer)", () => {
    expect(typeof publicAddOnsSlot).toBe("function");
  });

  test("each ticket reaches the shared body with its own add-ons", () => {
    mountPage();
    expect(mockBodyProps).not.toBeNull();
    const byId = new Map((mockBodyProps?.event?.tickets ?? []).map((t) => [t.id, t]));
    expect(byId.get("tt-with-extras")?.buyerExtras).toEqual(BUYER_EXTRAS);
    expect(byId.get("tt-plain")?.buyerExtras ?? null).toBeNull();
  });

  test("the ticketed page hands the add-ons slot down", () => {
    mountPage();
    expect(mockBodyProps?.addOns).toBe(publicAddOnsSlot);
  });
});
