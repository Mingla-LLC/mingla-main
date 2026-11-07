// Issue #4294 — tester adversarial: the Meta Ads Graph API adapter.
//
// Attacks the angles the implementor's happy path does not: look-alike hosts
// never receive the key at all, hostile next-page addresses (method override,
// letter-case token names, encoded hosts, backslash and @ tricks), hostile
// inputs (unicode digits, prototype keys, fake dates, injected fields), a
// slow body, a time budget shared across pages, concurrent calls with
// different keys, Graph error bodies that echo the key, and the proxy's
// begin / key / finish call log around every Meta outcome.
//
// Every fetch is injected; nothing here reaches the network. No address with
// a user name is written literally (it is built at run time).
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  createConnectorProxy,
  McpHttpTransport,
  UpstreamError,
  type UpstreamTarget,
} from "../../_shared/minglaConnectorProxy.ts";
import {
  createUpstreamTransport,
  graphBase,
  isMetaGraphUrl,
  MAX_GRAPH_PAGES,
  MetaGraphTransport,
  safeNextUrl,
} from "../../_shared/minglaConnectorMetaGraph.ts";

const GRAPH = "https://graph.facebook.com/v23.0";
const KEY = "EAAGtester4294fakeSystemUserKey9876543210zyxw";
const AT = String.fromCharCode(64);
const target = (url = GRAPH, key = KEY): UpstreamTarget => ({ slug: "metaads", url, key, version: "1" });

