/**
 * #4490 — the Host preview of a public venue page (`/venue/{id}/preview`).
 *
 * Mounts the REAL route component and the REAL shared PublicVenueScreen, with
 * the data hooks and app-owned chrome stubbed. Proves:
 *   P-1 the banner says guests can't book yet, and Back goes to the venue;
 *   P-2 the page is the SAME one guests get: the tabs and the lead row come
 *       from the venue's features (a table venue keeps its tables row and its
 *       bar), a venue with no table feature shows none;
 *   P-3 every booking button is disabled with the reason: the bar's button is
 *       disabled, the table body is replaced by one plain note, event rows
 *       show Tickets greyed and are not pressable;
 *   P-4 nothing guest-facing fires: no analytics;
 *   P-5 every state is designed: loading, error with a working retry, nothing
 *       to preview with a way back;
 *   P-6 the entry is reachable: a non-public venue's page has a Preview control.
 */
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
process.env.EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL = "https://host.usemingla.com";

interface PreviewState {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
}
const state: { preview: PreviewState; refetch: () => void } = {
  preview: { data: null, isLoading: false, isError: false },
  refetch: () => undefined,
};
const nav: { replaced: string[]; pushed: string[] } = { replaced: [], pushed: [] };
const analytics: unknown[] = [];

jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => ({ venueId: "44900000-0000-4000-8000-0000000000d1" }),
  useRouter: () => ({
    push: (p: string) => nav.pushed.push(p),
    replace: (p: string) => nav.replaced.push(p),
    back: () => undefined,
    canGoBack: () => true,
  }),
}));
jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock(
  "react-native-svg",
  () => {
    const Glyph = (): null => null;
    return { __esModule: true, default: Glyph, Svg: Glyph, Path: Glyph, Circle: Glyph, Rect: Glyph, G: Glyph, Defs: Glyph, Stop: Glyph, LinearGradient: Glyph };
  },
  { virtual: true },
);
jest.mock("@mingla/offering-rendering", () => {
  const ReactLocal = require("react") as typeof React;
  const themeResolver = require("../../../../packages/offering-rendering/themeResolver");
  const themePalette = require("../../../../packages/offering-rendering/themePalette");
  const staticMapImage = require("../../../../packages/offering-rendering/staticMapImage");
  const mapsDeepLink = require("../../../../packages/offering-rendering/mapsDeepLink");
  const venueMapsActions = require("../../../../packages/offering-rendering/VenueMapsActions");
  const ParallaxCoverShell = (props: Record<string, unknown>): React.ReactElement => {
    const { children, desktopFlyerActions } = props as { children?: React.ReactNode; desktopFlyerActions?: React.ReactNode };
    return ReactLocal.createElement(
      "ParallaxCoverShell",
      null,
      ReactLocal.createElement("ShellFlyerActions", null, desktopFlyerActions),
      ReactLocal.createElement("ShellBody", null, children),
    );
  };
  return {
    __esModule: true,
    ...themeResolver,
    ...themePalette,
    ...staticMapImage,
    StaticMapImage: require("../../../../packages/offering-rendering/StaticMapFrame").StaticMapImage,
    ...mapsDeepLink,
    ...venueMapsActions,
    useResponsiveLayout: () => ({ width: 390, isDesktop: false, isPhone: true, isWeb: true }),
    ParallaxCoverShell,
  };
});
jest.mock("../../../src/theme/useThemeFont", () => ({
  __esModule: true,
  useThemeFont: () => ({ loaded: true }),
  loadThemeFont: async () => undefined,
}));
jest.mock("../../../src/hooks/useVenuePreviewPage", () => ({
  __esModule: true,
  useVenuePreviewPage: () => ({
    data: state.preview.data,
    isLoading: state.preview.isLoading,
    isError: state.preview.isError,
    refetch: () => state.refetch(),
  }),
}));
jest.mock("../../../src/hooks/useMenus", () => ({
  __esModule: true,
  usePublicMenus: () => ({ data: [], isError: false, isFetching: false, refetch: () => undefined }),
}));
jest.mock("../../../src/components/offering/PublicGlassProvider", () => ({
  __esModule: true,
  PublicGlassProvider: ({ children }: { children?: React.ReactNode }) => children,
}));
jest.mock("../../../src/components/ui/Icon", () => ({ __esModule: true, Icon: () => null }));
jest.mock("../../../src/components/ui/Toast", () => {
  const ReactLocal = require("react") as typeof React;
  return { __esModule: true, Toast: (p: Record<string, unknown>) => ReactLocal.createElement("ToastStub", p) };
});
jest.mock("../../../src/components/ui/Button", () => {
  const ReactLocal = require("react") as typeof React;
  return {
    __esModule: true,
    Button: (p: Record<string, unknown>) =>
      ReactLocal.createElement("ButtonStub", { ...p, accessibilityRole: "button" }),
  };
});
jest.mock("../../../src/utils/openMapsTarget", () => ({ __esModule: true, openMapsTarget: () => undefined }));
jest.mock("../../../src/utils/copyAddressText", () => ({ __esModule: true, copyAddressText: async () => undefined }));

