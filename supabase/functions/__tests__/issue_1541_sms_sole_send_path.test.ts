// Issue #1541 — RUNTIME COMPANION to the strict-grep gate.
//
// ===========================================================================
// WHY THIS FILE EXISTS, AND WHY IT DRIVES REAL HANDLERS.
// ===========================================================================
// `.github/scripts/strict-grep/issue-1541-sms-provider-sole-send-path.mjs`
// proves no edge function CONTAINS a direct provider call. That is a statement
// about source text, and source text is not behaviour. The defect this issue
// closes survived for months underneath a green gate precisely because the only
// gate that existed read the one file guaranteed to comply.
//
// So this suite asserts on CAPTURED HTTP. Every one of the four migrated
// functions is driven through its REAL exported handler with a REAL Request,
// with `globalThis.fetch` stubbed and recording, and with the market kill
// switch driven through `MINGLA_DELIVERY_FLAGS_JSON` — the actual production
// mechanism Seth flips, not the legacy env var. The assertions are about the
// requests that were and were not made.
//
// Static + runtime together are the defence; neither alone is claimed to be
// sufficient.
//
// EVERY GROUP CARRIES A VACUITY GUARD. A sweep that reached no provider, or a
// drive that made no Supabase call, FAILS rather than passing over an empty
// set — the #1529 lesson, applied to this suite's own harness. If the handler
// silently returned early, "zero Twilio calls" would be trivially true and
// would prove nothing; so every dark-market case ALSO asserts that the function
// really ran (its DB writes are present) and that a live-market control on the
// same path DOES reach Twilio exactly once.
//
// fails-on-revert: restoring any of the four direct Twilio calls makes the
// NG-dark case for that function fail, because an ungated direct client
// performs provider HTTP that the adapter's kill switch would have prevented.
//
// Run:
//   deno test --allow-env --allow-net --allow-read --no-check \
//     supabase/functions/__tests__/issue_1541_sms_sole_send_path.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

// ---------------------------------------------------------------------------
// Deno.listen stub — installed BEFORE any handler module is imported.
//
// Each edge function calls `serve(handler)` at module scope. std's `serve`
// binds a port via Deno.listen, and four modules would collide on the same one
// (and leak a listener into the test process). Replacing Deno.listen with a
// listener whose accept() never resolves means `serve` never serves: module
// evaluation completes, no port is bound, no resource leaks, and the exported
// handler is ours to call directly. This is why the imports below are dynamic.
// ---------------------------------------------------------------------------
const realListen = Deno.listen;
// deno-lint-ignore no-explicit-any
(Deno as any).listen = (): unknown => ({
  addr: { transport: "tcp", hostname: "127.0.0.1", port: 0 },
  rid: -1,
  close(): void {},
  accept(): Promise<never> {
    return new Promise<never>(() => {});
  },
  ref(): void {},
  unref(): void {},
  [Symbol.asyncIterator]() {
    return { next: () => new Promise<never>(() => {}) };
  },
});

const SUPABASE_URL = "https://example-test.supabase.co";
const SERVICE_KEY = "test-service-role-key-not-real";
const TWILIO_HOST = "api.twilio.com";
const TERMII_HOST = "v3.api.termii.com";
const TERMII_BASE = `https://${TERMII_HOST}`;

const NG_NUMBER = "+2348012345678";
const US_NUMBER = "+12015550199";
const GB_NUMBER = "+447700900123";
const UNMAPPED_NUMBER = "+4915112345678"; // DE — deliberately not in the table

// Env this suite owns. Snapshotted and hard-reset per case so no ambient CI
// value can silently change a verdict.
const OWNED_KEYS = [
  "MINGLA_DELIVERY_FLAGS_JSON",
  "MINGLA_RUNTIME_CONFIG_JSON",
  "SMS_LIVE_ENABLED_NG",
  "SMS_LIVE_ENABLED_US",
  "TERMII_API_KEY",
  "TERMII_BASE_URL",
  "TERMII_SENDER_ID",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_STATUS_CALLBACK_SECRET",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "RESEND_API_KEY",
];

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of OWNED_KEYS) snap[k] = Deno.env.get(k);
  return snap;
}
function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
}

/** The REAL production shape of the delivery-flag bundle. */
function deliveryBundle(ng: boolean, us: boolean): string {
  return JSON.stringify({
    schema_version: 1,
    marketing_send_live_enabled: false,
    sms_live_enabled: { ng, us },
  });
}

function setBaseEnv(opts: { ng: boolean; us: boolean }): void {
  for (const k of OWNED_KEYS) Deno.env.delete(k);
  Deno.env.set("SUPABASE_URL", SUPABASE_URL);
  Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key-not-real");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
  Deno.env.set("TWILIO_ACCOUNT_SID", "AC1541test");
  Deno.env.set("TWILIO_AUTH_TOKEN", "tok1541test");
  Deno.env.set("TWILIO_MESSAGING_SERVICE_SID", "MG1541test");
  Deno.env.set("TERMII_API_KEY", "tk1541test");
  Deno.env.set("TERMII_BASE_URL", TERMII_BASE);
  Deno.env.set("TERMII_SENDER_ID", "Mingla");
  Deno.env.set("RESEND_API_KEY", "re_1541test");
  Deno.env.set("MINGLA_DELIVERY_FLAGS_JSON", deliveryBundle(opts.ng, opts.us));
}