interface Seen {
  url: string;
  init: RequestInit;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const textOf = (r: { content: unknown[] }): string => (r.content[0] as { text: string }).text;

function recorder(seen: Seen[], reply: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  return (url: string, init: RequestInit): Promise<Response> => {
    seen.push({ url, init });
    return Promise.resolve(reply(new URL(url), init));
  };
}

Deno.test("T-1: look-alike hosts never reach the Graph adapter; malformed ones get no request at all", async () => {
  // Malformed look-alikes: the router hands them to MCP over HTTP, which
  // refuses the address before any request, so the key goes nowhere.
  const refused = [
    "https://GRAPH.facebook.com/v23.0",
    "https://graph.facebook.com./v23.0",
    "https://graph.facebook.com:8443/v23.0",
    "https://157.240.1.1/v23.0",
    "https://u" + AT + "graph.facebook.com/v23.0",
    "https://graph.facebook.com" + AT + "evil.example/v23.0",
    "http://graph.facebook.com/v23.0",
  ];
  for (const url of refused) {
    assertEquals(isMetaGraphUrl(url), false, url);
    assertEquals(graphBase(url), null, url);
    const seen: Seen[] = [];
    const t = createUpstreamTransport(recorder(seen, () => json({ data: [] })));
    await assertRejects(() => t.callTool(target(url), "list_ad_accounts", {}), UpstreamError);
    await assertRejects(() => t.listTools(target(url)), UpstreamError);
    assertEquals(seen.length, 0, `a request was made for ${url}`);
  }
  // Well-formed other hosts (punycode, a suffix trick) are ordinary MCP rows
  // an owner typed in: they get an MCP POST, never a Graph GET.
  for (const url of ["https://xn--grph-tqa.facebook.com/v23.0", "https://graph.facebook.com.evil.example/v23.0"]) {
    assertEquals(isMetaGraphUrl(url), false, url);
    const seen: Seen[] = [];
    const t = createUpstreamTransport(recorder(seen, () => new Response("no", { status: 500 })));
    await assertRejects(() => t.callTool(target(url), "list_ad_accounts", {}), UpstreamError);
    assert(seen.length >= 1);
    for (const s of seen) assertEquals(s.init.method, "POST", url);
  }
  // Port 443 written out is the same host and stays on Graph, with the port dropped.
  assertEquals(graphBase("https://graph.facebook.com:443/v23.0"), GRAPH);
});

Deno.test("T-2: a next page never carries a method override, and token names are dropped in any case", async () => {
  // Fails on revert of the safeNextUrl hardening: a GET with method=delete is
  // a delete on Graph, which would break the read-only promise.
  for (const m of ["method=delete", "method=post", "METHOD=DELETE", "Method=post"]) {
    const out = safeNextUrl(`${GRAPH}/act_1/campaigns?after=c1&${m}`, GRAPH);
    assert(out !== null);
    const params = [...new URL(out).searchParams.keys()].map((k) => k.toLowerCase());
    assert(!params.includes("method"), `method kept in ${out}`);
    assertEquals(new URL(out).searchParams.get("after"), "c1");
  }
  for (const k of ["Access_Token", "ACCESS_TOKEN", "access%5Ftoken", "AppSecret_Proof"]) {
    const out = safeNextUrl(`${GRAPH}/act_1/ads?${k}=${KEY}&after=z`, GRAPH);
    assert(out !== null);
    assert(!out.includes(KEY), `token kept in ${out}`);
  }
  // Followed end to end: the second request has no method and no token.
  const seen: Seen[] = [];
  let n = 0;
  const t = new MetaGraphTransport(recorder(seen, () => {
    n++;
    return json({
      data: [{ id: String(n) }],
      paging: n === 1 ? { next: `${GRAPH}/act_1/ads?after=c1&method=delete&Access_Token=${KEY}` } : {},
    });
  }));
  await t.callTool(target(), "list_ads", { account_id: "act_1", limit: 10 });
  assertEquals(seen.length, 2);
  for (const s of seen) {
    assertEquals(s.init.method, "GET");
    assertEquals(s.init.redirect, "manual");
    assert(!s.url.toLowerCase().includes("method="), s.url);
    assert(!s.url.includes(KEY), s.url);
  }
});

Deno.test("T-3: hostile next-page addresses are never followed", () => {
  const hostile = [
    "https://graph.facebook.com%2eevil.example/v23.0/x",
    "https://graph.facebook.com\\" + AT + "evil.example/v23.0/x",
    "https://graph.facebook.com" + AT + "evil.example/v23.0/x",
    "https://evil.example#" + AT + "graph.facebook.com/v23.0/x",
    "https://graph.facebook.com/v23.0/../v22.0/x",
    "https://graph.facebook.com/v23.0/%2e%2e/v22.0/x",
    "https://graph.facebook.com/v23.0x/y",
    "https://graph.facebook.com/v23.0",
    "https://graph.facebook.com./v23.0/x",
    "//graph.facebook.com/v23.0/x",
    "/v23.0/x",
    "javascript:alert(1)",
    `${GRAPH}/x?` + "a".repeat(5000),
    42,
    null,
    { href: `${GRAPH}/x` },
  ];
  for (const next of hostile) assertEquals(safeNextUrl(next, GRAPH), null, String(next).slice(0, 80));
  // Letter case in scheme and host is the same address once read.
  assertEquals(safeNextUrl("HTTPS://GRAPH.FACEBOOK.COM/v23.0/x", GRAPH), `${GRAPH}/x`);
});

Deno.test("T-4: hostile inputs are refused before any request", async () => {
  const seen: Seen[] = [];
  const t = new MetaGraphTransport(recorder(seen, () => json({ data: [] })));
  const proto = JSON.parse('{"account_id":"act_1","__proto__":{"limit":5}}');
  const ctor = JSON.parse('{"account_id":"act_1","constructor":{"x":1}}');
  const bad: [string, unknown][] = [
    ["list_campaigns", { account_id: "١٢٣" }], // Arabic-Indic digits
    ["list_campaigns", { account_id: "１２" }], // full-width digits
    ["list_campaigns", { account_id: "act_1\n" }],
    ["list_campaigns", { account_id: " act_1" }],
    ["list_campaigns", { account_id: "act_" }],
    ["list_campaigns", { account_id: "1".repeat(26) }],
    ["list_campaigns", { account_id: ["act_1"] }],
    ["list_campaigns", { account_id: "1?access_token=" }],
    ["list_campaigns", { account_id: "act_1/../../me" }],
    ["list_campaigns", { account_id: "act_1%2F..%2Fme" }],
    ["list_campaigns", proto],
    ["list_campaigns", ctor],
    ["list_ads", { account_id: "act_1", limit: -1 }],
    ["list_ads", { account_id: "act_1", limit: Infinity }],
    ["list_ads", { account_id: "act_1", limit: NaN }],
    ["list_ads", { account_id: "act_1", limit: "50" }],
    ["list_ads", { account_id: "act_1", limit: 1e9 }],
    ["list_ads", { account_id: "act_1", limit: true }],
    ["list_adsets", { account_id: "act_1", status: [] }],
    ["list_adsets", { account_id: "act_1", status: ["active"] }],
    ["list_adsets", { account_id: "act_1", status: ['ACTIVE"]'] }],
    ["get_insights", { object_id: "me" }],
    ["get_insights", { object_id: "120001", since: "2026-02-30", until: "2026-03-01" }],
    ["get_insights", { object_id: "120001", since: "2026-13-01", until: "2026-13-02" }],
    ["get_insights", { object_id: "120001", since: "2026-1-01", until: "2026-01-02" }],
    ["get_insights", { object_id: "120001", since: "2026-03-02", until: "2026-03-01" }],
    ["get_insights", { object_id: "120001", since: "2026-03-01" }],
    ["get_insights", { object_id: "120001", since: "2026-03-01", until: "2026-03-02", date_preset: "today" }],
    ["get_insights", { object_id: "120001", fields: ["spend,adcreatives{object_story_spec}"] }],
    ["get_insights", { object_id: "120001", fields: ["adcreatives{object_story_spec}"] }],
    ["get_insights", { object_id: "120001", fields: "spend,impressions" }],
    ["get_insights", { object_id: "120001", fields: [] }],
    ["get_insights", { object_id: "120001", time_increment: 1 }],
    ["get_insights", { object_id: "120001", level: "ACCOUNT" }],
    ["get_account_insights", { account_id: "act_1", breakdowns: ["age"] }],
    ["list_ad_accounts", { business_id: "12/owned_ad_accounts" }],
    ["list_ad_accounts", { business_id: 123 }],
    ["create_campaign", { account_id: "act_1" }],
    ["__proto__", {}],
    ["constructor", {}],
  ];
  for (const [tool, args] of bad) {
    const r = await t.callTool(target(), tool, args as Record<string, unknown>);
    assertEquals(r.isError, true, `${tool} ${JSON.stringify(args)}`);
    assert(textOf(r).startsWith("invalid_argument: "), textOf(r));
    assert(!textOf(r).includes(KEY));
  }
  assertEquals(seen.length, 0, "a bad input reached Meta");
  // Prototype keys did not leak into later objects.
  assertEquals(({} as Record<string, unknown>).limit, undefined);
  // A non-object argument is treated as no arguments, not a crash.
  const r = await t.callTool(target(), "list_campaigns", null as unknown as Record<string, unknown>);
  assertEquals(r.isError, true);
  assertEquals(seen.length, 0);
});

Deno.test("T-5: the time budget covers every page together, and a slow body times out", async () => {
  // Each page answers after 30 ms; three pages cannot fit in 50 ms.
  const seen: Seen[] = [];
  let n = 0;
  const paged = new MetaGraphTransport(
    (url, init) => {
      seen.push({ url, init });
      n++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => resolve(json({ data: [{ id: String(n) }], paging: { next: `${GRAPH}/act_1/ads?after=c${n}` } })),
          30,
        );
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    },
    { callTimeoutMs: 50 },
  );
  const err = await assertRejects(
    () => paged.callTool(target(), "list_ads", { account_id: "act_1", limit: 50 }),
    UpstreamError,
  );
  assertEquals(err.token, "upstream_timeout");
  assert(seen.length < MAX_GRAPH_PAGES, `budget was per page: ${seen.length} requests`);

  // Headers arrive, then the body stalls; the abort errors the body the way
  // Deno's fetch does.
  const enc = new TextEncoder();
  const slowBody = new MetaGraphTransport(
    (_url, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode('{"data":['));
          init.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
        },
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    },
    { callTimeoutMs: 30 },
  );
  const err2 = await assertRejects(() => slowBody.callTool(target(), "list_ad_accounts", {}), UpstreamError);
  assertEquals(err2.token, "upstream_timeout");
});

