let mockQueryOptions: Record<string, unknown>;

jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) => {
    mockQueryOptions = options;
    return options;
  },
}));
jest.mock("@mingla/offering-rendering", () => ({
  isThemeAnimationSlug: () => false,
  isThemeColor: () => false,
  isThemeFontSlug: () => false,
}));
jest.mock("../../services/supabase", () => ({ supabase: { rpc: jest.fn() } }));

import {
  isDirectEventBundlePayload,
  mapRpcPayloadToPublicEvent,
  usePublicEventBySlug,
} from "../usePublicEventBySlug";
import { supabase } from "../../services/supabase";

const mockRpc = supabase.rpc as jest.Mock;

const bundle = (overrides: Record<string, unknown> = {}) => ({
  id: "event-1",
  brandId: "brand-1",
  brandSlug: "lagos-club",
  eventSlug: "night-live",
  name: "Night Live",
  status: "scheduled",
  timezone: "Africa/Lagos",
  currency: "NGN",
  tickets: [
    {
      id: "tier-1",
      name: "Hidden VIP",
      priceCents: 250000,
      allInCents: 275000,
      currency: "NGN",
      isHidden: true,
      availableOnline: true,
    },
  ],
  brand: { id: "brand-1", slug: "lagos-club", name: "Lagos Club" },
  ...overrides,
});

describe("#1929 direct event bundle hook behavior", () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  test("public/hidden direct-link payload hydrates canonical event and bundle tickets", async () => {
    mockRpc.mockResolvedValue({ data: bundle(), error: null });
    usePublicEventBySlug("lagos-club", "night-live");
    expect(mockQueryOptions.enabled).toBe(true);
    expect(mockQueryOptions.queryKey).toEqual([
      "publicEventBySlug",
      "lagos-club",
      "night-live",
    ]);
    const result = await (mockQueryOptions.queryFn as () => Promise<unknown>)();
    expect(mockRpc).toHaveBeenCalledWith("pg_direct_event_checkout_bundle", {
      p_event_id: null,
      p_brand_slug: "lagos-club",
      p_event_slug: "night-live",
    });
    expect(result).toMatchObject({
      event: {
        id: "event-1",
        status: "published",
        tickets: [{ id: "tier-1", visibility: "hidden", currency: "NGN" }],
      },
    });
  });

  test.each([
    ["ended", "ended"],
    ["cancelled", "cancelled"],
  ])("keeps %s events available as historical pages", (rpcStatus, uiStatus) => {
    const result = mapRpcPayloadToPublicEvent(bundle({ status: rpcStatus }));
    expect(result.event.status).toBe(uiStatus);
  });

  test.each([null, [], [bundle()], {}, { id: "only-id" }, "bad"])(
    "malformed/null/private/unknown-shaped result fails closed: %p",
    async (data) => {
      mockRpc.mockResolvedValue({ data, error: null });
      usePublicEventBySlug("lagos-club", "missing-or-private");
      await expect(
        (mockQueryOptions.queryFn as () => Promise<unknown>)(),
      ).resolves.toBeNull();
    },
  );

  test("validator refuses both malformed arrays and malformed objects", () => {
    expect(isDirectEventBundlePayload([bundle()])).toBe(false);
    expect(isDirectEventBundlePayload({ tickets: [] })).toBe(false);
    expect(isDirectEventBundlePayload(bundle())).toBe(true);
  });
});
