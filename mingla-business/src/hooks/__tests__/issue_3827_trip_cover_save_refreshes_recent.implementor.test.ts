/**
 * Issue #3827 — a trip cover save must refresh Home > Recent.
 *
 * Recent records a trip's row when the trip is opened, before the step-1
 * autosave writes the cover, so Home could keep showing the old (or no) cover
 * until a pull-to-refresh. `useUpdateTripBasics` now invalidates the Recent
 * index + page queries when a save changed the cover, and leaves them alone
 * when it did not (no extra server call per save).
 *
 * Harness: the repo's node-env manual hook convention (see
 * authScopedQueryReadiness.test.ts) — `useMutation` is mocked to capture the
 * options so the REAL `onSuccess` body runs against a fake query client.
 *
 * Fails-on-revert: deleting the Recent invalidation block in
 * `useUpdateTripBasics.onSuccess` fails the "cover changed" cases.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { Trip } from "../../services/tripsService";

type MutationOptions = {
  onSuccess: (trip: Trip, variables: { eventId: string; brandId: string }) => void;
};
let capturedMutation: MutationOptions | null = null;

const cache = new Map<string, unknown>();
const invalidated: unknown[] = [];
const fakeQueryClient = {
  getQueryData: (key: unknown) => cache.get(JSON.stringify(key)),
  setQueryData: (key: unknown, value: unknown) => {
    cache.set(JSON.stringify(key), value);
  },
  invalidateQueries: (filters: { queryKey: unknown }) => {
    invalidated.push(filters.queryKey);
  },
  removeQueries: () => undefined,
};

jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: true, isError: false }),
  useMutation: (options: MutationOptions) => {
    capturedMutation = options;
    return { mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false };
  },
  useQueryClient: () => fakeQueryClient,
}));

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true, user: { id: "user-1" } }),
}));

jest.mock("../../services/tripsService", () => ({
  updateTripBasics: jest.fn(),
}));

jest.mock("../upcomingKeys", () => ({
  upcomingKeys: { all: ["upcoming"] },
}));

// eslint-disable-next-line import/first
import { tripKeys, useUpdateTripBasics } from "../useTrips";
// eslint-disable-next-line import/first
import { businessRecentKeys } from "../../services/businessRecentKeys";

const BRAND = "brand-1";
const TRIP_ID = "trip-3827";

const trip = (cover: string | null): Trip =>
  ({
    id: TRIP_ID,
    brandId: BRAND,
    coverMediaUrl: cover,
    coverMediaType: cover === null ? null : "image",
    coverMediaPosterUrl: cover,
  }) as unknown as Trip;

const recentInvalidated = (): boolean => {
  const keys = invalidated.map((k) => JSON.stringify(k));
  return (
    keys.includes(JSON.stringify(businessRecentKeys.index("user-1", BRAND))) &&
    keys.includes(JSON.stringify(businessRecentKeys.pages("user-1", BRAND)))
  );
};

// The mocked react-query makes the hook a plain function call here.
const runSave = (saved: Trip): void => {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useUpdateTripBasics();
  if (capturedMutation === null) throw new Error("mutation not captured");
  capturedMutation.onSuccess(saved, { eventId: TRIP_ID, brandId: BRAND });
};

describe("issue #3827 — trip cover save refreshes Home > Recent", () => {
  beforeEach(() => {
    cache.clear();
    invalidated.length = 0;
    capturedMutation = null;
  });

  test("cover added after the trip was opened → Recent index + pages invalidated", () => {
    fakeQueryClient.setQueryData(tripKeys.detail(TRIP_ID), trip(null));
    runSave(trip("https://example.test/event_covers/b/t/new.jpg"));
    expect(recentInvalidated()).toBe(true);
  });

  test("cover replaced → Recent invalidated", () => {
    fakeQueryClient.setQueryData(
      tripKeys.detail(TRIP_ID),
      trip("https://example.test/event_covers/b/t/old.jpg"),
    );
    runSave(trip("https://example.test/event_covers/b/t/new.jpg"));
    expect(recentInvalidated()).toBe(true);
  });

  test("no cached detail (unknown previous cover) → Recent invalidated", () => {
    runSave(trip("https://example.test/event_covers/b/t/new.jpg"));
    expect(recentInvalidated()).toBe(true);
  });

  test("save with an unchanged cover → Recent left alone", () => {
    const url = "https://example.test/event_covers/b/t/same.jpg";
    fakeQueryClient.setQueryData(tripKeys.detail(TRIP_ID), trip(url));
    runSave(trip(url));
    const keys = invalidated.map((k) => JSON.stringify(k));
    expect(keys.some((k) => k.includes("business-recent"))).toBe(false);
  });
});
