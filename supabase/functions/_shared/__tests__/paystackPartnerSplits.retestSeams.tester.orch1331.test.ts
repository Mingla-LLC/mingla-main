// ORCH-1331 RETEST — TESTER ADVERSARIAL suite #5: NEW-SEAM HUNT on the
// P1-1331-STALE-TRANSFER-CODE rework (7af859c48).
//
// The fix added: (a) a bump+clear of stripe_transfer_id/payout_reference on a
// below-cap definitive transfer.failed, guarded on the row's CURRENT in-flight
// transfer (code match + reference-attempt == attempt_count; no code → no-op);
// (b) duplicate-reference 4xx → retryable-same-reference classification.
//
// The implementor's failClear suite (R-1..R-6) pins those guards on a STATIC
// fake DB. This suite re-attacks them as full multi-event SEQUENCES over the
// STATEFUL ledger (same harness class as the doublePay suite — the migration's
// exact RPC guard semantics), hunting the seams the fix could have opened:
//
//   RS-1  end-to-end recovery: initiate a0 → transfer.failed a0 (bump+clear)
//         → sweep RE-INITIATES a1 → transfer.success a1 → transferred.
//         Exactly 2 distinct references, ONE burned attempt, ONE payment.
//   RS-2  late duplicate transfer.failed for the DEAD a0 arriving while the
//         a1 retry is IN FLIGHT → the live TRF_1 is never cleared, no bump —
//         and a1 still completes normally afterward.
//   RS-3  duplicate-reference 4xx across REPEATED charge replays + sweeps →
//         same a0 reference every time, ZERO bumps (no silent cap-march),
//         row stays visibly pending.
//   RS-4  hostile transfer.failed carrying a FOREIGN transfer_code with a
//         matching reference attempt → no-op (code precedence holds in
//         sequence, not just statically).
//
// NO live Paystack calls. Append-only: NEW file.
//
// Run (repo root):
//   SUPABASE_URL=https://example-test.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=test-service-role-key-not-real \
//   deno test --allow-env --allow-net --allow-read --no-check \
//     supabase/functions/_shared/__tests__/paystackPartnerSplits.retestSeams.tester.orch1331.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import {
  handlePaystackPartnerSplit,
  handlePaystackTransferEvent,
  type PaystackPartnerSplitDeps,
} from "../paystackPartnerSplits.ts";
import { runPartnerPaystackSplitSweep } from "../../partner-paystack-split-retry/index.ts";
import { PaystackApiError } from "../paystack.ts";

const ORDER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const BRAND_ID = "99999999-8888-7777-6666-555555555555";
const PARTNER_ID = "12121212-3434-5656-7878-909090909090";
const SPLIT_ID = "1a1a1a1a-2222-3333-4444-5b5b5b5b5b5b";
const CHARGE_REF = "MGL-RS-REF-1";
const KEY = `paystack:${CHARGE_REF}`;

// ── stateful ledger (migration RPC guard semantics, trimmed to what these
// sequences touch) ───────────────────────────────────────────────────────────

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

interface World {
  splits: Map<string, SplitRow>;
  link: { first_split_at: string | null; accepted_at: string | null };
}

function freshWorld(): World {
  return {
    splits: new Map(),
    link: { first_split_at: null, accepted_at: "2026-07-01T00:00:00.000Z" },
  };
}