Deno.test("T-6: Graph errors — auth codes hide Meta's words, others pass a scrubbed message of at most 300 characters", async () => {
  const run = async (res: Response) => {
    const t = new MetaGraphTransport(() => Promise.resolve(res));
    return await assertRejects(() => t.callTool(target(), "list_ad_accounts", {}), UpstreamError);
  };
  // Auth codes, as numbers or strings, at 400 and even at 200.
  for (const [code, status] of [[190, 400], ["190", 400], [102, 400], [10, 400], [200, 400], [299, 400], [190, 200]]) {
    const e = await run(json({ error: { message: `Bad token ${KEY}`, code } }, status as number));
    assertEquals(e.token, "upstream_key_rejected", `code ${code}`);
    assertEquals(e.upstreamMessage, "");
  }
  // Neighbours of the auth codes are not auth errors.
  for (const code of [100, 300, 1, 2500, 4, 17, 613]) {
    const e = await run(json({ error: { message: `(#${code}) something`, code } }, 400));
    assertEquals(e.token, "upstream_unavailable", `code ${code}`);
    assertEquals(e.upstreamMessage, `(#${code}) something`);
  }
  // The key echoed near the 300-character cut, encoded, or in base64 is scrubbed first, then cut.
  const long = "x".repeat(285) + KEY + " " + encodeURIComponent(KEY) + " " + btoa(KEY) + "y".repeat(400);
  const e = await run(json({ error: { message: long, code: 100 } }, 400));
  assertEquals(e.token, "upstream_unavailable");
  assert(e.upstreamMessage.length <= 300, `message is ${e.upstreamMessage.length} long`);
  for (let i = 0; i + 8 <= KEY.length; i++) {
    assert(!e.upstreamMessage.includes(KEY.slice(i, i + 8)), `a piece of the key survived at ${i}`);
  }
  // A message that is not a string, a non-JSON 4xx and a network error carry no words.
  assertEquals((await run(json({ error: { message: { k: KEY }, code: 100 } }, 400))).upstreamMessage, "");
  assertEquals((await run(new Response(`<html>${KEY}</html>`, { status: 400 }))).upstreamMessage, "");
  const net = new MetaGraphTransport(() => Promise.reject(new Error(`connect failed ${KEY}`)));
  const e3 = await assertRejects(() => net.callTool(target(), "list_ad_accounts", {}), UpstreamError);
  assertEquals(e3.token, "upstream_unavailable");
  assertEquals(e3.upstreamMessage, "");
  assert(!e3.message.includes(KEY));
  // A 3xx of any kind is never followed and its Location is never read.
  for (const status of [300, 303, 304]) {
    const seen: Seen[] = [];
    const t = new MetaGraphTransport(
      recorder(seen, () => new Response(null, { status, headers: { location: `${GRAPH}/me?access_token=x` } })),
    );
    const r = await assertRejects(() => t.callTool(target(), "list_ad_accounts", {}), UpstreamError);
    assertEquals(r.token, "upstream_unavailable");
    assertEquals(seen.length, 1);
  }
});

