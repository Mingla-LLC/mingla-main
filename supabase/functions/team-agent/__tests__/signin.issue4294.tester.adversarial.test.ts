// Issue #4294 — tester adversarial suite: company sign-in (Connect, the
// tool's callback, token renewal) and name hiding, attacked from angles the
// implementor's happy path does not take. Everything runs against the real
// exported handlers with an injected network and a stand-in database.
//
//   T-1 discovery refuses a sign-in server on another site, plain http,
//       private and numeric hosts, a user-info address, a redirecting or
//       oversized document, no S256 and no client metadata support
//   T-2 the start address answers only Mingla Admin's exact origin, only
//       POST, only an owner; a refused owner check starts nothing
//   T-3 the authorize address carries S256, a fresh 43-character state and
//       the exact callback; the database keeps only the state's digest and
//       a verifier box only that state opens
//   T-4 the callback: repeated or missing state, replay, cancel after the
//       claim, another issuer, a token address that redirects, a huge or
//       slow token answer, no refresh token, a non-Bearer token; the page
//       never holds a token, a code or the tool's error text
//   T-5 renewal: two renewers racing make one token request; a network
//       failure keeps a still-good token and never marks Reconnect; a lost
//       store is retried once; nothing token-shaped reaches a log line
//   T-6 tool listings hold no hidden word in any form (domains, handles,
//       glued words, a colon after the word, zero-width splits) while
//       result links, file names and ids stay byte-identical
//
// Declared in the implementor suites: I-4294-9 .. I-4294-14. This file
// attacks I-4294-10, I-4294-11, I-4294-13 and I-4294-14.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createHider } from "../../_shared/minglaConnectorProxy.ts";
import {
  createSigninTokenSource,
  discoverSigninServer,
  handleSigninCallback,
  handleSigninStart,
  openVerifier,
  sha256Hex,
  SIGNIN_CLIENT_ID,
  tokenRequest,
} from "../../_shared/minglaConnectorSignin.ts";
import { pkceChallenge } from "../../_shared/minglaConnectorOAuth.ts";

const RESOURCE = "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent";
const CALLBACK = RESOURCE + "/oauth/upstream-callback";
const ADMIN = "https://admin.usemingla.com";
const TOOL = "https://mcp.magnific.com";
const ISSUER = "https://auth.magnific.com/realms/mcp";
const AUTHZ = ISSUER + "/protocol/openid-connect/auth";
const TOKEN = ISSUER + "/protocol/openid-connect/token";
const JWT = "eyJhbGciOiJIUzI1NiJ9." + "q".repeat(40) + "." + "w".repeat(43);
const ACCESS = "AT-tester-" + "a".repeat(30) + "-accessvalue";
const ACCESS_NEW = "AT-tester-" + "n".repeat(30) + "-accessnewval";
const REFRESH = "RT-tester-" + "r".repeat(30) + "-refreshvalue";
const REFRESH_NEW = "RT-tester-" + "s".repeat(30) + "-refreshnewval";

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });

function asMeta(over: Record<string, unknown> = {}) {
  return {
    issuer: ISSUER,
    authorization_endpoint: AUTHZ,
    token_endpoint: TOKEN,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    ...over,
  };
}

/** A network that serves the tool's discovery documents; anything else is recorded and refused. */
function discoveryNet(asDoc: unknown, prm: unknown = { resource: TOOL, authorization_servers: [ISSUER] }) {
  const seen: { url: string; redirect?: string }[] = [];
  const fetchFn: Fetch = (url, init) => {
    seen.push({ url, redirect: init.redirect as string | undefined });
    if (url === TOOL + "/.well-known/oauth-protected-resource") return Promise.resolve(json(prm));
    if (url === TOOL + "/.well-known/oauth-authorization-server") {
      return Promise.resolve(asDoc instanceof Response ? asDoc : json(asDoc));
    }
    return Promise.resolve(new Response("nope", { status: 404 }));
  };
  return { fetchFn, seen };
}

