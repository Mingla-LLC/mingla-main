// #4238 rework 2 (tester P2-1) — the Host ads local stack's safety rules.
//
// The Host ads fixture disables two triggers for one transaction and writes
// fake ledger money, so it must only ever reach THIS worktree's own Host ads
// Core stack. Loopback alone is not enough: on 2026-11-16 127.0.0.1:55322 was
// another chat's colima VM, and inherited PGHOSTADDR/PGSERVICE variables can
// send psql somewhere else entirely. So:
//   1. dedicated ports, never the shared Sites defaults (55321/55322/55421/55422);
//   2. psql gets a clean environment (every inherited PG* variable dropped);
//   3. the stack is proven by a random token start-host-ads-stack.sh writes
//      into the database INSIDE the container (docker exec, never the host
//      port); the seed reads it back through the host port and refuses on
//      any mismatch, and the fixture checks it again inside its transaction.
//
// MINGLA-INVARIANT: I-4238-HOST-ADS-SEED-ISOLATED | issue #4238 | The Host ads local seed writes only to the database whose sites_local.stack_identity token matches this worktree's .state/host-ads-stack.json, on a dedicated loopback port outside 55321/55322/55421/55422, with every inherited PG* variable removed; anything else is refused before psql writes.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { STATE_DIR } from "./local-state.mjs";

/** Ports another chat's stack owns (the shared Sites defaults). */
export const HOST_ADS_RESERVED_PORTS = Object.freeze([55321, 55322, 55421, 55422]);

/** This stack's own defaults (override with HOST_ADS_STACK_* env vars). */
export const HOST_ADS_STACK_DEFAULTS = Object.freeze({
  projectId: "mingla-host-ads-4238-local",
  apiPort: 56521,
  dbPort: 56522,
  shadowPort: 56520,
  inspectorPort: 56583,
});

export const HOST_ADS_IDENTITY_PATH = resolve(STATE_DIR, "host-ads-stack.json");

/** The inherited environment without a single PG* variable. */
export function withoutPgEnv(env) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (/^PG/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/** Refuse a target that is not loopback, is a reserved port, or is not the stack's port. */
export function assertHostAdsTarget(raw, identity) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("HOST_ADS_TARGET_INVALID");
  }
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("HOST_ADS_TARGET_NOT_LOOPBACK");
  const port = Number(url.port);
  if (!Number.isInteger(port) || port <= 0) throw new Error("HOST_ADS_TARGET_NO_PORT");
  if (HOST_ADS_RESERVED_PORTS.includes(port)) throw new Error(`HOST_ADS_TARGET_RESERVED_PORT:${port}`);
  if (!identity || port !== Number(identity.db_port)) throw new Error(`HOST_ADS_TARGET_NOT_THIS_STACK:${port}`);
  return url;
}

/** psql's whole environment: the clean base plus only this target. */
export function hostAdsPsqlEnv(url, baseEnv = process.env) {
  return {
    ...withoutPgEnv(baseEnv),
    PGHOST: "127.0.0.1",
    PGHOSTADDR: "127.0.0.1",
    PGPORT: url.port,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1) || "postgres",
    PGSSLMODE: "disable",
    PGCONNECT_TIMEOUT: "5",
    PGAPPNAME: "mingla-host-ads-local-seed",
  };
}

/** The identity start-host-ads-stack.sh saved; throws when missing or malformed. */
export function readHostAdsIdentity(path = HOST_ADS_IDENTITY_PATH) {
  if (!existsSync(path)) throw new Error("HOST_ADS_STACK_NOT_STARTED");
  const identity = JSON.parse(readFileSync(path, "utf8"));
  if (
    typeof identity?.project_id !== "string" || !/^[a-z0-9-]{3,63}$/.test(identity.project_id) ||
    typeof identity?.token !== "string" || !/^[0-9a-f]{32,}$/.test(identity.token) ||
    !Number.isInteger(identity?.db_port) || typeof identity?.db_url !== "string"
  ) throw new Error("HOST_ADS_STACK_IDENTITY_INVALID");
  return identity;
}

/**
 * Read the token back THROUGH the host port and compare. `run` is injectable
 * for tests (defaults to psql with the clean environment).
 */
export function verifyHostAdsStack(url, identity, run = defaultRun) {
  // psql interpolates :'project' only in script input, never in -c.
  const result = run(
    ["-X", "--no-psqlrc", "-At", "-v", "ON_ERROR_STOP=1", "-v", `project=${identity.project_id}`],
    hostAdsPsqlEnv(url),
    "SELECT token FROM sites_local.stack_identity WHERE project_id = :'project';\n",
  );
  if (result.status !== 0) throw new Error("HOST_ADS_STACK_UNVERIFIED: no stack identity at that port");
  if (String(result.stdout ?? "").trim() !== identity.token) {
    throw new Error("HOST_ADS_STACK_UNVERIFIED: the database at that port is not this worktree's Host ads stack");
  }
  return true;
}

function defaultRun(args, env, input) {
  return spawnSync("psql", args, { encoding: "utf8", env, input });
}
