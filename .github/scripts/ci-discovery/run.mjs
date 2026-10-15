#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listLane, readSealedBaseline } from "./load-plan.mjs";

function parseArgs(argv) {
  const laneIndex = argv.indexOf("--lane");
  if (laneIndex < 0 || !argv[laneIndex + 1]) throw new Error("ci-discovery:run:missing_lane");
  const throughIndex = argv.indexOf("--through");
  const afterIndex = argv.indexOf("--after");
  if (throughIndex >= 0 && afterIndex >= 0) throw new Error("ci-discovery:run:conflicting_segment");
  if ((throughIndex >= 0 && !argv[throughIndex + 1]) || (afterIndex >= 0 && !argv[afterIndex + 1])) {
    throw new Error("ci-discovery:run:missing_segment_key");
  }
  return {
    lane: argv[laneIndex + 1],
    through: throughIndex >= 0 ? argv[throughIndex + 1] : null,
    after: afterIndex >= 0 ? argv[afterIndex + 1] : null,
  };
}

function execute(command, argv) {
  const result = spawnSync(command, argv, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function sleep(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

function selectSegment(entries, { through = null, after = null } = {}) {
  if (!through && !after) return entries;
  const key = through ?? after;
  const matches = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.orderKey === key);
  if (matches.length !== 1) throw new Error(`ci-discovery:run:segment_key:${key}:matches=${matches.length}`);
  return through ? entries.slice(0, matches[0].index + 1) : entries.slice(matches[0].index + 1);
}

export function runLane(lane, { executeCommand = execute, wait = sleep, through = null, after = null } = {}) {
  const baseline = readSealedBaseline();
  if ((through || after) && lane !== "migrations") throw new Error(`ci-discovery:run:segment_forbidden:${lane}`);
  if (through && after) throw new Error("ci-discovery:run:conflicting_segment");
  const entries = selectSegment(listLane(lane), { through, after });
  console.log(`Resolved ${lane} plan (${entries.length})`);
  for (const entry of entries) console.log(`${entry.orderKey}\t${entry.profile}\t${entry.path}`);
  if (entries.length === 0) return 0;

  if (lane === "migrations") {
    for (const entry of entries) {
      const profile = baseline.profiles[entry.profile];
      const status = executeCommand(profile.command, [
        "-h", "localhost",
        "-U", entry.database.user,
        "-d", entry.database.database,
        "-v", "ON_ERROR_STOP=1",
        "-f", entry.path,
      ]);
      if (status !== 0) return status;
    }
    return 0;
  }

  const profiles = new Set(entries.map((entry) => entry.profile));
  if (profiles.size !== 1) throw new Error(`ci-discovery:mixed_lane_profiles:${lane}`);
  const profile = baseline.profiles[[...profiles][0]];
  for (let attempt = 1; attempt <= profile.attempts; attempt += 1) {
    const status = executeCommand(profile.command, [...profile.argv, ...entries.map((entry) => entry.path)]);
    if (status === 0) return 0;
    if (attempt === profile.attempts) {
      if (profile.finalDiagnostic) console.log(profile.finalDiagnostic);
      return status;
    }
    const label = lane === "stripe-deno" ? "Stripe" : lane === "notification-deno" ? "Notification" : lane;
    console.log(`${label} Deno tests failed (attempt ${attempt}), retrying in ${profile.retryDelaySeconds}s...`);
    wait(profile.retryDelaySeconds);
  }
  return 1;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const { lane, through, after } = parseArgs(process.argv.slice(2));
  process.exitCode = runLane(lane, { through, after });
}
