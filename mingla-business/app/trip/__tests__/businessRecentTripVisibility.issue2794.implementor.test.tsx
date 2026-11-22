/* eslint-disable import/first -- Route, query, and successful-open boundaries must be controlled before importing the screen. */
import React from "react";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as any;
const act = TestRenderer.act as (
  callback: () => void | Promise<void>,
) => Promise<void>;

const mockServerId = "27940000-0000-4000-8000-000000000004";
let mockRouteId = "d_local-trip";
let mockResolveCreate: ((value: { id: string }) => void) | null = null;
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockOpen = jest.fn();
const mockPromote = jest.fn();
const mockDiscard = jest.fn();
const mockCreateTripDraft = jest.fn(
  () =>
    new Promise<{ id: string }>((resolve) => {
      mockResolveCreate = resolve;
    }),
);
const mockTripQuery = {
  data: {
    id: mockServerId,
    brandId: "brand-a",
    status: "scheduled",
    title: "Visible canonical trip",
    coverMediaUrl: null,
    coverMediaPosterUrl: null,
    coverMediaType: "image",
  },
  isLoading: false,
  // Issue #3801 — the route mounts an editor only from a read that finished
  // after it opened.
  isFetchedAfterMount: true,
  isError: false,
  error: null,
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: mockRouteId }),
  useRouter: () => ({
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => true,
  }),
}));
jest.mock("../../../src/hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ id: "brand-a", displayName: "Brand A" }),
}));
jest.mock("../../../src/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-a" } }),
}));
jest.mock("../../../src/hooks/useBusinessRecent", () => ({
  useSuccessfulBusinessRecentOpen: (input: {
    entityId: string | null;
    ready: boolean;
  }) => {
    jest.requireActual("react").useEffect(() => {
      if (input.ready) mockOpen(input.entityId);
    }, [input.entityId, input.ready]);
  },
  promoteBusinessRecentDraft: (...args: unknown[]) => mockPromote(...args),
  discardBusinessRecentDraft: (...args: unknown[]) => mockDiscard(...args),
}));
jest.mock("../../../src/hooks/useTrips", () => ({
  useTrip: (id: string | null) =>
    id === mockServerId
      ? mockTripQuery
      : {
          data: null,
          isLoading: false,
          isFetchedAfterMount: true,
          isError: false,
          error: null,
        },
  useCreateTripDraft: () => ({
    mutateAsync: mockCreateTripDraft,
    isPending: true,
  }),
  useSoftDeleteTrip: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../../../src/components/trip/TripCreatorWizard", () => ({
  TripCreatorWizard: () =>
    React.createElement("TripCreatorWizard", {
      testID: "canonical-trip-editor-visible",
    }),
}));
jest.mock("../../../src/components/trip/EditPublishedTripScreen", () => ({
  EditPublishedTripScreen: () =>
    React.createElement("EditPublishedTripScreen", {
      testID: "canonical-trip-editor-visible",
    }),
}));
// #4522 — the 4-step builder (tripBuilderV2, default on) names the trip in a
// start gate before the server draft exists; the eight-step fallback (flag off)
// still creates the draft as soon as the route mounts. Both paths are pinned.
let mockBuilderV2 = false;
let mockStartGateProps: { onStart: (title: string) => Promise<void> } | null = null;
jest.mock("../../../src/config/featureFlags", () => ({
  isFeatureEnabled: (key: string) => (key === "tripBuilderV2" ? mockBuilderV2 : false),
}));
jest.mock("../../../src/components/trip/TripStartGate", () => ({
  TripStartGate: (props: { onStart: (title: string) => Promise<void> }) => {
    mockStartGateProps = props;
    return React.createElement("TripStartGate", { testID: "trip-start-gate" });
  },
}));
jest.mock("../../../src/components/ui/Button", () => ({
  Button: () => React.createElement("Button"),
}));
jest.mock("../../../src/services/tripsService", () => ({
  TRIP_DRAFT_PLACEHOLDER_TITLE: "Untitled trip",
}));

import TripEditRoute from "../[id]/edit";

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteId = "d_local-trip";
  mockResolveCreate = null;
  mockBuilderV2 = false;
  mockStartGateProps = null;
});

test("4-step builder: the start gate records zero opens and creates nothing until Start, then the visible server editor records exactly one", async () => {
  mockBuilderV2 = true;
  let tree: any;
  await act(async () => {
    tree = TestRenderer.create(<TripEditRoute />);
    await Promise.resolve();
  });

  expect(tree.root.findByProps({ testID: "trip-start-gate" })).toBeDefined();
  expect(mockCreateTripDraft).not.toHaveBeenCalled();
  expect(mockOpen).not.toHaveBeenCalled();

  let started: Promise<void> | null = null;
  await act(async () => {
    started = mockStartGateProps!.onStart("Lagos weekend");
    await Promise.resolve();
  });
  expect(mockCreateTripDraft).toHaveBeenCalledWith({
    brandId: "brand-a",
    initialTitle: "Lagos weekend",
  });
  expect(mockOpen).not.toHaveBeenCalled();

  await act(async () => {
    mockResolveCreate?.({ id: mockServerId });
    await started;
  });
  expect(mockPromote).toHaveBeenCalledWith({
    userId: "user-a",
    brandId: "brand-a",
    entityType: "trip",
    localId: "d_local-trip",
    serverId: mockServerId,
  });
  expect(mockReplace).toHaveBeenCalledWith(`/trip/${mockServerId}/edit`);
  expect(mockOpen).not.toHaveBeenCalled();

  mockRouteId = mockServerId;
  await act(async () => {
    tree.update(<TripEditRoute />);
    await Promise.resolve();
  });

  expect(
    tree.root.findByProps({ testID: "canonical-trip-editor-visible" }),
  ).toBeDefined();
  expect(mockOpen).toHaveBeenCalledTimes(1);
  expect(mockOpen).toHaveBeenCalledWith(mockServerId);
  tree.unmount();
});

test("eight-step fallback (tripBuilderV2 off): local placeholder records zero opens, then visible server editor records exactly one", async () => {
  let tree: any;
  await act(async () => {
    tree = TestRenderer.create(<TripEditRoute />);
    await Promise.resolve();
  });

  expect(JSON.stringify(tree.toJSON())).toContain("Setting up your trip…");
  expect(mockCreateTripDraft).toHaveBeenCalledWith({ brandId: "brand-a" });
  expect(mockOpen).not.toHaveBeenCalled();

  await act(async () => {
    mockResolveCreate?.({ id: mockServerId });
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(mockPromote).toHaveBeenCalledWith({
    userId: "user-a",
    brandId: "brand-a",
    entityType: "trip",
    localId: "d_local-trip",
    serverId: mockServerId,
  });
  expect(mockReplace).toHaveBeenCalledWith(`/trip/${mockServerId}/edit`);
  expect(mockOpen).not.toHaveBeenCalled();

  mockRouteId = mockServerId;
  await act(async () => {
    tree.update(<TripEditRoute />);
    await Promise.resolve();
  });

  expect(
    tree.root.findByProps({ testID: "canonical-trip-editor-visible" }),
  ).toBeDefined();
  expect(mockOpen).toHaveBeenCalledTimes(1);
  expect(mockOpen).toHaveBeenCalledWith(mockServerId);
  tree.unmount();
});
