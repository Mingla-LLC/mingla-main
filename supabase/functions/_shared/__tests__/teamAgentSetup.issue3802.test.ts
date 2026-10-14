/**
 * Issue #3802 — the exchange address: a one-time setup code for its maker's
 * key, with a stand-in gateway.
 *
 *   X-1   a good code: 200, plain text, the key and one line break, not stored
 *   X-2   every code that cannot be used: one status, one set of headers, one
 *         body, one minimum time, whatever the cause
 *   X-3   what reaches the gateway: a digest under a reserved name, never the
 *         code, and nothing at all for a malformed code
 *   X-4   the reserved name is not a tool; a key at the exchange address and a
 *         code at the main address are both refused
 *   X-5   the log never holds a code or a key
 *   X-6   the checks that come first (method, origin, size) are unchanged
 *
 * Hermetic: no network, no database. Codes and keys are made up at run time.
 */
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTeamAgentHandler,
  isSetupAddress,
  KEY_PATTERN,
  MIN_REFUSAL_MS,
  readSetupCode,
  SETUP_CODE_PATTERN,
  SETUP_GATEWAY_NAME,
  SETUP_REFUSAL_BODY,
} from "../teamAgentMcp.ts";
import { findTool, TEAM_AGENT_TOOLS } from "../teamAgentTools.ts";

const BASE = "https://example.test/functions/v1/team-agent";
const SETUP = BASE + "/setup";
const tail = (ch: string) => ch.repeat(43);
const CODE_GOOD = "mgls_c_" + tail("s");
const CODE_USED = "mgls_c_" + tail("u");
const CODE_CODEX = "mgls_x_" + tail("x");
const KEY_MADE = "mgla_c_" + tail("k");
const KEY_CODEX = "mgla_x_" + tail("q");

