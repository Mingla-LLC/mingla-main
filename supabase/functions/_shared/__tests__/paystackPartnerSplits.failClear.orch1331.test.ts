// ORCH-1331 [partner Paystack payout rail] — REWORK regression suite for
// P1-1331-STALE-TRANSFER-CODE (implementor happy-path; the tester's DP-7 in
// paystackPartnerSplits.doublePay.tester.orch1331.test.ts is the adversarial
// end-to-end acceptance test).
//
// Pins the transfer.failed handler contract after the rework:
//   R-1  DEFINITIVE transfer.failed on the row's CURRENT in-flight transfer,
//        below the cap → attempt bumped AND stripe_transfer_id +
//        payout_reference CLEARED (guarded id + status='pending') so the
//        reconcile-first sweep takes the INITIATE path with the NEW
//        psplit_<id>_a<attempt+1> reference (SC-9 / SPEC §4.5.3).
//   R-2  Replayed transfer.failed AFTER the clear (row has no transfer code)
//        → total no-op: no second bump, no update — idempotent.
//   R-3  Stale transfer.failed for an OLDER attempt (event transfer_code ≠
//        the row's current in-flight code) → no-op: never bumps for, or
//        clears, a DIFFERENT in-flight transfer.
//   R-4  Stale transfer.failed with NO transfer_code but a mismatched
//        reference attempt (_a0 vs row attempt_count=1) → no-op.
//   R-5  At the cap: finalize 'failed' + ONE ops alert, and the dead
//        transfer code is KEPT on the terminal row (forensics) — no clear.
//   R-6  P2-1331-DUPLICATE-REFERENCE-SHAPE defense-in-depth: a 4xx
//        "duplicate reference / already exists" initiate error classifies
//        RETRYABLE — no attempt bump, error noted, SAME reference next sweep
//        (a new reference could double-pay the in-flight original).
//
// FAILS-ON-REVERT anchors:
//   * R-1/R-2 — deleting the transfer.failed clear (+ its idempotency guard)
//     in _shared/paystackPartnerSplits.ts flips R-1 (no clear update) and
//     R-2 (double-bump) red.
//   * R-6 — deleting the duplicate-reference classification flips R-6 red
//     (definitive → bump).
//
// NO live Paystack calls (LIVE mode, real money): every network surface is
// dependency-injected; the DB is a fake supabase client. Append-only: NEW
// file; no existing test modified.
//
// Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-key deno test --allow-env --allow-net \
//     --allow-read --no-check \
//     supabase/functions/_shared/__tests__/paystackPartnerSplits.failClear.orch1331.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  attemptTransferForSplit,
  handlePaystackTransferEvent,
  MAX_PAYSTACK_TRANSFER_ATTEMPTS,
  type PaystackPartnerSplitDeps,
  type SplitAttemptContext,
} from "../paystackPartnerSplits.ts";
import { PaystackApiError } from "../paystack.ts";

const SPLIT_ID = "77777777-2222-3333-4444-555555555555";
const ORDER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const BRAND_ID = "99999999-8888-7777-6666-555555555555";
const PARTNER_ID = "12121212-3434-5656-7878-909090909090";
const KEY = "paystack:MGL-RW-REF-1";

