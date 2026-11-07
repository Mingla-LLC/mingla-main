// Issue #4294 — tester adversarial suite for the Mingla connector's sign-in
// endpoints and company-tool proxy (the edge half).
//
// The implementor suites prove the happy path. This file attacks the edge
// the way a thief, a confused client or a hostile company server would, with
// the real handler, a stand-in database that applies the rules exactly as the
// migration does (exact names, no folding), and fake company servers behind
// an injected fetch:
//   T-O1  authorize: every look-alike redirect or unknown app is a plain 400,
//         never a redirect, and the database is never asked
//   T-O2  authorize: a bad request from a known app goes back ONLY to that
//         app's own redirect; PKCE downgrades never reach Mingla Admin
//   T-O3  token: malformed, oversized, JSON, query-string, browser-origin and
//         confidential-client requests are refused before the database
//   T-O4  token: PKCE is always S256 at the edge; only digests reach the
//         database; nothing the database says leaks through
//   T-O5  every refusal of a credential is the same answer and takes the
//         same minimum time; no log line carries a code, verifier or token
//   T-O6  the connector's 401 is one answer for every unusable credential
//   T-P1  allow-list bypass by tool-name tricks never reaches a server
//   T-P2  a company server cannot widen what is offered
//   T-P3  every company-server failure is a 200 tool error with no server
//         text and no key; one finished call-log row each
//   T-P4  nothing of ours is forwarded; a replaced key never rides an old
//         session; an internal address is never fetched
//
// Invariants exercised: I-4294-1, I-4294-3, I-4294-4, I-4294-5.
// {"invariant":"I-4294-3","issue":4294,"status":"ACTIVE","enforced_by":["supabase/functions/team-agent/__tests__/connector.issue4294.tester.adversarial.test.ts"]}
// {"invariant":"I-4294-4","issue":4294,"status":"ACTIVE","enforced_by":["supabase/functions/team-agent/__tests__/connector.issue4294.tester.adversarial.test.ts"]}
// {"invariant":"I-4294-5","issue":4294,"status":"ACTIVE","enforced_by":["supabase/functions/team-agent/__tests__/connector.issue4294.tester.adversarial.test.ts"]}
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createTeamAgentHandler, sha256Hex } from "../../_shared/teamAgentMcp.ts";
import { pkceChallenge } from "../../_shared/minglaConnectorOAuth.ts";
import { McpHttpTransport } from "../../_shared/minglaConnectorProxy.ts";

const MCP = "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent";
const ADMIN = "https://admin.usemingla.com";
const APP = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const APP_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const CC = "https://claude.ai/oauth/claude-code-client-metadata";
const VERIFIER = "tester4294-verifier-ZYXWVUTSRQPONMLKJIHGFEDCBA-9876543210";
const CHALLENGE = await pkceChallenge(VERIFIER);
const CODE = "mglo_" + "T".repeat(43);
const REFRESH = "mglr_" + "U".repeat(43);
const ACCESS = "mgla_c_" + "V".repeat(43);
const OWNER = "mgla_c_" + "O".repeat(43);
const GROWTH = "mgla_c_" + "G".repeat(43);
const COMPANY_KEY = "phx_TESTER4294-companyKey-9f8e7d6c5b4a3210zz";
const UPSTREAM = "https://mcp.tester-tools.example/mcp";

// ---------------------------------------------------------------------------
// Sign-in harness.
// ---------------------------------------------------------------------------

