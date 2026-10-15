/**
 * Issue #3859 — the buyer-web public trip reader must refuse a stale saved
 * installment plan unless the canonical RPC explicitly grants capability.
 *
 * @jest-environment node
 */

type RpcResult = { data: unknown; error: null };
const mockRpc = jest.fn<Promise<RpcResult>, [string, Record<string, unknown>]>();

jest.mock("../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
  },
}));

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual<Record<string, unknown>>("@tanstack/react-query"),
  useQuery: (options: unknown) => options,
}));

// eslint-disable-next-line import/first
import { usePublicTripBySlug } from "../usePublicTripBySlug";

type PublicTripPayload = NonNullable<ReturnType<typeof usePublicTripBySlug>["data"]>;

const schedule = {
  deposit_pct: 25,
  installments: [{ ordinal: 1, pct: 75, days_after_booking: 30 }],
};

function rpcPayload(capability: unknown, includeCapability: boolean): Record<string, unknown> {
  return {
    id: "trip-3859",
    brandId: "brand-3859",
    brandSlug: "parity-host",
    tripSlug: "parity-trip",
    title: "Parity trip",
    description: null,
    status: "scheduled",
    timezone: "UTC",
    startAt: "2027-01-10 00:00:00+00",
    endAt: "2027-01-12 00:00:00+00",
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
    ...(includeCapability ? { installmentCapabilityAvailable: capability } : {}),
    themeColorOverride: null,
    themeFontOverride: null,
    themeAnimationOverride: null,
    brand: {
      id: "brand-3859",
      slug: "parity-host",
      name: "Parity Host",
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
    tiers: [{
      id: "tier-3859",
      ticketTypeId: "ticket-3859",
      tierName: "Standard",
      tierMetadata: { installments: schedule },
      priceCents: 10000,
      currency: "usd",
      quantityTotal: 10,
      ticketsRemaining: 10,
      isUnlimited: false,
      isFree: false,
      installments: schedule,
    }],
  };
}

async function read(capability: unknown, includeCapability = true): Promise<PublicTripPayload> {
  mockRpc.mockImplementation(async (name) => {
    if (name === "pg_public_trip_by_slug") {
      return { data: rpcPayload(capability, includeCapability), error: null };
    }
    if (name === "pg_brand_can_collect") return { data: true, error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const options = usePublicTripBySlug("parity-host", "parity-trip") as unknown as {
    queryFn: () => Promise<PublicTripPayload | null>;
  };
  const payload = await options.queryFn();
  if (payload === null) throw new Error("trip unexpectedly missing");
  return payload;
}

describe("#3859 buyer-web public installment capability", () => {
  beforeEach(() => mockRpc.mockReset());

  it("new client against an old server hides a stale saved schedule", async () => {
    const payload = await read(undefined, false);
    expect(payload.trip.pricingTiers[0].installmentSchedule).toBeNull();
  });

  it("an explicit unsupported capability hides and makes the plan nonselectable", async () => {
    const payload = await read(false);
    expect(payload.trip.pricingTiers[0].installmentSchedule).toBeNull();
  });

  it("an explicit supported capability preserves the Stripe-capable plan", async () => {
    const payload = await read(true);
    expect(payload.trip.pricingTiers[0].installmentSchedule).toEqual(schedule);
  });
});
