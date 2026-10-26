// Issue #4114 Wave 2b — Add a friend goes through send-pair-request, and every
// invite text carries a working link.
//
// Drives the REAL exported handlers (send-pair-request, send-phone-invite) with
// a REAL Request, fetch stubbed and recording — the #1541 runtime harness,
// copied here unchanged except that Twilio can be told to fail.
//
//   A-1  a Mingla user who is not a friend: one friend request + one HIDDEN
//        pair request gated by it (add = pair).
//   A-2  D16 — at the free pairing limit the friend request STILL goes, with
//        no pair request, and the response flags pairingLimitReached.
//   A-3  at the limit, a pure pair to an existing friend is still refused.
//   A-4  not on Mingla: the invite is upserted, ONE text goes out whose link is
//        the go.usemingla.com OneLink with friend_invite + the invite token +
//        the inviter's referral code — never the dead domain — and the response
//        says smsStatus "sent" and returns the link.
//   A-5  the provider fails → smsStatus "failed" (the app then offers Share).
//   A-6  a dark market → smsStatus "failed", invite still created.
//   B-1  send-phone-invite's text links to go.usemingla.com too.
//   C-1  the link builder never emits a half-formed friend_invite payload.
//
// FAILS-ON-REVERT: restore the up-front `pairing_limit_reached` return and A-2
// fails (403, no friend request); restore the old `https://mingla.app` body and
// A-4 / B-1 fail; drop `smsStatus` from the Tier-3 response and A-4/A-5 fail.
//
// Run:
//   deno test --allow-env --allow-net --allow-read --no-check \
//     supabase/functions/__tests__/issue_4114_send_pair_request_add_friend.implementor.test.ts

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { __pinNgClockInsideWindow } from "../_shared/ngSmsEmbargo.ts";
import {
  buildFriendInviteOneLink,
  buildFriendInviteSms,
  FRIEND_INVITE_SMS_TEMPLATE,
} from "../_shared/friendInviteLink.ts";
__pinNgClockInsideWindow();

let twilioFails = false;

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
        twilioFails
          ? new Response(JSON.stringify({ code: 21211, message: "invalid number" }), { status: 400 })
          : new Response(JSON.stringify({ sid: "SM4114runtime" }), { status: 200 }),
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
Deno.env.set("SUPABASE_URL", SUPABASE_URL);
Deno.env.set("SUPABASE_ANON_KEY", "test-anon-key-not-real");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);

const pairRequest = await import("../send-pair-request/index.ts");
const phoneInvite = await import("../send-phone-invite/index.ts");
// deno-lint-ignore no-explicit-any
(Deno as any).listen = realListen;

function test(name: string, fn: () => Promise<void> | void): void {
  Deno.test({ name, fn, sanitizeOps: false, sanitizeResources: false });
}

const SENDER_ID = "00000000-0000-4000-8000-000000000001";
const TARGET_ID = "00000000-0000-4000-8000-0000000000aa";
const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function senderProfile() {
  return {
    id: SENDER_ID,
    first_name: "Ada",
    last_name: "L",
    display_name: "Ada",
    username: "ada",
    phone: "+12015550100",
    referral_code: "ADA-42",
  };
}

function fx(opts: { allowed: boolean; friends?: boolean; targetOnMingla?: boolean }): Fixtures {
  return {
    tables: {
      profiles: (url: URL) =>
        url.search.includes("phone=eq.")
          ? (opts.targetOnMingla ? [{ id: TARGET_ID, first_name: "Bisi", last_name: null, display_name: "Bisi" }] : [])
          : [senderProfile()],
      friends: opts.friends ? [{ id: "00000000-0000-4000-8000-0000000000f1" }] : [],
      pair_requests: [],
      pairings: [],
      friend_requests: [],
      pending_pair_invites: [],
      "pending_pair_invites:insert": [{ id: "00000000-0000-4000-8000-0000000000b9", token: TOKEN }],
      pending_invites: [],
      "pending_invites:insert": [{ id: "00000000-0000-4000-8000-0000000000a1" }],
    },
    rpc: {
      check_pairing_allowed: [
        opts.allowed
          ? { allowed: true, tier: "free", current_count: 0, max_allowed: 1 }
          : { allowed: false, tier: "free", current_count: 1, max_allowed: 1 },
      ],
    },
  };
}

