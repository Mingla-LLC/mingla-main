// ORCH-1331 [partner Paystack payout rail] — implementor happy-path regression
// suite for the split ENGINE (_shared/paystackPartnerSplits.ts). SPEC §7:
// T-4 (share math parity), T-5 (no fee / no partner / no order), T-6 (currency
// guard), T-7 (replay idempotency), T-9 (transfer lifecycle pending→success +
// first-split push once), T-10 (insufficient balance → same reference; bump on
// transfer.failed → new reference; cap → failed + alert), T-11 (OTP: pending +
// otp_required + ONE alert + attempt NOT burned), T-12 (refund.processed vs
// pending → reversed_pending; vs transferred → reversal_owed_at + audit +
// alert, status STAYS transferred).
//
// NO live Paystack calls (LIVE mode, real money): every Paystack/network
// surface is dependency-injected (PaystackPartnerSplitDeps) and every DB
// surface is a fake supabase client. Mirrors orch_1054_partner_splits_happy.
//
// FAILS-ON-REVERT anchors:
//   * T-4 — changing the share source (not orders.stripe_application_fee_
//     amount_cents) or the rate/rounding (PARTNER_SHARE_OF_FEE import,
//     Math.round) flips the recorded p_partner_share_cents assertions red.
//   * T-9/T-10 — deleting the psplit_<id>_a<attempt> reference contract or
//     bumping attempts on ambiguous failures flips the reference assertions.
//
// Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-key deno test --allow-env --allow-net \
//     supabase/functions/_shared/__tests__/paystackPartnerSplits.orch1331.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  attemptTransferForSplit,
  handlePaystackPartnerSplit,
  handlePaystackRefundProcessed,
  handlePaystackTransferEvent,
  MAX_PAYSTACK_TRANSFER_ATTEMPTS,
  type PaystackPartnerSplitDeps,
  type SplitAttemptContext,
} from "../paystackPartnerSplits.ts";
import { PARTNER_SHARE_OF_FEE } from "../partnerSplits.ts";
import { PaystackApiError } from "../paystack.ts";

const SPLIT_ID = "11111111-2222-3333-4444-555555555555";
const ORDER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const BRAND_ID = "99999999-8888-7777-6666-555555555555";
const PARTNER_ID = "12121212-3434-5656-7878-909090909090";

// ---------- Fake deps (Paystack + alerts + push) ----------
interface FakeDepsOpts {
  transferStatus?: string; // "success" | "pending" | "otp"
  transferThrows?: Error;
  fetchTransferStatus?: string;
}