// ---------------------------------------------------------------------------
// T-1 discovery.
// ---------------------------------------------------------------------------
Deno.test("#4294 T-1: discovery refuses every sign-in server that is not the tool's own public https site", async () => {
  // Built at runtime so no user-info address is ever written literally.
  const userinfo = ["https:", "//", "attacker", "@", "auth.magnific.com/token"].join("");
  const cases: [string, Record<string, unknown>][] = [
    ["issuer on another site", { issuer: "https://auth.evil-example.com" }],
    ["token address on another site", { token_endpoint: "https://evil-example.com/token" }],
    ["authorize address on another site", { authorization_endpoint: "https://evil-example.com/auth" }],
    ["token address over http", { token_endpoint: "http://auth.magnific.com/token" }],
    ["token address at the cloud metadata IP", { token_endpoint: "https://169.254.169.254/latest" }],
    ["token address on localhost", { token_endpoint: "https://localhost/token" }],
    ["token address on a private IP", { token_endpoint: "https://10.0.0.7/token" }],
    ["token address as a hex IP", { token_endpoint: "https://0x7f.1/token" }],
    ["token address with a port", { token_endpoint: "https://auth.magnific.com:8443/token" }],
    ["token address with user info", { token_endpoint: userinfo }],
    ["token address with a query", { token_endpoint: TOKEN + "?x=1" }],
    ["issuer with a query", { issuer: ISSUER + "?a=b" }],
    ["no S256", { code_challenge_methods_supported: ["plain"] }],
    ["no client metadata documents", { client_id_metadata_document_supported: false }],
    ["client metadata as a string", { client_id_metadata_document_supported: "true" }],
    ["no code response type", { response_types_supported: ["token"] }],
    ["no token address", { token_endpoint: undefined }],
  ];
  for (const [label, over] of cases) {
    const net = discoveryNet(asMeta(over));
    assertEquals(await discoverSigninServer(TOOL, net.fetchFn), null, label);
  }
  // A tool address that is itself private or plain http is never fetched.
  for (const bad of ["http://mcp.magnific.com", "https://127.0.0.1", "https://metadata.internal", "https://a.local"]) {
    const net = discoveryNet(asMeta());
    assertEquals(await discoverSigninServer(bad, net.fetchFn), null, bad);
    assertEquals(net.seen.length, 0, `nothing fetched for ${bad}`);
  }
});

Deno.test("#4294 T-1: discovery never follows a redirect and refuses an oversized or non-JSON document", async () => {
  const redirecting = discoveryNet(new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } }));
  assertEquals(await discoverSigninServer(TOOL, redirecting.fetchFn), null);
  assert(redirecting.seen.every((s) => s.redirect === "manual"), "every discovery fetch is redirect: manual");
  assert(!redirecting.seen.some((s) => s.url.includes("169.254")), "the redirect target is never fetched");

  const huge = discoveryNet(json({ ...asMeta(), pad: "x".repeat(70_000) }));
  assertEquals(await discoverSigninServer(TOOL, huge.fetchFn), null, "over 64 KB is refused");
  const notJson = discoveryNet(new Response("<html>", { status: 200 }));
  assertEquals(await discoverSigninServer(TOOL, notJson.fetchFn), null);
  const array = discoveryNet(json([asMeta()]));
  assertEquals(await discoverSigninServer(TOOL, array.fetchFn), null);
});

Deno.test("#4294 T-1: a protected-resource document cannot point discovery or the resource at another site", async () => {
  const seen: string[] = [];
  const fetchFn: Fetch = (url) => {
    seen.push(url);
    if (url === TOOL + "/.well-known/oauth-protected-resource") {
      return Promise.resolve(json({ resource: "https://evil-example.com/mcp", authorization_servers: ["https://evil-example.com"] }));
    }
    return Promise.resolve(new Response("", { status: 404 }));
  };
  assertEquals(await discoverSigninServer(TOOL, fetchFn), null);
  assert(!seen.some((u) => u.includes("evil-example")), "another site's sign-in server is never fetched");

  // A same-site server is used, but a resource on another origin is ignored.
  const ok = discoveryNet(asMeta(), { resource: "https://evil-example.com/mcp", scopes_supported: ["openid", "bad scope!"] });
  const server = await discoverSigninServer(TOOL, ok.fetchFn);
  assertEquals(server?.resource, TOOL);
  assertEquals(server?.scope, "openid", "a malformed scope word is dropped");
});

// ---------------------------------------------------------------------------
// T-2 / T-3 the start address.
// ---------------------------------------------------------------------------
function startWorld(opts: { ownerCheck?: "ok" | "forbidden" | "expired"; kind?: string } = {}) {
  const userSteps: { jwt: string; fn: string; args: Record<string, unknown> }[] = [];
  const net = discoveryNet(asMeta());
  const deps = {
    rpc: () => Promise.reject(new Error("the start never uses the server role")),
    userRpc: (jwt: string, fn: string, args: Record<string, unknown>) => {
      userSteps.push({ jwt, fn, args });
      if (opts.ownerCheck === "forbidden") return Promise.reject(Object.assign(new Error("x"), { code: "42501" }));
      if (opts.ownerCheck === "expired") return Promise.reject(Object.assign(new Error("x"), { code: "PGRST301" }));
      if (fn === "mingla_connector_signin_status") {
        return Promise.resolve({ slug: "studio", auth_kind: opts.kind ?? "signin", mcp_url: TOOL });
      }
      return Promise.resolve({ ok: true });
    },
    fetch: net.fetchFn,
    resourceUrl: RESOURCE,
  };
  return { deps, userSteps, net };
}

