/* eslint-disable import/first */
/**
 * Issue #1971 — implementor happy path for the shared trip command contract.
 *
 * Business web, iOS and Android all render from `mingla-business/src`, so these
 * assertions cover all three surfaces at once. They are made at the SERVICE
 * SEAM a screen actually calls, not against a private helper: deleting a call
 * site would make them fail, which is the whole point.
 *
 * What is pinned here, and why each one is load-bearing:
 *   1. Every lifecycle write reaches a canonical `biz_*` command and NO
 *      `.from(<trip table>).insert/update/delete` survives on the client. The
 *      pre-#1971 code did three unguarded statements to create a draft, a
 *      delete-then-insert to replace days, and a raw `events.deleted_at`
 *      update — each of which could half-apply.
 *   2. Every write carries an expected revision (compare-and-swap) and a
 *      stable operation id.
 *   3. `operationIdFor` returns the SAME id for the same variables object (a
 *      React Query automatic retry) and a DIFFERENT id for a new object (a
 *      deliberate second edit). Without that, a retried delivery would mutate
 *      twice; with a single fixed id, a genuine second edit would be swallowed
 *      as a replay.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u-1" } } }) },
  },
}));

import {
  createTripDraft,
  newTripOperationId,
  operationIdFor,
  removeTripPricingTier,
  softDeleteTrip,
  updateLiveTripFields,
  upsertTripDays,
  upsertTripInclusions,
} from "../tripsService";
import { createChainableQuery } from "./__helpers__/supabaseMock";

const REVISION = "2027-03-04T05:06:07.008009Z";
const EVENT_ID = "19710000-0000-4000-8000-000000000020";

const calls: { fn: string; args: Record<string, unknown> }[] = [];
/** Tables no client-side trip write may touch any more. */
const OWNED_TABLES = [
  "events",
  "event_dates",
  "trip_days",
  "trip_inclusions",
  "ticket_types",
  "trip_pricing_tiers",
  "trip_intake_schemas",
];

beforeEach(() => {
  calls.length = 0;
  fromMock.mockReset();
  rpcMock.mockReset();

  rpcMock.mockImplementation((fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === "biz_trip_tickets_sold_by_tier") {
      return Promise.resolve({ data: {}, error: null });
    }
    if (fn === "biz_soft_delete_trip") {
      return Promise.resolve({
        data: { id: EVENT_ID, deleted: true, rejected: false },
        error: null,
      });
    }
    if (fn === "biz_update_trip_live_command") {
      return Promise.resolve({
        data: {
          ok: true,
          edit_log_entry_id: "log-1",
          severity: "additive",
          changed_keys: ["title"],
          affected_order_count: 0,
        },
        error: null,
      });
    }
    return Promise.resolve({
      data: { event: { id: EVENT_ID }, days: [], inclusions: [], tiers: [] },
      error: null,
    });
  });

  const eventsChain = {
    select: () => eventsChain,
    eq: () => eventsChain,
    is: () => eventsChain,
    in: () => eventsChain,
    order: () => eventsChain,
    maybeSingle: () =>
      Promise.resolve({
        data: {
          id: EVENT_ID,
          brand_id: "b-1",
          title: "Trip",
          description: null,
          slug: "trip",
          status: "draft",
          visibility: "draft",
          published_at: null,
          timezone: "UTC",
          theme: { business_trip: {} },
          event_type: "trip",
          created_at: REVISION,
          updated_at: REVISION,
          brands: { slug: "brand" },
        },
        error: null,
      }),
  };
  fromMock.mockImplementation((table: string) => {
    if (OWNED_TABLES.includes(table) && table !== "events") {
      return {
        ...createChainableQuery({ data: [] }),
        insert: () => {
          throw new Error(`client wrote to ${table} directly`);
        },
        update: () => {
          throw new Error(`client wrote to ${table} directly`);
        },
        upsert: () => {
          throw new Error(`client wrote to ${table} directly`);
        },
        delete: () => {
          throw new Error(`client wrote to ${table} directly`);
        },
      };
    }
    if (table === "events") {
      return {
        ...eventsChain,
        insert: () => {
          throw new Error("client wrote to events directly");
        },
        update: () => {
          throw new Error("client wrote to events directly");
        },
        delete: () => {
          throw new Error("client wrote to events directly");
        },
      };
    }
    return createChainableQuery({ data: [] });
  });
});

