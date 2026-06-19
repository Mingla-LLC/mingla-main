#!/usr/bin/env node
/**
 * #426 G4 — CI contract: DR restore gate scaffolding present.
 */

import { readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const paths = {
  runbook: join(root, "docs/runbooks/DR_RESTORE.md"),
  incident: join(root, "docs/runbooks/INCIDENT_DATABASE_DOWN.md"),
  evidence: join(root, "docs/evidence/g4-dr-restore/README.md"),
  template: join(root, "docs/evidence/g4-dr-restore/DRILL_REPORT.template.md"),
  drill: join(root, "scripts/ops/g4-dr-restore-drill.sh"),
};

const runbook = readFileSync(paths.runbook, "utf8");
const incident = readFileSync(paths.incident, "utf8");
const evidence = readFileSync(paths.evidence, "utf8");
const template = readFileSync(paths.template, "utf8");
const drill = readFileSync(paths.drill, "utf8");

const drillExecutable =
  (() => {
    try {
      const mode = statSync(paths.drill).mode & 0o111;
      return mode !== 0;
    } catch {
      return false;
    }
  })();

const checks = [
  [runbook.includes("G4"), "DR runbook references G4"],
  [runbook.includes("T0"), "DR runbook timed phases (T0)"],
  [runbook.includes("PITR"), "DR runbook PITR procedure"],
  [runbook.includes("g4-dr-restore-drill.sh"), "DR runbook drill script link"],
  [runbook.includes("gqnoajqerqhnvulmnyvv"), "DR runbook staging project ref"],
  [incident.includes("DR_RESTORE.md"), "incident runbook links DR_RESTORE"],
  [evidence.includes("G4"), "G4 evidence README"],
  [evidence.includes("g4-dr-restore-contract.mjs"), "G4 evidence CI contract doc"],
  [template.includes("t0_decisionUtc"), "drill report template timestamps"],
  [drill.includes("cmd_start"), "drill script start command"],
  [drill.includes("cmd_verify"), "drill script verify command"],
  [drill.includes("write_report"), "drill script JSON report writer"],
  [drillExecutable, "g4-dr-restore-drill.sh is executable"],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL g4-dr-restore-contract: missing ${label}`);
    failed += 1;
  }
}

if (failed > 0) process.exit(1);
console.log("OK g4-dr-restore-contract");
