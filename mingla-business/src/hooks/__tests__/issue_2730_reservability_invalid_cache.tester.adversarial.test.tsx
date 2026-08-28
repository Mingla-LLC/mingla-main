/**
 * #2730 tester-owned adversarial proof.
 *
 * Unlike the implementor's Brand -> venue happy path, this suite poisons the
 * exact fresh React Query entry directly. It proves historical strings and
 * hostile object shapes cannot become successful/disabled venue truth, that a
 * forced retry replaces poison with validated truth, and that diagnostics are
 * transition-bounded and payload-free. It also attacks the reverse venue ->
 * Brand observer order and malformed transport-success envelopes.
 */
/* eslint-disable import/first -- Jest must install boundary mocks before real hooks load. */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";
import {
  QueryClient,
  QueryClientProvider,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { PublicVenueReservable } from "../../services/publicEventsService";

interface RendererInstance {
  unmount(): void;
  update(element: React.ReactElement): void;
}

interface TestRendererApi {
  create(element: React.ReactElement): RendererInstance;
  act(callback: () => void | Promise<void>): Promise<void> | void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as TestRendererApi;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const PLACE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENUE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RAW_SECRET = "guest-private-payload-must-never-be-reported";

const rpcMock =
  jest.fn<
    (
      name: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>
  >();
const fromMock = jest.fn();

jest.mock("../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, params: Record<string, unknown>) =>
      rpcMock(name, params),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

const reportNonFatalMock = jest.fn();
jest.mock("../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: (...args: unknown[]) => reportNonFatalMock(...args),
}));

import {
  publicEventKeys,
  usePublicBrandVenues,
  usePublicVenueReservable,
} from "../usePublicEvents";
import {
  getPublicVenueReservable,
  isPublicVenueReservableContractError,
  PUBLIC_VENUE_RESERVABLE_INVALID_RESPONSE,
} from "../../services/publicEventsService";

type BrandResult = ReturnType<typeof usePublicBrandVenues>;

let latestBrand: BrandResult | null = null;
let latestVenue: UseQueryResult<PublicVenueReservable> | null = null;
const mounted: RendererInstance[] = [];

const BrandProbe = (): null => {
  latestBrand = usePublicBrandVenues("gogilagos");
  return null;
};

const VenueProbe = (): null => {
  latestVenue = usePublicVenueReservable(PLACE_ID);
  return null;
};

const venueRow = {
  id: VENUE_ID,
  slug: "gogi",
  name: "Gogi",
  address: "69 Admiralty Way",
  city: "Lagos",
  cover_media_url: null,
  pool_photo_urls: [],
  place_pool_id: PLACE_ID,
};

const makeClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  });

const tick = async (): Promise<void> => {
  await TestRenderer.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const settle = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error("reservability observer did not reach the expected state");
};

const mount = async (
  client: QueryClient,
  child: React.ReactElement,
): Promise<RendererInstance> => {
  let renderer: RendererInstance | null = null;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(
      <QueryClientProvider client={client}>{child}</QueryClientProvider>,
    );
  });
  if (renderer === null) throw new Error("query probe did not mount");
  mounted.push(renderer);
  return renderer;
};

const poison = (client: QueryClient, value: unknown): void => {
  client.setQueryData(publicEventKeys.venueReservable(PLACE_ID), value);
};

const expectSafeVenueDiagnostic = (): void => {
  expect(reportNonFatalMock).toHaveBeenCalledTimes(1);
  expect(reportNonFatalMock).toHaveBeenCalledWith(
    "publicVenue.reservability.invalidShape",
    expect.objectContaining({
      code: PUBLIC_VENUE_RESERVABLE_INVALID_RESPONSE,
    }),
    {
      place_pool_id: PLACE_ID,
      observer: "venue",
      error_code: PUBLIC_VENUE_RESERVABLE_INVALID_RESPONSE,
    },
    ["publicVenue.reservability.invalidShape"],
  );
  expect(JSON.stringify(reportNonFatalMock.mock.calls)).not.toContain(
    RAW_SECRET,
  );
};

beforeEach(() => {
  latestBrand = null;
  latestVenue = null;
  rpcMock.mockReset();
  fromMock.mockReset();
  reportNonFatalMock.mockReset();
  fromMock.mockReturnValue({
    select: () => ({
      eq: () => ({
        order: async () => ({ data: [venueRow], error: null }),
      }),
    }),
  });
});

afterEach(() => {
  while (mounted.length > 0) {
    const renderer = mounted.pop();
    if (renderer !== undefined) {
      void TestRenderer.act(() => renderer.unmount());
    }
  }
});

