/**
 * Issue #3801 — tester adversarial proof for the public trip page seats pill.
 *
 * A different angle from the implementor suite, which proves the plain sums.
 * This suite feeds the reader responses a real database or a stale cache can
 * produce and checks the pill never states a number it cannot stand behind:
 *
 *   - a sold-out first package next to open ones (the old "Sold out" bug), in
 *     every order the packages can arrive in
 *   - remaining counts that are negative, missing, or not numbers
 *   - spots that are missing or not numbers on a limited package
 *   - a no-limit package carrying stale numbers
 *   - a response with no `tiers` key at all
 *   - the web path (the CDN-cached trip bundle) against the app path
 *   - the "can this brand take payment" check for trips whose FIRST package
 *     is paid, and for free trips
 *
 * Every case runs the REAL hook query function (only the network is replaced)
 * and the REAL adapter. Fails on revert of usePublicTripBySlug.ts (capacity
 * from the first package) and of tripOfferingAdapter.ts (pill from the first
 * package).
 *
 * @jest-environment node
 */

type RpcResult = { data: unknown; error: { message: string } | null };
const mockRpc = jest.fn<Promise<RpcResult>, [string, Record<string, unknown>]>();

jest.mock("../../services/supabase", () => ({
  supabase: { rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args) },
}));

// The hook hands its options to react-query; capture them so the test can run
// the real query function directly, with no renderer.
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual<Record<string, unknown>>("@tanstack/react-query"),
  useQuery: (options: unknown) => options,
}));

import { buildTripOfferingData, sumTripSeatsLeft } from "../../components/trip/tripOfferingAdapter";
import { usePublicTripBySlug } from "../usePublicTripBySlug";

type PublicTripPayload = NonNullable<ReturnType<typeof usePublicTripBySlug>["data"]>;

/** One package exactly as the reader returns it. Values are deliberately loose. */
interface RawPackage {
  name: string;
  quantityTotal?: unknown;
  ticketsRemaining?: unknown;
  isUnlimited?: unknown;
  priceCents?: number;
}

function rawTier(pkg: RawPackage, index: number): Record<string, unknown> {
  const tier: Record<string, unknown> = {
    id: `tier-${pkg.name}-${index}`,
    ticketTypeId: `tt-${pkg.name}-${index}`,
    tierName: pkg.name,
    tierMetadata: {},
    priceCents: pkg.priceCents ?? 0,
    currency: "usd",
    isFree: (pkg.priceCents ?? 0) === 0,
    installments: null,
  };
  // Only set what the case sets, so "missing" really is a missing key.
  if ("quantityTotal" in pkg) tier.quantityTotal = pkg.quantityTotal;
  if ("ticketsRemaining" in pkg) tier.ticketsRemaining = pkg.ticketsRemaining;
  if ("isUnlimited" in pkg) tier.isUnlimited = pkg.isUnlimited;
  return tier;
}

function rpcPayload(tiers: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: "trip-1",
    brandId: "brand-1",
    brandSlug: "sunrise",
    tripSlug: "coast",
    title: "Coast week",
    description: null,
    status: "scheduled",
    timezone: "UTC",
    startAt: "2026-11-12 00:00:00+00",
    endAt: "2026-11-16 23:59:59+00",
    departureText: null,
    destinationText: null,
    destinationLat: null,
    destinationLng: null,
    departureLat: null,
    departureLng: null,
    currency: "usd",
    coverMediaUrl: null,
    coverMediaType: null,
    coverMediaAlt: null,
    coverGallery: [],
    refundPolicy: null,
    bookingDeadline: null,
    bookingsClosed: false,
    themeColorOverride: null,
    themeFontOverride: null,
    themeAnimationOverride: null,
    brand: {
      id: "brand-1",
      slug: "sunrise",
      name: "Sunrise",
      bio: null,
      coverMediaUrl: null,
      coverMediaType: null,
      coverHue: null,
      verified: false,
      themeColor: null,
      themeFont: null,
      themeAnimation: null,
    },
    days: [],
    inclusions: [],
  };
  if (tiers !== undefined) payload.tiers = tiers;
  return payload;
}

