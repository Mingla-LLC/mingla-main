// #1030 [partner verify-by-reference] — TESTER ADVERSARIAL regression for
// runPartnerPaystackSplitSweep's reconcile-first block (SPEC AMENDMENT A1,
// SWEEP-ONLY placement). Different ANGLE than the implementor's happy-path
// (partnerPaystackSplitRetry.verifyReconcile.orch1030.test.ts): that file
// proves SC-1 success-reconcile + SC-4 404-count + SC-5 503-count in isolation.
// THIS file attacks the money-safety SEAMS the happy-path leaves open:
//
//   1. VERIFY-STRICTLY-BEFORE-INITIATE — a single ordered call log proves the
//      verify GET fires *before* the very first initiate on the definitive
//      path (relative ordering, not just "both happened"), and that initiate
//      is NEVER reached for ANY in-flight status.
//   2. TRANSIENT-MUST-NOT-INITIATE — 503 / 500 / 429 / network / ambiguous-400
//      each skip with ZERO initiate AND ZERO attempt-bump (no silent
//      cap-march), attacking a wider transient surface than the happy-path 503.
//   3. IN-FLIGHT-MUST-SKIP — pending / otp / queued / processing / received all
//      skip with ZERO initiate and ZERO ledger mutation.
//   4. DEFINITIVE-NOT-FOUND-INITIATES-EXACTLY-ONCE — 404 initiates exactly once
//      with the SAME deterministic reference psplit_<id>_a0 (never a *second*
//      transfer, never a fresh reference).
//   5. NO-DOUBLE-PAY / MONEY-SAFETY — a lost-response row whose money ACTUALLY
//      MOVED (verify → success) reconciles once and is NEVER re-initiated NOR
//      re-bumped: the double-pay seam is provably closed.
//   6. FAILED-PATH STAMP-THEN-HANDLE — verify → failed on a code-less row
//      stamps the verified transfer_code BEFORE transfer.failed handling; a
//      DB-state-coupled fake proves the stale-code guard would otherwise
//      silently no-op (bump fires ONLY because the stamp ran first).
//   7. CLASSIFIER BOUNDARIES — classifyVerifyByReferenceError edges:
//      200-status:false / ambiguous 4xx / duplicate-wording all TRANSIENT;
//      only clean 404 or explicit not-found wording is DEFINITIVE.
//
// FAILS-ON-REVERT: delete the reconcile-first block in
// partner-paystack-split-retry/index.ts (the code-less ELSE-branch prologue) and
// every sweep-driving case here flips RED — the row routes straight to
// attemptTransferForSplit, so `initiate` is called (tests 1–6 assert 0), the
// success row is never reconciled (test 5), and the failed row is never stamped
// (test 6). fails-on-revert independently re-proven by the tester; see the QA
// verdict on issue #1030.
//
// NO live Paystack / Supabase calls — every dep + DB read is injected. Run:
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real \
//   deno test --allow-env --allow-net --allow-read --no-check \
//     supabase/functions/_shared/__tests__/partnerPaystackSplitRetry.verifyReconcile.tester.orch1030.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { runPartnerPaystackSplitSweep } from "../../partner-paystack-split-retry/index.ts";
import {
  classifyVerifyByReferenceError,
  type PaystackPartnerSplitDeps,
} from "../paystackPartnerSplits.ts";
import { PaystackApiError } from "../paystack.ts";

// A DIFFERENT split id than the implementor's file — pure hygiene.
const SPLIT_ID = "abcdabcd-1111-2222-3333-abcdabcdabcd";
const ORDER_ID = "0a0a0a0a-2b2b-3c3c-4d4d-5e5e5e5e5e5e";
const PARTNER_ID = "f0f0f0f0-9999-8888-7777-666655554444";
const BRAND_ID = "11112222-3333-4444-5555-666677778888";
const KEY = "paystack:MGL-REF-ADV-1";
const REF_A0 = `psplit_${SPLIT_ID}_a0`;

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

interface FakeOpts {
  pendingRows: Array<Record<string, unknown>>;
  paystackAccount?: Record<string, unknown> | null;
  /** Base row returned by partner_splits.maybeSingle (transfer-event re-load).
   *  Its stripe_transfer_id is DYNAMICALLY overridden with the latest stamp so
   *  the stale-code guard is exercised faithfully (see test 6). */
  splitRowBase?: Record<string, unknown> | null;
  linkRow?: Record<string, unknown> | null;
}

