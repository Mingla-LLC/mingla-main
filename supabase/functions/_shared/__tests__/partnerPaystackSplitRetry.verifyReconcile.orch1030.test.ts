// #1030 [partner verify-by-reference] — IMPLEMENTOR happy-path regression for
// runPartnerPaystackSplitSweep's reconcile-first block (SPEC AMENDMENT A1,
// SWEEP-ONLY placement).
//
// THE LOOP BUG (F-1): a lost initiate response leaves a code-less pending row
// whose deterministic reference `psplit_<id>_a<attempt>` is already burned at
// Paystack. Before this fix the sweep re-initiated blind → 400
// `duplicate_transfer_reference` → classified retryable → SAME reference next
// sweep → forever. The fix reads Paystack BY REFERENCE first and reconciles.
//
// This file proves:
//   * SC-1 (happy) — reference verifies `success` → reconcile to transferred,
//     NEVER initiate (the loop is broken).
//   * SC-4 — verify throws a DEFINITIVE 404 not-found → initiate EXACTLY ONCE.
//   * SC-5 — verify throws a TRANSIENT 503 → NO initiate this sweep (skipped).
//
// FAILS-ON-REVERT: delete the reconcile-first block in
// partner-paystack-split-retry/index.ts (the code-less ELSE branch prologue)
// and the SC-1 case routes the row straight to attemptTransferForSplit → the
// duplicate-400 throw → `initiateTransfer` called >=1 and
// `mark_partner_split_transferred` called 0 → both SC-1 assertions flip RED.
// fails-on-revert verified at 13b719bd9 (index.ts reverted to origin/main →
// all 3 tests RED: 0 passed, 3 failed; restored → 3 passed, 0 failed).
//
// NO live Paystack calls — deps injected. Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real \
//   deno test --allow-env --allow-net --allow-read \
//     supabase/functions/_shared/__tests__/partnerPaystackSplitRetry.verifyReconcile.orch1030.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { runPartnerPaystackSplitSweep } from "../../partner-paystack-split-retry/index.ts";
import type { PaystackPartnerSplitDeps } from "../paystackPartnerSplits.ts";
import { PaystackApiError } from "../paystack.ts";

const SPLIT_ID = "11111111-2222-3333-4444-555555555555";
const ORDER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PARTNER_ID = "12121212-3434-5656-7878-909090909090";
const BRAND_ID = "99999999-8888-7777-6666-555555555555";
const KEY = "paystack:MGL-REF-1";

/** A lost-response row: code-less, pending, attempt 0, reference already burned. */
function codelessRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: SPLIT_ID,
    stripe_application_fee_id: KEY,
    order_id: ORDER_ID,
    brand_id: BRAND_ID,
    partner_account_id: PARTNER_ID,
    partner_share_cents: 1500,
    attempt_count: 0,
    error_message: null,
    stripe_transfer_id: null,
    ...overrides,
  };
}

