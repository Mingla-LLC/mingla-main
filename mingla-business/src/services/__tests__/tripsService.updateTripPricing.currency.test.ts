/* eslint-disable import/first */
// #1971 — tier currency is server-owned by the canonical graph command.
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createChainableQuery } from "./__helpers__/supabaseMock";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcMock = jest.fn() as any;
jest.mock("../supabase", () => ({ supabase: {
  from: (table: string) => fromMock(table), rpc: (name: string, args: unknown) => rpcMock(name, args),
} }));
import { updateTripPricing } from "../tripsService";

beforeEach(() => { fromMock.mockReset(); rpcMock.mockReset(); });

describe("#1971 — updateTripPricing server currency authority", () => {
  test("the command patch omits caller currency and addresses the canonical ticket", async () => {
    const tier = { id: "tier-1", event_id: "evt-1", ticket_type_id: "tt-1", tier_name: "Standard", tier_metadata: {} };
    const ticket = { id: "tt-1", event_id: "evt-1", price_cents: 5000, currency: "EUR", quantity_total: 10, is_unlimited: false };
    fromMock.mockImplementation((table: string) => createChainableQuery({ data:
      table === "events" ? { updated_at: "2026-08-14T00:00:00Z" }
        : table === "trip_pricing_tiers" ? [tier]
        : table === "ticket_types" ? [ticket] : [],
    }));
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    const result = await updateTripPricing("evt-1", {
      ticketTypeId: "tt-1", tierName: "Standard", priceCents: 5000, capacity: 10, currency: "JPY",
    }, "11111111-1111-4111-8111-111111111111");
    expect(result.currency).toBe("EUR");
    const command = rpcMock.mock.calls.find((call: unknown[]) => call[0] === "biz_apply_trip_draft_graph");
    expect(command).toBeDefined();
    expect(command?.[1]).toEqual(expect.objectContaining({
      p_patch: { tiers: [expect.objectContaining({ ticket_type_id: "tt-1", price_cents: 5000, capacity: 10 })] },
    }));
    expect(JSON.stringify(command?.[1])).not.toContain("JPY");
    expect(JSON.stringify(command?.[1])).not.toContain("currency");
  });
});
