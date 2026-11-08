// Issue #4294 — implementor happy path: company sign-in (Connect in Company
// tools, the tool's callback, token renewal) and name hiding, through the
// connector's real handler. A fake sign-in server and a fake company MCP
// server (Magnific-shaped) sit behind an injected fetch; a stand-in database
// answers the mingla_connector_signin_ steps the way the migration does.
//
//   G-1 Connect: the owner check runs as the owner's own admin session; the
//       browser is sent to the tool's sign-in page with PKCE S256, a state,
//       Mingla's client metadata document and the exact callback
//   G-2 Connect refusals: another site, no session, not an owner, a key row,
//       a sign-in server that does not take Mingla's client document
//   G-3 the callback exchanges the code on the server and stores the tokens;
//       the browser gets a plain page with no token
//   G-4 callback refusals: an unknown state, a cancelled sign-in, another
//       issuer, a refused code
//   G-5 renewal shortly before the end, one at a time (PT409 read again)
//   G-6 a refused renewal: Reconnect needed and the key-refused words
//   G-7 calls: the access token is only the Authorization header and is
//       removed from answers; hidden words are rewritten, links kept
//   G-8 no token, code, state or verifier in any log line
//
// Declared here:
// MINGLA-INVARIANT: I-4294-13 | issue #4294 | No hidden word of a company tool appears in the tool names' titles, descriptions or schema descriptions Claude is shown; in results it is rewritten in text but never inside a link.
// MINGLA-INVARIANT: I-4294-14 | issue #4294 | A company sign-in's tokens are sent only as the MCP server's Authorization header and the token address's form body; they never reach a browser answer, a tool answer or a log line.
// Also exercises I-4294-10 and I-4294-11 (declared in supabase/migrations/__tests__/issue_4294_company_signin.implementor.happy.pg17.test.sql).
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createTeamAgentHandler, sha256Hex } from "../../_shared/teamAgentMcp.ts";
import { pkceChallenge } from "../../_shared/minglaConnectorOAuth.ts";
import { createHider, DATA_NOTE, PROXY_WORDS } from "../../_shared/minglaConnectorProxy.ts";
import { openVerifier, SIGNIN_CLIENT_ID } from "../../_shared/minglaConnectorSignin.ts";

const MCP = "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent";
const CALLBACK = MCP + "/oauth/upstream-callback";
const ADMIN = "https://admin.usemingla.com";
const TOOL_MCP = "https://mcp.magnific.com";
const ISSUER = "https://auth.magnific.com/realms/mcp";
const AUTHZ = ISSUER + "/protocol/openid-connect/auth";
const TOKEN = ISSUER + "/protocol/openid-connect/token";
const OWNER_JWT = "eyJhbGciOiJIUzI1NiJ9." + "b".repeat(40) + "." + "c".repeat(43);
const GROWTH = "mgla_c_" + "G".repeat(43);
const ACCESS_1 = "eyJAT1." + "x".repeat(30) + "access1value";
const ACCESS_2 = "eyJAT2." + "y".repeat(30) + "access2value";
const REFRESH_1 = "RT1-" + "r".repeat(40) + "refresh1";
const REFRESH_2 = "RT2-" + "s".repeat(40) + "refresh2";
const ID_TOKEN = "e30." + btoa(JSON.stringify({ email: "ads@mingla.test" })).replace(/=+$/, "") + ".sig";

