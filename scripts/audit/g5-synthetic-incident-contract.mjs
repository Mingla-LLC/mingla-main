#!/usr/bin/env node
/**
 * #426 G5 — CI contract: synthetic incident drill gate scaffolding present.
 */

import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const paths = {
  runbook: join(root, "docs/runbooks/SYNTHETIC_INCIDENT_DRILL.md"),
  edgeIncident: join(root, "docs/runbooks/INCIDENT_EDGE_FUNCTION_STORM.md"),
  dbIncident: join(root, "docs/runbooks/INCIDENT_DATABASE_DOWN.md"),
  evidence: join(root, "docs/evidence/g5-synthetic-incident/README.md"),
  template: join(root, "docs/evidence/g5-synthetic-incident/DRILL_REPORT.template.md"),
  drill: join(root, "scripts/ops/g5-synthetic-incident-drill.sh"),
  inject: join(root, "scripts/ops/inject-g5-synthetic-alert.mjs"),
  g3Evidence: join(root, "docs/evidence/g3-sentry/README.md"),
};

const runbook = readFileSync(paths.runbook, "utf8");
const edgeIncident = readFileSync(paths.edgeIncident, "utf8");
const dbIncident = readFileSync(paths.dbIncident, "utf8");
const evidence = readFileSync(paths.evidence, "utf8");
const template = readFileSync(paths.template, "utf8");
const drill = readFileSync(paths.drill, "utf8");
const inject = readFileSync(paths.inject, "utf8");

const drillExecutable =
  (() => {
    try {
      return (statSync(paths.drill).mode & 0o111) !== 0;
    } catch {
      return false;
    }
  })();

const checks = [
  [runbook.includes("G5"), "runbook references G5"],
  [runbook.includes("T0"), "runbook timed phases"],
  [runbook.includes("15 min"), "runbook P0 ack SLA"],
  [runbook.includes("30 min"), "runbook P1 ack SLA"],
  [runbook.includes("inject-g5-synthetic-alert.mjs"), "runbook inject script"],
  [runbook.includes("g5-synthetic-incident-drill.sh"), "runbook drill script"],
  [edgeIncident.includes("SYNTHETIC_INCIDENT_DRILL.md"), "edge incident links G5 drill"],
  [dbIncident.includes("SYNTHETIC_INCIDENT_DRILL.md"), "db incident links G5 drill"],
  [evidence.includes("G5"), "G5 evidence README"],
  [evidence.includes("g5-synthetic-incident-contract.mjs"), "G5 evidence CI contract doc"],
  [evidence.includes("G3"), "G5 evidence documents G3 prerequisite"],
  [template.includes("t0_drillStartUtc"), "drill report template timestamps"],
  [template.includes("slaMet"), "drill report template SLA field"],
  [drill.includes("cmd_start"), "drill script start command"],
  [drill.includes("write_report"), "drill script JSON report writer"],
  [inject.includes("drill:g5"), "inject script tags drill:g5"],
  [inject.includes("G5SyntheticIncident"), "inject script synthetic error type"],
  [readFileSync(paths.g3Evidence, "utf8").includes("Sentry"), "G3 sentry evidence exists"],
  [drillExecutable, "g5-synthetic-incident-drill.sh is executable"],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL g5-synthetic-incident-contract: missing ${label}`);
    failed += 1;
  }
}

if (failed > 0) process.exit(1);
console.log("OK g5-synthetic-incident-contract");
