/**
 * Issue #3801 — the public trip page's seats pill describes the whole trip.
 *
 * BEFORE. `usePublicTripBySlug` took the trip's capacity from the FIRST
 * package and `buildTripOfferingData` built the pill from the first package's
 * remaining seats, so a trip with packages of 8, 2 and 1 spots read "8 seats
 * left · 8 max", and the trip read "Sold out" as soon as its first package was.
 *
 * AFTER. Capacity is the sum of every package's spots, seats left the sum of
 * every package's remaining seats, and the trip is sold out only when every
 * package is. A package with no limit means there is no honest figure, so the
 * pill is hidden (Constitution rule 9).
 *
 * Every case runs the REAL hook query function (the reader is the only thing
 * replaced) and the REAL adapter. Fails on revert of either file.
 *
 * @jest-environment node
 */

type RpcResult = { data: unknown; error: null };
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

interface PackageFixture {
  name: string;
  spots: number | null;
  remaining: number | null;
  unlimited?: boolean;
}

function rpcPayload(packages: readonly PackageFixture[]): Record<string, unknown> {
  return {
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
    tiers: packages.map((pkg, index) => ({
      id: `tier-${index}`,
      ticketTypeId: `tt-${index}`,
      tierName: pkg.name,
      tierMetadata: {},
      priceCents: 0,
      currency: "usd",
      quantityTotal: pkg.spots,
      ticketsRemaining: pkg.remaining,
      isUnlimited: pkg.unlimited === true,
      isFree: true,
      installments: null,
    })),
  };
}

/** Runs the real hook query function against the given reader response. */
async function readPublicTrip(packages: readonly PackageFixture[]): Promise<PublicTripPayload> {
  mockRpc.mockImplementation(async (name) => {
    if (name === "pg_public_trip_by_slug") return { data: rpcPayload(packages), error: null };
    throw new Error(`unexpected reader ${name}`);
  });
  const options = usePublicTripBySlug("sunrise", "coast") as unknown as {
    queryFn: () => Promise<PublicTripPayload | null>;
  };
  const payload = await options.queryFn();
  if (payload === null) throw new Error("the hook returned no trip");
  return payload;
}

async function spotsLabelFor(packages: readonly PackageFixture[]): Promise<string | null> {
  const { trip } = await readPublicTrip(packages);
  return buildTripOfferingData(trip, true).spotsLabel;
}

describe("issue #3801 — the seats pill is the trip total", () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it("reads through the anonymous trip reader with both slugs", async () => {
    await readPublicTrip([{ name: "Shared", spots: 8, remaining: 8 }]);
    expect(mockRpc).toHaveBeenCalledWith("pg_public_trip_by_slug", {
      p_brand_slug: "sunrise",
      p_event_slug: "coast",
    });
  });

  it("three packages of 8, 2 and 1 spots read 11 seats left of 11", async () => {
    const packages = [
      { name: "Shared", spots: 8, remaining: 8 },
      { name: "Couple", spots: 2, remaining: 2 },
      { name: "Private", spots: 1, remaining: 1 },
    ];
    const { trip } = await readPublicTrip(packages);
    expect(trip.businessTrip.capacity).toBe(11);
    expect(buildTripOfferingData(trip, true).spotsLabel).toBe("11 seats left · 11 max");
  });

  it("does not depend on which package comes first", async () => {
    expect(
      await spotsLabelFor([
        { name: "Private", spots: 1, remaining: 1 },
        { name: "Couple", spots: 2, remaining: 2 },
        { name: "Shared", spots: 8, remaining: 8 },
      ]),
    ).toBe("11 seats left · 11 max");
  });

  it("counts bookings in every package", async () => {
    expect(
      await spotsLabelFor([
        { name: "Shared", spots: 8, remaining: 5 },
        { name: "Couple", spots: 2, remaining: 0 },
        { name: "Private", spots: 1, remaining: 1 },
      ]),
    ).toBe("6 seats left · 11 max");
  });

  it("a sold-out first package does not make the trip sold out", async () => {
    expect(
      await spotsLabelFor([
        { name: "Shared", spots: 8, remaining: 0 },
        { name: "Couple", spots: 2, remaining: 2 },
        { name: "Private", spots: 1, remaining: 1 },
      ]),
    ).toBe("3 seats left · 11 max");
  });

  it("is sold out when every package is sold out", async () => {
    expect(
      await spotsLabelFor([
        { name: "Shared", spots: 8, remaining: 0 },
        { name: "Couple", spots: 2, remaining: 0 },
        { name: "Private", spots: 1, remaining: 0 },
      ]),
    ).toBe("Sold out · 11 of 11 booked");
  });

  it("shows no max figure when a package has no limit", async () => {
    const packages = [
      { name: "Shared", spots: 8, remaining: 8 },
      { name: "Open", spots: null, remaining: null, unlimited: true },
    ];
    const { trip } = await readPublicTrip(packages);
    expect(trip.businessTrip.capacity).toBeNull();
    const label = buildTripOfferingData(trip, true).spotsLabel;
    expect(label).toBeNull();
  });

  it("shows no figure when a no-limit package comes after a sold-out one", async () => {
    const label = await spotsLabelFor([
      { name: "Shared", spots: 8, remaining: 0 },
      { name: "Open", spots: null, remaining: null, unlimited: true },
    ]);
    expect(label).toBeNull();
  });

  it("shows no figure for a trip with no packages", async () => {
    const { trip } = await readPublicTrip([]);
    expect(trip.businessTrip.capacity).toBeNull();
    expect(buildTripOfferingData(trip, true).spotsLabel).toBeNull();
  });

  it("one package keeps the wording it always had", async () => {
    expect(await spotsLabelFor([{ name: "Standard", spots: 12, remaining: 7 }])).toBe(
      "7 seats left · 12 max",
    );
  });

  it("sums remaining seats, and refuses a partial sum", () => {
    expect(
      sumTripSeatsLeft([
        { isUnlimited: false, ticketsRemaining: 8 },
        { isUnlimited: false, ticketsRemaining: 2 },
        { isUnlimited: false, ticketsRemaining: 1 },
      ]),
    ).toBe(11);
    expect(sumTripSeatsLeft([])).toBeNull();
    expect(
      sumTripSeatsLeft([
        { isUnlimited: false, ticketsRemaining: 8 },
        { isUnlimited: true, ticketsRemaining: null },
      ]),
    ).toBeNull();
    expect(
      sumTripSeatsLeft([
        { isUnlimited: false, ticketsRemaining: 8 },
        { isUnlimited: false, ticketsRemaining: null },
      ]),
    ).toBeNull();
  });
});
