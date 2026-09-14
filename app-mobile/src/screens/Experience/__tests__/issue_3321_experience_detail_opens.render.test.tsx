/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Issue #3321 — opening an experience in the Explorer app must not crash.
 *
 * This MOUNTS the real ConsumerExperienceDetailScreen and runs its whole render
 * body. Every source-string suite beside it stayed green while the screen threw
 * on every open, because none of them executes the component:
 *
 *   1. #2774 read `detail.title` / `detail.coverMediaType` / `detail.coverMediaAlt`
 *      in a file that declares no `detail` → ReferenceError on the first render
 *      past the seed + ticket-loading guards.
 *   2. #1708 put `useState` / `useEffect` / `useMemo` BELOW the ticket-loading
 *      early return → the loading → loaded re-render calls more hooks than the
 *      render before it → React throws "Rendered more hooks than during the
 *      previous render". The ReferenceError hid it; fixing only (1) exposes it.
 *
 * Only the screen's collaborators are stubbed (sheet host, shared components,
 * data hooks, services). The hero label builder is the REAL shared one, so the
 * name assertions read the exact string a screen reader gets.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs (the #1486 render step).
 */
import React from "react";

// @ts-expect-error react-test-renderer ships without declarations here.
import type { ReactTestRenderer } from "react-test-renderer";

const TestRenderer =
  // @ts-expect-error react-test-renderer ships without declarations here.
  require("react-test-renderer") as typeof import("react-test-renderer");

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

type Row = Record<string, unknown>;

const mockState: {
  tickets: { data: Row[] | undefined; isLoading: boolean };
  freshDetail: Row | null;
} = {
  tickets: { data: [], isLoading: false },
  freshDetail: null,
};

jest.mock("react-native", () => {
  const React = require("react");
  const host =
    (name: string) =>
    (props: { children?: unknown }) =>
      React.createElement(name, props, props.children ?? null);
  return {
    __esModule: true,
    ActivityIndicator: host("ActivityIndicator"),
    Pressable: host("Pressable"),
    Text: host("Text"),
    View: host("View"),
    AccessibilityInfo: { announceForAccessibilityWithOptions: () => undefined },
    Platform: { OS: "ios", select: (o: Row) => o.ios ?? o.default },
    StyleSheet: {
      create: <T,>(styles: T): T => styles,
      absoluteFillObject: {},
    },
  };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("expo-haptics", () => ({
  impactAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Error: "error" },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isSuccess: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: () => undefined }),
}));
jest.mock("@mingla/offering-rendering", () => {
  const React = require("react");
  const nothing = () => null;
  return {
    // THE REAL builder — the label under test is the shipped string.
    buildHeroMediaAccessibleLabel: jest.requireActual(
      "../../../../../packages/offering-rendering/heroMediaAccessibility",
    ).buildHeroMediaAccessibleLabel,
    EventCoverMedia: (props: Row) =>
      React.createElement("mock-event-cover-media", props),
    // The real pager mounts `coverNode` as page zero; render it so the primary
    // cover stays findable in gallery mode too.
    CoverGalleryPager: (props: { coverNode?: unknown }) =>
      React.createElement("mock-cover-gallery-pager", props, props.coverNode),
    CoverGalleryRow: nothing,
    ExperienceOfferingBody: nothing,
    OfferingChrome: nothing,
    ThemeEntranceAnimation: nothing,
    TripReserveBar: nothing,
    boldFontFamily: () => "System",
    computeOfferingVariant: () => "paid",
    createThemePalette: () => ({
      accent: "#f60",
      accentWash: "#210",
      page: "#111",
      panelBorder: "#222",
      primaryText: "#fff",
      tertiaryText: "#aaa",
    }),
    isOpenDailyExperience: () => false,
    offeringSurfaceStyles: () => ({}),
    resolveOfferingCta: () => ({
      kind: "buy",
      title: "Reserve",
      subline: null,
      tappable: true,
    }),
    resolveTheme: () => ({ fontFamilyValue: "System" }),
    useResponsiveLayout: () => ({ isDesktop: false }),
  };
});
jest.mock("../../../hooks/useConsumerExperienceOfferingData", () => ({
  buildExperienceOfferingDataFromSeed: () => ({ openDaily: false }),
  buildExperienceOfferingBrandFromSeed: () => ({}),
}));
jest.mock("../../../hooks/useConsumerExperienceDetail", () => ({
  useConsumerExperienceDetail: () => ({
    detail: mockState.freshDetail,
    isLoading: false,
    isError: false,
    refetch: () => undefined,
  }),
}));
jest.mock("../../../hooks/usePublicEventTickets", () => ({
  usePublicEventTickets: () => mockState.tickets,
}));
jest.mock("../../../hooks/useEventTheme", () => ({
  useEventTheme: () => ({ data: undefined }),
}));
jest.mock("../../../hooks/queryKeys", () => ({
  circleKeys: { all: ["circle"] },
  socialProofKeys: { summary: (id: string) => ["socialProof", id] },
}));
jest.mock("../../../components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../components/ui/BaseBottomSheet", () => {
  const React = require("react");
  return {
    BaseBottomSheet: (props: { children?: unknown }) =>
      React.createElement("mock-sheet", props, props.children ?? null),
    BottomSheetScrollView: (props: { children?: unknown }) =>
      React.createElement("mock-sheet-scroll", props, props.children ?? null),
  };
});
jest.mock("../../../components/EventGuestListSheet", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../../../components/profile/ViewFriendProfileScreen", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../../../services/deepLinkService", () => ({
  hasOpenDirectMessageSink: () => false,
  openDirectMessageInApp: () => undefined,
}));
jest.mock("../../../components/expandedCard/TicketCartSheet", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../../../components/expandedCard/ExperienceOccurrencePicker", () => ({
  ExperienceOccurrencePicker: () => null,
}));
jest.mock("../../../components/expandedCard/ExperienceReservePicker", () => ({
  ExperienceReservePicker: () => null,
}));
jest.mock("../../../theme/useConsumerThemeFont", () => ({
  useConsumerThemeFont: () => undefined,
}));
jest.mock("../../../services/socialProofService", () => ({
  fetchSocialProof: () => Promise.resolve(null),
}));
jest.mock("../../../services/postHogService", () => ({
  postHogService: { capture: () => undefined },
}));
jest.mock("../../../payments/nativeCheckoutFlow", () => ({
  useNativeCheckoutFlow: () => () => Promise.resolve({ outcome: "canceled" }),
}));
jest.mock("../../../components/ui/Toast", () => ({
  toastManager: { show: () => undefined },
}));
jest.mock("../../../store/appStore", () => ({
  useAppStore: (select: (s: Row) => unknown) =>
    select({ user: null, profile: null }),
}));
jest.mock("../../../services/weatherService", () => ({
  weatherService: { getWeatherForecast: () => Promise.resolve(null) },
}));
jest.mock("../../../services/contentShareAdapter", () => ({
  shareContent: () => Promise.resolve(),
}));
jest.mock("../../../utils/mutateCuratedCard", () => ({
  estimateTravelMinutes: () => 12,
  haversineKm: () => 4,
}));
jest.mock("../../../contexts/RecommendationsContext", () => ({
  useRecommendations: () => ({ userLocation: null }),
}));
jest.mock("../../../constants/designSystem", () => ({
  glass: { bottomSheet: { snapPoints: ["50%", "90%"] } },
}));
jest.mock("../../../utils/hueFromId", () => ({ hueFromId: () => 20 }));

