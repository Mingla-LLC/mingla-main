// Issue #3802 — the agent connector, attacked: every way a caller might try
// to be someone else, be something else, or reach something off the list.
// Real HTTP into the real handler, against the replayed database.
//
//   S-1   naming a person, a role or an agent in the arguments: refused at
//         the door, and ignored by the server when the door is bypassed
//   S-2   a key anywhere but the Authorization header
//   S-3   credentials that are not a key: a session token of a signed-in
//         teammate, the server's own token
//   S-4   the visible part of someone else's key
//   S-5   tool names that carry a statement, and names of internal functions
//   S-6   object keys that poison an object in careless code
//   S-7   a web page calling from a browser
//   S-8   headers that claim a method, a tool, a person or a role
//   S-9   two keys used at the same moment never answer for each other
//   S-10  a key ended in the browser stops at the very next request
//   S-11  the keys themselves cannot be reached through the connector
//   S-12  guessing keys from one network address is slowed down
//   S-13  nobody can make a working key wait, whatever they write in a
//         forwarding header
//
// Run: node --experimental-strip-types --test --test-concurrency=1 <this file>
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startSuite, type Suite } from "./_harness.issue3802.ts";

let s: Suite;
before(async () => {
  s = await startSuite("s", "f200");
});
after(async () => {
  await s?.close();
});

const call = async (
  key: string | null,
  name: unknown,
  args?: unknown,
  headers?: Record<string, string>,
) => (await s.rpc(
  key,
  "tools/call",
  args === undefined ? { name } : { name, arguments: args },
  headers,
));

const snapshot = async () =>
  (await s.sql(
    `select (select count(*) from public.crm_records) || '/' || (select count(*) from public.crm_activity)
         || '/' || (select count(*) from public.team_agent_keys where revoked_at is null)
         || '/' || (select count(*) from public.admin_team_members where status = 'active')
         || '/' || (select count(*) from public.admin_users where status = 'active');`,
  ))[0];

test("#3802 S-1: a person, role or agent named in the arguments is refused at the door and ignored behind it", async () => {
  const claims: Record<string, unknown> = {
    via: "codex",
    actor: s.emails.admin,
    actor_email: s.emails.admin,
    owner_email: s.emails.admin,
    created_by: s.emails.admin,
    role: "owner",
    uid: "38020000-0000-4000-f200-000000000001",
    agent: "codex",
    email: s.emails.admin,
  };
  for (const [field, value] of Object.entries(claims)) {
    for (const tool of ["get_started", "my_day", "team_summary"]) {
      const r = await call(s.keys["growth.claude"], tool, { [field]: value });
      assert.equal(r.json.result.isError, true, `${tool} ${field}`);
      assert.match(
        r.json.result.content[0].text,
        new RegExp(
          `^invalid_arguments: "${field}" is not something ${tool} takes\\.`,
        ),
      );
    }
  }
  // Behind the door: the gateway asked directly with every claim at once.
  const direct = await s.gateway(
    s.keys["growth.claude"],
    "get_started",
    claims,
  );
  assert.equal(direct.ok, true);
  assert.deepEqual(direct.me, { role: "growth", agent: "claude" });
  assert.equal(direct.result.me.email, s.emails.growth);
  assert.deepEqual(direct.result.can, {
    delete: false,
    set_targets: false,
    see_team_dashboard: false,
  });
  const dash = await s.gateway(s.keys["growth.claude"], "team_summary", claims);
  assert.equal(dash.ok, false);
  assert.equal(dash.error.token, "forbidden");
  const day = await s.gateway(s.keys["growth.claude"], "my_day", claims);
  assert.equal(day.result.me.email, s.emails.growth);
  // A filter that names another person is a filter, not an identity: it reads
  // what the same person can already read, and "me" is still the key's owner.
  const theirs = await call(s.keys["growth.claude"], "find_records", {
    pipeline: "hosts",
    owner: s.emails.admin,
  });
  assert.equal(theirs.json.result.isError, false);
  const mine = await call(s.keys["growth.claude"], "find_records", {
    pipeline: "hosts",
    owner: "me",
    q: "issue3802s-",
  });
  assert.equal(mine.json.result.structuredContent.total, 2);
});