// ---------------------------------------------------------------------------
// fetch harness — records EVERY outbound call so "ZERO provider HTTP" is an
// assertion about observed traffic, never an inference.
// ---------------------------------------------------------------------------
interface Capture {
  method: string;
  url: string;
  body: string;
  headers: Record<string, string>;
}

const realFetch = globalThis.fetch;
let captures: Capture[] = [];

/**
 * Table name → rows returned for a SELECT. Anything absent returns [].
 *
 * A value may be a FUNCTION of the request URL, because several of these
 * handlers query the SAME table with different filters and expect different
 * answers — `send-phone-invite` asks `profiles` both "is this the inviter's own
 * phone?" and "does this phone already belong to a Mingla user?", and a
 * filter-blind fixture answers "yes" to both and short-circuits the function
 * before it ever reaches the send. A fixture that cannot tell those apart makes
 * the whole zero-HTTP claim vacuous, which is why the vacuity guards in each
 * case caught it.
 */
type RowsOrFn = unknown[] | ((url: URL) => unknown[]);
type Fixtures = {
  tables: Record<string, RowsOrFn>;
  rpc?: Record<string, unknown>;
  /** Force a non-2xx on a specific table+method (used for failure injection). */
  fail?: (method: string, table: string) => { status: number; body: string } | null;
  /** Rows a PATCH returns when the caller asked for a representation. */
  patchReturns?: Record<string, unknown[]>;
};

let fixtures: Fixtures = { tables: {} };

function bodyToString(init?: RequestInit): string {
  const b = init?.body;
  if (b === undefined || b === null) return "";
  if (typeof b === "string") return b;
  if (b instanceof URLSearchParams) return b.toString();
  return String(b);
}

function headersToObject(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => (out[k.toLowerCase()] = v));
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[String(k).toLowerCase()] = String(v);
  } else {
    for (const [k, v] of Object.entries(h as Record<string, string>)) {
      out[k.toLowerCase()] = String(v);
    }
  }
  return out;
}

/** PostgREST-shaped responder over the fixture map. */
function restResponse(
  method: string,
  url: URL,
  headers: Record<string, string>,
): Response {
  const path = url.pathname;
  const jsonHeaders = { "content-type": "application/json" };

  if (path === "/auth/v1/user") {
    return new Response(
      JSON.stringify({
        id: "00000000-0000-4000-8000-000000000001",
        aud: "authenticated",
        role: "authenticated",
        email: "operator@example.test",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
      }),
      { status: 200, headers: jsonHeaders },
    );
  }

  const rpcMatch = path.match(/^\/rest\/v1\/rpc\/(.+)$/);
  if (rpcMatch) {
    const fn = rpcMatch[1];
    const value = fixtures.rpc?.[fn] ?? null;
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: jsonHeaders,
    });
  }

  const tableMatch = path.match(/^\/rest\/v1\/([^/]+)$/);
  if (tableMatch) {
    const table = tableMatch[1];
    const forced = fixtures.fail?.(method, table) ?? null;
    if (forced) {
      return new Response(forced.body, {
        status: forced.status,
        headers: jsonHeaders,
      });
    }
    const resolve = (v: RowsOrFn | undefined): unknown[] =>
      typeof v === "function" ? v(url) : v ?? [];
    let rows: unknown[];
    if (method === "GET") {
      rows = resolve(fixtures.tables[table]);
    } else if (method === "PATCH") {
      rows = fixtures.patchReturns?.[table] ?? [];
    } else {
      // POST (insert/upsert) — echo an id so `.select("id").single()` works.
      rows = fixtures.tables[`${table}:insert`] !== undefined
        ? resolve(fixtures.tables[`${table}:insert`])
        : [{ id: "00000000-0000-4000-8000-0000000000ff" }];
    }
    // `.single()` / `.maybeSingle()` ask for a single object via the Accept
    // header; everything else takes an array.
    const accept = headers["accept"] ?? "";
    if (accept.includes("pgrst.object")) {
      if (rows.length === 0) {
        return new Response(
          JSON.stringify({
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          }),
          { status: 406, headers: jsonHeaders },
        );
      }
      return new Response(JSON.stringify(rows[0]), {
        status: 200,
        headers: jsonHeaders,
      });
    }
    return new Response(JSON.stringify(rows), {
      status: 200,
      headers: jsonHeaders,
    });
  }

  // Storage uploads and anything else the dispatcher touches incidentally.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: jsonHeaders,
  });
}

