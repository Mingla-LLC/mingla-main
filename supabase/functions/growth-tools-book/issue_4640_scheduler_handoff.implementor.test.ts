import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  defaultSchedulerKey,
  legacySchedulerProfile,
  loadSchedulerProfile,
  mergeBookingHandoff,
  resolveBookingHandoff,
  schedulerKey,
  sha256Hex,
} from "./schedulerProfile.ts";

const CONFIG = {
  supabaseUrl: "https://project.example",
  serviceKey: "service-key",
  defaultCalendarId: "real-calendar@example.com",
};
const AVAILABILITY = {
  weekdays: [1, 2, 3, 4, 5],
  start_minute: 300,
  end_minute: 1200,
  min_notice_minutes: 720,
  lookahead_days: 45,
  max_open_days: 31,
};

Deno.test("#4640 stable route aliases map to registry keys; future valid keys pass through", () => {
  assertEquals(defaultSchedulerKey("host"), "host-demo");
  assertEquals(defaultSchedulerKey("creator"), "creator-call");
  assertEquals(schedulerKey("hotel-sales", "host"), "hotel-sales");
  assertEquals(schedulerKey("not valid!", "local"), "local-call");
  assertEquals(
    legacySchedulerProfile("host-demo", CONFIG)?.calendarId,
    "real-calendar@example.com",
  );
  assertEquals(legacySchedulerProfile("future-key", CONFIG), null);
});

Deno.test("#4640 the profile registry owns calendar, duration, time zone and availability", async () => {
  const old = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(Response.json([{
      key: "host-demo",
      name: "Lagos Host demo",
      audience: "host",
      calendar_id: "lagos@example.com",
      time_zone: "Africa/Lagos",
      notify_to: "kunle@usemingla.com",
      duration_minutes: 30,
      availability: AVAILABILITY,
    }]))) as typeof fetch;
  try {
    const p = await loadSchedulerProfile("host-demo", CONFIG);
    assertEquals(p?.calendarId, "lagos@example.com");
    assertEquals(p?.timeZone, "Africa/Lagos");
    assertEquals(p?.notifyTo, "kunle@usemingla.com");
    assertEquals(p?.durationMinutes, 30);
    assertEquals(p?.weekdays, [1, 2, 3, 4, 5]);
  } finally {
    globalThis.fetch = old;
  }
});

Deno.test("#4640 saved answers prefill but do not overwrite a visitor's edits", () => {
  const profile = legacySchedulerProfile("host-demo", CONFIG)!;
  const merged = mergeBookingHandoff({
    name: "Amara's corrected name",
    phone: "+2348099999999",
    audience: "creator",
    scheduler_key: "creator-call",
    form_submission_id: "attacker-value",
  }, {
    submissionId: "46400000-0000-4000-8000-000000000004",
    scheduler: profile,
    payload: {
      name: "Amara",
      email: "amara@example.com",
      phone: "+2348012345678",
    },
  });
  assertEquals(merged.name, "Amara's corrected name");
  assertEquals(merged.email, "amara@example.com");
  assertEquals(merged.phone, "+2348099999999");
  assertEquals(merged.audience, "host");
  assertEquals(merged.scheduler_key, "host-demo");
  assertEquals(
    merged.form_submission_id,
    "46400000-0000-4000-8000-000000000004",
  );
});

Deno.test("#4640 handoff sends only SHA-256 to the database and returns server-saved answers", async () => {
  const token = "a_secure_random_handoff_token_1234567890ABCDEFG";
  let sent: Record<string, unknown> | null = null;
  const old = globalThis.fetch;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body ?? "{}"));
    return Promise.resolve(Response.json({
      submission_id: "46400000-0000-4000-8000-000000000004",
      scheduler: {
        key: "host-demo",
        name: "Host demo",
        audience: "host",
        calendar_id: "environment-default",
        time_zone: "America/New_York",
        notify_to: "seth@usemingla.com",
        duration_minutes: 20,
        availability: AVAILABILITY,
      },
      payload: {
        name: "Ada Host",
        email: "ada@example.com",
        phone: "+2348012345678",
      },
    }));
  }) as typeof fetch;
  try {
    const h = await resolveBookingHandoff(token, "host-demo", CONFIG);
    const captured = sent as Record<string, unknown> | null;
    assertEquals(h?.payload.phone, "+2348012345678");
    assertEquals(captured?.p_token_sha256, await sha256Hex(token));
    assertNotEquals(captured?.p_token_sha256, token);
    assert(
      !JSON.stringify(captured).includes("Ada Host"),
      "answers are not sent by the browser to resolve the token",
    );
  } finally {
    globalThis.fetch = old;
  }
});
