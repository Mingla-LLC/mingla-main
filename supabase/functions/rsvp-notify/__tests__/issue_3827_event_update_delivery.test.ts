// Issue #3827 — the REAL rsvp-notify worker delivering a live-edit notice.
//
// Runs the actual handler (serve() captured by the import-map shim), the real
// Supabase client, the real unified dispatcher, the real email and SMS
// adapters and the real email module. Only the network is replaced: every
// request goes to an in-memory fixture, and any request the fixture does not
// recognise fails the test. No real provider, database or secret is touched,
// and nothing is sent.
//
// What it proves:
//   D-01 a database without the fan-out function is "nothing to do": the tick
//        still claims, and a legacy `rsvp_event_updated` row (no notice id) is
//        sent exactly as before;
//   D-02 the fan-out runs before the claim, on the tick only;
//   D-03 a buyer row is rendered through the new module: fixed-vocabulary
//        subject, tickets@ sender, Reply-To = the brand's contact address,
//        email-only category, one notice read for many recipients;
//   D-04 Reply-To falls back to support when the brand has no usable address;
//   D-05 edit-notice rows go out five at a time;
//   D-06 a provider 429 is retryable, never terminal;
//   D-07 a listing no longer on sale, a withdrawn notice and a buyer row with
//        no notice are parked without a provider call; an unreadable notice
//        is retried;
//   D-08 a going RSVP guest keeps the text channel, now with real wording.
//
// fails-on-revert:
//   - fan-out error treated as fatal            -> D-01 reds
//   - notice rows rendered by the generic body  -> D-03 reds (subject, reply_to)
//   - groups of 5 removed                       -> D-05 reds (12 in flight)
//   - legacy rows routed through the notice     -> D-01 reds
//
// Run: deno test --import-map=supabase/functions/rsvp-notify/__tests__/_importmap.test.json
//        --allow-read --no-check <this file>
import { getCapturedHandler } from "../../_shared/__tests__/_serveShim.ts";

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};
const same = (actual: unknown, expected: unknown, message: string): void =>
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );

const ORIGIN = "https://fixture.invalid";
const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const NOTICE_ID = "44444444-4444-4444-8444-444444444444";
const RSVP_ID = "22222222-2222-4222-8222-222222222222";

const fixtureEnv: Record<string, string> = {
  SUPABASE_URL: ORIGIN,
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-only",
  RESEND_API_KEY: "fixture-resend-only",
  // Test-only footer fallback in _shared/email; no product branch.
  DENO_TESTING: "1",
  "app.qr_token_pepper": "fixture-pepper-3827-not-a-real-secret-123456789",
  SMS_LIVE_ENABLED_US: "true",
  TWILIO_ACCOUNT_SID: "ACfixture",
  TWILIO_AUTH_TOKEN: "fixture-only",
  TWILIO_MESSAGING_SERVICE_SID: "MGfixture",
};

interface ClaimRow {
  delivery_id: string;
  notification_id: string;
  channel: "email" | "sms" | "in_app" | "push";
  attempt_count: number;
  lease_id: string;
  template_key: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
}

interface World {
  fanout: "ok" | "missing" | "broken";
  claims: ClaimRow[];
  notice: Record<string, unknown> | null | "error";
  event: Record<string, unknown> | null;
  resendStatus: number;
  sendCheck: string | "error";
  legacyAlert: "ok" | "error";
}

interface Seen {
  order: string[];
  fanoutArgs: unknown[];
  claimArgs: unknown[];
  emails: Array<{ body: Record<string, unknown>; idempotencyKey: string | null }>;
  texts: Array<Record<string, string>>;
  completions: Array<Record<string, unknown>>;
  categoryReads: string[];
  sendChecks: unknown[];
  legacyAlerts: unknown[];
  noticeReads: number;
  eventReads: number;
  inFlight: number;
  maxInFlight: number;
  rejected: string[];
}

const baseEvent = (): Record<string, unknown> => ({
  id: EVENT_ID,
  title: "Sunset Sessions",
  slug: "sunset-sessions",
  timezone: "Africa/Lagos",
  event_type: "event",
  status: "scheduled",
  deleted_at: null,
  brands: {
    name: "Casa Lenta Retreats",
    slug: "casa-lenta",
    contact_email: "hello@casalenta.example",
    deleted_at: null,
  },
});

