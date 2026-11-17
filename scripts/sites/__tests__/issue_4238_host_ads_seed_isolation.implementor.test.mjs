// #4238 rework 2 (tester P2-1) — the Host ads local seed only ever writes to
// THIS worktree's own Host ads stack, and every refusal path is executed.
//
// @invariant I-4238-HOST-ADS-SEED-ISOLATED (declared in scripts/sites/local/lib/host-ads-stack.mjs)
//
// A fake `psql` (and, for the start script, fake `docker`/`supabase`) on PATH
// records every call, so "refused" means "psql never ran a write".
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HOST_ADS_RESERVED_PORTS,
  HOST_ADS_STACK_DEFAULTS,
  assertHostAdsTarget,
  hostAdsPsqlEnv,
  verifyHostAdsStack,
  withoutPgEnv,
} from "../local/lib/host-ads-stack.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOCAL = join(REPO_ROOT, "scripts/sites/local");
const TOKEN = "ab".repeat(24);

const identity = (over = {}) => ({
  project_id: "mingla-host-ads-4238-local",
  api_port: 59998,
  db_port: 59999,
  db_url: "postgresql://postgres:postgres@127.0.0.1:59999/postgres",
  token: TOKEN,
  ...over,
});

/** A sandbox with a recording fake psql that answers the identity read with `answer`. */
function sandbox(answer) {
  const dir = mkdtempSync(join(tmpdir(), "host-ads-isolation-"));
  const log = join(dir, "psql.log");
  writeFileSync(
    join(dir, "psql"),
    `#!/usr/bin/env bash
{ printf 'ARGS %s\\n' "$*"; env | grep -E '^PG' | sort | sed 's/^/ENV /'; } >> "${log}"
cat >/dev/null
printf '%s\\n' '${answer}'
`,
  );
  chmodSync(join(dir, "psql"), 0o755);
  return { dir, log, calls: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
}

function seed(sb, ident, env = {}) {
  const path = join(sb.dir, "identity.json");
  if (ident) writeFileSync(path, JSON.stringify(ident));
  return spawnSync(process.execPath, [join(LOCAL, "seed-host-ads.mjs"), "--owner-email", "o@local.invalid"], {
    encoding: "utf8",
    env: { PATH: `${sb.dir}:${process.env.PATH}`, HOST_ADS_IDENTITY_PATH: path, ...env },
  });
}

test("the shared Sites ports are reserved; the Host ads defaults are none of them", () => {
  assert.deepEqual([...HOST_ADS_RESERVED_PORTS], [55321, 55322, 55421, 55422]);
  for (const port of [HOST_ADS_STACK_DEFAULTS.apiPort, HOST_ADS_STACK_DEFAULTS.dbPort, HOST_ADS_STACK_DEFAULTS.shadowPort, HOST_ADS_STACK_DEFAULTS.inspectorPort]) {
    assert.ok(!HOST_ADS_RESERVED_PORTS.includes(port), `${port} is reserved`);
  }
});

test("psql never inherits a PG* variable: PGHOSTADDR / PGSERVICE / PGPORT are replaced or dropped (fail-on-revert)", () => {
  const env = hostAdsPsqlEnv(new URL(identity().db_url), {
    PATH: "/bin",
    PGHOSTADDR: "10.9.9.9",
    PGSERVICE: "production",
    PGSERVICEFILE: "/tmp/x",
    PGPORT: "5432",
    PGOPTIONS: "-c search_path=evil",
    pgpassfile: "/tmp/y",
  });
  assert.equal(env.PGHOSTADDR, "127.0.0.1");
  assert.equal(env.PGHOST, "127.0.0.1");
  assert.equal(env.PGPORT, "59999");
  for (const key of ["PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "pgpassfile"]) assert.equal(env[key], undefined, key);
  assert.deepEqual(withoutPgEnv({ PGHOST: "x", PATH: "/bin" }), { PATH: "/bin" });
});

test("a reserved, remote or other-port target is refused", () => {
  for (const port of HOST_ADS_RESERVED_PORTS) {
    assert.throws(
      () => assertHostAdsTarget(`postgresql://p:p@127.0.0.1:${port}/postgres`, identity({ db_port: port })),
      /RESERVED_PORT/,
    );
  }
  assert.throws(() => assertHostAdsTarget("postgresql://p:p@db.example.com:59999/postgres", identity()), /NOT_LOOPBACK/);
  assert.throws(() => assertHostAdsTarget("postgresql://p:p@127.0.0.1:59990/postgres", identity()), /NOT_THIS_STACK/);
  assert.equal(assertHostAdsTarget(identity().db_url, identity()).port, "59999");
});

test("verify: a database without this stack's token is refused; the matching one passes", () => {
  const url = new URL(identity().db_url);
  const answer = (stdout, status = 0) => () => ({ status, stdout });
  assert.throws(() => verifyHostAdsStack(url, identity(), answer("cd".repeat(24))), /not this worktree/);
  assert.throws(() => verifyHostAdsStack(url, identity(), answer("", 3)), /no stack identity/);
  assert.equal(verifyHostAdsStack(url, identity(), answer(TOKEN)), true);
});

test("seed: no started stack → refused, psql never runs", () => {
  const sb = sandbox(TOKEN);
  const out = seed(sb, null);
  assert.equal(out.status, 1);
  assert.match(out.stderr, /HOST_ADS_STACK_NOT_STARTED/);
  assert.equal(sb.calls(), "");
});

test("seed: the incident target (127.0.0.1:55322) is refused, psql never runs (fail-on-revert)", () => {
  const sb = sandbox(TOKEN);
  const out = seed(sb, identity({ db_port: 55322, db_url: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" }));
  assert.equal(out.status, 1);
  assert.match(out.stderr, /RESERVED_PORT:55322/);
  assert.equal(sb.calls(), "");
});

test("seed: HOST_ADS_SEED_DB_URL cannot point elsewhere", () => {
  const sb = sandbox(TOKEN);
  const out = seed(sb, identity(), { HOST_ADS_SEED_DB_URL: "postgresql://postgres:postgres@127.0.0.1:55322/postgres" });
  assert.equal(out.status, 1);
  assert.equal(sb.calls(), "");
});

test("seed: a database that answers with another token is refused before the fixture runs (fail-on-revert)", () => {
  const sb = sandbox("cd".repeat(24));
  const out = seed(sb, identity(), { PGHOSTADDR: "127.0.0.2", PGSERVICE: "production" });
  assert.equal(out.status, 1);
  assert.match(out.stderr, /not this worktree's Host ads stack/);
  const calls = sb.calls();
  assert.match(calls, /^ARGS /m, "the identity read ran");
  assert.doesNotMatch(calls, /host-ads-states\.sql/, "the fixture never ran");
  assert.doesNotMatch(calls, /PGHOSTADDR=127\.0\.0\.2|PGSERVICE=/, "inherited PG variables reached psql");
  assert.match(calls, /ENV PGHOSTADDR=127\.0\.0\.1/);
});

test("seed: this stack's token → the fixture runs with the identity, and still a clean environment", () => {
  const sb = sandbox(TOKEN);
  const out = seed(sb, identity(), { PGHOSTADDR: "127.0.0.2", PGSERVICE: "production" });
  assert.equal(out.status, 0, out.stderr);
  const calls = sb.calls();
  assert.match(calls, /host-ads-states\.sql/);
  assert.match(calls, new RegExp(`stack_token=${TOKEN}`));
  assert.doesNotMatch(calls, /PGHOSTADDR=127\.0\.0\.2|PGSERVICE=/);
});

test("the fixture refuses inside SQL too: identity check before anything and again in the transaction", () => {
  const sql = readFileSync(join(LOCAL, "fixtures/host-ads-states.sql"), "utf8");
  const first = sql.indexOf("sites_local.stack_identity");
  assert.ok(first > 0 && first < sql.indexOf("FROM public.brands"), "checked before the first read of the brand");
  assert.ok(sql.indexOf(") AS stack_ok,") > sql.indexOf("BEGIN;"), "checked again inside the transaction");
  assert.ok(sql.indexOf("IF NOT (SELECT stack_ok FROM seed_ids)") < sql.indexOf("DISABLE TRIGGER"), "before the triggers are disabled");
});

test("start-host-ads-stack.sh refuses a reserved port before touching Docker", () => {
  const sb = sandbox(TOKEN);
  const out = spawnSync("bash", [join(LOCAL, "start-host-ads-stack.sh")], {
    encoding: "utf8",
    env: { PATH: `${sb.dir}:${process.env.PATH}`, HOME: sb.dir, DOCKER_HOST: "unix:///nonexistent.sock", HOST_ADS_STACK_DB_PORT: "55322" },
  });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /port 55322 belongs to the shared Sites stack/);
});

test("start-host-ads-stack.sh refuses a port something already listens on, and never starts the stack", async (t) => {
  if (spawnSync("bash", ["-c", "command -v lsof"]).status !== 0) {
    t.skip("lsof not installed");
    return;
  }
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const busy = server.address().port;
  try {
    const sb = sandbox(TOKEN);
    const record = join(sb.dir, "tools.log");
    for (const tool of ["docker", "supabase"]) {
      // status → not running; every call recorded.
      writeFileSync(join(sb.dir, tool), `#!/usr/bin/env bash\nprintf '${tool} %s\\n' "$*" >> "${record}"\n[[ "$1" == "status" ]] && exit 1\nexit 0\n`);
      chmodSync(join(sb.dir, tool), 0o755);
    }
    const out = spawnSync("bash", [join(LOCAL, "start-host-ads-stack.sh")], {
      encoding: "utf8",
      env: {
        PATH: `${sb.dir}:${process.env.PATH}`,
        HOME: sb.dir,
        DOCKER_HOST: "unix:///nonexistent.sock",
        SUPABASE_BIN: join(sb.dir, "supabase"),
        HOST_ADS_STACKS_DIR: join(sb.dir, "stacks"),
        HOST_ADS_STACK_DB_PORT: String(busy),
      },
    });
    assert.equal(out.status, 2, out.stderr);
    assert.match(out.stderr, new RegExp(`port ${busy} is already in use`));
    const tools = existsSync(record) ? readFileSync(record, "utf8") : "";
    assert.doesNotMatch(tools, /supabase start/);
  } finally {
    server.close();
  }
});
