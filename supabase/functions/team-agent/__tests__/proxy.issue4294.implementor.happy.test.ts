// Issue #4294 — implementor happy path: company tools through the Mingla
// connector. A fake company MCP server (answers JSON or server-sent events,
// hands out a session id) sits behind an injected fetch; a stand-in
// database answers the mingla_connector_ steps the way the migration does.
//
// Invariants declared here:
//   I-4294-3 Upstream tools are default-deny: offered and callable only when
//            the database says the row is on, the role is allowed and the
//            exact name is listed (here: an unlisted tool is never offered,
//            a refused call never reaches the server).
//   I-4294-4 An upstream failure is never a transport 401/403 from the
//            connector: it is a 200 answer carrying a tool error token.
//   I-4294-5 Every proxied upstream request has exactly one call-log row:
//            begin before the request, finish after it, in that order.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createTeamAgentHandler, sha256Hex } from "../../_shared/teamAgentMcp.ts";
import { DATA_NOTE, scrubText } from "../../_shared/minglaConnectorProxy.ts";

const MCP = "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/team-agent";
const UPSTREAM = "https://mcp.fake-tools.example/mcp";
const GROWTH = "mgla_c_" + "G".repeat(43);
const ADMIN = "mgla_c_" + "D".repeat(43);
const COMPANY_KEY = "phx_FAKE4294companyKeyValue0123456789";

interface Seen {
  steps: string[];
  upstream: { method: string; headers: Record<string, string>; redirect?: string }[];
}

