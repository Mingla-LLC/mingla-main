// Issue #3802 — an agent set up by one message, then adding and changing,
// spoken to over real HTTP into the function's real handler, against the
// replayed database.
//
//   WP-1  a setup code made by the real function, exchanged over HTTP for a
//         key; a second use and every other unusable code get one answer
//   WP-2  with that key: connect, list the tools, then check who is
//         contactable, add, move, log, record a reply, and add-or-find
//   WP-3  every change is made as the key's owner, via the key's agent, and
//         a caller cannot name anyone else
//   WP-4  a growth key and an admin key see the same tools but one; no text
//         in any answer names an internal function
//   WP-5  a request that waits for its key's turn is answered 429 "busy"
//
// Run: node --experimental-strip-types --test --test-concurrency=1 <this file>
// with PGHOST, PGPORT, PGUSER, PGPASSWORD pointing at a replayed database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";
import { startSuite, type Suite } from "./_harness.issue3802.ts";

let s: Suite;
let key = "";
const made: Record<string, string> = {};
const every: string[] = [];

before(async () => {
  s = await startSuite("w", "f400");
});
after(async () => {
  await s?.close();
});

const call = async (k: string | null, name: string, args?: unknown) => {
  const r = await s.rpc(
    k,
    "tools/call",
    args === undefined ? { name } : { name, arguments: args },
  );
  every.push(r.body);
  return r;
};
const out = (r: Awaited<ReturnType<typeof call>>) =>
  r.json.result.structuredContent;

const REFUSAL =
  "This setup code cannot be used. It works once and lasts 10 minutes. Open My agent in Mingla Admin and copy a new setup message.";

