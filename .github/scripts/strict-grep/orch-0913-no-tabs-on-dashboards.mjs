#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const FILES = [
  "mingla-business/app/event/[id]/index.tsx",
  "mingla-business/app/trip/[id]/index.tsx",
];

const PATTERN = /accessibilityRole=["']tab["']/g;

if (process.argv.includes("--self-test")) {
  const fixture = '<Pressable accessibilityRole="tab" />';
  const matches = fixture.match(PATTERN);
  if (!matches || matches.length !== 1) {
    console.error("ORCH-0913 dashboard-parity gate self-test FAILED");
    process.exit(1);
  }
  console.log("ORCH-0913 dashboard-parity gate self-test: PASS");
  process.exit(0);
}

let violations = 0;
for (const f of FILES) {
  const src = await readFile(f, "utf8");
  const matches = src.match(PATTERN);
  if (matches) {
    console.error(
      `FAIL ${f}: ${matches.length} accessibilityRole="tab" usage(s) - dashboards must not introduce tab strips for primary content navigation (I-PROPOSED-DASHBOARD-PARITY-TRIP-EVENT, ORCH-0913).`,
    );
    violations += matches.length;
  }
}

if (violations > 0) {
  console.error(
    `\nORCH-0913 dashboard-parity gate FAILED: ${violations} violation(s). See SPEC_ORCH-0913_TRIP_DASHBOARD_PARITY.md section 6.2.`,
  );
  process.exit(1);
}

console.log("ORCH-0913 dashboard-parity gate: PASS (zero tab role on dashboards)");