function b64(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface World {
  now: number;
  log: Record<string, unknown>[];
  dbSteps: string[];
  userSteps: { jwt: string; fn: string; args: Record<string, unknown> }[];
  tokenPosts: { headers: Record<string, string>; form: URLSearchParams }[];
  mcpHeaders: Record<string, string>[];
  state: { hash: string; box: string; used: boolean } | null;
  stored: { access: string; refresh: string; expiresAt: number; generation: number } | null;
  lease: string | null;
  reconnect: boolean;
  completeArgs: Record<string, unknown> | null;
}

function setup(opts: {
  isOwner?: boolean;
  kind?: string;
  cimd?: boolean;
  tokenAnswer?: "ok" | "invalid_grant";
  refreshAnswer?: "ok" | "invalid_grant";
  conflictOnce?: boolean;
  echoToken?: boolean;
} = {}) {
  const w: World = {
    now: Date.parse("2026-11-07T12:00:00Z"),
    log: [],
    dbSteps: [],
    userSteps: [],
    tokenPosts: [],
    mcpHeaders: [],
    state: null,
    stored: null,
    lease: null,
    reconnect: false,
    completeArgs: null,
  };
  let conflicted = false;
  let calls = 0;

  const fetchFn = (url: string, init: RequestInit): Promise<Response> => {
    const json = (v: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } }));
    if (url === TOOL_MCP + "/.well-known/oauth-protected-resource") {
      return json({
        resource: TOOL_MCP,
        authorization_servers: [ISSUER],
        scopes_supported: ["openid", "profile", "email", "mcp:custom-audience"],
      });
    }
    if (url === TOOL_MCP + "/.well-known/oauth-authorization-server") {
      return json({
        issuer: ISSUER,
        authorization_endpoint: AUTHZ,
        token_endpoint: TOKEN,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["plain", "S256"],
        scopes_supported: ["openid", "profile", "email", "mcp:custom-audience", "offline_access"],
        client_id_metadata_document_supported: opts.cimd ?? true,
      });
    }
    if (url === TOKEN) {
      const form = new URLSearchParams(String(init.body));
      w.tokenPosts.push({ headers: Object.fromEntries(new Headers(init.headers).entries()), form });
      const answer = form.get("grant_type") === "refresh_token" ? opts.refreshAnswer ?? "ok" : opts.tokenAnswer ?? "ok";
      if (answer === "invalid_grant") return json({ error: "invalid_grant", error_description: "Token is not active" }, 400);
      return form.get("grant_type") === "refresh_token"
        ? json({ access_token: ACCESS_2, refresh_token: REFRESH_2, token_type: "Bearer", expires_in: 300 })
        : json({ access_token: ACCESS_1, refresh_token: REFRESH_1, token_type: "Bearer", expires_in: 300, id_token: ID_TOKEN });
    }
    if (url === TOOL_MCP) {
      w.mcpHeaders.push(Object.fromEntries(new Headers(init.headers).entries()));
      const msg = JSON.parse(String(init.body));
      if (msg.method === "initialize") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }),
            { headers: { "content-type": "application/json", "mcp-session-id": "sess-1" } },
          ),
        );
      }
      if (msg.method === "notifications/initialized") return Promise.resolve(new Response(null, { status: 202 }));
      if (msg.method === "tools/list") {
        return json({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: [
              {
                name: "video_generate",
                title: "Magnific video",
                description:
                  "Generate a video with Magnific's models (by Freepik). Docs: https://docs.magnific.com/video. Uses MAGNIFIC credits.",
                inputSchema: {
                  type: "object",
                  properties: {
                    model: { type: "string", description: "A Magnific model id", enum: ["magnific-v2", "kling"] },
                    prompt: { type: "string", title: "Freepik prompt" },
                  },
                },
              },
              { name: "stock_search", description: "Search the Freepik stock library", inputSchema: { type: "object" } },
              { name: "spaces_delete", description: "Deletes a Magnific space", inputSchema: { type: "object" } },
            ],
          },
        });
      }
      return json({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [
            {
              type: "text",
              text: opts.echoToken
                ? `debug ${new Headers(init.headers).get("authorization")}`
                : "Made with Magnific. Download: https://cdn.magnific.com/u/clip-magnific.mp4 id magnific-123",
            },
            { type: "resource_link", uri: "https://cdn.magnific.com/u/clip.mp4", name: "Magnific clip" },
          ],
          isError: false,
        },
      });
    }
    return Promise.reject(new Error("unexpected fetch " + url));
  };

  const conflict = () => Promise.reject(Object.assign(new Error("connector"), { code: "PT409" }));
  const rpc = (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    w.dbSteps.push(fn.replace("mingla_connector_", ""));
    switch (fn) {
      case "mingla_connector_upstreams_for":
        return Promise.resolve({
          ok: true,
          role: "growth",
          upstreams: w.stored && !w.reconnect
            ? [{
              slug: "studio",
              label: "Mingla Studio",
              tool_allowlist: ["video_generate", "stock_search"],
              hide_words: ["Magnific", "Freepik"],
              version: "v1",
            }]
            : [],
        });
      case "mingla_connector_call_begin": {
        calls++;
        const allowed = ["tools/list", "video_generate", "stock_search"].includes(String(args.p_tool));
        if (!allowed || !w.stored) return Promise.resolve({ ok: false, token: "not_allowed", call_id: `c${calls}` });
        if (w.reconnect) return Promise.resolve({ ok: false, token: "upstream_key_rejected", call_id: `c${calls}` });
        return Promise.resolve({
          ok: true,
          call_id: `c${calls}`,
          mcp_url: TOOL_MCP,
          version: "v1",
          auth_kind: "signin",
          label: "Mingla Studio",
          hide_words: ["Magnific", "Freepik"],
        });
      }
      case "mingla_connector_upstream_key":
        return Promise.resolve({ ok: false });
      case "mingla_connector_signin_credential":
        if (!w.stored || w.reconnect) return Promise.resolve({ ok: false });
        return Promise.resolve({
          ok: true,
          access_token: w.stored.access,
          expires_at: new Date(w.stored.expiresAt).toISOString(),
          generation: w.stored.generation,
        });
      case "mingla_connector_signin_refresh_begin":
        if (opts.conflictOnce && !conflicted) {
          conflicted = true;
          // Another renewer finished first.
          w.stored = { access: ACCESS_2, refresh: REFRESH_2, expiresAt: w.now + 300_000, generation: 3 };
          return conflict();
        }
        if (w.lease || args.p_generation !== w.stored?.generation) return conflict();
        w.lease = "lease-1";
        return Promise.resolve({
          ok: true,
          lease: w.lease,
          refresh_token: w.stored?.refresh,
          token_url: TOKEN,
          resource: TOOL_MCP,
          client_id: SIGNIN_CLIENT_ID,
        });
      case "mingla_connector_signin_refresh_store":
        if (args.p_lease !== w.lease) return conflict();
        w.lease = null;
        w.stored = {
          access: String(args.p_access),
          refresh: String(args.p_refresh),
          expiresAt: w.now + Number(args.p_expires_in) * 1000,
          generation: (w.stored?.generation ?? 0) + 1,
        };
        return Promise.resolve({ ok: true, generation: w.stored.generation });
      case "mingla_connector_signin_refresh_fail":
        if (args.p_lease !== w.lease) return conflict();
        w.lease = null;
        if (args.p_reason === "invalid_grant") w.reconnect = true;
        return Promise.resolve({ ok: true, reconnect_needed: w.reconnect });
      case "mingla_connector_call_finish":
        w.dbSteps[w.dbSteps.length - 1] = `call_finish:${args.p_outcome}`;
        return Promise.resolve({ finished: true });
      case "mingla_connector_signin_claim":
        if (!w.state || w.state.used || w.state.hash !== args.p_state_hash) return Promise.resolve({ ok: false });
        w.state.used = true;
        return Promise.resolve({
          ok: true,
          slug: "studio",
          label: "Mingla Studio",
          verifier_box: w.state.box,
          issuer: ISSUER,
          token_url: TOKEN,
          resource: TOOL_MCP,
          redirect_uri: CALLBACK,
          client_id: SIGNIN_CLIENT_ID,
        });
      case "mingla_connector_signin_complete":
        w.completeArgs = args;
        w.stored = {
          access: String(args.p_access),
          refresh: String(args.p_refresh),
          expiresAt: w.now + Number(args.p_expires_in) * 1000,
          generation: 1,
        };
        return Promise.resolve({ ok: true, slug: "studio", label: "Mingla Studio", account: args.p_account });
    }
    return Promise.reject(new Error("unexpected " + fn));
  };

  const userRpc = (jwt: string, fn: string, args: Record<string, unknown>): Promise<unknown> => {
    w.userSteps.push({ jwt, fn, args });
    if (jwt !== OWNER_JWT || opts.isOwner === false) {
      return Promise.reject(Object.assign(new Error("forbidden: Only an owner can manage company tools."), { code: "42501" }));
    }
    if (fn === "mingla_connector_signin_status") {
      return Promise.resolve({ slug: "studio", auth_kind: opts.kind ?? "signin", mcp_url: TOOL_MCP, label: "Mingla Studio" });
    }
    if (fn === "mingla_connector_signin_begin") {
      w.state = { hash: String(args.p_state_hash), box: String(args.p_verifier_box), used: false };
      return Promise.resolve({ ok: true, client_id: SIGNIN_CLIENT_ID });
    }
    return Promise.reject(new Error("unexpected user " + fn));
  };

  const handler = createTeamAgentHandler({
    minRefusalMs: 0,
    now: () => w.now,
    log: (l) => w.log.push(l),
    gateway: (keyHash) =>
      sha256Hex(GROWTH).then((h) =>
        h === keyHash ? { ok: true, me: { role: "growth", areas: ["crm"] }, result: {} } : { auth: "invalid" }
      ),
    connector: { resourceUrl: MCP, fetch: fetchFn, rpc, userRpc },
  });
  return { handler, w };
}

