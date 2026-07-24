import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { handleChargeSucceeded } from "../../_shared/partnerSplits.ts";
import { handlePaystackPartnerSplit } from "../../_shared/paystackPartnerSplits.ts";
import { releasePartnerSplitsForOrganiserRelease } from "../partnerRelease.ts";

const migration = await Deno.readTextFile(
  "supabase/migrations/20270110000003_issue_1174_partner_payout_deferral.sql",
);
const sweepIndex = await Deno.readTextFile(
  "supabase/functions/payout-release-sweep/index.ts",
);

type RpcCall = { name: string; args: Record<string, unknown> };
type FromCall = { table: string; op: string; payload?: unknown };

function queryResult(
  table: string,
  filters: Array<[string, unknown]>,
): Record<string, unknown> | null {
  if (table === "orders") {
    return filters.some(([column]) => column === "id")
      ? {
        id: "order-1",
        currency: "NGN",
        stripe_application_fee_amount_cents: 10_000,
        event_id: "event-1",
        events: { brand_id: "brand-1" },
      }
      : null;
  }
  if (table === "brands") {
    return { payout_hold_cutover_at: "2026-07-24T00:00:00.000Z" };
  }
  if (table === "partner_stripe_connect_accounts") {
    return {
      account_id: "partner-1",
      stripe_account_id: "acct_partner_1",
      charges_enabled: true,
      payouts_enabled: true,
      external_account_currencies: ["usd"],
      detached_at: null,
    };
  }
  return null;
}