async function digest(text: string): Promise<string> {
  const b = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
const HASH_GOOD = await digest(CODE_GOOD);
const HASH_CODEX = await digest(CODE_CODEX);

function harness(
  opts: { minRefusalMs?: number; answer?: (hash: string) => unknown } = {},
) {
  const seen: { hash: string; tool: string; args: unknown; client: string }[] =
    [];
  const logs: Record<string, unknown>[] = [];
  const slept: number[] = [];
  let clock = 1_000_000;
  const handler = createTeamAgentHandler({
    gateway: (hash, tool, args, client) => {
      seen.push({ hash, tool, args, client });
      if (opts.answer) return Promise.resolve(opts.answer(hash));
      if (tool !== SETUP_GATEWAY_NAME) {
        return Promise.resolve({ auth: "invalid" });
      }
      if (hash === HASH_GOOD) {
        return Promise.resolve({
          setup: "ok",
          key: KEY_MADE,
          agent: "claude",
          key_prefix: KEY_MADE.slice(0, 14),
        });
      }
      if (hash === HASH_CODEX) {
        return Promise.resolve({
          setup: "ok",
          key: KEY_CODEX,
          agent: "codex",
          key_prefix: KEY_CODEX.slice(0, 14),
        });
      }
      return Promise.resolve({ setup: "invalid" });
    },
    log: (line) => logs.push(line),
    now: () => clock,
    sleep: (ms) => {
      slept.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    requestId: () => "req-setup",
    minRefusalMs: opts.minRefusalMs ?? 0,
  });
  return { handler, seen, logs, slept };
}

function ask(
  opts: {
    url?: string;
    method?: string;
    bearer?: string | null;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Request {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  const method = opts.method ?? "POST";
  return new Request(opts.url ?? SETUP, {
    method,
    headers,
    body: method === "POST" ? (opts.body ?? "") : undefined,
  });
}

async function shape(res: Response) {
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  return { status: res.status, headers, body: await res.text() };
}

Deno.test("#3802 X-1: a good code is answered with the key and a line break, as plain text that is not to be stored", async () => {
  const h = harness();
  const r = await shape(await h.handler(ask({ bearer: CODE_GOOD })));
  assertEquals(r.status, 200);
  assertEquals(r.body, KEY_MADE + "\n");
  assertEquals(r.headers, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  assert(KEY_PATTERN.test(r.body.trimEnd()));
  // The codex code gives the codex key: the letter follows the code.
  const x = await shape(await h.handler(ask({ bearer: CODE_CODEX })));
  assertEquals(x.body, KEY_CODEX + "\n");
  // A body is never read: sending one changes nothing.
  const withBody = await shape(
    await h.handler(ask({ bearer: CODE_GOOD, body: "{not json" })),
  );
  assertEquals(withBody.body, KEY_MADE + "\n");
  // The address is recognised with and without a host prefix, never otherwise.
  assert(isSetupAddress(SETUP));
  assert(isSetupAddress("http://127.0.0.1:9/team-agent/setup"));
  for (
    const not of [
      BASE,
      BASE + "/",
      BASE + "/setup/",
      BASE + "/setup/x",
      BASE + "/Setup",
      "https://example.test/functions/v1/other/setup",
      "not a url",
    ]
  ) {
    assert(!isSetupAddress(not), not);
  }
});

Deno.test("#3802 X-2: every code that cannot be used gets the same status, headers and bytes", async () => {
  const cases: [string, Request, ((hash: string) => unknown) | undefined][] = [
    ["no credential", ask({}), undefined],
    ["an unknown code", ask({ bearer: "mgls_c_" + tail("n") }), undefined],
    ["a used code", ask({ bearer: CODE_USED }), undefined],
    [
      "a code one character short",
      ask({ bearer: "mgls_c_" + "s".repeat(42) }),
      undefined,
    ],
    [
      "a code one character long",
      ask({ bearer: "mgls_c_" + "s".repeat(44) }),
      undefined,
    ],
    [
      "a code with a letter that is no agent",
      ask({ bearer: "mgls_z_" + tail("s") }),
      undefined,
    ],
    ["a key instead of a code", ask({ bearer: KEY_MADE }), undefined],
    [
      "a lower-case scheme",
      ask({ headers: { authorization: `bearer ${CODE_GOOD}` } }),
      undefined,
    ],
    [
      "a basic credential",
      ask({ headers: { authorization: `Basic ${btoa(CODE_GOOD)}` } }),
      undefined,
    ],
    [
      "two codes in one header",
      ask({ headers: { authorization: `Bearer ${CODE_GOOD} ${CODE_GOOD}` } }),
      undefined,
    ],
    [
      "the code in the address",
      ask({ url: `${SETUP}?code=${CODE_GOOD}` }),
      undefined,
    ],
    [
      "a good code and any query string",
      ask({ url: `${SETUP}?x=1`, bearer: CODE_GOOD }),
      undefined,
    ],
    [
      "a good code and a bare question mark",
      ask({ url: `${SETUP}?`, bearer: CODE_GOOD }),
      undefined,
    ],
    [
      "the code in the body",
      ask({ body: JSON.stringify({ code: CODE_GOOD }) }),
      undefined,
    ],
    [
      "the code in another header",
      ask({ headers: { "x-setup-code": CODE_GOOD } }),
      undefined,
    ],
    [
      "the owner lost access",
      ask({ bearer: CODE_GOOD }),
      () => ({ setup: "invalid" }),
    ],
    [
      "the server answers a key that is not a key",
      ask({ bearer: CODE_GOOD }),
      () => ({ setup: "ok", key: "mgla_c_short" }),
    ],
    [
      "the server answers ok with no key",
      ask({ bearer: CODE_GOOD }),
      () => ({ setup: "ok" }),
    ],
    [
      "the server answers like a tool call",
      ask({ bearer: CODE_GOOD }),
      () => ({ ok: true, result: { key: KEY_MADE }, me: {} }),
    ],
    [
      "the server answers a wrong-key refusal",
      ask({ bearer: CODE_GOOD }),
      () => ({ auth: "invalid" }),
    ],
    ["the server answers nothing", ask({ bearer: CODE_GOOD }), () => null],
    ["the server fails", ask({ bearer: CODE_GOOD }), () => {
      throw new Error("down");
    }],
  ];
  let first = "";
  for (const [label, req, answer] of cases) {
    const h = harness({ answer });
    const r = await shape(await h.handler(req));
    assertEquals(r.status, 401, label);
    assertEquals(r.body, SETUP_REFUSAL_BODY, label);
    const all = JSON.stringify(r);
    if (first === "") first = all;
    assertEquals(all, first, label);
    assert(!r.body.includes("mgl"), label);
  }
  assertEquals(
    JSON.parse(first).headers,
    {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  );
  assertEquals(
    SETUP_REFUSAL_BODY,
    "This setup code cannot be used. It works once and lasts 10 minutes. Open My agent in Mingla Admin and copy a new setup message.",
  );
});

Deno.test("#3802 X-2: a refusal takes the same minimum time whether the code was malformed, unknown, or the server failed", async () => {
  for (
    const [req, answer] of [
      [ask({}), undefined],
      [ask({ bearer: CODE_USED }), undefined],
      [ask({ bearer: CODE_GOOD }), () => {
        throw new Error("down");
      }],
    ] as [Request, ((hash: string) => unknown) | undefined][]
  ) {
    const h = harness({ minRefusalMs: MIN_REFUSAL_MS, answer });
    await (await h.handler(req)).body?.cancel();
    assertEquals(h.slept, [MIN_REFUSAL_MS]);
  }
  // A good code is not held back.
  const h = harness({ minRefusalMs: MIN_REFUSAL_MS });
  await (await h.handler(ask({ bearer: CODE_GOOD }))).body?.cancel();
  assertEquals(h.slept, []);
});

Deno.test("#3802 X-3: the gateway is given a digest of the code under a reserved name, and nothing for a malformed one", async () => {
  const h = harness();
  await (await h.handler(
    ask({ bearer: CODE_GOOD, headers: { "user-agent": "claude-code/2.1" } }),
  )).body?.cancel();
  assertEquals(h.seen, [{
    hash: HASH_GOOD,
    tool: "setup:redeem",
    args: {},
    client: "claude-code/2.1",
  }]);
  assertEquals(SETUP_GATEWAY_NAME, "setup:redeem");
  assert(!JSON.stringify(h.seen).includes(CODE_GOOD));
  const none = harness();
  for (
    const req of [
      ask({}),
      ask({ bearer: KEY_MADE }),
      ask({ bearer: "mgls_c_" + "s".repeat(42) }),
      ask({ url: `${SETUP}?a=b`, bearer: CODE_GOOD }),
    ]
  ) {
    await (await none.handler(req)).body?.cancel();
  }
  assertEquals(
    none.seen.length,
    0,
    "a malformed code never reaches the server",
  );
  // What counts as a code.
  assert(
    SETUP_CODE_PATTERN.test(CODE_GOOD) && SETUP_CODE_PATTERN.test(CODE_CODEX),
  );
  assert(!SETUP_CODE_PATTERN.test(KEY_MADE) && !KEY_PATTERN.test(CODE_GOOD));
  assertEquals(readSetupCode(ask({ bearer: CODE_GOOD })), CODE_GOOD);
  assertEquals(readSetupCode(ask({ bearer: KEY_MADE })), null);
});

Deno.test("#3802 X-4: the reserved name is not a tool, and a key and a code are never taken for each other", async () => {
  assertEquals(findTool(SETUP_GATEWAY_NAME), undefined);
  assert(
    TEAM_AGENT_TOOLS.every((t) =>
      !t.name.includes(":") && !t.name.includes("setup")
    ),
  );
  const KEY_OK = "mgla_c_" + tail("g");
  const HASH_OK = await digest(KEY_OK);
  const seen: string[] = [];
  const handler = createTeamAgentHandler({
    gateway: (hash, tool) => {
      seen.push(tool);
      if (hash !== HASH_OK) return Promise.resolve({ auth: "invalid" });
      return Promise.resolve({ ok: true, result: {}, me: { role: "growth" } });
    },
    minRefusalMs: 0,
  });
  const call = (name: string, bearer: string, url = BASE) =>
    handler(
      new Request(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: {} },
        }),
      }),
    );
  const asTool = await shape(await call("setup:redeem", KEY_OK));
  assertEquals(
    JSON.parse(asTool.body).error.message,
    "That tool does not exist. Call tools/list to see what is available.",
  );
  assert(
    !seen.includes("setup:redeem"),
    "the reserved name was never passed on as a tool",
  );
  // A code sent as a key to the main address: the ordinary wrong-key answer.
  const codeAsKey = await shape(await call("get_started", CODE_GOOD));
  assertEquals(codeAsKey.status, 401);
  assertEquals(codeAsKey.headers["content-type"], "application/json");
  assertNotEquals(codeAsKey.body, SETUP_REFUSAL_BODY);
  // A working key sent to the exchange address: the code refusal, and the
  // key is not looked up there.
  const before = seen.length;
  const keyAsCode = await shape(await call("get_started", KEY_OK, SETUP));
  assertEquals(keyAsCode.status, 401);
  assertEquals(keyAsCode.body, SETUP_REFUSAL_BODY);
  assertEquals(seen.length, before);
  // If the server ever answered a tool request with a setup answer, it is
  // treated as a key that cannot be used.
  const odd = createTeamAgentHandler({
    gateway: () => Promise.resolve({ setup: "ok", key: KEY_OK }),
    minRefusalMs: 0,
  });
  const r = await odd(
    new Request(BASE, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY_OK}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }),
  );
  assertEquals(r.status, 401);
  assert(!(await r.text()).includes(KEY_OK));
});