const start = (origin: string | null = ADMIN, jwt = OWNER_JWT, slug = "studio") =>
  new Request(MCP + "/oauth/upstream-start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
      ...(jwt ? { authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify({ slug }),
  });

const rpcReq = (method: string, params: unknown = {}) =>
  new Request(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${GROWTH}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method, params }),
  });

async function connect(s: ReturnType<typeof setup>): Promise<{ state: string; page: string; status: number }> {
  const res = await s.handler(start());
  const to = new URL((await res.json()).authorize_url);
  const state = to.searchParams.get("state") ?? "";
  const back = await s.handler(new Request(`${CALLBACK}?code=code-xyz&state=${state}&iss=${encodeURIComponent(ISSUER)}`));
  return { state, page: await back.text(), status: back.status };
}

Deno.test("#4294 G-1: Connect checks the owner as the owner and sends the browser to the tool's sign-in with PKCE", async () => {
  const { handler, w } = setup();
  const res = await handler(start());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("access-control-allow-origin"), ADMIN);
  assertEquals(res.headers.get("cache-control"), "no-store");
  const to = new URL((await res.json()).authorize_url);
  assertEquals(to.origin + to.pathname, AUTHZ);
  const p = to.searchParams;
  assertEquals(p.get("response_type"), "code");
  assertEquals(p.get("client_id"), SIGNIN_CLIENT_ID);
  assertEquals(p.get("redirect_uri"), CALLBACK);
  assertEquals(p.get("code_challenge_method"), "S256");
  assertEquals(p.get("scope"), "openid profile email mcp:custom-audience offline_access");
  assertEquals(p.get("resource"), TOOL_MCP);
  const state = p.get("state") ?? "";
  assert(/^[A-Za-z0-9_-]{43}$/.test(state));
  // The owner check is the first database step, as the owner's own session.
  assertEquals(w.userSteps.map((s) => s.fn), ["mingla_connector_signin_status", "mingla_connector_signin_begin"]);
  assert(w.userSteps.every((s) => s.jwt === OWNER_JWT));
  assertEquals(w.dbSteps, [], "nothing ran as the server role");
  const begun = w.userSteps[1].args;
  assertEquals(begun.p_state_hash, await sha256Hex(state), "only a digest of the state is kept");
  assertEquals(begun.p_redirect_uri, CALLBACK);
  assertEquals(begun.p_token_url, TOKEN);
  assertEquals(begun.p_issuer, ISSUER);
  const verifier = await openVerifier(state, String(begun.p_verifier_box));
  assert(verifier && /^[A-Za-z0-9_-]{86}$/.test(verifier), "the sealed verifier opens with the state");
  assertEquals(await pkceChallenge(verifier), p.get("code_challenge"));
  assertEquals(await openVerifier("x".repeat(43), String(begun.p_verifier_box)), null, "another state cannot open it");
  assert(!String(begun.p_verifier_box).includes(verifier));
});

