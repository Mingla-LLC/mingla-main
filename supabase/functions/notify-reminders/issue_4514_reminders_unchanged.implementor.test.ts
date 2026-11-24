// #4514 wave 4 — today's buyer and reservation reminders are unchanged.
//
// notify-reminders gained the optional brand form reminder (decision 13). This
// pins what the cron's existing work does, byte for byte: the same two
// pg_notify_reminders_enqueue calls with the same arguments, in the same order,
// and the same response, whether or not a form reminder is due, and even when
// the form step fails. Run before and after the wave 4 change (see #4514).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler, type ReminderAdmin, viaNotifyDispatch } from "./index.ts";
import type { DispatchV2Input, DispatchV2Result } from "../_shared/notifyV2.ts";
import { brandFormEmailCta } from "../_shared/brandFormNotify.ts";
import { transactionalConsentSourceForCategory } from "../_shared/issue4111EnquiryNotifications.ts";

type Call = { fn: string; args: Record<string, unknown> };

function fakeAdmin(
  calls: Call[],
  answers: Record<string, { data: unknown; error: { message: string } | null }>,
): ReminderAdmin {
  return {
    rpc: (fn, args) => {
      calls.push({ fn, args });
      const key = fn === "pg_notify_reminders_enqueue"
        ? `${fn}:${String(args.p_lead_bucket)}`
        : fn;
      return Promise.resolve(answers[key] ?? { data: null, error: null });
    },
  };
}