test("#3802 WP-1: a setup code is exchanged once for its maker's key, and every other code gets one answer", async () => {
  const before = await s.rpc(s.keys["growth.claude"], "ping");
  assert.equal(before.status, 200);
  const minted = JSON.parse(
    await s.asPerson(
      "growth",
      "select public.team_agent_setup_create('claude', 'Africa/Lagos')::text",
    ),
  );
  assert.match(minted.code, /^mgls_c_[A-Za-z0-9_-]{43}$/);
  assert.equal(minted.replaces_key, true);
  // Copying a message changes nothing: the key in use still works.
  assert.equal((await s.rpc(s.keys["growth.claude"], "ping")).status, 200);

  const first = await s.send({ path: "/setup", key: minted.code });
  assert.equal(first.status, 200);
  assert.equal(first.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(first.headers["cache-control"], "no-store");
  assert.match(first.body, /^mgla_c_[A-Za-z0-9_-]{43}\n$/);
  key = first.body.trim();
  assert.notEqual(key, s.keys["growth.claude"]);

  // The key it replaced stops at that moment; the other agent's is untouched.
  assert.equal((await s.rpc(s.keys["growth.claude"], "ping")).status, 401);
  assert.equal((await s.rpc(s.keys["growth.codex"], "ping")).status, 200);
  assert.equal((await s.rpc(key, "ping")).status, 200);

  // One answer for a second use and for every other code that cannot be used.
  const again = await s.send({ path: "/setup", key: minted.code });
  const seen = (r: typeof again) =>
    JSON.stringify([r.status, r.headers, r.body]);
  assert.equal(again.status, 401);
  assert.equal(again.body, REFUSAL);
  const expired = JSON.parse(
    await s.asPerson(
      "partner",
      "select public.team_agent_setup_create('claude')::text",
    ),
  );
  await s.sql(
    "update public.team_agent_setup_codes set created_at = created_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes' where owner_email = :'e' and consumed_at is null;",
    { e: s.emails.partner },
  );
  const older = JSON.parse(
    await s.asPerson(
      "leaver",
      "select public.team_agent_setup_create('claude')::text",
    ),
  );
  const newer = JSON.parse(
    await s.asPerson(
      "leaver",
      "select public.team_agent_setup_create('claude')::text",
    ),
  );
  for (
    const r of [
      await s.send({ path: "/setup", key: expired.code }),
      await s.send({ path: "/setup", key: older.code }),
      await s.send({ path: "/setup", key: "mgls_c_" + "n".repeat(43) }),
      await s.send({ path: "/setup", key: "mgls_c_short" }),
      await s.send({ path: "/setup", key: key }),
      await s.send({ path: "/setup", key: null }),
      await s.send({ path: "/setup?x=1", key: newer.code }),
    ]
  ) {
    assert.equal(seen(r), seen(again));
  }
  // The newer code was not used up by the request that carried a query
  // string, and still works: one key for that person.
  const used = await s.send({ path: "/setup", key: newer.code });
  assert.equal(used.status, 200);
  const rows = await s.sql(
    "select count(*) filter (where revoked_at is null) || '/' || count(*) from public.team_agent_keys where owner_email = :'e'; select count(*) from public.team_agent_keys where owner_email = :'p' and revoked_at is null; select count(*) from public.team_agent_calls where tool like 'setup%';",
    { e: s.emails.leaver, p: s.emails.partner },
  );
  assert.deepEqual(rows, ["1/2", "1", "0"]);
  // A code sent to the main address is a wrong key like any other.
  const asKey = await s.rpc(minted.code, "ping");
  assert.equal(asKey.status, 401);
  assert.notEqual(asKey.body, REFUSAL);
  // No log line holds a code or a key.
  const lines = JSON.stringify(s.logs);
  for (const secret of [minted.code, key, newer.code, used.body.trim()]) {
    assert.equal(lines.includes(secret), false);
    assert.equal(lines.includes(secret.slice(15)), false);
  }
  assert.equal(
    s.logs.filter((l) => l.method === "setup" && l.outcome === "ok").length,
    2,
  );
});

test("#3802 WP-2: with the key from the exchange an agent connects, checks, adds, moves, logs, records a reply and adds-or-finds", async () => {
  const init = await s.rpc(key, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "suite", version: "1.0" },
  });
  assert.equal(init.json.result.serverInfo.version, "4.2.0");
  assert.match(init.json.result.instructions, /Run check_contactable before/);
  const listed = (await s.rpc(key, "tools/list")).json.result.tools;
  assert.equal(listed.length, 15);

  const started = out(await call(key, "get_started"));
  assert.equal(started.me.email, s.emails.growth);
  assert.match(started.status, /^This connection reads and writes\./);
  assert.ok(
    started.pipelines.hosts.icps.some((i: { id: string }) =>
      i.id === "experience_host"
    ),
  );

  const check = out(
    await call(key, "check_contactable", {
      pipeline: "hosts",
      candidates: [
        { name: "issue3802w-Host Alpha" },
        {
          name: "issue3802w-Tour One",
          identifiers: [{ kind: "handle", value: "@issue3802w.tour" }],
        },
      ],
    }),
  );
  assert.deepEqual(
    check.results.map((r: { verdict: string }) => r.verdict),
    ["exists", "new"],
  );
  assert.equal(check.results[0].record.id, s.ids.alpha);

  const added = out(
    await call(key, "add_records", {
      pipeline: "hosts",
      request_key: "issue3802w-add-01",
      records: [
        {
          name: "issue3802w-Tour One",
          icp: "experience_host",
          identifiers: [
            { kind: "handle", value: "@issue3802w.tour" },
            { kind: "phone", value: "+1 919 555 0103" },
          ],
          first_touch: {
            channel: "instagram_dm",
            direction: "outbound",
            body: "Hi, quick question about your tours.",
          },
        },
        {
          name: "issue3802w-Tour Two",
          identifiers: [{
            kind: "handle",
            value: "instagram.com/Issue3802w.Tour",
          }],
        },
        { name: "issue3802w-host alpha" },
        { name: "issue3802w-Bad", icp: "ambassador" },
      ],
    }),
  );
  assert.deepEqual(added.counts, {
    created: 1,
    exists: 2,
    invalid: 1,
    touches_logged: 1,
    touches_refused: 0,
  });
  assert.equal(added.results[0].touch.status, "logged");
  assert.equal(added.results[1].reason, "identifier");
  assert.equal(added.results[1].existing.name, "issue3802w-Tour One");
  assert.equal(added.results[2].reason, "name");
  assert.equal(added.results[3].error.token, "invalid_icp");
  made.tour = added.results[0].record.id;
  assert.equal(added.results[0].record.icp, "experience_host");

  // The same request again adds nothing.
  const replay = out(
    await call(key, "add_records", {
      pipeline: "hosts",
      request_key: "issue3802w-add-01",
      records: [{ name: "issue3802w-Tour One" }],
    }),
  );
  assert.equal(replay.replayed, true);

  const moved = out(
    await call(key, "move_stage", {
      moves: [
        { id: made.tour, to: "contacted", expected_from: "prospect" },
        { id: made.tour, to: "meeting", expected_from: "prospect" },
      ],
    }),
  );
  assert.equal(moved.results[0].status, "moved");
  assert.equal(moved.results[1].error.token, "stage_changed");
  const noFrom = await call(key, "move_stage", {
    moves: [{ id: made.tour, to: "replied" }],
  });
  assert.equal(noFrom.json.result.isError, true);
  assert.match(
    noFrom.json.result.content[0].text,
    /"moves\[0\]\.expected_from" is missing or the wrong kind\. Send the stage you saw the card in\./,
  );

  const logged = out(
    await call(key, "log_activity", {
      request_key: "issue3802w-log-01",
      entries: [
        { id: made.tour, kind: "note", body: "Runs kayak tours on weekends." },
        {
          id: made.tour,
          kind: "touch",
          channel: "instagram_dm",
          direction: "outbound",
          body: "Following up",
        },
      ],
    }),
  );
  assert.equal(logged.results[0].status, "logged");
  assert.equal(logged.results[1].error.token, "needs_a_person");

  const reply = out(
    await call(key, "record_reply", {
      request_key: "issue3802w-reply-01",
      replies: [{
        id: made.tour,
        channel: "instagram_dm",
        body: "Sure, call me Friday",
      }],
    }),
  );
  assert.equal(reply.results[0].status, "logged");
  assert.equal(reply.results[0].moved_to, "replied");

  const upsert = out(
    await call(key, "upsert_record", {
      pipeline: "hosts",
      request_key: "issue3802w-upsert-01",
      record: {
        name: "Anything",
        identifiers: [{ kind: "phone", value: "(919) 555-0103" }],
      },
      touch: {
        channel: "phone",
        direction: "inbound",
        body: "They called back",
      },
    }),
  );
  assert.equal(upsert.status, "exists");
  assert.equal(upsert.reason, "identifier");
  assert.equal(upsert.record.id, made.tour);
  assert.equal(upsert.record.name, "issue3802w-Tour One");
  assert.equal(upsert.touch.status, "logged");

  const found = out(
    await call(key, "find_records", { pipeline: "hosts", q: "9195550103" }),
  );
  assert.equal(found.records[0].id, made.tour);
  assert.equal(found.records[0].identifiers.length, 2);
});

