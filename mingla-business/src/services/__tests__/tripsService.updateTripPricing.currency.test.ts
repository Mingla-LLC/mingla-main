/* eslint-disable import/first */
/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] REWORK 2 — Bug #1 regression.
 *
 * Pins that `updateTripPricing` ALWAYS sends the event's currency to
 * ticket_types, NEVER the caller-supplied currency. The
 * tg_enforce_event_ticket_currency trigger
 * (supabase/migrations/20260515000011_orch_0769_no_implicit_gbp_currency.sql:159)
 * rejects any mismatch between ticket_types.currency and events.currency;
 * before this fix the wizard let operators type a free-form currency on
 * Step 4 and the autosave hit `ticket_currency_must_match_event_currency`.
 *
 * Fails-on-revert: if the service trusts patch.currency instead of the
 * event-row-derived currency, the assertion that ticket_types receives
 * "EUR" (the event currency) regardless of patch input fails.
 *
 * [TEST-MOD-APPROVED #1971] The INVARIANT is unchanged and now unbreakable: a
 * caller-supplied currency must never reach `ticket_types`. #1971 replaced the
 * client's read-currency-then-write-ticket_types pair with one
 * `biz_apply_trip_draft_graph` call that reads the currency from the LOCKED
 * event row, so there is no client-side ticket_types update payload left to
 * capture. Exactly two assertions are invalidated — the two
 * `capturedTicketUpdate.currency` reads — and both are re-pinned at the seams
 * that now own the rule: the service cannot send a currency (it is not in the
 * tiers patch at all, even when the caller passes one), and the SQL takes it
 * from `v_event.currency`. The price/capacity assertions are retained.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;
// [TEST-MOD-APPROVED #1971] the canonical tiers write is an RPC.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
  },
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { updateTripPricing } from "../tripsService";
// #1062 [biz-jest-residual-burndown] Wave 1 / B3c — shared chainable supabase mock.
import { createChainableQuery } from "./__helpers__/supabaseMock";

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

describe("ORCH-0859 REWORK 2 / issue #1971 — updateTripPricing currency contract", () => {
  test("a caller-supplied currency never leaves the client", async () => {
    const eventsChain = {
      select: () => eventsChain,
      eq: () => eventsChain,
      is: () => eventsChain,
      maybeSingle: () =>
        Promise.resolve({
          data: { currency: "EUR", updated_at: "2027-01-01T00:00:00Z" },
          error: null,
        }),
    };
    const tierSelectChain = {
      select: () => tierSelectChain,
      eq: () => tierSelectChain,
      order: () => tierSelectChain,
      limit: () =>
        Promise.resolve({
          data: [{
            id: "tier-1",
            event_id: "evt-1",
            ticket_type_id: "tt-1",
            tier_name: "Standard",
            tier_metadata: {},
          }],
          error: null,
        }),
      in: () => tierSelectChain,
    };

    let capturedPatch: Record<string, unknown> | null = null;
    rpcMock.mockImplementation((fn: string, args: Record<string, unknown>) => {
      if (fn === "biz_apply_trip_draft_graph") {
        capturedPatch = args.p_patch as Record<string, unknown>;
        return Promise.resolve({ data: { event: {} }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    fromMock.mockImplementation((table: string) => {
      if (table === "events") return eventsChain;
      if (table === "trip_pricing_tiers") return tierSelectChain;
      if (table === "ticket_types") {
        // A client-side ticket_types write is now a contract violation.
        throw new Error("updateTripPricing wrote to ticket_types directly");
      }
      return createChainableQuery({ data: [] });
    });

    // Caller passes a DIFFERENT currency than the event's — must be IGNORED.
    await updateTripPricing("evt-1", {
      tierName: "Standard",
      priceCents: 5000,
      capacity: 10,
      currency: "JPY", // intentional bogus value — must NOT reach the server
    }).catch(() => {
      // listTripPricingTiers read-back is not the subject here; the patch we
      // captured above is.
    });

    expect(capturedPatch).not.toBeNull();
    const patch = capturedPatch as unknown as {
      tiers: Record<string, unknown>[];
    };
    const tier = patch.tiers[0];
    expect(tier.ticket_type_id).toBe("tt-1");
    expect(tier.price_cents).toBe(5000);
    expect(tier.capacity).toBe(10);
    // The bogus caller currency is not in the payload at all — belt and braces.
    expect(JSON.stringify(patch)).not.toContain("JPY");
    expect(JSON.stringify(patch)).not.toMatch(/currency/i);
  });

  // issue #1014 (rework F-2) — NULL passthrough, no fabricated USD. The
  // canonical tiers group now owns this: it stamps the ticket with the LOCKED
  // event row's currency, whatever that is, including NULL.
  test("the canonical tiers group stamps the locked event currency, NULL included [#1014]", () => {
    const migration = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "supabase",
        "migrations",
        "20270509001971_issue_1971_ari_trip_lifecycle.sql",
      ),
      "utf8",
    );
    const start = migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.biz_apply_trip_draft_graph(",
    );
    expect(start).toBeGreaterThan(-1);
    const body = migration.slice(start, migration.indexOf("$fn$;", start));

    // Sanity: this really is the tiers group.
    expect(body).toContain("IF p_patch ? 'tiers' THEN");
    // The currency comes from the row this command locked FOR UPDATE.
    expect(body).toMatch(/v_currency := v_event\.currency;/);
    // The insert stamps that value, with no literal and no COALESCE fallback.
    expect(body).toMatch(/INSERT INTO public\.ticket_types\(/);
    expect(body).toMatch(/^\s*v_currency,$/m);
    expect(body).not.toMatch(/COALESCE\(\s*v_currency/);
    expect(migration).not.toMatch(/'USD'/);
    // A caller-supplied currency has no route in: the tiers item vocabulary
    // does not contain one.
    expect(body).not.toMatch(/v_item->>'currency'/);
  });
});
