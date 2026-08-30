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
});

test("local placeholder records zero opens, then visible server editor records exactly one", async () => {
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