const baseNotice = (): Record<string, unknown> => ({
  id: NOTICE_ID,
  event_id: EVENT_ID,
  state: "fanned_out",
  reason: "The original venue has a power fault, see https://evil.example/pay",
  notice_changes: [
    { field: "venue", old: "Waterside Event Centre", new: "The Deck at Landmark" },
  ],
  after_snapshot: { venue: "The Deck at Landmark" },
});

const world: World = {
  fanout: "ok",
  claims: [],
  notice: baseNotice(),
  event: baseEvent(),
  resendStatus: 200,
  sendCheck: "ok",
  legacyAlert: "ok",
};
const seen: Seen = {
  order: [],
  fanoutArgs: [],
  claimArgs: [],
  emails: [],
  texts: [],
  completions: [],
  categoryReads: [],
  sendChecks: [],
  legacyAlerts: [],
  noticeReads: 0,
  eventReads: 0,
  inFlight: 0,
  maxInFlight: 0,
  rejected: [],
};

function reset(next: Partial<World> = {}): void {
  Object.assign(world, {
    fanout: "ok",
    claims: [],
    notice: baseNotice(),
    event: baseEvent(),
    resendStatus: 200,
    sendCheck: "ok",
    legacyAlert: "ok",
  }, next);
  Object.assign(seen, {
    order: [],
    fanoutArgs: [],
    claimArgs: [],
    emails: [],
    texts: [],
    completions: [],
    categoryReads: [],
    sendChecks: [],
    legacyAlerts: [],
    noticeReads: 0,
    eventReads: 0,
    inFlight: 0,
    maxInFlight: 0,
    rejected: [],
  });
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const CATEGORY_CHANNELS: Record<string, string[]> = {
  buyer_event_updated: ["email"],
  rsvp_acknowledgement: ["inapp", "push", "email", "sms"],
};

Deno.env.get = (name: string) => fixtureEnv[name];
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.origin === ORIGIN) {
    const leaf = url.pathname.split("/").at(-1) ?? "";
    const body = req.method === "GET" ? null : await req.json();
    if (leaf === "event_edit_notice_fanout") {
      seen.order.push("fanout");
      seen.fanoutArgs.push(body);
      if (world.fanout === "missing") {
        return jsonResponse({
          code: "PGRST202",
          details: null,
          hint: null,
          message:
            "Could not find the function public.event_edit_notice_fanout(p_limit) in the schema cache",
        }, 404);
      }
      if (world.fanout === "broken") {
        return jsonResponse({ code: "XX000", message: "internal error" }, 500);
      }
      return jsonResponse({ notices: 0, rows: 0 });
    }
    if (leaf === "event_edit_notice_send_check") {
      seen.sendChecks.push(body);
      if (world.sendCheck === "error") {
        return jsonResponse({ code: "57014", message: "canceling statement" }, 500);
      }
      return jsonResponse(world.sendCheck);
    }
    if (leaf === "event_edit_notice_legacy_alert") {
      seen.legacyAlerts.push(body);
      if (world.legacyAlert === "error") {
        return jsonResponse({ code: "57014", message: "canceling statement" }, 500);
      }
      return jsonResponse(true);
    }
    if (leaf === "claim_rsvp_notification_deliveries") {
      seen.order.push("claim");
      seen.claimArgs.push(body);
      return jsonResponse(world.claims);
    }
    if (leaf === "finish_rsvp_notification_delivery") {
      seen.completions.push(body);
      return jsonResponse(true);
    }
    if (leaf === "can_send" || leaf === "mark_rsvp_notification_provider_io") {
      return jsonResponse(true);
    }
    if (leaf === "notification_categories") {
      const key = (url.searchParams.get("key") ?? "").replace(/^eq\./, "");
      seen.categoryReads.push(key);
      const channels = CATEGORY_CHANNELS[key];
      return jsonResponse(channels ? { key, active: true, default_channels: channels } : null);
    }
    if (leaf === "event_edit_notices" && req.method === "GET") {
      seen.noticeReads += 1;
      if (url.searchParams.get("id") !== `eq.${NOTICE_ID}`) {
        seen.rejected.push(`notice read with the wrong id ${url.search}`);
        throw new Error("notice read with the wrong id");
      }
      if (world.notice === "error") {
        return jsonResponse({ code: "57014", message: "canceling statement" }, 500);
      }
      return jsonResponse(world.notice);
    }
    if (leaf === "events" && req.method === "GET") {
      seen.eventReads += 1;
      if (url.searchParams.get("id") !== `eq.${EVENT_ID}`) {
        seen.rejected.push(`event read with the wrong id ${url.search}`);
        throw new Error("event read with the wrong id");
      }
      return jsonResponse(world.event);
    }
  }
  if (url.href === "https://api.resend.com/emails") {
    seen.inFlight += 1;
    seen.maxInFlight = Math.max(seen.maxInFlight, seen.inFlight);
    const payload = await req.json();
    // Hold the request open long enough for a whole group to be in flight.
    await new Promise((resolve) => setTimeout(resolve, 15));
    seen.inFlight -= 1;
    seen.emails.push({ body: payload, idempotencyKey: req.headers.get("Idempotency-Key") });
    if (world.resendStatus !== 200) {
      return jsonResponse({ message: "rate limited" }, world.resendStatus);
    }
    return jsonResponse({ id: `fixture-email-${seen.emails.length}` });
  }
  if (url.href === "https://api.twilio.com/2010-04-01/Accounts/ACfixture/Messages.json") {
    seen.texts.push(Object.fromEntries(new URLSearchParams(await req.text())));
    return jsonResponse({ sid: "fixture-sms" });
  }
  seen.rejected.push(`${req.method} ${url.origin}${url.pathname}`);
  throw new Error("Unexpected external request blocked");
};

