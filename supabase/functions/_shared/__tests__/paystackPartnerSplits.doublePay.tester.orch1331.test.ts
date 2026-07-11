// ORCH-1331 [partner Paystack payout rail] — TESTER ADVERSARIAL suite #1:
// DOUBLE-PAY HUNTING + MONEY-MATH ATTACKS + HOSTILE EVENT PAYLOADS.
//
// Angle (deliberately DIFFERENT from the implementor's six suites): the
// implementor's harness is a STATIC fake DB (fixed rows per test). This suite
// runs a STATEFUL in-memory partner_splits ledger that implements the EXACT
// guard semantics of the migration's RPCs (mark_partner_split_transferred
// flips only pending|failed; bump/attempted write only on status='pending';
// mark_partner_split_reversed CASE; record ON CONFLICT DO NOTHING returns the
// CURRENT row) plus the ORCH-1081 first-split trigger emulation — and then
// drives full multi-event SEQUENCES across the engine + the real sweep
// (runPartnerPaystackSplitSweep) to prove idempotency holds at every seam:
//
//   DP-1  charge.success replay storm (Paystack redelivers) → ONE transfer,
//         ONE distinct reference, ONE transferred row.
//   DP-2  replay while a transfer is in-flight → every initiate carries the
//         SAME psplit_<id>_a0 reference (no fresh reference without a
//         definitive bump — the Paystack-reference dedupe seam).
//   DP-3  transfer.success delivered twice → single transferred flip;
//         transferred_at stable; push idempotencyKey identical across fires.
//   DP-4  transfer succeeded but the webhook was LOST → the sweep reconciles
//         via GET /transfer and NEVER calls POST /transfer again.
//   DP-5  webhook replay AFTER the sweep already paid → early return on the
//         recorded status; zero new Paystack calls.
//   DP-6  webhook/sweep interleave race on the same pending row → both racers
//         send the SAME reference; the mocked Paystack (reference-idempotent,
//         as documented) returns the one transfer; exactly ONE distinct
//         reference ever reaches Paystack.
//   DP-7  transfer.failed (definitive, async) → bump → THE NEXT SWEEP MUST
//         RE-ATTEMPT WITH THE NEW psplit_<id>_a1 REFERENCE (SC-9 / SPEC
//         §4.5.3 "row stays pending — sweep retries with new reference").
//   DP-8  refund.processed on a pending split → reversed_pending → the sweep
//         can never pay it (money-safety half of the refund race).
//
//   MM-1  share == Math.round(fee * PARTNER_SHARE_OF_FEE) at kobo boundaries
//         (1, 4, 5, 9, 10, 15, 999, 15005, 2^31-1) AND share ≤ fee AND the
//         initiate amount === the recorded share (the partner can never be
//         paid more than recorded, never from the brand's settlement).
//   MM-2  fee = 0 / negative / NULL / NaN / string-typed → NO ledger row, NO
//         transfer call.
//   MM-3  non-NGN order currency (usd / empty) → blocked_currency_mismatch;
//         zero Paystack calls.
//
//   HP-1  hostile transfer.* payloads (non-string reference, non-UUID split
//         id, empty data, oversized reference) → no throw, no state change.
//   HP-2  hostile refund payloads (missing/object-typed transaction
//         reference, no matching split) → no throw, no state change.
//
// NO live Paystack calls (LIVE mode, real money) — every network surface is
// dependency-injected. Append-only: NEW file; no existing test modified.
//
// Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real \
//   deno test --allow-env --allow-net --allow-read --no-check \
//     supabase/functions/_shared/__tests__/paystackPartnerSplits.doublePay.tester.orch1331.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  handlePaystackPartnerSplit,
  handlePaystackRefundProcessed,
  handlePaystackTransferEvent,
  type PaystackPartnerSplitDeps,
} from "../paystackPartnerSplits.ts";
import { runPartnerPaystackSplitSweep } from "../../partner-paystack-split-retry/index.ts";
import { PARTNER_SHARE_OF_FEE } from "../partnerSplits.ts";
import { PaystackApiError } from "../paystack.ts";