interface FakeDbState {
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
          // Sweep issues capped-rows first (empty here), then the batch.
          const which = listCallIndex++;
          const data = which === 0 ? [] : (state.pendingRows ?? []);
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
            return Promise.resolve({ data: state.splitRow ?? null, error: null });
          }
          if (table === "partner_brand_links") {
            return Promise.resolve({ data: state.linkRow ?? null, error: null });
          }
          if (table === "brands") {
            return Promise.resolve({ data: { name: "Test Brand" }, error: null });
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
  verifyResolves?: Record<string, unknown>;
  verifyThrows?: Error;
  initiateThrows?: Error;
  initiateStatus?: string;
} = {}) {
  const calls: Array<{ kind: string; args: unknown }> = [];
  const deps: PaystackPartnerSplitDeps = {
    initiateTransfer: (params) => {
      calls.push({ kind: "initiateTransfer", args: params });
      if (opts.initiateThrows) return Promise.reject(opts.initiateThrows);
      return Promise.resolve({
        transfer_code: "TRF_sweep_new",
        status: opts.initiateStatus ?? "pending",
        reference: params.reference,
      });
    },
    fetchTransfer: (code) => {
      calls.push({ kind: "fetchTransfer", args: code });
      return Promise.resolve({ status: "pending" });
    },
    verifyTransferByReference: (reference: string) => {
      calls.push({ kind: "verifyTransferByReference", args: reference });
      if (opts.verifyThrows) return Promise.reject(opts.verifyThrows);
      return Promise.resolve(opts.verifyResolves ?? { status: "pending" });
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

// SC-1 (happy path) — the loop is BROKEN: a code-less pending row whose burned
// reference verifies `success` reconciles to transferred and NEVER initiates,
// even though initiateTransfer would throw the duplicate-reference 400.
Deno.test("#1030 sweep · code-less row, reference verifies SUCCESS → reconciled to transferred, ZERO initiate (loop broken)", async () => {
  const { sb, rpcCalls } = fakeSupabase({
    pendingRows: [codelessRow()],
    // recipient present so that ON REVERT the row can reach initiate (and fail).
    paystackAccount: { recipient_code: "RCP_1", detached_at: null },
    // handlePaystackTransferEvent("transfer.success") loads this row.
    splitRow: {
      id: SPLIT_ID,
      status: "pending",
      stripe_application_fee_id: KEY,
      stripe_transfer_id: null,
      attempt_count: 0,
      partner_account_id: PARTNER_ID,
      brand_id: BRAND_ID,
      order_id: ORDER_ID,
      partner_share_cents: 1500,
      transfer_currency: "ngn",
    },
  });
  const { deps, calls } = fakeDeps({
    verifyResolves: { status: "success", transfer_code: "TRF_verified_1" },
    // If the reconcile block is reverted, the row hits initiate → this throws.
    initiateThrows: new PaystackApiError(
      "Paystack transfer failed (400): the transfer reference is duplicate",
      400,
    ),
  });

  const result = await runPartnerPaystackSplitSweep(sb, deps);

  const verifyCall = calls.find((c) => c.kind === "verifyTransferByReference");
  assert(verifyCall, "verify-by-reference MUST be called before any initiate");
  assertEquals(
    verifyCall!.args,
    `psplit_${SPLIT_ID}_a0`,
    "verify uses the deterministic burned reference",
  );
  assertEquals(
    calls.filter((c) => c.kind === "initiateTransfer").length,
    0,
    "reconcile MUST NOT re-initiate (the duplicate-loop is broken)",
  );
  assertEquals(
    rpcCalls.filter((c) => c.name === "mark_partner_split_transferred").length,
    1,
    "the burned transfer is reconciled to transferred exactly once",
  );
  assertEquals(result.transferred, 1);
});

// SC-4 — a DEFINITIVE 404 (the transfer never processed) is the ONLY verify
// outcome that reaches the initiate path, and it initiates EXACTLY ONCE.
Deno.test("#1030 sweep · code-less row, verify throws 404 (definitive) → initiate EXACTLY once", async () => {
  const { sb } = fakeSupabase({
    pendingRows: [codelessRow()],
    paystackAccount: { recipient_code: "RCP_1", detached_at: null },
  });
  const { deps, calls } = fakeDeps({
    verifyThrows: new PaystackApiError(
      "Paystack verify-transfer-by-reference failed (404): Transfer not found",
      404,
    ),
    initiateStatus: "success",
  });

  const result = await runPartnerPaystackSplitSweep(sb, deps);

  assert(
    calls.some((c) => c.kind === "verifyTransferByReference"),
    "verify runs before the definitive fall-through",
  );
  assertEquals(
    calls.filter((c) => c.kind === "initiateTransfer").length,
    1,
    "definitive not-found → initiate exactly once (never zero, never twice)",
  );
  assertEquals(result.transferred, 1);
});

// SC-5 — a TRANSIENT 503 (verify itself failed; outcome unknown) MUST NOT
// initiate this sweep — never risk a double-pay on ambiguity.
Deno.test("#1030 sweep · code-less row, verify throws 503 (transient) → ZERO initiate, skipped", async () => {
  const { sb } = fakeSupabase({
    pendingRows: [codelessRow()],
    paystackAccount: { recipient_code: "RCP_1", detached_at: null },
  });
  const { deps, calls } = fakeDeps({
    verifyThrows: new PaystackApiError(
      "Paystack verify-transfer-by-reference failed (503): service unavailable",
      503,
    ),
  });

  const result = await runPartnerPaystackSplitSweep(sb, deps);

  assert(calls.some((c) => c.kind === "verifyTransferByReference"));
  assertEquals(
    calls.filter((c) => c.kind === "initiateTransfer").length,
    0,
    "transient verify error → NO initiate this sweep (money-safe)",
  );
  assertEquals(result.skipped, 1);
});