function installFetch(): void {
  captures = [];
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const rawUrl = typeof input === "string"
      ? input
      : (input as Request)?.url ?? String(input);
    const method = (init?.method ??
      (typeof input === "object" ? (input as Request)?.method : undefined) ??
      "GET").toUpperCase();
    const headers = headersToObject(init);
    captures.push({ method, url: rawUrl, body: bodyToString(init), headers });

    if (rawUrl.includes(TWILIO_HOST)) {
      return Promise.resolve(
        new Response(JSON.stringify({ sid: "SM1541runtime" }), { status: 200 }),
      );
    }
    if (rawUrl.includes(TERMII_HOST)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ code: "ok", message_id: "3017857812138224517130997" }),
          { status: 200 },
        ),
      );
    }
    if (rawUrl.includes("api.resend.com")) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: "re_1541runtime" }), { status: 200 }),
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return Promise.resolve(new Response("{}", { status: 200 }));
    }
    return Promise.resolve(restResponse(method, parsed, headers));
  }) as unknown as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

const providerCalls = (): Capture[] =>
  captures.filter((c) =>
    c.url.includes(TWILIO_HOST) || c.url.includes(TERMII_HOST)
  );
const twilioCalls = (): Capture[] =>
  captures.filter((c) => c.url.includes(TWILIO_HOST));
const termiiCalls = (): Capture[] =>
  captures.filter((c) => c.url.includes(TERMII_HOST));
/** Every write (POST/PATCH) this drive performed against a PostgREST table. */
const writesTo = (table: string): Capture[] =>
  captures.filter((c) =>
    (c.method === "POST" || c.method === "PATCH") &&
    c.url.includes(`/rest/v1/${table}`)
  );
const indexOfWrite = (table: string, needle: string): number =>
  captures.findIndex((c) =>
    (c.method === "POST" || c.method === "PATCH") &&
    c.url.includes(`/rest/v1/${table}`) && c.body.includes(needle)
  );

async function withHarness(
  setup: { ng: boolean; us: boolean; fixtures: Fixtures },
  run: () => Promise<void>,
): Promise<void> {
  const snap = snapshotEnv();
  setBaseEnv({ ng: setup.ng, us: setup.us });
  fixtures = setup.fixtures;
  installFetch();
  try {
    await run();
  } finally {
    restoreFetch();
    restoreEnv(snap);
    fixtures = { tables: {} };
  }
}

// ---------------------------------------------------------------------------
// Handler imports — DYNAMIC, so the Deno.listen stub above is already in place.
// ---------------------------------------------------------------------------
Deno.env.set("SUPABASE_URL", SUPABASE_URL);
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key-not-real");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);

const venueSms = await import("../send-venue-sms/index.ts");
const phoneInvite = await import("../send-phone-invite/index.ts");
const pairRequest = await import("../send-pair-request/index.ts");
const ticketDispatch = await import("../ticket-confirmation-dispatch/index.ts");

// Deno.listen is restored the moment every module has finished evaluating —
// nothing after this point calls serve().
// deno-lint-ignore no-explicit-any
(Deno as any).listen = realListen;


/**
 * supabase-js starts token-refresh intervals inside its client, and those
 * outlive a single handler drive. They are the CLIENT's timers, not leaked
 * resources of ours, so the op/resource sanitizers are disabled here — the same
 * accommodation every suite that constructs a real supabase client has to make.
 */
function test(name: string, fn: () => Promise<void>): void {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

const BRAND_ID = "00000000-0000-4000-8000-0000000000b1";
const WAITLIST_ID = "00000000-0000-4000-8000-0000000000c1";
const WAITLIST_ENTRY_ID = "00000000-0000-4000-8000-0000000000e1";
const EVENT_ID = "00000000-0000-4000-8000-0000000000ev";
const ORDER_ID = "00000000-0000-4000-8000-0000000000d1";
const NOTIFICATION_ID = "00000000-0000-4000-8000-0000000000f1";

// ===========================================================================
// GROUP A — send-venue-sms
// ===========================================================================
function venueFixtures(phone: string): Fixtures {
  return {
    tables: {
      venue_waitlist: [{
        id: WAITLIST_ID,
        brand_id: BRAND_ID,
        guest_name: "Ada",
        guest_phone_e164: phone,
        status: "waiting",
      }],
      brands: [{ name: "Smoke & Rhythm" }],
      venue_sms_opt_out: [],
    },
    rpc: {
      biz_brand_effective_rank_for_caller: 60,
      biz_waitlist_mark_notified: null,
    },
  };
}

const venueRequest = (): Request =>
  new Request("https://edge.test/send-venue-sms", {
    method: "POST",
    headers: {
      Authorization: "Bearer operator-jwt",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ waitlistId: WAITLIST_ID }),
  });