// ---------- Fake deps (Paystack + alerts + push) ----------
function fakeDeps(opts: { transferThrows?: Error } = {}) {
  const calls: Array<{ kind: string; args: unknown }> = [];
  const deps: PaystackPartnerSplitDeps = {
    initiateTransfer: (params) => {
      calls.push({ kind: "initiateTransfer", args: params });
      if (opts.transferThrows) return Promise.reject(opts.transferThrows);
      return Promise.resolve({
        transfer_code: "TRF_rw_1",
        status: "pending",
        reference: params.reference,
      });
    },
    fetchTransfer: (code) => {
      calls.push({ kind: "fetchTransfer", args: code });
      return Promise.resolve({ status: "pending" });
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

// ---------- Fake supabase (static splitRow; updates recorded) ----------
function fakeSupabase(splitRow: Record<string, unknown> | null) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updates: Array<{
    table: string;
    values: Record<string, unknown>;
    filters: Array<{ col: string; val: unknown }>;
  }> = [];

  // deno-lint-ignore no-explicit-any
  const sb: any = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      let pendingUpdate: Record<string, unknown> | null = null;
      const filters: Array<{ col: string; val: unknown }> = [];
      const builder = {
        _cols: "",
        select(cols: string) {
          this._cols = cols;
          return this;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return this;
        },
        is() {
          return this;
        },
        maybeSingle() {
          if (table === "partner_splits") {
            return Promise.resolve({ data: splitRow, error: null });
          }
          if (table === "partner_brand_links") {
            return Promise.resolve({
              data: { first_split_at: null, accepted_at: null },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        update(values: Record<string, unknown>) {
          pendingUpdate = values;
          return this;
        },
        then(resolve: (v: unknown) => void) {
          if (pendingUpdate) {
            updates.push({ table, values: pendingUpdate, filters: [...filters] });
          }
          resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { sb, rpcCalls, updates };
}

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SPLIT_ID,
    status: "pending",
    stripe_application_fee_id: KEY,
    stripe_transfer_id: "TRF_rw_0",
    attempt_count: 0,
    partner_account_id: PARTNER_ID,
    brand_id: BRAND_ID,
    order_id: ORDER_ID,
    partner_share_cents: 1500,
    transfer_currency: "ngn",
    ...overrides,
  };
}

Deno.test("R-1 · definitive transfer.failed below cap → bump AND clear stripe_transfer_id + payout_reference (guarded id + status=pending)", async () => {
  const { sb, rpcCalls, updates } = fakeSupabase(pendingRow());
  const { deps, calls } = fakeDeps();

  await handlePaystackTransferEvent(sb, "transfer.failed", {
    reference: `psplit_${SPLIT_ID}_a0`,
    transfer_code: "TRF_rw_0",
    reason: "Recipient bank rejected the transfer",
  }, deps);

  assertEquals(
    rpcCalls.filter((c) => c.name === "bump_paystack_partner_split_attempt")
      .length,
    1,
    "exactly one attempt bump",
  );
  const clear = updates.find((u) =>
    u.table === "partner_splits" &&
    u.values.stripe_transfer_id === null &&
    u.values.payout_reference === null
  );
  assert(
    clear,
    "the dead transfer code + stale payout_reference MUST be cleared so the sweep re-initiates with the NEW reference (P1-1331-STALE-TRANSFER-CODE)",
  );
  assert(
    clear!.filters.some((f) => f.col === "id" && f.val === SPLIT_ID) &&
      clear!.filters.some((f) => f.col === "status" && f.val === "pending"),
    "the clear is guarded by id AND status='pending' (mirror of the sweep's reconcile-reversed clear)",
  );
  assertEquals(
    rpcCalls.filter((c) => c.name === "mark_partner_split_failed").length,
    0,
    "below the cap the row stays pending",
  );
  assertEquals(calls.filter((c) => c.kind === "sendOpsAlert").length, 0);
});

Deno.test("R-2 · replayed transfer.failed AFTER the clear (no transfer code on the row) → no-op: no double-bump, no update", async () => {
  // Row state after R-1: bumped to attempt 1, transfer code cleared.
  const { sb, rpcCalls, updates } = fakeSupabase(
    pendingRow({ stripe_transfer_id: null, attempt_count: 1 }),
  );
  const { deps, calls } = fakeDeps();

  await handlePaystackTransferEvent(sb, "transfer.failed", {
    reference: `psplit_${SPLIT_ID}_a0`,
    transfer_code: "TRF_rw_0",
    reason: "Recipient bank rejected the transfer",
  }, deps);

  assertEquals(
    rpcCalls.filter((c) => c.name === "bump_paystack_partner_split_attempt")
      .length,
    0,
    "a replayed transfer.failed for the already-cleared transfer must NOT burn another attempt",
  );
  assertEquals(updates.length, 0, "no state change on replay");
  assertEquals(calls.filter((c) => c.kind === "sendOpsAlert").length, 0);
});

Deno.test("R-3 · stale transfer.failed for an OLDER attempt (code mismatch) → no-op: the CURRENT in-flight transfer is never bumped or cleared", async () => {
  // Row already re-initiated _a1 → TRF_rw_1 in flight; a late/replayed
  // transfer.failed for the OLD _a0/TRF_rw_0 arrives.
  const { sb, rpcCalls, updates } = fakeSupabase(
    pendingRow({ stripe_transfer_id: "TRF_rw_1", attempt_count: 1 }),
  );
  const { deps } = fakeDeps();

  await handlePaystackTransferEvent(sb, "transfer.failed", {
    reference: `psplit_${SPLIT_ID}_a0`,
    transfer_code: "TRF_rw_0",
    reason: "Recipient bank rejected the transfer",
  }, deps);

  assertEquals(
    rpcCalls.filter((c) => c.name === "bump_paystack_partner_split_attempt")
      .length,
    0,
    "a stale event must not burn the in-flight attempt",
  );
  assertEquals(
    updates.length,
    0,
    "the in-flight TRF_rw_1 code must NOT be cleared (that would re-open the double-initiate seam)",
  );
});

Deno.test("R-4 · stale transfer.failed with NO transfer_code but a mismatched reference attempt → no-op", async () => {
  const { sb, rpcCalls, updates } = fakeSupabase(
    pendingRow({ stripe_transfer_id: "TRF_rw_1", attempt_count: 1 }),
  );
  const { deps } = fakeDeps();

  await handlePaystackTransferEvent(sb, "transfer.failed", {
    reference: `psplit_${SPLIT_ID}_a0`, // older attempt; row is on _a1
    reason: "Recipient bank rejected the transfer",
  }, deps);

  assertEquals(
    rpcCalls.filter((c) => c.name === "bump_paystack_partner_split_attempt")
      .length,
    0,
  );
  assertEquals(updates.length, 0);
});

Deno.test("R-5 · transfer.failed at the cap → finalize failed + ONE ops alert; dead transfer code KEPT for forensics (no clear)", async () => {
  const { sb, rpcCalls, updates } = fakeSupabase(
    pendingRow({
      stripe_transfer_id: "TRF_rw_4",
      attempt_count: MAX_PAYSTACK_TRANSFER_ATTEMPTS - 1,
    }),
  );
  const { deps, calls } = fakeDeps();

  await handlePaystackTransferEvent(sb, "transfer.failed", {
    reference: `psplit_${SPLIT_ID}_a${MAX_PAYSTACK_TRANSFER_ATTEMPTS - 1}`,
    transfer_code: "TRF_rw_4",
    reason: "Recipient bank rejected the transfer",
  }, deps);

  assertEquals(
    rpcCalls.filter((c) => c.name === "bump_paystack_partner_split_attempt")
      .length,
    1,
  );
  const failed = rpcCalls.find((c) => c.name === "mark_partner_split_failed");
  assert(failed, "cap reached → finalized failed");
  assertEquals(failed!.args.p_reason, "failed");
  assertEquals(calls.filter((c) => c.kind === "sendOpsAlert").length, 1);
  assertEquals(
    updates.length,
    0,
    "at the cap the transfer code stays on the terminal 'failed' row (forensics) — at-cap logic unchanged",
  );
});

Deno.test("R-6 · duplicate-reference 4xx classifies RETRYABLE: no bump, error noted, SAME reference (P2-1331 defense-in-depth)", async () => {
  const duplicateShapes = [
    new PaystackApiError(
      "Paystack transfer failed (400): Transfer with this reference already exists",
      400,
    ),
    new PaystackApiError(
      "Paystack transfer failed (400): Duplicate Transfer Reference",
      400,
    ),
  ];
  for (const err of duplicateShapes) {
    const ctx: SplitAttemptContext = {
      id: SPLIT_ID,
      key: KEY,
      orderId: ORDER_ID,
      brandId: BRAND_ID,
      partnerAccountId: PARTNER_ID,
      partnerShareCents: 1500,
      attemptCount: 2,
      errorMessage: null,
      recipientCode: "RCP_rw_1",
    };
    const { sb, rpcCalls, updates } = fakeSupabase(null);
    const { deps, calls } = fakeDeps({ transferThrows: err });

    const outcome = await attemptTransferForSplit(sb, ctx, deps);
    assertEquals(outcome, "pending", `${err.message}: stays pending`);
    const init = calls.find((c) => c.kind === "initiateTransfer");
    assertEquals(
      (init!.args as { reference: string }).reference,
      `psplit_${SPLIT_ID}_a2`,
      "the attempt used the current reference",
    );
    assertEquals(
      rpcCalls.filter((c) => c.name === "bump_paystack_partner_split_attempt")
        .length,
      0,
      `${err.message}: duplicate-reference must NOT bump — a NEW reference could double-pay the in-flight original`,
    );
    const note = updates.find((u) =>
      u.table === "partner_splits" &&
      typeof u.values.error_message === "string"
    );
    assert(note, `${err.message}: error noted on the pending row`);
  }
});