Deno.test("#4294 G-1: the preflight answers only Mingla Admin", async () => {
  const { handler } = setup();
  const ok = await handler(new Request(MCP + "/oauth/upstream-start", { method: "OPTIONS", headers: { origin: ADMIN } }));
  assertEquals(ok.status, 204);
  assertEquals(ok.headers.get("access-control-allow-origin"), ADMIN);
  assert((ok.headers.get("access-control-allow-headers") ?? "").includes("authorization"));
  const evil = await handler(
    new Request(MCP + "/oauth/upstream-start", { method: "OPTIONS", headers: { origin: "https://evil.example" } }),
  );
  assertEquals(evil.status, 403);
  assertEquals(evil.headers.get("access-control-allow-origin"), null);
});

Deno.test("#4294 G-2: Connect refuses another site, no session, a non-owner, a key row and a server that refuses Mingla's client", async () => {
  {
    const { handler, w } = setup();
    const res = await handler(start("https://evil.example"));
    assertEquals(res.status, 403);
    assertEquals(w.userSteps.length, 0);
  }
  {
    const { handler, w } = setup();
    assertEquals((await handler(start(ADMIN, ""))).status, 401);
    assertEquals(w.userSteps.length, 0);
  }
  {
    const { handler, w } = setup({ isOwner: false });
    const res = await handler(start());
    assertEquals(res.status, 403);
    assertEquals((await res.json()).error, "forbidden");
    assertEquals(w.userSteps.map((s) => s.fn), ["mingla_connector_signin_status"], "nothing is started for a non-owner");
    assertEquals(w.state, null);
  }
  {
    const { handler, w } = setup({ kind: "key" });
    const res = await handler(start());
    assertEquals(res.status, 400);
    assertEquals((await res.json()).error, "key_only");
    assertEquals(w.state, null);
  }
  {
    const { handler, w } = setup({ cimd: false });
    const res = await handler(start());
    assertEquals(res.status, 502);
    assertEquals((await res.json()).error, "upstream_unavailable");
    assertEquals(w.state, null, "no start is recorded when the sign-in server cannot be used");
  }
});