Deno.test("T-7: concurrent calls on one shared transport never mix keys", async () => {
  const seen: Seen[] = [];
  const t = createUpstreamTransport(recorder(seen, async () => {
    await new Promise((r) => setTimeout(r, 5));
    return json({ data: [{ id: "1" }], paging: { next: `${GRAPH}/act_1/ads?after=a` } });
  }));
  const keys = Array.from({ length: 6 }, (_, i) => `EAAGconcurrent${i}tester4294keyABCDEFGH`);
  await Promise.all(keys.map((k) => t.callTool(target(GRAPH, k), "list_ads", { account_id: "act_1", limit: 3 })));
  assertEquals(seen.length, keys.length * 3);
  const perKey = new Map<string, number>();
  for (const s of seen) {
    const auth = new Headers(s.init.headers).get("authorization") ?? "";
    const k = auth.replace(/^Bearer /, "");
    assert(keys.includes(k), "an unknown key was sent");
    perKey.set(k, (perKey.get(k) ?? 0) + 1);
    for (const other of keys) assert(!s.url.includes(other));
  }
  for (const k of keys) assertEquals(perKey.get(k), 3);
});

Deno.test("T-8: a huge page is refused, and many rows are cut to the limit", async () => {
  const big = new MetaGraphTransport(
    () => Promise.resolve(json({ data: [{ id: "1", name: "z".repeat(4096) }] })),
    { maxBytes: 2048 },
  );
  const e = await assertRejects(() => big.callTool(target(), "list_ad_accounts", {}), UpstreamError);
  assertEquals(e.token, "upstream_too_large");

  const seen: Seen[] = [];
  const many = new MetaGraphTransport(recorder(seen, () =>
    json({
      data: Array.from({ length: 500 }, (_, i) => ({ id: String(i) })),
      paging: { next: `${GRAPH}/act_1/ads?after=x` },
    })));
  const r = await many.callTool(target(), "list_ads", { account_id: "act_1", limit: 7 });
  const out = JSON.parse(textOf(r));
  assertEquals(out.count, 7);
  assertEquals(out.data.length, 7);
  assertEquals(out.more, true);
  assertEquals(seen.length, 1, "no further page once the limit is met");
  assertEquals(new URL(seen[0].url).searchParams.get("limit"), "7");
});