function fakeDeps(opts: FakeDepsOpts = {}) {
  const calls: Array<{ kind: string; args: unknown }> = [];
  const deps: PaystackPartnerSplitDeps = {
    initiateTransfer: (params) => {
      calls.push({ kind: "initiateTransfer", args: params });
      if (opts.transferThrows) return Promise.reject(opts.transferThrows);
      return Promise.resolve({
        transfer_code: "TRF_test_1",
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

// ---------- Fake supabase ----------
interface FakeDbState {
  /** orders row for the fee/currency lookup (null → no order). */
  order?: Record<string, unknown> | null;
  /** brand join result (orders → events!inner). */
  brandJoin?: Record<string, unknown> | null;
  /** resolve_partner_for_brand_at_time result. */
  partnerLookup?: string | null;
  /** record_paystack_partner_split_attempt return. */
  recordResult?: Record<string, unknown>;
  /** partner_paystack_accounts row (null → no recipient). */
  paystackAccount?: Record<string, unknown> | null;
  /** partner_splits row for id/key lookups (transfer + refund events). */
  splitRow?: Record<string, unknown> | null;
  /** partner_brand_links row for the first-split push window. */
  linkRow?: Record<string, unknown> | null;
}

function fakeSupabase(state: FakeDbState) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = [];

  function selectResultFor(
    table: string,
    columns: string,
  ): Record<string, unknown> | null {
    if (table === "orders" && columns.includes("events!inner")) {
      return state.brandJoin ?? null;
    }
    if (table === "orders" && columns.includes("event_id")) {
      // first-split push event-title lookup
      return { event_id: null };
    }
    if (table === "orders") return state.order ?? null;
    if (table === "partner_paystack_accounts") {
      return state.paystackAccount ?? null;
    }
    if (table === "partner_splits") return state.splitRow ?? null;
    if (table === "partner_brand_links") return state.linkRow ?? null;
    if (table === "brands") return { name: "Test Brand" };
    if (table === "events") return { title: "Test Event" };
    return null;
  }

  // deno-lint-ignore no-explicit-any
  const sb: any = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "resolve_partner_for_brand_at_time") {
        return Promise.resolve({
          data: state.partnerLookup ?? null,
          error: null,
        });
      }
      if (name === "record_paystack_partner_split_attempt") {
        return Promise.resolve({
          data: state.recordResult ?? {
            id: SPLIT_ID,
            status: "pending",
            stripe_transfer_id: null,
            attempt_count: 0,
            payout_reference: null,
            error_message: null,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const builder = {
        _columns: "",
        select(columns: string) {
          this._columns = columns;
          return this;
        },
        eq() {
          return this;
        },
        is() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({
            data: selectResultFor(table, this._columns),
            error: null,
          });
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
        insert(values: Record<string, unknown>) {
          inserts.push({ table, values });
          return Promise.resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { sb, rpcCalls, updates, inserts };
}

function baseHappyState(overrides: FakeDbState = {}): FakeDbState {
  return {
    order: {
      id: ORDER_ID,
      currency: "NGN",
      stripe_application_fee_amount_cents: 15000,
    },
    brandJoin: { event_id: "evt", events: { brand_id: BRAND_ID } },
    partnerLookup: PARTNER_ID,
    paystackAccount: { recipient_code: "RCP_1", detached_at: null },
    linkRow: { first_split_at: null, accepted_at: null },
    ...overrides,
  };
}

const ARGS = {
  reference: "MGL-REF-1",
  orderId: ORDER_ID,
  paidAtIso: "2026-07-11T10:00:00.000Z",
};

// ───────────────────────── T-4 · share math parity ─────────────────────────

Deno.test("T-4 · share = Math.round(fee * PARTNER_SHARE_OF_FEE) — 15000 → 1500", async () => {
  const { sb, rpcCalls } = fakeSupabase(baseHappyState());
  const { deps } = fakeDeps({ transferStatus: "pending" });
  const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(result.status, "pending");
  const record = rpcCalls.find((c) =>
    c.name === "record_paystack_partner_split_attempt"
  );
  assert(record, "attempt recorded");
  assertEquals(record!.args.p_mingla_fee_cents, 15000);
  assertEquals(
    record!.args.p_partner_share_cents,
    Math.round(15000 * PARTNER_SHARE_OF_FEE),
  );
  assertEquals(record!.args.p_partner_share_cents, 1500);
});

Deno.test("T-4 · rounding parity — fee 15005 → 1501 (round, NOT floor)", async () => {
  const { sb, rpcCalls } = fakeSupabase(baseHappyState({
    order: {
      id: ORDER_ID,
      currency: "NGN",
      stripe_application_fee_amount_cents: 15005,
    },
  }));
  const { deps } = fakeDeps({ transferStatus: "pending" });
  await handlePaystackPartnerSplit(sb, ARGS, deps);
  const record = rpcCalls.find((c) =>
    c.name === "record_paystack_partner_split_attempt"
  );
  assertEquals(record!.args.p_partner_share_cents, 1501);
});

// ─────────────────── T-5 · no fee / no partner / no order ──────────────────

Deno.test("T-5 · NULL fee → no_application_fee; ZERO ledger writes", async () => {
  const { sb, rpcCalls } = fakeSupabase(baseHappyState({
    order: {
      id: ORDER_ID,
      currency: "NGN",
      stripe_application_fee_amount_cents: null,
    },
  }));
  const { deps, calls } = fakeDeps();
  const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(result.status, "no_application_fee");
  assertEquals(
    rpcCalls.filter((c) => c.name === "record_paystack_partner_split_attempt")
      .length,
    0,
  );
  assertEquals(calls.filter((c) => c.kind === "initiateTransfer").length, 0);
});

Deno.test("T-5 · partner resolve NULL → no_partner; ZERO ledger writes", async () => {
  const { sb, rpcCalls } = fakeSupabase(
    baseHappyState({ partnerLookup: null }),
  );
  const { deps } = fakeDeps();
  const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(result.status, "no_partner");
  assertEquals(
    rpcCalls.filter((c) => c.name === "record_paystack_partner_split_attempt")
      .length,
    0,
  );
});

Deno.test("T-5 · missing order → no_order", async () => {
  const { sb } = fakeSupabase(baseHappyState({ order: null }));
  const { deps } = fakeDeps();
  const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(result.status, "no_order");
});

// ───────────────────────── T-6 · currency guard ────────────────────────────

Deno.test("T-6 · order currency USD → blocked_currency_mismatch row (zero FX)", async () => {
  const { sb, rpcCalls } = fakeSupabase(baseHappyState({
    order: {
      id: ORDER_ID,
      currency: "USD",
      stripe_application_fee_amount_cents: 15000,
    },
  }));
  const { deps, calls } = fakeDeps();
  const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(result.status, "blocked_currency_mismatch");
  const failed = rpcCalls.find((c) => c.name === "mark_partner_split_failed");
  assert(failed, "mark_partner_split_failed called");
  assertEquals(failed!.args.p_reason, "blocked_currency_mismatch");
  assertEquals(calls.filter((c) => c.kind === "initiateTransfer").length, 0);
});

Deno.test("SC-8 · no active recipient → blocked_no_paystack; NO transfer", async () => {
  const { sb, rpcCalls } = fakeSupabase(
    baseHappyState({ paystackAccount: null }),
  );
  const { deps, calls } = fakeDeps();
  const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(result.status, "blocked_no_paystack");
  const failed = rpcCalls.find((c) => c.name === "mark_partner_split_failed");
  assertEquals(failed!.args.p_reason, "blocked_no_paystack");
  assertEquals(calls.filter((c) => c.kind === "initiateTransfer").length, 0);
});

Deno.test("SC-8 · detached recipient counts as no recipient", async () => {
  const { sb } = fakeSupabase(baseHappyState({
    paystackAccount: {
      recipient_code: "RCP_1",
      detached_at: "2026-07-01T00:00:00Z",
    },
  }));
  const { deps } = fakeDeps();
  const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(result.status, "blocked_no_paystack");
});

// ───────────────────────── T-7 · replay idempotency ────────────────────────

Deno.test("T-7 · replay on a transferred row → early return, NO second transfer", async () => {
  const { sb } = fakeSupabase(baseHappyState({
    recordResult: {
      id: SPLIT_ID,
      status: "transferred",
      stripe_transfer_id: "TRF_prior",
      attempt_count: 1,
      payout_reference: `psplit_${SPLIT_ID}_a0`,
      error_message: null,
    },
  }));
  const { deps, calls } = fakeDeps();
  const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(result.status, "transferred");
  assertEquals(calls.filter((c) => c.kind === "initiateTransfer").length, 0);
});

Deno.test("T-7 · replay on a reversed_pending row → never pays", async () => {
  const { sb } = fakeSupabase(baseHappyState({
    recordResult: {
      id: SPLIT_ID,
      status: "reversed_pending",
      stripe_transfer_id: null,
      attempt_count: 0,
      payout_reference: null,
      error_message: null,
    },
  }));
  const { deps, calls } = fakeDeps();
  await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(calls.filter((c) => c.kind === "initiateTransfer").length, 0);
});

// ───────────────────────── T-9 · transfer lifecycle ────────────────────────

Deno.test("T-9 · immediate success → transferred + reference psplit_<id>_a0 + push fires once", async () => {
  const { sb, rpcCalls } = fakeSupabase(baseHappyState({
    linkRow: { first_split_at: new Date().toISOString(), accepted_at: null },
  }));
  const { deps, calls } = fakeDeps({ transferStatus: "success" });
  const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(result.status, "transferred");
  const init = calls.find((c) => c.kind === "initiateTransfer");
  assertEquals(
    (init!.args as { reference: string }).reference,
    `psplit_${SPLIT_ID}_a0`,
  );
  const marked = rpcCalls.find((c) =>
    c.name === "mark_partner_split_transferred"
  );
  assert(marked, "mark_partner_split_transferred called");
  assertEquals(marked!.args.p_transfer_id, "TRF_test_1");
  // first-split push fired exactly once with the idempotent key.
  const pushes = calls.filter((c) => c.kind === "notify");
  assertEquals(pushes.length, 1);
  assertEquals(
    (pushes[0].args as { idempotencyKey: string }).idempotencyKey,
    `business.partner_first_split:${PARTNER_ID}:${BRAND_ID}`,
  );
});

Deno.test("T-9 · create returns pending → attempted stamped; transfer.success event flips + push", async () => {
  const state = baseHappyState();
  const { sb, rpcCalls } = fakeSupabase(state);
  const { deps, calls } = fakeDeps({ transferStatus: "pending" });
  const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(result.status, "pending");
  const attempted = rpcCalls.find((c) =>
    c.name === "mark_paystack_partner_split_attempted"
  );
  assert(attempted, "mark_paystack_partner_split_attempted called");
  assertEquals(attempted!.args.p_payout_reference, `psplit_${SPLIT_ID}_a0`);
  assertEquals(attempted!.args.p_transfer_code, "TRF_test_1");
  assertEquals(calls.filter((c) => c.kind === "notify").length, 0);

  // …then transfer.success arrives.
  const { sb: sb2, rpcCalls: rpc2 } = fakeSupabase({
    splitRow: {
      id: SPLIT_ID,
      status: "pending",
      stripe_application_fee_id: `paystack:${ARGS.reference}`,
      stripe_transfer_id: "TRF_test_1",
      attempt_count: 0,
      partner_account_id: PARTNER_ID,
      brand_id: BRAND_ID,
      order_id: ORDER_ID,
      partner_share_cents: 1500,
      transfer_currency: "ngn",
    },
    linkRow: { first_split_at: new Date().toISOString(), accepted_at: null },
  });
  const { deps: deps2, calls: calls2 } = fakeDeps();
  await handlePaystackTransferEvent(sb2, "transfer.success", {
    reference: `psplit_${SPLIT_ID}_a0`,
    transfer_code: "TRF_test_1",
  }, deps2);
  const marked = rpc2.find((c) => c.name === "mark_partner_split_transferred");
  assert(marked, "transfer.success marks transferred");
  assertEquals(calls2.filter((c) => c.kind === "notify").length, 1);
});

Deno.test("T-9 · non-psplit transfer references are a no-op (future transfers unaffected)", async () => {
  const { sb, rpcCalls, updates } = fakeSupabase({});
  const { deps } = fakeDeps();
  await handlePaystackTransferEvent(sb, "transfer.success", {
    reference: "some-other-transfer",
    transfer_code: "TRF_x",
  }, deps);
  assertEquals(rpcCalls.length, 0);
  assertEquals(updates.length, 0);
});

// ──────────── T-10 · insufficient balance / bump / cap semantics ───────────

Deno.test("T-10 · insufficient balance → row stays pending, NO attempt bump (same reference next sweep)", async () => {
  const { sb, rpcCalls, updates } = fakeSupabase(baseHappyState());
  const { deps } = fakeDeps({
    transferThrows: new PaystackApiError(
      "Paystack transfer failed (400): Your balance is not enough for this transaction",
      400,
    ),
  });
  const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(result.status, "pending");
  assertEquals(
    rpcCalls.filter((c) => c.name === "bump_paystack_partner_split_attempt")
      .length,
    0,
    "ambiguous/operational failure must NOT burn the attempt",
  );
  const note = updates.find((u) =>
    u.table === "partner_splits" &&
    typeof u.values.error_message === "string"
  );
  assert(note, "error_message noted on the pending row");
});

Deno.test("T-10 · transfer.failed webhook bumps the attempt (NEW reference next sweep)", async () => {
  const { sb, rpcCalls } = fakeSupabase({
    splitRow: {
      id: SPLIT_ID,
      status: "pending",
      stripe_application_fee_id: `paystack:${ARGS.reference}`,
      stripe_transfer_id: "TRF_test_1",
      attempt_count: 0,
      partner_account_id: PARTNER_ID,
      brand_id: BRAND_ID,
      order_id: ORDER_ID,
      partner_share_cents: 1500,
      transfer_currency: "ngn",
    },
  });
  const { deps, calls } = fakeDeps();
  await handlePaystackTransferEvent(sb, "transfer.failed", {
    reference: `psplit_${SPLIT_ID}_a0`,
    reason: "Recipient bank unavailable",
  }, deps);
  const bump = rpcCalls.find((c) =>
    c.name === "bump_paystack_partner_split_attempt"
  );
  assert(bump, "definitive failure bumps attempt_count");
  assertEquals(
    rpcCalls.filter((c) => c.name === "mark_partner_split_failed").length,
    0,
    "below the cap the row stays pending",
  );
  assertEquals(calls.filter((c) => c.kind === "sendOpsAlert").length, 0);
});

Deno.test("T-10 · 5th definitive failure finalizes failed + ops alert", async () => {
  const { sb, rpcCalls } = fakeSupabase({
    splitRow: {
      id: SPLIT_ID,
      status: "pending",
      stripe_application_fee_id: `paystack:${ARGS.reference}`,
      stripe_transfer_id: "TRF_test_1",
      attempt_count: MAX_PAYSTACK_TRANSFER_ATTEMPTS - 1,
      partner_account_id: PARTNER_ID,
      brand_id: BRAND_ID,
      order_id: ORDER_ID,
      partner_share_cents: 1500,
      transfer_currency: "ngn",
    },
  });
  const { deps, calls } = fakeDeps();
  await handlePaystackTransferEvent(sb, "transfer.failed", {
    reference: `psplit_${SPLIT_ID}_a${MAX_PAYSTACK_TRANSFER_ATTEMPTS - 1}`,
    reason: "Recipient bank unavailable",
  }, deps);
  const failed = rpcCalls.find((c) => c.name === "mark_partner_split_failed");
  assert(failed, "cap reached → finalized failed");
  assertEquals(failed!.args.p_reason, "failed");
  assertEquals(calls.filter((c) => c.kind === "sendOpsAlert").length, 1);
});

Deno.test("T-10 · definitive 4xx at attempt N uses reference _a<N> then bumps", async () => {
  const ctx: SplitAttemptContext = {
    id: SPLIT_ID,
    key: `paystack:${ARGS.reference}`,
    orderId: ORDER_ID,
    brandId: BRAND_ID,
    partnerAccountId: PARTNER_ID,
    partnerShareCents: 1500,
    attemptCount: 2,
    errorMessage: null,
    recipientCode: "RCP_1",
  };
  const { sb, rpcCalls } = fakeSupabase({});
  const { deps, calls } = fakeDeps({
    transferThrows: new PaystackApiError(
      "Paystack transfer failed (400): Recipient specified is invalid",
      400,
    ),
  });
  const outcome = await attemptTransferForSplit(sb, ctx, deps);
  assertEquals(outcome, "pending");
  const init = calls.find((c) => c.kind === "initiateTransfer");
  assertEquals(
    (init!.args as { reference: string }).reference,
    `psplit_${SPLIT_ID}_a2`,
  );
  assert(
    rpcCalls.some((c) => c.name === "bump_paystack_partner_split_attempt"),
    "definitive 4xx burns the attempt",
  );
});

// ───────────────────────────── T-11 · OTP block ────────────────────────────

Deno.test("T-11 · status otp → pending + error_message otp_required + ONE alert, attempt NOT burned", async () => {
  const { sb, rpcCalls, updates } = fakeSupabase(baseHappyState());
  const { deps, calls } = fakeDeps({ transferStatus: "otp" });
  const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(result.status, "pending");
  assertEquals(
    rpcCalls.filter((c) => c.name === "bump_paystack_partner_split_attempt")
      .length,
    0,
    "OTP must not burn the attempt",
  );
  const note = updates.find((u) =>
    u.table === "partner_splits" && u.values.error_message === "otp_required"
  );
  assert(note, "error_message = otp_required");
  const alerts = calls.filter((c) => c.kind === "sendOpsAlert");
  assertEquals(alerts.length, 1);
  assertEquals(
    (alerts[0].args as { subject: string }).subject,
    "[Mingla ops] Paystack partner transfer blocked: OTP enabled",
  );
});

Deno.test("T-11 · OTP alert dedupes when error_message already otp_required", async () => {
  const ctx: SplitAttemptContext = {
    id: SPLIT_ID,
    key: `paystack:${ARGS.reference}`,
    orderId: ORDER_ID,
    brandId: BRAND_ID,
    partnerAccountId: PARTNER_ID,
    partnerShareCents: 1500,
    attemptCount: 0,
    errorMessage: "otp_required",
    recipientCode: "RCP_1",
  };
  const { sb } = fakeSupabase({});
  const { deps, calls } = fakeDeps({ transferStatus: "otp" });
  const outcome = await attemptTransferForSplit(sb, ctx, deps);
  assertEquals(outcome, "pending");
  assertEquals(calls.filter((c) => c.kind === "sendOpsAlert").length, 0);
});

// ───────────────────────── T-12 · refund reversal ──────────────────────────

Deno.test("T-12 · refund.processed vs PENDING split → reversed_pending (never pays)", async () => {
  const { sb, rpcCalls } = fakeSupabase({
    splitRow: {
      id: SPLIT_ID,
      status: "pending",
      order_id: ORDER_ID,
      partner_account_id: PARTNER_ID,
      partner_share_cents: 1500,
      reversal_owed_at: null,
    },
  });
  const { deps, calls } = fakeDeps();
  await handlePaystackRefundProcessed(sb, {
    transaction_reference: ARGS.reference,
  }, deps);
  const reversed = rpcCalls.find((c) =>
    c.name === "mark_partner_split_reversed"
  );
  assert(reversed, "mark_partner_split_reversed called");
  assertEquals(reversed!.args.p_reversal_transfer_id, null);
  assertEquals(calls.filter((c) => c.kind === "sendOpsAlert").length, 0);
});

Deno.test("T-12 · refund.processed vs TRANSFERRED split → reversal_owed_at + audit + alert; status STAYS transferred", async () => {
  const { sb, rpcCalls, updates, inserts } = fakeSupabase({
    splitRow: {
      id: SPLIT_ID,
      status: "transferred",
      order_id: ORDER_ID,
      partner_account_id: PARTNER_ID,
      partner_share_cents: 1500,
      reversal_owed_at: null,
    },
  });
  const { deps, calls } = fakeDeps();
  await handlePaystackRefundProcessed(sb, {
    transaction_reference: ARGS.reference,
  }, deps);
  // no status transition RPC — the ledger never lies.
  assertEquals(
    rpcCalls.filter((c) => c.name === "mark_partner_split_reversed").length,
    0,
  );
  const owed = updates.find((u) =>
    u.table === "partner_splits" &&
    typeof u.values.reversal_owed_at === "string"
  );
  assert(owed, "reversal_owed_at stamped");
  const audit = inserts.find((i) =>
    i.table === "audit_log" &&
    i.values.action === "paystack.partner_split_reversal_owed"
  );
  assert(audit, "audit row written");
  const alerts = calls.filter((c) => c.kind === "sendOpsAlert");
  assertEquals(alerts.length, 1);
  assertEquals(
    (alerts[0].args as { subject: string }).subject,
    "[Mingla ops] Partner split reversal owed (NGN refund after payout)",
  );
});

Deno.test("T-12 · refund.processed with already-stamped reversal_owed_at → idempotent no-op", async () => {
  const { sb, updates, inserts } = fakeSupabase({
    splitRow: {
      id: SPLIT_ID,
      status: "transferred",
      order_id: ORDER_ID,
      partner_account_id: PARTNER_ID,
      partner_share_cents: 1500,
      reversal_owed_at: "2026-07-10T00:00:00Z",
    },
  });
  const { deps, calls } = fakeDeps();
  await handlePaystackRefundProcessed(sb, {
    transaction_reference: ARGS.reference,
  }, deps);
  assertEquals(updates.length, 0);
  assertEquals(inserts.length, 0);
  assertEquals(calls.filter((c) => c.kind === "sendOpsAlert").length, 0);
});

Deno.test("T-12 · refund.processed with no matching split → no-op", async () => {
  const { sb, rpcCalls, updates } = fakeSupabase({ splitRow: null });
  const { deps } = fakeDeps();
  await handlePaystackRefundProcessed(sb, {
    transaction_reference: "unknown-ref",
  }, deps);
  assertEquals(rpcCalls.length, 0);
  assertEquals(updates.length, 0);
});

// ───────────── transfer.reversed — back to pending for re-attempt ──────────

Deno.test("transfer.reversed on a transferred row → pending + attempt bump + alert (SPEC §4.5.3)", async () => {
  const { sb, updates } = fakeSupabase({
    splitRow: {
      id: SPLIT_ID,
      status: "transferred",
      stripe_application_fee_id: `paystack:${ARGS.reference}`,
      stripe_transfer_id: "TRF_test_1",
      attempt_count: 1,
      partner_account_id: PARTNER_ID,
      brand_id: BRAND_ID,
      order_id: ORDER_ID,
      partner_share_cents: 1500,
      transfer_currency: "ngn",
    },
  });
  const { deps, calls } = fakeDeps();
  await handlePaystackTransferEvent(sb, "transfer.reversed", {
    reference: `psplit_${SPLIT_ID}_a1`,
    transfer_code: "TRF_test_1",
  }, deps);
  const revert = updates.find((u) =>
    u.table === "partner_splits" && u.values.status === "pending" &&
    u.values.error_message === "transfer_reversed_by_bank" &&
    u.values.transferred_at === null && u.values.stripe_transfer_id === null &&
    u.values.attempt_count === 2
  );
  assert(revert, "row reverted to pending with the BINDING field set");
  assertEquals(calls.filter((c) => c.kind === "sendOpsAlert").length, 1);
});