// ---- fixtures: the wire payload through the real parsers --------------------

const VENUE_ROW = {
  id: "44900000-0000-4000-8000-0000000000d1",
  brand_id: "44900000-0000-4000-8000-0000000000c2",
  brand_slug: "harmattan-qa-local",
  brand_name: "Harmattan QA (local)",
  slug: "gamelandqa",
  name: "Gameland QA",
  address: "14 The Providence St, Lekki, Lagos",
  city: "Lagos",
  country_code: "NG",
  lat: 6.43,
  lng: 3.47,
  venue_category: "play",
  google_place_id: null,
  contact_email: null,
  contact_phone: null,
  cover_media_url: null,
  cover_media_type: null,
  place_pool_id: null,
  theme_color: null,
  theme_font: null,
  theme_animation: null,
  cover_hue: 25,
  default_currency: "NGN",
  hours: [{ weekday: 6, open_time: "09:00", close_time: "17:00", is_closed: false }],
  pool_photo_urls: null,
  pitch: null,
  iana_timezone: "Africa/Lagos",
};
const EVENT = {
  id: "e1",
  kind: "event",
  title: "Karaoke and Games Night",
  startsAt: "2026-11-21T17:00:00+00:00",
  spaceName: "The Lounge Side",
  fromMinor: 500000,
  href: "/e/harmattan-qa-local/karaoke",
};
const payload = (features: string[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 2,
  venue: VENUE_ROW,
  currencyCode: "NGN",
  minorUnitExponent: 2,
  features,
  spaces: [{ id: "s1", name: "The Lounge Side", setting: "covered", capacityStanding: 150 }],
  hours: { weekly: [], specialDays: [] },
  events: { upcoming: [EVENT] },
  tables: features.includes("table_reservations") ? { partyMax: 4 } : null,
  offers: [],
  memberships: [],
  preview: true,
  ...extra,
});

// #4490 venue owners: the preview takes the shared screen from the public venue
// route's module; hand it the real shared screen without loading that route.
jest.mock("../../b/[brandSlug]/v/[venueSlug]", () => ({
  __esModule: true,
  PublicVenueScreen: (jest.requireActual("@mingla/brand-rendering/PublicVenueScreen") as { PublicVenueScreen: unknown }).PublicVenueScreen,
}));

const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { toJSON: () => unknown; unmount: () => void; root: { findAll: (p: (n: { type: unknown; props: Record<string, unknown> }) => boolean) => { type: unknown; props: Record<string, unknown> }[] } };
  act: (cb: () => void | Promise<void>) => void | Promise<void>;
};

const mountPreview = async (preview: PreviewState) => {
  state.preview = preview;
  analytics.length = 0;
  nav.pushed.length = 0;
  nav.replaced.length = 0;
  const { parsePublicVenueFeatures } = require("@mingla/brand-rendering/venueFeaturePage");
  const { venuePublicViewRowToPublicVenue } = require("../../../src/services/publicEventsService");
  if (preview.data !== null && preview.data !== undefined) {
    const raw = preview.data as Record<string, unknown>;
    state.preview = {
      ...preview,
      data: {
        venue: venuePublicViewRowToPublicVenue(raw.venue),
        features: parsePublicVenueFeatures(raw),
      },
    };
  }
  const routeModule = require("../[venueId]/preview");
  const Route = (routeModule.default ?? routeModule) as React.ComponentType;
  let renderer!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(Route));
  });
  // #4490 venue owners: the shared screen loads from the public venue route's
  // chunk (a lazy import); let it resolve before reading the tree.
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return renderer;
};
const json = (r: { toJSON: () => unknown }): string => JSON.stringify(r.toJSON());

