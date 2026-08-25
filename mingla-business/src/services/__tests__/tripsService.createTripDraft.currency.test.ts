/* eslint-disable import/first */
/**
 * ORCH-0859 [Tr2 Minimum Viable Trip] — createTripDraft currency regression.
 *
 * Pins the fix for the P0 bug (caught at operator live-fire after the prior
 * QA turn): `createTripDraft` MUST set `currency` on the events INSERT row.
 *
 * Bug mechanics:
 *   1. createTripDraft INSERTs into `events`
 *   2. createTripDraft INSERTs into `ticket_types` (one placeholder row)
 *   3. The `tg_enforce_event_ticket_currency` trigger on ticket_types
 *      (supabase/migrations/20260515000011_orch_0769_no_implicit_gbp_currency.sql:159)
 *      looks up the parent event's currency. If NULL → RAISE
 *      `event_currency_not_found`.
 *
 * The fix: fetch `brands.default_currency` BEFORE the events INSERT and
 * include `currency: defaultCurrency` in the events payload. Mirrors
 * `eventDrafts.fetchBrandDefaultCurrency` + `draftToServerInsert` ordering
 * for event_type='event'.
 *
 * Fails-on-revert: removing `currency: defaultCurrency` from the events
 * insert payload causes the `currencyOnEventsInsert` assertion below to
 * fail because the captured payload no longer carries the field.
 *
 * [TEST-MOD-APPROVED #1971] The INVARIANT is unchanged — a trip draft carries
 * its brand's currency, and a currency-less brand still yields NULL, never a
 * fabricated USD. What moved is WHO enforces it. Issue #1971 replaced the
 * client's three-statement create (events + ticket_types + trip_pricing_tiers)
 * with one atomic `biz_create_trip_draft` call that derives the currency
 * server-side under a row lock, so there is no longer a client-side events
 * insert payload to capture. Exactly two assertions are invalidated — the two
 * `capturedEventsInsertPayload` reads — and each is re-pinned at the seam that
 * now owns the rule:
 *   1. the service performs NO events / ticket_types / trip_pricing_tiers
 *      write and never sends a currency, so it cannot fabricate one;
 *   2. the migration reads `brands.default_currency` and contains no 'USD'
 *      literal, so a NULL brand currency is carried through as NULL.
 * That is strictly stronger than the old capture: the previous version only
 * proved the FIRST of three statements was well formed, and could not see a
 * failure between them.
 */

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fromMock = jest.fn() as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authGetUserMock = jest.fn() as any;
// [TEST-MOD-APPROVED #1971] the canonical create is an RPC, so the mock needs one.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcMock = jest.fn() as any;

jest.mock("../supabase", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
    auth: {
      getUser: () => authGetUserMock(),
    },
  },
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createTripDraft } from "../tripsService";
import { createChainableQuery } from "./__helpers__/supabaseMock";

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
  authGetUserMock.mockReset();
});

describe("ORCH-0859 / issue #1971 — a trip draft carries its brand currency, never a fabricated one", () => {
  test("createTripDraft sends no currency of its own and writes no table directly", async () => {
    authGetUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-1" } },
    });

    const capturedRpcs: { fn: string; args: Record<string, unknown> }[] = [];
    rpcMock.mockImplementation((fn: string, args: Record<string, unknown>) => {
      capturedRpcs.push({ fn, args });
      if (fn === "biz_create_trip_draft") {
        return Promise.resolve({
          data: { event: { id: "event-1" }, revision: "2026-05-17T00:00:00Z" },
          error: null,
        });
      }
      return Promise.resolve({ data: 0, error: null });
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
            id: "event-1",
            brand_id: "brand-1",
            title: "Untitled trip",
            description: null,
            slug: "draft-x",
            status: "draft",
            visibility: "draft",
            published_at: null,
            timezone: "UTC",
            currency: "EUR",
            cover_media_url: null,
            cover_media_type: null,
            theme: { business_trip: {} },
            event_type: "trip",
            created_at: "2026-05-17T00:00:00Z",
            updated_at: "2026-05-17T00:00:00Z",
            brands: { slug: "travelbrand" },
          },
          error: null,
        }),
      // Any INSERT/UPDATE/DELETE from the client is now a contract violation.
      insert: () => {
        throw new Error("createTripDraft wrote to events directly");
      },
      update: () => {
        throw new Error("createTripDraft wrote to events directly");
      },
    };
    const forbid = (table: string) => ({
      insert: () => {
        throw new Error(`createTripDraft wrote to ${table} directly`);
      },
      update: () => {
        throw new Error(`createTripDraft wrote to ${table} directly`);
      },
      delete: () => {
        throw new Error(`createTripDraft wrote to ${table} directly`);
      },
      select: () => createChainableQuery({ data: [] }),
    });

    fromMock.mockImplementation((table: string) => {
      if (table === "events") return eventsChain;
      return forbid(table);
    });

    const trip = await createTripDraft({ brandId: "brand-1" }, "owner");

    const rpcCall = capturedRpcs.find(
      (call) => call.fn === "biz_create_trip_draft",
    );
    expect(rpcCall).toBeDefined();
    if (rpcCall === undefined) throw new Error("unreachable");
    expect(rpcCall.fn).toBe("biz_create_trip_draft");
    expect(rpcCall.args.p_brand_id).toBe("brand-1");
    // The seed allowlist carries no currency at all — the client cannot
    // fabricate one even by accident.
    expect(JSON.stringify(rpcCall.args.p_seed)).not.toMatch(/currency/i);
    // The created trip is read back through the canonical reader, so the graph
    // the command wrote is what the wizard opens.
    expect(trip.id).toBe("event-1");
    expect(trip.status).toBe("draft");
    // Executable proof that the brand's currency actually lands on the created
    // row lives in the PostgreSQL 17 guard
    // (supabase/migrations/__tests__/issue_1971_trip_lifecycle.implementor.happy.pg17.test.sql,
    // assertion A-06), which is the only place it can be measured for real.
  });

  // issue #1014 — a currency-less brand's trip draft carries NULL, no fabricated
  // USD. issue #1971 moved the derivation into the canonical command, so this is
  // now asserted against the command's own source.
  test("the canonical create derives the brand currency and contains no USD literal [#1014]", () => {
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
      "CREATE OR REPLACE FUNCTION public.biz_create_trip_draft(",
    );
    expect(start).toBeGreaterThan(-1);
    const body = migration.slice(start, migration.indexOf("$fn$;", start));

    // The currency comes from the brand row, server-side.
    expect(body).toMatch(
      /SELECT default_currency INTO v_currency\s*\n\s*FROM public\.brands WHERE id = p_brand_id AND deleted_at IS NULL;/,
    );
    // NULL is passed straight through: no COALESCE, no literal fallback.
    expect(body).not.toMatch(/COALESCE\(\s*v_currency/);
    expect(body).not.toMatch(/'USD'/);
    // The sanity check that makes the two assertions above non-vacuous: the
    // slice really is the create command's body and really does insert the
    // event and its placeholder ticket with that derived currency.
    expect(body).toMatch(/INSERT INTO public\.events\(/);
    expect(body).toMatch(/INSERT INTO public\.ticket_types\(/);
    expect(body.match(/v_currency/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