import ConsumerExperienceDetailScreen from "../ConsumerExperienceDetailScreen";

const COVER = "https://cdn.example.test/experiences/sunset-supper/cover.mp4";

const seed = (overrides: Row = {}): Row => ({
  eventId: "experience-3321",
  brandId: "brand-3321",
  brandSlug: "supper-club",
  brandName: "Supper Club",
  brandProfilePhotoUrl: null,
  eventSlug: "sunset-supper",
  title: "Sunset Supper",
  description: null,
  coverMediaUrl: COVER,
  coverMediaType: "video",
  coverHue: 20,
  timezone: "Europe/London",
  currency: "GBP",
  venueName: null,
  address: null,
  hideAddressUntilTicket: true,
  format: "in-person",
  locationGeo: null,
  partyTypes: [],
  experienceStops: [],
  upcomingOccurrences: [],
  isRecurring: false,
  recurrenceRule: null,
  brandTheme: null,
  ...overrides,
});

const fresh = (overrides: Row = {}): Row => ({
  title: "Sunset Supper",
  coverMediaUrl: COVER,
  coverMediaType: "video",
  coverMediaAlt: "Candlelit table on a rooftop at dusk",
  coverGallery: [],
  occurrences: [],
  isRecurring: false,
  recurrenceRule: null,
  ...overrides,
});

