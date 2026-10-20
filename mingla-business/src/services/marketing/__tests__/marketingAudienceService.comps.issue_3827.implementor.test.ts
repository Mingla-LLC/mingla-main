/**
 * issue #3827 — guest-list guests in brand marketing audiences.
 *
 * Seth's decision (Q9, 2026-10-20): guest-list (comp) guests ARE included in
 * the brand's marketing audiences, under exactly the same consent and
 * unsubscribe rules as buyers. A comp is an `orders` row with payment_status
 * 'paid', so it is read by the same query as a sale, and a guest who
 * unsubscribed (brand or global) is kept visible but not reachable — the same
 * as a buyer.
 *
 * This file pins: (1) the audience queries carry NO source filter (no
 * `.neq('source','comp')`), (2) a comp guest becomes a reachable row,
 * (3) an unsubscribed comp guest is not counted as reachable.
 */

jest.mock("../../supabase", () => ({
  supabase: { from: jest.fn() },
}));

import { describe, expect, test } from "@jest/globals";

import { resolveBrandBuyers, resolveEventBuyers } from "../marketingAudienceService";
import { supabase } from "../../supabase";

const BRAND = "00000000-0000-4000-8000-0000000000a1";
const EVENT = "00000000-0000-4000-8000-0000000000b1";

const order = (patch: Record<string, unknown>) => ({
  id: "ord_1",
  event_id: EVENT,
  buyer_email: "buyer@example.com",
  buyer_name: "Paid Buyer",
  buyer_phone: null,
  buyer_phone_e164: null,
  total_cents: 2000,
  currency: "GBP",
  payment_status: "paid",
  confirmed_at: "2026-10-20T10:00:00Z",
  created_at: "2026-10-20T10:00:00Z",
  events: { id: EVENT, title: "Rooftop", brand_id: BRAND },
  ...patch,
});

const calls: string[] = [];

function mockTables(orders: unknown[], unsubs: unknown[]): void {
  calls.length = 0;
  (supabase.from as jest.Mock).mockReset();
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === "orders") {
      // Only the filters the audience is allowed to use exist on this chain:
      // a `.neq("source", "comp")` would throw here and fail the test.
      const chain: Record<string, unknown> = {};
      chain.select = jest.fn(() => { calls.push("select"); return chain; });
      chain.in = jest.fn((col: string) => { calls.push(`in:${col}`); return chain; });
      chain.eq = jest.fn((col: string) => { calls.push(`eq:${col}`); return chain; });
      chain.order = jest.fn(() => Promise.resolve({ data: orders, error: null }));
      return chain;
    }
    if (table === "marketing_unsubscribes") {
      const chain: Record<string, unknown> = {};
      chain.select = jest.fn(() => chain);
      chain.or = jest.fn(() => Promise.resolve({ data: unsubs, error: null }));
      return chain;
    }
    throw new Error(`unexpected supabase.from(${table})`);
  });
}

describe("issue #3827 Q9 — guest-list guests are in brand marketing audiences", () => {
  test("brand audience: a comp guest is a reachable row like a buyer; no source filter", async () => {
    mockTables(
      [
        order({}),
        order({ id: "comp_1", buyer_email: "ana@example.com", buyer_name: "Ana Bello", total_cents: 0 }),
      ],
      [],
    );
    const result = await resolveBrandBuyers(BRAND);
    expect(result.rows.map((r) => r.contact_key).sort()).toEqual(["ana@example.com", "buyer@example.com"]);
    expect(result.reach.reachable_email).toBe(2);
    expect(calls.some((c) => c.includes("source"))).toBe(false);
  });

  test("event audience includes comp guests too", async () => {
    mockTables([order({ id: "comp_1", buyer_email: "ana@example.com", total_cents: 0 })], []);
    const result = await resolveEventBuyers(EVENT);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].consent.email_marketing_ok).toBe(true);
  });

  test("an unsubscribed comp guest is kept visible but not reachable (same rule as buyers)", async () => {
    mockTables(
      [order({ id: "comp_1", buyer_email: "ana@example.com", total_cents: 0 })],
      [{ contact_email: "ana@example.com", contact_phone: null, channel: "email", scope: "brand", brand_id: BRAND }],
    );
    const result = await resolveBrandBuyers(BRAND);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].consent.email_marketing_ok).toBe(false);
    expect(result.reach.reachable_email).toBe(0);
  });

  test("a name-only comp guest (no email) is never a marketing contact", async () => {
    mockTables([order({ id: "comp_2", buyer_email: null, buyer_name: "Door Only", total_cents: 0 })], []);
    const result = await resolveBrandBuyers(BRAND);
    expect(result.rows).toHaveLength(0);
  });
});