/** What the brand's "can take payment" reader answers in this case. */
let canCollect: RpcResult = { data: true, error: null };

async function runHook(body: Record<string, unknown>): Promise<PublicTripPayload> {
  mockRpc.mockImplementation(async (name) => {
    if (name === "pg_public_trip_by_slug") return { data: body, error: null };
    if (name === "pg_brand_can_collect") return canCollect;
    throw new Error(`unexpected reader ${name}`);
  });
  // Not a render: `useQuery` is replaced above, so the hook only builds and
  // returns its query options.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const options = usePublicTripBySlug("sunrise", "coast") as unknown as {
    queryFn: () => Promise<PublicTripPayload | null>;
  };
  const payload = await options.queryFn();
  if (payload === null) throw new Error("the hook returned no trip");
  return payload;
}

async function read(packages: readonly RawPackage[]): Promise<PublicTripPayload> {
  return runHook(rpcPayload(packages.map(rawTier)));
}

async function pill(packages: readonly RawPackage[]): Promise<string | null> {
  const { trip } = await read(packages);
  return buildTripOfferingData(trip, true).spotsLabel;
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

const capped = (name: string, spots: number, remaining: number, priceCents = 0): RawPackage => ({
  name,
  quantityTotal: spots,
  ticketsRemaining: remaining,
  isUnlimited: false,
  priceCents,
});

describe("issue #3801 tester — the seats pill under hostile reader responses", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    canCollect = { data: true, error: null };
  });

  it("a sold-out package next to open ones never reads Sold out, in any of the six orders", async () => {
    const packages = [capped("Shared", 8, 0), capped("Couple", 2, 2), capped("Private", 1, 1)];
    for (const order of permutations(packages)) {
      const { trip } = await read(order);
      const data = buildTripOfferingData(trip, true);
      expect(data.spotsLabel).toBe("3 seats left · 11 max");
      expect(trip.businessTrip.capacity).toBe(11);
      // The buyer can still pick an open package: the open ones keep their
      // real remaining count and only the sold-out one reports zero.
      const open = data.tiers.filter((t) => (t.ticketsRemaining ?? 0) > 0).map((t) => t.tierName);
      expect(open.sort()).toEqual(["Couple", "Private"]);
      expect(data.tiers.find((t) => t.tierName === "Shared")?.ticketsRemaining).toBe(0);
    }
  });

  it("is sold out only when the last open seat is gone", async () => {
    expect(await pill([capped("A", 8, 0), capped("B", 2, 0), capped("C", 1, 1)])).toBe(
      "1 seats left · 11 max",
    );
    expect(await pill([capped("A", 8, 0), capped("B", 2, 0), capped("C", 1, 0)])).toBe(
      "Sold out · 11 of 11 booked",
    );
  });

  it("an oversold package (negative remaining) counts as zero, not as minus seats", async () => {
    // 8 spots with -3 remaining must not eat the 2 real seats of the next package.
    expect(await pill([capped("Over", 8, -3), capped("Open", 2, 2)])).toBe("2 seats left · 10 max");
    expect(await pill([capped("Over", 8, -3), capped("Gone", 2, 0)])).toBe(
      "Sold out · 10 of 10 booked",
    );
    expect(sumTripSeatsLeft([{ isUnlimited: false, ticketsRemaining: -1 }])).toBe(0);
  });

  it("an unknown remaining count on any package shows the max only, never a partial sum", async () => {
    const unknowns: unknown[] = [null, undefined, "2", Number.NaN, Number.POSITIVE_INFINITY];
    for (const remaining of unknowns) {
      const label = await pill([
        capped("Known", 8, 5),
        { name: "Unknown", quantityTotal: 2, ticketsRemaining: remaining, isUnlimited: false },
      ]);
      expect(label).toBe("10 max");
    }
    // A missing key, not a null value.
    expect(await pill([capped("Known", 8, 0), { name: "NoKey", quantityTotal: 2, isUnlimited: false }])).toBe(
      "10 max",
    );
  });

  it("a sold-out package plus an unknown one is not called sold out", async () => {
    const label = await pill([
      capped("Gone", 8, 0),
      { name: "Unknown", quantityTotal: 2, ticketsRemaining: null, isUnlimited: false },
    ]);
    expect(label).toBe("10 max");
    expect(label).not.toMatch(/sold out/i);
  });

  it("spots that are missing or not a number hide the pill instead of inventing a total", async () => {
    const bad: unknown[] = [null, undefined, "8", Number.NaN];
    for (const spots of bad) {
      const { trip } = await read([
        capped("Good", 8, 8),
        { name: "Bad", quantityTotal: spots, ticketsRemaining: 2, isUnlimited: false },
      ]);
      expect(trip.businessTrip.capacity).toBeNull();
      expect(buildTripOfferingData(trip, true).spotsLabel).toBeNull();
    }
  });

  it("a no-limit package hides the pill even when it carries stale numbers", async () => {
    // isUnlimited wins over a leftover quantity and a leftover zero remaining.
    const { trip } = await read([
      capped("Capped", 8, 0),
      { name: "Open door", quantityTotal: 5, ticketsRemaining: 0, isUnlimited: true },
    ]);
    const data = buildTripOfferingData(trip, true);
    expect(trip.businessTrip.capacity).toBeNull();
    expect(data.spotsLabel).toBeNull();
    // The no-limit package is handed on as "no count", never as "0 left".
    expect(data.tiers.find((t) => t.tierName === "Open door")?.ticketsRemaining).toBeNull();
  });

  it("only a real boolean true makes a package no-limit", async () => {
    // A truthy string must not switch the limit off and hide a real total.
    const { trip } = await read([
      { name: "Stringly", quantityTotal: 4, ticketsRemaining: 4, isUnlimited: "false" },
      capped("Plain", 6, 6),
    ]);
    expect(trip.businessTrip.capacity).toBe(10);
  });

  it("one package reads its own numbers, and one sold-out package reads sold out", async () => {
    expect(await pill([capped("Solo", 6, 4)])).toBe("4 seats left · 6 max");
    expect(await pill([capped("Solo", 6, 0)])).toBe("Sold out · 6 of 6 booked");
    expect(await pill([{ name: "Solo", isUnlimited: true }])).toBeNull();
  });

  it("a trip with no packages, or a response with no tiers key, shows no pill and does not throw", async () => {
    expect(await pill([])).toBeNull();
    const { trip } = await runHook(rpcPayload(undefined));
    expect(trip.pricingTiers).toEqual([]);
    expect(trip.businessTrip.capacity).toBeNull();
    expect(buildTripOfferingData(trip, true).spotsLabel).toBeNull();
  });

  it("a large trip sums exactly", async () => {
    const packages = Array.from({ length: 50 }, (_, i) => capped(`P${i}`, i + 1, i % 3));
    const spots = packages.reduce((sum, p) => sum + (p.quantityTotal as number), 0);
    const left = packages.reduce((sum, p) => sum + (p.ticketsRemaining as number), 0);
    expect(await pill(packages)).toBe(`${left} seats left · ${spots} max`);
    expect(await pill([...packages].reverse())).toBe(`${left} seats left · ${spots} max`);
  });
});