function startReq(origin: string | null, init: { method?: string; body?: string; auth?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin !== null) headers.origin = origin;
  if (init.auth !== null) headers.authorization = init.auth ?? `Bearer ${JWT}`;
  return new Request(RESOURCE + "/oauth/upstream-start", {
    method: init.method ?? "POST",
    headers,
    body: (init.method ?? "POST") === "POST" ? init.body ?? JSON.stringify({ slug: "studio" }) : undefined,
  });
}

Deno.test("#4294 T-2: the start answers only the exact Mingla Admin origin, and a refused origin touches nothing", async () => {
  for (
    const origin of [
      null,
      "null",
      "https://admin.usemingla.com.evil-example.com",
      "https://evil-admin.usemingla.com",
      "http://admin.usemingla.com",
      "https://admin.usemingla.com:443",
      "https://ADMIN.usemingla.com",
      "https://admin.usemingla.co",
      "https://admin.usemingla.com/",
    ]
  ) {
    const w = startWorld();
    const { outcome, res } = await handleSigninStart(startReq(origin), w.deps);
    assertEquals([outcome, res.status], ["origin_refused", 403], String(origin));
    assertEquals(res.headers.get("access-control-allow-origin"), null, `no CORS grant for ${origin}`);
    assertEquals(w.userSteps.length, 0, `no database step for ${origin}`);
    assertEquals(w.net.seen.length, 0, `no network for ${origin}`);
    const pre = await handleSigninStart(
      new Request(RESOURCE + "/oauth/upstream-start", { method: "OPTIONS", headers: origin ? { origin } : {} }),
      w.deps,
    );
    assertEquals(pre.res.status, 403, `preflight refused for ${origin}`);
  }
});

Deno.test("#4294 T-2: a cross-site GET, a missing session and a non-owner start nothing", async () => {
  const get = startWorld();
  const g = await handleSigninStart(startReq(ADMIN, { method: "GET" }), get.deps);
  assertEquals(g.res.status, 405);
  assertEquals(get.userSteps.length, 0);

  for (const auth of [null, "Bearer ", "Basic abc", `Bearer ${JWT}x x`, "bearer " + JWT]) {
    const w = startWorld();
    const r = await handleSigninStart(startReq(ADMIN, { auth }), w.deps);
    assertEquals(r.res.status, 401, `auth ${auth}`);
    assertEquals(w.userSteps.length, 0);
  }

  const notOwner = startWorld({ ownerCheck: "forbidden" });
  const n = await handleSigninStart(startReq(ADMIN), notOwner.deps);
  assertEquals([n.outcome, n.res.status], ["forbidden", 403]);
  assertEquals(notOwner.userSteps.map((s) => s.fn), ["mingla_connector_signin_status"], "begin never runs");
  assertEquals(notOwner.net.seen.length, 0, "the tool is never contacted for a non-owner");

  const expired = startWorld({ ownerCheck: "expired" });
  assertEquals((await handleSigninStart(startReq(ADMIN), expired.deps)).res.status, 401);

  const keyRow = startWorld({ kind: "key" });
  const k = await handleSigninStart(startReq(ADMIN), keyRow.deps);
  assertEquals([k.outcome, k.res.status], ["key_only", 400]);
  assertEquals(keyRow.net.seen.length, 0);

  for (const body of ['{"slug":"STUDIO"}', '{"slug":["studio"]}', "not json", '{"slug":"studio","x":"' + "y".repeat(2000) + '"}']) {
    const w = startWorld();
    assertEquals((await handleSigninStart(startReq(ADMIN, { body }), w.deps)).res.status, 400, body.slice(0, 30));
    assertEquals(w.userSteps.length, 0);
  }
});