function env(): void {
  Deno.env.set("SUPABASE_URL", "https://example.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  Deno.env.delete("REMINDER_LEAD_24H_HOURS");
  Deno.env.delete("REMINDER_LEAD_2H_HOURS");
}

const req = () =>
  new Request("https://x/notify-reminders", {
    method: "POST",
    headers: { Authorization: "Bearer service-key" },
  });

const EXPECTED_ENQUEUE: Call[] = [
  {
    fn: "pg_notify_reminders_enqueue",
    args: { p_lead_hours: 24, p_lead_bucket: "24h", p_window_minutes: 10 },
  },
  {
    fn: "pg_notify_reminders_enqueue",
    args: { p_lead_hours: 2, p_lead_bucket: "2h", p_window_minutes: 10 },
  },
];

Deno.test("#4514 reminders: the two enqueue calls and the response are unchanged when no form reminder is due", async () => {
  env();
  const calls: Call[] = [];
  const res = await handler(req(), {
    createAdmin: () =>
      fakeAdmin(calls, {
        "pg_notify_reminders_enqueue:24h": { data: 3, error: null },
        "pg_notify_reminders_enqueue:2h": { data: 1, error: null },
        brand_form_auto_reminders_due: { data: [], error: null },
      }),
  });
  assertEquals(res.status, 200);
  assertEquals(
    await res.text(),
    JSON.stringify({
      ok: true,
      enqueued: { "24h": 3, "2h": 1 },
      windowMinutes: 10,
    }),
  );
  assertEquals(
    calls.filter((c) => c.fn === "pg_notify_reminders_enqueue"),
    EXPECTED_ENQUEUE,
  );
  // The reminders run first; nothing is sent before them.
  assertEquals(calls.slice(0, 2), EXPECTED_ENQUEUE);
});

Deno.test("#4514 reminders: a failing bucket still reports 207 with the same body shape", async () => {
  env();
  const calls: Call[] = [];
  const res = await handler(req(), {
    createAdmin: () =>
      fakeAdmin(calls, {
        "pg_notify_reminders_enqueue:24h": {
          data: null,
          error: { message: "boom" },
        },
        "pg_notify_reminders_enqueue:2h": { data: 2, error: null },
        brand_form_auto_reminders_due: { data: [], error: null },
      }),
  });
  assertEquals(res.status, 207);
  assertEquals(
    await res.text(),
    JSON.stringify({
      ok: false,
      enqueued: { "24h": "error: boom", "2h": 2 },
      windowMinutes: 10,
    }),
  );
  assertEquals(calls.slice(0, 2), EXPECTED_ENQUEUE);
});

Deno.test("#4514 reminders: missing bearer is still refused before any call", async () => {
  env();
  const calls: Call[] = [];
  const res = await handler(new Request("https://x", { method: "POST" }), {
    createAdmin: () => fakeAdmin(calls, {}),
  });
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

// ── After the wave 4 change: the form step itself ───────────────────────────

const FORM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ATT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RSVP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

Deno.test("#4514 reminders: a failing form step never blocks or changes the reminder calls", async () => {
  env();
  const calls: Call[] = [];
  const res = await handler(req(), {
    createAdmin: () =>
      fakeAdmin(calls, {
        "pg_notify_reminders_enqueue:24h": { data: 3, error: null },
        "pg_notify_reminders_enqueue:2h": { data: 1, error: null },
        brand_form_auto_reminders_due: {
          data: null,
          error: { message: "down" },
        },
      }),
  });
  assertEquals(calls.slice(0, 2), EXPECTED_ENQUEUE);
  assertEquals(res.status, 207);
  const body = await res.json();
  assertEquals(body.enqueued, { "24h": 3, "2h": 1 });
  assertEquals(body.ok, false);
});

Deno.test("#4514 reminders: due reminders are queued in SQL, then the drain sends the guest's link by text or email (never push) and settles", async () => {
  env();
  const calls: Call[] = [];
  const sent: DispatchV2Input[] = [];
  let pages = 0;
  const res = await handler(req(), {
    createAdmin: () => ({
      rpc: (fn, args) => {
        calls.push({ fn, args });
        if (fn === "pg_notify_reminders_enqueue") {
          return Promise.resolve({ data: 0, error: null });
        }
        // #4541 R1.8: the drain reads the forms off switch once per run.
        if (fn === "brand_forms_switched_off") {
          return Promise.resolve({ data: false, error: null });
        }
        if (fn === "brand_form_auto_reminders_due") {
          return Promise.resolve({
            data: { runs: 1, queued: 1, held: 0 },
            error: null,
          });
        }
        if (fn === "brand_form_request_claim_batch") {
          pages += 1;
          return Promise.resolve({
            data: pages > 1 ? [] : [{
              sendId: ATT,
              token: "b".repeat(64),
              formId: FORM,
              eventId: EVENT,
              kind: "auto",
              subjectKind: "rsvp",
              subjectId: RSVP,
              userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              route: ["email"],
              phone: null,
              email: "val@example.test",
              brandName: "Lagos Supper",
              eventTitle: "Supper Club",
              eventTimezone: "Africa/Lagos",
              startsAt: "2028-03-04T18:00:00Z",
            }],
            error: null,
          });
        }
        return Promise.resolve({ data: true, error: null });
      },
    }),
    dispatch: (input) => {
      sent.push(input);
      return Promise.resolve(
        {
          success: true,
          deliveries: [{ channel: "email", status: "sent" }],
        } as unknown as DispatchV2Result,
      );
    },
  });
  assertEquals(calls.slice(0, 2), EXPECTED_ENQUEUE);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.formReminders, {
    runs: 1,
    queued: 1,
    held: 0,
    sent: 1,
    failed: 0,
    more: false,
  });
  assertEquals(sent.length, 1);
  assertEquals(sent[0].contact, "val@example.test");
  assertEquals(sent[0].user_id, null);
  assertEquals(sent[0].requested_channel, undefined);
  assertEquals(
    sent[0].payload.form_url,
    `https://host.usemingla.com/form/${FORM}#t=${"b".repeat(64)}`,
  );
  const claim = calls.find((c) => c.fn === "brand_form_request_claim_batch");
  assertEquals(claim?.args, {
    p_limit: 25,
    p_form_id: null,
    p_event_id: null,
  });
  const settle = calls.find((c) => c.fn === "brand_form_request_settle");
  assertEquals(settle?.args, {
    p_send_id: ATT,
    p_channel: "email",
    p_status: "sent",
    p_reason: null,
  });
});

Deno.test("#4514 reminders: any bearer other than the exact service-role key is refused before any call", async () => {
  env();
  const calls: Call[] = [];
  const res = await handler(
    new Request("https://x", {
      method: "POST",
      headers: { Authorization: "Bearer someone-elses-jwt" },
    }),
    { createAdmin: () => fakeAdmin(calls, {}) },
  );
  assertEquals(res.status, 403);
  assertEquals(calls.length, 0);
});

Deno.test("#4514 reminders: the notify-dispatch call carries the service bearer and the form link, and the email gets its link button", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fakeFetch = ((url: string, init: RequestInit) => {
    seen.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, deliveries: [] })),
    );
  }) as unknown as typeof fetch;
  const link = `https://host.usemingla.com/form/${FORM}#t=${"c".repeat(64)}`;
  const result = await viaNotifyDispatch(
    "https://example.supabase.co",
    "service-key",
    {
      user_id: null,
      contact: "val@example.test",
      category_key: "brand_form_request",
      payload: { form_id: FORM, brand_name: "Lagos Supper", form_url: link },
      idempotency_key: "brand_form_request:x:email",
    },
    fakeFetch,
  );
  assertEquals(result.success, true);
  assertEquals(
    seen[0].url,
    "https://example.supabase.co/functions/v1/notify-dispatch",
  );
  assertEquals(
    (seen[0].init.headers as Record<string, string>).Authorization,
    "Bearer service-key",
  );
  const sentBody = JSON.parse(String(seen[0].init.body));
  assertEquals(sentBody.payload.form_url, link);
  // notify-dispatch's contact path builds the button from that payload.
  assertEquals(
    brandFormEmailCta("brand_form_request", sentBody.payload)?.url,
    link,
  );
  assertEquals(
    transactionalConsentSourceForCategory("brand_form_request"),
    "brand_form_request",
  );
});