Deno.test("T-9: through the proxy, every Meta outcome is logged with begin, key and finish; refusals never reach Meta", async () => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let reply: Response = json({ data: [] });
  const seen: Seen[] = [];
  const rpc = (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    calls.push({ fn, args });
    if (fn === "mingla_connector_call_begin") {
      if (args.p_tool !== "list_campaigns") {
        return Promise.resolve({ ok: false, token: "not_allowed", call_id: "x" });
      }
      return Promise.resolve({ ok: true, call_id: "call-1", mcp_url: GRAPH, version: "1" });
    }
    if (fn === "mingla_connector_upstream_key") return Promise.resolve({ ok: true, key: KEY });
    return Promise.resolve({ ok: true });
  };
  const proxy = createConnectorProxy({
    rpc,
    transport: createUpstreamTransport(recorder(seen, () => reply.clone())),
    now: () => 0,
  });
  const fns = () => calls.map((c) => c.fn);
  const finish = () => calls.find((c) => c.fn === "mingla_connector_call_finish")?.args ?? {};

  // Not on the allow-list: refused by the database, no key, no request.
  calls.length = 0;
  const refused = await proxy.call("h", "metaads__create_campaign", { account_id: "act_1" }, "claude_code");
  assert(refused.kind === "answer");
  assertEquals(refused.outcome, "not_allowed");
  assert(!fns().includes("mingla_connector_upstream_key"));
  assertEquals(seen.length, 0);

  // A bad input: logged, finished as a tool error, no request.
  calls.length = 0;
  const bad = await proxy.call("h", "metaads__list_campaigns", { account_id: "act_1/../me" }, "claude_code");
  assert(bad.kind === "answer");
  assertEquals(bad.outcome, "upstream_tool_error");
  assertEquals(fns(), ["mingla_connector_call_begin", "mingla_connector_upstream_key", "mingla_connector_call_finish"]);
  assertEquals(seen.length, 0);

  // An expired token: finished as upstream_key_rejected; the agent never sees Meta's words.
  calls.length = 0;
  reply = json({ error: { message: `Session has expired ${KEY}`, code: 190 } }, 400);
  const rejected = await proxy.call("h", "metaads__list_campaigns", { account_id: "act_1" }, "claude_code");
  assert(rejected.kind === "answer");
  assertEquals(rejected.outcome, "upstream_key_rejected");
  assertEquals(fns(), ["mingla_connector_call_begin", "mingla_connector_upstream_key", "mingla_connector_call_finish"]);
  assertEquals(Object.values(finish()).includes("upstream_key_rejected"), true);
  const rejectedText = JSON.stringify(rejected.result);
  assert(!rejectedText.includes("Session has expired"));
  assert(!rejectedText.includes(KEY.slice(0, 12)));

  // Another 4xx: Meta's scrubbed words reach the agent, and the row is finished.
  calls.length = 0;
  reply = json({ error: { message: `(#100) Unknown path for ${KEY}`, code: 100 } }, 400);
  const other = await proxy.call("h", "metaads__list_campaigns", { account_id: "act_1" }, "claude_code");
  assert(other.kind === "answer");
  assertEquals(other.outcome, "upstream_unavailable");
  const otherText = JSON.stringify(other.result);
  assert(otherText.includes("(#100) Unknown path for [removed]"), otherText);
  assert(!otherText.includes(KEY.slice(0, 12)));
  assertEquals(fns().at(-1), "mingla_connector_call_finish");

  // No database row ever holds the key.
  assert(!JSON.stringify(calls.map((c) => c.args)).includes(KEY.slice(0, 12)));
});