test("#3802 S-2: a key is read from the Authorization header and nowhere else", async () => {
  const good = s.keys["growth.claude"];
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_started" },
  };
  for (
    const path of [
      `?key=${good}`,
      `?token=${good}`,
      `?apiKey=${good}`,
      `?api_key=${good}`,
      `?access_token=${good}`,
      `?authorization=Bearer%20${good}`,
    ]
  ) {
    assert.equal(
      (await s.send({ key: null, path, body })).status,
      401,
      `no header, ${path.slice(0, 12)}`,
    );
    assert.equal(
      (await s.send({ key: good, path, body })).status,
      401,
      `good header too, ${path.slice(0, 12)}`,
    );
  }
  for (
    const headers of [
      { "x-mingla-key": good },
      { "x-api-key": good },
      { apikey: good },
      { cookie: `key=${good}` },
      { "proxy-authorization": `Bearer ${good}` },
    ]
  ) {
    assert.equal(
      (await s.send({ key: null, headers, body })).status,
      401,
      Object.keys(headers)[0],
    );
  }
  assert.equal(
    (await s.send({
      key: null,
      body: {
        ...body,
        params: {
          name: "get_started",
          arguments: {},
          _meta: { authorization: `Bearer ${good}` },
        },
        key: good,
      },
    })).status,
    401,
  );
  // An unrelated query parameter does not stop a good key.
  assert.equal(
    (await s.send({ key: good, path: "?trace=1", body })).status,
    200,
  );
});

test("#3802 S-3: only a key works: not a teammate's session token, not the server's own token", async () => {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_started" },
  };
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const session = `${header}.${
    b64({
      sub: "38020000-0000-4000-f200-000000000001",
      role: "authenticated",
      email: s.emails.admin,
      exp,
    })
  }.${"s".repeat(43)}`;
  const server = `${header}.${
    b64({ role: "service_role", iss: "supabase", exp })
  }.${"s".repeat(43)}`;
  const answers = [
    await s.send({ key: session, body }),
    await s.send({ key: server, body }),
    await s.send({
      key: null,
      headers: { authorization: `Bearer ${session}`, apikey: server },
      body,
    }),
    await s.send({ key: "sb_secret_" + "x".repeat(40), body }),
    await s.send({ key: null, body }),
  ];
  for (const a of answers) assert.equal(a.status, 401);
  assert.equal(
    new Set(answers.map((a) => JSON.stringify([a.headers, a.body]))).size,
    1,
  );
});

test("#3802 S-4: the visible part of someone else's key opens nothing and says nothing", async () => {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_started" },
  };
  const real = s.keys["admin.claude"];
  const unknown = await s.send({ key: "mgla_c_" + "z".repeat(43), body });
  const guesses = [
    real.slice(0, 14),
    real.slice(0, 14) + "A".repeat(36),
    real.slice(0, 49) + (real.endsWith("A") ? "B" : "A"),
    real.slice(0, 6) + (real[6] === "_" ? "" : "_") +
    real.slice(7).split("").reverse().join(""),
    real.toUpperCase(),
    real + real,
    ` ${real}`,
  ];
  for (const g of guesses) {
    const r = await s.send({ key: g, body });
    assert.equal(r.status, 401);
    assert.deepEqual(
      [r.headers, r.body],
      [unknown.headers, unknown.body],
      "a near miss answers exactly like a key nobody holds",
    );
  }
  // Nothing was written against the real key by any guess.
  const touched = await s.sql(
    "select count(*) from public.team_agent_calls where key_id = :'id';",
    { id: s.ids["admin.claude"] },
  );
  assert.equal(touched[0], "0");
  assert.equal((await s.send({ key: real, body })).status, 200);
});

