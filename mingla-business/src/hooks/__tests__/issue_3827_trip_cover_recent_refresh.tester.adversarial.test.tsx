/**
 * Issue #3827 — tester adversarial: a trip cover save refreshes Home > Recent
 * through a REAL React Query client, and only when it should.
 *
 * The implementor's test captures `onSuccess` with a fake query client and
 * checks which keys were passed to `invalidateQueries`. This test attacks a
 * different angle: a real `QueryClient`, a real `useMutation`, and live
 * Recent index / page observers for TWO brands, then counts how many times
 * each Recent query actually goes back to the server.
 *
 *   1. A video cover replaced by an image (the server keeps the old video
 *      poster, because the step-1 autosave omits the poster) refetches the
 *      saved brand's Recent index and page.
 *   2. The other brand's Recent never refetches (no `business-recent` wildcard).
 *   3. A save with the same video cover, where the cached detail has no poster
 *      field (undefined) and the server returns `null`, is "unchanged": no
 *      Recent refetch at all.
 *   4. A save while signed out (no user id) neither throws nor refetches.
 *
 * Fails on revert: delete the Recent invalidation in
 * `useUpdateTripBasics.onSuccess` (case 1 red); drop the `tripCoverChanged`
 * guard (case 3 red); invalidate `businessRecentKeys.all` instead of the
 * brand's keys (case 2 red); drop the `?? null` poster normalisation (case 3
 * red).
 */

import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  type UseMutationResult,
} from "@tanstack/react-query";

import type { Trip } from "../../services/tripsService";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { unmount: () => void };
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

let signedInUserId: string | null = "user-3827";
let nextSavedTrip: Trip | null = null;

jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    isAuthReady: true,
    user: signedInUserId === null ? null : { id: signedInUserId },
  }),
}));
jest.mock("../../services/tripsService", () => ({
  updateTripBasics: jest.fn(async () => {
    if (nextSavedTrip === null) throw new Error("no saved trip staged");
    return nextSavedTrip;
  }),
  operationIdFor: () => "op-3827",
  readTripRevision: jest.fn(async () => "rev"),
}));
jest.mock("../../services/draftCurrencySync", () => ({
  publishWithDraftCurrencySync: jest.fn(),
}));
jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: jest.fn() },
}));
jest.mock("../../analytics/searchOutcome", () => ({
  captureHostSearchOutcome: jest.fn(),
}));
// Present on main and pulled in by useTrips once #3801 lands; never reached here.
jest.mock("../../services/intakeSchemaService", () => ({
  getTripIntakeSchemasByEvent: jest.fn(),
}));
jest.mock("../useIntakeSchema", () => ({
  intakeSchemaKeys: { byEvent: (id: string) => ["intake", id] },
}));

// eslint-disable-next-line import/first
import { tripKeys, useUpdateTripBasics } from "../useTrips";
// eslint-disable-next-line import/first
import { businessRecentKeys } from "../../services/businessRecentKeys";

const BRAND_A = "brand-a-3827";
const BRAND_B = "brand-b-3827";
const TRIP_ID = "trip-3827-adv";
const VIDEO_URL = "https://cdn.example.test/covers/trip.mp4";
const VIDEO_POSTER = "https://cdn.example.test/covers/trip.jpg";
const IMAGE_URL = "https://cdn.example.test/covers/trip-photo.jpg";

const tripWith = (cover: {
  url: string | null;
  type: string | null;
  poster?: string | null;
}): Trip => {
  const base: Record<string, unknown> = {
    id: TRIP_ID,
    brandId: BRAND_A,
    coverMediaUrl: cover.url,
    coverMediaType: cover.type,
  };
  // `poster` left out on purpose models a cached detail without the field.
  if ("poster" in cover) base.coverMediaPosterUrl = cover.poster;
  return base as unknown as Trip;
};

const fetches: Record<string, number> = {};
const countFetch = (label: string) => async (): Promise<string[]> => {
  fetches[label] = (fetches[label] ?? 0) + 1;
  return [label];
};

