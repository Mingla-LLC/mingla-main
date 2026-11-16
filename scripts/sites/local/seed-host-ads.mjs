#!/usr/bin/env node
// #4238 — load the LOCAL-ONLY Host ads fixture (fixtures/host-ads-states.sql):
// one test brand with funded Ads credit (ledger rows, no payment), a public
// dated event with ticket stock, and one ad per state (in review, learning,
// running on Meta, running on TikTok, paused sold out, ended passed, rejected,
// part-rejected). Test data only; no payment or ad platform is called.
//
//   node scripts/sites/local/seed-host-ads.mjs [--owner-email you@local.invalid]
//
// The database is the local Core stack (start-local-sites.sh writes its DB_URL
// to .state/core.status.env), or HOST_ADS_SEED_DB_URL. Anything that is not
// loopback is refused. The brand's owner defaults to the seed-local.mjs
// "brand_owner" user (.seed-credentials.local.json). Runs once per database.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LOCAL_DIR, SEED_CREDENTIALS_PATH, STATE_DIR, assertLoopbackUrl, parseEnvFile } from "./lib/local-state.mjs";

function fail(message) {
  process.stderr.write(`FAIL seed-host-ads: ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
let ownerEmail = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--owner-email" && args[i + 1]) ownerEmail = args[++i];
  else fail(`unknown argument ${args[i]}`);
}

let dbUrl = process.env.HOST_ADS_SEED_DB_URL ?? null;
if (!dbUrl) {
  const statusPath = resolve(STATE_DIR, "core.status.env");
  if (!existsSync(statusPath)) fail("no local Core stack (run scripts/sites/local/start-local-sites.sh, or set HOST_ADS_SEED_DB_URL)");
  dbUrl = parseEnvFile(readFileSync(statusPath, "utf8")).DB_URL ?? null;
  if (!dbUrl) fail("core.status.env has no DB_URL");
}
const url = assertLoopbackUrl(dbUrl, "core");

if (!ownerEmail) {
  if (!existsSync(SEED_CREDENTIALS_PATH)) fail("no seed credentials (run seed-local.mjs first, or pass --owner-email)");
  ownerEmail = JSON.parse(readFileSync(SEED_CREDENTIALS_PATH, "utf8"))?.users?.brand_owner?.email ?? null;
  if (!ownerEmail) fail("the seed credentials have no brand_owner user");
}

const result = spawnSync(
  "psql",
  ["-X", "--no-psqlrc", "-q", "-v", "ON_ERROR_STOP=1", "-v", `owner_email=${ownerEmail}`, "-f", resolve(LOCAL_DIR, "fixtures/host-ads-states.sql")],
  {
    encoding: "utf8",
    env: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port,
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: url.pathname.slice(1) || "postgres",
      PGAPPNAME: "mingla-host-ads-local-seed",
    },
  },
);
process.stdout.write(result.stdout ?? "");
if (result.status !== 0) fail(String(result.stderr).split("\n").filter(Boolean).slice(-3).join(" | "));