test("#3802 WP-3: every change was made as the key's owner, via the key's agent, and nobody else can be named", async () => {
  const rows = await s.sql(
    "select string_agg(distinct coalesce(actor_email, '-') || '/' || coalesce(via, '-'), ',') from public.crm_activity where record_id = :'id'; select created_by from public.crm_records where id = :'id'; select count(*) from public.admin_audit_log where target_id = :'id' and metadata ->> 'via' = 'claude';",
    { id: made.tour },
  );
  assert.equal(rows[0], `${s.emails.growth}/claude`);
  assert.equal(rows[1], s.emails.growth);
  assert.ok(Number(rows[2]) >= 3);
  // A forged actor is refused before it reaches the server...
  for (
    const forged of [
      "actor_email",
      "via",
      "created_by",
      "owner_email",
      "p_actor",
    ]
  ) {
    const r = await call(key, "add_records", {
      pipeline: "hosts",
      request_key: "issue3802w-forge-1",
      records: [{ name: "issue3802w-Forged", [forged]: s.emails.admin }],
    });
    assert.equal(r.json.result.isError, true, forged);
    assert.match(r.json.result.content[0].text, /is not something/);
  }
  // ...and by the server itself, were it ever asked.
  const direct = await s.gateway(key, "add_records", {
    pipeline: "hosts",
    request_key: "issue3802w-forge-2",
    records: [{
      name: "issue3802w-Forged",
      created_by: s.emails.admin,
      via: "codex",
    }],
  });
  assert.equal(direct.result.results[0].status, "invalid");
  assert.equal(direct.result.results[0].error.token, "unknown_field");
  const top = await s.gateway(key, "add_records", {
    pipeline: "hosts",
    request_key: "issue3802w-forge-3",
    actor_email: s.emails.admin,
    p_actor: s.emails.admin,
    records: [{ name: "issue3802w-By Whom" }],
  });
  assert.equal(top.result.results[0].record.created_by, s.emails.growth);
  assert.equal(
    (await s.sql(
      "select count(*) from public.crm_records where name = 'issue3802w-Forged';",
    ))[0],
    "0",
  );
  // An agent cannot make a setup code or a key, by any name.
  for (const name of ["team_agent_setup_create", "team_agent_key_issue"]) {
    const r = await s.gateway(key, name, { p_agent: "claude" });
    assert.equal(r.error.token, "unknown_tool", name);
  }
  // A key handed over under the reserved name is not a code: nothing is made.
  assert.deepEqual(await s.gateway(key, "setup:redeem", {}), {
    setup: "invalid",
  });
  assert.equal((await s.rpc(key, "ping")).status, 200);
});