test("#1541 A-1 send-venue-sms: an NG destination in a dark market makes ZERO provider calls, 503s, and is NOT marked notified", async () => {
  await withHarness({ ng: false, us: true, fixtures: venueFixtures(NG_NUMBER) }, async () => {
    const res = await venueSms.handler(venueRequest());

    // The function really ran — without this the zero-HTTP claim is vacuous.
    assert(
      captures.length > 0,
      "vacuity guard: the handler made no HTTP calls at all, so it never ran",
    );
    assert(
      writesTo("venue_sms_log").length > 0,
      "vacuity guard: no venue_sms_log write — the handler returned before the send branch",
    );

    assertEquals(
      providerCalls().length,
      0,
      "a dark market must reach NO provider: " +
        providerCalls().map((c) => c.url).join(", "),
    );
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.error, "sms_market_unavailable");

    const log = writesTo("venue_sms_log").map((c) => c.body).join(" ");
    assertStringIncludes(log, "skipped_market_dark");

    // The guest was not notified, so the row must not say they were.
    assertEquals(
      captures.filter((c) => c.url.includes("rpc/biz_waitlist_mark_notified"))
        .length,
      0,
      "a skipped guest must NOT be marked notified",
    );
  });
});

test("#1541 A-2 send-venue-sms: a US destination in a live market sends EXACTLY ONE Twilio message, with the byte-identical locked copy and no raw From", async () => {
  await withHarness({ ng: false, us: true, fixtures: venueFixtures(US_NUMBER) }, async () => {
    const res = await venueSms.handler(venueRequest());
    assertEquals(res.status, 200);

    const calls = twilioCalls();
    assertEquals(calls.length, 1, "exactly one Twilio call");
    assertEquals(termiiCalls().length, 0, "a US handset must never reach Termii");
    assertStringIncludes(calls[0].url, "/Messages.json");

    const params = new URLSearchParams(calls[0].body);
    assertEquals(params.get("To"), US_NUMBER);
    assert(
      (params.get("MessagingServiceSid") ?? "").length > 0,
      "must send via the approved Messaging Service",
    );
    assertEquals(params.get("From"), null, "must NEVER send from a raw From");

    // SC-3 — byte-identical locked copy, exactly one STOP footer, no trailing
    // space. This is the assertion that proves routing through the adapter did
    // not silently re-render the one piece of copy that is contractually frozen.
    const sent = params.get("Body") ?? "";
    assertEquals(sent, "Your table's ready at Smoke & Rhythm. Reply STOP to opt out.");
    assertEquals(
      (sent.match(/Reply STOP to opt out\./g) ?? []).length,
      1,
      "exactly one STOP footer — the adapter must not double-append",
    );

    assert(
      captures.filter((c) => c.url.includes("rpc/biz_waitlist_mark_notified"))
        .length > 0,
      "a successful send must mark the guest notified",
    );
  });
});

// ===========================================================================
// GROUP B — send-phone-invite
// ===========================================================================
function inviteFixtures(): Fixtures {
  return {
    tables: {
      // Filter-aware: a lookup BY PHONE must find nobody (otherwise the invite
      // is refused as "already a Mingla user" and the send is never reached);
      // a lookup BY ID is the inviter's own profile.
      profiles: (url: URL) =>
        url.search.includes("phone=eq.")
          ? []
          : [{
            id: "00000000-0000-4000-8000-000000000001",
            phone: null,
            display_name: "Ada",
            username: "ada",
          }],
      pending_invites: [],
      "pending_invites:insert": [{ id: "00000000-0000-4000-8000-0000000000a1" }],
    },
  };
}

const inviteRequest = (phone: string): Request =>
  new Request("https://edge.test/send-phone-invite", {
    method: "POST",
    headers: {
      Authorization: "Bearer inviter-jwt",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phone_e164: phone }),
  });

test("#1541 B-1 send-phone-invite: an NG destination in a dark market makes ZERO provider calls, still creates the invite, and reports 'skipped' truthfully", async () => {
  await withHarness({ ng: false, us: true, fixtures: inviteFixtures() }, async () => {
    const res = await phoneInvite.handler(inviteRequest(NG_NUMBER));

    assert(captures.length > 0, "vacuity guard: the handler never ran");
    assert(
      writesTo("pending_invites").length > 0,
      "vacuity guard: the invite row was never written, so the send branch was never reached",
    );

    assertEquals(
      providerCalls().length,
      0,
      "a dark market must reach NO provider",
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.success, true, "the invite exists regardless of the SMS");
    // F-4 — this used to say "sent" no matter what happened.
    assertEquals(body.status, "skipped");
  });
});

test("#1541 B-2 send-phone-invite: a US destination sends exactly one Twilio message, from the approved sender, WITH the STOP footer it never used to carry", async () => {
  await withHarness({ ng: false, us: true, fixtures: inviteFixtures() }, async () => {
    const res = await phoneInvite.handler(inviteRequest(US_NUMBER));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "sent");

    const calls = twilioCalls();
    assertEquals(calls.length, 1, "exactly one Twilio call");
    const params = new URLSearchParams(calls[0].body);
    assertEquals(params.get("From"), null, "F-3: no raw From may survive");
    assert(
      (params.get("MessagingServiceSid") ?? "").length > 0,
      "must send via the approved Messaging Service",
    );
    // F-3 — this path texts people who are not yet Mingla users and shipped
    // with NO opt-out affordance at all.
    assertStringIncludes(params.get("Body") ?? "", "Reply STOP to opt out.");
  });
});

