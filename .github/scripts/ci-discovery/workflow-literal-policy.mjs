import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const DISPLAY_NAME = "Supabase Migrations + Stripe Deno Tests (B2a Path C V3)";
export const FIXED_PROJECTION_SHA256 = "bf4a6cdb94bf9af098ec100a6cf0dead1412959121a3d6fff0fa2f2e1a1fc20e";

function fail(code, detail = "") {
  throw new Error(`ci-discovery:workflow-policy:${code}${detail ? `:${detail}` : ""}`);
}
export function findWorkflowByDisplayName(root = ROOT, displayName = DISPLAY_NAME) {
  const directory = path.join(root, ".github/workflows");
  const matches = fs.readdirSync(directory).filter((name) => /\.ya?ml$/.test(name)).filter((name) => {
    const source = fs.readFileSync(path.join(directory, name), "utf8");
    return source.match(/^name:\s*(.+)$/m)?.[1]?.replace(/^['\"]|['\"]$/g, "") === displayName;
  });
  if (matches.length !== 1) fail("display_name_match", `${displayName}:${matches.length}`);
  return { path: path.join(directory, matches[0]), source: fs.readFileSync(path.join(directory, matches[0]), "utf8") };
}

export function fixedInvocationProjection(source) {
  const lines = source.split("\n");
  const steps = [];
  let job = null;
  let step = null;
  let runIndent = null;
  let runLines = [];
  const flush = () => {
    if (runIndent === null) return;
    const commands = runLines.map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    const paths = commands.flatMap((line) => [...line.matchAll(
      /(?:app-mobile|mingla-business|packages|scripts|supabase)\/[A-Za-z0-9_./*\[\]-]+\.test\.(?:mjs|sql|ts)/g,
    )].map((match) => match[0]));
    if (paths.length > 0) steps.push({ job, step, paths, commands });
    runIndent = null;
    runLines = [];
  };
  for (const line of lines) {
    const jobMatch = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (jobMatch) {
      flush();
      job = jobMatch[1];
      step = null;
      continue;
    }
    const stepMatch = line.match(/^      - name:\s*(.+)$/);
    if (stepMatch) {
      flush();
      step = stepMatch[1].replace(/^['\"]|['\"]$/g, "");
      continue;
    }
    const runMatch = line.match(/^(\s+)run:\s*(?:\||>-?)?\s*(.*)$/);
    if (runMatch && job && step) {
      flush();
      runIndent = runMatch[1].length;
      if (runMatch[2]) runLines.push(runMatch[2]);
      continue;
    }
    if (runIndent !== null) {
      const indent = line.match(/^\s*/)[0].length;
      if (line.trim() && indent <= runIndent) {
        flush();
      } else {
        runLines.push(line);
      }
    }
  }
  flush();
  return steps;
}

function orchestrationJobs(source) {
  const starts = [...source.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)];
  return Object.fromEntries(starts.map((match, index) => [
    match[1],
    source.slice(match.index, starts[index + 1]?.index ?? source.length),
  ]));
}

function verifyDiscoveryOrchestration(source) {
  const jobs = orchestrationJobs(source);
  const expected = [
    { job: "deno-tests", lane: "stripe-deno", runtime: "1.46.x" },
    { job: "notification-deno-tests", lane: "notification-deno", runtime: "1.46.x" },
    { job: "discovered-deno-tests", lane: "deno2-discovered", runtime: "2.x" },
  ];
  const allCalls = [...source.matchAll(/node \.github\/scripts\/ci-discovery\/run\.mjs --lane ([a-z0-9-]+)/g)];
  if (allCalls.length !== 5) fail("runner_call_census", String(allCalls.length));
  for (const { job, lane, runtime } of expected) {
    const block = jobs[job];
    if (!block) fail("runner_job_missing", job);
    const invocation = `node .github/scripts/ci-discovery/run.mjs --lane ${lane}`;
    if (block.split(invocation).length !== 2) fail("runner_wiring", `${job}:${lane}`);
    if (runtime && !new RegExp(`deno-version:\\s*["']?${runtime.replaceAll(".", "\\.")}`).test(block)) {
      fail("runner_runtime", `${job}:${runtime}`);
    }
  }
  const migration = jobs.migrations;
  const replay = "for f in $(ls supabase/migrations/*.sql | sort); do";
  const replayCommand = "psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -f \"$f\"";
  const through = "node .github/scripts/ci-discovery/run.mjs --lane migrations --through legacy-0113";
  const fixedNode = "node --test supabase/functions/ticket-checkout-create/__tests__/issue_3313_day_choice_required.test.mjs";
  const after = "node .github/scripts/ci-discovery/run.mjs --lane migrations --after legacy-0113";
  const migrationCalls = [...migration.matchAll(/node \.github\/scripts\/ci-discovery\/run\.mjs --lane migrations(?:\s+--(?:through|after)\s+[a-z0-9-]+)?/g)]
    .map((match) => match[0]);
  if (migrationCalls.length !== 2 || migrationCalls[0] !== through || migrationCalls[1] !== after) {
    fail("migration_runner_segments", migrationCalls.join("|"));
  }
  if (!migration.includes(replay) || !migration.includes(replayCommand) ||
      migration.indexOf(replay) > migration.indexOf(through) || migration.indexOf("done") > migration.indexOf(through) ||
      migration.indexOf(through) > migration.indexOf(fixedNode) || migration.indexOf(fixedNode) > migration.indexOf(after)) {
    fail("migration_replay_order");
  }
}

export function verifyWorkflowLiteralPolicy({ root = ROOT, expectedSha = FIXED_PROJECTION_SHA256 } = {}) {
  const { source } = findWorkflowByDisplayName(root);
  verifyDiscoveryOrchestration(source);
  const retiredLists = [
    /DENO_TEST_FILES=\([\s\S]*?stripeIpAllowlist\.test\.ts/,
    /DENO_TEST_FILES=\([\s\S]*?orch_1161_notify_dispatch_v2\.test\.ts/,
    /Apply migrations in timestamp order[\s\S]*?-f supabase\/migrations\/__tests__\/issue_2218_/,
  ];
  if (retiredLists.some((pattern) => pattern.test(source))) fail("retired_literal_list_present");
  const projection = fixedInvocationProjection(source);
  const paths = projection.flatMap((entry) => entry.paths);
  const sql = paths.filter((entry) => entry.endsWith(".test.sql"));
  const teamAgentNode = paths.filter((entry) => entry.includes("supabase/functions/team-agent/__tests__/"));
  const specializedDeno = paths.filter((entry) => entry.endsWith(".test.ts") && !teamAgentNode.includes(entry));
  const fixedNodeMjs = paths.filter((entry) => entry.endsWith(".test.mjs"));
  if (sql.length !== 4 || teamAgentNode.length !== 6 || specializedDeno.length !== 56 || fixedNodeMjs.length !== 10) {
    fail("fixed_census", `sql=${sql.length}:team-agent=${teamAgentNode.length}:specialized-deno=${specializedDeno.length}:node-mjs=${fixedNodeMjs.length}`);
  }
  const digest = crypto.createHash("sha256").update(JSON.stringify(projection)).digest("hex");
  if (digest !== expectedSha) fail("fixed_projection_mismatch", `${digest}:expected=${expectedSha}`);
  return {
    projection,
    digest,
    counts: {
      sql: sql.length,
      teamAgentNode: teamAgentNode.length,
      specializedDeno: specializedDeno.length,
      fixedNodeMjs: fixedNodeMjs.length,
    },
  };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const result = verifyWorkflowLiteralPolicy();
  console.log(`PASS workflow literal policy (SQL ${result.counts.sql}, Deno ${result.counts.specializedDeno}, Node/TS ${result.counts.teamAgentNode}, Node/MJS ${result.counts.fixedNodeMjs})`);
}
