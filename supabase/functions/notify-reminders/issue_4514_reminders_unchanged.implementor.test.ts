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
      const key = fn === "pg_notify_reminders_enqueue" ? `${fn}:${String(args.p_lead_bucket)}` : fn;
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
  new Request("https://x/notify-reminders", { method: "POST", headers: { Authorization: "Bearer service-key" } });

const EXPECTED_ENQUEUE: Call[] = [
  { fn: "pg_notify_reminders_enqueue", args: { p_lead_hours: 24, p_lead_bucket: "24h", p_window_minutes: 10 } },
  { fn: "pg_notify_reminders_enqueue", args: { p_lead_hours: 2, p_lead_bucket: "2h", p_window_minutes: 10 } },
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
  assertEquals(await res.text(), JSON.stringify({ ok: true, enqueued: { "24h": 3, "2h": 1 }, windowMinutes: 10 }));
  assertEquals(calls.filter((c) => c.fn === "pg_notify_reminders_enqueue"), EXPECTED_ENQUEUE);
  // The reminders run first; nothing is sent before them.
  assertEquals(calls.slice(0, 2), EXPECTED_ENQUEUE);
});

Deno.test("#4514 reminders: a failing bucket still reports 207 with the same body shape", async () => {
  env();
  const calls: Call[] = [];
  const res = await handler(req(), {
    createAdmin: () =>
      fakeAdmin(calls, {
        "pg_notify_reminders_enqueue:24h": { data: null, error: { message: "boom" } },
        "pg_notify_reminders_enqueue:2h": { data: 2, error: null },
        brand_form_auto_reminders_due: { data: [], error: null },
      }),
  });
  assertEquals(res.status, 207);
  assertEquals(await res.text(), JSON.stringify({ ok: false, enqueued: { "24h": "error: boom", "2h": 2 }, windowMinutes: 10 }));
  assertEquals(calls.slice(0, 2), EXPECTED_ENQUEUE);
});

Deno.test("#4514 reminders: missing bearer is still refused before any call", async () => {
  env();
  const calls: Call[] = [];
  const res = await handler(new Request("https://x", { method: "POST" }), { createAdmin: () => fakeAdmin(calls, {}) });
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});