function fakeUpstream(seen: Seen, mode: { sse?: boolean; status?: number; lose?: boolean; echoKey?: boolean }) {
  let sessions = 0;
  let lost = false;
  return (_url: string, init: RequestInit): Promise<Response> => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const msg = JSON.parse(String(init.body));
    seen.upstream.push({ method: msg.method, headers, redirect: init.redirect });
    if (mode.status) {
      return Promise.resolve(
        new Response("nope " + headers.authorization, {
          status: mode.status,
          headers: mode.status === 302 ? { location: "https://elsewhere.example/" } : {},
        }),
      );
    }
    if (msg.method === "initialize") {
      sessions++;
      return Promise.resolve(
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }),
          { headers: { "content-type": "application/json", "mcp-session-id": `sess-${sessions}` } },
        ),
      );
    }
    if (msg.method === "notifications/initialized") return Promise.resolve(new Response(null, { status: 202 }));
    if (mode.lose && !lost && headers["mcp-session-id"] === "sess-1") {
      lost = true;
      return Promise.resolve(new Response("gone", { status: 404 }));
    }
    let result: unknown;
    if (msg.method === "tools/list") {
      result = {
        tools: [
          { name: "read_things", description: "Reads things", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
          { name: "delete_things", description: "Deletes things", inputSchema: { type: "object" } },
          { name: "x".repeat(60), description: "A very long name", inputSchema: { type: "object" } },
        ],
      };
    } else {
      result = {
        content: [{
          type: "text",
          text: mode.echoKey ? `the key was ${COMPANY_KEY} and part ${COMPANY_KEY.slice(4, 16)}` : "42 things",
          _meta: { secret: "dropped" },
        }],
        isError: false,
      };
    }
    const answer = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result });
    if (mode.sse) {
      const note = JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} });
      return Promise.resolve(
        new Response(`event: message\ndata: ${note}\n\nevent: message\ndata: ${answer}\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    }
    return Promise.resolve(new Response(answer, { headers: { "content-type": "application/json" } }));
  };
}

async function setup(mode: Parameters<typeof fakeUpstream>[1] = {}) {
  const seen: Seen = { steps: [], upstream: [] };
  const roles = new Map([[await sha256Hex(GROWTH), "growth"], [await sha256Hex(ADMIN), "admin"]]);
  // The row as the owner saved it: on, growth only, one tool listed.
  const row = { slug: "fake", label: "Fake tools", allowed: ["growth"], list: ["read_things", "x".repeat(60)] };
  let calls = 0;
  const finished: Record<string, unknown>[] = [];
  const logs: Record<string, unknown>[] = [];
  const handler = createTeamAgentHandler({
    minRefusalMs: 0,
    log: (l) => logs.push(l),
    gateway: (keyHash) => {
      const role = roles.get(keyHash);
      return Promise.resolve(role ? { ok: true, me: { role, areas: ["crm"] }, result: {} } : { auth: "invalid" });
    },
    connector: {
      resourceUrl: MCP,
      fetch: fakeUpstream(seen, mode),
      rpc: (fn, args) => {
        const role = roles.get(String(args.p_key_hash ?? ""));
        if (fn === "mingla_connector_upstreams_for") {
          seen.steps.push("upstreams_for");
          if (!role) return Promise.resolve({ auth: "invalid" });
          return Promise.resolve({
            ok: true,
            role,
            upstreams: row.allowed.includes(role)
              ? [{ slug: row.slug, label: row.label, tool_allowlist: row.list, version: "v1" }]
              : [],
          });
        }
        if (fn === "mingla_connector_call_begin") {
          seen.steps.push(`begin:${args.p_slug}:${args.p_tool}`);
          if (!role) return Promise.resolve({ auth: "invalid" });
          calls++;
          const allowed = args.p_slug === row.slug && row.allowed.includes(role) &&
            (args.p_tool === "tools/list" || row.list.includes(String(args.p_tool)));
          return Promise.resolve(
            allowed
              ? { ok: true, call_id: `call-${calls}`, mcp_url: UPSTREAM, version: "v1" }
              : { ok: false, token: "not_allowed", call_id: `call-${calls}` },
          );
        }
        if (fn === "mingla_connector_upstream_key") {
          seen.steps.push(`key:${args.p_call_id}`);
          return Promise.resolve({ ok: true, key: COMPANY_KEY });
        }
        if (fn === "mingla_connector_call_finish") {
          seen.steps.push(`finish:${args.p_call_id}:${args.p_outcome}:${args.p_http_status}`);
          finished.push(args);
          return Promise.resolve({ finished: true });
        }
        return Promise.reject(new Error("unexpected " + fn));
      },
    },
  });
  return { handler, seen, finished, logs };
}

const rpc = (key: string, method: string, params: unknown = {}) =>
  new Request(MCP, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "user-agent": "claude-test/1" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
  });

Deno.test("#4294 P-1: tools/list adds exactly the listed company tools, renamed <slug>__<tool>", async () => {
  const { handler, seen } = await setup();
  const res = await handler(rpc(GROWTH, "tools/list"));
  assertEquals(res.status, 200);
  const names: string[] = (await res.json()).result.tools.map((t: { name: string }) => t.name);
  assert(names.includes("get_started"), "the connector's own tools are still listed");
  assert(names.includes("fake__read_things"));
  assertEquals(names.includes("fake__delete_things"), false, "an unlisted tool is never offered");
  assertEquals(names.some((n) => n.startsWith("fake__xxx")), false, "a name over 64 characters is skipped");
  assertEquals(seen.steps, ["upstreams_for", "begin:fake:tools/list", "key:call-1", "finish:call-1:ok:200"]);
});

Deno.test("#4294 P-2: a role that is not allowed sees no company tools", async () => {
  const { handler, seen } = await setup();
  const names: string[] = (await (await handler(rpc(ADMIN, "tools/list"))).json()).result.tools.map((
    t: { name: string },
  ) => t.name);
  assertEquals(names.filter((n) => n.includes("__")), []);
  assertEquals(seen.upstream.length, 0, "no company server was asked");
});

Deno.test("#4294 P-3: a listed tool is called: begin, key, request, finish, in that order; the result is data", async () => {
  const { handler, seen } = await setup();
  const res = await handler(rpc(GROWTH, "tools/call", { name: "fake__read_things", arguments: { q: 1 } }));
  assertEquals(res.status, 200);
  const result = (await res.json()).result;
  assertEquals(result.isError, false);
  assertEquals(result.content[0].text, DATA_NOTE);
  assertEquals(result.content[1].text, "42 things");
  assertEquals(result.content[1]._meta, undefined, "the server's _meta is dropped");
  assertEquals(seen.steps, ["begin:fake:read_things", "key:call-1", "finish:call-1:ok:200"]);
  const call = seen.upstream.find((u) => u.method === "tools/call");
  assert(call);
  assertEquals(call.headers.authorization, `Bearer ${COMPANY_KEY}`);
  assertEquals(call.headers["mcp-session-id"], "sess-1", "the server's own session is reused");
  assertEquals(call.headers["user-agent"], undefined, "no client header is passed on");
  assertEquals(call.redirect, "manual");
});

Deno.test("#4294 P-4: a server answering with server-sent events works; its own notifications are skipped", async () => {
  const { handler } = await setup({ sse: true });
  const result = (await (await handler(rpc(GROWTH, "tools/call", { name: "fake__read_things" }))).json()).result;
  assertEquals(result.content[1].text, "42 things");
});

Deno.test("#4294 P-5: an unlisted tool is refused by the database and never reaches the server", async () => {
  const { handler, seen } = await setup();
  const res = await handler(rpc(GROWTH, "tools/call", { name: "fake__delete_things" }));
  assertEquals(res.status, 200);
  const result = (await res.json()).result;
  assertEquals(result.isError, true);
  assertEquals(result.structuredContent.error.token, "not_allowed");
  assertEquals(seen.upstream.length, 0);
  assertEquals(seen.steps, ["begin:fake:delete_things"], "one row, written by begin, refused");
});

Deno.test("#4294 P-6: the server refusing the key is a tool error, never our 401", async () => {
  const { handler, seen } = await setup({ status: 401 });
  const res = await handler(rpc(GROWTH, "tools/call", { name: "fake__read_things" }));
  assertEquals(res.status, 200);
  const body = await res.text();
  const result = JSON.parse(body).result;
  assertEquals(result.structuredContent.error.token, "upstream_key_rejected");
  assertEquals(body.includes(COMPANY_KEY.slice(0, 8)), false, "nothing the server said is passed on");
  assertEquals(seen.steps.at(-1), "finish:call-1:upstream_key_rejected:401");
});

Deno.test("#4294 P-7: a redirect is never followed", async () => {
  const { handler, seen } = await setup({ status: 302 });
  const result = (await (await handler(rpc(GROWTH, "tools/call", { name: "fake__read_things" }))).json()).result;
  assertEquals(result.structuredContent.error.token, "upstream_unavailable");
  assertEquals(seen.upstream.length, 1);
  assertEquals(seen.steps.at(-1), "finish:call-1:upstream_unavailable:302");
});

Deno.test("#4294 P-8: a lost session is opened again once", async () => {
  const { handler, seen } = await setup({ lose: true });
  const result = (await (await handler(rpc(GROWTH, "tools/call", { name: "fake__read_things" }))).json()).result;
  assertEquals(result.isError, false);
  assertEquals(seen.upstream.filter((u) => u.method === "initialize").length, 2);
});

Deno.test("#4294 P-9: every piece of the key is removed from what the server sends back", async () => {
  const { handler, logs } = await setup({ echoKey: true });
  const body = await (await handler(rpc(GROWTH, "tools/call", { name: "fake__read_things" }))).text();
  for (let i = 0; i + 8 <= COMPANY_KEY.length; i++) {
    assertEquals(body.includes(COMPANY_KEY.slice(i, i + 8)), false, `slice ${i}`);
  }
  assert(body.includes("[removed]"));
  const logged = JSON.stringify(logs);
  assertEquals(logged.includes(COMPANY_KEY.slice(0, 8)), false, "no key in any log line");
  assertEquals(scrubText("abc " + COMPANY_KEY.slice(3, 12) + " xyz", COMPANY_KEY), "abc [removed] xyz");
});