Deno.test("#4294 T-3: Connect makes a fresh S256 state each time and keeps only its digest and a box only it opens", async () => {
  const urls: URL[] = [];
  const begins: Record<string, unknown>[] = [];
  for (let i = 0; i < 2; i++) {
    const w = startWorld();
    const { outcome, res } = await handleSigninStart(startReq(ADMIN), w.deps);
    assertEquals(outcome, "ok");
    assertEquals(res.headers.get("access-control-allow-origin"), ADMIN);
    assertEquals(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assertEquals(Object.keys(body), ["authorize_url"]);
    const to = new URL(body.authorize_url);
    urls.push(to);
    const begin = w.userSteps.find((s) => s.fn === "mingla_connector_signin_begin");
    assert(begin, "begin ran");
    assertEquals(begin.jwt, JWT, "begin runs as the owner's own session");
    begins.push(begin.args);
  }
  const [a, b] = urls;
  assertEquals(a.origin + a.pathname, AUTHZ);
  assertEquals(a.searchParams.get("code_challenge_method"), "S256");
  assertEquals(a.searchParams.get("redirect_uri"), CALLBACK);
  assertEquals(a.searchParams.get("client_id"), SIGNIN_CLIENT_ID);
  assertEquals(a.searchParams.get("response_type"), "code");
  assertEquals(a.searchParams.getAll("state").length, 1);
  assert(/^[A-Za-z0-9_-]{43}$/.test(a.searchParams.get("state")!), "43-character state");
  assert(a.searchParams.get("state") !== b.searchParams.get("state"), "a new state each press");
  assert(a.searchParams.get("code_challenge") !== b.searchParams.get("code_challenge"), "a new verifier each press");

  const state = a.searchParams.get("state")!;
  assertEquals(begins[0].p_state_hash, await sha256Hex(state), "only the digest is stored");
  assert(!JSON.stringify(begins[0]).includes(state), "the state itself never reaches the database");
  const verifier = await openVerifier(state, String(begins[0].p_verifier_box));
  assert(verifier && /^[A-Za-z0-9_-]{86}$/.test(verifier), "the box opens with its own state");
  assertEquals(await pkceChallenge(verifier!), a.searchParams.get("code_challenge"));
  assertEquals(await openVerifier(b.searchParams.get("state")!, String(begins[0].p_verifier_box)), null,
    "another state cannot open the box");
  assertEquals(await openVerifier(state, String(begins[0].p_verifier_box).slice(0, -2) + "AA"), null,
    "a tampered box opens to nothing");
  assert(!JSON.stringify(begins[0]).includes(verifier!), "the verifier never reaches the database in the clear");
});

// ---------------------------------------------------------------------------
// T-4 the callback.
// ---------------------------------------------------------------------------
interface CallbackWorld {
  claims: string[];
  completes: Record<string, unknown>[];
  tokenCalls: { url: string; redirect?: string; form: URLSearchParams }[];
}

async function callbackWorld(token: (form: URLSearchParams, init: RequestInit) => Promise<Response>, claimOk = true) {
  const state = "S".repeat(20) + "tate-for-the-tester-sui";
  assertEquals(state.length, 43);
  const verifier = "v".repeat(86);
  const { sealVerifier } = await import("../../_shared/minglaConnectorSignin.ts");
  const box = await sealVerifier(state, verifier);
  const w: CallbackWorld = { claims: [], completes: [], tokenCalls: [] };
  let claimed = false;
  const deps = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === "mingla_connector_signin_claim") {
        w.claims.push(String(args.p_state_hash));
        if (!claimOk || claimed) return Promise.resolve({ ok: false });
        claimed = true;
        return Promise.resolve({
          ok: true,
          slug: "studio",
          label: "Mingla Studio",
          verifier_box: box,
          issuer: ISSUER,
          token_url: TOKEN,
          resource: TOOL,
          redirect_uri: CALLBACK,
          client_id: SIGNIN_CLIENT_ID,
        });
      }
      if (fn === "mingla_connector_signin_complete") {
        w.completes.push(args);
        return Promise.resolve({ ok: true, slug: "studio", label: "Mingla Studio", account: args.p_account ?? null });
      }
      return Promise.reject(new Error("unexpected " + fn));
    },
    fetch: (url: string, init: RequestInit) => {
      const form = new URLSearchParams(String(init.body));
      w.tokenCalls.push({ url, redirect: init.redirect as string | undefined, form });
      return token(form, init);
    },
    resourceUrl: RESOURCE,
  };
  const call = (query: string) =>
    handleSigninCallback(new Request(CALLBACK + "?" + query), deps).then(async (r) => ({ ...r, text: await r.res.text() }));
  return { w, state, verifier, call };
}

const goodToken = () =>
  Promise.resolve(json({ access_token: ACCESS, refresh_token: REFRESH, token_type: "Bearer", expires_in: 600 }));

function assertNoSecrets(text: string, extra: string[] = []) {
  for (const s of [ACCESS, REFRESH, ACCESS_NEW, REFRESH_NEW, "v".repeat(86), ...extra]) {
    assert(!text.includes(s), "no whole secret in the page");
    // The distinctive tails of each secret (never plain prose) must not appear either.
    assert(!text.includes(s.slice(-12)), `no tail of a secret in: ${text.slice(0, 200)}`);
  }
}

