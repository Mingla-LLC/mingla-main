/**
 * #3393 umbrella — venue page fixes found while preparing the venue tutorials.
 *
 *   #3385 — "Save changes" on deck readiness returns to the venue (never the
 *           Events tab), and the venue page says "Changes saved" exactly once.
 *   #3389 — `?module=<id>` opens that module for every venue module, not just
 *           Insights and Orders.
 *
 * Mounts the REAL `app/venue/deck-readiness.tsx` and the REAL
 * `app/venue/[venueId]/index.tsx` under the stock config with a bare
 * react-test-renderer harness (the #1685 route-test shape). Children that do
 * their own fetching are replaced by prop-capturing stubs, so what is asserted
 * is exactly what each route hands them.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// ── navigation harness ───────────────────────────────────────────────────────
const nav: { params: Record<string, string>; canGoBack: boolean } = {
  params: {},
  canGoBack: true,
};
const mockBack = jest.fn();
const mockReplace = jest.fn((_href: string) => undefined);
const mockPush = jest.fn((_href: string) => undefined);

jest.mock("expo-router", () => ({
  __esModule: true,
  useLocalSearchParams: () => nav.params,
  useRouter: () => ({
    back: () => mockBack(),
    push: (href: string) => mockPush(href),
    replace: (href: string) => mockReplace(href),
    canGoBack: () => nav.canGoBack,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../../src/context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({ isAuthReady: true, user: { id: "user-3393" } }),
}));

const VENUE = {
  id: "venue-3393",
  brandId: "brand-3393",
  placePoolId: "place-3393",
  slug: "rooftop",
  name: "Rooftop Kitchen",
  address: "1 Main St",
  city: "Raleigh",
  countryCode: "US",
  venueCategory: "restaurant",
  coverMediaUrl: null,
  coverMediaPosterUrl: null,
  coverMediaType: null,
  claimStatus: "pending_review",
  claimFollowUpAt: null,
  rejectionReason: null,
  createdAt: "2026-09-15T00:00:00.000Z",
};

jest.mock("../../../src/hooks/useVenueListings", () => ({
  __esModule: true,
  useVenueListing: () => ({ data: VENUE, isLoading: false }),
}));

jest.mock("../../../src/hooks/useBrandPlacePipelineState", () => ({
  __esModule: true,
  useBrandPlaceAuthoringContext: () => ({
    isLoading: false,
    data: {
      tier2: {},
      pending_ai_outputs: null,
      coaching: [],
      cover_media_url: null,
      cover_media_poster_url: null,
      cover_media_type: null,
      gallery_urls: [],
    },
  }),
  useVenuePipelineState: () => ({ data: null }),
}));

const captured: {
  deckProps: Record<string, unknown> | null;
  shellProps: Record<string, unknown> | null;
  toastProps: Record<string, unknown> | null;
} = { deckProps: null, shellProps: null, toastProps: null };

jest.mock("../../../src/components/venue/VenueDeckReadinessSetup", () => ({
  __esModule: true,
  VenueDeckReadinessSetup: (props: Record<string, unknown>) => {
    captured.deckProps = props;
    return null;
  },
}));

jest.mock("../../../src/components/venue/VenueSuiteShell", () => ({
  __esModule: true,
  VenueSuiteShell: (props: Record<string, unknown>) => {
    captured.shellProps = props;
    return null;
  },
}));

jest.mock("../../../src/components/ui/Toast", () => ({
  __esModule: true,
  Toast: (props: Record<string, unknown>) => {
    captured.toastProps = props;
    return null;
  },
}));

const mockNullComponent = (name: string) => ({
  __esModule: true,
  [name]: () => null,
  default: () => null,
});

jest.mock("../../../src/components/ui/IconChrome", () => mockNullComponent("IconChrome"));
jest.mock("../../../src/components/ui/Button", () => mockNullComponent("Button"));
jest.mock("../../../src/components/ui/TopBar", () => mockNullComponent("TopBar"));
jest.mock("../../../src/components/ui/ShareModal", () => mockNullComponent("ShareModal"));
jest.mock("../../../src/components/brand/VenueClaimFeedbackSheet", () =>
  mockNullComponent("VenueClaimFeedbackSheet"),
);
jest.mock("../../../src/components/brand/VenueClaimStatusBanner", () =>
  mockNullComponent("VenueClaimStatusBanner"),
);
jest.mock("../../../src/components/stay/StaySuiteShell", () => mockNullComponent("StaySuiteShell"));
jest.mock("../../../src/components/venue/VenueIdentityBand", () =>
  mockNullComponent("VenueIdentityBand"),
);
jest.mock("../../../src/components/venue/VenueModulePillRow", () =>
  mockNullComponent("VenueModulePillRow"),
);
jest.mock(
  "../../../src/components/venue/PendingVenueIdentityCorrectionLauncher",
  () => mockNullComponent("PendingVenueIdentityCorrectionLauncher"),
  // #2099 — extensionless on purpose (Metro picks .web/.native); jest has no
  // such file, so the stub is registered virtually at that exact path.
  { virtual: true },
);
jest.mock("../../../src/components/auth/SignedInNotFoundNotice", () =>
  mockNullComponent("SignedInNotFoundNotice"),
);
jest.mock("../../../src/hooks/useSwitchAccount", () => ({
  __esModule: true,
  useSwitchAccount: () => ({ signedInEmail: null, onSwitchAccount: () => undefined }),
}));
jest.mock("../../../src/hooks/useBrands", () => ({
  __esModule: true,
  useBrand: () => ({ data: { id: "brand-3393", slug: "brand" } }),
}));
jest.mock("../../../src/hooks/useResponsiveLayout", () => ({
  __esModule: true,
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));
jest.mock("../../../src/hooks/useVenueClaimFeedback", () => ({
  __esModule: true,
  useVenueClaimOpenCount: () => 0,
}));
jest.mock("../../../src/services/guestFunnelLink", () => ({
  __esModule: true,
  openExternal: () => undefined,
}));
jest.mock("../../../src/hooks/useBusinessRecent", () => ({
  __esModule: true,
  useSuccessfulBusinessRecentOpen: () => undefined,
}));
jest.mock("../../../src/constants/publicUrls", () => ({
  __esModule: true,
  venuePublicPath: () => "/b/brand/v/rooftop",
  venuePublicUrl: () => "https://business.usemingla.com/b/brand/v/rooftop",
}));

import { useVenueSuiteStore } from "../../../src/store/venueSuiteStore";
import VenueDeckReadinessRoute from "../deck-readiness";
import VenueManagementPage from "../[venueId]/index";

const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { unmount: () => void };
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

async function mount(element: React.ReactElement): Promise<{ unmount: () => void }> {
  let tree!: { unmount: () => void };
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

async function saveFromDeckReadiness(): Promise<void> {
  const tree = await mount(<VenueDeckReadinessRoute />);
  const onDone = captured.deckProps?.onDone;
  if (typeof onDone !== "function") throw new Error("deck readiness onDone not wired");
  await TestRenderer.act(async () => {
    (onDone as () => void)();
  });
  await TestRenderer.act(async () => {
    tree.unmount();
  });
}

beforeEach(() => {
  nav.params = {};
  nav.canGoBack = true;
  mockBack.mockClear();
  mockReplace.mockClear();
  mockPush.mockClear();
  captured.deckProps = null;
  captured.shellProps = null;
  captured.toastProps = null;
  useVenueSuiteStore.setState({ savedFlash: null });
});

// ── #3385 ────────────────────────────────────────────────────────────────────

describe("#3385 — Save changes on deck readiness returns to the venue", () => {
  test("opened from the venue page: goes BACK to it and leaves a saved flash", async () => {
    nav.params = {
      brand_id: "brand-3393",
      venue_id: "venue-3393",
      place_pool_id: "place-3393",
      from: "venue",
    };
    await saveFromDeckReadiness();
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(useVenueSuiteStore.getState().savedFlash).toMatchObject({
      venueId: "venue-3393",
      message: "Changes saved",
    });
  });

  test("opened from anywhere else: opens the venue's Settings, never Events", async () => {
    nav.params = {
      brand_id: "brand-3393",
      venue_id: "venue-3393",
      place_pool_id: "place-3393",
    };
    await saveFromDeckReadiness();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/venue/venue-3393?module=settings");
    for (const [href] of mockReplace.mock.calls) {
      expect(href).not.toContain("hub/events");
    }
  });

  test("from=venue but no history (a refreshed web tab): opens the venue, not Events", async () => {
    nav.params = {
      brand_id: "brand-3393",
      venue_id: "venue-3393",
      place_pool_id: "place-3393",
      from: "venue",
    };
    nav.canGoBack = false;
    await saveFromDeckReadiness();
    expect(mockReplace).toHaveBeenCalledWith("/venue/venue-3393?module=settings");
  });

  test("the venue page shows the saved flash once, for its own venue only", async () => {
    useVenueSuiteStore
      .getState()
      .setSavedFlash("venue-3393", "Changes saved", Date.now());
    nav.params = { venueId: "venue-3393" };
    const tree = await mount(<VenueManagementPage />);
    expect(captured.toastProps).toMatchObject({
      visible: true,
      kind: "success",
      message: "Changes saved",
    });
    expect(useVenueSuiteStore.getState().savedFlash).toBeNull();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a flash for a different venue is not shown on this one", async () => {
    useVenueSuiteStore
      .getState()
      .setSavedFlash("venue-other", "Changes saved", Date.now());
    nav.params = { venueId: "venue-3393" };
    const tree = await mount(<VenueManagementPage />);
    expect(captured.toastProps).toMatchObject({ visible: false });
    await TestRenderer.act(async () => tree.unmount());
  });

  test("a stale flash is dropped instead of shown", async () => {
    useVenueSuiteStore
      .getState()
      .setSavedFlash("venue-3393", "Changes saved", Date.now() - 60_000);
    nav.params = { venueId: "venue-3393" };
    const tree = await mount(<VenueManagementPage />);
    expect(captured.toastProps).toMatchObject({ visible: false });
    expect(useVenueSuiteStore.getState().savedFlash).toBeNull();
    await TestRenderer.act(async () => tree.unmount());
  });
});

// ── #3389 ────────────────────────────────────────────────────────────────────

describe("#3389 — ?module= opens every venue module", () => {
  const cases: Array<[string | undefined, string]> = [
    ["tables", "tables"],
    ["menu", "menu"],
    ["availability", "availability"],
    ["reservations", "reservations"],
    ["waitlist", "waitlist"],
    ["settings", "settings"],
    ["insights", "insights"],
    ["orders", "orders"],
    ["overview", "overview"],
    ["Tables", "overview"],
    ["not-a-module", "overview"],
    ["", "overview"],
    [undefined, "overview"],
  ];
  test.each(cases)("?module=%s lands on %s", async (moduleParam, expected) => {
    nav.params =
      moduleParam === undefined
        ? { venueId: "venue-3393" }
        : { venueId: "venue-3393", module: moduleParam };
    const tree = await mount(<VenueManagementPage />);
    expect(captured.shellProps).toMatchObject({
      venueId: "venue-3393",
      initialModule: expected,
    });
    await TestRenderer.act(async () => tree.unmount());
  });
});