// ===========================================================================
// GROUP C — send-pair-request (Tier 3)
// ===========================================================================
function pairFixtures(): Fixtures {
  return {
    tables: {
      // Filter-aware for the same reason as inviteFixtures: a lookup BY PHONE
      // must find nobody, or the handler takes the Tier-2 existing-user branch
      // and the Tier-3 SMS path is never exercised.
      profiles: (url: URL) =>
        url.search.includes("phone=eq.")
          ? []
          : [{
            id: "00000000-0000-4000-8000-000000000001",
            first_name: "Ada",
            last_name: "L",
            display_name: "Ada",
            phone: "+12015550100",
          }],
      pending_pair_invites: [],
      "pending_pair_invites:insert": [{
        id: "00000000-0000-4000-8000-0000000000b9",
      }],
    },
    rpc: { check_pairing_allowed: [{ allowed: true, tier: "plus" }] },
  };
}

const pairRequestReq = (phone: string): Request =>
  new Request("https://edge.test/send-pair-request", {
    method: "POST",
    headers: {
      Authorization: "Bearer sender-jwt",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ phoneE164: phone }),
  });

test("#1541 C-1 send-pair-request: an NG destination in a dark market makes ZERO provider calls and still upserts the invite", async () => {
  await withHarness({ ng: false, us: true, fixtures: pairFixtures() }, async () => {
    const res = await pairRequest.handler(pairRequestReq(NG_NUMBER));

    assert(captures.length > 0, "vacuity guard: the handler never ran");
    assert(
      writesTo("pending_pair_invites").length > 0,
      "vacuity guard: the invite was never upserted, so the send branch was never reached",
    );
    assertEquals(providerCalls().length, 0, "a dark market must reach NO provider");

    const body = await res.json();
    assertEquals(body.tier, 3, "the Tier-3 response contract is unchanged");
    assertEquals(body.pillState, "greyed_waiting_signup");
  });
});

test("#1541 C-2 send-pair-request: a US destination sends exactly one Twilio message, from the approved sender, with the STOP footer", async () => {
  await withHarness({ ng: false, us: true, fixtures: pairFixtures() }, async () => {
    const res = await pairRequest.handler(pairRequestReq(US_NUMBER));
    const body = await res.json();
    assertEquals(body.tier, 3);

    const calls = twilioCalls();
    assertEquals(calls.length, 1, "exactly one Twilio call");
    const params = new URLSearchParams(calls[0].body);
    assertEquals(params.get("From"), null, "F-3: the raw From sender is retired");
    assert((params.get("MessagingServiceSid") ?? "").length > 0);
    assertStringIncludes(params.get("Body") ?? "", "Reply STOP to opt out.");
  });
});

// ===========================================================================
// GROUP D — ticket-confirmation-dispatch, buyer_ticket_confirmation (money path)
// ===========================================================================
function orderFixtures(phone: string): Fixtures {
  return {
    tables: {
      orders: [{
        id: ORDER_ID,
        event_id: EVENT_ID,
        buyer_name: "Ada",
        buyer_email: "ada@example.test",
        total_cents: 5000,
        tax_amount_cents: 0,
        tax_breakdown: [],
        currency: "USD",
        payment_method: "card",
        payment_status: "paid",
        confirmed_at: new Date().toISOString(),
        notification_status: "pending",
        events: {
          id: EVENT_ID,
          title: "Rooftop Session",
          cover_media_url: null,
          cover_media_type: null,
          location_text: "Brooklyn",
          is_online: false,
          timezone: "America/New_York",
          brand_id: BRAND_ID,
          event_type: "event",
          theme: null,
          brands: { id: BRAND_ID, name: "Smoke & Rhythm", contact_email: null },
        },
      }],
      order_line_items: [],
      tickets: [],
      event_dates: [],
      // ONE sms row. The sibling email row is deliberately absent so this case
      // isolates the SMS branch; D-3 covers the email+SMS rollup.
      ticket_order_notifications: [{
        id: NOTIFICATION_ID,
        channel: "sms",
        recipient: phone,
        status: "pending",
        attempt_count: 0,
        payload: null,
      }],
    },
  };
}

const orderRequest = (): Request =>
  new Request("https://edge.test/ticket-confirmation-dispatch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ orderId: ORDER_ID }),
  });