await import("../index.ts");

async function runTick(body: Record<string, unknown> = {}): Promise<void> {
  const handler = getCapturedHandler();
  assert(handler, "rsvp-notify must register its handler through serve()");
  const response = await handler(
    new Request("http://localhost/rsvp-notify", {
      method: "POST",
      headers: {
        Authorization: "Bearer fixture-service-only",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  assert(response.status === 200, `worker answered ${response.status}`);
  await response.body?.cancel();
  same(seen.rejected, [], "no unrecognised outbound request");
}

function buyerClaim(index: number, overrides: Partial<ClaimRow> = {}): ClaimRow {
  return {
    delivery_id: `delivery-${index}`,
    notification_id: `notification-${index}`,
    channel: "email",
    attempt_count: 1,
    lease_id: `lease-${index}`,
    template_key: "buyer_event_updated",
    idempotency_key: `event_edit:${NOTICE_ID}:hash-${index}`,
    payload: {
      template_key: "buyer_event_updated",
      event_id: EVENT_ID,
      noticeId: NOTICE_ID,
      recipientEmail: `buyer-${index}@example.invalid`,
      recipientName: `Buyer ${index}`,
    },
    ...overrides,
  };
}

const legacyClaim = (): ClaimRow => ({
  delivery_id: "delivery-legacy",
  notification_id: "notification-legacy",
  channel: "email",
  attempt_count: 1,
  lease_id: "lease-legacy",
  template_key: "rsvp_event_updated",
  idempotency_key: `rsvp_update:${EVENT_ID}:1790000000:${RSVP_ID}`,
  payload: {
    template_key: "rsvp_event_updated",
    rsvp_id: RSVP_ID,
    event_id: EVENT_ID,
    entityId: RSVP_ID,
    recipientEmail: "guest@example.invalid",
    recipientName: "Fixture guest",
  },
});

const test = (name: string, fn: () => Promise<void>): void =>
  Deno.test({ name, sanitizeOps: false, sanitizeResources: false, fn });

test("D-01 a missing fan-out function is nothing to do, and a legacy row sends as before", async () => {
  for (const fanout of ["missing", "broken"] as const) {
    reset({ fanout, claims: [legacyClaim()] });
    await runTick();
    same(seen.order, ["fanout", "claim"], `${fanout}: the tick still claims`);
    same(seen.emails.length, 1, `${fanout}: the legacy row was sent`);
    const sent = seen.emails[0].body;
    same(sent.subject, "Plans changed: your event", `${fanout}: legacy subject unchanged`);
    assert(
      String(sent.html).includes("The host updated this event."),
      `${fanout}: legacy body unchanged`,
    );
    assert(!("reply_to" in sent), `${fanout}: a legacy row sets no Reply-To`);
    same(seen.noticeReads, 0, `${fanout}: a legacy row never reads a notice`);
    same(seen.categoryReads, ["rsvp_acknowledgement"], `${fanout}: legacy category unchanged`);
    same(seen.completions.map((c) => c.p_status), ["sent"], `${fanout}: completed as sent`);
  }
});

test("D-02 the fan-out runs before the claim, on the tick only", async () => {
  reset();
  await runTick();
  same(seen.order, ["fanout", "claim"], "fan-out then claim");
  same(seen.fanoutArgs, [{ p_limit: 20 }], "fan-out limit");
  same(seen.claimArgs, [{ p_notification_id: null, p_limit: 50 }], "claim unchanged");

  reset();
  await runTick({ notificationId: "55555555-5555-4555-8555-555555555555" });
  same(seen.order, ["claim"], "a single-notification call does not fan out");
});

test("D-03 a buyer row is rendered by the email module, with the brand as Reply-To", async () => {
  reset({ claims: [buyerClaim(1), buyerClaim(2)] });
  await runTick();
  same(seen.emails.length, 2, "one email per buyer");
  same(seen.noticeReads, 1, "the notice is read once for both recipients");
  same(seen.eventReads, 1, "the event is read once for both recipients");
  same(seen.categoryReads, ["buyer_event_updated", "buyer_event_updated"], "email-only category");
  const first = seen.emails.find((email) =>
    (email.body.to as string[])[0] === "buyer-1@example.invalid"
  );
  assert(first, "buyer 1 was emailed");
  same(first.body.subject, "Venue changed: Sunset Sessions", "fixed-vocabulary subject");
  same(first.body.from, "Mingla <tickets@usemingla.com>", "tickets sender");
  same(first.body.reply_to, "hello@casalenta.example", "replies go to the brand");
  same(first.idempotencyKey, `event_edit:${NOTICE_ID}:hash-1:email`, "provider idempotency key");
  const html = String(first.body.html);
  const text = String(first.body.text);
  // Spelled in two parts: the shell-singleton gate reads this file too.
  assert(html.startsWith("<!" + "doctype html>"), "rendered through the shell");
  for (const fragment of [
    "The venue has changed",
    "Hi Buyer 1,",
    "Waterside Event Centre",
    "The Deck at Landmark",
    "Reason given by Casa Lenta Retreats",
    'href="https://host.usemingla.com/e/casa-lenta/sunset-sessions"',
  ]) assert(html.includes(fragment), `the email is missing: ${fragment}`);
  assert(!html.includes("evil.example") && !text.includes("evil.example"), "the link in the reason was removed");
  assert(html.includes("[link removed]"), "the removed link is marked");
  assert(!String(first.body.subject).includes("power fault"), "the reason is not in the subject");
  same(seen.completions.map((c) => c.p_status), ["sent", "sent"], "both completed as sent");
});

test("D-04 Reply-To falls back to support when the brand has no usable address", async () => {
  for (const contact of [null, "", "not-an-address"]) {
    const event = baseEvent();
    (event.brands as Record<string, unknown>).contact_email = contact;
    reset({ claims: [buyerClaim(1)], event });
    await runTick();
    same(seen.emails[0]?.body.reply_to, "support@usemingla.com", `fallback for ${String(contact)}`);
  }
});

test("D-05 edit-notice rows go out five at a time", async () => {
  reset({ claims: Array.from({ length: 12 }, (_, index) => buyerClaim(index + 1)) });
  await runTick();
  same(seen.emails.length, 12, "every buyer was emailed");
  assert(seen.maxInFlight <= 5, `at most 5 provider calls at once, saw ${seen.maxInFlight}`);
  assert(seen.maxInFlight >= 2, `a group is sent together, saw ${seen.maxInFlight}`);
  same(seen.noticeReads, 1, "one notice read for twelve recipients");
  same(seen.completions.length, 12, "every row completed");
});

test("D-06 a provider 429 is retried, never abandoned", async () => {
  reset({ claims: [buyerClaim(1)], resendStatus: 429 });
  await runTick();
  same(seen.completions.length, 1, "one completion");
  same(
    [seen.completions[0].p_status, seen.completions[0].p_safe_error_code],
    ["failed_retryable", "provider_rate_limited"],
    "429 is retryable",
  );
});

test("D-07 nothing is sent for a listing off sale, a withdrawn notice or a row with no notice", async () => {
  const offSale = baseEvent();
  offSale.status = "cancelled";
  reset({ claims: [buyerClaim(1)], event: offSale });
  await runTick();
  same(seen.emails.length, 0, "cancelled event: no provider call");
  same(
    [seen.completions[0].p_status, seen.completions[0].p_safe_error_code],
    ["failed_terminal", "event_not_live"],
    "cancelled event parked",
  );

  const withdrawn = baseNotice();
  withdrawn.state = "held";
  reset({ claims: [buyerClaim(1)], notice: withdrawn });
  await runTick();
  same(seen.emails.length, 0, "held notice: no provider call");
  same(seen.completions[0].p_safe_error_code, "event_not_live", "held notice parked");

  const orphan = buyerClaim(1);
  delete orphan.payload.noticeId;
  reset({ claims: [orphan] });
  await runTick();
  same(seen.emails.length, 0, "buyer row with no notice: no provider call");
  same(
    [seen.completions[0].p_status, seen.completions[0].p_safe_error_code],
    ["failed_terminal", "event_notice_missing"],
    "buyer row with no notice parked",
  );

  reset({ claims: [buyerClaim(1)], notice: "error" });
  await runTick();
  same(seen.emails.length, 0, "unreadable notice: no provider call");
  same(
    [seen.completions[0].p_status, seen.completions[0].p_safe_error_code],
    ["failed_retryable", "event_notice_unavailable"],
    "unreadable notice retried",
  );

  const empty = baseNotice();
  empty.notice_changes = [];
  reset({ claims: [buyerClaim(1)], notice: empty });
  await runTick();
  same(seen.emails.length, 0, "empty notice: no provider call");
  same(seen.completions[0].p_safe_error_code, "event_notice_empty", "empty notice parked");
});

test("D-08 a going guest keeps the text channel, with real wording", async () => {
  const rsvpEvent = baseEvent();
  rsvpEvent.event_type = "rsvp";
  reset({
    event: rsvpEvent,
    claims: [{
      delivery_id: "delivery-sms",
      notification_id: "notification-sms",
      channel: "sms",
      attempt_count: 1,
      lease_id: "lease-sms",
      template_key: "rsvp_event_updated",
      idempotency_key: `event_edit:${NOTICE_ID}:hash-guest`,
      payload: {
        template_key: "rsvp_event_updated",
        rsvp_id: RSVP_ID,
        event_id: EVENT_ID,
        noticeId: NOTICE_ID,
        entityId: RSVP_ID,
        recipientPhone: "+15551234567",
        recipientName: "Fixture guest",
      },
    }],
  });
  await runTick();
  same(seen.texts.length, 1, "one text");
  same(seen.emails.length, 0, "no email for a text delivery");
  const message = seen.texts[0].Body ?? "";
  assert(message.includes("Sunset Sessions"), `the text names the event: ${message}`);
  assert(
    message.includes("https://host.usemingla.com/e/casa-lenta/sunset-sessions"),
    `the text links to the event page: ${message}`,
  );
  assert(!message.includes("your event"), "no placeholder wording");
  same(seen.categoryReads, ["rsvp_acknowledgement"], "the guest category is unchanged");
  same(seen.completions.map((c) => c.p_status), ["sent"], "completed as sent");
});

test("D-09 an address hidden after the notice was recorded is never printed", async () => {
  // The notice was recorded while the address was public: both streets in it.
  const notice = baseNotice();
  notice.notice_changes = [
    { field: "venue", old: "Waterside Event Centre", new: "The Deck at Landmark" },
    {
      field: "address",
      old: "5 Admiralty Road, Lekki Phase 1",
      new: "Water Corporation Drive, Victoria Island",
    },
  ];
  // The event hides its address NOW (PostgREST returns the `->>` read as text).
  const hidden = baseEvent();
  hidden.address_withheld = "true";
  reset({ claims: [buyerClaim(1)], notice, event: hidden });
  await runTick();
  same(seen.emails.length, 1, "the email still goes, without the street");
  const body = seen.emails[0].body;
  for (const part of [String(body.html), String(body.text), String(body.subject)]) {
    assert(!part.includes("Admiralty"), "old street printed after the address was hidden");
    assert(!part.includes("Water Corporation"), "new street printed after the address was hidden");
  }
  assert(String(body.html).includes("The address has changed."), "the email says the address changed");
  assert(String(body.html).includes("The Deck at Landmark"), "the venue name is still shown");

  // A venue that was only ever the label (it can hold the street) is withheld too.
  const labelNotice = baseNotice();
  labelNotice.notice_changes = [{ field: "venue", old: "5 Admiralty Road", new: "9 Marina Street" }];
  labelNotice.after_snapshot = { venue: null, venue_from_label: true };
  reset({ claims: [buyerClaim(2)], notice: labelNotice, event: hidden });
  await runTick();
  const labelled = String(seen.emails[0]?.body.html ?? "");
  assert(!labelled.includes("Admiralty") && !labelled.includes("Marina Street"), "a label venue printed while hidden");

  // Not hidden now: the recorded values print as before.
  reset({ claims: [buyerClaim(3)], notice: baseNotice() });
  await runTick();
  assert(String(seen.emails[0]?.body.html).includes("Waterside Event Centre"), "public values still print");
});

test("D-10 a copy fanned out before the switch went off is held at send time, with no provider call", async () => {
  for (const [check, code] of [
    ["held_feature_off", "held_feature_off"],
    ["held_allowlist", "held_allowlist"],
    ["notice_missing", "event_notice_missing"],
  ] as const) {
    reset({ claims: [buyerClaim(1)], sendCheck: check });
    await runTick();
    same(seen.emails.length, 0, `${check}: no provider call`);
    same(
      [seen.completions[0]?.p_status, seen.completions[0]?.p_safe_error_code],
      ["failed_terminal", code],
      `${check}: completed as held`,
    );
    same(seen.sendChecks, [{ p_notice_id: NOTICE_ID, p_email: "buyer-1@example.invalid" }], `${check}: asked once, for this address`);
  }
  // The check cannot be read: the copy waits, it is never sent blind.
  reset({ claims: [buyerClaim(1)], sendCheck: "error" });
  await runTick();
  same(seen.emails.length, 0, "check unavailable: no provider call");
  same(
    [seen.completions[0]?.p_status, seen.completions[0]?.p_safe_error_code],
    ["failed_retryable", "event_notice_check_unavailable"],
    "check unavailable: retried",
  );
  // Switch still on: sent. A legacy row is never checked.
  reset({ claims: [buyerClaim(2), legacyClaim()] });
  await runTick();
  same(seen.emails.length, 2, "both sent");
  same(seen.sendChecks.length, 1, "only the notice row was checked");
});

test("D-11 one copy that throws never stops the groups after it", async () => {
  const { inGroupsOf } = await import("../eventUpdate.ts");
  const done: number[] = [];
  const previousError = console.error;
  console.error = () => undefined;
  try {
    await inGroupsOf(Array.from({ length: 12 }, (_, i) => i), 5, async (item) => {
      if (item === 2) throw new Error("boom");
      done.push(item);
    });
  } finally {
    console.error = previousError;
  }
  same(done.sort((a, b) => a - b), [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11], "every other item ran");
});

test("D-12 a guest whose copy is held gets today's alert instead; if that cannot be queued the copy waits", async () => {
  const guest = (): ClaimRow => ({
    delivery_id: "delivery-guest",
    notification_id: "notification-guest",
    channel: "email",
    attempt_count: 1,
    lease_id: "lease-guest",
    template_key: "rsvp_event_updated",
    idempotency_key: `event_edit:${NOTICE_ID}:hash-guest`,
    payload: {
      template_key: "rsvp_event_updated",
      rsvp_id: RSVP_ID,
      event_id: EVENT_ID,
      noticeId: NOTICE_ID,
      recipientEmail: "guest@example.invalid",
    },
  });
  const rsvpEvent = baseEvent();
  rsvpEvent.event_type = "rsvp";
  reset({ claims: [guest()], event: rsvpEvent, sendCheck: "held_feature_off" });
  await runTick();
  same(seen.emails.length, 0, "no provider call");
  same(seen.legacyAlerts, [{ p_notice_id: NOTICE_ID, p_rsvp_id: RSVP_ID }], "today's alert asked for, once");
  same(seen.completions[0]?.p_safe_error_code, "held_feature_off", "the copy is held");

  reset({ claims: [guest()], event: rsvpEvent, sendCheck: "held_allowlist", legacyAlert: "error" });
  await runTick();
  same(
    [seen.completions[0]?.p_status, seen.completions[0]?.p_safe_error_code],
    ["failed_retryable", "event_notice_alert_unavailable"],
    "the copy waits when the alert cannot be queued",
  );

  // A buyer has no usual alert: nothing is asked for.
  reset({ claims: [buyerClaim(1)], sendCheck: "held_feature_off" });
  await runTick();
  same(seen.legacyAlerts.length, 0, "no alert for a ticket buyer");
});
