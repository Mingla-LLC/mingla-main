/**
 * issue #3314 — "Hide remaining count" must hide the count on EVERY public
 * surface of a ticketed event.
 *
 * Filmed 2026-09-14: "500 tickets left" (Amapiano Live) and "60 tickets left"
 * (Tuesday Night Jazz) rendered with the organiser's setting ON.
 *
 * WHY THIS FILE LIVES HERE. The fixes are in `packages/offering-rendering`,
 * `mingla-business` and `app-mobile`. The only universal PR gate that runs jest
 * is the Business full suite, whose roots stop at `mingla-business/src`, so the
 * shared-package and Explorer proofs are imported by relative path (or read as
 * source for the Explorer screen, which cannot mount under this runner).
 *
 * WHAT IS REAL. The shared resolver and label helpers; `EventOfferingBody`,
 * `EventTicketBox` and `QuantityRow` from the package; the Business
 * `PublicEventPage` host (the buyer-web + Business in-app page) through
 * `react-test-renderer`, with only the social-proof query result injected —
 * that result is the state under test. The harness shape is the #2101 suite's.
 *
 * FAILS ON REVERT (each mutation run against this file, see the PR):
 *   - pill ignores the setting (EventOfferingBody)      → B-1, H-1, H-2, H-4, H-5
 *   - ticket-row caption ignores it                      → B-1, B-3, H-1, H-2, H-4
 *   - PublicEventPage drops the resolved flag            → H-1, H-2, H-4, H-5
 *   - PublicEventPage fails OPEN while proof loads       → H-1
 *   - QuantityRow gate removed                           → Q-1
 *   - resolver fails OPEN on unknown                     → R-3, R-4
 *   - Explorer screen back to "?? false"                 → S-2
 *   - checkout row unwired                               → S-1
 *   - legacy cancelled/password page unwired            → S-3
 *   - draft preview drops the organiser's setting        → P-1
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
import { readFileSync } from "node:fs";
import path from "node:path";

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
      { testID: "issue-3314-shell-passthrough" },
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
import type { DraftEvent } from "../../../store/draftEventStore";
import { draftEventBuyerPreview } from "../../../utils/draftEventBuyerPreview";
import {
  resolveHideRemainingCount,
  ticketAvailabilityCaption,
  ticketsLeftSummaryLabel,
} from "../../../../../packages/offering-rendering/remainingCountVisibility";
import {
  EventOfferingBody,
  EventTicketBox,
} from "../../../../../packages/offering-rendering/EventOfferingBody";
import { QuantityRow } from "../../../../../packages/offering-rendering/QuantityRow";
/* eslint-enable import/first */

const REPO_ROOT = path.resolve(__dirname, "../../../../..");