Deno.test("T-10: an MCP row behind the router is byte-for-byte what McpHttpTransport sends", async () => {
  const record = (into: string[]) => (url: string, init: RequestInit): Promise<Response> => {
    const msg = JSON.parse(String(init.body));
    const h = new Headers(init.headers);
    into.push(`${init.method} ${url} ${h.get("authorization")} ${init.redirect} ${String(init.body)}`);
    if (msg.method === "initialize") {
      return Promise.resolve(json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } }));
    }
    if (msg.method === "notifications/initialized") return Promise.resolve(new Response(null, { status: 202 }));
    return Promise.resolve(
      json({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok" }], isError: false } }),
    );
  };
  const routed: string[] = [];
  const direct: string[] = [];
  const t = target("https://mcp.posthog.com/mcp", "phx_tester4294fakePosthogKey");
  const a = await createUpstreamTransport(record(routed)).callTool(t, "query", { q: "1" });
  const b = await new McpHttpTransport(record(direct)).callTool(t, "query", { q: "1" });
  assertEquals(a, b);
  assertEquals(routed, direct);
  assert(routed.every((line) => line.startsWith("POST https://mcp.posthog.com/mcp ")));
});

Deno.test("T-11: a next page that is refused still reports more, so the agent never takes a partial list as whole", async () => {
  const refusedNext = [
    "https://evil.example/v23.0/act_1/ads?after=x",
    "https://graph.facebook.com/v22.0/act_1/ads?after=x",
    "https://graph.facebook.com" + AT + "evil.example/v23.0/act_1/ads?after=x",
  ];
  for (const next of refusedNext) {
    const seen: Seen[] = [];
    const t = new MetaGraphTransport(recorder(seen, () => json({ data: [{ id: "1" }], paging: { next } })));
    const out = JSON.parse(textOf(await t.callTool(target(), "list_ads", { account_id: "act_1", limit: 50 })));
    assertEquals(seen.length, 1, "a refused next page was followed");
    assertEquals(out.more, true, next.replace(AT, "<AT>"));
    assert(typeof out.note === "string");
  }
  // No next page, or an empty one, is a complete list.
  for (const paging of [{}, { next: "" }, { next: null }, { cursors: { after: "x" } }]) {
    const t = new MetaGraphTransport(() => Promise.resolve(json({ data: [{ id: "1" }], paging })));
    const out = JSON.parse(textOf(await t.callTool(target(), "list_ads", { account_id: "act_1", limit: 50 })));
    assertEquals(out.more, false, JSON.stringify(paging));
    assertEquals(out.note, undefined);
  }
});
