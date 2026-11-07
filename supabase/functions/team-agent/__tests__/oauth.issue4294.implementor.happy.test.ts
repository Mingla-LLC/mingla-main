// Issue #4294 — implementor happy path: a Claude app finds where to sign in
// from the connector's 401, is sent to Mingla Admin to approve, and swaps
// the code (with its PKCE verifier) for a one-hour team-agent key and a
// rotating refresh token. Existing personal-key requests are unchanged.
//
// The real handler with a stand-in gateway and a stand-in database for the
// mingla_connector_ functions. Deno, no network, no database.
//
// Invariant declared here:
//   I-4294-1 A sign-in token is a team-agent key: the token endpoint hands
//            out only what the database's one key maker made, in the key
//            shape every gateway already reads (this file: shape and
//            routing; supabase/migrations/__tests__/issue_4294_mingla_connector
//            .implementor.happy.pg17.test.sql: kind, end, never replacing a
//            personal key).
import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createTeamAgentHandler, KEY_PATTERN, sha256Hex } from "../../_shared/teamAgentMcp.ts";
import { pkceChallenge, redirectAllowed } from "../../_shared/minglaConnectorOAuth.ts";
// {"invariant":"I-4294-1","issue":4294,"status":"ACTIVE","enforced_by":["supabase/functions/team-agent/__tests__/oauth.issue4294.implementor.happy.test.ts","supabase/migrations/__tests__/issue_4294_mingla_connector.implementor.happy.pg17.test.sql"]}

const MCP = "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent";
const APP = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const APP_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const CODE_CLIENT = "https://claude.ai/oauth/claude-code-client-metadata";
const VERIFIER = "issue4294-verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
const PERSONAL = "mgla_c_" + "P".repeat(43);
const ACCESS1 = "mgla_c_" + "A".repeat(43);
const ACCESS2 = "mgla_c_" + "B".repeat(43);
const REFRESH1 = "mglr_" + "R".repeat(43);
const REFRESH2 = "mglr_" + "S".repeat(43);
const CODE = "mglo_" + "C".repeat(43);

interface Calls {
  rpc: { fn: string; args: Record<string, unknown> }[];
  gateway: { keyHash: string; tool: string }[];
}

async function setup() {
  const calls: Calls = { rpc: [], gateway: [] };
  const valid = new Map<string, string>([
    [await sha256Hex(PERSONAL), "growth"],
    [await sha256Hex(ACCESS1), "growth"],
    [await sha256Hex(ACCESS2), "growth"],
  ]);
  const codeHash = await sha256Hex(CODE);
  const refresh1Hash = await sha256Hex(REFRESH1);
  const challenge = await pkceChallenge(VERIFIER);
  const logs: Record<string, unknown>[] = [];
  const handler = createTeamAgentHandler({
    minRefusalMs: 0,
    log: (l) => logs.push(l),
    gateway: (keyHash, tool) => {
      calls.gateway.push({ keyHash, tool });
      const role = valid.get(keyHash);
      if (!role) return Promise.resolve({ auth: "invalid" });
      return Promise.resolve({ ok: true, me: { role, areas: ["crm"] }, result: {} });
    },
    connector: {
      resourceUrl: MCP,
      rpc: (fn, args) => {
        calls.rpc.push({ fn, args });
        if (fn === "mingla_connector_oauth_exchange") {
          const ok = args.p_code_hash === codeHash && args.p_client_id === APP &&
            args.p_redirect_uri === APP_REDIRECT && args.p_challenge === challenge;
          return Promise.resolve(
            ok
              ? { access_token: ACCESS1, refresh_token: REFRESH1, expires_in: 3600, kind: "claude_app" }
              : { error: "invalid_grant" },
          );
        }
        if (fn === "mingla_connector_oauth_refresh") {
          return Promise.resolve(
            args.p_refresh_hash === refresh1Hash && args.p_client_id === APP
              ? { access_token: ACCESS2, refresh_token: REFRESH2, expires_in: 3600, kind: "claude_app" }
              : { error: "invalid_grant" },
          );
        }
        if (fn === "mingla_connector_upstreams_for") {
          return Promise.resolve({ ok: true, role: "growth", upstreams: [] });
        }
        return Promise.reject(new Error("unexpected " + fn));
      },
    },
  });
  return { handler, calls, logs };
}

const mcp = (key: string | null, body: unknown, headers: Record<string, string> = {}) =>
  new Request(MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });

