/**
 * #2730 — happy-path proof for Brand → venue reservation truth.
 *
 * This mounts the REAL brand and venue hooks sequentially beneath one REAL
 * QueryClient. Only Supabase is replaced at the network boundary. The key
 * assertion is both behavioral and causal: the brand observer stores the full
 * object, then the venue observer reuses it while fresh with no second RPC.
 * Reverting the brand observer to its historical status-string writer makes
 * the cache-shape and venue-result assertions fail.
 */
/* eslint-disable import/first -- Jest must register network mocks before loading the real hooks. */
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

// react-test-renderer is a declared runtime dependency but has no bundled
// declarations under this repository's stock Jest/ts-jest configuration.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as TestRendererApi;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const PLACE_ID = "11111111-1111-4111-8111-111111111111";
const VENUE_ID = "22222222-2222-4222-8222-222222222222";

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

const currentBrand = (): BrandResult => {
  if (latestBrand === null) throw new Error("brand hook did not render");
  return latestBrand;
};

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

const mockVenueList = (): void => {
  fromMock.mockReturnValue({
    select: () => ({
      eq: () => ({
        order: async () => ({ data: [venueRow], error: null }),
      }),
    }),
  });
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
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) return;
    await tick();
  }
  throw new Error("the reservation hook did not reach the expected state");
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

beforeEach(() => {
  latestBrand = null;
  latestVenue = null;
  rpcMock.mockReset();
  fromMock.mockReset();
  reportNonFatalMock.mockReset();
  mockVenueList();
});

afterEach(() => {
  while (mounted.length > 0) {
    const renderer = mounted.pop();
    if (renderer !== undefined) {
      void TestRenderer.act(() => renderer.unmount());
    }
  }
});

describe("#2730 public venue reservability cache contract", () => {
  test("Brand → venue reuses one fresh full object and one resolver call", async () => {
    rpcMock.mockResolvedValue({
      data: [{ reservable: true, venue_id: VENUE_ID, currency: "NGN" }],
      error: null,
    });
    const client = makeClient();
    const renderer = await mount(client, <BrandProbe />);

    await settle(
      () =>
        latestBrand !== null &&
        latestBrand.data[0]?.reservationState === "available",
    );
    expect(currentBrand().data[0]?.reservationState).toBe("available");
    expect(
      client.getQueryData(publicEventKeys.venueReservable(PLACE_ID)),
    ).toEqual({ reservable: true, venueId: VENUE_ID, currency: "NGN" });
    expect(rpcMock).toHaveBeenCalledTimes(1);

    await TestRenderer.act(async () => {
      renderer.update(
        <QueryClientProvider client={client}>
          <VenueProbe />
        </QueryClientProvider>,
      );
    });
    await settle(() => latestVenue?.isSuccess === true);

    expect(latestVenue?.data).toEqual({
      reservable: true,
      venueId: VENUE_ID,
      currency: "NGN",
    });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(reportNonFatalMock).not.toHaveBeenCalled();
    client.clear();
  });

  test("valid disabled truth stays disabled while transport failure stays error", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ reservable: false, venue_id: null, currency: null }],
      error: null,
    });
    const disabledClient = makeClient();
    await mount(disabledClient, <BrandProbe />);
    await settle(
      () =>
        latestBrand !== null &&
        latestBrand.data[0]?.reservationState === "unavailable",
    );
    expect(currentBrand().data[0]?.reservationState).toBe("unavailable");
    expect(
      disabledClient.getQueryData(publicEventKeys.venueReservable(PLACE_ID)),
    ).toEqual({ reservable: false, venueId: null, currency: null });
    expect(reportNonFatalMock).not.toHaveBeenCalled();
    disabledClient.clear();

    latestBrand = null;
    rpcMock.mockRejectedValueOnce(new Error("transport unavailable"));
    const errorClient = makeClient();
    await mount(errorClient, <BrandProbe />);
    await settle(
      () =>
        latestBrand !== null &&
        latestBrand.data[0]?.reservationState === "error",
    );
    expect(currentBrand().data[0]?.reservationState).toBe("error");
    expect(
      errorClient.getQueryData(publicEventKeys.venueReservable(PLACE_ID)),
    ).toBeUndefined();
    expect(reportNonFatalMock).not.toHaveBeenCalled();
    errorClient.clear();
  });

  test("malformed resolver success becomes one safe brand diagnostic, never disabled", async () => {
    rpcMock.mockResolvedValueOnce({ data: "available", error: null });
    const client = makeClient();
    await mount(client, <BrandProbe />);
    await settle(
      () =>
        latestBrand !== null &&
        latestBrand.data[0]?.reservationState === "error",
    );

    expect(currentBrand().data[0]?.reservationState).toBe("error");
    expect(reportNonFatalMock).toHaveBeenCalledTimes(1);
    expect(reportNonFatalMock).toHaveBeenCalledWith(
      "publicVenue.reservability.invalidShape",
      expect.objectContaining({
        code: PUBLIC_VENUE_RESERVABLE_INVALID_RESPONSE,
      }),
      {
        place_pool_id: PLACE_ID,
        observer: "brand",
        error_code: PUBLIC_VENUE_RESERVABLE_INVALID_RESPONSE,
      },
      ["publicVenue.reservability.invalidShape"],
    );
    expect(JSON.stringify(reportNonFatalMock.mock.calls)).not.toContain(
      "available",
    );
    client.clear();
  });

  test.each<[string, unknown]>([
    ["empty rows", []],
    [
      "multiple rows",
      [
        { reservable: false, venue_id: null, currency: null },
        { reservable: false, venue_id: null, currency: null },
      ],
    ],
    ["scalar", "available"],
    [
      "wrong type",
      [{ reservable: "yes", venue_id: VENUE_ID, currency: "NGN" }],
    ],
    [
      "enabled without venue",
      [{ reservable: true, venue_id: null, currency: "NGN" }],
    ],
    [
      "disabled with venue",
      [{ reservable: false, venue_id: VENUE_ID, currency: null }],
    ],
    [
      "disabled with currency",
      [{ reservable: false, venue_id: null, currency: "NGN" }],
    ],
  ])("rejects %s without fabricating disabled truth", async (_label, data) => {
    rpcMock.mockResolvedValueOnce({ data, error: null });
    let caught: unknown;
    try {
      await getPublicVenueReservable(PLACE_ID);
    } catch (error) {
      caught = error;
    }
    expect(isPublicVenueReservableContractError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe(
      PUBLIC_VENUE_RESERVABLE_INVALID_RESPONSE,
    );
    expect(String((caught as Error).message)).not.toContain(
      JSON.stringify(data),
    );
  });
});
