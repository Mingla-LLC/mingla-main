// Issue #4294 — implementor happy path: Meta Ads through the Graph API.
//
// Meta's ads MCP server refuses a stored system-user token, so a company tool
// row whose address is on graph.facebook.com is served by the REST adapter in
// _shared/minglaConnectorMetaGraph.ts. A fake Graph API sits behind an
// injected fetch; nothing here reaches the network.
//
// Invariants declared here:
//   I-4294-6 The Meta Graph adapter sends the company key only as the
//            Authorization header: never in an address (a next-page address
//            carrying access_token has it taken out), and it never follows a
//            redirect or a next page off graph.facebook.com.
//   I-4294-7 Every Meta Graph tool input (ids, enums, dates, fields, limit)
//            is checked before any request; a bad input is a tool error and
//            no request is made.
//   I-4294-8 Only a row whose address host is exactly graph.facebook.com is
//            routed to the Meta Graph adapter; every other row keeps MCP over
//            HTTP unchanged.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  createConnectorProxy,
  DATA_NOTE,
  McpHttpTransport,
  UpstreamError,
  type UpstreamTarget,
  type UpstreamTransport,
} from "../../_shared/minglaConnectorProxy.ts";
import {
  createUpstreamTransport,
  graphBase,
  isMetaGraphUrl,
  META_GRAPH_TOOLS,
  MetaGraphTransport,
  safeNextUrl,
  UpstreamRouter,
} from "../../_shared/minglaConnectorMetaGraph.ts";
// MINGLA-INVARIANT: I-4294-6 | issue #4294 | The Meta Graph adapter sends the company key only as the Authorization header, never in an address, and never follows a redirect or a next page off graph.facebook.com.
// MINGLA-INVARIANT: I-4294-7 | issue #4294 | Every Meta Graph tool input is validated before any request; a bad id, enum, date or field never reaches Meta.
// MINGLA-INVARIANT: I-4294-8 | issue #4294 | Only an upstream whose host is exactly graph.facebook.com uses the Meta Graph adapter; every other upstream keeps MCP over HTTP.

const GRAPH = "https://graph.facebook.com/v23.0";
const KEY = "EAAGfake4294systemUserToken0123456789abcdef";
const target = (url = GRAPH): UpstreamTarget => ({ slug: "metaads", url, key: KEY, version: "1" });

interface Seen {
  url: string;
  init: RequestInit;
}

type Reply = (url: URL) => Response;

