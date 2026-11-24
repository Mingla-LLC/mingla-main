// #4541 R1.7 and R7.2 (SC-10 alert part, SC-44): after the form request drain,
// notify-reminders retries checkout answers, reads the queue's health and sends
// at most one ops alert per kind per day to the existing recipients.
// MINGLA-INVARIANT: I-4541-FORMS-OPS-ALERT-ONCE | issue #4541 | a forms ops alert is sent only when brand_form_ops_alert_claim returns true for its kind (once per kind per day), to the existing delivery-health recipients, with counts and the Admin link only (T-ONCE, T-SAFE).
//
// FAILS-ON-REVERT: dropping the retry call fails T-RETRY; sending without the claim fails
// T-ONCE; dropping a kind's condition fails T-KINDS.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  FORM_OPS_ALERT_SUBJECTS,
  handler,
  type ReminderAdmin,
  runFormsOps,
} from "./index.ts";
import type { OpsAlertEmailInput } from "../_shared/stripeOpsAlertEmail.ts";

type Call = { fn: string; args: Record<string, unknown> };

function admin(
  calls: Call[],
  answers: Record<string, { data: unknown; error: { message: string } | null }>,
): ReminderAdmin {
  return {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      const key = fn === "brand_form_ops_alert_claim" ? `${fn}:${String(args.p_kind)}` : fn;
      return Promise.resolve(answers[key] ?? answers[fn] ?? { data: null, error: null });
    },
  };
}

function sender(sent: OpsAlertEmailInput[]) {
  return (input: OpsAlertEmailInput) => {
    sent.push(input);
    return Promise.resolve({ attempted: 1, succeeded: 1, failed: 0 });
  };
}

Deno.test("T-RETRY the checkout answer retry and the queue health are read every run", async () => {
  const calls: Call[] = [];
  const out = await runFormsOps(
    admin(calls, {
      brand_form_checkout_answers_retry: { data: { promoted: 2, skipped: 0, failed: 0, stuck: 0 }, error: null },
      brand_form_queue_health: { data: { stuckQueued: 0, failedLastHour: 0, stashStuck: 0 }, error: null },
    }),
    null,
    { sendAlert: sender([]), alertRecipients: () => ["ops@example.test"] },
  );
  assertEquals(calls.map((c) => c.fn), ["brand_form_checkout_answers_retry", "brand_form_queue_health"]);
  assertEquals(calls[0].args, { p_limit: 50 });
  assertEquals(out.retry, { promoted: 2, skipped: 0, failed: 0, stuck: 0 });
  assertEquals(out.alerts, []);
});

Deno.test("T-KINDS each condition raises its own kind; the claim decides once per day", async () => {
  const calls: Call[] = [];
  const sent: OpsAlertEmailInput[] = [];
  const out = await runFormsOps(
    admin(calls, {
      brand_form_checkout_answers_retry: { data: { promoted: 0, skipped: 0, failed: 1, stuck: 1 }, error: null },
      brand_form_queue_health: { data: { stuckQueued: 3, failedLastHour: 10, stashStuck: 1 }, error: null },
      brand_form_ops_alert_claim: { data: true, error: null },
    }),
    "claim_batch: down",
    { sendAlert: sender(sent), alertRecipients: () => ["ops@example.test"] },
  );
  assertEquals(out.alerts, ["form_drain_error", "form_sends_failing", "form_queue_stuck", "checkout_answers_stuck"]);
  assertEquals(
    calls.filter((c) => c.fn === "brand_form_ops_alert_claim").map((c) => c.args.p_kind),
    ["form_drain_error", "form_sends_failing", "form_queue_stuck", "checkout_answers_stuck"],
  );
  assertEquals(sent.map((s) => s.subject), Object.values(FORM_OPS_ALERT_SUBJECTS));
  assert(sent.every((s) => s.recipients.join() === "ops@example.test"));
  // Below the thresholds: nothing.
  const quiet: OpsAlertEmailInput[] = [];
  const none = await runFormsOps(
    admin([], {
      brand_form_queue_health: { data: { stuckQueued: 0, failedLastHour: 9, stashStuck: 0 }, error: null },
      brand_form_ops_alert_claim: { data: true, error: null },
    }),
    null,
    { sendAlert: sender(quiet), alertRecipients: () => ["ops@example.test"] },
  );
  assertEquals(none.alerts, []);
  assertEquals(quiet.length, 0);
});

Deno.test("T-ONCE SC-44 a kind already claimed today sends nothing", async () => {
  const sent: OpsAlertEmailInput[] = [];
  const out = await runFormsOps(
    admin([], {
      brand_form_queue_health: { data: { stuckQueued: 1, failedLastHour: 0, stashStuck: 0 }, error: null },
      brand_form_ops_alert_claim: { data: false, error: null },
    }),
    null,
    { sendAlert: sender(sent), alertRecipients: () => ["ops@example.test"] },
  );
  assertEquals(out.alerts, []);
  assertEquals(sent.length, 0);
});

Deno.test("T-SAFE the email has counts and the Admin link only; a failure is reported, never thrown", async () => {
  const sent: OpsAlertEmailInput[] = [];
  await runFormsOps(
    admin([], {
      brand_form_queue_health: { data: { stuckQueued: 0, failedLastHour: 0, stashStuck: 4 }, error: null },
      brand_form_ops_alert_claim: { data: true, error: null },
    }),
    null,
    { sendAlert: sender(sent), alertRecipients: () => ["ops@example.test"] },
  );
  assertEquals(sent.length, 1);
  const text = JSON.stringify(sent[0]);
  assert(text.includes("4 checkout answers"));
  assert(!/@(?!example\.test)|#t=|token|answers":/.test(text.replace(/ops@example\.test/g, "")));
  assertEquals(sent[0].cta?.url, "https://admin.usemingla.com/#/brands");
  const broken = await runFormsOps(
    admin([], {
      brand_form_checkout_answers_retry: { data: null, error: { message: "down" } },
      brand_form_queue_health: { data: { stuckQueued: 1, failedLastHour: 0, stashStuck: 0 }, error: null },
      brand_form_ops_alert_claim: { data: true, error: null },
    }),
    null,
    {
      sendAlert: () => Promise.reject(new Error("resend down")),
      alertRecipients: () => ["ops@example.test"],
    },
  );
  assertEquals(broken.alerts, []);
  assertEquals(broken.errors.length, 2);
});

Deno.test("T-HANDLER a drain failure in the cron run raises the drain alert and reports 207", async () => {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  const calls: Call[] = [];
  const sent: OpsAlertEmailInput[] = [];
  const res = await handler(
    new Request("https://x/notify-reminders", { method: "POST", headers: { Authorization: "Bearer service-key" } }),
    {
      createAdmin: () =>
        admin(calls, {
          brand_form_auto_reminders_due: { data: null, error: { message: "down" } },
          brand_form_queue_health: { data: { stuckQueued: 0, failedLastHour: 0, stashStuck: 0 }, error: null },
          brand_form_ops_alert_claim: { data: true, error: null },
        }),
      sendAlert: sender(sent),
      alertRecipients: () => ["ops@example.test"],
    },
  );
  assertEquals(res.status, 207);
  const body = await res.json();
  assertEquals(body.formsOps.alerts, ["form_drain_error"]);
  assertEquals(sent.length, 1);
  const order = calls.map((c) => c.fn);
  assert(order.indexOf("brand_form_auto_reminders_due") < order.indexOf("brand_form_checkout_answers_retry"));
});
