#!/usr/bin/env node
// #4238 — load the LOCAL-ONLY Host ads fixture (fixtures/host-ads-states.sql):
// one test brand with funded Ads credit (ledger rows, no payment), a public
// dated event with ticket stock, and one ad per state (in review, learning,
// running on Meta, running on TikTok, paused sold out, ended passed, rejected,
// part-rejected). Test data only; no payment or ad platform is called.
//
//   scripts/sites/local/start-host-ads-stack.sh      # once: this worktree's own stack
//   node scripts/sites/local/seed-host-ads.mjs [--owner-email you@local.invalid]
//
// #4238 rework 2 (tester P2-1): the ONLY target is this worktree's Host ads
// stack (lib/host-ads-stack.mjs): its dedicated port (never 55321/55322/
// 55421/55422), a clean psql environment (no inherited PG* variable), and the
// stack's identity token read back through that port before anything is
// written, then checked again inside the fixture's transaction.
// HOST_ADS_SEED_DB_URL may name the URL, but it must pass the same checks.
// The brand's owner defaults to the stack's local owner user
// (host-ads-owner@local.invalid, created here through the stack's own auth
// API). Runs once per database.

import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LOCAL_DIR, STATE_DIR, parseEnvFile, writePrivate } from "./lib/local-state.mjs";
import {
  HOST_ADS_IDENTITY_PATH,
  assertHostAdsTarget,
  hostAdsPsqlEnv,
  readHostAdsIdentity,
  verifyHostAdsStack,
} from "./lib/host-ads-stack.mjs";

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

let identity;
let url;
try {
  identity = readHostAdsIdentity(process.env.HOST_ADS_IDENTITY_PATH || HOST_ADS_IDENTITY_PATH);
  url = assertHostAdsTarget(process.env.HOST_ADS_SEED_DB_URL || identity.db_url, identity);
  verifyHostAdsStack(url, identity);
} catch (error) {
  fail(`${error.message} (start this worktree's stack with scripts/sites/local/start-host-ads-stack.sh)`);
}

const OWNER_PATH = resolve(STATE_DIR, "host-ads-owner.json");

/** The stack's local owner user, made through the stack's own auth API. */
async function ensureOwner() {
  const status = parseEnvFile(readFileSync(resolve(STATE_DIR, "host-ads.status.env"), "utf8"));
  const api = new URL(status.API_URL ?? "");
  if (!["127.0.0.1", "localhost"].includes(api.hostname) || Number(api.port) !== Number(identity.api_port)) {
    throw new Error("HOST_ADS_API_NOT_THIS_STACK");
  }
  const owner = existsSync(OWNER_PATH)
    ? JSON.parse(readFileSync(OWNER_PATH, "utf8"))
    : { id: randomUUID(), email: "host-ads-owner@local.invalid", password: randomBytes(18).toString("base64url") };
  const key = status.SERVICE_ROLE_KEY;
  const headers = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  const existing = await fetch(`${api.origin}/auth/v1/admin/users/${owner.id}`, { headers });
  const response = existing.ok
    ? await fetch(`${api.origin}/auth/v1/admin/users/${owner.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ email: owner.email, password: owner.password, email_confirm: true }),
    })
    : await fetch(`${api.origin}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: owner.id, email: owner.email, password: owner.password, email_confirm: true }),
    });
  if (!response.ok) throw new Error(`HOST_ADS_OWNER_FAILED:${response.status}`);
  writePrivate(OWNER_PATH, `${JSON.stringify(owner, null, 2)}\n`);
  return owner.email;
}

if (!ownerEmail) {
  try {
    ownerEmail = await ensureOwner();
  } catch (error) {
    fail(error.message);
  }
}

const result = spawnSync(
  "psql",
  [
    "-X", "--no-psqlrc", "-q", "-v", "ON_ERROR_STOP=1",
    "-v", `owner_email=${ownerEmail}`,
    "-v", `stack_project=${identity.project_id}`,
    "-v", `stack_token=${identity.token}`,
    "-f", resolve(LOCAL_DIR, "fixtures/host-ads-states.sql"),
  ],
  { encoding: "utf8", env: hostAdsPsqlEnv(url) },
);
process.stdout.write(result.stdout ?? "");
if (result.status !== 0) fail(String(result.stderr).split("\n").filter(Boolean).slice(-3).join(" | "));
process.stdout.write(`host-ads seed: loaded into ${identity.project_id} (127.0.0.1:${identity.db_port}); sign in as ${ownerEmail} (password in scripts/sites/local/.state/host-ads-owner.json)\n`);