function fakeGraph(seen: Seen[], reply: Reply) {
  return (url: string, init: RequestInit): Promise<Response> => {
    seen.push({ url, init });
    return Promise.resolve(reply(new URL(url)));
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** An address with a user name, built at run time (no such address is written in this file). */
function withUserName(address: string): string {
  const u = new URL(address);
  u.username = "someone";
  return u.toString();
}

const textOf = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;

Deno.test("I-4294-6: the key is only in the Authorization header, redirect is manual, every request is a GET", async () => {
  const seen: Seen[] = [];
  const t = new MetaGraphTransport(fakeGraph(seen, () =>
    json({
      data: [{ id: "120001", name: "Spring launch", status: "ACTIVE" }],
      paging: { cursors: { after: "QVFI" } },
    })));
  const r = await t.callTool(target(), "list_campaigns", {
    account_id: "act_1234567890",
    status: ["ACTIVE"],
    limit: 10,
  });
  assertEquals(r.isError, false);
  assertEquals(seen.length, 1);
  const u = new URL(seen[0].url);
  assertEquals(u.origin + u.pathname, `${GRAPH}/act_1234567890/campaigns`);
  assertEquals(u.searchParams.get("limit"), "10");
  assertEquals(u.searchParams.get("effective_status"), '["ACTIVE"]');
  assert(!seen[0].url.includes(KEY), "the key must never be in the address");
  assert(!u.searchParams.has("access_token"));
  const h = new Headers(seen[0].init.headers);
  assertEquals(h.get("authorization"), `Bearer ${KEY}`);
  assertEquals(seen[0].init.redirect, "manual");
  assertEquals(seen[0].init.method, "GET");
  assertEquals(seen[0].init.body, undefined);
  const out = JSON.parse(textOf(r));
  assertEquals(out, { count: 1, more: false, data: [{ id: "120001", name: "Spring launch", status: "ACTIVE" }] });
});

Deno.test("I-4294-6: a next page is followed with its access_token removed, at most three pages, never off graph.facebook.com", async () => {
  const seen: Seen[] = [];
  let page = 0;
  const t = new MetaGraphTransport(fakeGraph(seen, () => {
    page++;
    return json({
      data: [{ id: String(page) }],
      paging: { next: `${GRAPH}/act_1/ads?after=c${page}&access_token=${KEY}&limit=1` },
    });
  }));
  const r = await t.callTool(target(), "list_ads", { account_id: "1", limit: 50 });
  assertEquals(seen.length, 3, "at most MAX_GRAPH_PAGES requests");
  for (const s of seen) {
    assert(!s.url.includes(KEY), `key leaked into ${s.url}`);
    assert(!s.url.includes("access_token"));
    assertEquals(new Headers(s.init.headers).get("authorization"), `Bearer ${KEY}`);
  }
  assertEquals(new URL(seen[1].url).searchParams.get("after"), "c1");
  const out = JSON.parse(textOf(r));
  assertEquals(out.count, 3);
  assertEquals(out.more, true);

  // Off-host, other-version, http, port and user-name next pages are never followed.
  for (
    const next of [
      "https://graph.facebook.com.evil.example/v23.0/act_1/ads?after=x",
      "https://evil.example/v23.0/act_1/ads?after=x",
      "http://graph.facebook.com/v23.0/act_1/ads?after=x",
      "https://graph.facebook.com:8443/v23.0/act_1/ads?after=x",
      "https://graph.facebook.com/v1.0/act_1/ads?after=x",
      withUserName(`${GRAPH}/act_1/ads?after=x`),
    ]
  ) {
    const s2: Seen[] = [];
    const t2 = new MetaGraphTransport(fakeGraph(s2, () => json({ data: [{ id: "1" }], paging: { next } })));
    const r2 = await t2.callTool(target(), "list_ads", { account_id: "1", limit: 50 });
    assertEquals(s2.length, 1, `followed ${next}`);
    assertEquals(JSON.parse(textOf(r2)).more, false);
    assertEquals(safeNextUrl(next, GRAPH), null);
  }
});

Deno.test("I-4294-6: a redirect is never followed", async () => {
  for (const status of [301, 302, 307, 308]) {
    const seen: Seen[] = [];
    const t = new MetaGraphTransport(
      fakeGraph(seen, () => new Response(null, { status, headers: { location: "https://elsewhere.example/" } })),
    );
    const err = await assertRejects(() => t.callTool(target(), "list_ad_accounts", {}), UpstreamError);
    assertEquals(err.token, "upstream_unavailable");
    assertEquals(seen.length, 1);
  }
});

Deno.test("the key is scrubbed from every answer, and from a Graph error message", async () => {
  const t = new MetaGraphTransport(
    fakeGraph([], () => json({ data: [{ id: "1", name: `echo ${KEY} and ${encodeURIComponent(KEY)}` }] })),
  );
  const r = await t.callTool(target(), "list_ad_accounts", {});
  assert(!textOf(r).includes(KEY.slice(0, 12)));
  assert(textOf(r).includes("[removed]"));

  const t2 = new MetaGraphTransport(
    fakeGraph(
      [],
      () =>
        json(
          { error: { message: `Unsupported get request for ${KEY}`, type: "GraphMethodException", code: 100 } },
          400,
        ),
    ),
  );
  const err = await assertRejects(
    () => t2.callTool(target(), "list_campaigns", { account_id: "act_9" }),
    UpstreamError,
  );
  assertEquals(err.token, "upstream_unavailable");
  assert(!err.upstreamMessage.includes(KEY.slice(0, 12)));
  assert(err.upstreamMessage.startsWith("Unsupported get request for "));
});

Deno.test("I-4294-7: bad ids, enums, dates, fields and limits are refused before any request", async () => {
  const seen: Seen[] = [];
  const t = new MetaGraphTransport(fakeGraph(seen, () => json({ data: [] })));
  const bad: [string, Record<string, unknown>][] = [
    ["list_campaigns", {}],
    ["list_campaigns", { account_id: "act_12/../me" }],
    ["list_campaigns", { account_id: "12?fields=access_token" }],
    ["list_campaigns", { account_id: 1234 }],
    ["list_adsets", { account_id: "act_1", status: ["RUNNING"] }],
    ["list_adsets", { account_id: "act_1", status: "ACTIVE" }],
    ["list_ads", { account_id: "act_1", limit: 101 }],
    ["list_ads", { account_id: "act_1", limit: 0 }],
    ["list_ads", { account_id: "act_1", limit: 2.5 }],
    ["list_ads", { account_id: "act_1", extra: true }],
    ["list_creatives", { account_id: "abc" }],
    ["list_ad_accounts", { business_id: "act_1" }],
    ["get_account_insights", { account_id: "act_1", date_preset: "forever" }],
    ["get_account_insights", { account_id: "act_1", level: "everything" }],
    ["get_account_insights", { account_id: "act_1", fields: ["spend", "access_token"] }],
    ["get_account_insights", { account_id: "act_1", since: "2026-02-30", until: "2026-03-01" }],
    ["get_account_insights", { account_id: "act_1", since: "2026-03-02", until: "2026-03-01" }],
    ["get_account_insights", { account_id: "act_1", since: "2026-03-01" }],
    ["get_account_insights", { account_id: "act_1", date_preset: "last_7d", since: "2026-03-01", until: "2026-03-02" }],
    ["get_account_insights", { account_id: "act_1", time_increment: "hourly" }],
    ["get_insights", { object_id: "me" }],
    ["get_insights", { object_id: "120001/insights" }],
    ["no_such_tool", {}],
  ];
  for (const [name, args] of bad) {
    const r = await t.callTool(target(), name, args);
    assertEquals(r.isError, true, `${name} ${JSON.stringify(args)} was accepted`);
    assert(textOf(r).startsWith("invalid_argument: "));
  }
  assertEquals(seen.length, 0, "no request may be made for a bad input");
});

Deno.test("insights: date range, level, fields and plain account digits become one safe GET", async () => {
  const seen: Seen[] = [];
  const t = new MetaGraphTransport(fakeGraph(seen, () => json({ data: [{ spend: "12.34" }] })));
  const r = await t.callTool(target(), "get_account_insights", {
    account_id: "1234567890",
    since: "2026-10-01",
    until: "2026-10-31",
    level: "campaign",
    fields: ["spend", "actions", "cost_per_action_type"],
    time_increment: "7",
  });
  assertEquals(r.isError, false);
  const u = new URL(seen[0].url);
  assertEquals(u.pathname, "/v23.0/act_1234567890/insights");
  assertEquals(u.searchParams.get("time_range"), '{"since":"2026-10-01","until":"2026-10-31"}');
  assertEquals(u.searchParams.get("level"), "campaign");
  assertEquals(
    u.searchParams.get("fields"),
    "account_id,campaign_id,campaign_name,date_start,date_stop,spend,actions,cost_per_action_type",
  );
  assertEquals(u.searchParams.get("time_increment"), "7");
  assertEquals(u.searchParams.has("date_preset"), false);

  await t.callTool(target(), "get_insights", { object_id: "120001" });
  const u2 = new URL(seen[1].url);
  assertEquals(u2.pathname, "/v23.0/120001/insights");
  assertEquals(u2.searchParams.get("date_preset"), "last_30d");
  assertEquals(u2.searchParams.get("level"), "account");

  await t.callTool(target(), "list_ad_accounts", { business_id: "555" });
  assertEquals(new URL(seen[2].url).pathname, "/v23.0/555/owned_ad_accounts");
  await t.callTool(target(), "list_ad_accounts", {});
  assertEquals(new URL(seen[3].url).pathname, "/v23.0/me/adaccounts");
  await t.callTool(target(), "list_creatives", { account_id: "act_7", limit: 5 });
  assertEquals(new URL(seen[4].url).pathname, "/v23.0/act_7/adcreatives");
});

Deno.test("errors map like MCP over HTTP; an auth error never carries Meta's words", async () => {
  const cases: [Response | (() => Promise<Response>), string][] = [
    [new Response("no", { status: 401 }), "upstream_key_rejected"],
    [new Response("no", { status: 403 }), "upstream_key_rejected"],
    [
      json(
        { error: { message: "Error validating access token: secret detail", type: "OAuthException", code: 190 } },
        400,
      ),
      "upstream_key_rejected",
    ],
    [
      json({ error: { message: "(#10) needs ads_read", type: "OAuthException", code: 10 } }, 400),
      "upstream_key_rejected",
    ],
    [
      json({ error: { message: "(#200) permission", type: "OAuthException", code: 200 } }, 400),
      "upstream_key_rejected",
    ],
    [json({ error: { message: "boom", code: 2 } }, 500), "upstream_unavailable"],
    [new Response("<html>bad gateway</html>", { status: 502 }), "upstream_unavailable"],
    [new Response("not json", { status: 200 }), "upstream_unavailable"],
    [new Response("x".repeat(2048), { status: 200 }), "upstream_too_large"],
  ];
  for (const [res, token] of cases) {
    const t = new MetaGraphTransport(
      () => (typeof res === "function" ? res() : Promise.resolve(res)),
      { maxBytes: 1024 },
    );
    const err = await assertRejects(() => t.callTool(target(), "list_ad_accounts", {}), UpstreamError);
    assertEquals(err.token, token);
    if (token === "upstream_key_rejected") assertEquals(err.upstreamMessage, "");
  }
  const slow = new MetaGraphTransport(
    (_u, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    { callTimeoutMs: 20 },
  );
  const err = await assertRejects(() => slow.callTool(target(), "list_ad_accounts", {}), UpstreamError);
  assertEquals(err.token, "upstream_timeout");
});

Deno.test("I-4294-8: the router sends only graph.facebook.com rows to the Meta Graph adapter", async () => {
  const used: string[] = [];
  const fake = (label: string): UpstreamTransport => ({
    listTools: () => {
      used.push(label);
      return Promise.resolve([]);
    },
    callTool: () => {
      used.push(label);
      return Promise.resolve({ content: [], isError: false });
    },
  });
  const router = new UpstreamRouter(fake("mcp"), fake("meta"));
  const expect: [string, string][] = [
    ["https://graph.facebook.com/v23.0", "meta"],
    ["https://graph.facebook.com", "meta"],
    ["https://graph.facebook.com/v99.9/extra", "meta"],
    ["https://mcp.facebook.com/ads", "mcp"],
    ["https://graph.facebook.com.evil.example/v23.0", "mcp"],
    ["https://xgraph.facebook.com/v23.0", "mcp"],
    ["https://evil-graph.facebook.com/v23.0", "mcp"],
    ["https://mcp.posthog.com/mcp", "mcp"],
    ["http://graph.facebook.com/v23.0", "mcp"],
  ];
  for (const [url, label] of expect) {
    used.length = 0;
    await router.callTool(target(url), "list_ad_accounts", {});
    await router.listTools(target(url));
    assertEquals(used, [label, label], url);
    assertEquals(isMetaGraphUrl(url), label === "meta", url);
  }
  // A graph.facebook.com row with a path other than a version is refused, not sent to MCP.
  assertEquals(graphBase("https://graph.facebook.com/v99.9/extra"), null);
  assertEquals(graphBase("https://graph.facebook.com"), "https://graph.facebook.com/v23.0");
  const meta = new MetaGraphTransport(() => Promise.reject(new Error("no request expected")));
  const err = await assertRejects(
    () => meta.callTool(target("https://graph.facebook.com/me/adaccounts"), "list_ad_accounts", {}),
    UpstreamError,
  );
  assertEquals(err.token, "upstream_unavailable");
});

Deno.test("I-4294-8: MCP rows behind the default transport still speak MCP over HTTP", async () => {
  const methods: string[] = [];
  const fetchFn = (_url: string, init: RequestInit): Promise<Response> => {
    assertEquals(init.method, "POST");
    assertEquals(init.redirect, "manual");
    const msg = JSON.parse(String(init.body));
    methods.push(msg.method);
    if (msg.method === "initialize") {
      return Promise.resolve(json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } }));
    }
    if (msg.method === "notifications/initialized") return Promise.resolve(new Response(null, { status: 202 }));
    return Promise.resolve(json({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "query" }] } }));
  };
  const tools = await createUpstreamTransport(fetchFn).listTools(target("https://mcp.posthog.com/mcp"));
  assertEquals(tools.map((t) => t.name), ["query"]);
  assertEquals(methods, ["initialize", "notifications/initialized", "tools/list"]);
  const viaRouter = [...methods];
  const direct: string[] = [];
  await new McpHttpTransport((u, i) => {
    direct.push(JSON.parse(String(i.body)).method);
    return fetchFn(u, i);
  }).listTools(target("https://mcp.posthog.com/mcp"));
  assertEquals(direct, viaRouter);
});