/** Source with comments removed, so a comment can never satisfy a pin. */
const codeOf = (relPath: string): string =>
  readFileSync(path.join(REPO_ROOT, relPath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

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

const palette = {
  page: "#fff",
  card: "#fff",
  panelBorder: "#ddd",
  accent: "#f60",
  accentWash: "#fee",
  accentText: "#fff",
  primaryText: "#111",
  secondaryText: "#333",
  tertiaryText: "#666",
  cutoutBorder: "#eee",
  mutedText: "#777",
  danger: "#900",
  success: "#090",
} as never;
const theme = {
  color: "#f60",
  foregroundColor: "#fff",
  font: "inter",
  fontFamilyValue: "Inter",
  animation: "none",
} as never;

const publicEvent = (hideRemainingCount?: boolean) =>
  ({
    id: "evt-3314",
    name: "Tuesday Night Jazz",
    brandId: "brand-1",
    brandSlug: "acme",
    eventSlug: "tuesday-night-jazz",
    description: "Live jazz.",
    dateLine: "Tue 22 Sep",
    dateSubline: null,
    datesList: [],
    status: "published",
    endedAt: null,
    format: "in-person",
    venueName: "The Roost",
    address: "1 Main St",
    hideAddressUntilTicket: false,
    locationGeo: null,
    cityGeo: null,
    coverHue: 20,
    coverMediaUrl: null,
    coverMediaType: null,
    coverCredit: null,
    tickets: [jazzTicket],
    currency: "USD",
    partyTypes: [],
    ...(hideRemainingCount === undefined ? {} : { hideRemainingCount }),
  }) as never;

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

// ── R — the one rule ────────────────────────────────────────────────────────
describe("#3314 R — resolveHideRemainingCount is fail-closed", () => {
  test("R-1 either authority saying hide wins", () => {
    expect(
      resolveHideRemainingCount({
        organiserSetting: true,
        socialProof: { hideRemainingCount: false },
      }),
    ).toBe(true);
    expect(
      resolveHideRemainingCount({
        organiserSetting: false,
        socialProof: { hideRemainingCount: true },
      }),
    ).toBe(true);
    expect(
      resolveHideRemainingCount({
        organiserSetting: null,
        socialProof: { hideRemainingCount: true },
      }),
    ).toBe(true);
  });

  test("R-2 a count shows only when an authority allows it", () => {
    expect(
      resolveHideRemainingCount({
        organiserSetting: null,
        socialProof: { hideRemainingCount: false },
      }),
    ).toBe(false);
    expect(
      resolveHideRemainingCount({
        organiserSetting: false,
        socialProof: undefined,
      }),
    ).toBe(false);
  });

  test("R-3 still loading (undefined) hides the count", () => {
    expect(
      resolveHideRemainingCount({
        organiserSetting: null,
        socialProof: undefined,
      }),
    ).toBe(true);
  });

  test("R-4 no server summary (an unlisted event: null) hides the count", () => {
    expect(
      resolveHideRemainingCount({
        organiserSetting: undefined,
        socialProof: null,
      }),
    ).toBe(true);
  });
});

describe("#3314 L — the label helpers never print a hidden count", () => {
  test("L-1 the pills summary keeps Sold out and omits the number", () => {
    expect(ticketsLeftSummaryLabel([jazzTicket], false)).toBe("60 tickets left");
    expect(ticketsLeftSummaryLabel([jazzTicket], true)).toBeNull();
    expect(
      ticketsLeftSummaryLabel([{ ...jazzTicket, capacity: 0 }], true),
    ).toBe("Sold out");
    expect(
      ticketsLeftSummaryLabel([{ ...jazzTicket, isUnlimited: true }], false),
    ).toBeNull();
  });

  test("L-2 the tier caption reads Available, Sold out or Unlimited", () => {
    expect(ticketAvailabilityCaption(jazzTicket, false)).toBe("60 available");
    expect(ticketAvailabilityCaption(jazzTicket, true)).toBe("Available");
    expect(
      ticketAvailabilityCaption({ ...jazzTicket, capacity: 0 }, true),
    ).toBe("Sold out");
    expect(
      ticketAvailabilityCaption({ ...jazzTicket, isUnlimited: true }, true),
    ).toBe("Unlimited");
    // The legacy cancelled/password page keeps "0 available" only when allowed.
    expect(
      ticketAvailabilityCaption({ ...jazzTicket, capacity: 0 }, false, false),
    ).toBe("0 available");
    expect(
      ticketAvailabilityCaption({ ...jazzTicket, capacity: 0 }, true, false),
    ).toBe("Sold out");
  });
});

// ── B — the shared body ─────────────────────────────────────────────────────
describe("#3314 B — EventOfferingBody and EventTicketBox read the setting", () => {
  const bodyProps = {
    brand: { id: "brand-1", slug: "acme", displayName: "Acme" } as never,
    variant: "published" as never,
    bookable: true,
    palette,
    theme,
    ticketQuantities: {},
    onChangeTicketQuantity: () => undefined,
    onProceedToCart: () => undefined,
  };

  test("B-1 hidden: no tickets-left pill and no N available caption", () => {
    const json = mount(
      <EventOfferingBody {...bodyProps} event={publicEvent(true)} />,
    );
    expect(json).not.toContain("60 tickets left");
    expect(json).not.toContain("60 available");
    expect(json).toContain("Available");
  });

  test("B-2 allowed: both counts still render (the fix does not over-hide)", () => {
    const json = mount(
      <EventOfferingBody {...bodyProps} event={publicEvent(false)} />,
    );
    expect(json).toContain("60 tickets left");
    expect(json).toContain("60 available");
  });

  test("B-3 the desktop sticky-panel box hides the caption too", () => {
    const hidden = mount(
      <EventTicketBox {...bodyProps} event={publicEvent(true)} />,
    );
    expect(hidden).not.toContain("60 available");
    const shown = mount(
      <EventTicketBox {...bodyProps} event={publicEvent(false)} />,
    );
    expect(shown).toContain("60 available");
  });
});

// ── Q — the cart / checkout quantity row ────────────────────────────────────
describe("#3314 Q — QuantityRow drops the N left caption when hidden", () => {
  const Card = (props: { children?: React.ReactNode }): React.ReactElement =>
    React.createElement("View", null, props.children);
  const rowProps = {
    ticket: { ...jazzTicket, capacity: 3 },
    quantity: 0,
    onQuantityChange: () => undefined,
    CardComponent: Card as never,
    renderPlusIcon: () => React.createElement("Text", null, "+"),
    formatCurrency: (value: number, currency: string) => `${currency} ${value}`,
    fallbackCurrency: "USD",
  };

  test("Q-1 hidden: no '3 left'", () => {
    const json = mount(<QuantityRow {...rowProps} hideRemainingCount />);
    expect(json).not.toContain("left");
  });

  test("Q-2 default: '3 left' still renders", () => {
    const json = mount(<QuantityRow {...rowProps} />);
    expect(json).toContain("left");
  });
});

// ── H — the buyer-web / Business in-app host ────────────────────────────────
describe("#3314 H — PublicEventPage resolves the setting the bundle drops", () => {
  const renderPage = (event: LiveEvent = makeLiveEvent()): string =>
    mount(<PublicEventPage event={event} brand={BRAND} bookable />);

  test("H-1 social proof still loading: no count anywhere (phone)", () => {
    mockSocialProof = undefined;
    const json = renderPage();
    expect(json).not.toContain("60 tickets left");
    expect(json).not.toContain("60 available");
  });

  test("H-2 organiser hid it (server says so): no count (phone)", () => {
    mockSocialProof = { hideRemainingCount: true, goingCount: 0, sample: [] };
    const json = renderPage();
    expect(json).not.toContain("60 tickets left");
    expect(json).not.toContain("60 available");
  });

  test("H-3 organiser allows it: the count renders", () => {
    mockSocialProof = { hideRemainingCount: false, goingCount: 0, sample: [] };
    const json = renderPage();
    expect(json).toContain("60 tickets left");
    expect(json).toContain("60 available");
  });

  test("H-4 desktop sticky panel respects it too", () => {
    mockWidth = 1440;
    mockSocialProof = { hideRemainingCount: true, goingCount: 0, sample: [] };
    const hidden = renderPage();
    expect(hidden).not.toContain("60 tickets left");
    expect(hidden).not.toContain("60 available");
  });

  test("H-5 a read that carries the real setting (true) hides it even if proof says allow", () => {
    mockSocialProof = { hideRemainingCount: false, goingCount: 0, sample: [] };
    const json = renderPage(makeLiveEvent({ hideRemainingCount: true }));
    expect(json).not.toContain("60 tickets left");
  });
});

// ── P — the organiser preview shows what guests will see ────────────────────
describe("#3314 P — the Business draft preview carries the organiser's setting", () => {
  const draft = (hideRemainingCount: boolean): DraftEvent =>
    ({
      id: "event-preview",
      brandId: "brand-1",
      serverSlug: "preview-event",
      name: "Preview event",
      description: "Buyer preview",
      format: "in_person",
      partyTypes: [],
      vibeTags: [],
      musicGenres: [],
      whenMode: "single",
      date: "2026-09-22",
      doorsOpen: "19:00",
      endsAt: "23:00",
      endsAtUtc: null,
      timezone: "UTC",
      recurrenceRule: null,
      multiDates: [],
      venueName: "Venue",
      address: "Address",
      onlineUrl: null,
      city: "London",
      locationGeo: null,
      hideAddressUntilTicket: false,
      coverHue: 25,
      coverMediaUrl: null,
      coverMediaType: null,
      coverMediaProvider: null,
      coverMediaCredit: null,
      currency: "USD",
      tickets: [],
      hideRemainingCount,
    }) as unknown as DraftEvent;

  test("P-1 hidden in the draft ⇒ hidden in the preview; allowed ⇒ allowed", () => {
    expect(draftEventBuyerPreview(draft(true), null).event.hideRemainingCount).toBe(
      true,
    );
    expect(
      draftEventBuyerPreview(draft(false), null).event.hideRemainingCount,
    ).toBe(false);
  });
});

// ── S — hosts that cannot mount under this runner ───────────────────────────
describe("#3314 S — the remaining hosts wire the same rule", () => {
  test("S-1 buyer-web checkout passes the resolved flag to every quantity row", () => {
    const code = codeOf("mingla-business/app/checkout/[eventId]/index.tsx");
    // [TEST-MOD-APPROVED #3314] Follow-up (migration 20270704003314): the call
    // gains exactly one input, `bundleSetting`, between the two it already had.
    // Both original inputs are still pinned verbatim, in the same order; the new
    // input is pinned here and in issue_3314_bundle_hide_remaining.implementor.
    expect(code).toMatch(
      /resolveHideRemainingCount\(\{\s*organiserSetting: event\?\.hideRemainingCount === true \? true : null,\s*bundleSetting: publicEventQuery\.data\?\.hideRemainingCount \?\? null,\s*socialProof: cachedSocialProof,\s*\}\)/,
    );
    // It reads the entry the event page's social-proof query wrote: the key
    // literal must stay equal to `socialProofKeys.summary(eventId)`.
    expect(code).toMatch(/getQueryData<[^>]*>\(\[\s*"socialProof",\s*eventId,\s*\]\)/);
    const keys = codeOf("mingla-business/src/services/socialProofService.ts");
    expect(keys).toContain('all: ["socialProof"] as const');
    expect(keys).toContain("summary: (eventId: string) => [...socialProofKeys.all, eventId] as const");
    expect(code).toMatch(/<QuantityRow[^>]*hideRemainingCount=\{hideRemainingCount\}/);
    const wrapper = codeOf("mingla-business/src/components/checkout/QuantityRow.tsx");
    expect(wrapper).toContain("hideRemainingCount={hideRemainingCount}");
  });

  test("S-2 the Explorer event screen resolves fail-closed and feeds body + cart", () => {
    const code = codeOf(
      "app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx",
    );
    // [TEST-MOD-APPROVED #3314] Follow-up (migration 20270704003314): the screen
    // now reads the id-checked bundle answer first. The #3360 property this line
    // pinned — unknown (loading or no summary) hides the count — is kept by the
    // final clause, and "any hide wins" is added. Pinned in full in
    // issue_3314_bundle_hide_remaining.implementor (S-4).
    expect(code).toMatch(
      /const hideRemainingCount =\s*bundleHideRemainingCount === true \|\|\s*socialProofQuery\.data\?\.hideRemainingCount === true \|\|\s*\(bundleHideRemainingCount !== false &&\s*socialProofQuery\.data\?\.hideRemainingCount !== false\);/,
    );
    // Both branches of the body's event (deck seed and direct bundle) carry it.
    const bodyEvent = code.slice(
      code.indexOf("const publicEventForBody"),
      code.indexOf("const canonicalLifecycleReady"),
    );
    expect(bodyEvent.match(/hideRemainingCount,/g)).toHaveLength(2);
    expect(code).toMatch(
      /<TicketCartSheet[\s\S]*?hideRemainingCount=\{hideRemainingCount\}[\s\S]*?\/>/,
    );
    const cart = codeOf(
      "app-mobile/src/components/expandedCard/TicketCartSheet.tsx",
    );
    expect(cart).toMatch(/<QuantityRow[\s\S]*?hideRemainingCount=\{hideRemainingCount\}/);
  });

  test("S-3 the legacy cancelled/password page reads the flag", () => {
    const code = codeOf("packages/offering-rendering/PublicEventPage.tsx");
    expect(code).toContain(
      "hideRemainingCount={event.hideRemainingCount === true}",
    );
    expect(code).toMatch(
      /ticketAvailabilityCaption\(\s*ticket,\s*hideRemainingCount,\s*false,\s*\)/,
    );
  });
});