describe("issue #3801 tester — the web bundle path agrees with the app path", () => {
  const packages = [capped("Shared", 8, 0), capped("Couple", 2, 1), capped("Private", 1, 1)];
  const realFetch = (globalThis as { fetch?: unknown }).fetch;

  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
    (globalThis as { fetch?: unknown }).fetch = realFetch;
  });

  it("the cached trip bundle and the direct reader give the same pill and capacity", async () => {
    mockRpc.mockReset();
    canCollect = { data: true, error: null };
    const body = rpcPayload(packages.map(rawTier));

    const native = await runHook(body);
    const nativeLabel = buildTripOfferingData(native.trip, true).spotsLabel;
    expect(mockRpc.mock.calls.some(([name]) => name === "pg_public_trip_by_slug")).toBe(true);

    // Web: a `document` exists, so the hook asks the Host API first.
    mockRpc.mockClear();
    const requested: string[] = [];
    (globalThis as { document?: unknown }).document = {};
    (globalThis as { fetch?: unknown }).fetch = async (url: string) => {
      requested.push(url);
      return { status: 200, ok: true, json: async () => body };
    };
    const web = await runHook(body);

    expect(requested).toEqual(["/api/trip-checkout-bundle?brandSlug=sunrise&tripSlug=coast"]);
    // The bundle answered, so the direct trip reader was not called again.
    expect(mockRpc.mock.calls.some(([name]) => name === "pg_public_trip_by_slug")).toBe(false);
    expect(buildTripOfferingData(web.trip, true).spotsLabel).toBe(nativeLabel);
    expect(nativeLabel).toBe("2 seats left · 11 max");
    expect(web.trip.businessTrip.capacity).toBe(native.trip.businessTrip.capacity);
    expect(web.trip.pricingTiers).toEqual(native.trip.pricingTiers);
  });

  it("a failing bundle falls back to the direct reader with the same result", async () => {
    mockRpc.mockReset();
    canCollect = { data: true, error: null };
    (globalThis as { document?: unknown }).document = {};
    (globalThis as { fetch?: unknown }).fetch = async () => ({
      status: 503,
      ok: false,
      json: async () => ({}),
    });
    const { trip } = await runHook(rpcPayload(packages.map(rawTier)));
    expect(mockRpc.mock.calls.some(([name]) => name === "pg_public_trip_by_slug")).toBe(true);
    expect(buildTripOfferingData(trip, true).spotsLabel).toBe("2 seats left · 11 max");
  });
});

