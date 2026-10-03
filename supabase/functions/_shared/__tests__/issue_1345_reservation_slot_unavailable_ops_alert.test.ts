// ISSUE-1345 — durable ops alert when a paid NG reservation is charged but the
// slot was taken between charge and finalize (manual refund due; #1175 dark).
//
// Finalize atomically marks failed + enqueues (no Resend await). Drain lives
// on payout-release-sweep: claim → sendOpsAlertEmail (bounded timeout) →
// record delivery with claim_id only on succeeded > 0.
//
// Coverage:
//   S1–S6  source-contract guards (FAILS-ON-REVERT)
//   R1     runtime: slot-taken finalize uses atomic record RPC (no Resend)
//   R2     runtime: record failure → finalize_error (no direct mark fallback)
//   R3     runtime: drain sends + records provider_accepted on succeeded > 0
//   R4     runtime: drain records retryable when succeeded === 0
//   R5     runtime: failed-status replay re-ensures outbox enqueue
//
// Run: deno test --allow-read --allow-env --allow-net=0
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { finalizeVerifiedPaystackReservation } from "../reservationPaystackFinalize.ts";
import { drainReservationSlotUnavailableAlerts } from "../reservationSlotUnavailableOpsAlert.ts";

const FINALIZE_SRC =
  "supabase/functions/_shared/reservationPaystackFinalize.ts";
const DRAIN_SRC =
  "supabase/functions/_shared/reservationSlotUnavailableOpsAlert.ts";
const WEBHOOK_SRC = "supabase/functions/paystack-webhook/index.ts";
const WEBHOOK_ROUTER_SRC =
  "supabase/functions/_shared/paystackWebhookRouter.ts";
const CONFIRM_SRC = "supabase/functions/venue-reservation-confirm/index.ts";
const SWEEP_SRC = "supabase/functions/payout-release-sweep/index.ts";
const finalizeSrc = await Deno.readTextFile(FINALIZE_SRC);
const drainSrc = await Deno.readTextFile(DRAIN_SRC);
const webhookSrc = await Deno.readTextFile(WEBHOOK_SRC);
const webhookRouterSrc = await Deno.readTextFile(WEBHOOK_ROUTER_SRC);
const confirmSrc = await Deno.readTextFile(CONFIRM_SRC);
const sweepSrc = await Deno.readTextFile(SWEEP_SRC);
const hasIn = (src: string, n: string, why: string) =>
  assert(src.includes(n), `must contain \`${n}\` (${why})`);

// ─── Source contracts ────────────────────────────────────────────────────────

Deno.test("#1345 S1 — finalize does NOT await Resend (atomic record+enqueue only)", () => {
  // [FAILS-ON-REVERT KEY]
  assert(
    !finalizeSrc.includes('import { sendOpsAlertEmail }'),
    "finalize must not import sendOpsAlertEmail — Resend lives in the drain module",
  );
  hasIn(
    finalizeSrc,
    "record_reservation_slot_unavailable_refund_due",
    "finalize marks failed + enqueues via the atomic RPC",
  );
});

Deno.test("#1345 S2 — drain reuses SHARED sendOpsAlertEmail + stripe_disputes inbox", () => {
  // [FAILS-ON-REVERT KEY]
  hasIn(
    drainSrc,
    'import { sendOpsAlertEmail } from "./stripeOpsAlertEmail.ts"',
    "reuses ORCH-0956 ops-alert helper",
  );
  hasIn(drainSrc, "resolveAlertRecipientValue(", "bundle/legacy recipient resolver");
  hasIn(drainSrc, '"stripe_disputes"', "same on-call inbox as dispute alerts");
  hasIn(drainSrc, '"STRIPE_DISPUTE_ALERT_EMAILS"', "legacy fallback — no new secret");
});