Deno.test("#4294 T-4: a callback with no, two or malformed states never reaches the database", async () => {
  const { w, state, call } = await callbackWorld(goodToken);
  for (const q of ["code=abc", `state=${state}&state=${state}&code=abc`, "state=short&code=abc", `state=${state}!&code=x`]) {
    const r = await call(q);
    assertEquals([r.outcome, r.res.status], ["invalid_state", 400], q);
  }
  assertEquals(w.claims.length, 0);
  assertEquals(w.tokenCalls.length, 0);
});

Deno.test("#4294 T-4: a state works once; a replay, a cancel after the claim or another issuer exchanges nothing", async () => {
  const replay = await callbackWorld(goodToken);
  const first = await replay.call(`state=${replay.state}&code=code-1&iss=${encodeURIComponent(ISSUER)}`);
  assertEquals(first.outcome, "connected");
  const again = await replay.call(`state=${replay.state}&code=code-1&iss=${encodeURIComponent(ISSUER)}`);
  assertEquals([again.outcome, again.res.status], ["invalid_state", 400]);
  assertEquals(replay.w.tokenCalls.length, 1, "the replay made no second exchange");
  assertEquals(replay.w.completes.length, 1);

  const cancel = await callbackWorld(goodToken);
  const c = await cancel.call(`state=${cancel.state}&error=access_denied&error_description=${encodeURIComponent("<script>x</script>")}`);
  assertEquals(c.outcome, "cancelled");
  assertEquals(cancel.w.claims.length, 1, "a cancel still spends the state");
  assertEquals(cancel.w.tokenCalls.length, 0);
  assert(!c.text.includes("<script>"), "the tool's error text never reaches the page");
  const after = await cancel.call(`state=${cancel.state}&code=late`);
  assertEquals(after.outcome, "invalid_state", "the cancelled state cannot be used afterwards");

  const mix = await callbackWorld(goodToken);
  const m = await mix.call(`state=${mix.state}&code=abc&iss=${encodeURIComponent("https://auth.evil-example.com")}`);
  assertEquals(m.outcome, "issuer_mismatch");
  assertEquals(mix.w.tokenCalls.length, 0);
  const trail = await callbackWorld(goodToken);
  const t = await trail.call(`state=${trail.state}&code=abc&iss=${encodeURIComponent(ISSUER + "/")}`);
  assertEquals(t.outcome, "issuer_mismatch", "an issuer differing by a trailing slash is another issuer");

  const unknown = await callbackWorld(goodToken, false);
  const u = await unknown.call(`state=${unknown.state}&code=abc`);
  assertEquals(u.outcome, "invalid_state", "a callback without a start does nothing");
  assertEquals(unknown.w.tokenCalls.length, 0);
});

Deno.test("#4294 T-4: the exchange posts to the stored token address only, never follows a redirect, and stores nothing on a bad answer", async () => {
  const cases: [string, (form: URLSearchParams) => Promise<Response>, string][] = [
    ["redirect", () => Promise.resolve(new Response(null, { status: 307, headers: { location: "https://evil-example.com/t" } })), "unavailable"],
    ["huge", () => Promise.resolve(json({ access_token: ACCESS, refresh_token: REFRESH, pad: "p".repeat(70_000) })), "unavailable"],
    ["no refresh token", () => Promise.resolve(json({ access_token: ACCESS, token_type: "Bearer", expires_in: 600 })), "no_refresh_token"],
    ["DPoP token", () => Promise.resolve(json({ access_token: ACCESS, refresh_token: REFRESH, token_type: "DPoP" })), "unavailable"],
    ["short token", () => Promise.resolve(json({ access_token: "abc", refresh_token: REFRESH })), "unavailable"],
    ["token with a space", () => Promise.resolve(json({ access_token: "a".repeat(20) + " b", refresh_token: REFRESH })), "unavailable"],
    ["refused code", () => Promise.resolve(json({ error: "invalid_grant", error_description: ACCESS }, 400)), "invalid_grant"],
    ["server error echoing a token", () => Promise.resolve(new Response(`oops ${ACCESS} ${REFRESH}`, { status: 500 })), "unavailable"],
    ["network failure", () => Promise.reject(new TypeError("connect refused")), "unavailable"],
  ];
  for (const [label, answer, outcome] of cases) {
    const cw = await callbackWorld((form) => answer(form));
    const r = await cw.call(`state=${cw.state}&code=the-code`);
    assertEquals(r.outcome, outcome, label);
    assert(r.res.status >= 400, label);
    assertEquals(cw.w.completes.length, 0, `${label}: nothing stored`);
    assertEquals(cw.w.tokenCalls.map((c) => [c.url, c.redirect]), [[TOKEN, "manual"]], `${label}: one manual POST`);
    assertNoSecrets(r.text);
    assertEquals(r.res.headers.get("cache-control"), "no-store");
  }
});