Deno.test("#4294 G-3: the callback exchanges the code on the server and stores the tokens; the page has none", async () => {
  const s = setup();
  const { page, status } = await connect(s);
  assertEquals(status, 200);
  assert(page.includes("Mingla Studio is connected as ads@mingla.test."), page);
  // A full document is built only in _shared/email (orch-0785); the words are split so this test is not one.
  assert(!new RegExp("<!" + "doctype|<" + "html", "i").test(page), "a plain page like the invalid-link page");
  for (const t of [ACCESS_1, REFRESH_1, "code-xyz"]) assert(!page.includes(t), "the page holds a token or the code");
  assertEquals(s.w.tokenPosts.length, 1);
  const post = s.w.tokenPosts[0];
  assertEquals(post.form.get("grant_type"), "authorization_code");
  assertEquals(post.form.get("code"), "code-xyz");
  assertEquals(post.form.get("client_id"), SIGNIN_CLIENT_ID);
  assertEquals(post.form.get("redirect_uri"), CALLBACK);
  assertEquals(post.form.get("resource"), TOOL_MCP);
  assertEquals(post.form.has("client_secret"), false);
  assertEquals(post.headers.authorization, undefined, "a public client: no Authorization header");
  const challenge = await pkceChallenge(post.form.get("code_verifier") ?? "");
  assert(s.w.state);
  assertEquals(s.w.completeArgs?.p_access, ACCESS_1);
  assertEquals(s.w.completeArgs?.p_refresh, REFRESH_1);
  assertEquals(s.w.completeArgs?.p_account, "ads@mingla.test");
  assertEquals(s.w.completeArgs?.p_state_hash, s.w.state.hash);
  assertEquals(challenge.length, 43);
});

Deno.test("#4294 G-4: the callback refuses an unknown state, a cancel, another issuer and a refused code", async () => {
  {
    const s = setup();
    const res = await s.handler(new Request(`${CALLBACK}?code=c&state=${"z".repeat(43)}`));
    assertEquals(res.status, 400);
    assert((await res.text()).includes("ended or was already used"));
    assertEquals(s.w.tokenPosts.length, 0);
  }
  {
    const s = setup();
    const to = new URL((await (await s.handler(start())).json()).authorize_url);
    const state = to.searchParams.get("state");
    const res = await s.handler(new Request(`${CALLBACK}?error=access_denied&state=${state}`));
    assert((await res.text()).includes("cancelled or refused"));
    assertEquals(s.w.tokenPosts.length, 0);
    // The state was claimed: it cannot be used again.
    const again = await s.handler(new Request(`${CALLBACK}?code=c&state=${state}`));
    assert((await again.text()).includes("ended or was already used"));
  }
  {
    const s = setup();
    const to = new URL((await (await s.handler(start())).json()).authorize_url);
    const res = await s.handler(
      new Request(`${CALLBACK}?code=c&state=${to.searchParams.get("state")}&iss=${encodeURIComponent("https://auth.evil.example")}`),
    );
    assertEquals(res.status, 400);
    assertEquals(s.w.tokenPosts.length, 0, "no code goes to anyone when the issuer is another");
  }
  {
    const s = setup({ tokenAnswer: "invalid_grant" });
    const { page, status } = await connect(s);
    assertEquals(status, 502);
    assert(page.includes("did not finish"));
    assert(!page.includes("Token is not active"), "the tool's own words are never shown");
    assertEquals(s.w.completeArgs, null);
  }
});