const ORDER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const BRAND_ID = "99999999-8888-7777-6666-555555555555";
const PARTNER_ID = "12121212-3434-5656-7878-909090909090";
const SPLIT_ID = "0f0f0f0f-1111-2222-3333-4f4f4f4f4f4f";
const CHARGE_REF = "MGL-DP-REF-1";
const KEY = `paystack:${CHARGE_REF}`;

// ─────────────────────────────────────────────────────────────────────────────
// Stateful fake DB — implements the migration's RPC guard semantics verbatim.
// ─────────────────────────────────────────────────────────────────────────────

interface SplitRow {
  id: string;
  stripe_application_fee_id: string;
  order_id: string;
  brand_id: string;
  partner_account_id: string;
  mingla_fee_cents: number;
  partner_share_cents: number;
  transfer_currency: string;
  provider: string;
  status: string;
  stripe_transfer_id: string | null;
  payout_reference: string | null;
  attempt_count: number;
  error_message: string | null;
  transferred_at: string | null;
  reversed_at: string | null;
  reversal_owed_at: string | null;
  created_at: string;
}

interface WorldState {
  order: Record<string, unknown> | null;
  partnerLookup: string | null;
  paystackAccount: Record<string, unknown> | null;
  splits: Map<string, SplitRow>; // keyed by stripe_application_fee_id
  link: { first_split_at: string | null; accepted_at: string | null };
}

function freshWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    order: {
      id: ORDER_ID,
      currency: "NGN",
      stripe_application_fee_amount_cents: 15000,
    },
    partnerLookup: PARTNER_ID,
    paystackAccount: { recipient_code: "RCP_dp_1", detached_at: null },
    splits: new Map(),
    link: { first_split_at: null, accepted_at: "2026-07-01T00:00:00.000Z" },
    ...overrides,
  };
}

/** ORCH-1081 trigger emulation: status → transferred stamps first_split_at. */
function emulateFirstSplitTrigger(world: WorldState, row: SplitRow): void {
  if (row.status === "transferred" && world.link.first_split_at === null) {
    world.link.first_split_at = new Date().toISOString();
  }
}