Deno.test("#4294 T-4: a slow token address is cut off at the time limit", async () => {
  let aborted = false;
  const slow: Fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  const started = Date.now();
  const got = await tokenRequest(TOKEN, { grant_type: "authorization_code" }, slow, 40);
  assertEquals(got, { kind: "unavailable" });
  assert(aborted, "the request was aborted");
  assert(Date.now() - started < 2000);

  // A body that trickles forever is also cut off.
  const trickle: Fetch = (_url, init) => {
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"access_token":"'));
        init.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  };
  assertEquals(await tokenRequest(TOKEN, { grant_type: "authorization_code" }, trickle, 40), { kind: "unavailable" });
});

Deno.test("#4294 T-4: the exchange form carries the verifier and exact callback; the success page holds no token and escapes the account", async () => {
  const evilId = "e30." + btoa(JSON.stringify({ email: `<img src=x onerror=alert(1)>${ACCESS}` })).replace(/=+$/, "") + ".s";
  const cw = await callbackWorld(() =>
    Promise.resolve(json({ access_token: ACCESS, refresh_token: REFRESH, token_type: "bearer", expires_in: 600, id_token: evilId }))
  );
  const r = await cw.call(`state=${cw.state}&code=the-code`);
  assertEquals(r.outcome, "connected");
  const form = cw.w.tokenCalls[0].form;
  assertEquals(form.get("grant_type"), "authorization_code");
  assertEquals(form.get("code_verifier"), cw.verifier);
  assertEquals(form.get("redirect_uri"), CALLBACK);
  assertEquals(form.get("client_id"), SIGNIN_CLIENT_ID);
  assertEquals(form.get("client_secret"), null);
  assert(!r.text.includes("<img"), "the account is escaped and stripped");
  assert(!r.text.toLowerCase().includes("<!doctype"), "a plain page");
  assertEquals(r.res.headers.get("x-frame-options"), "DENY");
  assertEquals(r.res.headers.get("referrer-policy"), "no-referrer");
  // The id token is read only for a display name; the name it carries is the tool's to choose,
  // so the page shows it escaped. The access token itself is never placed on the page by Mingla.
  assertEquals(cw.w.completes[0].p_access, ACCESS);
  assertEquals(cw.w.completes[0].p_refresh, REFRESH);
});

// ---------------------------------------------------------------------------
// T-5 renewal.
// ---------------------------------------------------------------------------
/** A stand-in database with the migration's lease rules (PT409 on a clash). */
function renewalDb(opts: { expiresInMs: number; now: () => number }) {
  const db = {
    access: ACCESS,
    refresh: REFRESH,
    generation: 1,
    expiresAt: opts.now() + opts.expiresInMs,
    lease: null as string | null,
    leaseUntil: 0,
    reconnect: false,
    steps: [] as string[],
    failStoreOnce: false,
  };
  const conflict = (m: string) => Promise.reject(Object.assign(new Error(m), { code: "PT409" }));
  const rpc = (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    db.steps.push(fn);
    if (db.reconnect) return Promise.resolve({ ok: false });
    switch (fn) {
      case "mingla_connector_signin_credential":
        return Promise.resolve({
          ok: true,
          access_token: db.access,
          expires_at: new Date(db.expiresAt).toISOString(),
          generation: db.generation,
        });
      case "mingla_connector_signin_refresh_begin":
        if (args.p_generation !== db.generation) return conflict("renewed");
        if (db.lease && db.leaseUntil > opts.now()) return conflict("renewing");
        db.lease = crypto.randomUUID();
        db.leaseUntil = opts.now() + 30_000;
        return Promise.resolve({ ok: true, lease: db.lease, refresh_token: db.refresh, token_url: TOKEN, client_id: SIGNIN_CLIENT_ID });
      case "mingla_connector_signin_refresh_store":
        if (db.failStoreOnce) {
          db.failStoreOnce = false;
          db.lease = null;
          return conflict("lease_lost");
        }
        if (args.p_lease !== db.lease || db.leaseUntil <= opts.now()) return conflict("lease_lost");
        db.access = String(args.p_access);
        db.refresh = String(args.p_refresh);
        db.expiresAt = opts.now() + Number(args.p_expires_in) * 1000;
        db.generation += 1;
        db.lease = null;
        return Promise.resolve({ ok: true, generation: db.generation });
      case "mingla_connector_signin_refresh_fail":
        if (args.p_lease !== db.lease) return conflict("lease_lost");
        db.lease = null;
        if (args.p_reason === "invalid_grant") db.reconnect = true;
        return Promise.resolve({ ok: true });
    }
    return Promise.reject(new Error("unexpected " + fn));
  };
  return { db, rpc };
}