Deno.test("end to end: the proxy offers allowed Meta tools as metaads__<tool> and answers a call", async () => {
  const seen: Seen[] = [];
  const graphFetch = fakeGraph(seen, () => json({ data: [{ id: "act_1", name: `Mingla ${KEY}` }] }));
  const rpc = (fn: string): Promise<unknown> => {
    if (fn === "mingla_connector_upstreams_for") {
      return Promise.resolve({
        ok: true,
        role: "owner",
        upstreams: [{
          slug: "metaads",
          label: "Meta Ads",
          version: "1",
          tool_allowlist: ["list_ad_accounts", "list_ads"],
        }],
      });
    }
    if (fn === "mingla_connector_call_begin") {
      return Promise.resolve({ ok: true, call_id: crypto.randomUUID(), mcp_url: GRAPH, version: "1" });
    }
    if (fn === "mingla_connector_upstream_key") return Promise.resolve({ ok: true, key: KEY });
    return Promise.resolve({ ok: true });
  };
  const proxy = createConnectorProxy({ rpc, transport: createUpstreamTransport(graphFetch) });
  const listed = await proxy.listFor("hash", "claude_code");
  assertEquals(listed.map((l) => l.name), ["metaads__list_ad_accounts", "metaads__list_ads"]);
  assertEquals(seen.length, 0, "listing Meta tools makes no request");
  const call = await proxy.call("hash", "metaads__list_ad_accounts", {}, "claude_code");
  assert(call.kind === "answer");
  assertEquals(call.outcome, "ok");
  const texts = call.result.content.map((c) => (c as { text: string }).text);
  assertEquals(texts[0], DATA_NOTE);
  assert(!texts.join("").includes(KEY.slice(0, 12)));
  assertEquals(seen.length, 1);
  assertEquals(META_GRAPH_TOOLS.every((t) => (t.tool.annotations as { readOnlyHint: boolean }).readOnlyHint), true);
});