describe("issue #3801 tester — the payment-readiness check still runs", () => {
  beforeEach(() => {
    mockRpc.mockReset();
    canCollect = { data: true, error: null };
  });

  const askedCanCollect = (): boolean =>
    mockRpc.mock.calls.some(([name]) => name === "pg_brand_can_collect");

  it("a trip whose first package is paid asks whether the brand can take payment", async () => {
    canCollect = { data: false, error: null };
    const blocked = await read([capped("Paid", 8, 8, 25000), capped("Free", 2, 2, 0)]);
    expect(askedCanCollect()).toBe(true);
    expect(blocked.bookable).toBe(false);

    mockRpc.mockReset();
    canCollect = { data: true, error: null };
    const open = await read([capped("Paid", 8, 8, 25000)]);
    expect(askedCanCollect()).toBe(true);
    expect(open.bookable).toBe(true);
  });

  it("a paid trip is not bookable when the readiness check errors", async () => {
    canCollect = { data: null, error: { message: "boom" } };
    const { bookable } = await read([capped("Paid", 8, 8, 25000)]);
    expect(bookable).toBe(false);
  });

  it("a fully free trip is bookable without asking, and shows no price", async () => {
    canCollect = { data: false, error: null };
    const { trip, bookable } = await read([capped("Free A", 8, 8, 0), capped("Free B", 2, 2, 0)]);
    expect(askedCanCollect()).toBe(false);
    expect(bookable).toBe(true);
    const data = buildTripOfferingData(trip, bookable, new Map([[trip.pricingTiers[0].ticketTypeId, 999]]));
    expect(data.tiers.every((t) => t.isFree && t.priceAllInCents === null)).toBe(true);
  });
});