Deno.test("#4294 T-5: two renewers racing for the same row make exactly one token request and both get the new token", async () => {
  const now = () => Date.parse("2026-11-07T12:00:00Z");
  const { db, rpc } = renewalDb({ expiresInMs: 20_000, now });
  let posts = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetchFn: Fetch = async () => {
    posts++;
    await gate;
    return json({ access_token: ACCESS_NEW, refresh_token: REFRESH_NEW, token_type: "Bearer", expires_in: 300 });
  };
  const lines: Record<string, unknown>[] = [];
  const source = createSigninTokenSource({ rpc, fetch: fetchFn, now, log: (l) => lines.push(l) });
  const a = source("call-a");
  const b = source("call-b");
  await new Promise((r) => setTimeout(r, 10));
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assertEquals(posts, 1, "one renewal request for the row");
  assertEquals(ra, { ok: true, token: ACCESS_NEW, generation: 2 });
  // The loser saw PT409 while the token still had 20 s: it keeps the still-good token or the new one, never fails.
  assert(rb.ok, "the second caller is served");
  assert(rb.ok && (rb.token === ACCESS || rb.token === ACCESS_NEW));
  assertEquals(db.generation, 2);
  assertEquals(db.reconnect, false);
  assert(!JSON.stringify(lines).match(/AT-tester|RT-tester/), "no token in a log line");
});

Deno.test("#4294 T-5: a network failure during renewal keeps a still-good token and never marks Reconnect", async () => {
  let t = Date.parse("2026-11-07T12:00:00Z");
  const now = () => t;
  const { db, rpc } = renewalDb({ expiresInMs: 30_000, now });
  const down: Fetch = () => Promise.reject(new TypeError("network down"));
  const lines: Record<string, unknown>[] = [];
  const source = createSigninTokenSource({ rpc, fetch: down, now, log: (l) => lines.push(l) });
  assertEquals(await source("c1"), { ok: true, token: ACCESS, generation: 1 });
  assertEquals(db.reconnect, false, "a network error is not a refusal");
  assertEquals(db.lease, null, "the lease is let go so the next call can try");
  assert(db.steps.includes("mingla_connector_signin_refresh_fail"));

  // A 5xx is the same as a network failure.
  const fivexx: Fetch = () => Promise.resolve(json({ error: "invalid_grant" }, 503));
  const s2 = createSigninTokenSource({ rpc, fetch: fivexx, now });
  assertEquals((await s2("c2")).ok, true);
  assertEquals(db.reconnect, false, "invalid_grant words on a 503 are not a refusal");

  // Once the old token is about to end, the call is refused as unavailable, still no Reconnect.
  t += 27_000;
  assertEquals(await source("c3"), { ok: false, token: "upstream_unavailable" });
  assertEquals(db.reconnect, false);

  // A real refusal marks Reconnect, and the next call is not served at all.
  const refuse: Fetch = () => Promise.resolve(json({ error: "invalid_grant" }, 400));
  const s3 = createSigninTokenSource({ rpc, fetch: refuse, now });
  assertEquals(await s3("c4"), { ok: false, token: "upstream_key_rejected" });
  assertEquals(db.reconnect, true);
  assertEquals(await s3("c5"), { ok: false, token: "not_allowed" });
});

Deno.test("#4294 T-5: a store that loses its lease is retried once, and a renewal answer without a refresh token keeps the old one", async () => {
  const now = () => Date.parse("2026-11-07T12:00:00Z");
  const { db, rpc } = renewalDb({ expiresInMs: 1_000, now });
  db.failStoreOnce = true;
  let posts = 0;
  const fetchFn: Fetch = () => {
    posts++;
    return Promise.resolve(json({ access_token: ACCESS_NEW, token_type: "Bearer", expires_in: 300 }));
  };
  const source = createSigninTokenSource({ rpc, fetch: fetchFn, now });
  const got = await source("c1");
  assertEquals(got, { ok: true, token: ACCESS_NEW, generation: 2 });
  assertEquals(posts, 2, "one retry after the lost lease");
  assertEquals(db.refresh, REFRESH, "a server that does not rotate keeps the refresh token");
  const steps = db.steps.filter((s) => s !== "mingla_connector_signin_credential");
  assertEquals(steps, [
    "mingla_connector_signin_refresh_begin",
    "mingla_connector_signin_refresh_store",
    "mingla_connector_signin_refresh_begin",
    "mingla_connector_signin_refresh_store",
  ]);
});