function fakeSupabase(
  releaseRows: Array<Record<string, unknown>> = [],
  partnerLookup: string | null = "partner-1",
) {
  const rpcCalls: RpcCall[] = [];
  const fromCalls: FromCall[] = [];
  const client = {
    rpc: (
      name: string,
      args: Record<string, unknown>,
    ): Promise<{ data: unknown; error: null }> => {
      rpcCalls.push({ name, args });
      if (name === "resolve_partner_for_brand_at_time") {
        return Promise.resolve({ data: partnerLookup, error: null });
      }
      if (name === "record_held_partner_split") {
        return Promise.resolve({
          data: { id: "split-held", status: "held" },
          error: null,
        });
      }
      if (name === "release_partner_splits_for_organiser_release") {
        return Promise.resolve({ data: releaseRows, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      const chain = {
        select: (_columns: string) => chain,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        is: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        update: (payload: unknown) => {
          fromCalls.push({ table, op: "update", payload });
          return chain;
        },
        maybeSingle: () => {
          fromCalls.push({ table, op: "maybeSingle" });
          return Promise.resolve({
            data: queryResult(table, filters),
            error: null,
          });
        },
      };
      return chain;
    },
  };
  return { client, rpcCalls, fromCalls };
}

function fakeStripe() {
  const calls: Array<
    { payload: Record<string, unknown>; options: Record<string, unknown> }
  > = [];
  return {
    stripe: {
      transfers: {
        create: (
          payload: Record<string, unknown>,
          options: Record<string, unknown>,
        ) => {
          calls.push({ payload, options });
          return Promise.resolve({ id: "tr_platform_balance_1" });
        },
      },
    },
    calls,
  };
}

Deno.test("post-cutover Stripe charge records held and performs no transfer", async () => {
  const { client, rpcCalls } = fakeSupabase();
  const { stripe, calls } = fakeStripe();
  const result = await handleChargeSucceeded(
    client as never,
    stripe as never,
    {
      id: "evt-1",
      type: "charge.succeeded",
      data: {
        object: {
          id: "ch_connected_direct_1",
          application_fee: "fee-1",
          application_fee_amount: 1_000,
          currency: "usd",
          created: 1_784_937_600,
          metadata: { mingla_order_id: "order-1" },
        },
      },
    },
  );

  assertEquals(result, { brandId: "brand-1", status: "held" });
  assertEquals(calls.length, 0);
  const attribution = rpcCalls.find((call) =>
    call.name === "record_payout_partner_attribution"
  );
  assert(attribution);
  assertEquals(
    attribution.args.p_provider_sale_at,
    "2026-07-25T00:00:00.000Z",
  );
  assertEquals(attribution.args.p_partner_account_id, "partner-1");
  const record = rpcCalls.find((call) =>
    call.name === "record_held_partner_split"
  );
  assert(record);
  assertEquals(record.args.p_partner_share_cents, 100);
  assertEquals(record.args.p_provider, "stripe");
  assertEquals(
    record.args.p_provider_sale_at,
    attribution.args.p_provider_sale_at,
  );
  assertFalse(
    rpcCalls.some((call) => call.name === "record_partner_split_attempt"),
  );
});

Deno.test("post-cutover Paystack charge records held and performs no transfer", async () => {
  const { client, rpcCalls } = fakeSupabase();
  let initiated = 0;
  const result = await handlePaystackPartnerSplit(
    client as never,
    {
      reference: "paystack-ref-1",
      orderId: "order-1",
      paidAtIso: "2026-07-25T00:00:00.000Z",
    },
    {
      initiateTransfer: (() => {
        initiated++;
        return Promise.resolve({} as never);
      }) as never,
      fetchTransfer: (() => Promise.resolve({} as never)) as never,
      sendOpsAlert: (() => Promise.resolve()) as never,
      notify: (() => Promise.resolve()) as never,
    },
  );

  assertEquals(result, { brandId: "brand-1", status: "held" });
  assertEquals(initiated, 0);
  const attribution = rpcCalls.find((call) =>
    call.name === "record_payout_partner_attribution"
  );
  assert(attribution);
  assertEquals(
    attribution.args.p_provider_sale_at,
    "2026-07-25T00:00:00.000Z",
  );
  assertEquals(attribution.args.p_partner_account_id, "partner-1");
  const record = rpcCalls.find((call) =>
    call.name === "record_held_partner_split"
  );
  assert(record);
  assertEquals(record.args.p_partner_share_cents, 1_000);
  assertEquals(record.args.p_provider, "paystack");
  assertEquals(
    record.args.p_provider_sale_at,
    attribution.args.p_provider_sale_at,
  );
});

Deno.test("post-cutover no-partner outcome is durable and creates no held split", async () => {
  const { client, rpcCalls } = fakeSupabase([], null);
  const { stripe, calls } = fakeStripe();
  const result = await handleChargeSucceeded(
    client as never,
    stripe as never,
    {
      id: "evt-no-partner",
      type: "charge.succeeded",
      data: {
        object: {
          id: "ch_no_partner",
          application_fee: "fee-no-partner",
          application_fee_amount: 1_000,
          currency: "usd",
          created: 1_784_937_600,
          metadata: { mingla_order_id: "order-1" },
        },
      },
    },
  );

  assertEquals(result, { brandId: "brand-1", status: "no_partner" });
  assertEquals(calls.length, 0);
  const attribution = rpcCalls.find((call) =>
    call.name === "record_payout_partner_attribution"
  );
  assert(attribution);
  assertEquals(attribution.args.p_partner_account_id, null);
  assertEquals(attribution.args.p_partner_share_cents, 0);
  assertFalse(
    rpcCalls.some((call) => call.name === "record_held_partner_split"),
  );
});

Deno.test("released occurrence triggers one plain Stripe platform transfer and one Paystack pending leg", async () => {
  const { client, rpcCalls, fromCalls } = fakeSupabase([
    {
      id: "00000000-0000-0000-0000-000000000001",
      provider: "stripe",
      stripe_application_fee_id: "fee-1",
      order_id: "order-1",
      brand_id: "brand-1",
      partner_account_id: "partner-1",
      partner_share_cents: 100,
      transfer_currency: "usd",
    },
    {
      id: "00000000-0000-0000-0000-000000000002",
      provider: "paystack",
      stripe_application_fee_id: "paystack:ref-1",
      order_id: "order-2",
      brand_id: "brand-1",
      partner_account_id: "partner-2",
      partner_share_cents: 5_000,
      transfer_currency: "ngn",
    },
  ]);
  const { stripe, calls } = fakeStripe();

  const result = await releasePartnerSplitsForOrganiserRelease(
    client as never,
    stripe as never,
    "release-1",
  );

  assertEquals(result, {
    releasedStripe: 1,
    pendingPaystack: 1,
    retryableStripe: 0,
    blockedStripe: 0,
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].payload.amount, 100);
  assertEquals(calls[0].payload.destination, "acct_partner_1");
  assertFalse("source_transaction" in calls[0].payload);
  assertEquals(calls[0].options.idempotencyKey, "partner_split_fee-1");
  assert(
    rpcCalls.some((call) => call.name === "mark_partner_split_transferred"),
  );
  assert(
    fromCalls.some((call) =>
      call.table === "payout_transfer_legs" &&
      call.op === "update" &&
      (call.payload as { status?: string }).status === "succeeded"
    ),
  );
});

Deno.test("Paystack partner movement fee reduces organiser cash without reducing partner principal", () => {
  assertStringIncludes(
    migration,
    "estimated_fee_cents + stamp_duty_cents",
  );
  assertStringIncludes(
    migration,
    "+ maturity_recredit_cents - v_partner_cost",
  );
  assertStringIncludes(
    migration,
    "v_split.partner_share_cents,\n        v_fee,\n        v_stamp",
  );
  assertStringIncludes(
    migration,
    "v_split.partner_share_cents < 5000",
  );
});

Deno.test("organiser execution blocks until provider-sale partner attribution is persisted", () => {
  assertStringIncludes(
    migration,
    "CREATE TABLE public.payout_partner_attributions",
  );
  assertStringIncludes(
    migration,
    "a.partner_share_cents AS expected_partner_share_cents",
  );
  assertStringIncludes(
    migration,
    "'blocked_partner_attributions', v_blocked_attributions",
  );
  const blocker = sweepIndex.indexOf(
    'error: "partner_attribution_pending"',
  );
  const providerRelease = sweepIndex.indexOf(
    'from("brand_payout_releases")',
  );
  assert(blocker >= 0);
  assert(providerRelease > blocker);
});
