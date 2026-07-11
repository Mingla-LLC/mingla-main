// ORCH-1331 [partner Paystack payout rail] — T-10 sweep leg for
// partner-paystack-split-retry (runPartnerPaystackSplitSweep).
//
//   * a pending row with NO transfer_code re-attempts with the SAME reference
//     (attempt_count unchanged → psplit_<id>_a<n> reuse; insufficient-balance
//     failures never bump);
//   * a pending row WITH a transfer_code is RECONCILED first (GET /transfer):
//     success → transferred (no double-initiate), pending → skipped;
//   * rows at the attempt cap are finalized 'failed' + ONE ops alert
//     (idempotent via the status flip);
//   * a row whose partner detached the recipient → blocked_no_paystack;
//   * one row's failure never stops the sweep (per-row try/catch).
//
// NO live Paystack calls — deps injected. Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real \
//   deno test --allow-env --allow-net --allow-read \
//     supabase/functions/_shared/__tests__/partnerPaystackSplitRetry.orch1331.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { runPartnerPaystackSplitSweep } from "../../partner-paystack-split-retry/index.ts";
import {
  MAX_PAYSTACK_TRANSFER_ATTEMPTS,
  type PaystackPartnerSplitDeps,
} from "../paystackPartnerSplits.ts";
import { PaystackApiError } from "../paystack.ts";

const SPLIT_ID = "11111111-2222-3333-4444-555555555555";
const ORDER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PARTNER_ID = "12121212-3434-5656-7878-909090909090";
const KEY = "paystack:MGL-REF-1";

function sweepRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: SPLIT_ID,
    stripe_application_fee_id: KEY,
    order_id: ORDER_ID,
    brand_id: "99999999-8888-7777-6666-555555555555",
    partner_account_id: PARTNER_ID,
    partner_share_cents: 1500,
    attempt_count: 2,
    error_message: null,
    stripe_transfer_id: null,
    ...overrides,
  };
}

interface FakeDbState {
  cappedRows?: Array<Record<string, unknown>>;
  pendingRows?: Array<Record<string, unknown>>;
  paystackAccount?: Record<string, unknown> | null;
  splitRow?: Record<string, unknown> | null; // transfer-event row loads
  linkRow?: Record<string, unknown> | null;
}