test("#3802 WP-4: a growth key and an admin key see the same tools but one, and no answer names an internal function", async () => {
  const names = async (k: string) =>
    (await s.rpc(k, "tools/list")).json.result.tools.map((
      t: { name: string },
    ) => t.name);
  const growth = await names(key);
  const admin = await names(s.keys["admin.claude"]);
  assert.equal(growth.length, 15);
  assert.deepEqual(admin.filter((n: string) => !growth.includes(n)), [
    "team_summary",
  ]);
  const refused = await call(key, "team_summary");
  assert.equal(refused.json.result.isError, true);
  // Refusals an agent is given along the way.
  await call(key, "update_records", {
    updates: [{
      id: made.tour,
      changes: { region_id: "38020000-0000-4000-f4ff-000000000001" },
    }],
  });
  await call(key, "update_records", {
    updates: [{ id: made.tour, changes: { contact_rule: "do_not_contact" } }],
  });
  await call(key, "set_owners", {
    items: [{ id: made.tour, owner_emails: ["stranger@elsewhere.example"] }],
  });
  assert.ok(every.length >= 12);
  for (const body of every) {
    assert.equal(
      /crm_|team_agent_|admin_team_/.test(body),
      false,
      body.slice(0, 200),
    );
  }
});

test("#3802 WP-5: a request that waits five seconds for its key's turn is answered 429 busy, and the one that held the turn is unaffected", async () => {
  const rows = await s.sql(
    "select id::text from public.team_agent_keys where owner_email = :'e' and agent = 'claude' and revoked_at is null;",
    { e: s.emails.growth },
  );
  // Another session holds this key's turn for seven seconds.
  const holder = spawn("psql", [
    "-d",
    "postgres",
    "-At",
    "-q",
    "-X",
    "-c",
    `begin; select pg_advisory_xact_lock(hashtextextended('team_agent_limit:' || '${
      rows[0]
    }', 0)); select pg_sleep(7); commit;`,
  ], {
    env: process.env,
    stdio: "ignore",
  });
  const done = new Promise<number | null>((r) => holder.on("close", r));
  await new Promise((r) => setTimeout(r, 800));
  const started = Date.now();
  const other = await s.rpc(s.keys["admin.claude"], "ping");
  assert.equal(other.status, 200, "another key is not held up");
  assert.ok(Date.now() - started < 3000);
  const waited = await call(key, "my_day");
  const ms = Date.now() - started;
  assert.equal(waited.status, 429);
  assert.equal(waited.headers["retry-after"], "2");
  assert.equal(
    waited.json.error.message,
    "Another request from your agent is still running. Wait 2 seconds, then send this one again. Nothing was lost.",
  );
  assert.ok(ms >= 4500 && ms < 9000, `answered after ${ms} ms`);
  assert.equal(await done, 0);
  assert.equal((await call(key, "my_day")).json.result.isError, false);
  const limited = await s.sql(
    "select count(*) from public.team_agent_calls where key_id = :'k' and tool = 'my_day' and outcome = 'limited';",
    { k: rows[0] },
  );
  assert.equal(limited[0], "1");
  assert.equal(
    s.logs.some((l) => l.outcome === "busy" && l.status === 429),
    true,
  );
});