function statefulSupabase(world: WorldState) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  function findByKey(key: string): SplitRow | undefined {
    return world.splits.get(key);
  }
  function findById(id: string): SplitRow | undefined {
    for (const row of world.splits.values()) if (row.id === id) return row;
    return undefined;
  }

  // deno-lint-ignore no-explicit-any
  const sb: any = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "resolve_partner_for_brand_at_time") {
        return Promise.resolve({ data: world.partnerLookup, error: null });
      }
      if (name === "record_paystack_partner_split_attempt") {
        // Migration §3b — INSERT ... ON CONFLICT DO NOTHING; return CURRENT row.
        const key = `paystack:${String(args.p_reference)}`;
        if (!world.splits.has(key)) {
          world.splits.set(key, {
            id: SPLIT_ID,
            stripe_application_fee_id: key,
            order_id: String(args.p_order_id),
            brand_id: String(args.p_brand_id),
            partner_account_id: String(args.p_partner_account_id),
            mingla_fee_cents: Number(args.p_mingla_fee_cents),
            partner_share_cents: Number(args.p_partner_share_cents),
            transfer_currency: "ngn",
            provider: "paystack",
            status: "pending",
            stripe_transfer_id: null,
            payout_reference: null,
            attempt_count: 0,
            error_message: null,
            transferred_at: null,
            reversed_at: null,
            reversal_owed_at: null,
            created_at: new Date(Date.now() - 3_600_000).toISOString(),
          });
        }
        const row = world.splits.get(key)!;
        return Promise.resolve({
          data: {
            id: row.id,
            status: row.status,
            stripe_transfer_id: row.stripe_transfer_id,
            attempt_count: row.attempt_count,
            payout_reference: row.payout_reference,
            error_message: row.error_message,
          },
          error: null,
        });
      }
      if (name === "mark_partner_split_transferred") {
        // Migration ORCH-1054 §5 — flips ONLY pending|failed.
        const row = findByKey(String(args.p_application_fee_id));
        if (row && (row.status === "pending" || row.status === "failed")) {
          row.status = "transferred";
          row.stripe_transfer_id = String(args.p_transfer_id ?? "");
          row.transferred_at = row.transferred_at ?? new Date().toISOString();
          row.error_message = null;
          emulateFirstSplitTrigger(world, row);
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "mark_partner_split_failed") {
        const row = findByKey(String(args.p_application_fee_id));
        if (row) {
          const reason = String(args.p_reason);
          const allow = [
            "blocked_currency_mismatch",
            "blocked_no_stripe",
            "blocked_no_paystack",
            "failed",
          ];
          row.status = allow.includes(reason) ? reason : "failed";
          row.error_message = String(args.p_error_message ?? "");
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "mark_paystack_partner_split_attempted") {
        // Migration §3c — writes ONLY on status='pending'.
        const row = findByKey(String(args.p_key));
        if (row && row.status === "pending") {
          row.payout_reference = String(args.p_payout_reference);
          row.stripe_transfer_id = String(args.p_transfer_code);
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "bump_paystack_partner_split_attempt") {
        // Migration §3d — writes ONLY on status='pending'.
        const row = findByKey(String(args.p_key));
        if (row && row.status === "pending") {
          row.attempt_count += 1;
          row.error_message = String(args.p_error);
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "mark_partner_split_reversed") {
        // Migration ORCH-1054 §7 CASE semantics.
        const row = findByKey(String(args.p_application_fee_id));
        if (row) {
          const revId = args.p_reversal_transfer_id;
          row.status = revId !== null && revId !== undefined
            ? "reversed"
            : row.status === "transferred"
            ? "reversed"
            : "reversed_pending";
          row.reversed_at = row.reversed_at ?? new Date().toISOString();
        }
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => {
      const filters: Array<{ kind: string; col: string; val: unknown }> = [];
      let cols = "";
      let updateValues: Record<string, unknown> | null = null;

      function rowMatches(row: SplitRow): boolean {
        return filters.every((f) => {
          const v = (row as unknown as Record<string, unknown>)[f.col];
          if (f.kind === "eq") return v === f.val;
          if (f.kind === "is") return v === f.val;
          if (f.kind === "gte") return Number(v) >= Number(f.val);
          if (f.kind === "lt") {
            return f.col === "created_at"
              ? String(v) < String(f.val)
              : Number(v) < Number(f.val);
          }
          return true;
        });
      }

      function applyUpdate(): { data: null; error: null } {
        if (table === "partner_splits" && updateValues) {
          for (const row of world.splits.values()) {
            if (rowMatches(row)) {
              Object.assign(row, updateValues);
              emulateFirstSplitTrigger(world, row);
            }
          }
        }
        return { data: null, error: null };
      }

      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select(c: string) {
          cols = c;
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push({ kind: "eq", col, val });
          return builder;
        },
        is(col: string, val: unknown) {
          filters.push({ kind: "is", col, val });
          if (updateValues) return Promise.resolve(applyUpdate());
          return builder;
        },
        gte(col: string, val: unknown) {
          filters.push({ kind: "gte", col, val });
          return builder;
        },
        lt(col: string, val: unknown) {
          filters.push({ kind: "lt", col, val });
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          if (table === "partner_splits") {
            const rows = [...world.splits.values()].filter(rowMatches).map(
              (r) => ({ ...r }),
            );
            return Promise.resolve({ data: rows, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          if (table === "orders" && cols.includes("events!inner")) {
            return Promise.resolve({
              data: world.order
                ? { event_id: "evt", events: { brand_id: BRAND_ID } }
                : null,
              error: null,
            });
          }
          if (table === "orders" && cols === "event_id") {
            return Promise.resolve({ data: { event_id: null }, error: null });
          }
          if (table === "orders") {
            return Promise.resolve({ data: world.order, error: null });
          }
          if (table === "partner_paystack_accounts") {
            return Promise.resolve({
              data: world.paystackAccount,
              error: null,
            });
          }
          if (table === "partner_splits") {
            const idFilter = filters.find((f) => f.col === "id");
            const keyFilter = filters.find((f) =>
              f.col === "stripe_application_fee_id"
            );
            const row = idFilter
              ? findById(String(idFilter.val))
              : keyFilter
              ? findByKey(String(keyFilter.val))
              : undefined;
            return Promise.resolve({
              data: row ? { ...row } : null,
              error: null,
            });
          }
          if (table === "partner_brand_links") {
            return Promise.resolve({ data: { ...world.link }, error: null });
          }
          if (table === "brands") {
            return Promise.resolve({ data: { name: "DP Brand" }, error: null });
          }
          if (table === "events") {
            return Promise.resolve({ data: { title: "DP Event" }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
        update(values: Record<string, unknown>) {
          updateValues = values;
          return builder;
        },
        insert() {
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: unknown) => void) {
          // awaited update chain (e.g. .update().eq().eq())
          resolve(updateValues ? applyUpdate() : { data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { sb, rpcCalls };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scriptable Paystack deps — reference-idempotent like the real API.
// ─────────────────────────────────────────────────────────────────────────────

interface PaystackWorld {
  /** All initiate calls (reference + amount) — the double-pay evidence log. */
  initiates: Array<{ reference: string; amount: number }>;
  /** Reference → transfer result, mirroring Paystack's documented behavior:
   * a re-used reference returns the ORIGINAL transfer (idempotent). */
  transfersByReference: Map<string, { transfer_code: string; status: string }>;
  /** Script the status the NEXT new reference gets. */
  nextStatus: string | Error;
  fetchStatusByCode: Map<string, string>;
  alerts: Array<Record<string, unknown>>;
  notifies: Array<Record<string, unknown>>;
}

function paystackWorld(nextStatus: string | Error = "pending"): PaystackWorld {
  return {
    initiates: [],
    transfersByReference: new Map(),
    nextStatus,
    fetchStatusByCode: new Map(),
    alerts: [],
    notifies: [],
  };
}

function scriptedDeps(pw: PaystackWorld): PaystackPartnerSplitDeps {
  let codeSeq = 0;
  return {
    initiateTransfer: (params) => {
      pw.initiates.push({
        reference: params.reference,
        amount: params.amountSubunits,
      });
      // Reference idempotency — the documented Paystack behavior this rail's
      // whole double-pay defense rests on.
      const existing = pw.transfersByReference.get(params.reference);
      if (existing) return Promise.resolve({ ...existing, reference: params.reference });
      if (pw.nextStatus instanceof Error) return Promise.reject(pw.nextStatus);
      const created = {
        transfer_code: `TRF_dp_${codeSeq++}`,
        status: pw.nextStatus,
      };
      pw.transfersByReference.set(params.reference, created);
      return Promise.resolve({ ...created, reference: params.reference });
    },
    fetchTransfer: (code) => {
      const status = pw.fetchStatusByCode.get(String(code)) ?? "pending";
      return Promise.resolve({ status });
    },
    sendOpsAlert: (input) => {
      pw.alerts.push(input as unknown as Record<string, unknown>);
      return Promise.resolve({ attempted: 1, succeeded: 1, failed: 0 });
    },
    // deno-lint-ignore no-explicit-any
    notify: ((input: Record<string, unknown>) => {
      pw.notifies.push(input);
      return Promise.resolve();
    }) as any,
  };
}

const ARGS = {
  reference: CHARGE_REF,
  orderId: ORDER_ID,
  paidAtIso: "2026-07-11T10:00:00.000Z",
};

function distinctReferences(pw: PaystackWorld): string[] {
  return [...new Set(pw.initiates.map((c) => c.reference))];
}

// ─────────────────────────────────────────────────────────────────────────────
// DP — double-pay hunting
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("DP-1 · charge.success replay storm (5×) with immediate success → ONE transfer, ONE reference, ONE transferred row", async () => {
  const world = freshWorld();
  const pw = paystackWorld("success");
  const { sb } = statefulSupabase(world);
  const deps = scriptedDeps(pw);

  for (let i = 0; i < 5; i++) {
    const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
    assertEquals(result.status, "transferred", `replay ${i} reports transferred`);
  }

  assertEquals(pw.initiates.length, 1, "Paystack POST /transfer called exactly ONCE");
  assertEquals(distinctReferences(pw), [`psplit_${SPLIT_ID}_a0`]);
  assertEquals(world.splits.size, 1, "exactly one ledger row");
  assertEquals(world.splits.get(KEY)!.status, "transferred");
});

Deno.test("DP-2 · replay while the transfer is in-flight (status pending) → every initiate re-uses psplit_<id>_a0; row still pending", async () => {
  const world = freshWorld();
  const pw = paystackWorld("pending");
  const { sb } = statefulSupabase(world);
  const deps = scriptedDeps(pw);

  for (let i = 0; i < 4; i++) {
    const result = await handlePaystackPartnerSplit(sb, ARGS, deps);
    assertEquals(result.status, "pending");
  }

  assert(pw.initiates.length >= 1);
  assertEquals(
    distinctReferences(pw),
    [`psplit_${SPLIT_ID}_a0`],
    "NO fresh reference without a definitive attempt bump — a duplicate can never pay twice",
  );
  const row = world.splits.get(KEY)!;
  assertEquals(row.status, "pending");
  assertEquals(row.attempt_count, 0, "ambiguous/in-flight outcomes never bump");
  assertEquals(row.stripe_transfer_id, "TRF_dp_0", "transfer_code stamped for the sweep reconcile");
});

Deno.test("DP-3 · transfer.success delivered twice → single flip; transferred_at stable; push idempotency key identical", async () => {
  const world = freshWorld();
  const pw = paystackWorld("pending");
  const { sb } = statefulSupabase(world);
  const deps = scriptedDeps(pw);

  await handlePaystackPartnerSplit(sb, ARGS, deps); // initiate → pending
  const evt = {
    reference: `psplit_${SPLIT_ID}_a0`,
    transfer_code: "TRF_dp_0",
  };
  await handlePaystackTransferEvent(sb, "transfer.success", evt, deps);
  const afterFirst = world.splits.get(KEY)!;
  assertEquals(afterFirst.status, "transferred");
  const stampedAt = afterFirst.transferred_at;
  assert(stampedAt !== null);

  await handlePaystackTransferEvent(sb, "transfer.success", evt, deps); // duplicate
  const afterSecond = world.splits.get(KEY)!;
  assertEquals(afterSecond.status, "transferred");
  assertEquals(
    afterSecond.transferred_at,
    stampedAt,
    "transferred_at is COALESCE-stable across duplicate success events",
  );
  assertEquals(pw.initiates.length, 1, "no additional transfer initiated");
  // Push dedupe: every notify carries the SAME idempotencyKey → OneSignal-side
  // collapse (the 30s window may admit both calls; the key is the guarantee).
  const keys = new Set(pw.notifies.map((n) => String(n.idempotencyKey)));
  assert(keys.size <= 1, `all first-split pushes share one idempotencyKey, got ${[...keys]}`);
});

Deno.test("DP-4 · transfer succeeded but the success webhook was LOST → sweep reconciles via GET /transfer; POST /transfer NEVER re-fires", async () => {
  const world = freshWorld();
  const pw = paystackWorld("pending");
  const { sb } = statefulSupabase(world);
  const deps = scriptedDeps(pw);

  await handlePaystackPartnerSplit(sb, ARGS, deps); // initiate a0 → pending
  assertEquals(pw.initiates.length, 1);
  // Paystack side: the transfer actually completed; we never got the webhook.
  pw.fetchStatusByCode.set("TRF_dp_0", "success");

  const result = await runPartnerPaystackSplitSweep(sb, deps);
  assertEquals(result.transferred, 1, "sweep reconciled the lost-webhook success");
  assertEquals(
    pw.initiates.length,
    1,
    "sweep must NOT re-initiate a transfer that already exists (reconcile-first)",
  );
  assertEquals(world.splits.get(KEY)!.status, "transferred");
});

Deno.test("DP-5 · charge.success replay AFTER the sweep already paid → early return; zero new Paystack calls", async () => {
  const world = freshWorld();
  const pw = paystackWorld("pending");
  const { sb } = statefulSupabase(world);
  const deps = scriptedDeps(pw);

  await handlePaystackPartnerSplit(sb, ARGS, deps);
  pw.fetchStatusByCode.set("TRF_dp_0", "success");
  await runPartnerPaystackSplitSweep(sb, deps);
  assertEquals(world.splits.get(KEY)!.status, "transferred");
  const callsBefore = pw.initiates.length;

  const replay = await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(replay.status, "transferred", "replay reports the prior status");
  assertEquals(pw.initiates.length, callsBefore, "zero new POST /transfer calls");
});

Deno.test("DP-6 · webhook replay + sweep racing the same pending row → ONE distinct reference ever reaches Paystack", async () => {
  const world = freshWorld();
  const pw = paystackWorld("pending");
  const { sb } = statefulSupabase(world);
  const deps = scriptedDeps(pw);

  // Seed: first webhook initiates a0, Paystack answers pending.
  await handlePaystackPartnerSplit(sb, ARGS, deps);

  // Race: a replayed webhook and the sweep fire concurrently over the SAME
  // pending row (sweep will reconcile-first; the replay re-initiates a0).
  await Promise.all([
    handlePaystackPartnerSplit(sb, ARGS, deps),
    runPartnerPaystackSplitSweep(sb, deps),
    handlePaystackPartnerSplit(sb, ARGS, deps),
  ]);

  assertEquals(
    distinctReferences(pw),
    [`psplit_${SPLIT_ID}_a0`],
    "every racer used the same idempotent reference — Paystack collapses them to one transfer",
  );
  const row = world.splits.get(KEY)!;
  assertEquals(row.attempt_count, 0, "no racer burned an attempt");
});

Deno.test("DP-7 · SC-9: after a definitive transfer.failed bump, the NEXT SWEEP must re-attempt with the NEW psplit_<id>_a1 reference", async () => {
  const world = freshWorld();
  const pw = paystackWorld("pending");
  const { sb } = statefulSupabase(world);
  const deps = scriptedDeps(pw);

  // Sale → initiate a0 → Paystack answers pending (in-flight).
  await handlePaystackPartnerSplit(sb, ARGS, deps);
  assertEquals(pw.initiates.length, 1);
  assertEquals(world.splits.get(KEY)!.stripe_transfer_id, "TRF_dp_0");

  // Async definitive failure: transfer.failed webhook for a0.
  await handlePaystackTransferEvent(sb, "transfer.failed", {
    reference: `psplit_${SPLIT_ID}_a0`,
    transfer_code: "TRF_dp_0",
    reason: "Recipient bank rejected the transfer",
  }, deps);
  const bumped = world.splits.get(KEY)!;
  assertEquals(bumped.status, "pending", "row stays pending below the cap");
  assertEquals(bumped.attempt_count, 1, "definitive failure burned the attempt");

  // Paystack's view of the dead transfer stays 'failed'.
  pw.fetchStatusByCode.set("TRF_dp_0", "failed");

  // SPEC §4.5.3 (BINDING): "row stays pending (sweep retries with new
  // reference)". SC-9: "a transfer.failed webhook bumps attempt_count so the
  // next sweep uses a NEW reference". Two sweep cycles are allowed here (one
  // to reconcile/clear, one to retry) — but a FRESH POST /transfer with the
  // a1 reference MUST happen; the split must never burn its remaining
  // attempts on reconcile-loops without a single real retry.
  await runPartnerPaystackSplitSweep(sb, deps);
  await runPartnerPaystackSplitSweep(sb, deps);

  const references = distinctReferences(pw);
  assert(
    references.includes(`psplit_${SPLIT_ID}_a1`),
    `SC-9 broken: no fresh transfer attempt with the bumped a1 reference was ever made after transfer.failed. ` +
      `References sent to Paystack: ${JSON.stringify(references)}; ` +
      `row after two sweeps: status=${world.splits.get(KEY)!.status}, ` +
      `attempt_count=${world.splits.get(KEY)!.attempt_count}, ` +
      `stripe_transfer_id=${world.splits.get(KEY)!.stripe_transfer_id}`,
  );
});

Deno.test("DP-8 · refund.processed on a pending split → reversed_pending; the sweep can NEVER pay it", async () => {
  const world = freshWorld();
  const pw = paystackWorld("pending");
  const { sb } = statefulSupabase(world);
  const deps = scriptedDeps(pw);

  await handlePaystackPartnerSplit(sb, ARGS, deps); // pending, in-flight a0
  await handlePaystackRefundProcessed(sb, {
    transaction_reference: CHARGE_REF,
  }, deps);
  assertEquals(world.splits.get(KEY)!.status, "reversed_pending");

  const before = pw.initiates.length;
  const result = await runPartnerPaystackSplitSweep(sb, deps);
  assertEquals(result.scanned, 0, "sweep selects status='pending' only — reversed_pending is invisible");
  assertEquals(pw.initiates.length, before, "no transfer for a reversed split");

  // And a late transfer.success for the in-flight a0 must NOT flip it back
  // (mark_partner_split_transferred guards pending|failed only).
  await handlePaystackTransferEvent(sb, "transfer.success", {
    reference: `psplit_${SPLIT_ID}_a0`,
    transfer_code: "TRF_dp_0",
  }, deps);
  assertEquals(
    world.splits.get(KEY)!.status,
    "reversed_pending",
    "reversed_pending is terminal against the transferred flip",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// MM — money-math attacks
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("MM-1 · kobo boundaries: share == Math.round(fee×rate), share ≤ fee, initiate amount === recorded share", async () => {
  const fees = [1, 4, 5, 9, 10, 15, 999, 15005, 2147483647];
  for (const fee of fees) {
    const world = freshWorld({
      order: {
        id: ORDER_ID,
        currency: "NGN",
        stripe_application_fee_amount_cents: fee,
      },
    });
    const pw = paystackWorld("success");
    const { sb } = statefulSupabase(world);
    await handlePaystackPartnerSplit(sb, ARGS, scriptedDeps(pw));

    const expected = Math.round(fee * PARTNER_SHARE_OF_FEE);
    const row = world.splits.get(KEY)!;
    assertEquals(row.partner_share_cents, expected, `fee=${fee}: recorded share`);
    assertEquals(row.mingla_fee_cents, fee, `fee=${fee}: fee persisted verbatim`);
    assert(
      row.partner_share_cents <= fee,
      `fee=${fee}: the partner share must NEVER exceed Mingla's fee (never touches the brand's settlement)`,
    );
    for (const call of pw.initiates) {
      assertEquals(
        call.amount,
        expected,
        `fee=${fee}: the Paystack transfer amount is exactly the recorded share`,
      );
    }
  }
});

Deno.test("MM-2 · fee 0 / negative / NULL / NaN / string-typed → NO ledger row, NO transfer", async () => {
  const hostileFees: unknown[] = [0, -1500, null, undefined, Number.NaN, "15000"];
  for (const fee of hostileFees) {
    const world = freshWorld({
      order: {
        id: ORDER_ID,
        currency: "NGN",
        stripe_application_fee_amount_cents: fee,
      },
    });
    const pw = paystackWorld("success");
    const { sb } = statefulSupabase(world);
    const result = await handlePaystackPartnerSplit(sb, ARGS, scriptedDeps(pw));
    assertEquals(
      result.status,
      "no_application_fee",
      `fee=${String(fee)} must short-circuit`,
    );
    assertEquals(world.splits.size, 0, `fee=${String(fee)}: zero ledger rows`);
    assertEquals(pw.initiates.length, 0, `fee=${String(fee)}: zero Paystack calls`);
  }
});

Deno.test("MM-3 · non-NGN / missing order currency → blocked_currency_mismatch; zero Paystack calls (zero-FX invariant)", async () => {
  for (const currency of ["usd", "USD", "GBP", "", null]) {
    const world = freshWorld({
      order: {
        id: ORDER_ID,
        currency,
        stripe_application_fee_amount_cents: 15000,
      },
    });
    const pw = paystackWorld("success");
    const { sb } = statefulSupabase(world);
    const result = await handlePaystackPartnerSplit(sb, ARGS, scriptedDeps(pw));
    assertEquals(
      result.status,
      "blocked_currency_mismatch",
      `currency=${String(currency)}`,
    );
    assertEquals(world.splits.get(KEY)!.status, "blocked_currency_mismatch");
    assertEquals(pw.initiates.length, 0, "no transfer for a non-NGN order");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HP — hostile payloads
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("HP-1 · hostile transfer.* payloads → no throw, no state change", async () => {
  const world = freshWorld();
  const pw = paystackWorld("pending");
  const { sb } = statefulSupabase(world);
  const deps = scriptedDeps(pw);
  await handlePaystackPartnerSplit(sb, ARGS, deps); // seed one pending row
  const snapshot = JSON.stringify([...world.splits.values()]);

  const hostile: Array<Record<string, unknown>> = [
    {},
    { reference: 42 },
    { reference: null },
    { reference: "psplit_not-a-uuid_a0" },
    { reference: `psplit_${"x".repeat(1_000_000)}_a1` },
    { reference: "psplit__a" },
    { reference: `TRF-random-${"y".repeat(64)}` },
    { reference: { nested: "object" } },
  ];
  for (const evt of hostile) {
    for (const name of ["transfer.success", "transfer.failed", "transfer.reversed"]) {
      await handlePaystackTransferEvent(sb, name, evt, deps);
    }
  }
  assertEquals(
    JSON.stringify([...world.splits.values()]),
    snapshot,
    "hostile transfer events changed nothing",
  );
  assertEquals(pw.initiates.length, 1, "no hostile-triggered transfer");
});

Deno.test("HP-2 · hostile refund payloads → no throw, no state change", async () => {
  const world = freshWorld();
  const pw = paystackWorld("pending");
  const { sb } = statefulSupabase(world);
  const deps = scriptedDeps(pw);
  await handlePaystackPartnerSplit(sb, ARGS, deps);
  const snapshot = JSON.stringify([...world.splits.values()]);

  const hostile: Array<Record<string, unknown>> = [
    {},
    { transaction_reference: 999 },
    { transaction_reference: null },
    { transaction: "not-an-object" },
    { transaction: { reference: 123 } },
    { transaction_reference: "UNKNOWN-REF-NEVER-SEEN" },
    { transaction_reference: "z".repeat(500_000) },
  ];
  for (const evt of hostile) {
    await handlePaystackRefundProcessed(sb, evt, deps);
  }
  assertEquals(
    JSON.stringify([...world.splits.values()]),
    snapshot,
    "hostile refund events changed nothing",
  );
});

Deno.test("HP-3 · retryable classifications never mint a new reference: 5xx / 429 / network / balance errors all re-use a0", async () => {
  const errors: Array<Error> = [
    new PaystackApiError("Paystack transfer failed (503): server error", 503),
    new PaystackApiError("Paystack transfer failed (429): slow down", 429),
    new Error("network timeout: connection reset"),
    new PaystackApiError(
      "Paystack transfer failed (400): Your balance is not enough",
      400,
    ),
  ];
  for (const err of errors) {
    const world = freshWorld();
    const pw = paystackWorld(err);
    const { sb } = statefulSupabase(world);
    const deps = scriptedDeps(pw);
    // Two deliveries of the same charge → two attempts, both must use a0.
    await handlePaystackPartnerSplit(sb, ARGS, deps);
    await handlePaystackPartnerSplit(sb, ARGS, deps);
    const row = world.splits.get(KEY)!;
    assertEquals(row.status, "pending", `${err.message}: stays pending`);
    assertEquals(row.attempt_count, 0, `${err.message}: never bumps`);
    assertEquals(
      distinctReferences(pw),
      [`psplit_${SPLIT_ID}_a0`],
      `${err.message}: same reference re-used — a duplicate can never pay twice`,
    );
  }
});