function fakeSupabase(state: FakeDbState) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  let listCallIndex = 0;

  // deno-lint-ignore no-explicit-any
  const sb: any = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const builder = {
        _cols: "",
        select(cols: string) {
          this._cols = cols;
          return this;
        },
        eq() {
          return this;
        },
        gte() {
          return this;
        },
        lt() {
          return this;
        },
        is() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          // List select — the sweep issues capped-rows first, then the batch.
          const which = listCallIndex++;
          const data = which === 0
            ? (state.cappedRows ?? [])
            : (state.pendingRows ?? []);
          return Promise.resolve({ data, error: null });
        },
        maybeSingle() {
          if (table === "partner_paystack_accounts") {
            return Promise.resolve({
              data: state.paystackAccount ?? null,
              error: null,
            });
          }
          if (table === "partner_splits") {
            return Promise.resolve({
              data: state.splitRow ?? null,
              error: null,
            });
          }
          if (table === "partner_brand_links") {
            return Promise.resolve({
              data: state.linkRow ?? null,
              error: null,
            });
          }
          if (table === "brands") {
            return Promise.resolve({
              data: { name: "Test Brand" },
              error: null,
            });
          }
          if (table === "orders") {
            return Promise.resolve({ data: { event_id: null }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        update(values: Record<string, unknown>) {
          updates.push({ table, values });
          const chain = {
            eq: () => chain,
            is: () => Promise.resolve({ data: null, error: null }),
            then: (resolve: (v: unknown) => void) =>
              resolve({ data: null, error: null }),
          };
          return chain;
        },
        insert() {
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { sb, rpcCalls, updates };
}

function fakeDeps(opts: {
  transferStatus?: string;
  transferThrows?: Error;
  fetchTransferStatus?: string;
} = {}) {
  const calls: Array<{ kind: string; args: unknown }> = [];
  const deps: PaystackPartnerSplitDeps = {
    initiateTransfer: (params) => {
      calls.push({ kind: "initiateTransfer", args: params });
      if (opts.transferThrows) return Promise.reject(opts.transferThrows);
      return Promise.resolve({
        transfer_code: "TRF_sweep_1",
        status: opts.transferStatus ?? "pending",
        reference: params.reference,
      });
    },
    fetchTransfer: (code) => {
      calls.push({ kind: "fetchTransfer", args: code });
      return Promise.resolve({ status: opts.fetchTransferStatus ?? "pending" });
    },
    sendOpsAlert: (input) => {
      calls.push({ kind: "sendOpsAlert", args: input });
      return Promise.resolve({ attempted: 1, succeeded: 1, failed: 0 });
    },
    // deno-lint-ignore no-explicit-any
    notify: ((input: unknown) => {
      calls.push({ kind: "notify", args: input });
      return Promise.resolve();
    }) as any,
  };
  return { deps, calls };
}

Deno.test("T-10 sweep · pending row, no transfer_code → re-attempt with SAME reference (attempt unchanged)", async () => {
  const { sb } = fakeSupabase({
    pendingRows: [sweepRow({ attempt_count: 2 })],
    paystackAccount: { recipient_code: "RCP_1", detached_at: null },
  });
  const { deps, calls } = fakeDeps({
    transferThrows: new PaystackApiError(
      "Paystack transfer failed (400): Your balance is not enough",
      400,
    ),
  });
  const result = await runPartnerPaystackSplitSweep(sb, deps);
  assertEquals(result.scanned, 1);
  assertEquals(result.retried, 1);
  const init = calls.find((c) => c.kind === "initiateTransfer");
  assertEquals(
    (init!.args as { reference: string }).reference,
    `psplit_${SPLIT_ID}_a2`,
    "insufficient balance re-uses the SAME reference (attempt not burned)",
  );
});

Deno.test("T-10 sweep · immediate success on retry → transferred", async () => {
  const { sb, rpcCalls } = fakeSupabase({
    pendingRows: [sweepRow()],
    paystackAccount: { recipient_code: "RCP_1", detached_at: null },
  });
  const { deps } = fakeDeps({ transferStatus: "success" });
  const result = await runPartnerPaystackSplitSweep(sb, deps);
  assertEquals(result.transferred, 1);
  assert(
    rpcCalls.some((c) => c.name === "mark_partner_split_transferred"),
    "transferred RPC fired",
  );
});

Deno.test("T-10 sweep · in-flight transfer_code is RECONCILED first — success → transferred, no double-initiate", async () => {
  const { sb, rpcCalls } = fakeSupabase({
    pendingRows: [sweepRow({ stripe_transfer_id: "TRF_prior" })],
    splitRow: {
      id: SPLIT_ID,
      status: "pending",
      stripe_application_fee_id: KEY,
      stripe_transfer_id: "TRF_prior",
      attempt_count: 2,
      partner_account_id: PARTNER_ID,
      brand_id: "99999999-8888-7777-6666-555555555555",
      order_id: ORDER_ID,
      partner_share_cents: 1500,
      transfer_currency: "ngn",
    },
  });
  const { deps, calls } = fakeDeps({ fetchTransferStatus: "success" });
  const result = await runPartnerPaystackSplitSweep(sb, deps);
  assertEquals(result.transferred, 1);
  assertEquals(
    calls.filter((c) => c.kind === "initiateTransfer").length,
    0,
    "reconcile MUST NOT re-initiate (duplicate-pay guard)",
  );
  assert(rpcCalls.some((c) => c.name === "mark_partner_split_transferred"));
});

Deno.test("T-10 sweep · in-flight transfer still pending → skipped (webhook/next sweep settles)", async () => {
  const { sb } = fakeSupabase({
    pendingRows: [sweepRow({ stripe_transfer_id: "TRF_prior" })],
  });
  const { deps, calls } = fakeDeps({ fetchTransferStatus: "pending" });
  const result = await runPartnerPaystackSplitSweep(sb, deps);
  assertEquals(result.skipped, 1);
  assertEquals(calls.filter((c) => c.kind === "initiateTransfer").length, 0);
});

Deno.test("T-10 sweep · capped rows finalize failed + ONE ops alert", async () => {
  const { sb, rpcCalls } = fakeSupabase({
    cappedRows: [
      sweepRow({ attempt_count: MAX_PAYSTACK_TRANSFER_ATTEMPTS }),
    ],
    pendingRows: [],
  });
  const { deps, calls } = fakeDeps();
  const result = await runPartnerPaystackSplitSweep(sb, deps);
  assertEquals(result.failed, 1);
  const failedRpc = rpcCalls.find((c) => c.name === "mark_partner_split_failed");
  assert(failedRpc, "cap → mark_partner_split_failed");
  assertEquals(failedRpc!.args.p_reason, "failed");
  assertEquals(calls.filter((c) => c.kind === "sendOpsAlert").length, 1);
});

Deno.test("T-10 sweep · detached recipient → blocked_no_paystack", async () => {
  const { sb, rpcCalls } = fakeSupabase({
    pendingRows: [sweepRow()],
    paystackAccount: {
      recipient_code: "RCP_1",
      detached_at: "2026-07-01T00:00:00Z",
    },
  });
  const { deps, calls } = fakeDeps();
  const result = await runPartnerPaystackSplitSweep(sb, deps);
  assertEquals(result.failed, 1);
  const failedRpc = rpcCalls.find((c) => c.name === "mark_partner_split_failed");
  assertEquals(failedRpc!.args.p_reason, "blocked_no_paystack");
  assertEquals(calls.filter((c) => c.kind === "initiateTransfer").length, 0);
});

Deno.test("T-10 sweep · one row's throw never stops the sweep", async () => {
  const rowA = sweepRow({ id: SPLIT_ID });
  const rowB = sweepRow({
    id: "22222222-3333-4444-5555-666666666666",
    stripe_application_fee_id: "paystack:MGL-REF-2",
  });
  let attemptCalls = 0;
  const { sb } = fakeSupabase({
    pendingRows: [rowA, rowB],
    paystackAccount: { recipient_code: "RCP_1", detached_at: null },
  });
  const { deps } = fakeDeps({ transferStatus: "pending" });
  const flakyDeps: PaystackPartnerSplitDeps = {
    ...deps,
    initiateTransfer: (params) => {
      attemptCalls += 1;
      if (attemptCalls === 1) {
        // Non-PaystackApiError throw INSIDE the row → per-row catch. Use a
        // supabase failure shape instead: simulate by throwing synchronously
        // from the deps boundary — the engine classifies non-ApiError as
        // retryable, so to prove the PER-ROW catch we throw from fetchTransfer
        // on a reconcile row instead. Here: just resolve normally.
        return Promise.resolve({
          transfer_code: "TRF_A",
          status: "pending",
          reference: params.reference,
        });
      }
      return Promise.resolve({
        transfer_code: "TRF_B",
        status: "pending",
        reference: params.reference,
      });
    },
    fetchTransfer: () => Promise.reject(new Error("reconcile exploded")),
  };
  // Make row A a reconcile row so fetchTransfer throws inside its per-row scope.
  rowA.stripe_transfer_id = "TRF_prior";
  const result = await runPartnerPaystackSplitSweep(sb, flakyDeps);
  assertEquals(result.scanned, 2);
  assertEquals(result.skipped, 1, "row A absorbed by the per-row catch");
  assertEquals(result.retried, 1, "row B still processed");
});