test("#1541 D-1 ticket confirmation, NG dark: ZERO provider HTTP, ledger row 'skipped' with provider 'termii', and sent_at is never stamped", async () => {
  await withHarness({ ng: false, us: true, fixtures: orderFixtures(NG_NUMBER) }, async () => {
    const res = await ticketDispatch.handler(orderRequest());
    assertEquals(res.status, 200);
    const body = await res.json();

    assert(captures.length > 0, "vacuity guard: the handler never ran");
    const ledgerWrites = writesTo("ticket_order_notifications");
    assert(
      ledgerWrites.length > 0,
      "vacuity guard: the ledger was never written, so the dispatch loop never ran",
    );

    assertEquals(
      providerCalls().length,
      0,
      "a paid NG order must reach NO provider while the market is dark",
    );

    const skipWrite = ledgerWrites.find((c) => c.body.includes('"skipped"'));
    assert(skipWrite !== undefined, "the SMS row must be recorded as skipped");
    assertStringIncludes(skipWrite.body, '"provider":"termii"');
    assertStringIncludes(skipWrite.body, "provider_kill_switch_off");
    assert(
      !skipWrite.body.includes("sent_at"),
      "sent_at must be left untouched — nothing was sent",
    );

    assertEquals(body.outcomes[0].status, "skipped");

    // SC-6 — an intentional skip is NOT a failure. The order rolls up as
    // `sent`, never `partial`.
    const orderWrite = writesTo("orders").find((c) =>
      c.body.includes("notification_status")
    );
    assert(orderWrite !== undefined, "the rollup must run");
    assertStringIncludes(orderWrite.body, '"notification_status":"sent"');
    assert(
      !orderWrite.body.includes("partial") &&
        !orderWrite.body.includes('"failed"'),
      "a gated skip must not be rolled up as partial or failed",
    );
  });
});

test("#1541 D-2 ticket confirmation, US live: exactly one Twilio call and a ledger row stamped provider 'twilio'", async () => {
  await withHarness({ ng: false, us: true, fixtures: orderFixtures(US_NUMBER) }, async () => {
    const res = await ticketDispatch.handler(orderRequest());
    assertEquals(res.status, 200);

    const calls = twilioCalls();
    assertEquals(calls.length, 1, "exactly one Twilio call");
    const params = new URLSearchParams(calls[0].body);
    assertEquals(params.get("From"), null);
    assert((params.get("MessagingServiceSid") ?? "").length > 0);

    const sentWrite = writesTo("ticket_order_notifications").find((c) =>
      c.body.includes('"sent"')
    );
    assert(sentWrite !== undefined, "the SMS row must be recorded as sent");
    assertStringIncludes(sentWrite.body, '"provider":"twilio"');
    assertStringIncludes(sentWrite.body, "SM1541runtime");
  });
});

test("#1541 D-3 ticket confirmation, NG live: the NG handset routes to TERMII, not Twilio, and the ledger says so", async () => {
  await withHarness({ ng: true, us: true, fixtures: orderFixtures(NG_NUMBER) }, async () => {
    await ticketDispatch.handler(orderRequest());
    assertEquals(termiiCalls().length, 1, "an NG handset must route to Termii");
    assertEquals(twilioCalls().length, 0, "an NG handset must never reach Twilio");

    const sentWrite = writesTo("ticket_order_notifications").find((c) =>
      c.body.includes('"sent"')
    );
    assert(sentWrite !== undefined);
    // SC-9 — the stamped provider matches the provider actually contacted.
    assertStringIncludes(sentWrite.body, '"provider":"termii"');
  });
});

// ===========================================================================
// GROUP E — the OQ-1 CONTRACT: a gated waitlist skip CONSUMES NOTHING,
//           and it holds UNDER FAILURE, not merely on the happy path.
// ===========================================================================
function waitlistFixtures(phone: string, extra?: Partial<Fixtures>): Fixtures {
  return {
    tables: {
      ticket_order_notifications: [{
        id: NOTIFICATION_ID,
        channel: "sms",
        recipient: phone,
        status: "pending",
        attempt_count: 0,
        payload: {
          template_key: "waitlist_spot_open",
          waitlist_entry_id: WAITLIST_ENTRY_ID,
          event_id: EVENT_ID,
          ticket_type_id: "00000000-0000-4000-8000-0000000000t1",
          qty_requested: 1,
          invite_expires_at: new Date(Date.now() + 86400000).toISOString(),
        },
      }],
      events: [{
        id: EVENT_ID,
        title: "Rooftop Session",
        brands: { id: BRAND_ID, name: "Smoke & Rhythm" },
      }],
      ticket_types: [{ id: "tt1", name: "General" }],
    },
    // The release PATCH returns the row as it now stands — status back to
    // waiting, all three stamps NULL. The handler VERIFIES this before it will
    // record the skip.
    patchReturns: {
      waitlist_entries: [{
        id: WAITLIST_ENTRY_ID,
        status: "waiting",
        invited_at: null,
        notified_at: null,
        notification_id: null,
      }],
    },
    ...extra,
  };
}

const waitlistRequest = (): Request =>
  new Request("https://edge.test/ticket-confirmation-dispatch", {
    method: "POST",
    headers: {
      authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ notificationId: NOTIFICATION_ID }),
  });