function fakeSupabase(opts: FakeOpts) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  let listCallIndex = 0;
  // Models the DB: mark_paystack_partner_split_attempted writes the transfer
  // code onto the row, so a subsequent maybeSingle re-load sees it. Starts at
  // the base row's value (null for a genuinely code-less row).
  let stampedCode: string | null =
    (opts.splitRowBase?.stripe_transfer_id as string | null) ?? null;

  // deno-lint-ignore no-explicit-any
  const sb: any = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (
        name === "mark_paystack_partner_split_attempted" &&
        typeof args.p_transfer_code === "string"
      ) {
        stampedCode = args.p_transfer_code as string; // model the DB stamp
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const builder = {
        select() {
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
          // Sweep issues the capped-rows query first (empty here), then batch.
          const which = listCallIndex++;
          const data = which === 0 ? [] : opts.pendingRows;
          return Promise.resolve({ data, error: null });
        },
        maybeSingle() {
          if (table === "partner_paystack_accounts") {
            return Promise.resolve({
              data: opts.paystackAccount ?? null,
              error: null,
            });
          }
          if (table === "partner_splits") {
            if (!opts.splitRowBase) {
              return Promise.resolve({ data: null, error: null });
            }
            return Promise.resolve({
              data: { ...opts.splitRowBase, stripe_transfer_id: stampedCode },
              error: null,
            });
          }
          if (table === "partner_brand_links") {
            return Promise.resolve({ data: opts.linkRow ?? null, error: null });
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
  verifyResolves?: Record<string, unknown>;
  verifyThrows?: Error;
  initiateThrows?: Error;
  initiateStatus?: string;
} = {}) {
  // A SINGLE ordered log across every dep so relative ordering is provable.
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

const kinds = (calls: Array<{ kind: string }>) => calls.map((c) => c.kind);
const countKind = (calls: Array<{ kind: string }>, k: string) =>
  calls.filter((c) => c.kind === k).length;
const countRpc = (
  rpcCalls: Array<{ name: string }>,
  n: string,
) => rpcCalls.filter((c) => c.name === n).length;

// ───────────────────────────────────────────────────────────────────────────
// 1. VERIFY-STRICTLY-BEFORE-INITIATE — relative ordering (the happy-path only
//    asserts existence + a separate count). Prove the verify GET precedes the
//    FIRST initiate on the definitive path.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("#1030 adversarial · verify GET is logged strictly BEFORE the first initiate (definitive path)", async () => {
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

  await runPartnerPaystackSplitSweep(sb, deps);

  const seq = kinds(calls);
  const iVerify = seq.indexOf("verifyTransferByReference");
  const iInitiate = seq.indexOf("initiateTransfer");
  assert(iVerify >= 0, "verify MUST be called");
  assert(iInitiate >= 0, "definitive path MUST reach initiate");
  assert(
    iVerify < iInitiate,
    `verify (@${iVerify}) MUST precede initiate (@${iInitiate}); got order ${
      JSON.stringify(seq)
    }`,
  );
  assertEquals(countKind(calls, "verifyTransferByReference"), 1);
  assertEquals(countKind(calls, "initiateTransfer"), 1);
});

// ───────────────────────────────────────────────────────────────────────────
// 2. IN-FLIGHT-MUST-SKIP — every genuinely in-flight verify status skips with
//    ZERO initiate and ZERO ledger mutation (no bump / transferred / failed).
//    The happy-path never exercises an in-flight status.
// ───────────────────────────────────────────────────────────────────────────
for (const status of ["pending", "otp", "queued", "processing", "received"]) {
  Deno.test(`#1030 adversarial · verify in-flight '${status}' → skip, ZERO initiate, ZERO ledger mutation`, async () => {
    const { sb, rpcCalls } = fakeSupabase({
      pendingRows: [codelessRow()],
      paystackAccount: { recipient_code: "RCP_1", detached_at: null },
    });
    const { deps, calls } = fakeDeps({
      verifyResolves: { status, transfer_code: "TRF_inflight" },
    });

    const result = await runPartnerPaystackSplitSweep(sb, deps);

    assertEquals(
      countKind(calls, "verifyTransferByReference"),
      1,
      "verify runs once",
    );
    assertEquals(
      countKind(calls, "initiateTransfer"),
      0,
      `in-flight '${status}' MUST NOT initiate`,
    );
    assertEquals(result.skipped, 1, "in-flight is skipped");
    assertEquals(result.transferred, 0);
    assertEquals(result.retried, 0);
    assertEquals(result.failed, 0);
    // No attempt bump, no settle — the row stays untouched for the webhook /
    // next sweep to resolve.
    assertEquals(
      countRpc(rpcCalls, "bump_paystack_partner_split_attempt"),
      0,
      "in-flight MUST NOT bump attempt_count (no silent cap-march)",
    );
    assertEquals(countRpc(rpcCalls, "mark_partner_split_transferred"), 0);
    assertEquals(countRpc(rpcCalls, "mark_partner_split_failed"), 0);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 3. TRANSIENT-MUST-NOT-INITIATE — a wider transient surface than the
//    happy-path 503: 500, 503, 429, network (non-PaystackApiError), and an
//    ambiguous 400 all skip with ZERO initiate and ZERO attempt-bump.
// ───────────────────────────────────────────────────────────────────────────
const transientCases: Array<{ label: string; err: Error }> = [
  {
    label: "500 server error",
    err: new PaystackApiError("Paystack verify failed (500): internal", 500),
  },
  {
    label: "503 unavailable",
    err: new PaystackApiError("Paystack verify failed (503): unavailable", 503),
  },
  {
    label: "429 rate limited",
    err: new PaystackApiError(
      "Paystack verify failed (429): rate limited",
      429,
    ),
  },
  {
    label: "network TypeError (non-PaystackApiError)",
    err: new TypeError(
      "error sending request for url (network): connection reset",
    ),
  },
  {
    label: "ambiguous 400 without not-found wording",
    err: new PaystackApiError("Paystack verify failed (400): bad request", 400),
  },
  {
    label: "401 unauthorized",
    err: new PaystackApiError(
      "Paystack verify failed (401): unauthorized",
      401,
    ),
  },
];
for (const c of transientCases) {
  Deno.test(`#1030 adversarial · verify transient (${c.label}) → ZERO initiate, skipped, NO bump`, async () => {
    const { sb, rpcCalls } = fakeSupabase({
      pendingRows: [codelessRow()],
      paystackAccount: { recipient_code: "RCP_1", detached_at: null },
    });
    const { deps, calls } = fakeDeps({ verifyThrows: c.err });

    const result = await runPartnerPaystackSplitSweep(sb, deps);

    assertEquals(countKind(calls, "verifyTransferByReference"), 1);
    assertEquals(
      countKind(calls, "initiateTransfer"),
      0,
      `transient (${c.label}) MUST NOT initiate — outcome unknown, never risk a double-pay`,
    );
    assertEquals(result.skipped, 1);
    assertEquals(result.transferred, 0);
    assertEquals(
      countRpc(rpcCalls, "bump_paystack_partner_split_attempt"),
      0,
      "transient MUST NOT bump attempt_count",
    );
    assertEquals(countRpc(rpcCalls, "mark_partner_split_failed"), 0);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 4. DEFINITIVE-NOT-FOUND-INITIATES-EXACTLY-ONCE — 404 initiates exactly once
//    with the SAME deterministic reference psplit_<id>_a0 (never a second
//    transfer, never a fresh minted reference).
// ───────────────────────────────────────────────────────────────────────────
Deno.test("#1030 adversarial · verify 404 (definitive) → initiate EXACTLY once with the SAME psplit_<id>_a0 reference", async () => {
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

  const initiates = calls.filter((c) => c.kind === "initiateTransfer");
  assertEquals(
    initiates.length,
    1,
    "definitive not-found → initiate exactly once (never zero, never twice)",
  );
  assertEquals(
    (initiates[0].args as { reference: string }).reference,
    REF_A0,
    "initiate re-uses the SAME deterministic reference — never mints a second transfer",
  );
  assertEquals(result.transferred, 1);
});

// ───────────────────────────────────────────────────────────────────────────
// 5. NO-DOUBLE-PAY / MONEY-SAFETY — the money ACTUALLY MOVED (verify → success
//    with a transfer_code). The row reconciles to transferred exactly once and
//    is NEVER re-initiated NOR re-bumped: the double-pay seam is closed even
//    though a blind initiate would have thrown the duplicate-reference 400.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("#1030 adversarial · money already moved (verify success) → reconciled ONCE, ZERO initiate, ZERO bump (no double-pay)", async () => {
  const { sb, rpcCalls } = fakeSupabase({
    pendingRows: [codelessRow()],
    paystackAccount: { recipient_code: "RCP_1", detached_at: null },
    // handlePaystackTransferEvent("transfer.success") re-loads this row.
    splitRowBase: {
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
    // No recent first_split_at → the push is a no-op; irrelevant to money safety.
    linkRow: null,
  });
  const { deps, calls } = fakeDeps({
    verifyResolves: { status: "success", transfer_code: "TRF_verified_moved" },
    // If the reconcile block were reverted, the row would reach initiate and
    // this duplicate-400 would throw — proving the closed seam.
    initiateThrows: new PaystackApiError(
      "Paystack transfer failed (400): the transfer reference is duplicate",
      400,
    ),
  });

  const result = await runPartnerPaystackSplitSweep(sb, deps);

  assertEquals(
    countKind(calls, "initiateTransfer"),
    0,
    "money already moved → the sweep MUST NOT re-initiate (no double-pay)",
  );
  assertEquals(
    countRpc(rpcCalls, "mark_partner_split_transferred"),
    1,
    "the burned transfer reconciles to transferred EXACTLY once",
  );
  assertEquals(
    countRpc(rpcCalls, "bump_paystack_partner_split_attempt"),
    0,
    "a successful transfer MUST NOT bump the attempt",
  );
  // The verified code (not a null) flows into the settle RPC.
  const markCall = rpcCalls.find((c) =>
    c.name === "mark_partner_split_transferred"
  );
  assertEquals(
    (markCall!.args as { p_transfer_id: unknown }).p_transfer_id,
    "TRF_verified_moved",
  );
  assertEquals(result.transferred, 1);
});

// ───────────────────────────────────────────────────────────────────────────
// 6. FAILED-PATH STAMP-THEN-HANDLE — the stale-code guard in
//    handlePaystackTransferEvent("transfer.failed") reads the ROW's
//    stripe_transfer_id and no-ops when it is null. A code-less row therefore
//    MUST stamp the verified code FIRST. This fake couples the stamp RPC to the
//    row's re-loaded code, so the bump fires ONLY BECAUSE the stamp ran before
//    the failed handling — dropping the stamp (or the whole block) makes the
//    bump assertion go RED.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("#1030 adversarial · verify failed (code-less) → verified code STAMPED before transfer.failed handling; row bumps+clears (NOT a silent no-op)", async () => {
  const { sb, rpcCalls, updates } = fakeSupabase({
    pendingRows: [codelessRow()],
    paystackAccount: { recipient_code: "RCP_1", detached_at: null },
    // Starts code-less (stripe_transfer_id: null). The dynamic fake overrides
    // it with the stamped code once mark_paystack_partner_split_attempted runs.
    splitRowBase: {
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
    verifyResolves: { status: "failed", transfer_code: "TRF_verified_fail" },
  });

  const result = await runPartnerPaystackSplitSweep(sb, deps);

  assertEquals(
    countKind(calls, "initiateTransfer"),
    0,
    "a failed verify MUST NOT initiate on this row",
  );

  // Stamp fired with the verified code + deterministic reference.
  const stamp = rpcCalls.find((c) =>
    c.name === "mark_paystack_partner_split_attempted"
  );
  assert(stamp, "verified transfer_code MUST be stamped for the code-less row");
  assertEquals(
    (stamp!.args as { p_transfer_code: unknown }).p_transfer_code,
    "TRF_verified_fail",
  );
  assertEquals(
    (stamp!.args as { p_payout_reference: unknown }).p_payout_reference,
    REF_A0,
  );

  // The bump proves the stale-code guard did NOT no-op — the stamp preceded it.
  assertEquals(
    countRpc(rpcCalls, "bump_paystack_partner_split_attempt"),
    1,
    "transfer.failed MUST bump the attempt (proof the stamp-first defeats the no-op guard)",
  );

  // Ordering: stamp strictly before bump.
  const iStamp = rpcCalls.findIndex((c) =>
    c.name === "mark_paystack_partner_split_attempted"
  );
  const iBump = rpcCalls.findIndex((c) =>
    c.name === "bump_paystack_partner_split_attempt"
  );
  assert(
    iStamp >= 0 && iBump >= 0 && iStamp < iBump,
    `stamp (@${iStamp}) MUST precede bump (@${iBump})`,
  );

  // Below cap (0+1 < MAX) → no permanent-failure finalize, and the dead code is
  // cleared so the next sweep re-initiates a fresh reference.
  assertEquals(
    countRpc(rpcCalls, "mark_partner_split_failed"),
    0,
    "below cap → not finalized failed",
  );
  const cleared = updates.find((u) =>
    u.table === "partner_splits" &&
    Object.prototype.hasOwnProperty.call(u.values, "stripe_transfer_id") &&
    u.values.stripe_transfer_id === null
  );
  assert(cleared, "the dead transfer code MUST be cleared for the next sweep");
  assertEquals(result.retried, 1);
});

// ───────────────────────────────────────────────────────────────────────────
// 7. CLASSIFIER BOUNDARIES — classifyVerifyByReferenceError decides
//    definitive (→ initiate) vs transient (→ skip). A wrong "definitive"
//    re-initiates, so the boundary is money-critical. Assert every edge.
// ───────────────────────────────────────────────────────────────────────────
Deno.test("#1030 adversarial · classifier boundaries — only clean 404 / explicit not-found is DEFINITIVE; everything ambiguous is TRANSIENT", () => {
  const definitive: Array<[string, unknown]> = [
    // Clean 404.
    [
      "clean 404",
      new PaystackApiError("verify failed (404): Transfer not found", 404),
    ],
    // 404 with a bare message (status alone is enough).
    ["404 bare", new PaystackApiError("verify failed (404): nope", 404)],
    // Non-404 status but explicit not-found wording (covers 200-status:false or
    // 400 not-found envelope shapes).
    [
      "422 with 'does not exist' wording",
      new PaystackApiError("verify failed (422): transfer does not exist", 422),
    ],
    [
      "400 with 'could not resolve' wording",
      new PaystackApiError(
        "verify failed (400): could not resolve reference",
        400,
      ),
    ],
  ];
  for (const [label, err] of definitive) {
    assertEquals(
      classifyVerifyByReferenceError(err).kind,
      "definitive",
      `${label} MUST be definitive`,
    );
  }

  const transient: Array<[string, unknown]> = [
    // The task's headline boundary: 200-status:false without not-found wording.
    [
      "200 status:false, no not-found wording",
      new PaystackApiError(
        "Paystack verify-transfer-by-reference failed (200): request could not be processed",
        200,
      ),
    ],
    // Ambiguous 4xx.
    [
      "400 generic",
      new PaystackApiError("verify failed (400): bad request", 400),
    ],
    ["401", new PaystackApiError("verify failed (401): unauthorized", 401)],
    ["403", new PaystackApiError("verify failed (403): forbidden", 403)],
    // 5xx / 429.
    ["500", new PaystackApiError("verify failed (500): internal", 500)],
    ["503", new PaystackApiError("verify failed (503): unavailable", 503)],
    ["429", new PaystackApiError("verify failed (429): rate limited", 429)],
    // Network / non-HTTP throw.
    ["network TypeError", new TypeError("connection reset")],
    ["plain Error", new Error("something odd")],
    // Money-safety guard: duplicate / balance wording must NEVER read definitive
    // on the verify path — even if paired with a 404.
    [
      "404 but message says duplicate",
      new PaystackApiError(
        "verify failed (404): duplicate transfer reference",
        404,
      ),
    ],
    [
      "insufficient balance",
      new PaystackApiError("verify failed (400): insufficient balance", 400),
    ],
  ];
  for (const [label, err] of transient) {
    assertEquals(
      classifyVerifyByReferenceError(err).kind,
      "transient",
      `${label} MUST be transient (money-safe: never re-initiate on ambiguity)`,
    );
  }
});