describe("#2730 hostile cached reservability truth", () => {
  test.each<[string, unknown]>([
    ["historical available string", "available"],
    ["historical unavailable string", "unavailable"],
    ["null", null],
    ["array", [{ reservable: true, venueId: VENUE_ID, currency: "NGN" }]],
    ["missing currency", { reservable: true, venueId: VENUE_ID }],
    [
      "extra payload key",
      {
        reservable: true,
        venueId: VENUE_ID,
        currency: "NGN",
        private: RAW_SECRET,
      },
    ],
    [
      "enabled without venue",
      { reservable: true, venueId: null, currency: "NGN" },
    ],
    [
      "disabled with venue",
      { reservable: false, venueId: VENUE_ID, currency: null },
    ],
    [
      "disabled with currency",
      { reservable: false, venueId: null, currency: "NGN" },
    ],
  ])("rejects fresh %s without refetching or fabricating disabled", async (_label, value) => {
    const client = makeClient();
    poison(client, value);
    await mount(client, <VenueProbe />);
    await settle(() => latestVenue?.isError === true);

    expect(latestVenue?.data).toBeUndefined();
    expect(isPublicVenueReservableContractError(latestVenue?.error)).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
    expectSafeVenueDiagnostic();
    client.clear();
  });

  test("one invalid transition reports once under re-render pressure", async () => {
    const client = makeClient();
    poison(client, { reservable: true, venueId: null, currency: RAW_SECRET });
    const renderer = await mount(client, <VenueProbe />);
    await settle(() => latestVenue?.isError === true);

    for (let index = 0; index < 5; index += 1) {
      await TestRenderer.act(async () => {
        renderer.update(
          <QueryClientProvider client={client}>
            <VenueProbe />
          </QueryClientProvider>,
        );
      });
    }

    expectSafeVenueDiagnostic();
    client.clear();
  });

  test("forced retry replaces poison with enabled truth without reload", async () => {
    const client = makeClient();
    poison(client, "available");
    rpcMock.mockResolvedValueOnce({
      data: [{ reservable: true, venue_id: VENUE_ID, currency: "NGN" }],
      error: null,
    });
    await mount(client, <VenueProbe />);
    await settle(() => latestVenue?.isError === true);

    await TestRenderer.act(async () => {
      await latestVenue?.refetch();
    });
    await settle(() => latestVenue?.isSuccess === true);

    expect(latestVenue?.data).toEqual({
      reservable: true,
      venueId: VENUE_ID,
      currency: "NGN",
    });
    expect(
      client.getQueryData(publicEventKeys.venueReservable(PLACE_ID)),
    ).toEqual({ reservable: true, venueId: VENUE_ID, currency: "NGN" });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expectSafeVenueDiagnostic();
    client.clear();
  });

  test("valid disabled is accepted and never emits an invalid diagnostic", async () => {
    const client = makeClient();
    poison(client, { reservable: false, venueId: null, currency: null });
    await mount(client, <VenueProbe />);
    await settle(() => latestVenue?.isSuccess === true);

    expect(latestVenue?.data).toEqual({
      reservable: false,
      venueId: null,
      currency: null,
    });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(reportNonFatalMock).not.toHaveBeenCalled();
    client.clear();
  });

  test("Brand accepts a fresh venue-shaped object without a second RPC", async () => {
    const client = makeClient();
    poison(client, {
      reservable: true,
      venueId: VENUE_ID,
      currency: "NGN",
    });

    await mount(client, <BrandProbe />);
    await settle(
      () => latestBrand?.data[0]?.reservationState === "available",
    );

    expect(latestBrand?.data[0]?.reservationState).toBe("available");
    expect(rpcMock).not.toHaveBeenCalled();
    expect(reportNonFatalMock).not.toHaveBeenCalled();
    client.clear();
  });
});

describe("#2730 malformed RPC success envelopes", () => {
  test.each<[string, unknown]>([
    ["null", null],
    ["empty rows", []],
    [
      "multiple rows",
      [
        { reservable: false, venue_id: null, currency: null },
        { reservable: false, venue_id: null, currency: null },
      ],
    ],
    ["row array", [[{ reservable: false, venue_id: null, currency: null }]]],
    [
      "missing field",
      [{ reservable: true, venue_id: VENUE_ID }],
    ],
    [
      "wrong boolean type",
      [{ reservable: 1, venue_id: VENUE_ID, currency: "NGN" }],
    ],
    [
      "enabled without venue",
      [{ reservable: true, venue_id: null, currency: RAW_SECRET }],
    ],
    [
      "disabled with currency",
      [{ reservable: false, venue_id: null, currency: RAW_SECRET }],
    ],
  ])("rejects %s with one stable payload-free contract error", async (_label, data) => {
    rpcMock.mockResolvedValueOnce({ data, error: null });

    await expect(getPublicVenueReservable(PLACE_ID)).rejects.toMatchObject({
      name: "PublicVenueReservableContractError",
      code: PUBLIC_VENUE_RESERVABLE_INVALID_RESPONSE,
      message: "The public venue reservability response was invalid.",
    });
    try {
      rpcMock.mockResolvedValueOnce({ data, error: null });
      await getPublicVenueReservable(PLACE_ID);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(RAW_SECRET);
      expect(String(error)).not.toContain(RAW_SECRET);
    }
  });

  test("transport rejection remains transport truth", async () => {
    const transportError = new Error("network unavailable");
    rpcMock.mockRejectedValueOnce(transportError);

    await expect(getPublicVenueReservable(PLACE_ID)).rejects.toBe(
      transportError,
    );
    expect(isPublicVenueReservableContractError(transportError)).toBe(false);
    expect(reportNonFatalMock).not.toHaveBeenCalled();
  });
});
