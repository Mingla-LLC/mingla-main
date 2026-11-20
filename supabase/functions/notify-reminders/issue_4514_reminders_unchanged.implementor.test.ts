// #4514 wave 4 — today's buyer and reservation reminders are unchanged.
//
// notify-reminders gained the optional brand form reminder (decision 13). This
// pins what the cron's existing work does, byte for byte: the same two
// pg_notify_reminders_enqueue calls with the same arguments, in the same order,
// and the same response, whether or not a form reminder is due, and even when
// the form step fails. Run before and after the wave 4 change (see #4514).
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler, type ReminderAdmin } from "./index.ts";

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

Deno.test("#4514 reminders: a due form reminder sends push first, then the ticked email, and settles", async () => {
  env();
  const calls: Call[] = [];
  const sent: Array<
    {
      category: string;
      channel: string | null | undefined;
      contact: string | null | undefined;
    }
  > = [];
  const res = await handler(req(), {
    createAdmin: () =>
      fakeAdmin(calls, {
        "pg_notify_reminders_enqueue:24h": { data: 0, error: null },
        "pg_notify_reminders_enqueue:2h": { data: 0, error: null },
        brand_form_auto_reminders_due: {
          data: [{
            attachmentId: ATT,
            formId: FORM,
            eventId: EVENT,
            channels: ["email", "push"],
          }],
          error: null,
        },
        brand_form_request_audience: {
          data: {
            formId: FORM,
            eventId: EVENT,
            brandId: ATT,
            formName: "Sign-up",
            eventTitle: "Open mic",
            brandName: "Brand A",
            recipients: [{
              kind: "rsvp",
              id: RSVP,
              userId: null,
              email: "g@example.test",
              phone: "+12025550101",
              answered: false,
              throttled: false,
              smsAllowed: true,
              emailAllowed: true,
            }],
          },
          error: null,
        },
        brand_form_request_claim: {
          data: { claimed: true, sendId: ATT, token: "a".repeat(64) },
          error: null,
        },
        brand_form_request_settle: { data: true, error: null },
        brand_form_auto_reminder_settle: { data: true, error: null },
      }),
    dispatch: (input) => {
      sent.push({
        category: input.category_key,
        channel: input.requested_channel,
        contact: input.contact,
      });
      return Promise.resolve({
        success: true,
        deliveries: [{
          channel: "email",
          status: "sent",
          providerMessageId: "m1",
        }],
      });
    },
  });
  assertEquals(res.status, 200);
  assertEquals(calls.slice(0, 2), EXPECTED_ENQUEUE);
  // No account, so no push; texts were not ticked, so the email on file. Never the phone.
  assertEquals(sent, [{
    category: "brand_form_request",
    channel: undefined,
    contact: "g@example.test",
  }]);
  const claim = calls.find((c) => c.fn === "brand_form_request_claim");
  assertEquals(claim?.args.p_kind, "auto");
  assertEquals(
    calls.some((c) =>
      c.fn === "brand_form_auto_reminder_settle" &&
      c.args.p_attachment_id === ATT
    ),
    true,
  );
  const body = await res.json();
  assertEquals(body.formReminders, { pages: 1, sent: 1, failed: 0 });
});