const TICKETS_LOADED = { data: [], isLoading: false };
const TICKETS_LOADING = { data: undefined, isLoading: true };

const element = (card: Row) => (
  <ConsumerExperienceDetailScreen
    seed={card as never}
    onBack={() => undefined}
  />
);

let tree: ReactTestRenderer | null = null;

const mount = async (card: Row): Promise<ReactTestRenderer> => {
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element(card));
  });
  return tree as unknown as ReactTestRenderer;
};

const coverLabels = (renderer: ReactTestRenderer): unknown[] =>
  renderer.root
    .findAll((node: { type: unknown }) => node.type === "mock-event-cover-media")
    .map((node: { props: Row }) => node.props.accessibleLabel);

let consoleError: jest.SpyInstance;

beforeEach(() => {
  mockState.tickets = TICKETS_LOADED;
  mockState.freshDetail = null;
  // A render that throws is the failure under test; React's own console
  // report of it would only repeat the thrown error.
  consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  const current = tree as ReactTestRenderer | null;
  if (current !== null) {
    await TestRenderer.act(async () => current.unmount());
  }
  tree = null;
  consoleError.mockRestore();
});

describe("#3321 the Explorer experience detail opens", () => {
  it("renders past the seed and ticket guards when the tickets are already cached", async () => {
    const renderer = await mount(seed());

    expect(coverLabels(renderer)).toEqual([
      "Video cover 1 of 1 for Sunset Supper",
    ]);
  });

  it("survives the first open: tickets loading, then loaded, in one mounted screen", async () => {
    mockState.tickets = TICKETS_LOADING;
    const card = seed();
    const renderer = await mount(card);
    expect(coverLabels(renderer)).toEqual([]);

    mockState.tickets = TICKETS_LOADED;
    await TestRenderer.act(async () => {
      renderer.update(element(card));
    });

    expect(coverLabels(renderer)).toEqual([
      "Video cover 1 of 1 for Sunset Supper",
    ]);
  });
});

describe("#3321 the hero is named for the media it actually shows", () => {
  it("adds the fresh detail's description when it describes the cover on screen", async () => {
    mockState.freshDetail = fresh();

    const renderer = await mount(seed());

    expect(coverLabels(renderer)).toEqual([
      "Video cover 1 of 1 for Sunset Supper: Candlelit table on a rooftop at dusk",
    ]);
  });

  it("never borrows a description written for a different cover", async () => {
    mockState.freshDetail = fresh({
      coverMediaUrl: "https://cdn.example.test/experiences/sunset-supper/new.jpg",
      coverMediaType: "image",
    });

    const renderer = await mount(seed());

    expect(coverLabels(renderer)).toEqual([
      "Video cover 1 of 1 for Sunset Supper",
    ]);
  });

  it("names the title the page shows and the cover type it renders", async () => {
    mockState.freshDetail = fresh({ title: "Sunset Supper (renamed)" });

    const renderer = await mount(
      seed({ title: "Sunset Supper", coverMediaType: "image" }),
    );

    // The seed drives the heading, the sheet name and the <EventCoverMedia>
    // type, so the image hero reads "Photo" under the seed title.
    expect(coverLabels(renderer)).toEqual([
      "Photo 1 of 1 for Sunset Supper: Candlelit table on a rooftop at dusk",
    ]);
  });

  it("hands the gallery pager the same subject, cover type and description", async () => {
    mockState.freshDetail = fresh({
      // The by-slug read disagrees about the type; the pager must still name
      // page zero as the video <EventCoverMedia> is actually playing.
      coverMediaType: "image",
      coverGallery: [
        {
          url: "https://cdn.example.test/experiences/sunset-supper/terrace.jpg",
          type: "image",
          alt: "Terrace",
        },
      ],
    });

    const renderer = await mount(seed());

    const pagers = renderer.root.findAll(
      (node: { type: unknown }) => node.type === "mock-cover-gallery-pager",
    );
    expect(pagers).toHaveLength(1);
    expect(pagers[0].props.heroAccessibilitySubject).toBe("Sunset Supper");
    expect(pagers[0].props.coverMediaType).toBe("video");
    expect(pagers[0].props.coverMediaAlt).toBe(
      "Candlelit table on a rooftop at dusk",
    );
    expect(coverLabels(renderer)).toEqual([
      "Video cover 1 of 2 for Sunset Supper: Candlelit table on a rooftop at dusk",
    ]);
  });
});