Deno.test("#3802 X-5: the log line of an exchange holds no code and no key", async () => {
  const h = harness();
  await (await h.handler(ask({ bearer: CODE_GOOD }))).body?.cancel();
  await (await h.handler(ask({ bearer: CODE_USED }))).body?.cancel();
  await (await h.handler(ask({ url: `${SETUP}?code=${CODE_GOOD}` }))).body
    ?.cancel();
  assertEquals(h.logs.length, 3);
  assertEquals(h.logs[0], {
    fn: "team-agent",
    request_id: "req-setup",
    method: "setup",
    tool: "",
    outcome: "ok",
    status: 200,
    ms: 0,
    key_prefix: KEY_MADE.slice(0, 14),
  });
  assertEquals(h.logs[1], {
    fn: "team-agent",
    request_id: "req-setup",
    method: "setup",
    tool: "",
    outcome: "refused",
    status: 401,
    ms: 0,
  });
  const all = JSON.stringify(h.logs);
  for (
    const secret of [
      CODE_GOOD,
      CODE_USED,
      KEY_MADE,
      HASH_GOOD,
      tail("s"),
      tail("k"),
    ]
  ) {
    assert(!all.includes(secret), "a log line holds a credential");
  }
});

Deno.test("#3802 X-6: the checks that come before a credential is read are the same at the exchange address", async () => {
  const h = harness();
  const get = await shape(
    await h.handler(ask({ method: "GET", bearer: CODE_GOOD })),
  );
  assertEquals(get.status, 405);
  const options = await h.handler(ask({ method: "OPTIONS" }));
  assertEquals(options.status, 204);
  const origin = await shape(
    await h.handler(
      ask({ bearer: CODE_GOOD, headers: { origin: "https://evil.example" } }),
    ),
  );
  assertEquals(origin.status, 403);
  const big = await shape(
    await h.handler(
      ask({ bearer: CODE_GOOD, headers: { "content-length": "300000" } }),
    ),
  );
  assertEquals(big.status, 413);
  assertEquals(h.seen.length, 0, "none of them used the code");
});