const req = (url: string, body: Record<string, unknown>): Request =>
  new Request(url, {
    method: "POST",
    headers: { Authorization: "Bearer sender-jwt", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const pairReq = (body: Record<string, unknown>) => req("https://edge.test/send-pair-request", body);

test("#4114 A-1 add a Mingla user who is not a friend: a friend request AND a hidden pair request", async () => {
  await withHarness({ ng: true, us: true, fixtures: fx({ allowed: true }) }, async () => {
    const res = await pairRequest.handler(pairReq({ friendUserId: TARGET_ID }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.tier, 2);
    assertEquals(body.pillState, "greyed_waiting_friend");
    assertEquals(writesTo("friend_requests").length, 1, "exactly one friend request");
    const pairWrites = writesTo("pair_requests");
    assertEquals(pairWrites.length, 1, "exactly one pair request");
    assertStringIncludes(pairWrites[0].body, "hidden_until_friend");
    assertStringIncludes(pairWrites[0].body, "gated_by_friend_request_id");
  });
});

test("#4114 A-2 D16: at the free pairing limit the friend request still goes, without the pair", async () => {
  await withHarness({ ng: true, us: true, fixtures: fx({ allowed: false }) }, async () => {
    const res = await pairRequest.handler(pairReq({ friendUserId: TARGET_ID }));
    assertEquals(res.status, 200, "adding a friend must not be refused at the pairing limit");
    const body = await res.json();
    assertEquals(body.success, true);
    assertEquals(body.friendOnly, true);
    assertEquals(body.pairingLimitReached, true);
    assertEquals(writesTo("friend_requests").length, 1, "the friend request is still sent");
    assertEquals(writesTo("pair_requests").length, 0, "no pair request past the limit");
  });
});

test("#4114 A-2b D16 by phone: a Mingla user found by number, at the limit, still gets the friend request", async () => {
  await withHarness({ ng: true, us: true, fixtures: fx({ allowed: false, targetOnMingla: true }) }, async () => {
    const res = await pairRequest.handler(pairReq({ phoneE164: "+12015550199" }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.pairingLimitReached, true);
    assertEquals(writesTo("friend_requests").length, 1);
    assertEquals(writesTo("pair_requests").length, 0);
  });
});

test("#4114 A-3 at the limit, pairing with an existing friend is still refused", async () => {
  await withHarness({ ng: true, us: true, fixtures: fx({ allowed: false, friends: true }) }, async () => {
    const res = await pairRequest.handler(pairReq({ friendUserId: TARGET_ID }));
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error, "pairing_limit_reached");
    assertEquals(writesTo("pair_requests").length, 0);
  });
});

test("#4114 A-4 not on Mingla: one text whose link is the go.usemingla.com friend_invite OneLink; outcome returned", async () => {
  await withHarness({ ng: true, us: true, fixtures: fx({ allowed: true }) }, async () => {
    const res = await pairRequest.handler(pairReq({ phoneE164: "+12015550199" }));
    const body = await res.json();
    assertEquals(body.tier, 3);
    assertEquals(body.pillState, "greyed_waiting_signup");
    assertEquals(body.smsStatus, "sent");
    assert(writesTo("pending_pair_invites").length > 0, "the invite is upserted");

    const calls = twilioCalls();
    assertEquals(calls.length, 1, "exactly one text");
    const text = new URLSearchParams(calls[0].body).get("Body") ?? "";
    assertStringIncludes(text, "Ada added you as a friend on Mingla. Join to see each other's plans: ");
    assertStringIncludes(text, "https://go.usemingla.com/w36m?");
    assertStringIncludes(text, "deep_link_value=friend_invite");
    assertStringIncludes(text, `deep_link_sub1=${TOKEN}`);
    assertStringIncludes(text, "af_sub1=ADA-42");
    assert(!/mingla\.app/.test(text), `the dead domain must never be linked: ${text}`);

    const link = new URL(body.inviteLink);
    assertEquals(link.host, "go.usemingla.com");
    assertEquals(link.pathname, "/w36m");
    assertEquals(link.searchParams.get("deep_link_sub1"), TOKEN);
  });
});

test("#4114 A-5 the provider fails: smsStatus is failed, the invite and the link still come back", async () => {
  twilioFails = true;
  try {
    await withHarness({ ng: true, us: true, fixtures: fx({ allowed: true }) }, async () => {
      const res = await pairRequest.handler(pairReq({ phoneE164: "+12015550199" }));
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(twilioCalls().length, 1, "vacuity guard: the send was attempted");
      assertEquals(body.smsStatus, "failed");
      assertEquals(body.inviteId, "00000000-0000-4000-8000-0000000000b9");
      assertStringIncludes(body.inviteLink, "deep_link_value=friend_invite");
    });
  } finally {
    twilioFails = false;
  }
});

test("#4114 A-6 a dark market: no provider call, smsStatus failed, invite created", async () => {
  await withHarness({ ng: false, us: true, fixtures: fx({ allowed: true }) }, async () => {
    const res = await pairRequest.handler(pairReq({ phoneE164: "+2348012345678" }));
    const body = await res.json();
    assert(writesTo("pending_pair_invites").length > 0, "vacuity guard: the invite branch ran");
    assertEquals(providerCalls().length, 0);
    assertEquals(body.smsStatus, "failed");
  });
});

test("#4114 B-1 send-phone-invite: the group invite text links to go.usemingla.com, never the dead domain", async () => {
  await withHarness({ ng: true, us: true, fixtures: fx({ allowed: true }) }, async () => {
    const res = await phoneInvite.handler(req("https://edge.test/send-phone-invite", { phone_e164: "+12015550199" }));
    assertEquals(res.status, 200);
    const calls = twilioCalls();
    assertEquals(calls.length, 1, "vacuity guard: exactly one text");
    const text = new URLSearchParams(calls[0].body).get("Body") ?? "";
    assertStringIncludes(text, "https://go.usemingla.com/w36m?");
    assertStringIncludes(text, "af_sub1=ADA-42");
    assert(!/mingla\.app/.test(text), `the dead domain must never be linked: ${text}`);
  });
});

test("#4114 C-1 the link builder: one template, no half-formed friend_invite payload", () => {
  const noToken = new URL(buildFriendInviteOneLink({ token: "not-a-token", referralCode: "bad code!" }));
  assertEquals(noToken.host, "go.usemingla.com");
  assertEquals(noToken.searchParams.get("deep_link_value"), null);
  assertEquals(noToken.searchParams.get("af_sub1"), null);
  const good = new URL(buildFriendInviteOneLink({ token: TOKEN, referralCode: "ADA-42" }));
  assertEquals(good.searchParams.get("deep_link_value"), "friend_invite");
  assertEquals(good.searchParams.get("deep_link_sub1"), TOKEN);
  assertEquals(good.searchParams.get("af_sub1"), "ADA-42");
  assertStringIncludes(FRIEND_INVITE_SMS_TEMPLATE, "{name}");
  assertStringIncludes(FRIEND_INVITE_SMS_TEMPLATE, "{link}");
  assertEquals(buildFriendInviteSms("  ", "L"), "A friend added you as a friend on Mingla. Join to see each other's plans: L");
});