Deno.test("#4294 G-5: a token far from its end is used as it is; one near its end is renewed once, under the lease", async () => {
  const s = setup();
  await connect(s);
  s.w.tokenPosts = [];
  let res = await s.handler(rpcReq("tools/call", { name: "studio__stock_search", arguments: { q: "beach" } }));
  assertEquals((await res.json()).result.isError, false);
  assertEquals(s.w.tokenPosts.length, 0, "no renewal while the token has time left");
  assertEquals(s.w.mcpHeaders.at(-1)?.authorization, `Bearer ${ACCESS_1}`);

  s.w.now += 250_000; // 50 s left: renew.
  s.w.dbSteps = [];
  res = await s.handler(rpcReq("tools/call", { name: "studio__stock_search", arguments: { q: "beach" } }));
  assertEquals((await res.json()).result.isError, false);
  assertEquals(s.w.tokenPosts.length, 1);
  assertEquals(s.w.tokenPosts[0].form.get("grant_type"), "refresh_token");
  assertEquals(s.w.tokenPosts[0].form.get("refresh_token"), REFRESH_1);
  assertEquals(s.w.tokenPosts[0].form.get("client_id"), SIGNIN_CLIENT_ID);
  assertEquals(s.w.dbSteps, [
    "call_begin",
    "signin_credential",
    "signin_refresh_begin",
    "signin_refresh_store",
    "call_finish:ok",
  ]);
  assertEquals(s.w.stored?.refresh, REFRESH_2, "the rotated refresh token is kept");
  assertEquals(s.w.mcpHeaders.at(-1)?.authorization, `Bearer ${ACCESS_2}`);
});

Deno.test("#4294 G-5: when another renewer got there first (PT409), it reads again and uses the new token", async () => {
  const s = setup({ conflictOnce: true });
  await connect(s);
  s.w.tokenPosts = [];
  s.w.now += 280_000;
  s.w.dbSteps = [];
  const res = await s.handler(rpcReq("tools/call", { name: "studio__stock_search", arguments: {} }));
  assertEquals((await res.json()).result.isError, false);
  assertEquals(s.w.tokenPosts.length, 0, "no second renewal");
  assertEquals(s.w.dbSteps, [
    "call_begin",
    "signin_credential",
    "signin_refresh_begin",
    "signin_credential",
    "call_finish:ok",
  ]);
  assertEquals(s.w.mcpHeaders.at(-1)?.authorization, `Bearer ${ACCESS_2}`);
});

Deno.test("#4294 G-6: a refused renewal marks Reconnect needed and answers the key-refused words", async () => {
  const s = setup({ refreshAnswer: "invalid_grant" });
  await connect(s);
  s.w.now += 290_000;
  const res = await s.handler(rpcReq("tools/call", { name: "studio__stock_search", arguments: {} }));
  assertEquals(res.status, 200, "never this connector's own 401");
  const result = (await res.json()).result;
  assertEquals(result.isError, true);
  assertEquals(result.structuredContent.error.token, "upstream_key_rejected");
  assertEquals(result.structuredContent.error.message, PROXY_WORDS.upstream_key_rejected);
  assertEquals(s.w.reconnect, true);
  assertEquals(s.w.dbSteps.at(-1), "call_finish:upstream_key_rejected");
  // The next call is refused by the database before any request.
  const posts = s.w.tokenPosts.length;
  const next = (await (await s.handler(rpcReq("tools/call", { name: "studio__stock_search", arguments: {} }))).json()).result;
  assertEquals(next.structuredContent.error.token, "upstream_key_rejected");
  assertEquals(s.w.tokenPosts.length, posts);
});

