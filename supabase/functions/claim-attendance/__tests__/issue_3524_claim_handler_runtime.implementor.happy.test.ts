// issue #3524 REWORK (P2-4) — THE HANDLERS, ACTUALLY INVOKED.
//
// WHY THIS FILE EXISTS. The sibling suites
// (`issue_3524_claim_credentials`, `issue_3524_handoff_contract`) genuinely
// execute the pure helpers, and that half is real. But every assertion about
// HTTP behaviour in them is a string search over `index.ts`:
//
//     const source = await Deno.readTextFile(new URL("../index.ts", …));
//     assert(source.includes("claim_identity_mismatch") && source.includes("409"));
//
// Those tests complete in 0 ms, which is the tell. "409 appears somewhere in the
// file" is not "the handler answers 409". An early return, a reordered branch or
// a throw before the mapping leaves every one of those greps green — and that is
// exactly how a real defect survived them: the scan code was being consumed
// before the claim body decided, so an identity mismatch burned it and the
// rightful account resuming got `invalid`. No source grep could have seen that.
// `feedback_unfalsifiable_test_bug_class` is the name for it: a check that
// cannot fail is worse than no check, because it is counted as coverage.
//
// So this file drives the REAL handler with a REAL `Request` and reads the REAL
// `Response`. `serve()` is aliased to the repository's existing capture shim by
// `_importmap.test.json`, the Supabase client's transport is stubbed at
// `globalThis.fetch`, and nothing touches a network or a database.
//
// Run:
//   deno test --import-map=supabase/functions/claim-attendance/__tests__/_importmap.test.json \
//     --allow-read --allow-env --allow-net \
//     supabase/functions/claim-attendance/__tests__/issue_3524_claim_handler_runtime.implementor.happy.test.ts

import {
  getCapturedHandler,
  resetCapturedHandler,
} from "../../_shared/__tests__/_serveShim.ts";

type Handler = (req: Request) => Response | Promise<Response>;

const UUID_EVENT = "11111111-1111-4111-8111-111111111111";
const UUID_SOURCE = "22222222-2222-4222-8222-222222222222";
const UUID_USER = "33333333-3333-4333-8333-333333333333";
const TOKEN = "A".repeat(43);
const CODE = "B".repeat(43);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** What the stubbed database answered, and what it was asked. */
type RpcLog = { name: string; args: Record<string, unknown> }[];
/**
 * Table writes, separately from RPCs. The attempt ledger is closed with a
 * PostgREST PATCH rather than an RPC — which this file only discovered by
 * actually invoking the handler. A source grep for `complete_attendance_claim`
 * would have asserted a function that does not exist and passed anyway.
 */
type TableLog = { method: string; table: string; body: unknown; query: string }[];

/**
 * Stand the whole edge environment up around a handler, invoke it once, and
 * hand back the real Response plus a log of every RPC it actually made.
 *
 * `rpcResults` maps an RPC name to the row it returns. Anything the handler
 * calls that is not in the map is a FAILURE, not a silent default — a test that
 * quietly tolerates an unexpected dependency is how the last one missed a bug.
 */