Deno.test("#4294 T-5: the renewal form goes only to the leased token address, as a public client", async () => {
  const now = () => Date.parse("2026-11-07T12:00:00Z");
  const { rpc } = renewalDb({ expiresInMs: 0, now });
  const posted: { url: string; form: URLSearchParams; headers: Headers; redirect?: string }[] = [];
  const fetchFn: Fetch = (url, init) => {
    posted.push({ url, form: new URLSearchParams(String(init.body)), headers: new Headers(init.headers), redirect: init.redirect as string });
    return Promise.resolve(json({ access_token: ACCESS_NEW, refresh_token: REFRESH_NEW, token_type: "Bearer", expires_in: 300 }));
  };
  await createSigninTokenSource({ rpc, fetch: fetchFn, now })("c1");
  assertEquals(posted.length, 1);
  assertEquals(posted[0].url, TOKEN);
  assertEquals(posted[0].redirect, "manual");
  assertEquals(posted[0].headers.get("authorization"), null, "no credential header to the token address");
  assertEquals(posted[0].form.get("grant_type"), "refresh_token");
  assertEquals(posted[0].form.get("refresh_token"), REFRESH);
  assertEquals(posted[0].form.get("client_secret"), null);
  assert(!new URL(posted[0].url).search, "no token in the address");
});

// ---------------------------------------------------------------------------
// T-6 name hiding.
// ---------------------------------------------------------------------------
Deno.test("#4294 T-6: a tool listing holds no hidden word in any form", () => {
  const h = createHider(["Magnific", "Freepik"], "Mingla Studio");
  const listings = [
    "Magnific: generate a video",
    "MAGNIFIC upscaler",
    "Magnific's best model",
    "See magnific.com for prices",
    "Follow @magnific",
    "Ask support@freepik.com",
    "Magnific-powered upscaling",
    "MagnificAI engine",
    "Mag​nific with a zero-width space",
    "Free­pik with a soft hyphen",
    "Docs: https://docs.magnific.com/video and https://example.com/ok",
    "Freepik.com stock",
  ];
  for (const t of listings) {
    const shown = h.listingText(t);
    assert(!/magnific|freepik/i.test(shown), `${JSON.stringify(t)} -> ${JSON.stringify(shown)}`);
  }
  assertEquals(h.listingText("Magnific: generate a video"), "Mingla Studio: generate a video");
  assertEquals(h.listingText("Docs: https://docs.magnific.com/video and https://example.com/ok"),
    "Docs: [link] and https://example.com/ok", "a link without a hidden word is kept");

  // Nested schema: every description and title, at any depth, including a property named "title".
  const schema = h.schema({
    type: "object",
    description: "Options for magnific.com",
    properties: {
      title: { type: "string", title: "Magnific title", description: "Shown on Freepik:" },
      model: { type: "string", enum: ["magnific_v2"], description: "A @magnific model" },
      nested: { type: "array", items: { type: "object", properties: { x: { description: "MagnificAI x" } } } },
    },
  });
  const text = JSON.stringify(schema);
  const withoutEnums = text.replace(/"enum":\[[^\]]*\]/g, "");
  assert(!/magnific|freepik/i.test(withoutEnums), withoutEnums);
  assert(text.includes('"enum":["magnific_v2"]'), "enum values are ids and are kept");
});

Deno.test("#4294 T-6: results rewrite prose but keep links, file names, ids and raw data byte-identical", () => {
  const h = createHider(["Magnific", "Freepik"], "Mingla Studio");
  const link = "https://cdn.magnific.com/u/Magnific%20Video.mp4?sig=Magnific&x=1";
  const content = [
    { type: "text", text: `Magnific made it: ${link}. Freepik's file magnific_v2-final.png, id magnific-123, urn magnific:job:9.` },
    { type: "resource_link", uri: link, name: "Magnific video" },
    { type: "image", data: "TWFnbmlmaWM=", mimeType: "image/png" },
    { type: "text", text: "Status: Magnific:" },
  ];
  const out = h.value(content) as Record<string, string>[];
  assertEquals(
    out[0].text,
    `Mingla Studio made it: ${link}. Mingla Studio's file magnific_v2-final.png, id magnific-123, urn magnific:job:9.`,
  );
  assertEquals(out[1].uri, link, "a link value is byte-identical");
  assertEquals(out[1].name, "Mingla Studio video");
  assertEquals(out[2].data, "TWFnbmlmaWM=");
  assertEquals(out[3].text, "Status: Mingla Studio:", "a word before a closing colon is rewritten");
  // No hidden words configured: nothing changes at all.
  const none = createHider([], "X");
  assertEquals(none.listingText("Magnific​"), "Magnific​");
  // A hostile hidden-word list cannot become a pattern.
  const odd = createHider(["a.*", "(x)", "", 5, "Magnific"], "L");
  assertEquals(odd.text("aaaa (x) Magnific"), "aaaa (x) L");
});
