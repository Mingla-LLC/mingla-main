let mockQueryOptions: Record<string, unknown>;

jest.mock("@tanstack/react-query", () => ({
  useQuery: (options: Record<string, unknown>) => {
    mockQueryOptions = options;
    return options;
  },
}));
jest.mock("@mingla/offering-rendering", () => ({
  // issue #2562 — this partial factory must carry every export the hook
  // imports, or the mapper throws before any assertion below runs. Unlike the
  // sibling suites, this one DELEGATES to the real lifecycle module rather than
  // stubbing: the #2562 block at the bottom of this file asserts the mapper's
  // real past-event behaviour, and a stub would make it assert against itself.
  // The deep specifier resolves through the workspace symlink and pulls in no
  // React Native, so it is safe under this config.
  forwardableAcquisitionState: (
    jest.requireActual(
      "@mingla/offering-rendering/eventAcquisitionLifecycle",
    ) as { forwardableAcquisitionState: (...a: unknown[]) => unknown }
  ).forwardableAcquisitionState,

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
  occurrences: [
    {
      id: "occurrence-1",
      startAt: "2099-01-01T18:00:00Z",
      endAt: "2099-01-01T20:00:00Z",
      timezone: "Africa/Lagos",
      isMaster: true,
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

  test("literal null result resolves null without fabricating an event", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    usePublicEventBySlug("lagos-club", "missing-or-private");
    await expect(
      (mockQueryOptions.queryFn as () => Promise<unknown>)(),
    ).resolves.toBeNull();
  });

  test.each([[], [bundle()], {}, { id: "only-id" }, "bad"])(
    "malformed non-null result rejects through query error ownership: %p",
    async (data) => {
      mockRpc.mockResolvedValue({ data, error: null });
      usePublicEventBySlug("lagos-club", "missing-or-private");
      await expect(
        (mockQueryOptions.queryFn as () => Promise<unknown>)(),
      ).rejects.toThrow("invalid_direct_event_checkout_bundle");
    },
  );

  test("validator refuses both malformed arrays and malformed objects", () => {
    expect(isDirectEventBundlePayload([bundle()])).toBe(false);
    expect(isDirectEventBundlePayload({ tickets: [] })).toBe(false);
    expect(isDirectEventBundlePayload(bundle())).toBe(true);
  });
});

// ── issue #2562 [a past event was still purchasable] ────────────────────────
//
// APPENDED HERE ON PURPOSE, not given its own file. This lane already triggers
// on `app-mobile/src/hooks/usePublicEventBySlug.ts`, and this file already
// exercises `mapRpcPayloadToPublicEvent` — so these assertions run whenever the
// mapper changes. A new file would run in no lane at all (app-mobile lanes name
// their test files explicitly), and adding one to a lane means editing a
// sha-registered workflow.
//
// WHAT THIS COVERS THAT THE SHARED TEST CANNOT. The mingla-business suite proves
// the forwarding rule and its effect on `computeOfferingVariant`. It cannot
// prove the CONSUMER HOOK calls the rule — importing across the workspace
// boundary drags app-mobile's dependency tree into the business typecheck. This
// is the only place that call site can be executed, and the call site is the
// bug: the rule already existed and the buyer web already used it; Explorer
// never did.
describe("issue #2562 — the consumer mapper derives past state from the clock", () => {
  test("an event with a finished occurrence maps to an ENDED acquisition state", () => {
    const result = mapRpcPayloadToPublicEvent(
      bundle({
        status: "scheduled",
        masterEndAt: "2100-01-01T00:00:00.000Z",
        occurrences: [
          {
            id: "past-occurrence",
            startAt: "2020-01-01T00:00:00.000Z",
            endAt: "2020-01-01T01:00:00.000Z",
            timezone: "UTC",
            isMaster: true,
          },
        ],
      }),
    );
    expect(result.event.acquisitionState?.kind).toBe("ended");
  });

  test("an event with an occurrence still ahead carries no acquisition state", () => {
    const result = mapRpcPayloadToPublicEvent(
      bundle({
        status: "scheduled",
        masterEndAt: "2020-01-01T00:00:00.000Z",
        occurrences: [
          {
            id: "future-occurrence",
            startAt: "2099-01-01T18:00:00.000Z",
            endAt: "2099-01-01T20:00:00.000Z",
            timezone: "UTC",
            isMaster: true,
          },
        ],
      }),
    );
    expect(result.event.acquisitionState).toBeUndefined();
  });

  test("FAIL SAFE — a missing occurrence schedule maps to unavailable", () => {
    const result = mapRpcPayloadToPublicEvent(
      bundle({
        status: "scheduled",
        masterEndAt: "2100-01-01T00:00:00.000Z",
        occurrences: [],
      }),
    );
    expect(result.event.acquisitionState).toEqual({
      kind: "unavailable",
      reason: "occurrences_missing",
    });
  });

  test("a cancelled event maps to cancelled, not ended", () => {
    const result = mapRpcPayloadToPublicEvent(
      bundle({ status: "cancelled", masterEndAt: "2100-01-01T00:00:00.000Z" }),
    );
    expect(result.event.acquisitionState?.kind).toBe("cancelled");
  });
});
