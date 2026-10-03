// ISSUE-1345 — ops alert when a paid NG reservation is charged but the slot
// was taken between charge and finalize (manual refund due; #1175 dark).
//
// Pins the SHARED ops-alert spine (sendOpsAlertEmail + stripe_disputes
// recipients) on the slot_unavailable path in reservationPaystackFinalize.ts.
// Auto-refund stays OUT OF SCOPE.
//
// Coverage:
//   S1–S5  source-contract guards (FAILS-ON-REVERT)
//   R1     runtime: slot-taken finalize path POSTs one Resend ops alert
//   R2     runtime: alert throw is swallowed (outcome still refund_due)
//
// Run: deno test --allow-read --allow-env --allow-net=0
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { finalizeVerifiedPaystackReservation } from "../reservationPaystackFinalize.ts";

const SRC =
  "supabase/functions/_shared/reservationPaystackFinalize.ts";
const src = await Deno.readTextFile(SRC);
const has = (n: string, why: string) =>
  assert(src.includes(n), `must contain \`${n}\` (${why})`);

// ─── Source contracts ────────────────────────────────────────────────────────

Deno.test("#1345 S1 — imports SHARED sendOpsAlertEmail (not a parallel helper)", () => {
  // [FAILS-ON-REVERT KEY]
  has(
    'import { sendOpsAlertEmail } from "./stripeOpsAlertEmail.ts"',
    "reuses ORCH-0956 ops-alert helper",
  );
});

Deno.test("#1345 S2 — reuses stripe_disputes recipient inbox (no new secret)", () => {
  // [FAILS-ON-REVERT KEY]
  has('resolveAlertRecipientValue(', "bundle/legacy recipient resolver");
  has('"stripe_disputes"', "same on-call inbox as dispute alerts");
  has('"STRIPE_DISPUTE_ALERT_EMAILS"', "legacy fallback name — no new secret");
});

Deno.test("#1345 S3 — slot_unavailable branch emits the ops alert after the audit marker", () => {
  const auditIdx = src.indexOf(
    'action: "paystack.reservation_slot_unavailable_refund_due"',
  );
  assert(auditIdx !== -1, "manual-refund audit marker must exist");
  const tail = src.slice(auditIdx);
  const alertIdx = tail.indexOf(
    "await alertOpsReservationSlotUnavailableRefundDue(",
  );
  const returnIdx = tail.indexOf(
    'return { kind: "slot_unavailable_refund_due" }',
  );
  // [FAILS-ON-REVERT KEY]
  assert(
    alertIdx !== -1 && returnIdx !== -1 && alertIdx < returnIdx,
    "ops alert must fire after the audit marker and before the refund_due return",
  );
});

Deno.test("#1345 S4 — alert is wrapped so it can NEVER throw into the money path", () => {
  const fnIdx = src.indexOf(
    "async function alertOpsReservationSlotUnavailableRefundDue(",
  );
  assert(fnIdx !== -1, "alert helper must exist");
  const body = src.slice(fnIdx);
  // [FAILS-ON-REVERT KEY]
  assert(
    body.includes("await sendOpsAlertEmail({") &&
      body.includes("} catch (err) {") &&
      body.includes(
        "[reservation-paystack-finalize] ops alert for slot-unavailable refund-due failed (non-fatal)",
      ),
    "sendOpsAlertEmail must live inside a swallowing try/catch",
  );
});

Deno.test("#1345 S5 — alert copy names MANUAL REFUND + the audit slug", () => {
  // [FAILS-ON-REVERT KEY]
  has("MANUAL REFUND DUE", "subject/body must scream manual refund");
  has(
    "Audit action: paystack.reservation_slot_unavailable_refund_due",
    "body must cite the audit slug ops already knows",
  );
  has("#1175", "body must point at the dark auto-refund rail");
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

function makeFakeSupabase(session: ReservationSessionRow) {
  return {
    from(table: string) {
      return {
        update(patch: Record<string, unknown>) {
          return {
            eq() {
              if (table === "reservation_checkout_sessions") {
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
      throw new Error(`unexpected rpc ${fn}`);
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

const RESV_REF = "mingla_resv_1345-aaaa-bbbb-cccc-dddddddddddd_slot";

Deno.test({
  name:
    "#1345 R1 · slot-taken finalize POSTs one Resend ops alert with MANUAL REFUND subject",
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
        makeFakeSupabase(session),
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
      assertEquals(posts.length, 1);
      assertEquals(posts[0].to, ["ops-refund@example.com"]);
      const subject = String(posts[0].subject ?? "");
      assert(
        subject.includes("MANUAL REFUND DUE"),
        `subject must name MANUAL REFUND DUE, got: ${subject}`,
      );
      assert(
        subject.includes("slot taken after charge"),
        `subject must name slot-taken, got: ${subject}`,
      );
      const text = String(posts[0].text ?? posts[0].html ?? "");
      assert(
        text.includes("paystack.reservation_slot_unavailable_refund_due"),
        "alert body must cite the audit slug",
      );
      assert(
        text.includes(RESV_REF),
        "alert body must include the Paystack reference",
      );
      assert(
        text.includes("sess-1345-1"),
        "alert body must include the session id",
      );
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
  name:
    "#1345 R2 · alert throw is swallowed — outcome stays slot_unavailable_refund_due",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const priorApiKey = Deno.env.get("RESEND_API_KEY");
    const priorEmails = Deno.env.get("STRIPE_DISPUTE_ALERT_EMAILS");
    const priorBundle = Deno.env.get("MINGLA_ALERT_RECIPIENTS_JSON");
    const priorSystemFrom = Deno.env.get("RESEND_SYSTEM_FROM");
    const priorTesting = Deno.env.get("DENO_TESTING");
    const originalFetch = globalThis.fetch;

    Deno.env.set("RESEND_API_KEY", "re_test_key_1345");
    Deno.env.set("STRIPE_DISPUTE_ALERT_EMAILS", "ops-refund@example.com");
    Deno.env.delete("MINGLA_ALERT_RECIPIENTS_JSON");
    Deno.env.delete("RESEND_SYSTEM_FROM");
    Deno.env.set("DENO_TESTING", "1");
    globalThis.fetch = (() => {
      throw new Error("resend_boom");
    }) as typeof fetch;

    try {
      const session: ReservationSessionRow = {
        id: "sess-1345-2",
        status: "pending",
        reservation_id: null,
        amount_cents: 10000,
        currency: "NGN",
        attribution_click_id: null,
      };
      const outcome = await finalizeVerifiedPaystackReservation(
        makeFakeSupabase(session),
        session,
        RESV_REF,
        10000,
        "NGN",
      );
      assertEquals(outcome.kind, "slot_unavailable_refund_due");
      assertEquals(session.failure_reason, "slot_unavailable_after_charge_refund_due");
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
