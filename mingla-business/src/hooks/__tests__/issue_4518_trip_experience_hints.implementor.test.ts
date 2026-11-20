/**
 * issue #4518 follow-up — trip and experience pages read the buy-gate answers
 * that rode in with the same-origin bundle, instead of asking the database
 * host for them.
 *
 * FAILS ON REVERT: drop the trip hook's consumption and H-1 fails (the
 * `pg_brand_can_collect` spy fires and the unrestricted hint is absent). Drop
 * the experience service's `noteUnrestrictedCheckout` and H-4 fails. Trust the
 * fields on the RPC fallback and H-3 fails.
 *
 * @jest-environment node
 */

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
const mockRpc = jest.fn<Promise<RpcResult>, [string, Record<string, unknown>]>();

jest.mock("../../services/supabase", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
    from: () => {
      throw new Error("no table reads expected");
    },
  },
}));

jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual<Record<string, unknown>>("@tanstack/react-query"),
  useQuery: (options: unknown) => options,
}));

import { clearCheckoutAccessHints, hintedCheckoutAccess } from "../../services/checkoutAccessHints";
import { getPublicExperienceBySlug } from "../../services/publicExperienceService";
import { usePublicTripBySlug } from "../usePublicTripBySlug";

type PublicTripPayload = NonNullable<ReturnType<typeof usePublicTripBySlug>["data"]>;

const TRIP_ID = "trip-4518";
const EXP_ID = "exp-4518";

const brand = {
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
};

const tripPayload = (extra: Record<string, unknown>): Record<string, unknown> => ({
  id: TRIP_ID,
  brandId: "brand-1",
  brandSlug: "sunrise",
  tripSlug: "coast",
  title: "Coast week",
  description: null,
  status: "scheduled",
  timezone: "UTC",
  startAt: null,
  endAt: null,
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
  brand,
  days: [],
  inclusions: [],
  tiers: [
    {
      id: "tier-1",
      ticketTypeId: "tt-1",
      tierName: "Standard",
      tierMetadata: {},
      priceCents: 50000,
      currency: "usd",
      quantityTotal: 10,
      ticketsRemaining: 10,
      isUnlimited: false,
      isFree: false,
      installments: null,
    },
  ],
  ...extra,
});

const experiencePayload = (extra: Record<string, unknown>): Record<string, unknown> => ({
  id: EXP_ID,
  brandId: "brand-1",
  brandSlug: "sunrise",
  experienceSlug: "wine-crawl",
  title: "Wine Crawl",
  description: null,
  status: "scheduled",
  visibility: "public",
  timezone: "UTC",
  currency: "USD",
  coverMediaUrl: null,
  coverMediaType: null,
  venueText: null,
  isRecurring: false,
  isMultiDate: false,
  recurrenceRules: null,
  intents: null,
  hideAddressUntilTicket: false,
  themeColorOverride: null,
  themeFontOverride: null,
  themeAnimationOverride: null,
  brand,
  stops: [],
  ticket: null,
  dates: [],
  bookable: true,
  ...extra,
});

const g = globalThis as { document?: unknown; fetch?: unknown };
const realFetch = g.fetch;

/** Web runtime whose own-site bundle answers with `body` (or fails). */
const serveBundle = (body: Record<string, unknown> | "down"): void => {
  g.document = {};
  g.fetch = async () =>
    body === "down"
      ? Promise.reject(new TypeError("Failed to fetch"))
      : { ok: true, status: 200, json: async () => body };
};

const rpcNames = (): string[] => mockRpc.mock.calls.map(([name]) => name);

const runTrip = async (): Promise<PublicTripPayload> => {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const options = usePublicTripBySlug("sunrise", "coast") as unknown as {
    queryFn: () => Promise<PublicTripPayload | null>;
  };
  const payload = await options.queryFn();
  if (payload === null) throw new Error("no trip");
  return payload;
};

beforeEach(() => {
  mockRpc.mockReset();
  clearCheckoutAccessHints();
});

afterEach(() => {
  delete g.document;
  g.fetch = realFetch;
});

describe("#4518 — trip page uses the bundle's buy-gate answers", () => {
  test("H-1 paid unrestricted trip from the bundle: no direct brand read, hint noted, Reserve on", async () => {
    serveBundle(tripPayload({ brandCanCollect: true, checkoutAccessMode: "unrestricted" }));
    mockRpc.mockResolvedValue({ data: true, error: null });
    const payload = await runTrip();
    expect(payload.bookable).toBe(true);
    expect(rpcNames()).not.toContain("pg_brand_can_collect");
    expect(rpcNames()).not.toContain("pg_public_ticket_checkout_access_state");
    expect(hintedCheckoutAccess(TRIP_ID)).toEqual({
      schemaVersion: 1,
      mode: "unrestricted",
      state: "unrestricted",
    });
  });

  test("H-2 the bundle's `false` is the server's answer: closed without a second read", async () => {
    serveBundle(tripPayload({ brandCanCollect: false }));
    const payload = await runTrip();
    expect(payload.bookable).toBe(false);
    expect(rpcNames()).toEqual([]);
    expect(hintedCheckoutAccess(TRIP_ID)).toBeUndefined();
  });

  test("H-3 the RPC fallback is never trusted for the answers", async () => {
    serveBundle("down");
    mockRpc.mockImplementation(async (name) => {
      if (name === "pg_public_trip_by_slug") {
        return {
          data: tripPayload({ brandCanCollect: true, checkoutAccessMode: "unrestricted" }),
          error: null,
        };
      }
      if (name === "pg_brand_can_collect") return { data: true, error: null };
      throw new Error(`unexpected ${name}`);
    });
    const payload = await runTrip();
    expect(payload.bookable).toBe(true);
    expect(rpcNames()).toContain("pg_brand_can_collect");
    expect(hintedCheckoutAccess(TRIP_ID)).toBeUndefined();
  });

  test("H-3b a bundle without the answers still asks for itself", async () => {
    serveBundle(tripPayload({}));
    mockRpc.mockResolvedValue({ data: true, error: null });
    await runTrip();
    expect(rpcNames()).toEqual(["pg_brand_can_collect"]);
    expect(hintedCheckoutAccess(TRIP_ID)).toBeUndefined();
  });
});

describe("#4518 — experience page notes the bundle's unrestricted answer", () => {
  test("H-4 unrestricted experience sale from the bundle: hint noted, no direct read", async () => {
    serveBundle(experiencePayload({ checkoutAccessMode: "unrestricted" }));
    const payload = await getPublicExperienceBySlug("sunrise", "wine-crawl");
    expect(payload?.experience.bookable).toBe(true);
    expect(rpcNames()).toEqual([]);
    expect(hintedCheckoutAccess(EXP_ID)).toEqual({
      schemaVersion: 1,
      mode: "unrestricted",
      state: "unrestricted",
    });
  });

  test("H-5 a restricted experience sale carries no hint", async () => {
    serveBundle(experiencePayload({}));
    await getPublicExperienceBySlug("sunrise", "wine-crawl");
    expect(hintedCheckoutAccess(EXP_ID)).toBeUndefined();
  });
});