function statefulSupabase(world: World) {
  function byKey(key: string): SplitRow | undefined {
    return world.splits.get(key);
  }
  function byId(id: string): SplitRow | undefined {
    for (const row of world.splits.values()) if (row.id === id) return row;
    return undefined;
  }
  function stampFirstSplit(row: SplitRow): void {
    if (row.status === "transferred" && world.link.first_split_at === null) {
      world.link.first_split_at = new Date().toISOString();
    }
  }

  // deno-lint-ignore no-explicit-any
  const sb: any = {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "resolve_partner_for_brand_at_time") {
        return Promise.resolve({ data: PARTNER_ID, error: null });
      }
      if (name === "record_paystack_partner_split_attempt") {
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
        const row = byKey(String(args.p_application_fee_id));
        if (row && (row.status === "pending" || row.status === "failed")) {
          row.status = "transferred";
          row.stripe_transfer_id = String(args.p_transfer_id ?? "");
          row.transferred_at = row.transferred_at ?? new Date().toISOString();
          row.error_message = null;
          stampFirstSplit(row);
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "mark_partner_split_failed") {
        const row = byKey(String(args.p_application_fee_id));
        if (row) {
          const reason = String(args.p_reason);
          row.status = [
              "blocked_currency_mismatch",
              "blocked_no_stripe",
              "blocked_no_paystack",
              "failed",
            ].includes(reason)
            ? reason
            : "failed";
          row.error_message = String(args.p_error_message ?? "");
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "mark_paystack_partner_split_attempted") {
        const row = byKey(String(args.p_key));
        if (row && row.status === "pending") {
          row.payout_reference = String(args.p_payout_reference);
          row.stripe_transfer_id = String(args.p_transfer_code);
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (name === "bump_paystack_partner_split_attempt") {
        const row = byKey(String(args.p_key));
        if (row && row.status === "pending") {
          row.attempt_count += 1;
          row.error_message = String(args.p_error);
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
          if (f.kind === "eq" || f.kind === "is") return v === f.val;
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
              stampFirstSplit(row);
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
            const rows = [...world.splits.values()].filter(rowMatches)
              .map((r) => ({ ...r }));
            return Promise.resolve({ data: rows, error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          if (table === "orders" && cols.includes("events!inner")) {
            return Promise.resolve({
              data: { event_id: "evt", events: { brand_id: BRAND_ID } },
              error: null,
            });
          }
          if (table === "orders" && cols === "event_id") {
            return Promise.resolve({ data: { event_id: null }, error: null });
          }
          if (table === "orders") {
            return Promise.resolve({
              data: {
                id: ORDER_ID,
                currency: "NGN",
                stripe_application_fee_amount_cents: 15000,
              },
              error: null,
            });
          }
          if (table === "partner_paystack_accounts") {
            return Promise.resolve({
              data: { recipient_code: "RCP_rs_1", detached_at: null },
              error: null,
            });
          }
          if (table === "partner_splits") {
            const idF = filters.find((f) => f.col === "id");
            const keyF = filters.find((f) =>
              f.col === "stripe_application_fee_id"
            );
            const row = idF
              ? byId(String(idF.val))
              : keyF
              ? byKey(String(keyF.val))
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
            return Promise.resolve({ data: { name: "RS Brand" }, error: null });
          }
          if (table === "events") {
            return Promise.resolve({ data: { title: "RS Event" }, error: null });
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
          resolve(updateValues ? applyUpdate() : { data: null, error: null });
        },
      };
      return builder;
    },
  };
  return sb;
}

// ── scriptable Paystack (reference-idempotent; per-reference scripted status) ─

interface PW {
  initiates: Array<{ reference: string; amount: number }>;
  byReference: Map<string, { transfer_code: string; status: string }>;
  /** Script what a NEW reference initiate returns (or throws). */
  next: Array<{ status: string } | { throws: Error }>;
  fetchByCode: Map<string, string>;
  alerts: number;
}

function paystackWorld(): PW {
  return {
    initiates: [],
    byReference: new Map(),
    next: [],
    fetchByCode: new Map(),
    alerts: 0,
  };
}

function scriptedDeps(pw: PW): PaystackPartnerSplitDeps {
  let seq = 0;
  return {
    initiateTransfer: (params) => {
      pw.initiates.push({
        reference: params.reference,
        amount: params.amountSubunits,
      });
      const existing = pw.byReference.get(params.reference);
      if (existing) {
        return Promise.resolve({ ...existing, reference: params.reference });
      }
      const script = pw.next.shift() ?? { status: "pending" };
      if ("throws" in script) return Promise.reject(script.throws);
      const created = { transfer_code: `TRF_rs_${seq++}`, status: script.status };
      pw.byReference.set(params.reference, created);
      return Promise.resolve({ ...created, reference: params.reference });
    },
    fetchTransfer: (code) =>
      Promise.resolve({ status: pw.fetchByCode.get(String(code)) ?? "pending" }),
    sendOpsAlert: () => {
      pw.alerts += 1;
      return Promise.resolve({ attempted: 1, succeeded: 1, failed: 0 });
    },
    // deno-lint-ignore no-explicit-any
    notify: (() => Promise.resolve()) as any,
  };
}

const ARGS = {
  reference: CHARGE_REF,
  orderId: ORDER_ID,
  paidAtIso: "2026-07-11T10:00:00.000Z",
};

function refs(pw: PW): string[] {
  return [...new Set(pw.initiates.map((c) => c.reference))];
}

Deno.test("RS-1 · end-to-end recovery: a0 fails definitively → sweep re-initiates a1 → success → transferred (2 references, 1 burned attempt, 1 payment)", async () => {
  const world = freshWorld();
  const pw = paystackWorld();
  const sb = statefulSupabase(world);
  const deps = scriptedDeps(pw);

  // Sale: initiate a0 → Paystack accepts as pending (TRF_rs_0 stamped).
  pw.next.push({ status: "pending" });
  await handlePaystackPartnerSplit(sb, ARGS, deps);
  const afterInit = world.splits.get(KEY)!;
  assertEquals(afterInit.stripe_transfer_id, "TRF_rs_0");

  // Definitive async failure for a0.
  await handlePaystackTransferEvent(sb, "transfer.failed", {
    reference: `psplit_${SPLIT_ID}_a0`,
    transfer_code: "TRF_rs_0",
    reason: "Recipient bank rejected the transfer",
  }, deps);
  const afterFail = world.splits.get(KEY)!;
  assertEquals(afterFail.status, "pending");
  assertEquals(afterFail.attempt_count, 1, "exactly one burned attempt");
  assertEquals(afterFail.stripe_transfer_id, null, "dead code CLEARED (the P1 fix)");
  assertEquals(afterFail.payout_reference, null, "stale reference cleared");

  // Sweep: must take the INITIATE path with a1 (this was the P1's dead end).
  pw.next.push({ status: "pending" });
  const sweep = await runPartnerPaystackSplitSweep(sb, deps);
  assertEquals(sweep.retried, 1, "sweep re-attempted the row");
  assert(
    refs(pw).includes(`psplit_${SPLIT_ID}_a1`),
    `a1 retry initiated — got ${JSON.stringify(refs(pw))}`,
  );
  assertEquals(world.splits.get(KEY)!.stripe_transfer_id, "TRF_rs_1");

  // a1 succeeds via webhook → transferred.
  await handlePaystackTransferEvent(sb, "transfer.success", {
    reference: `psplit_${SPLIT_ID}_a1`,
    transfer_code: "TRF_rs_1",
  }, deps);
  const final = world.splits.get(KEY)!;
  assertEquals(final.status, "transferred");
  assertEquals(final.attempt_count, 1, "no extra burns during recovery");
  assertEquals(
    refs(pw).length,
    2,
    "exactly two distinct references ever reached Paystack (a0 dead, a1 paid) — one payment",
  );
});

Deno.test("RS-2 · late duplicate transfer.failed for DEAD a0 while a1 is IN FLIGHT → live code untouched, no bump; a1 still completes", async () => {
  const world = freshWorld();
  const pw = paystackWorld();
  const sb = statefulSupabase(world);
  const deps = scriptedDeps(pw);

  pw.next.push({ status: "pending" }); // a0
  await handlePaystackPartnerSplit(sb, ARGS, deps);
  await handlePaystackTransferEvent(sb, "transfer.failed", {
    reference: `psplit_${SPLIT_ID}_a0`,
    transfer_code: "TRF_rs_0",
    reason: "bank rejected",
  }, deps); // bump→1 + clear
  pw.next.push({ status: "pending" }); // a1
  await runPartnerPaystackSplitSweep(sb, deps); // initiates a1 → TRF_rs_1

  // Paystack redelivers the OLD a0 failure while a1 is in flight.
  await handlePaystackTransferEvent(sb, "transfer.failed", {
    reference: `psplit_${SPLIT_ID}_a0`,
    transfer_code: "TRF_rs_0",
    reason: "bank rejected (redelivery)",
  }, deps);
  const row = world.splits.get(KEY)!;
  assertEquals(row.attempt_count, 1, "stale event burned NOTHING");
  assertEquals(
    row.stripe_transfer_id,
    "TRF_rs_1",
    "the LIVE in-flight transfer code was NOT cleared (double-initiate seam stays closed)",
  );

  // And the live transfer still completes normally.
  await handlePaystackTransferEvent(sb, "transfer.success", {
    reference: `psplit_${SPLIT_ID}_a1`,
    transfer_code: "TRF_rs_1",
  }, deps);
  assertEquals(world.splits.get(KEY)!.status, "transferred");
  assertEquals(refs(pw).length, 2, "still exactly two references — no third initiate");
});

Deno.test("RS-3 · duplicate-reference 4xx across replays + sweeps → SAME a0 reference every time, ZERO bumps, row visibly pending (never a silent cap-march)", async () => {
  const world = freshWorld();
  const pw = paystackWorld();
  const sb = statefulSupabase(world);
  const deps = scriptedDeps(pw);

  const dupErr = new PaystackApiError(
    "Paystack transfer failed (400): Transfer with this reference already exists",
    400,
  );
  // Every initiate attempt hits the duplicate-reference wall.
  pw.next.push({ throws: dupErr }, { throws: dupErr }, { throws: dupErr });

  await handlePaystackPartnerSplit(sb, ARGS, deps); // charge
  await handlePaystackPartnerSplit(sb, ARGS, deps); // replay
  await runPartnerPaystackSplitSweep(sb, deps); // sweep retry

  const row = world.splits.get(KEY)!;
  assertEquals(row.status, "pending", "stalled visibly pending — never failed, never paid twice");
  assertEquals(row.attempt_count, 0, "duplicate-reference NEVER bumps (P2 defense-in-depth)");
  assertEquals(
    refs(pw),
    [`psplit_${SPLIT_ID}_a0`],
    "the SAME reference was re-used on every attempt — no fresh reference can double-pay the in-flight original",
  );
  assert(
    String(row.error_message ?? "").includes("reference already exists"),
    "the stall is visible in error_message for ops",
  );
});

Deno.test("RS-4 · hostile transfer.failed with a FOREIGN transfer_code but matching attempt → no-op (code precedence holds in sequence)", async () => {
  const world = freshWorld();
  const pw = paystackWorld();
  const sb = statefulSupabase(world);
  const deps = scriptedDeps(pw);

  pw.next.push({ status: "pending" }); // a0 → TRF_rs_0
  await handlePaystackPartnerSplit(sb, ARGS, deps);

  await handlePaystackTransferEvent(sb, "transfer.failed", {
    reference: `psplit_${SPLIT_ID}_a0`, // attempt matches
    transfer_code: "TRF_forged_9999", // but the code is not this row's
    reason: "forged",
  }, deps);
  const row = world.splits.get(KEY)!;
  assertEquals(row.attempt_count, 0, "foreign-code event burned nothing");
  assertEquals(row.stripe_transfer_id, "TRF_rs_0", "in-flight code untouched");
  assertEquals(row.status, "pending");
});