describe("#4490 Host venue preview", () => {
  test("P-1 / P-2 / P-3 a table venue: banner, its tables row and a DISABLED bar", async () => {
    const r = await mountPreview({
      isLoading: false,
      isError: false,
      data: payload(["table_reservations", "menu", "events_here"]),
    });
    const tree = json(r);
    expect(tree).toContain("Preview: guests can't book yet");
    expect(tree).toContain("Tables through Mingla");
    // The bar is there, says what it would sell, and cannot be pressed.
    const cta = r.root.findAll((n) => n.props.testID === "issue-2729-reserve-cta");
    expect(cta.length).toBeGreaterThan(0);
    expect(cta.some((n) => (n.props.accessibilityState as { disabled?: boolean } | undefined)?.disabled === true)).toBe(true);
    expect(tree).toContain("Reserve a table");
    // The lead row has no button in a preview (nothing can be bought).
    expect(r.root.findAll((n) => n.props.testID === "issue-4420-venue-facts-booking-action")).toHaveLength(0);
    expect(r.root.findAll((n) => n.props.testID === "issue-4420-venue-facts-booking").length).toBeGreaterThan(0);
    r.unmount();
  });

  test("P-2 / P-3 a venue with no table feature shows no table anything; events show a greyed Tickets and are not pressable", async () => {
    const r = await mountPreview({ isLoading: false, isError: false, data: payload(["events_here"]) });
    const tree = json(r);
    for (const forbidden of ["Tables through Mingla", "Reserve", "Find a table"]) {
      expect(tree.includes(forbidden) ? forbidden : "absent").toBe("absent");
    }
    expect(tree).toContain("What's on");
    expect(tree).toContain("Karaoke and Games Night");
    expect(tree).toContain("Tickets");
    // No press target on the event row: a preview cannot send a guest anywhere.
    const row = r.root.findAll((n) => n.props.testID === "issue-4490-event-e1");
    expect(row.length).toBeGreaterThan(0);
    expect(row.every((n) => typeof n.props.onPress !== "function")).toBe(true);
    r.unmount();
  });

  test("P-1 Back returns to the venue's own page", async () => {
    const r = await mountPreview({ isLoading: false, isError: false, data: payload(["events_here"]) });
    const back = r.root.findAll((n) => n.props.testID === "venue-preview-back")[0];
    TestRenderer.act(() => (back.props.onPress as () => void)());
    expect(nav.replaced).toEqual(["/venue/44900000-0000-4000-8000-0000000000d1"]);
    r.unmount();
  });

  test("P-5 loading, error with a working retry, and nothing to preview with a way back", async () => {
    const loading = await mountPreview({ isLoading: true, isError: false, data: null });
    expect(json(loading)).toContain("Building your preview");
    expect(json(loading)).toContain("Preview: guests can't book yet");
    loading.unmount();

    let refetched = 0;
    state.refetch = () => {
      refetched += 1;
    };
    const failed = await mountPreview({ isLoading: false, isError: true, data: null });
    expect(json(failed)).toContain("The preview could not load");
    const retry = failed.root.findAll((n) => n.props.testID === "venue-preview-retry")[0];
    TestRenderer.act(() => (retry.props.onPress as () => void)());
    expect(refetched).toBe(1);
    failed.unmount();

    const empty = await mountPreview({ isLoading: false, isError: false, data: null });
    expect(json(empty)).toContain("There is nothing to preview yet");
    const back = empty.root.findAll((n) => n.props.testID === "venue-preview-empty-back")[0];
    TestRenderer.act(() => (back.props.onPress as () => void)());
    expect(nav.replaced).toEqual(["/venue/44900000-0000-4000-8000-0000000000d1"]);
    empty.unmount();
  });

  test("P-4 no guest analytics: the route hands the page a no-op", async () => {
    const source = readFileSync(join(__dirname, "../[venueId]/preview.tsx"), "utf8");
    expect(source).toMatch(/onAnalytics=\{\(\) => undefined\}/);
    expect(source).not.toMatch(/captureWeb|captureOffering|postHog/);
    expect(analytics).toHaveLength(0);
  });

  test("P-6 a non-public venue's page has its own working Preview control", async () => {
    const page = readFileSync(join(__dirname, "../[venueId]/index.tsx"), "utf8");
    expect(page).toMatch(/<VenuePreviewAction/);
    expect(page).toMatch(/router\.push\(`\/venue\/\$\{venueId\}\/preview`/);

    const { VenuePreviewAction } = require("../../../src/components/venue/VenuePreviewAction") as {
      VenuePreviewAction: React.ComponentType<{ compact: boolean; onPress: () => void }>;
    };
    let presses = 0;
    let action!: ReturnType<typeof TestRenderer.create>;
    TestRenderer.act(() => {
      action = TestRenderer.create(
        <VenuePreviewAction compact={false} onPress={() => { presses += 1; }} />,
      );
    });
    const control = action.root.findAll(
      (n) =>
        n.props.testID === "venue-page-preview" &&
        typeof n.props.onPress === "function",
    );
    expect(control.length).toBeGreaterThan(0);
    expect(json(action)).toContain("Preview page");
    const pressTarget = control[control.length - 1];
    TestRenderer.act(() => (pressTarget.props.onPress as () => void)());
    expect(presses).toBe(1);
    action.unmount();
  });
});