test("#1541 E-1 waitlist spot-open, NG dark: the seat goes BACK to the pool, and the release happens BEFORE the skip is recorded", async () => {
  await withHarness({ ng: false, us: true, fixtures: waitlistFixtures(NG_NUMBER) }, async () => {
    const res = await ticketDispatch.handler(waitlistRequest());
    const body = await res.json();

    assert(captures.length > 0, "vacuity guard: the handler never ran");
    assertEquals(providerCalls().length, 0, "a dark market must reach NO provider");

    // The seat is released, with all four fields restored.
    const release = writesTo("waitlist_entries");
    assertEquals(release.length, 1, "the entry must be released exactly once");
    assertStringIncludes(release[0].body, '"status":"waiting"');
    assertStringIncludes(release[0].body, '"invited_at":null');
    assertStringIncludes(release[0].body, '"notified_at":null');
    assertStringIncludes(release[0].body, '"notification_id":null');

    // ATOMICITY, ASSERTED AS AN ORDERING: the release is observed BEFORE the
    // notification is recorded as skipped. This is the property that makes a
    // partial failure safe — see the block above releaseWaitlistEntryToPool.
    const releaseIdx = indexOfWrite("waitlist_entries", '"waiting"');
    const skipIdx = indexOfWrite("ticket_order_notifications", "sms_market_dark");
    assert(releaseIdx > -1, "vacuity guard: no release write was observed");
    assert(skipIdx > -1, "vacuity guard: no skip write was observed");
    assert(
      releaseIdx < skipIdx,
      "the seat must be back in the pool BEFORE the skip is recorded — the reverse order is the silent-loss state",
    );

    assertEquals(body.outcomes[0].status, "skipped");
  });
});

test("#1541 E-2 waitlist spot-open UNDER FAILURE: if the release ERRORS, the notification is NEVER recorded as skipped", async () => {
  await withHarness({
    ng: false,
    us: true,
    fixtures: waitlistFixtures(NG_NUMBER, {
      fail: (method, table) =>
        method === "PATCH" && table === "waitlist_entries"
          ? { status: 500, body: JSON.stringify({ message: "db exploded" }) }
          : null,
    }),
  }, async () => {
    const res = await ticketDispatch.handler(waitlistRequest());
    const body = await res.json();

    assertEquals(providerCalls().length, 0, "still zero provider HTTP");
    assert(
      writesTo("waitlist_entries").length > 0,
      "vacuity guard: the release was never attempted",
    );

    // THE LOAD-BEARING ASSERTION. The failure mode we must make unreachable is
    // "the system believes it is finished while the seat is still consumed and
    // the guest was never told". If the release cannot be completed, the row
    // must NOT say skipped.
    const ledger = writesTo("ticket_order_notifications");
    assert(
      !ledger.some((c) => c.body.includes("sms_market_dark")),
      "a failed release must NOT be followed by a skip record",
    );
    assert(
      !ledger.some((c) => c.body.includes('"status":"skipped"')),
      "the notification must never be marked skipped over a consumed seat",
    );

    // It is retryable, so the sweeper picks it up and tries the release again.
    assertEquals(body.outcomes[0].status, "failed_retryable");
    const failWrite = ledger.find((c) => c.body.includes("failed_retryable"));
    assert(failWrite !== undefined, "the row must be left retryable");
    assertStringIncludes(failWrite.body, "waitlist_release_failed");
  });
});

test("#1541 E-3 waitlist spot-open UNDER FAILURE: a release that matches ZERO rows is not a release", async () => {
  await withHarness({
    ng: false,
    us: true,
    fixtures: waitlistFixtures(NG_NUMBER, { patchReturns: { waitlist_entries: [] } }),
  }, async () => {
    const res = await ticketDispatch.handler(waitlistRequest());
    const body = await res.json();

    assertEquals(providerCalls().length, 0);
    const ledger = writesTo("ticket_order_notifications");
    // #1529 discipline applied to a WRITE: an UPDATE that matched nothing
    // proves nothing. Treating it as success is exactly how a seat gets
    // silently consumed.
    assert(
      !ledger.some((c) => c.body.includes("sms_market_dark")),
      "a zero-row release must NOT be followed by a skip record",
    );
    assertEquals(body.outcomes[0].status, "failed_retryable");
    const failWrite = ledger.find((c) => c.body.includes("failed_retryable"));
    assert(failWrite !== undefined);
    assertStringIncludes(failWrite.body, "waitlist_release_matched_no_rows");
  });
});

test("#1541 E-4 waitlist spot-open UNDER FAILURE: a release the database did not actually apply is rejected", async () => {
  await withHarness({
    ng: false,
    us: true,
    // The PATCH "succeeds" but the row comes back still invited — a trigger, a
    // concurrent write, or a filter that did not do what we asked. Believing
    // the status code over the returned row is how this class of bug hides.
    fixtures: waitlistFixtures(NG_NUMBER, {
      patchReturns: {
        waitlist_entries: [{
          id: WAITLIST_ENTRY_ID,
          status: "invited",
          invited_at: new Date().toISOString(),
          notified_at: new Date().toISOString(),
          notification_id: NOTIFICATION_ID,
        }],
      },
    }),
  }, async () => {
    const res = await ticketDispatch.handler(waitlistRequest());
    const body = await res.json();

    assertEquals(providerCalls().length, 0);
    const ledger = writesTo("ticket_order_notifications");
    assert(
      !ledger.some((c) => c.body.includes("sms_market_dark")),
      "an unverified release must NOT be followed by a skip record",
    );
    assertEquals(body.outcomes[0].status, "failed_retryable");
    assertStringIncludes(
      ledger.find((c) => c.body.includes("failed_retryable"))?.body ?? "",
      "waitlist_release_unverified",
    );
  });
});

