/**
 * #3393 umbrella — venue Settings and suite-shell fixes from the tutorial prep.
 *
 *   #3386 — "Edit venue details" no longer opens the BRAND page. The host is
 *           told which details they change themselves, and "Request a change"
 *           opens a prefilled email to Mingla support naming this venue.
 *   #3385 — "Edit photos & details" tells deck readiness it came from the
 *           venue (`from=venue`), so Save returns here.
 *   #3389 — the suite shell no longer bounces a `?module=tables` deep link to
 *           Overview while the reservation settings are still loading.
 *
 * The REAL VenueSettingsModule and the REAL VenueSuiteShell are mounted under
 * the stock config (bare react-test-renderer); data hooks and child modules are
 * stubs, so the assertions read exactly what the component does with them.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Linking } from "react-native";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn((_href: string) => undefined);
jest.mock("expo-router", () => ({
  __esModule: true,
  useRouter: () => ({
    push: (href: string) => mockPush(href),
    replace: () => undefined,
    back: () => undefined,
  }),
}));

jest.mock("react-native-safe-area-context", () => ({
  __esModule: true,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("../../../hooks/useCurrentBrand", () => ({
  __esModule: true,
  useCurrentBrand: () => ({
    id: "brand-3393",
    displayName: "Rooftop Group",
    defaultCurrency: "USD",
    stripeStatus: "active",
    paystackSubaccountCode: null,
  }),
}));

jest.mock("../../../hooks/useVenueListings", () => ({
  __esModule: true,
  useVenueListing: () => ({
    data: {
      id: "venue-3393",
      brandId: "brand-3393",
      placePoolId: "place-3393",
      name: "Rooftop Kitchen",
      address: "1 Main St",
      city: "Raleigh",
      venueCategory: "restaurant",
      claimStatus: "pending_review",
    },
  }),
}));

jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  __esModule: true,
  useCurrentBrandRole: () => ({ rank: 100 }),
}));

jest.mock("../../../hooks/useBrandHours", () => ({
  __esModule: true,
  useBrandHours: () => ({ data: [], isError: false }),
  useUpsertBrandHours: () => ({ mutate: () => undefined, isPending: false }),
}));

jest.mock("../../../hooks/useBrandPlacePipelineState", () => ({
  __esModule: true,
  useBrandPlaceAuthoringContext: () => ({
    data: { gallery_urls: [], ai_signal_scores: null },
  }),
}));

let mockSettingsQuery: {
  data: { reservationsEnabled: boolean } | null | undefined;
  isError: boolean;
};
jest.mock("../../../hooks/useVenueReservationSettings", () => ({
  __esModule: true,
  useVenueReservationSettings: () => mockSettingsQuery,
  useSetReservationsEnabled: () => ({ mutate: () => undefined, isPending: false }),
  useUpdateReservationFee: () => ({ mutate: () => undefined, isPending: false }),
}));

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  __esModule: true,
  useResponsiveLayout: () => ({ isWideDesktop: false }),
}));

const mockHost = (name: string) => (props: Record<string, unknown>) => {
  const ReactActual = require("react") as typeof React;
  return ReactActual.createElement(name, props, props.children as React.ReactNode);
};

jest.mock("../../ui/Button", () => ({ __esModule: true, Button: mockHost("Button") }));
jest.mock("../../ui/BrandSwitch", () => ({ __esModule: true, BrandSwitch: mockHost("BrandSwitch") }));
jest.mock("../../ui/GlassCard", () => ({ __esModule: true, GlassCard: mockHost("GlassCard") }));
jest.mock("../../ui/Input", () => ({ __esModule: true, Input: mockHost("Input") }));
jest.mock("../BrandHoursEditor", () => ({ __esModule: true, BrandHoursEditor: () => null }));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  __esModule: true,
  ScrollView: mockHost("ScrollView"),
}));
jest.mock("../../suite/SuiteDesktopShell", () => ({
  __esModule: true,
  SuiteDesktopShell: mockHost("SuiteDesktopShell"),
}));
jest.mock("../VenueAvailabilityModule", () => {
  const ReactActual = require("react") as typeof React;
  return {
    __esModule: true,
    VenueAvailabilityModule: ReactActual.forwardRef(() => null),
  };
});
jest.mock("../VenueIntelligenceModule", () => ({ __esModule: true, VenueIntelligenceModule: () => null }));
jest.mock("../VenueMenuModule", () => ({ __esModule: true, VenueMenuModule: () => null }));
jest.mock("../VenueReservationsModule", () => ({ __esModule: true, VenueReservationsModule: () => null }));
jest.mock("../VenueTablesModule", () => ({ __esModule: true, VenueTablesModule: () => null }));
jest.mock("../VenueWaitlistModule", () => ({ __esModule: true, VenueWaitlistModule: () => null }));

import { useVenueSuiteStore } from "../../../store/venueSuiteStore";
import {
  VENUE_DETAILS_SUPPORT_EMAIL,
  venueDetailsChangeRequestUrl,
} from "../venueDetailsChangeRequest";
import {
  VENUE_MODULES,
  parseVenueModuleParam,
  shouldLeaveBookingModule,
} from "../venueModules";
import { VenueSettingsModule } from "../VenueSettingsModule";
import { VenueSuiteShell } from "../VenueSuiteShell";

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Tree {
  root: TestInstance;
  update: (element: React.ReactElement) => void;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

async function mount(element: React.ReactElement): Promise<Tree> {
  let tree!: Tree;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

function byTestId(root: TestInstance, testID: string): TestInstance {
  const node = root.findAll((n) => n.props.testID === testID)[0];
  if (node === undefined) throw new Error(`missing testID ${testID}`);
  return node;
}

function flatText(node: TestInstance): string {
  const walk = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(walk).join("");
    return "";
  };
  return walk(node.props.children);
}

beforeEach(() => {
  mockPush.mockClear();
  mockSettingsQuery = { data: null, isError: false };
  useVenueSuiteStore.getState().deactivate();
});

// ── #3386 ────────────────────────────────────────────────────────────────────

describe("#3386 — Edit venue details never opens the brand page", () => {
  test("the change request is a support email that names the venue", () => {
    const url = venueDetailsChangeRequestUrl({
      venueId: "venue-3393",
      venueName: "Rooftop Kitchen",
    });
    expect(url.startsWith(`mailto:${VENUE_DETAILS_SUPPORT_EMAIL}?`)).toBe(true);
    const query = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(query.get("subject")).toBe("Change venue details: Rooftop Kitchen");
    expect(query.get("body")).toContain("Venue ID: venue-3393");
    expect(query.get("body")).toContain("Venue: Rooftop Kitchen");
  });

  test("a venue with no name still gets a readable request", () => {
    const url = venueDetailsChangeRequestUrl({ venueId: "venue-9", venueName: "  " });
    const query = new URLSearchParams(url.slice(url.indexOf("?") + 1));
    expect(query.get("subject")).toBe("Change venue details: my venue");
  });

  test("Request a change opens the email and pushes no brand route", async () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockImplementation(() => Promise.resolve(true));
    const tree = await mount(
      <VenueSettingsModule brandId="brand-3393" venueId="venue-3393" />,
    );
    const button = byTestId(tree.root, "venue-settings-edit-details");
    expect(button.props.label).toBe("Request a change");
    await TestRenderer.act(async () => {
      (button.props.onPress as () => void)();
    });
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(String(openURL.mock.calls[0][0])).toBe(
      venueDetailsChangeRequestUrl({
        venueId: "venue-3393",
        venueName: "Rooftop Kitchen",
      }),
    );
    for (const [href] of mockPush.mock.calls) {
      expect(href.startsWith("/brand/")).toBe(false);
    }
    const checked = flatText(byTestId(tree.root, "venue-settings-details-checked"));
    expect(checked).toContain(VENUE_DETAILS_SUPPORT_EMAIL);
    openURL.mockRestore();
    await TestRenderer.act(async () => tree.unmount());
  });

  test("if no mail app opens, the host is told and given the address", async () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockImplementation(() => Promise.reject(new Error("no handler")));
    const tree = await mount(
      <VenueSettingsModule brandId="brand-3393" venueId="venue-3393" />,
    );
    await TestRenderer.act(async () => {
      (byTestId(tree.root, "venue-settings-edit-details").props.onPress as () => void)();
    });
    const failure = flatText(
      byTestId(tree.root, "venue-settings-details-request-failed"),
    );
    expect(failure).toContain(VENUE_DETAILS_SUPPORT_EMAIL);
    openURL.mockRestore();
    await TestRenderer.act(async () => tree.unmount());
  });
});

// ── #3385 ────────────────────────────────────────────────────────────────────

describe("#3385 — Edit photos & details says it came from the venue", () => {
  test("the deck-readiness link carries this venue and from=venue", async () => {
    const tree = await mount(
      <VenueSettingsModule brandId="brand-3393" venueId="venue-3393" />,
    );
    await TestRenderer.act(async () => {
      (byTestId(tree.root, "venue-settings-edit-photos").props.onPress as () => void)();
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    const href = mockPush.mock.calls[0][0];
    expect(href.startsWith("/venue/deck-readiness?")).toBe(true);
    const query = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(query.get("venue_id")).toBe("venue-3393");
    expect(query.get("from")).toBe("venue");
    await TestRenderer.act(async () => tree.unmount());
  });
});

// ── #3389 ────────────────────────────────────────────────────────────────────

describe("#3389 — module deep links survive the settings load", () => {
  test("every registered module id parses; nothing else does", () => {
    for (const id of Object.keys(VENUE_MODULES)) {
      expect(parseVenueModuleParam(id)).toBe(id);
    }
    for (const bad of [null, undefined, "", "Tables", "toString", "__proto__", "hub"]) {
      expect(parseVenueModuleParam(bad)).toBeUndefined();
    }
  });

  test("a booking module is only left once settings resolve with reservations off", () => {
    expect(
      shouldLeaveBookingModule({ activeModule: "tables", reservationsEnabled: false, settingsResolved: false }),
    ).toBe(false);
    expect(
      shouldLeaveBookingModule({ activeModule: "tables", reservationsEnabled: false, settingsResolved: true }),
    ).toBe(true);
    expect(
      shouldLeaveBookingModule({ activeModule: "tables", reservationsEnabled: true, settingsResolved: true }),
    ).toBe(false);
    expect(
      shouldLeaveBookingModule({ activeModule: "menu", reservationsEnabled: false, settingsResolved: true }),
    ).toBe(false);
  });

  test("the shell keeps Tables through the loading frame of a venue that takes bookings", async () => {
    mockSettingsQuery = { data: undefined, isError: false };
    const tree = await mount(
      <VenueSuiteShell brandId="brand-3393" venueId="venue-3393" initialModule="tables" />,
    );
    expect(useVenueSuiteStore.getState().activeModule).toBe("tables");

    mockSettingsQuery = { data: { reservationsEnabled: true }, isError: false };
    await TestRenderer.act(async () => {
      tree.update(
        <VenueSuiteShell brandId="brand-3393" venueId="venue-3393" initialModule="tables" />,
      );
    });
    expect(useVenueSuiteStore.getState().activeModule).toBe("tables");
    await TestRenderer.act(async () => tree.unmount());
  });

  test("the shell still leaves Tables once settings say reservations are off", async () => {
    mockSettingsQuery = { data: undefined, isError: false };
    const tree = await mount(
      <VenueSuiteShell brandId="brand-3393" venueId="venue-3393" initialModule="tables" />,
    );
    mockSettingsQuery = { data: null, isError: false };
    await TestRenderer.act(async () => {
      tree.update(
        <VenueSuiteShell brandId="brand-3393" venueId="venue-3393" initialModule="tables" />,
      );
    });
    expect(useVenueSuiteStore.getState().activeModule).toBe("overview");
    await TestRenderer.act(async () => tree.unmount());
  });
});