function oauthSetup(opts: { answer?: (fn: string, args: Record<string, unknown>) => unknown; minRefusalMs?: number } = {}) {
  const rpc: { fn: string; args: Record<string, unknown> }[] = [];
  const logs: Record<string, unknown>[] = [];
  let clock = 0;
  const slept: number[] = [];
  const handler = createTeamAgentHandler({
    minRefusalMs: opts.minRefusalMs ?? 0,
    now: () => clock,
    sleep: (ms) => {
      slept.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    log: (l) => logs.push(l),
    gateway: () => Promise.resolve({ auth: "invalid" }),
    connector: {
      resourceUrl: MCP,
      rpc: (fn, args) => {
        rpc.push({ fn, args });
        if (opts.answer) return Promise.resolve(opts.answer(fn, args));
        return Promise.resolve({ error: "invalid_grant" });
      },
      fetch: () => Promise.reject(new Error("no network in sign-in tests")),
    },
  });
  return { handler, rpc, logs, slept };
}

function authorize(params: [string, string][]): Request {
  const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return new Request(`${MCP}/oauth/authorize?${qs}`, { method: "GET" });
}

const GOOD_AUTH: [string, string][] = [
  ["response_type", "code"],
  ["client_id", APP],
  ["redirect_uri", APP_REDIRECT],
  ["code_challenge", CHALLENGE],
  ["code_challenge_method", "S256"],
  ["state", "st-tester"],
];
const withParam = (k: string, v: string | null): [string, string][] => {
  const out = GOOD_AUTH.filter(([n]) => n !== k);
  if (v !== null) out.push([k, v]);
  return out;
};

function token(body: string, init: { headers?: Record<string, string>; url?: string } = {}): Request {
  return new Request(init.url ?? `${MCP}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(init.headers ?? {}) },
    body,
  });
}
const form = (pairs: [string, string][]) => pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const CODE_FORM: [string, string][] = [
  ["grant_type", "authorization_code"],
  ["code", CODE],
  ["redirect_uri", APP_REDIRECT],
  ["client_id", APP],
  ["code_verifier", VERIFIER],
];

Deno.test("#4294 T-O1: authorize answers 400 (never a redirect, never the database) for every look-alike redirect or unknown app", async () => {
  const bad: [string, string][] = [
    [APP, APP_REDIRECT + "?x=1"],
    [APP, APP_REDIRECT + "#x"],
    [APP, APP_REDIRECT + "/"],
    [APP, "https://claude.ai/api/mcp/auth_callback/../x"],
    [APP, "https://CLAUDE.AI/api/mcp/auth_callback"],
    [APP, "https://claude.ai:443/api/mcp/auth_callback"],
    [APP, "https://claude.ai.evil.com/api/mcp/auth_callback"],
    [APP, "https://claude.ai@evil.com/api/mcp/auth_callback"],
    [APP, "https://evil.com/?https://claude.ai/api/mcp/auth_callback"],
    [APP, "http://127.0.0.1:5000/callback"],
    [CC, APP_REDIRECT],
    [CC, "http://localhost.evil.com/callback"],
    [CC, "http://localhost.evil.com:5000/callback"],
    [CC, "http://127.0.0.1.evil.com:5000/callback"],
    [CC, "http://127.0.0.1:0/callback"],
    [CC, "http://127.0.0.1:80/callback"],
    [CC, "http://127.0.0.1:65536/callback"],
    [CC, "http://127.0.0.1:05000/callback"],
    [CC, "http://[::1]:5000/callback"],
    [CC, "http://127.0.0.1:5000/callback/"],
    [CC, "http://127.0.0.1:5000/callback?x"],
    [CC, "HTTP://LOCALHOST:5000/callback"],
    [CC, "http://127.0.0.1:5000/%63allback"],
    [CC, "http://127.0.0.1:5000%2Fcallback"],
    [CC, "http://user@localhost:5000/callback"],
    [CC, "http://0x7f.0.0.1:5000/callback"],
    [CC, "http://127.1:5000/callback"],
    ["https://evil.example/client", APP_REDIRECT],
    [APP + "/", APP_REDIRECT],
    [APP.toUpperCase(), APP_REDIRECT],
    ["", APP_REDIRECT],
    ["__proto__", APP_REDIRECT],
    ["constructor", APP_REDIRECT],
  ];
  const { handler, rpc } = oauthSetup();
  for (const [client, redirect] of bad) {
    const res = await handler(authorize([...withParam("client_id", client).filter(([k]) => k !== "redirect_uri"), ["redirect_uri", redirect]]));
    assertEquals(res.status, 400, `${client} -> ${redirect}`);
    assertEquals(res.headers.get("location"), null, `no redirect for ${client} -> ${redirect}`);
    const body = await res.text();
    assert(body.includes("This sign-in link is not valid"), "the fixed page");
    assertEquals(body.includes(redirect) && redirect.length > 0, false, "the page never repeats the redirect");
  }
  // Duplicated parameters: the second redirect could otherwise win.
  for (const dup of [["redirect_uri", "https://evil.com/cb"], ["client_id", CC], ["state", "other"]] as [string, string][]) {
    const res = await handler(authorize([...GOOD_AUTH, dup]));
    assertEquals(res.status, 400, `duplicate ${dup[0]}`);
    assertEquals(res.headers.get("location"), null);
  }
  // Missing client or redirect.
  for (const k of ["client_id", "redirect_uri"]) {
    const res = await handler(authorize(withParam(k, null)));
    assertEquals(res.status, 400);
    assertEquals(res.headers.get("location"), null);
  }
  assertEquals(rpc.length, 0, "authorize never asks the database");
});

Deno.test("#4294 T-O2: a bad request from a known app goes back only to that app's own redirect; PKCE downgrades never reach Admin", async () => {
  const { handler, rpc } = oauthSetup();
  const cases: [string, [string, string][], string][] = [
    ["plain method", withParam("code_challenge_method", "plain"), "invalid_request"],
    ["lower-case s256", withParam("code_challenge_method", "s256"), "invalid_request"],
    ["no method", withParam("code_challenge_method", null), "invalid_request"],
    ["no challenge", withParam("code_challenge", null), "invalid_request"],
    ["padded challenge", withParam("code_challenge", CHALLENGE + "="), "invalid_request"],
    ["hex challenge", withParam("code_challenge", "A".repeat(64)), "invalid_request"],
    ["base64 + and /", withParam("code_challenge", "+/" + CHALLENGE.slice(2)), "invalid_request"],
    ["implicit flow", withParam("response_type", "token"), "unsupported_response_type"],
    ["code id_token", withParam("response_type", "code id_token"), "unsupported_response_type"],
    ["other resource", [...GOOD_AUTH, ["resource", "https://evil.example/mcp"]], "invalid_target"],
    ["resource prefix trick", [...GOOD_AUTH, ["resource", MCP + ".evil.com"]], "invalid_target"],
    ["resource with path", [...GOOD_AUTH, ["resource", MCP + "/x"]], "invalid_target"],
    ["other scope", [...GOOD_AUTH, ["scope", "mingla admin"]], "invalid_scope"],
    ["state too long", withParam("state", "s".repeat(513)), "invalid_request"],
  ];
  for (const [label, params, error] of cases) {
    const res = await handler(authorize(params));
    assertEquals(res.status, 302, label);
    const loc = new URL(res.headers.get("location") ?? "");
    assertEquals(loc.origin + loc.pathname, APP_REDIRECT, `${label}: back to the app only`);
    assertEquals(loc.searchParams.get("error"), error, label);
    assertEquals(loc.searchParams.get("iss"), ADMIN, label);
    assertEquals(loc.searchParams.has("code"), false, label);
    if (label === "state too long") assertEquals(loc.searchParams.has("state"), false, "an oversized state is not echoed");
    else assertEquals(loc.searchParams.get("state"), "st-tester", label);
  }
  // A good request goes to Admin with everything in the fragment, nothing in a query.
  const ok = await handler(authorize([...GOOD_AUTH, ["resource", MCP], ["scope", "mingla offline_access"]]));
  assertEquals(ok.status, 302);
  const to = ok.headers.get("location") ?? "";
  assert(to.startsWith(`${ADMIN}/#/connect?`), to);
  assertEquals(new URL(to).search, "", "nothing reaches Admin's server");
  assertEquals(ok.headers.get("cache-control"), "no-store");
  // Claude Code with a real loopback port.
  const cc = await handler(authorize([...withParam("client_id", CC).filter(([k]) => k !== "redirect_uri"), ["redirect_uri", "http://127.0.0.1:49152/callback"]]));
  assert((cc.headers.get("location") ?? "").startsWith(`${ADMIN}/#/connect?`));
  assertEquals(rpc.length, 0);
});

Deno.test("#4294 T-O3: the token endpoint refuses malformed and confidential-client requests before the database", async () => {
  const { handler, rpc } = oauthSetup();
  const cases: [string, Request, number, string][] = [
    ["JSON body", new Request(`${MCP}/oauth/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(CODE_FORM)) }), 400, "invalid_request"],
    ["no content type", new Request(`${MCP}/oauth/token`, { method: "POST", body: form(CODE_FORM) }), 400, "invalid_request"],
    ["query-string parameters", token("", { url: `${MCP}/oauth/token?${form(CODE_FORM)}` }), 400, "invalid_request"],
    ["query string beside a body", token(form(CODE_FORM), { url: `${MCP}/oauth/token?x=1` }), 400, "invalid_request"],
    ["browser origin", token(form(CODE_FORM), { headers: { origin: "https://evil.example" } }), 400, "invalid_request"],
    ["basic auth", token(form(CODE_FORM), { headers: { authorization: "Basic " + btoa(`${APP}:`) } }), 401, "invalid_client"],
    ["bearer auth", token(form(CODE_FORM), { headers: { authorization: `Bearer ${ACCESS}` } }), 401, "invalid_client"],
    ["client secret", token(form([...CODE_FORM, ["client_secret", "x"]])), 401, "invalid_client"],
    ["client assertion", token(form([...CODE_FORM, ["client_assertion", "x"]])), 401, "invalid_client"],
    ["unknown client", token(form(CODE_FORM.map(([k, v]) => [k, k === "client_id" ? "https://evil.example/c" : v]))), 401, "invalid_client"],
    ["prototype client", token(form(CODE_FORM.map(([k, v]) => [k, k === "client_id" ? "__proto__" : v]))), 401, "invalid_client"],
    ["duplicate code", token(form([...CODE_FORM, ["code", "mglo_" + "Z".repeat(43)]])), 400, "invalid_request"],
    ["duplicate client", token(form([...CODE_FORM, ["client_id", CC]])), 400, "invalid_request"],
    ["no grant type", token(form(CODE_FORM.filter(([k]) => k !== "grant_type"))), 400, "invalid_request"],
    ["password grant", token(form(CODE_FORM.map(([k, v]) => [k, k === "grant_type" ? "password" : v]))), 400, "unsupported_grant_type"],
    ["client credentials", token(form(CODE_FORM.map(([k, v]) => [k, k === "grant_type" ? "client_credentials" : v]))), 400, "unsupported_grant_type"],
    ["no verifier", token(form(CODE_FORM.filter(([k]) => k !== "code_verifier"))), 400, "invalid_request"],
    ["no redirect", token(form(CODE_FORM.filter(([k]) => k !== "redirect_uri"))), 400, "invalid_request"],
    ["42-char verifier", token(form(CODE_FORM.map(([k, v]) => [k, k === "code_verifier" ? "v".repeat(42) : v]))), 400, "invalid_grant"],
    ["129-char verifier", token(form(CODE_FORM.map(([k, v]) => [k, k === "code_verifier" ? "v".repeat(129) : v]))), 400, "invalid_grant"],
    ["verifier with a space", token(form(CODE_FORM.map(([k, v]) => [k, k === "code_verifier" ? VERIFIER.slice(0, 40) + " abc" : v]))), 400, "invalid_grant"],
    ["verifier with unicode", token(form(CODE_FORM.map(([k, v]) => [k, k === "code_verifier" ? VERIFIER + "é" : v]))), 400, "invalid_grant"],
    ["access key as code", token(form(CODE_FORM.map(([k, v]) => [k, k === "code" ? ACCESS : v]))), 400, "invalid_grant"],
    ["refresh token as code", token(form(CODE_FORM.map(([k, v]) => [k, k === "code" ? REFRESH : v]))), 400, "invalid_grant"],
    ["code with a trailing space", token(form(CODE_FORM.map(([k, v]) => [k, k === "code" ? CODE + " " : v]))), 400, "invalid_grant"],
    ["access key as refresh", token(form([["grant_type", "refresh_token"], ["refresh_token", ACCESS], ["client_id", APP]])), 400, "invalid_grant"],
    ["code as refresh", token(form([["grant_type", "refresh_token"], ["refresh_token", CODE], ["client_id", APP]])), 400, "invalid_grant"],
    ["refresh without a client", token(form([["grant_type", "refresh_token"], ["refresh_token", REFRESH]])), 400, "invalid_request"],
    ["oversized body", token(form(CODE_FORM) + "&pad=" + "p".repeat(9000)), 400, "invalid_request"],
    ["invalid UTF-8", new Request(`${MCP}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new Uint8Array([0x63, 0x6f, 0x64, 0x65, 0x3d, 0xff, 0xfe]) }), 400, "invalid_request"],
  ];
  for (const [label, req, status, error] of cases) {
    const res = await handler(req);
    assertEquals(res.status, status, label);
    assertEquals(await res.json(), { error }, label);
    assertEquals(res.headers.get("cache-control"), "no-store", label);
  }
  // A body larger than the limit with no declared length (streamed).
  const big = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < 20; i++) c.enqueue(new TextEncoder().encode("a=" + "b".repeat(1000) + "&"));
      c.close();
    },
  });
  const streamed = await handler(new Request(`${MCP}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: big,
    // @ts-ignore Deno accepts duplex for streamed bodies
    duplex: "half",
  }));
  assertEquals(streamed.status, 400);
  assertEquals(rpc.length, 0, "none of these reached the database");
  // Wrong methods.
  assertEquals((await handler(new Request(`${MCP}/oauth/token`, { method: "GET" }))).status, 405);
  assertEquals((await handler(new Request(`${MCP}/oauth/authorize`, { method: "POST", body: "" }))).status, 405);
});

Deno.test("#4294 T-O4: PKCE is S256 at the edge; only digests reach the database; nothing it says leaks", async () => {
  const seenArgs: Record<string, unknown>[] = [];
  const { handler } = oauthSetup({
    answer: (_fn, args) => {
      seenArgs.push(args);
      return { error: "invalid_grant" };
    },
  });
  // A plain-method client whose verifier IS the challenge it registered.
  const plainVerifier = CHALLENGE; // 43 URL-safe characters: a legal verifier too
  await handler(token(form(CODE_FORM.map(([k, v]) => [k, k === "code_verifier" ? plainVerifier : v]))));
  assertEquals(seenArgs[0].p_challenge, await pkceChallenge(plainVerifier), "the edge always hashes");
  assert(seenArgs[0].p_challenge !== plainVerifier, "never the verifier itself");
  assertEquals(seenArgs[0].p_code_hash, await sha256Hex(CODE));
  assertEquals(JSON.stringify(seenArgs).includes(CODE), false, "the code never reaches the database");
  assertEquals(JSON.stringify(seenArgs).includes(plainVerifier.slice(0, 20)) && seenArgs[0].p_challenge !== plainVerifier, false);
  await handler(token(form([["grant_type", "refresh_token"], ["refresh_token", REFRESH], ["client_id", APP]])));
  assertEquals(seenArgs[1].p_refresh_hash, await sha256Hex(REFRESH));
  assertEquals(JSON.stringify(seenArgs).includes(REFRESH), false, "the refresh token never reaches the database");

  // What the database answers is never passed through.
  const answers: [string, unknown, number, unknown][] = [
    ["error with detail", { error: "invalid_grant", detail: "code belongs to someone@x" }, 400, { error: "invalid_grant" }],
    ["unknown error word", { error: "access_denied_by_dba" }, 500, { error: "server_error" }],
    ["not a key", { access_token: "hello", refresh_token: REFRESH }, 500, { error: "server_error" }],
    ["a Codex key", { access_token: "mgla_x_" + "A".repeat(43), refresh_token: REFRESH }, 500, { error: "server_error" }],
    ["a code as refresh", { access_token: ACCESS, refresh_token: CODE }, 500, { error: "server_error" }],
    ["an array", [ACCESS, REFRESH], 500, { error: "server_error" }],
    ["null", null, 500, { error: "server_error" }],
  ];
  for (const [label, answer, status, body] of answers) {
    const h = oauthSetup({ answer: () => answer }).handler;
    const res = await h(token(form(CODE_FORM)));
    assertEquals(res.status, status, label);
    assertEquals(await res.json(), body, label);
  }
  // A database failure says nothing about itself.
  const failing = createTeamAgentHandler({
    minRefusalMs: 0,
    gateway: () => Promise.resolve({ auth: "invalid" }),
    connector: { resourceUrl: MCP, rpc: () => Promise.reject(new Error("relation grants: owner seth@x key mglr_LEAK")) },
  });
  const res = await failing(token(form(CODE_FORM)));
  assertEquals(res.status, 500);
  assertEquals(await res.text(), JSON.stringify({ error: "server_error" }));
  // A lifetime the database gives is bounded.
  const huge = oauthSetup({ answer: () => ({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 1e12 }) }).handler;
  const hugeBody = await (await huge(token(form(CODE_FORM)))).json();
  assertEquals(hugeBody.expires_in, 86400);
  assertEquals(Object.keys(hugeBody).sort(), ["access_token", "expires_in", "refresh_token", "scope", "token_type"]);
});

Deno.test("#4294 T-O5: every credential refusal is the same answer and takes the same minimum time; logs hold no secret", async () => {
  const { handler, logs, slept } = oauthSetup({ minRefusalMs: 250 });
  const variants = [
    form(CODE_FORM),
    form(CODE_FORM.map(([k, v]) => [k, k === "code_verifier" ? "w".repeat(43) : v])),
    form(CODE_FORM.map(([k, v]) => [k, k === "code" ? "mglo_" + "Q".repeat(43) : v])),
    form(CODE_FORM.map(([k, v]) => [k, k === "code" ? "nope" : v])),
    form([["grant_type", "refresh_token"], ["refresh_token", REFRESH], ["client_id", APP]]),
    form([["grant_type", "refresh_token"], ["refresh_token", "mglr_short"], ["client_id", APP]]),
  ];
  const bodies = new Set<string>();
  for (const v of variants) {
    const res = await handler(token(v));
    assertEquals(res.status, 400);
    bodies.add(await res.text());
  }
  assertEquals([...bodies], [JSON.stringify({ error: "invalid_grant" })], "one answer for every refused credential");
  assertEquals(slept.length, variants.length, "each refusal waited");
  assert(slept.every((ms) => ms === 250), "each waited the full minimum");
  // Authorize with every secret-ish value present, then the log sweep.
  await handler(authorize([...GOOD_AUTH, ["resource", MCP]]));
  const logged = JSON.stringify(logs);
  for (const secret of [CODE, REFRESH, VERIFIER, CHALLENGE, "st-tester", "mglo_", "mglr_", "Q".repeat(20)]) {
    assertEquals(logged.includes(secret), false, `no ${secret.slice(0, 10)} in logs`);
  }
});

Deno.test("#4294 T-O6: the connector's 401 is one answer for every unusable credential and points at sign-in", async () => {
  const valid = await sha256Hex(OWNER);
  const handler = createTeamAgentHandler({
    minRefusalMs: 0,
    gateway: (keyHash) => Promise.resolve(keyHash === valid ? { ok: true, me: { role: "owner", areas: ["crm"] }, result: {} } : { auth: "invalid" }),
    connector: {
      resourceUrl: MCP,
      rpc: (fn) => Promise.resolve(fn === "mingla_connector_call_begin" ? { auth: "invalid" } : { ok: true, upstreams: [] }),
      fetch: () => Promise.reject(new Error("never")),
    },
  });
  const post = (auth: string | null, body: unknown) =>
    handler(new Request(MCP, {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
      body: JSON.stringify(body),
    }));
  const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const company = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "posthog__exec", arguments: {} } };
  const answers: { status: number; www: string | null; body: string }[] = [];
  for (const [auth, body] of [
    [null, list],
    [`Bearer ${CODE}`, list],
    [`Bearer ${REFRESH}`, list],
    [`Bearer ${ACCESS}`, list],
    [`Bearer ${ACCESS}`, company],
    [`bearer ${OWNER}`, list],
    [`Bearer  ${OWNER}`, list],
    [`Basic ${btoa("a:b")}`, list],
  ] as [string | null, unknown][]) {
    const res = await post(auth, body);
    answers.push({ status: res.status, www: res.headers.get("www-authenticate"), body: await res.text() });
  }
  for (const a of answers) {
    assertEquals(a, answers[0], "byte-identical refusal");
  }
  assertEquals(answers[0].status, 401);
  assertEquals(answers[0].www, `Bearer resource_metadata="${MCP}/.well-known/oauth-protected-resource", scope="mingla"`);
  const prm = await (await handler(new Request(`${MCP}/.well-known/oauth-protected-resource`))).json();
  assertEquals(prm.resource, MCP, "the resource is the connector address exactly");
  assertEquals(prm.authorization_servers, [ADMIN]);
});

// ---------------------------------------------------------------------------
// Company-tool harness: the real proxy and transport, a stand-in database
// that applies the migration's rules exactly, and a scriptable server.
// ---------------------------------------------------------------------------

type Mode = (msg: Record<string, unknown>, headers: Record<string, string>, signal: AbortSignal | null | undefined) => Response | Promise<Response> | null;

interface Row {
  slug: string;
  allowed: string[];
  list: string[];
  enabled: boolean;
  url: string;
  version: string;
  key: string;
}

function proxySetup(opts: { mode?: Mode; row?: Partial<Row>; transportOpts?: { listTimeoutMs?: number; callTimeoutMs?: number; maxBytes?: number } } = {}) {
  const row: Row = {
    slug: "fake",
    allowed: ["growth"],
    list: ["read_things"],
    enabled: true,
    url: UPSTREAM,
    version: "v1",
    key: COMPANY_KEY,
    ...opts.row,
  };
  const steps: string[] = [];
  const upstream: { method: string; headers: Record<string, string>; redirect?: string; url: string }[] = [];
  const logs: Record<string, unknown>[] = [];
  let calls = 0;
  let sessions = 0;
  const roles = new Map<string, string>();
  const ready = (async () => {
    roles.set(await sha256Hex(GROWTH), "growth");
    roles.set(await sha256Hex(OWNER), "owner");
  })();
  const fetchFn = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const msg = JSON.parse(String(init.body));
    upstream.push({ method: msg.method, headers, redirect: init.redirect, url });
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const custom = opts.mode ? await opts.mode(msg, headers, init.signal) : null;
    if (custom) return custom;
    if (msg.method === "initialize") {
      sessions++;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }), {
        headers: { "content-type": "application/json", "mcp-session-id": `sess-${sessions}` },
      });
    }
    if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (msg.method === "tools/list") {
      return Response.json({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "read_things", inputSchema: { type: "object" } }] } });
    }
    return Response.json({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "fine" }], isError: false } });
  };
  const handler = createTeamAgentHandler({
    minRefusalMs: 0,
    log: (l) => logs.push(l),
    gateway: async (keyHash) => {
      await ready;
      const role = roles.get(keyHash);
      return role ? { ok: true, me: { role, areas: ["crm"] }, result: {} } : { auth: "invalid" };
    },
    connector: {
      resourceUrl: MCP,
      ...(opts.transportOpts ? { transport: new McpHttpTransport(fetchFn, opts.transportOpts) } : { fetch: fetchFn }),
      rpc: async (fn, args) => {
        await ready;
        const role = roles.get(String(args.p_key_hash ?? ""));
        if (fn === "mingla_connector_upstreams_for") {
          steps.push("upstreams_for");
          if (!role) return { auth: "invalid" };
          return {
            ok: true,
            role,
            upstreams: row.enabled && row.allowed.includes(role) && row.list.length > 0
              ? [{ slug: row.slug, label: "Fake", tool_allowlist: [...row.list], version: row.version }]
              : [],
          };
        }
        if (fn === "mingla_connector_call_begin") {
          steps.push(`begin:${args.p_slug}:${args.p_tool}`);
          if (!role) return { auth: "invalid" };
          calls++;
          // Exactly as the migration: byte-equal slug and tool, no folding.
          const allowed = row.enabled && args.p_slug === row.slug && row.allowed.includes(role) &&
            (args.p_tool === "tools/list" || row.list.includes(String(args.p_tool)));
          return allowed
            ? { ok: true, call_id: `call-${calls}`, mcp_url: row.url, version: row.version }
            : { ok: false, token: "not_allowed", call_id: `call-${calls}` };
        }
        if (fn === "mingla_connector_upstream_key") {
          steps.push(`key:${args.p_call_id}`);
          return { ok: true, key: row.key };
        }
        if (fn === "mingla_connector_call_finish") {
          steps.push(`finish:${args.p_call_id}:${args.p_outcome}:${args.p_http_status}`);
          return { finished: true };
        }
        throw new Error("unexpected " + fn);
      },
    },
  });
  return { handler, steps, upstream, logs, row };
}

const mcp = (key: string, method: string, params: unknown = {}, extra: Record<string, string> = {}) =>
  new Request(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, ...extra },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method, params }),
  });

function noKeyIn(text: string, label: string) {
  for (let i = 0; i + 8 <= COMPANY_KEY.length; i++) {
    assertEquals(text.includes(COMPANY_KEY.slice(i, i + 8)), false, `${label}: key slice at ${i}`);
  }
}

Deno.test("#4294 T-P1: tool-name tricks never reach a company server and are never folded to a listed name", async () => {
  const names = [
    "fake__READ_THINGS",
    "fake__Read_things",
    "fake__read_things ",
    " fake__read_things",
    "fake__read_things​",
    "fake__read_thingѕ",
    "fake__rеad_things",
    "fake___read_things",
    "fake__read_things_",
    "FAKE__read_things",
    "Fake__read_things",
    "fake__fake__read_things",
    "fake_ _read_things",
    "__read_things",
    "fake__",
    "fake__" + "r".repeat(65),
    "fake__read_things/../x",
    "fake__read%5Fthings",
    "fake__read_things\n",
    "fаke__read_things",
    "fake​__read_things",
  ];
  for (const name of names) {
    const { handler, steps, upstream } = proxySetup();
    const res = await handler(mcp(GROWTH, "tools/call", { name, arguments: {} }));
    assertEquals(res.status, 200, JSON.stringify(name));
    const body = await res.json();
    const result = body.result;
    if (result) {
      assertEquals(result.isError, true, JSON.stringify(name));
      assertEquals(result.structuredContent?.error?.token ?? "native", result.structuredContent ? "not_allowed" : "native");
    }
    assertEquals(upstream.length, 0, `${JSON.stringify(name)} reached the server`);
    for (const s of steps) {
      assertEquals(s === "begin:fake:read_things", false, `${JSON.stringify(name)} was folded to a listed name`);
      assertEquals(s.startsWith("key:"), false, `${JSON.stringify(name)} read the key`);
    }
  }
  // Control: the exact name goes through.
  const { handler, upstream } = proxySetup();
  const ok = (await (await handler(mcp(GROWTH, "tools/call", { name: "fake__read_things" }))).json()).result;
  assertEquals(ok.isError, false);
  assert(upstream.some((u) => u.method === "tools/call"));
});

Deno.test("#4294 T-P2: a company server cannot widen what is offered", async () => {
  const leakyDescription = `Reads things. Debug: ${COMPANY_KEY}`;
  const { handler } = proxySetup({
    row: { list: ["read_things", "get_started"] },
    mode: (msg) =>
      msg.method === "tools/list"
        ? Response.json({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: [
              { name: "read_things", description: leakyDescription, inputSchema: { type: "object", properties: { [COMPANY_KEY]: { type: "string" } } } },
              { name: "Read_Things", inputSchema: { type: "object" } },
              { name: "read_things ", inputSchema: { type: "object" } },
              { name: "rеad_things", inputSchema: { type: "object" } },
              { name: "delete_everything", inputSchema: { type: "object" } },
              { name: "get_started", inputSchema: { type: "string" } },
              { name: 42, inputSchema: { type: "object" } },
              { name: "read_things/../x", inputSchema: { type: "object" } },
            ],
          },
        })
        : null,
  });
  const res = await handler(mcp(GROWTH, "tools/list"));
  const text = await res.text();
  const tools: { name: string; inputSchema: unknown; description: string }[] = JSON.parse(text).result.tools;
  const company = tools.filter((t) => t.name.includes("__")).map((t) => t.name).sort();
  assertEquals(company, ["fake__get_started", "fake__read_things"], "only exact listed names are offered");
  assertEquals(tools.filter((t) => t.name === "get_started").length, 1, "a server tool never shadows a connector tool");
  assertEquals(tools.find((t) => t.name === "fake__get_started")?.inputSchema, { type: "object" }, "a non-object schema is replaced");
  noKeyIn(text, "tools/list");
});

Deno.test("#4294 T-P3: every company-server failure is a 200 tool error with no server text, no key, one finished row", async () => {
  const echo = (status: number, type = "text/plain", extra: Record<string, string> = {}): Mode => (msg, headers) =>
    msg.method === "tools/call"
      ? new Response(`upstream says: auth was ${headers.authorization} <html>`, { status, headers: { "content-type": type, ...extra } })
      : null;
  const big = "x".repeat(2 * 1024 * 1024);
  const cases: [string, Mode, string, number | null][] = [
    ["401 echoing our header", echo(401), "upstream_key_rejected", 401],
    ["403 echoing our header", echo(403), "upstream_key_rejected", 403],
    ["302 to another host", echo(302, "text/plain", { location: "https://evil.example/steal" }), "upstream_unavailable", 302],
    ["307 to another host", echo(307, "text/plain", { location: "https://evil.example/steal" }), "upstream_unavailable", 307],
    ["500 echoing our header", echo(500), "upstream_unavailable", 500],
    ["200 HTML", echo(200, "text/html"), "upstream_unavailable", 200],
    ["200 invalid JSON", (m) => m.method === "tools/call" ? new Response("{not json", { headers: { "content-type": "application/json" } }) : null, "upstream_unavailable", 200],
    ["200 wrong id", (m) => m.method === "tools/call" ? Response.json({ jsonrpc: "2.0", id: 999999, result: { content: [{ type: "text", text: COMPANY_KEY }] } }) : null, "upstream_unavailable", 200],
    ["2 MB JSON", (m) => m.method === "tools/call" ? new Response(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: big }] } }), { headers: { "content-type": "application/json" } }) : null, "upstream_too_large", 200],
    ["2 MB of events with no answer", (m) => m.method === "tools/call" ? new Response(`data: ${big}\n\n`, { headers: { "content-type": "text/event-stream" } }) : null, "upstream_too_large", 200],
    ["events that end with only a server request", (m) => m.method === "tools/call" ? new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, method: "sampling/createMessage", params: { k: COMPANY_KEY } })}\n\n`, { headers: { "content-type": "text/event-stream" } }) : null, "upstream_unavailable", 200],
    ["JSON-RPC error echoing the key", (m) => m.method === "tools/call" ? Response.json({ jsonrpc: "2.0", id: m.id, error: { code: -1, message: `bad key ${COMPANY_KEY} / ${COMPANY_KEY.slice(5, 20)}`, data: { key: COMPANY_KEY } } }) : null, "upstream_unavailable", 200],
  ];
  for (const [label, mode, tokenWant, status] of cases) {
    const { handler, steps, upstream, logs } = proxySetup({ mode });
    const res = await handler(mcp(GROWTH, "tools/call", { name: "fake__read_things" }));
    assertEquals(res.status, 200, `${label}: never our 401/403`);
    assertEquals(res.headers.get("www-authenticate"), null, label);
    const text = await res.text();
    const result = JSON.parse(text).result;
    assertEquals(result.isError, true, label);
    assertEquals(result.structuredContent.error.token, tokenWant, label);
    assertEquals(text.includes("upstream says"), false, `${label}: no server text`);
    assertEquals(text.includes("evil.example"), false, `${label}: no redirect target`);
    noKeyIn(text, label);
    noKeyIn(JSON.stringify(logs), `${label} logs`);
    assertEquals(upstream.filter((u) => u.method === "tools/call").length, 1, `${label}: exactly one request, no redirect followed`);
    assert(upstream.every((u) => u.redirect === "manual" && u.url === UPSTREAM), label);
    const finishes = steps.filter((s) => s.startsWith("finish:"));
    assertEquals(finishes, [`finish:call-1:${tokenWant}:${status}`], `${label}: one finished row`);
  }
  // A server request carrying our id is skipped; the real answer still wins.
  const { handler } = proxySetup({
    mode: (m) =>
      m.method === "tools/call"
        ? new Response(
          `data: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, method: "roots/list" })}\n\n` +
            `data: ${JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "real" }] } })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        )
        : null,
  });
  const result = (await (await handler(mcp(GROWTH, "tools/call", { name: "fake__read_things" }))).json()).result;
  assertEquals(result.content[1].text, "real");
});

Deno.test("#4294 T-P3b: a server that never answers, or never ends its events, times out as a tool error", async () => {
  const hangHeaders: Mode = (m, _h, signal) =>
    m.method === "tools/call"
      ? new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })
      : null;
  const endlessEvents: Mode = (m, _h, signal) => {
    if (m.method !== "tools/call") return null;
    let timer: number | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        timer = setInterval(() => c.enqueue(new TextEncoder().encode(": keep-alive\n\n")), 5);
        signal?.addEventListener("abort", () => {
          clearInterval(timer);
          c.error(new DOMException("aborted", "AbortError"));
        });
      },
      cancel() {
        clearInterval(timer);
      },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  };
  for (const [label, mode] of [["no headers", hangHeaders], ["endless events", endlessEvents]] as [string, Mode][]) {
    const { handler, steps } = proxySetup({ mode, transportOpts: { callTimeoutMs: 60, listTimeoutMs: 60 } });
    const res = await handler(mcp(GROWTH, "tools/call", { name: "fake__read_things" }));
    assertEquals(res.status, 200, label);
    const result = (await res.json()).result;
    assertEquals(result.structuredContent.error.token, "upstream_timeout", label);
    assertEquals(steps.filter((s) => s.startsWith("finish:")), ["finish:call-1:upstream_timeout:null"], label);
  }
  // tools/list: a hung server is left out; the connector's own tools still list.
  const { handler } = proxySetup({
    mode: (m, _h, signal) => m.method === "tools/list" ? hangHeaders({ ...m, method: "tools/call" }, {}, signal) : null,
    transportOpts: { callTimeoutMs: 60, listTimeoutMs: 60 },
  });
  const listRes = await handler(mcp(GROWTH, "tools/list"));
  assertEquals(listRes.status, 200);
  const names: string[] = (await listRes.json()).result.tools.map((t: { name: string }) => t.name);
  assert(names.includes("get_started"));
  assertEquals(names.filter((n) => n.startsWith("fake__")), []);
});

Deno.test("#4294 T-P4: nothing of ours is forwarded; a replaced key never rides an old session; internal addresses are never fetched", async () => {
  const s = proxySetup({
    mode: (m) =>
      m.method === "initialize"
        ? new Response(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18" } }), {
          headers: { "content-type": "application/json", "mcp-session-id": "sess-A" },
        })
        : null,
  });
  await s.handler(mcp(GROWTH, "tools/call", { name: "fake__read_things" }, {
    "mcp-session-id": "client-session-should-not-pass",
    "x-mingla-chat": "chat-should-not-pass",
    "user-agent": "claude-tester/1",
    "mcp-protocol-version": "2025-06-18",
    cookie: "sb=should-not-pass",
  }));
  for (const u of s.upstream) {
    const names = Object.keys(u.headers).sort();
    for (const n of names) {
      assert(["accept", "authorization", "content-type", "mcp-protocol-version", "mcp-session-id"].includes(n), `forwarded ${n}`);
    }
    assertEquals(u.headers.authorization, `Bearer ${COMPANY_KEY}`, "only the company key, never the Mingla key");
    assertEquals(JSON.stringify(u.headers).includes(GROWTH), false);
    assert(u.headers["mcp-session-id"] === undefined || u.headers["mcp-session-id"] === "sess-A", "only the server's own session");
  }
  // The key is replaced (version changes): a fresh session with the new key.
  s.row.key = "phx_TESTER4294-NEWcompanyKey-0011223344556677";
  s.row.version = "v2";
  await s.handler(mcp(GROWTH, "tools/call", { name: "fake__read_things" }));
  const afterReplace = s.upstream.slice(s.upstream.findIndex((u) => u.headers.authorization?.includes("NEWcompanyKey")));
  assertEquals(afterReplace[0].method, "initialize", "a new key opens a new session first");
  assertEquals(afterReplace[0].headers["mcp-session-id"], undefined);
  assert(afterReplace.every((u) => u.headers.authorization === "Bearer phx_TESTER4294-NEWcompanyKey-0011223344556677"));

  // A session id that is not plain printable text is never sent back.
  const bad = proxySetup({
    mode: (m) =>
      m.method === "initialize"
        ? new Response(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: {} }), {
          headers: { "content-type": "application/json", "mcp-session-id": "x".repeat(300) },
        })
        : null,
  });
  await bad.handler(mcp(GROWTH, "tools/call", { name: "fake__read_things" }));
  assert(bad.upstream.every((u) => u.headers["mcp-session-id"] === undefined), "an oversized session id is dropped");

  // Internal or non-https addresses are refused at the edge too, without a request.
  for (const url of [
    "http://mcp.tester-tools.example/mcp",
    "https://169.254.169.254/latest",
    "https://10.0.0.1/mcp",
    "https://localhost/mcp",
    "https://x.supabase.co/functions/v1/team-agent",
    "https://admin.usemingla.com/x",
    "https://evil.vercel.app/x",
    "https://user@mcp.tester-tools.example/mcp",
    "https://mcp.tester-tools.example:8443/mcp",
    "https://mcp.tester-tools.example/mcp?x=1",
    "https://MCP.tester-tools.example/mcp",
    // Hex and short IPv4 forms that fetch reads as an address (0x7f.1 is 127.0.0.1).
    "https://0x7f.0.0.1/mcp",
    "https://0x7f.1/mcp",
    "https://1.0x2/x",
    "https://0xa9.0xfe.0xa9.0xfe/latest",
    "https://0xa9fea9fe/latest",
    "https://tools.0x10/mcp",
    "https://tools.example.10/mcp",
  ]) {
    const t = proxySetup({ row: { url } });
    const result = (await (await t.handler(mcp(GROWTH, "tools/call", { name: "fake__read_things" }))).json()).result;
    assertEquals(result.structuredContent.error.token, "upstream_unavailable", url);
    assertEquals(t.upstream.length, 0, `${url} was fetched`);
    assertEquals(t.steps.filter((x) => x.startsWith("finish:")).length, 1, `${url}: its row was finished`);
  }
});

Deno.test("#4294 T-P5: a role the row does not allow sees and calls nothing; an owner-only row stays owner-only", async () => {
  const { handler, upstream, steps } = proxySetup({ row: { allowed: ["owner"] } });
  const list: string[] = (await (await handler(mcp(GROWTH, "tools/list"))).json()).result.tools.map((t: { name: string }) => t.name);
  assertEquals(list.filter((n) => n.startsWith("fake__")), []);
  const call = (await (await handler(mcp(GROWTH, "tools/call", { name: "fake__read_things" }))).json()).result;
  assertEquals(call.structuredContent.error.token, "not_allowed");
  assertEquals(upstream.length, 0);
  assertEquals(steps.some((s) => s.startsWith("key:")), false, "no key read for a refused role");
  // A disabled row is unreachable even for its allowed role.
  const off = proxySetup({ row: { enabled: false } });
  const offCall = (await (await off.handler(mcp(GROWTH, "tools/call", { name: "fake__read_things" }))).json()).result;
  assertEquals(offCall.structuredContent.error.token, "not_allowed");
  assertEquals(off.upstream.length, 0);
});