test("#1541 E-5 waitlist spot-open, US live: the seat is CONSUMED as normal — the release fires ONLY on a skip", async () => {
  await withHarness({ ng: false, us: true, fixtures: waitlistFixtures(US_NUMBER) }, async () => {
    const res = await ticketDispatch.handler(waitlistRequest());
    const body = await res.json();

    assertEquals(twilioCalls().length, 1, "a live market must send exactly once");
    assertEquals(
      writesTo("waitlist_entries").length,
      0,
      "a delivered invite must NOT return the seat to the pool",
    );
    assertEquals(body.outcomes[0].status, "sent");
  });
});

// ===========================================================================
// GROUP F — SC-9: the LEDGER LABEL and the ROUTE cannot drift apart.
// ===========================================================================
test("#1541 F-1 SC-9: across +234 / +1 / +44 / an unmapped code, the stamped provider always matches the provider actually contacted", async () => {
  const cases: Array<{ to: string; expectProvider: string | null; expectHost: string | null }> = [
    { to: NG_NUMBER, expectProvider: "termii", expectHost: TERMII_HOST },
    { to: US_NUMBER, expectProvider: "twilio", expectHost: TWILIO_HOST },
    { to: GB_NUMBER, expectProvider: "twilio", expectHost: TWILIO_HOST },
    // An unmapped calling code fails CLOSED: no market, no provider, no send.
    { to: UNMAPPED_NUMBER, expectProvider: "twilio", expectHost: null },
  ];

  let observed = 0;
  for (const c of cases) {
    await withHarness({ ng: true, us: true, fixtures: orderFixtures(c.to) }, async () => {
      await ticketDispatch.handler(orderRequest());
      const ledger = writesTo("ticket_order_notifications");
      assert(ledger.length > 0, `vacuity guard: no ledger write for ${c.to}`);

      if (c.expectHost === null) {
        assertEquals(
          providerCalls().length,
          0,
          `${c.to}: an unmapped calling code must contact no provider`,
        );
        const skipWrite = ledger.find((x) => x.body.includes('"skipped"'));
        assert(skipWrite !== undefined, `${c.to}: must be recorded as skipped`);
        assertStringIncludes(skipWrite.body, "country_unresolved");
        observed += 1;
        return;
      }

      const calls = providerCalls();
      assertEquals(calls.length, 1, `${c.to}: exactly one provider call`);
      assertStringIncludes(calls[0].url, c.expectHost);

      const sentWrite = ledger.find((x) => x.body.includes('"sent"'));
      assert(sentWrite !== undefined, `${c.to}: must be recorded as sent`);
      // The stamped label must name the provider that was actually contacted.
      assertStringIncludes(
        sentWrite.body,
        `"provider":"${c.expectProvider}"`,
        `${c.to}: ledger label drifted from the route actually taken`,
      );
      observed += 1;
    });
  }
  assertEquals(observed, cases.length, "vacuity guard: not every fixture ran");
});

// ===========================================================================
// GROUP G — the dark-market guarantee, swept rather than sampled.
// ===========================================================================
test("#1541 G-1: with BOTH markets dark, not one of the four functions reaches any provider — and every one of them still ran", async () => {
  const drives: Array<{ name: string; run: () => Promise<Response>; fx: Fixtures; witness: string }> = [
    {
      name: "send-venue-sms",
      fx: venueFixtures(US_NUMBER),
      run: () => venueSms.handler(venueRequest()),
      witness: "venue_sms_log",
    },
    {
      name: "send-phone-invite",
      fx: inviteFixtures(),
      run: () => phoneInvite.handler(inviteRequest(US_NUMBER)),
      witness: "pending_invites",
    },
    {
      name: "send-pair-request",
      fx: pairFixtures(),
      run: () => pairRequest.handler(pairRequestReq(US_NUMBER)),
      witness: "pending_pair_invites",
    },
    {
      name: "ticket-confirmation-dispatch",
      fx: orderFixtures(US_NUMBER),
      run: () => ticketDispatch.handler(orderRequest()),
      witness: "ticket_order_notifications",
    },
  ];

  let swept = 0;
  for (const d of drives) {
    await withHarness({ ng: false, us: false, fixtures: d.fx }, async () => {
      await d.run();
      assert(
        writesTo(d.witness).length > 0,
        `vacuity guard: ${d.name} never reached its send branch, so its zero-HTTP result proves nothing`,
      );
      assertEquals(
        providerCalls().length,
        0,
        `${d.name} reached a provider while every market is dark: ${
          providerCalls().map((c) => c.url).join(", ")
        }`,
      );
      swept += 1;
    });
  }
  assertEquals(swept, 4, "vacuity guard: the sweep did not cover all four functions");
});