Deno.test("#1345 S3 — slot_unavailable branch uses atomic RPC before audit", () => {
  const recordIdx = finalizeSrc.indexOf(
    "await recordReservationSlotUnavailableRefundDue(",
  );
  const auditIdx = finalizeSrc.indexOf(
    'action: "paystack.reservation_slot_unavailable_refund_due"',
  );
  const returnIdx = finalizeSrc.indexOf(
    'return { kind: "slot_unavailable_refund_due" }',
  );
  // [FAILS-ON-REVERT KEY]
  assert(
    recordIdx !== -1 && auditIdx !== -1 && returnIdx !== -1 &&
      recordIdx < auditIdx && auditIdx < returnIdx,
    "atomic record+enqueue must run before audit and before the refund_due return",
  );
});

Deno.test("#1345 S4 — drain records delivery with claim_id only when succeeded > 0", () => {
  // [FAILS-ON-REVERT KEY]
  assert(
    drainSrc.includes("(result?.succeeded ?? 0) > 0") &&
      drainSrc.includes("record_reservation_slot_unavailable_alert_delivery") &&
      drainSrc.includes("claim_reservation_slot_unavailable_alerts") &&
      drainSrc.includes("p_claim_id"),
    "drain must claim, require succeeded > 0, then record with claim_id",
  );
  hasIn(drainSrc, "RESEND_SEND_TIMEOUT_MS", "bounded Resend send timeout");
  hasIn(drainSrc, "AbortController", "timeout cancels the underlying Resend fetch");
  hasIn(drainSrc, "idempotencyKey", "Resend Idempotency-Key for safe retries");
  hasIn(drainSrc, "DEFAULT_DRAIN_BUDGET_MS", "whole-drain wall-clock budget");
});

Deno.test("#1345 S5 — alert copy names MANUAL REFUND + the audit slug", () => {
  // [FAILS-ON-REVERT KEY]
  hasIn(drainSrc, "MANUAL REFUND DUE", "subject/body must scream manual refund");
  hasIn(
    drainSrc,
    "Audit action: paystack.reservation_slot_unavailable_refund_due",
    "body must cite the audit slug ops already knows",
  );
  hasIn(drainSrc, "#1175", "body must point at the dark auto-refund rail");
});

Deno.test("#1345 S6 — drain is on payout-release-sweep, NOT webhook/confirm", () => {
  // [FAILS-ON-REVERT KEY]
  assert(
    !webhookSrc.includes("drainReservationSlotUnavailable"),
    "paystack-webhook must not drain slot-unavailable alerts inline",
  );
  assert(
    !confirmSrc.includes("drainReservationSlotUnavailable"),
    "venue-reservation-confirm must not drain slot-unavailable alerts inline",
  );
  hasIn(
    sweepSrc,
    "drainReservationSlotUnavailableAlertsFailOpen",
    "payout-release-sweep drains the outbox fail-open",
  );
  hasIn(
    sweepSrc,
    "} finally {",
    "authenticated sweep drains in finally so early money returns still deliver",
  );
  hasIn(
    finalizeSrc,
    "slot_unavailable_after_charge_refund_due",
    "failed-status replay must recognize the refund-due failure_reason",
  );
  hasIn(
    finalizeSrc,
    "ensureReservationSlotUnavailableAlert",
    "failed-status replay re-ensures the outbox row",
  );
  hasIn(
    webhookRouterSrc,
    "attribution_click_id, failure_reason",
    "webhook session select must include failure_reason for outbox re-ensure",
  );
  hasIn(
    confirmSrc,
    "slot_unavailable_after_charge_refund_due",
    "confirm failed fast-path must re-enter finalize for refund-due sessions",
  );
});

// ─── Runtime (hermetic: fake supabase + stubbed Resend fetch) ────────────────

interface ReservationSessionRow {
  id: string;
  status: string | null;
  reservation_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  attribution_click_id: string | null;
  failure_reason?: string | null;
}

type RpcCall = { name: string; args: Record<string, unknown> };