test("#3802 S-5: a tool name is one of the listed names or it is nothing", async () => {
  const before = await snapshot();
  const names: unknown[] = [
    "get_started'; drop table public.crm_records; --",
    "get_started; select pg_sleep(5)",
    "find_records\u0000",
    "public.crm_record_delete",
    "crm_record_delete",
    "team_agent_key_create",
    "team_agent_resolve",
    "admin_team_set_member",
    "mcp:initialize",
    "mcp:other",
    "../get_started",
    "GET_STARTED",
    " get_started",
    "get_started ",
    "x".repeat(5000),
    ["get_started"],
    { toString: "get_started" },
    7,
    true,
    null,
  ];
  for (const name of names) {
    const r = await call(s.keys["admin.claude"], name, { id: s.ids.alpha });
    assert.equal(r.status, 200, (JSON.stringify(name) ?? "").slice(0, 30));
    assert.equal(
      r.json.error.code,
      -32602,
      (JSON.stringify(name) ?? "").slice(0, 30),
    );
    // (A text with a NUL in it cannot be sent to the database at all.)
    if (typeof name === "string" && !name.includes("\u0000")) {
      const direct = await s.gateway(s.keys["admin.claude"], name, {
        id: s.ids.alpha,
      });
      assert.ok(
        direct.ok === true
          ? name.startsWith("mcp:")
          : direct.error.token === "unknown_tool",
        `gateway: ${name.slice(0, 30)}`,
      );
    }
  }
  assert.equal(
    await snapshot(),
    before,
    "nothing was added, changed or removed",
  );
  const stored = await s.sql(
    "select count(*) from public.team_agent_calls where owner_email = :'e' and tool !~ '^(unknown|mcp:[a-z/]+|[a-z_]+)$';",
    { e: s.emails.admin },
  );
  assert.equal(stored[0], "0", "a name was stored as sent");
  // Values inside arguments are values.
  const q = await call(s.keys["admin.claude"], "find_records", {
    pipeline: "hosts",
    q: "'; drop table public.crm_records; --",
  });
  assert.equal(q.json.result.structuredContent.total, 0);
  const id = await call(s.keys["admin.claude"], "get_record", {
    id: "1; delete from public.crm_records",
  });
  assert.match(id.json.result.content[0].text, /^invalid_id:/);
  assert.equal(await snapshot(), before);
});

test("#3802 S-6: keys that poison an object in careless code are refused, and poison nothing", async () => {
  const raws = [
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_started","arguments":{"__proto__":{"role":"owner","adminOnly":false}}}}',
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_started","arguments":{"constructor":{"prototype":{"role":"owner"}}}}}',
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"find_records","arguments":{"pipeline":"hosts","prototype":{"x":1}}}}',
  ];
  for (const raw of raws) {
    const r = await s.send({ key: s.keys["growth.claude"], raw });
    assert.equal(r.json.result.isError, true);
    assert.match(r.json.result.content[0].text, /is not something/);
  }
  // At the top level they are simply not part of a request.
  const top = await s.send({
    key: s.keys["growth.claude"],
    raw:
      '{"jsonrpc":"2.0","id":2,"method":"tools/list","__proto__":{"method":"tools/call"},"params":{"__proto__":{"name":"team_summary"}}}',
  });
  assert.equal(top.status, 200);
  const names = top.json.result.tools.map((t: { name: string }) => t.name);
  assert.equal(
    names.includes("team_summary"),
    false,
    "a growth key was offered the owner's tool",
  );
  assert.equal(({} as Record<string, unknown>).role, undefined);
  assert.equal(({} as Record<string, unknown>).adminOnly, undefined);
  const after = await s.rpc(s.keys["growth.claude"], "tools/list");
  // [TEST-MOD-APPROVED #3802] Growth now receives the four approved draft tools.
  assert.equal(after.json.result.tools.length, 19);
});