let client: QueryClient;
let mutation: UseMutationResult<Trip, Error, { eventId: string; patch: object; brandId: string }> | null;
let tree: { unmount: () => void } | null = null;

const RecentObserver: React.FC<{ userId: string; brandId: string }> = ({ userId, brandId }) => {
  useQuery({
    queryKey: businessRecentKeys.index(userId, brandId),
    queryFn: countFetch(`index:${brandId}`),
    staleTime: Infinity,
  });
  useQuery({
    queryKey: businessRecentKeys.page(userId, brandId, 1, "cursor"),
    queryFn: countFetch(`page:${brandId}`),
    staleTime: Infinity,
  });
  return null;
};

const Harness: React.FC = () => {
  mutation = useUpdateTripBasics() as unknown as typeof mutation;
  return (
    <>
      <RecentObserver userId="user-3827" brandId={BRAND_A} />
      <RecentObserver userId="user-3827" brandId={BRAND_B} />
    </>
  );
};

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
};

const mountWithCachedDetail = async (cached: Trip | undefined): Promise<void> => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (cached !== undefined) client.setQueryData(tripKeys.detail(TRIP_ID), cached);
  await act(async () => {
    tree = TestRenderer.create(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
  });
  await flush();
  // Each Recent query has loaded exactly once before the save.
  expect(fetches).toEqual({
    [`index:${BRAND_A}`]: 1,
    [`page:${BRAND_A}`]: 1,
    [`index:${BRAND_B}`]: 1,
    [`page:${BRAND_B}`]: 1,
  });
};

const save = async (saved: Trip): Promise<void> => {
  nextSavedTrip = saved;
  if (mutation === null) throw new Error("hook not mounted");
  await act(async () => {
    await mutation!.mutateAsync({ eventId: TRIP_ID, patch: {}, brandId: BRAND_A });
  });
  await flush();
};

beforeEach(() => {
  for (const key of Object.keys(fetches)) delete fetches[key];
  signedInUserId = "user-3827";
  nextSavedTrip = null;
  mutation = null;
});

afterEach(async () => {
  await act(async () => {
    tree?.unmount();
  });
  tree = null;
  client.clear();
});

describe("issue #3827 tester adversarial — Recent refresh through a real query client", () => {
  test("video cover replaced by an image (stale video poster kept) refetches only the saved brand's Recent", async () => {
    await mountWithCachedDetail(tripWith({ url: VIDEO_URL, type: "video", poster: VIDEO_POSTER }));

    await save(tripWith({ url: IMAGE_URL, type: "image", poster: VIDEO_POSTER }));

    expect(fetches[`index:${BRAND_A}`]).toBe(2);
    expect(fetches[`page:${BRAND_A}`]).toBe(2);
    // The other brand's Recent is not this save's business.
    expect(fetches[`index:${BRAND_B}`]).toBe(1);
    expect(fetches[`page:${BRAND_B}`]).toBe(1);
    // The detail cache now holds what the server returned.
    expect(client.getQueryData<Trip>(tripKeys.detail(TRIP_ID))?.coverMediaType).toBe("image");
  });

  test("same cover, cached detail without a poster field vs server null: no Recent refetch", async () => {
    await mountWithCachedDetail(tripWith({ url: VIDEO_URL, type: "video" }));

    await save(tripWith({ url: VIDEO_URL, type: "video", poster: null }));

    expect(fetches[`index:${BRAND_A}`]).toBe(1);
    expect(fetches[`page:${BRAND_A}`]).toBe(1);
    expect(fetches[`index:${BRAND_B}`]).toBe(1);
    expect(fetches[`page:${BRAND_B}`]).toBe(1);
  });

  test("signed out mid-save: no throw, no Recent refetch", async () => {
    await mountWithCachedDetail(tripWith({ url: null, type: null, poster: null }));
    signedInUserId = null;
    // Re-render so the hook reads the signed-out user.
    await act(async () => {
      tree?.unmount();
      tree = TestRenderer.create(
        <QueryClientProvider client={client}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    await flush();
    const before = { ...fetches };

    await save(tripWith({ url: IMAGE_URL, type: "image", poster: null }));

    expect(fetches).toEqual(before);
  });
});