function makeFakeSupabase(opts: {
  session: ReservationSessionRow;
  rpcImpl?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  calls?: RpcCall[];
}) {
  const calls = opts.calls ?? [];
  return {
    from(table: string) {
      return {
        update(patch: Record<string, unknown>) {
          return {
            eq() {
              if (table === "reservation_checkout_sessions") {
                Object.assign(opts.session, patch);
              }
              return Promise.resolve({ error: null });
            },
          };
        },
        insert() {
          return Promise.resolve({ error: null });
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown> = {}) {
      calls.push({ name: fn, args });
      if (opts.rpcImpl) {
        return opts.rpcImpl(fn, args).then((data) => ({ data, error: null }));
      }
      if (fn === "pg_finalize_guest_reservation") {
        return Promise.resolve({
          data: null,
          error: { message: "slot_unavailable" },
        });
      }
      if (fn === "record_reservation_slot_unavailable_refund_due") {
        Object.assign(opts.session, {
          status: "failed",
          failure_reason: "slot_unavailable_after_charge_refund_due",
        });
        return Promise.resolve({ data: "alert-1", error: null });
      }
      if (fn === "enqueue_reservation_slot_unavailable_alert") {
        return Promise.resolve({ data: "alert-1", error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

const RESV_REF = "mingla_resv_1345-aaaa-bbbb-cccc-dddddddddddd_slot";

Deno.test({
  name:
    "#1345 R1 · slot-taken finalize atomically records+enqueues and does NOT POST Resend",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const calls: RpcCall[] = [];
    const originalFetch = globalThis.fetch;
    let fetchHits = 0;
    globalThis.fetch = (() => {
      fetchHits += 1;
      return Promise.resolve(new Response("{}", { status: 202 }));
    }) as typeof fetch;

    try {
      const session: ReservationSessionRow = {
        id: "sess-1345-1",
        status: "pending",
        reservation_id: null,
        amount_cents: 537500,
        currency: "NGN",
        attribution_click_id: null,
      };
      const outcome = await finalizeVerifiedPaystackReservation(
        makeFakeSupabase({ session, calls }),
        session,
        RESV_REF,
        537500,
        "NGN",
      );
      assertEquals(outcome.kind, "slot_unavailable_refund_due");
      assertEquals(session.status, "failed");
      assertEquals(
        session.failure_reason,
        "slot_unavailable_after_charge_refund_due",
      );
      assertEquals(fetchHits, 0, "finalize must not call Resend");
      const record = calls.find((c) =>
        c.name === "record_reservation_slot_unavailable_refund_due"
      );
      assert(record, "must call atomic record+enqueue RPC");
      assertEquals(record.args.p_session_id, "sess-1345-1");
      assertEquals(record.args.p_reference, RESV_REF);
      assertEquals(record.args.p_amount_cents, 537500);
    } finally {
      globalThis.fetch = originalFetch;
    }
  },
});

Deno.test({
  name:
    "#1345 R2 · record failure surfaces finalize_error (webhook stays retryable; no direct mark fallback)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const session: ReservationSessionRow = {
      id: "sess-1345-2",
      status: "pending",
      reservation_id: null,
      amount_cents: 10000,
      currency: "NGN",
      attribution_click_id: null,
    };
    let directSessionUpdates = 0;
    const supabase = {
      from(table: string) {
        return {
          update(patch: Record<string, unknown>) {
            return {
              eq() {
                if (table === "reservation_checkout_sessions") {
                  directSessionUpdates += 1;
                  Object.assign(session, patch);
                }
                return Promise.resolve({ error: null });
              },
            };
          },
          insert() {
            return Promise.resolve({ error: null });
          },
        };
      },
      rpc(fn: string) {
        if (fn === "pg_finalize_guest_reservation") {
          return Promise.resolve({
            data: null,
            error: { message: "slot_unavailable" },
          });
        }
        if (fn === "record_reservation_slot_unavailable_refund_due") {
          throw new Error("record_boom");
        }
        throw new Error(`unexpected rpc ${fn}`);
      },
      // deno-lint-ignore no-explicit-any
    } as any;
    const outcome = await finalizeVerifiedPaystackReservation(
      supabase,
      session,
      RESV_REF,
      10000,
      "NGN",
    );
    assertEquals(outcome.kind, "finalize_error");
    if (outcome.kind === "finalize_error") {
      assertEquals(outcome.message, "record_boom");
    }
    assertEquals(session.status, "pending");
    assertEquals(directSessionUpdates, 0);
  },
});

Deno.test({
  name:
    "#1345 R3 · drain POSTs Resend and records provider_accepted only on succeeded > 0",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const priorApiKey = Deno.env.get("RESEND_API_KEY");
    const priorEmails = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS");
    const priorBundle = Deno.env.get("MINGLA_ALERT_RECIPIENTS_JSON");
    const priorSystemFrom = Deno.env.get("RESEND_SYSTEM_FROM");
    const priorTesting = Deno.env.get("DENO_TESTING");
    const originalFetch = globalThis.fetch;
    const posts: Record<string, unknown>[] = [];
    const recorded: Record<string, unknown>[] = [];

    Deno.env.set("RESEND_API_KEY", "re_test_key_1345");
    Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", "ops-refund@example.com");
    Deno.env.delete("MINGLA_ALERT_RECIPIENTS_JSON");
    Deno.env.delete("RESEND_SYSTEM_FROM");
    Deno.env.set("DENO_TESTING", "1");
    globalThis.fetch = ((_url, init) => {
      const body = (init as { body?: BodyInit | null } | undefined)?.body;
      posts.push(JSON.parse(String(body)));
      return Promise.resolve(new Response("{}", { status: 202 }));
    }) as typeof fetch;

    const supabase = {
      rpc(name: string, args: Record<string, unknown> = {}) {
        if (name === "claim_reservation_slot_unavailable_alerts") {
          return Promise.resolve({
            data: [{
              alert_id: "alert-1345",
              session_id: "sess-1345-3",
              reference: RESV_REF,
              amount_cents: 537500,
              currency: "NGN",
              claim_id: "claim-1345",
            }],
            error: null,
          });
        }
        if (name === "record_reservation_slot_unavailable_alert_delivery") {
          recorded.push(args);
          return Promise.resolve({ data: "provider_accepted", error: null });
        }
        throw new Error(`unexpected rpc ${name}`);
      },
      // deno-lint-ignore no-explicit-any
    } as any;

    try {
      const result = await drainReservationSlotUnavailableAlerts(supabase);
      assertEquals(result, { listed: 1, delivered: 1 });
      assertEquals(posts.length, 1);
      assertEquals(posts[0].to, ["ops-refund@example.com"]);
      const subject = String(posts[0].subject ?? "");
      assert(
        subject.includes("MANUAL REFUND DUE"),
        `subject must name MANUAL REFUND DUE, got: ${subject}`,
      );
      assertEquals(recorded.length, 1);
      assertEquals(recorded[0].p_alert_id, "alert-1345");
      assertEquals(recorded[0].p_claim_id, "claim-1345");
      assertEquals(recorded[0].p_outcome, "provider_accepted");
    } finally {
      globalThis.fetch = originalFetch;
      if (priorApiKey === undefined) Deno.env.delete("RESEND_API_KEY");
      else Deno.env.set("RESEND_API_KEY", priorApiKey);
      if (priorEmails === undefined) {
        Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
      } else Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", priorEmails);
      if (priorBundle === undefined) {
        Deno.env.delete("MINGLA_ALERT_RECIPIENTS_JSON");
      } else Deno.env.set("MINGLA_ALERT_RECIPIENTS_JSON", priorBundle);
      if (priorSystemFrom === undefined) Deno.env.delete("RESEND_SYSTEM_FROM");
      else Deno.env.set("RESEND_SYSTEM_FROM", priorSystemFrom);
      if (priorTesting === undefined) Deno.env.delete("DENO_TESTING");
      else Deno.env.set("DENO_TESTING", priorTesting);
    }
  },
});

Deno.test({
  name: "#1345 R4 · drain records retryable when Resend succeeds 0",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const priorApiKey = Deno.env.get("RESEND_API_KEY");
    const priorEmails = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS");
    const priorBundle = Deno.env.get("MINGLA_ALERT_RECIPIENTS_JSON");
    const priorTesting = Deno.env.get("DENO_TESTING");
    const recorded: Record<string, unknown>[] = [];

    // Missing API key → sendOpsAlertEmail returns succeeded: 0
    Deno.env.delete("RESEND_API_KEY");
    Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", "ops-refund@example.com");
    Deno.env.delete("MINGLA_ALERT_RECIPIENTS_JSON");
    Deno.env.set("DENO_TESTING", "1");

    const supabase = {
      rpc(name: string, args: Record<string, unknown> = {}) {
        if (name === "claim_reservation_slot_unavailable_alerts") {
          return Promise.resolve({
            data: [{
              alert_id: "alert-open",
              session_id: "sess-open",
              reference: RESV_REF,
              amount_cents: 1000,
              currency: "NGN",
              claim_id: "claim-open",
            }],
            error: null,
          });
        }
        if (name === "record_reservation_slot_unavailable_alert_delivery") {
          recorded.push(args);
          return Promise.resolve({ data: "pending", error: null });
        }
        throw new Error(`unexpected rpc ${name}`);
      },
      // deno-lint-ignore no-explicit-any
    } as any;

    try {
      const result = await drainReservationSlotUnavailableAlerts(supabase);
      assertEquals(result, { listed: 1, delivered: 0 });
      assertEquals(recorded.length, 1);
      assertEquals(recorded[0].p_outcome, "retryable");
      assertEquals(recorded[0].p_claim_id, "claim-open");
    } finally {
      if (priorApiKey === undefined) Deno.env.delete("RESEND_API_KEY");
      else Deno.env.set("RESEND_API_KEY", priorApiKey);
      if (priorEmails === undefined) {
        Deno.env.delete("STRIPE_DISPUTE_ALERT_EMAILS");
      } else Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", priorEmails);
      if (priorBundle === undefined) {
        Deno.env.delete("MINGLA_ALERT_RECIPIENTS_JSON");
      } else Deno.env.set("MINGLA_ALERT_RECIPIENTS_JSON", priorBundle);
      if (priorTesting === undefined) Deno.env.delete("DENO_TESTING");
      else Deno.env.set("DENO_TESTING", priorTesting);
    }
  },
});

Deno.test({
  name:
    "#1345 R5 · failed-status replay with slot_unavailable reason re-ensures outbox",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const calls: RpcCall[] = [];
    const session: ReservationSessionRow = {
      id: "sess-1345-replay",
      status: "failed",
      reservation_id: null,
      amount_cents: 537500,
      currency: "NGN",
      attribution_click_id: null,
      failure_reason: "slot_unavailable_after_charge_refund_due",
    };
    const outcome = await finalizeVerifiedPaystackReservation(
      makeFakeSupabase({ session, calls }),
      session,
      RESV_REF,
      537500,
      "NGN",
    );
    assertEquals(outcome.kind, "replayed");
    const enqueue = calls.find((c) =>
      c.name === "enqueue_reservation_slot_unavailable_alert"
    );
    assert(enqueue, "replay must idempotently re-ensure the outbox row");
    assertEquals(enqueue.args.p_session_id, "sess-1345-replay");
    assert(
      !calls.some((c) => c.name === "pg_finalize_guest_reservation"),
      "replay must not re-call finalize RPC",
    );
  },
});