const form = (fields: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(MCP + "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });

Deno.test("#4294 O-1: a request with no key gets a 401 that says where to sign in", async () => {
  const { handler } = await setup();
  const res = await handler(mcp(null, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }));
  assertEquals(res.status, 401);
  assertEquals(
    res.headers.get("www-authenticate"),
    `Bearer resource_metadata="${MCP}/.well-known/oauth-protected-resource", scope="mingla"`,
  );
  const body = await res.json();
  assertEquals(body.error.code, -32001);
});

Deno.test("#4294 O-2: the protected-resource document names the connector exactly and Mingla Admin", async () => {
  const { handler } = await setup();
  const res = await handler(new Request(MCP + "/.well-known/oauth-protected-resource"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    resource: MCP,
    authorization_servers: ["https://admin.usemingla.com"],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mingla"],
  });
});

Deno.test("#4294 O-3: authorize sends a good request to Mingla Admin #/connect, with its parameters in the fragment", async () => {
  const { handler, calls } = await setup();
  const challenge = await pkceChallenge(VERIFIER);
  const q = new URLSearchParams({
    response_type: "code",
    client_id: APP,
    redirect_uri: APP_REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-123",
    resource: MCP,
    scope: "mingla offline_access",
  });
  const res = await handler(new Request(`${MCP}/oauth/authorize?${q}`));
  assertEquals(res.status, 302);
  const to = res.headers.get("location") ?? "";
  assert(to.startsWith("https://admin.usemingla.com/#/connect?"), to);
  const fragment = new URLSearchParams(to.split("#/connect?")[1]);
  assertEquals(fragment.get("client_id"), APP);
  assertEquals(fragment.get("redirect_uri"), APP_REDIRECT);
  assertEquals(fragment.get("code_challenge"), challenge);
  assertEquals(fragment.get("state"), "st-123");
  assertEquals(calls.rpc.length, 0, "authorize itself makes nothing in the database");
  assertEquals(res.headers.get("cache-control"), "no-store");
});

Deno.test("#4294 O-4: an unknown app or another redirect gets a 400 page, never a redirect", async () => {
  const { handler } = await setup();
  const challenge = await pkceChallenge(VERIFIER);
  for (
    const [client, redirect] of [
      ["https://evil.example/client", APP_REDIRECT],
      [APP, "https://evil.example/callback"],
      [CODE_CLIENT, "http://localhost:80/callback"],
    ]
  ) {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: client,
      redirect_uri: redirect,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const res = await handler(new Request(`${MCP}/oauth/authorize?${q}`));
    assertEquals(res.status, 400, `${client} ${redirect}`);
    assertEquals(res.headers.get("location"), null);
  }
  // Known app, plain PKCE: back to the app with an error.
  const q = new URLSearchParams({
    response_type: "code",
    client_id: APP,
    redirect_uri: APP_REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "plain",
    state: "s",
  });
  const res = await handler(new Request(`${MCP}/oauth/authorize?${q}`));
  assertEquals(res.status, 302);
  const back = new URL(res.headers.get("location") ?? "");
  assertEquals(back.origin + back.pathname, APP_REDIRECT);
  assertEquals(back.searchParams.get("error"), "invalid_request");
  assertEquals(back.searchParams.get("state"), "s");
});

Deno.test("#4294 O-5: code + PKCE verifier are exchanged for a key-shaped token; only digests reach the database", async () => {
  const { handler, calls, logs } = await setup();
  const res = await handler(form({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: APP_REDIRECT,
    client_id: APP,
    code_verifier: VERIFIER,
  }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assertEquals(body.token_type, "Bearer");
  assertEquals(body.expires_in, 3600);
  assertEquals(body.scope, "mingla");
  assertMatch(body.access_token, KEY_PATTERN);
  assertEquals(body.refresh_token, REFRESH1);
  const sent = calls.rpc.find((c) => c.fn === "mingla_connector_oauth_exchange");
  assert(sent);
  assertEquals(sent.args.p_code_hash, await sha256Hex(CODE));
  assertEquals(sent.args.p_challenge, await pkceChallenge(VERIFIER));
  assertEquals(JSON.stringify(sent.args).includes(CODE), false, "the code itself never leaves");
  assertEquals(JSON.stringify(sent.args).includes(VERIFIER), false, "the verifier never leaves");
  const logged = JSON.stringify(logs);
  for (const secret of [CODE, VERIFIER, ACCESS1, REFRESH1]) {
    assertEquals(logged.includes(secret.slice(5, 20)), false, "nothing secret is logged");
  }

  // The token works as a key at the connector, as the person.
  const list = await handler(mcp(body.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" }));
  assertEquals(list.status, 200);
  const tools = (await list.json()).result.tools;
  assert(Array.isArray(tools) && tools.length > 0, "the person's own tools are listed");
});

Deno.test("#4294 O-6: a wrong verifier is invalid_grant; JSON or a client secret is refused", async () => {
  const { handler } = await setup();
  const bad = await handler(form({
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: APP_REDIRECT,
    client_id: APP,
    code_verifier: VERIFIER.replace("0", "9"),
  }));
  assertEquals(bad.status, 400);
  assertEquals(await bad.json(), { error: "invalid_grant" });
  const json = await handler(
    new Request(MCP + "/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code" }),
    }),
  );
  assertEquals(json.status, 400);
  assertEquals(await json.json(), { error: "invalid_request" });
  const secret = await handler(form({ grant_type: "refresh_token", refresh_token: REFRESH1, client_id: APP, client_secret: "x" }));
  assertEquals(secret.status, 401);
  assertEquals(await secret.json(), { error: "invalid_client" });
  const other = await handler(form({ grant_type: "password", client_id: APP }));
  assertEquals(await other.json(), { error: "unsupported_grant_type" });
});

Deno.test("#4294 O-7: a refresh rotates both tokens", async () => {
  const { handler } = await setup();
  const res = await handler(form({ grant_type: "refresh_token", refresh_token: REFRESH1, client_id: APP }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.access_token, ACCESS2);
  assertEquals(body.refresh_token, REFRESH2);
  const again = await handler(form({ grant_type: "refresh_token", refresh_token: REFRESH2 + "", client_id: CODE_CLIENT }));
  assertEquals(again.status, 400);
  assertEquals(await again.json(), { error: "invalid_grant" });
});

Deno.test("#4294 O-8: existing personal-key requests are unchanged", async () => {
  const { handler, calls } = await setup();
  const ping = await handler(mcp(PERSONAL, { jsonrpc: "2.0", id: 1, method: "ping" }));
  assertEquals(ping.status, 200);
  assertEquals((await ping.json()).result, {});
  assertEquals(calls.gateway.at(-1)?.tool, "mcp:ping");
  const get = await handler(new Request(MCP, { method: "GET" }));
  assertEquals(get.status, 405);
  assertEquals(get.headers.get("allow"), "POST");
  const browser = await handler(mcp(PERSONAL, { jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://example.com" }));
  assertEquals(browser.status, 403);
  // Every refused key is the same answer, byte for byte.
  const a = await handler(mcp("mgla_c_" + "Z".repeat(43), { jsonrpc: "2.0", id: 1, method: "ping" }));
  const b = await handler(mcp(null, { jsonrpc: "2.0", id: 1, method: "ping" }));
  assertEquals([a.status, a.headers.get("www-authenticate"), await a.text()], [
    b.status,
    b.headers.get("www-authenticate"),
    await b.text(),
  ]);
});

Deno.test("#4294 O-9: the pinned redirect rules", () => {
  assert(redirectAllowed(APP, APP_REDIRECT));
  assert(redirectAllowed(CODE_CLIENT, "http://localhost:53682/callback"));
  assert(redirectAllowed(CODE_CLIENT, "http://127.0.0.1:1024/callback"));
  for (
    const r of [
      APP_REDIRECT + "?x",
      APP_REDIRECT + "/",
      "https://claude.ai:443/api/mcp/auth_callback",
      "https://claude.ai@evil.example/api/mcp/auth_callback",
    ]
  ) assertEquals(redirectAllowed(APP, r), false, r);
  for (
    const r of [
      "http://localhost:80/callback",
      "http://[::1]:5000/callback",
      "http://127.0.0.1:5000/callback/",
      "HTTP://LOCALHOST:5000/callback",
      "http://localhost.evil.com:5000/callback",
      "http://127.0.0.1:65536/callback",
      "http://127.0.0.1:05000/callback",
    ]
  ) assertEquals(redirectAllowed(CODE_CLIENT, r), false, r);
});

Deno.test("#4294 O-10: Claude's own origin or none is taken at the token endpoint; another site's page is not", async () => {
  const fields = {
    grant_type: "authorization_code",
    code: CODE,
    redirect_uri: APP_REDIRECT,
    client_id: APP,
    code_verifier: VERIFIER,
  };
  for (const origin of ["https://claude.ai", "https://claude.com"]) {
    const { handler } = await setup();
    const res = await handler(form(fields, { origin }));
    assertEquals(res.status, 200, origin);
    assertEquals(res.headers.get("access-control-allow-origin"), null, `${origin}: no CORS header`);
    assertMatch((await res.json()).access_token, KEY_PATTERN);
  }
  for (const origin of ["https://evil.example", "null", "https://claude.ai.evil.example", "http://claude.ai", "https://CLAUDE.AI"]) {
    const { handler, calls } = await setup();
    const res = await handler(form(fields, { origin }));
    assertEquals(res.status, 400, origin);
    assertEquals(await res.json(), { error: "invalid_request" }, origin);
    assertEquals(res.headers.get("access-control-allow-origin"), null, `${origin}: no CORS header`);
    assertEquals(calls.rpc.some((c) => c.fn === "mingla_connector_oauth_exchange"), false, `${origin}: never reaches the database`);
  }
  // Public client only: any Authorization header is still refused.
  const { handler } = await setup();
  const basic = await handler(form(fields, { authorization: "Basic " + btoa(`${encodeURIComponent(APP)}:`) }));
  assertEquals(basic.status, 401);
  assertEquals(await basic.json(), { error: "invalid_client" });
});
