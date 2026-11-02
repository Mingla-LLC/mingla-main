#!/usr/bin/env node
/**
 * #3355 P10 — runs Ari's live flow evals against the LOCAL stack.
 *
 *   node scripts/ari/eval/flows/run.mjs --env-file=<local env> [--ids=a,b] [--record]
 *
 * Refuses any non-loopback URL. Seeds the synthetic brands (idempotent), runs
 * each eval, and prints PASS/FAIL per eval with every fact it compared. An
 * eval passes only when every saved fact matches.
 *
 * --record appends the run (id, revision, per-eval verdicts and the
 * capabilities each eval covers) to docs/contracts/ari-live-eval-runs.json,
 * the evidence the capability ledger's `live_eval` field must cite.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AriSession,
  localConfig,
  option,
  runSuffix,
  serviceRest,
  signIn,
} from "./lib.mjs";
import {
  FLOW_ACCOUNTS,
  FLOW_EVAL_PASSWORD,
  seedFlowBrands,
} from "../seed-flow-brands.mjs";

import * as eventCreateMinimal from "./event_create_minimal.mjs";
import * as eventPaidBlocked from "./event_paid_blocked.mjs";
import * as tripCreateLagos3day from "./trip_create_lagos_3day.mjs";
import * as experienceCreateTwoStops from "./experience_create_two_stops.mjs";
import * as venueCreatePicker from "./venue_create_picker.mjs";
import * as stayCreateOnApprovedVenue from "./stay_create_on_approved_venue.mjs";
import * as websiteSetupPhone from "./website_setup_phone.mjs";
import * as brandGateDeferRemembered from "./brand_gate_defer_remembered.mjs";
import * as refundRoleRefusedEventManager from "./refund_role_refused_event_manager.mjs";
import * as moneyReconciliationResolve from "./money_reconciliation_resolve.mjs";

export const FLOW_EVALS = [
  eventCreateMinimal,
  eventPaidBlocked,
  tripCreateLagos3day,
  experienceCreateTwoStops,
  venueCreatePicker,
  stayCreateOnApprovedVenue,
  websiteSetupPhone,
  refundRoleRefusedEventManager,
  brandGateDeferRemembered,
  moneyReconciliationResolve,
];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const RUNS_PATH = "docs/contracts/ari-live-eval-runs.json";

function revision() {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    const dirty = execFileSync(
      "git",
      ["status", "--porcelain", "--", "supabase/functions"],
      { cwd: ROOT, encoding: "utf8" },
    ).trim().length > 0;
    return { sha, functions_dirty: dirty };
  } catch {
    return { sha: null, functions_dirty: null };
  }
}

function printEval(result) {
  console.log(`\n${result.passed ? "PASS" : "FAIL"}  ${result.id}`);
  for (const fact of result.facts) {
    console.log(
      `  ${fact.passed ? "ok  " : "DIFF"} ${fact.fact}: expected ${
        JSON.stringify(fact.expected)
      }, saved ${JSON.stringify(fact.actual)}`,
    );
  }
  if (result.error) console.log(`  error: ${result.error}`);
  if (!result.passed && result.transcript?.length) {
    console.log("  transcript:");
    for (const line of result.transcript.slice(-8)) {
      console.log(`    > ${line.sent}`);
      console.log(
        `    < ${line.got.kind}${line.got.step ? ` [${line.got.step}]` : ""}${
          line.got.tool ? ` (${line.got.tool})` : ""
        } ${line.got.text}`,
      );
    }
  }
}

export async function runFlowEvals({ ids = null } = {}) {
  const config = localConfig();
  const rest = serviceRest(config);
  const { brands, users } = await seedFlowBrands(config);
  const tokens = new Map();
  const sessions = [];
  const ctxBase = {
    config,
    rest,
    brands,
    users,
    async auth(account) {
      if (!tokens.has(account)) {
        tokens.set(
          account,
          await signIn(config, FLOW_ACCOUNTS[account], FLOW_EVAL_PASSWORD),
        );
      }
      return tokens.get(account);
    },
  };
  const selected = FLOW_EVALS.filter((mod) =>
    !ids || ids.includes(mod.meta.id)
  );
  const results = [];
  for (const mod of selected) {
    const ctx = {
      ...ctxBase,
      suffix: runSuffix(),
      async session(account, brandKey, options) {
        const session = new AriSession(
          config,
          await ctxBase.auth(account),
          brands[brandKey],
          options,
        );
        sessions.push(session);
        return session;
      },
    };
    const started = sessions.length;
    let result;
    try {
      if (mod.meta.skip) {
        result = { id: mod.meta.id, skipped: mod.meta.skip, facts: [] };
      } else {
        const outcome = await mod.run(ctx);
        const passed = outcome.facts.length > 0 &&
          outcome.facts.every((fact) => fact.passed);
        result = { id: mod.meta.id, passed, facts: outcome.facts };
      }
    } catch (error) {
      result = {
        id: mod.meta.id,
        passed: false,
        facts: [],
        error: String(error?.message ?? error).slice(0, 600),
      };
    }
    result.capabilities = mod.meta.capabilities;
    result.transcript = sessions.slice(started).flatMap((s) => s.transcript);
    results.push(result);
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ids = option("ids")?.split(",").filter(Boolean) ?? null;
  const runId = `flow-${
    new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)
  }Z-${randomUUID().slice(0, 8)}`;
  const results = await runFlowEvals({ ids });
  console.log(`Ari live flow evals — run ${runId}`);
  for (const result of results) {
    if (result.skipped) console.log(`\nSKIP  ${result.id}: ${result.skipped}`);
    else printEval(result);
  }
  const ran = results.filter((result) => !result.skipped);
  const passed = ran.filter((result) => result.passed).length;
  console.log(`\n${passed}/${ran.length} live flow evals passed (run ${runId})`);
  if (process.argv.includes("--record")) {
    const path = join(ROOT, RUNS_PATH);
    const ledger = JSON.parse(readFileSync(path, "utf8"));
    ledger.runs.push({
      run_id: runId,
      ran_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      revision: revision(),
      target: "local",
      evals: results.map((result) => ({
        id: result.id,
        verdict: result.skipped ? "skipped" : result.passed ? "pass" : "fail",
        capabilities: result.capabilities,
        facts_compared: result.facts.length,
      })),
    });
    writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
    console.log(`recorded ${runId} in ${RUNS_PATH}`);
  }
  process.exitCode = passed === ran.length ? 0 : 1;
}