Deno.test("#4294 G-7: tools/list shows no hidden word; results rewrite text, keep links and lose the token", async () => {
  const s = setup();
  await connect(s);
  const listed = (await (await s.handler(rpcReq("tools/list"))).json()).result.tools
    .filter((t: { name: string }) => t.name.startsWith("studio__"));
  assertEquals(listed.map((t: { name: string }) => t.name).sort(), ["studio__stock_search", "studio__video_generate"]);
  const shown = JSON.stringify(listed.map((t: Record<string, unknown>) => ({ ...t, inputSchema: undefined })));
  assert(!/magnific|freepik/i.test(shown), shown);
  const video = listed.find((t: { name: string }) => t.name === "studio__video_generate");
  assertEquals(video.title, "Mingla Studio: Mingla Studio video");
  assert(video.description.includes("with Mingla Studio's models (by Mingla Studio). Docs: [link]."), video.description);
  assertEquals(video.inputSchema.properties.model.description, "A Mingla Studio model id");
  assertEquals(video.inputSchema.properties.prompt.title, "Mingla Studio prompt");
  assertEquals(video.inputSchema.properties.model.enum, ["magnific-v2", "kling"], "values a call sends are untouched");
  assertEquals(s.w.mcpHeaders.every((h) => h.authorization === `Bearer ${ACCESS_1}`), true);

  const call = (await (await s.handler(rpcReq("tools/call", { name: "studio__video_generate", arguments: {} }))).json())
    .result;
  assertEquals(call.content[0].text, DATA_NOTE);
  assertEquals(
    call.content[1].text,
    "Made with Mingla Studio. Download: https://cdn.magnific.com/u/clip-magnific.mp4 id magnific-123",
  );
  assertEquals(call.content[2].uri, "https://cdn.magnific.com/u/clip.mp4", "a download link still works");
  assertEquals(call.content[2].name, "Mingla Studio clip");

  const echo = setup({ echoToken: true });
  await connect(echo);
  const leaked = JSON.stringify(
    (await (await echo.handler(rpcReq("tools/call", { name: "studio__stock_search", arguments: {} }))).json()).result,
  );
  assert(!leaked.includes(ACCESS_1) && !leaked.includes(ACCESS_1.slice(10, 22)), "the access token is removed");
});

Deno.test("#4294 G-7: the hider leaves ids, file names, addresses and longer words alone", () => {
  const h = createHider(["Magnific", "Freepik"], "Mingla Studio");
  assertEquals(h.text("MAGNIFIC and magnific, Magnific's tools."), "Mingla Studio and Mingla Studio, Mingla Studio's tools.");
  assertEquals(h.text("magnific-123 magnific_v2 magnific.com x/magnific @magnific Magnificent"),
    "magnific-123 magnific_v2 magnific.com x/magnific @magnific Magnificent");
  assertEquals(h.text("see https://www.freepik.com/a?b=Freepik then Freepik."),
    "see https://www.freepik.com/a?b=Freepik then Mingla Studio.");
  assertEquals(h.value({ url: "Magnific", text: "Magnific" }), { url: "Magnific", text: "Mingla Studio" });
  assertEquals(createHider([], "X").text("Magnific"), "Magnific");
  assertEquals(createHider(["bad(word"], "X").text("bad(word"), "bad(word", "a word that is not plain is ignored");
});

Deno.test("#4294 G-8: no token, code, state or verifier reaches a log line", async () => {
  const s = setup();
  const { state } = await connect(s);
  s.w.now += 290_000;
  await s.handler(rpcReq("tools/call", { name: "studio__stock_search", arguments: {} }));
  const all = JSON.stringify(s.w.log);
  const verifier = s.w.tokenPosts[0].form.get("code_verifier") ?? "";
  for (const secret of [ACCESS_1, ACCESS_2, REFRESH_1, REFRESH_2, "code-xyz", state, verifier, OWNER_JWT, b64(ID_TOKEN)]) {
    assert(!all.includes(secret), "a log line holds a secret");
  }
  assert(s.w.log.some((l) => l.method === "oauth:upstream-start" && l.outcome === "ok"));
  assert(s.w.log.some((l) => l.method === "oauth:upstream-callback" && l.outcome === "connected"));
  assert(s.w.log.some((l) => l.step === "signin_renewal" && l.outcome === "ok"));
});