describe("issue #1971 — every Business trip write goes through one canonical command", () => {
  test("create, days, inclusions, tier removal, live edit and delete all reach a biz_* command", async () => {
    await createTripDraft({ brandId: "b-1" }, "owner");
    expect(calls.map((c) => c.fn)).toContain("biz_create_trip_draft");

    calls.length = 0;
    await upsertTripDays(EVENT_ID, [{ ordinal: 1, title: "Day one" }]);
    expect(calls[0]?.fn).toBe("biz_apply_trip_draft_graph");
    expect((calls[0]?.args.p_patch as { days: unknown[] }).days).toHaveLength(1);

    calls.length = 0;
    await upsertTripInclusions(EVENT_ID, [
      { kind: "included", item: "Transfer", ordinal: 0 },
    ]);
    expect(calls[0]?.fn).toBe("biz_apply_trip_draft_graph");
    expect(
      (calls[0]?.args.p_patch as { inclusions: unknown[] }).inclusions,
    ).toHaveLength(1);

    calls.length = 0;
    await removeTripPricingTier(EVENT_ID, "tt-1");
    const removal = calls.find((c) => c.fn === "biz_apply_trip_draft_graph");
    expect(removal).toBeDefined();
    expect(
      (removal?.args.p_patch as { tiers: { deleted?: boolean }[] }).tiers[0]
        .deleted,
    ).toBe(true);

    calls.length = 0;
    await updateLiveTripFields(
      EVENT_ID,
      { title: "Renamed" },
      "Organiser corrected the published title",
    );
    expect(calls[0]?.fn).toBe("biz_update_trip_live_command");
    // The established shared top-level vocabulary is forwarded verbatim — the
    // grouped-only allowlist made this dead on all three surfaces once already.
    expect(calls[0]?.args.p_patch).toEqual({ title: "Renamed" });

    calls.length = 0;
    const deleted = await softDeleteTrip(EVENT_ID);
    expect(calls[0]?.fn).toBe("biz_soft_delete_trip");
    expect(deleted.rejected).toBe(false);
  });

  test("every mutation carries the current revision and an operation id", async () => {
    await upsertTripDays(EVENT_ID, []);
    await upsertTripInclusions(EVENT_ID, []);
    await updateLiveTripFields(EVENT_ID, { title: "x" }, "A ten char reason.");
    await softDeleteTrip(EVENT_ID);

    const mutations = calls.filter((call) => call.fn.startsWith("biz_"));
    expect(mutations.length).toBeGreaterThanOrEqual(4);
    for (const call of mutations) {
      expect(call.args.p_expected_updated_at).toBe(REVISION);
      expect(String(call.args.p_operation_id)).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });

  test("a caller-supplied operation id is used verbatim, not replaced", async () => {
    const operationId = "19710000-0000-4000-8000-0000000000c1";
    await upsertTripDays(EVENT_ID, [], { operationId });
    expect(calls[0]?.args.p_operation_id).toBe(operationId);
  });
});

describe("issue #1971 — operation-id stability", () => {
  test("the same variables object keeps its id; a new object gets a new one", () => {
    const variables = { eventId: EVENT_ID, days: [] };
    const first = operationIdFor(variables);
    const retry = operationIdFor(variables);
    expect(retry).toBe(first);

    // A deliberate second edit constructs new variables, so it must NOT be
    // swallowed as a replay of the first.
    const deliberateSecondEdit = { eventId: EVENT_ID, days: [] };
    expect(operationIdFor(deliberateSecondEdit)).not.toBe(first);

    // Fixture sanity: the two objects really are distinct-but-equal, so the
    // assertion above measures identity and not a value difference.
    expect(deliberateSecondEdit).toEqual(variables);
    expect(deliberateSecondEdit).not.toBe(variables);
  });

  test("minted ids are v4-shaped and unique", () => {
    const minted = new Set(
      Array.from({ length: 64 }, () => newTripOperationId()),
    );
    expect(minted.size).toBe(64);
    for (const id of minted) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });
});