test("#3802 S-7: a web page cannot call this from a visitor's browser", async () => {
  for (
    const origin of [
      "https://admin.usemingla.com",
      "https://usemingla.com",
      "https://evil.example",
      "null",
      "http://localhost:5173",
    ]
  ) {
    const r = await s.rpc(s.keys["admin.claude"], "tools/list", undefined, {
      origin,
    });
    assert.equal(r.status, 403, origin);
    assert.equal(
      r.json.error.message,
      "This endpoint is for agents, not web pages.",
    );
    assert.equal(
      Object.keys(r.headers).some((h) => h.startsWith("access-control")),
      false,
    );
  }
  const preflight = await s.send({
    method: "OPTIONS",
    key: null,
    headers: {
      origin: "https://evil.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    Object.keys(preflight.headers).some((h) => h.startsWith("access-control")),
    false,
  );
});

test("#3802 S-8: a header cannot name a method, a tool, a person or a role", async () => {
  const lies = {
    "mcp-method": "tools/call",
    "mcp-name": "team_summary",
    "x-mingla-actor": s.emails.admin,
    "x-mingla-role": "owner",
    "x-forwarded-user": s.emails.admin,
    "x-forwarded-email": s.emails.admin,
    "x-supabase-auth-user": "38020000-0000-4000-f200-000000000001",
    "x-user-id": "38020000-0000-4000-f200-000000000001",
    "x-role": "service_role",
  };
  const ping = await s.rpc(s.keys["growth.claude"], "ping", undefined, lies);
  assert.deepEqual(ping.json.result, {});
  const tools = await s.rpc(
    s.keys["growth.claude"],
    "tools/list",
    undefined,
    lies,
  );
  assert.equal(
    tools.json.result.tools.some((t: { name: string }) =>
      t.name === "team_summary"
    ),
    false,
  );
  const dash = await call(s.keys["growth.claude"], "team_summary", {}, lies);
  assert.equal(
    dash.json.result.content[0].text,
    "forbidden: Only an owner or admin can open the team dashboard.",
  );
  const me = await call(s.keys["growth.claude"], "get_started", {}, lies);
  assert.equal(me.json.result.structuredContent.me.email, s.emails.growth);
  assert.equal(me.json.result.structuredContent.role, "growth");
  // What an agent calls itself is shown on My agent and decides nothing.
  const named = await call(s.keys["growth.claude"], "get_started", {}, {
    "user-agent": "codex-cli/9.9 (owner)",
  });
  assert.equal(named.json.result.structuredContent.agent, "claude");
});

test("#3802 S-9: two keys used at the same moment never answer for each other", async () => {
  const pairs: [string, string, string][] = [
    ["growth.claude", s.emails.growth, "claude"],
    ["admin.claude", s.emails.admin, "claude"],
    ["growth.codex", s.emails.growth, "codex"],
    ["partner.claude", s.emails.partner, "claude"],
  ];
  const jobs = Array.from({ length: 32 }, (_, i) => pairs[i % pairs.length])
    .map(async ([label, email, agent]) => {
      const r = await call(s.keys[label], "get_started");
      return [
        r.json.result.structuredContent.me.email,
        r.json.result.structuredContent.agent,
        email,
        agent,
      ];
    });
  for (const [gotEmail, gotAgent, email, agent] of await Promise.all(jobs)) {
    assert.equal(gotEmail, email);
    assert.equal(gotAgent, agent);
  }
  const rows = await s.sql(
    `select count(*) filter (where k.owner_email <> c.owner_email or k.agent <> c.agent or c.actor_uid <> u.id) from public.team_agent_calls c
       join public.team_agent_keys k on k.id = c.key_id join auth.users u on u.email = k.owner_email where c.owner_email like 'issue3802s-%';`,
  );
  assert.equal(
    rows[0],
    "0",
    "a request row names someone other than its key's owner",
  );
});

test("#3802 S-10: a key ended in the browser stops at the very next request", async () => {
  assert.equal(
    (await call(s.keys["partner.claude"], "get_started")).status,
    200,
  );
  const ended = JSON.parse(
    await s.asPerson(
      "partner",
      `select public.team_agent_key_revoke('${s.ids["partner.claude"]}')::text`,
    ),
  );
  assert.equal(ended.changed, true);
  assert.equal(
    (await call(s.keys["partner.claude"], "get_started")).status,
    401,
  );
  assert.equal(
    (await s.rpc(s.keys["partner.claude"], "initialize", {
      protocolVersion: "2025-06-18",
    })).status,
    401,
  );
  // Replace: the old key stops, the new one works, and they differ.
  const old = s.keys["growth.codex"];
  const made = JSON.parse(
    await s.asPerson(
      "growth",
      "select public.team_agent_key_create('codex')::text",
    ),
  );
  assert.equal(made.replaced, true);
  assert.notEqual(made.key, old);
  assert.equal((await call(old, "get_started")).status, 401);
  assert.equal(
    (await call(made.key, "get_started")).json.result.structuredContent.agent,
    "codex",
  );
  // Someone else cannot end a person's key from the browser.
  await assert.rejects(
    s.asPerson(
      "partner",
      `select public.team_agent_key_revoke('${s.ids["growth.claude"]}')::text`,
    ),
    /not_found: That key is no longer here\./,
  );
  assert.equal(
    (await call(s.keys["growth.claude"], "get_started")).status,
    200,
  );
});

test("#3802 S-11: the keys cannot be listed, made or ended through the connector", async () => {
  const before = await snapshot();
  for (
    const name of [
      "team_agent_key_create",
      "team_agent_key_revoke",
      "team_agent_keys_mine",
      "team_agent_keys_overview",
      "team_agent_my_activity",
      "key_create",
      "create_key",
      "list_keys",
      "revoke_key",
    ]
  ) {
    const r = await call(s.keys["admin.claude"], name, {
      p_agent: "codex",
      p_key_id: s.ids["growth.claude"],
    });
    assert.equal(r.json.error.code, -32602, name);
    const direct = await s.gateway(s.keys["admin.claude"], name, {
      p_agent: "codex",
      p_key_id: s.ids["growth.claude"],
    });
    assert.equal(direct.error.token, "unknown_tool", name);
  }
  assert.equal(await snapshot(), before);
  // No answer of any tool carries a key or a digest of one.
  let all = "";
  for (
    const [name, args] of [
      ["get_started", {}],
      ["my_day", {}],
      ["team_summary", {}],
      ["find_records", { pipeline: "hosts" }],
      ["list_beta_leads", {}],
    ] as const
  ) {
    all += (await call(s.keys["admin.claude"], name, args)).body;
  }
  all += (await s.rpc(s.keys["admin.claude"], "resources/read", {
    uri: "mingla://guide",
  })).body;
  all += (await s.rpc(s.keys["admin.claude"], "resources/read", {
    uri: "mingla://config",
  })).body;
  assert.equal(/mgla_[cx]_[A-Za-z0-9_-]{43}/.test(all), false);
  assert.equal(/\b[0-9a-f]{64}\b/.test(all), false);
  assert.equal(/crm_|team_agent_|admin_team_/.test(all), false);
});

test("#3802 S-12: any number of wrong keys from one network address are each refused the same way, and nobody waits", async () => {
  const from = { "x-forwarded-for": "203.0.113.50" };
  const body = { jsonrpc: "2.0", id: 1, method: "ping" };
  let first = "";
  for (let i = 0; i < 90; i++) {
    const r = await s.send({
      key: "mgla_c_" + String(i).padStart(43, "g"),
      headers: from,
      body,
    });
    assert.equal(r.status, 401, `guess ${i + 1}`);
    assert.equal(r.headers["retry-after"], undefined);
    const seen = JSON.stringify([r.status, r.headers, r.body]);
    if (i === 0) first = seen;
    assert.equal(seen, first, `guess ${i + 1}`);
  }
  // A working key from that same address is answered.
  assert.equal(
    (await s.send({ key: s.keys["growth.claude"], headers: from, body }))
      .status,
    200,
  );
  assert.equal(
    (await s.send({ key: s.keys["growth.claude"], body })).status,
    200,
  );
  // No guess reached a real key's record.
  const rows = await s.sql(
    "select count(*) from public.team_agent_calls where owner_email like 'issue3802s-%' and outcome = 'limited';",
  );
  assert.equal(rows[0], "0");
});

test("#3802 S-13: wrong keys never make a working key wait, whatever the sender writes in a forwarding header", async () => {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_started" },
  };
  const wrong = (n: number) => "mgla_c_" + String(n).padStart(43, "w");
  const good = s.keys["admin.claude"];
  // A flood of wrong keys from one address; the working key from that very address still answers, every time.
  const from = { "x-forwarded-for": "203.0.113.77" };
  for (let i = 0; i < 60; i++) {
    const r = await s.send({ key: wrong(i), headers: from, body });
    assert.equal(r.status, 401, `wrong key ${i + 1}`);
    if (i % 10 === 9) {
      const ok = await s.send({ key: good, headers: from, body });
      assert.equal(ok.status, 200, `the working key after ${i + 1} wrong ones`);
      assert.equal(ok.json.result.structuredContent.me.email, s.emails.admin);
    }
  }
  // A key that was ended is a wrong key like any other.
  const ended = await s.send({
    key: s.keys["partner.claude"],
    headers: from,
    body,
  });
  assert.equal(ended.status, 401);
  // Whatever a sender writes about where it came from, the answer is the same.
  for (
    const headers of [
      { "x-forwarded-for": "198.51.100.200, 203.0.113.78" },
      { "x-forwarded-for": "198.51.100.200" },
      { "x-forwarded-for": "9.9.9.9, 203.0.113.78" },
      { "x-forwarded-for": "" },
      { "x-forwarded-for": "unknown" },
      { "x-forwarded-for": "x".repeat(300) },
    ]
  ) {
    for (let i = 0; i < 35; i++) {
      const r = await s.send({ key: wrong(300 + i), headers, body });
      assert.equal(r.status, 401);
      assert.equal(r.body, ended.body);
    }
    assert.equal((await s.send({ key: good, headers, body })).status, 200);
  }
  // None of it counted against the working key.
  const rows = await s.sql(
    "select count(*) from public.team_agent_calls where key_id = :'id' and outcome = 'limited';",
    { id: s.ids["admin.claude"] },
  );
  assert.equal(rows[0], "0");
});