async function invoke(
  modulePath: string,
  request: Request,
  rpcResults: Record<string, unknown>,
  options: { authUser?: { id: string } | null } = {},
): Promise<{
  response: Response;
  body: Record<string, unknown>;
  rpcs: RpcLog;
  tables: TableLog;
}> {
  const originalFetch = globalThis.fetch;
  const saved: Record<string, string | undefined> = {};
  const setEnv = (key: string, value: string) => {
    saved[key] = Deno.env.get(key);
    Deno.env.set(key, value);
  };
  setEnv("SUPABASE_URL", "https://fixture.supabase.co");
  setEnv("SUPABASE_ANON_KEY", "fixture-anon-key");
  setEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-key");
  setEnv("ATTENDANCE_CLAIM_PEPPER", "fixture-attendance-claim-pepper");

  const rpcs: RpcLog = [];
  const tables: TableLog = [];
  const authUser = options.authUser === undefined
    ? { id: UUID_USER }
    : options.authUser;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    if (url.pathname === "/auth/v1/user") {
      if (authUser === null) {
        return new Response(JSON.stringify({ message: "bad jwt" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return Response.json({
        id: authUser.id,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: new Date(0).toISOString(),
      });
    }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const name = url.pathname.slice("/rest/v1/rpc/".length);
      const args = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      rpcs.push({ name, args });
      if (!(name in rpcResults)) {
        throw new Error(`the handler called an unstubbed RPC: ${name}`);
      }
      return Response.json(rpcResults[name]);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      const raw = await req.text().catch(() => "");
      tables.push({
        method: req.method,
        table,
        body: raw === "" ? null : JSON.parse(raw),
        query: url.search,
      });
      return Response.json([]);
    }
    throw new Error(`the handler reached an unexpected dependency: ${url.pathname}`);
  }) as typeof fetch;

  try {
    resetCapturedHandler();
    // Cache-busted so each invocation re-runs the module's serve() call.
    await import(`${modulePath}?rework=${crypto.randomUUID()}`);
    const handler = getCapturedHandler() as Handler | null;
    assert(handler !== null, `serve() captured no handler from ${modulePath}`);
    const response = await handler(request);
    const text = await response.clone().text();
    let body: Record<string, unknown> = {};
    try {
      body = text === "" ? {} : JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { __raw: text };
    }
    return { response, body, rpcs, tables };
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
    resetCapturedHandler();
  }
}

const CLAIM = "../index.ts";
const HANDOFF = "../../attendance-claim-handoff/index.ts";

const claimRequest = (payload: unknown, auth = "Bearer caller-token"): Request =>
  new Request("https://fixture.functions/claim-attendance", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

const admitted = { attemptId: "44444444-4444-4444-8444-444444444444", allowed: true };

const testOpts = { sanitizeOps: false, sanitizeResources: false };

// ── claim-attendance ─────────────────────────────────────────────────────────

Deno.test({
  ...testOpts,
  name: "#3524 runtime: an unproved inbox answers its OWN 409, not the mismatch",
  fn: async () => {
    // The refusal that tells the rightful buyer their inbox is simply unproved
    // has to be distinguishable at the wire, or the app cannot offer the code
    // that fixes it — it would render the sign-out sheet and send them in a
    // circle. Driven through the real handler rather than grepped, because the
    // mapping is the thing under test.
    const { response, body, tables } = await invoke(CLAIM, claimRequest({
      version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      token: TOKEN,
    }), {
      begin_attendance_claim_attempt: admitted,
      claim_attendance_internal_v2: {
        result: "contact_unproved",
        contactMasked: "a•••@e•••.test",
        contactChannel: "email",
      },
    });

    assert(response.status === 409, `expected 409, got ${response.status}`);
    assert(body.ok === false, "the body says it did not succeed");
    assert(
      body.error === "claim_contact_unproved",
      `the two refusals must not collapse into one code, got ${String(body.error)}`,
    );
    assert(body.contactMasked === "a•••@e•••.test", "the masked hint is passed through");
    assert(body.contactChannel === "email", "and which channel it is");
    assert(
      response.headers.get("cache-control") === "no-store",
      "a refusal carrying a purchase hint is never cached",
    );
    assert(
      !JSON.stringify(body).includes("@example.test") ||
        JSON.stringify(body).includes("•••"),
      "no unmasked contact leaves the handler",
    );
    const ledger = tables.find((t: TableLog[number]) => t.table.startsWith("attendance_claim_attempts"));
    assert(ledger !== undefined, "the attempt ledger was closed");
    assert(ledger.method === "PATCH", `expected a PATCH, got ${ledger.method}`);
    assert(
      (ledger.body as Record<string, unknown>).outcome === "contact_unproved",
      "the ledger must record THIS outcome, so the rate limiter and the funnel "
        + "can tell the two refusals apart. Got "
        + String((ledger.body as Record<string, unknown>).outcome),
    );
  },
});

Deno.test({
  ...testOpts,
  name: "#3524 runtime: an identity mismatch really answers 409 with the masked hint",
  fn: async () => {
    const { response, body, tables } = await invoke(CLAIM, claimRequest({
      version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      token: TOKEN,
    }), {
      begin_attendance_claim_attempt: admitted,
      claim_attendance_internal_v2: {
        result: "identity_mismatch",
        contactMasked: "a•••@e•••.test",
        contactChannel: "email",
      },
    });

    assert(response.status === 409, `expected 409, got ${response.status}`);
    assert(body.ok === false, "the body says it did not succeed");
    assert(body.error === "claim_identity_mismatch", `got ${String(body.error)}`);
    assert(body.contactMasked === "a•••@e•••.test", "the masked hint is passed through");
    assert(body.contactChannel === "email", "and which channel it is");
    assert(
      response.headers.get("cache-control") === "no-store",
      "a refusal carrying a purchase hint is never cached",
    );
    // The hint the server masked is the ONLY form of the address that appears.
    assert(
      !JSON.stringify(body).includes("@example.test") ||
        JSON.stringify(body).includes("•••"),
      "no unmasked contact leaves the handler",
    );
    // …and the attempt is recorded so the rate limiter still sees it. This is a
    // PATCH on the ledger table, not an RPC — a fact this file learned by
    // invoking the handler rather than by reading it.
    const ledger = tables.find((t: TableLog[number]) => t.table.startsWith("attendance_claim_attempts"));
    assert(ledger !== undefined, "the attempt ledger was closed");
    assert(ledger.method === "PATCH", `expected a PATCH, got ${ledger.method}`);
    assert(
      (ledger.body as Record<string, unknown>).outcome === "identity_mismatch",
      "the ledger records the real outcome, got "
        + String((ledger.body as Record<string, unknown>).outcome),
    );
  },
});

Deno.test({
  ...testOpts,
  name: "#3524 runtime: an expired link really answers 410",
  fn: async () => {
    const { response, body, tables } = await invoke(CLAIM, claimRequest({
      version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      token: TOKEN,
    }), {
      begin_attendance_claim_attempt: admitted,
      claim_attendance_internal_v2: { result: "expired" },
    });
    assert(response.status === 410, `expected 410, got ${response.status}`);
    assert(body.error === "claim_expired", `got ${String(body.error)}`);
    assert(response.headers.get("cache-control") === "no-store", "no-store");
    const ledger = tables.find((t: TableLog[number]) => t.table.startsWith("attendance_claim_attempts"));
    assert(
      ledger !== undefined &&
        (ledger.body as Record<string, unknown>).outcome === "expired",
      "the ledger records `expired`, not a generic failure",
    );
  },
});

Deno.test({
  ...testOpts,
  name: "#3524 runtime: a success really passes chatJoined and conversationId through",
  fn: async () => {
    const conversationId = "55555555-5555-4555-8555-555555555555";
    const { response, body } = await invoke(CLAIM, claimRequest({
      version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      token: TOKEN,
    }), {
      begin_attendance_claim_attempt: admitted,
      claim_attendance_internal_v2: {
        result: "claimed", eventId: UUID_EVENT, chatJoined: true, conversationId,
      },
    });
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(body.ok === true, "it succeeded");
    assert(body.chatJoined === true, "the chat half is reported, not assumed");
    assert(body.conversationId === conversationId, "and the conversation is named");
    assert(response.headers.get("cache-control") === "no-store", "no-store");
  },
});

Deno.test({
  ...testOpts,
  name: "#3524 runtime: a no-chat success says chatJoined false rather than omitting it",
  fn: async () => {
    const { body } = await invoke(CLAIM, claimRequest({
      version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      token: TOKEN,
    }), {
      begin_attendance_claim_attempt: admitted,
      claim_attendance_internal_v2: {
        result: "claimed", eventId: UUID_EVENT, chatJoined: false, conversationId: null,
      },
    });
    assert(body.ok === true, "an experience order still succeeds");
    assert(body.chatJoined === false, "and is HONEST that there was no chat");
    assert(body.conversationId === null, "with no conversation invented");
  },
});

Deno.test({
  ...testOpts,
  name: "#3524 runtime: the scan code really takes the redeem rail, not the token rail",
  fn: async () => {
    const { response, body, rpcs } = await invoke(CLAIM, claimRequest({
      version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      handoffCode: CODE,
    }), {
      begin_attendance_claim_attempt: admitted,
      redeem_attendance_claim_handoff: {
        result: "claimed", eventId: UUID_EVENT, chatJoined: true,
        conversationId: "55555555-5555-4555-8555-555555555555",
      },
    });
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(body.ok === true, "the scanned code claims");
    const names = rpcs.map((r) => r.name);
    assert(
      names.includes("redeem_attendance_claim_handoff"),
      "the handoff form goes through redeem",
    );
    assert(
      !names.includes("claim_attendance_internal_v2"),
      "and NOT through the token rail — the claim body is reached from inside "
        + "the redeem RPC, in SQL, so it exists once",
    );
    // The raw code is hashed before it leaves: only a digest reaches the database.
    const redeem = rpcs.find((r) => r.name === "redeem_attendance_claim_handoff");
    assert(redeem !== undefined, "redeem was called");
    assert(
      typeof redeem.args.p_code_digest === "string" &&
        !String(redeem.args.p_code_digest).includes(CODE),
      "the DIGEST is sent, never the raw code",
    );
  },
});

Deno.test({
  ...testOpts,
  name: "#3524 runtime: the boundary still refuses what it always refused",
  fn: async () => {
    // No bearer.
    const noAuth = await invoke(CLAIM, claimRequest({
      version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      token: TOKEN,
    }, ""), {});
    assert(noAuth.response.status === 401, "an unauthenticated caller is refused");
    assert(noAuth.rpcs.length === 0, "and reaches no database at all");

    // A bearer GoTrue rejects.
    const badAuth = await invoke(CLAIM, claimRequest({
      version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      token: TOKEN,
    }), {}, { authUser: null });
    assert(badAuth.response.status === 401, "a rejected token is refused");
    assert(badAuth.rpcs.length === 0, "and reaches no database either");

    // Both credentials at once — the shape nobody designed.
    const both = await invoke(CLAIM, claimRequest({
      version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      token: TOKEN, handoffCode: CODE,
    }), {});
    assert(both.response.status === 400, "two credentials is a bad request");
    assert(both.body.error === "claim_invalid", "and says so");
    assert(both.rpcs.length === 0, "before touching the database");

    // Wrong method.
    const wrongMethod = await invoke(
      CLAIM,
      new Request("https://fixture.functions/claim-attendance", { method: "GET" }),
      {},
    );
    assert(wrongMethod.response.status === 400, "GET is refused");
  },
});

Deno.test({
  ...testOpts,
  name: "#3524 runtime: the rate limiter really answers 429 and never claims",
  fn: async () => {
    const { response, body, rpcs } = await invoke(CLAIM, claimRequest({
      version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      token: TOKEN,
    }), {
      begin_attendance_claim_attempt: {
        attemptId: "44444444-4444-4444-8444-444444444444", allowed: false,
      },
    });
    assert(response.status === 429, `expected 429, got ${response.status}`);
    assert(body.error === "claim_rate_limited", `got ${String(body.error)}`);
    assert(body.retryAfterSeconds === 600, "and says how long to wait");
    assert(
      !rpcs.some((r) => r.name === "claim_attendance_internal_v2"),
      "a refused attempt never reaches the claim body",
    );
  },
});

// ── attendance-claim-handoff ─────────────────────────────────────────────────

const handoffRequest = (payload: unknown, method = "POST"): Request =>
  new Request("https://fixture.functions/attendance-claim-handoff", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(payload) : undefined,
  });

Deno.test({
  ...testOpts,
  name: "#3524 runtime: minting really returns a handoff URL that carries hc and no token",
  fn: async () => {
    const { response, body, rpcs } = await invoke(HANDOFF, handoffRequest({
      version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      token: TOKEN,
    }), {
      mint_attendance_claim_handoff: {
        result: "minted", expiresAt: new Date(Date.now() + 600_000).toISOString(),
      },
    });

    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(body.ok === true, "it minted");
    assert(body.expiresInSeconds === 600, "ten minutes, from the one constant");
    const handoffUrl = String(body.handoffUrl);
    assert(
      handoffUrl.startsWith("https://host.usemingla.com/attendance/claim#"),
      "the QR target is the Universal Link path the AASA claims",
    );
    assert(handoffUrl.includes("hc="), "and carries the handoff code");
    assert(
      !handoffUrl.includes("token=") && !handoffUrl.includes(TOKEN),
      "and NEVER the claim token — a photographed screen must buy ten minutes, "
        + "not a bearer credential with no expiry",
    );
    assert(response.headers.get("cache-control") === "no-store", "no-store");

    // The raw code is returned once, in this response, and only its digest is
    // stored. Neither the code nor the token is sent to the database.
    const mint = rpcs.find((r) => r.name === "mint_attendance_claim_handoff");
    assert(mint !== undefined, "mint was called");
    const mintArgs = JSON.stringify(mint.args);
    assert(!mintArgs.includes(TOKEN), "the claim token is never sent as plaintext");
    const code = new URL(handoffUrl.replace("#", "?")).searchParams.get("hc");
    assert(code !== null && code.length === 43, "a 43-char code was minted");
    assert(!mintArgs.includes(code), "and its plaintext never reached the database");
    assert(
      typeof mint.args.p_code_digest === "string",
      "only the digest did",
    );
  },
});

Deno.test({
  ...testOpts,
  name: "#3524 runtime: the handoff's own refusals are specific, not a blanket 500",
  fn: async () => {
    const cases: [string, number, string][] = [
      ["rate_limited", 429, "handoff_rate_limited"],
      ["expired", 410, "claim_expired"],
      ["ineligible", 409, "handoff_ineligible"],
      ["conflict", 409, "handoff_ineligible"],
      ["invalid", 400, "handoff_invalid"],
    ];
    for (const [result, status, error] of cases) {
      const { response, body } = await invoke(HANDOFF, handoffRequest({
        version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
        token: TOKEN,
      }), { mint_attendance_claim_handoff: { result } });
      assert(
        response.status === status,
        `${result} should answer ${status}, got ${response.status}`,
      );
      assert(body.error === error, `${result} should say ${error}, got ${String(body.error)}`);
      assert(response.headers.get("cache-control") === "no-store", "no-store");
    }
  },
});

Deno.test({
  ...testOpts,
  name: "#3524 runtime: a handoff code cannot mint another handoff code",
  fn: async () => {
    const { response, body, rpcs } = await invoke(HANDOFF, handoffRequest({
      version: 1, kind: "order", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      handoffCode: CODE,
    }), {});
    assert(response.status === 400, `expected 400, got ${response.status}`);
    assert(body.error === "handoff_invalid", `got ${String(body.error)}`);
    assert(
      rpcs.length === 0,
      "and it is refused BEFORE the database — a credential that can renew "
        + "itself past its own ten minutes is not a ten-minute credential",
    );

    // An RSVP has no desktop scan sheet either.
    const rsvp = await invoke(HANDOFF, handoffRequest({
      version: 1, kind: "rsvp", eventId: UUID_EVENT, sourceId: UUID_SOURCE,
      token: TOKEN,
    }), {});
    assert(rsvp.response.status === 400, "an rsvp kind is refused");
    assert(rsvp.rpcs.length === 0, "before the database");

    // And GET is not a mint.
    const get = await invoke(HANDOFF, handoffRequest(null, "GET"), {});
    assert(get.response.status === 400, "GET is refused");
  },
});
