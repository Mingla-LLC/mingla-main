#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const targetRel = "mingla-business/app/(tabs)/home.tsx";
const targetAbs = path.join(repoRoot, targetRel);

const signatures = [
  "STUB_UPCOMING_ROWS",
  "StubUpcomingRow",
  "Sunday Languor Brunch",
  "The Long Lunch (Series)",
  "1 live · 2 upcoming",
  "Tonight · 21:00",
  "Math.round(liveEvent.soldGbp / 30)",
  "/ 400",
  "currentBrand?.currentLiveEvent",
  "currentBrand.currentLiveEvent",
];

let source;
try {
  source = fs.readFileSync(targetAbs, "utf8");
} catch (error) {
  console.error(
    `I-PROPOSED-Z ERROR: could not read ${targetRel}: ${error.message}`,
  );
  process.exit(2);
}

const lines = source.split(/\r?\n/);
const violations = [];

lines.forEach((line, index) => {
  for (const signature of signatures) {
    if (line.includes(signature)) {
      violations.push({
        line: index + 1,
        signature,
        text: line.trim(),
      });
    }
  }
});

if (violations.length > 0) {
  console.error(
    "I-PROPOSED-Z violation: Home must not render fabricated event rows or hardcoded event metrics.",
  );
  console.error(
    "Fix: derive Home event truth from liveEventStore, draftEventStore, and orderStore.",
  );
  console.error(
    "Cross-reference: Mingla_Artifacts/specs/SPEC_ORCH-0754_BUSINESS_HOME_UPCOMING_STUB_DATA.md",
  );
  for (const violation of violations) {
    console.error(
      `${targetRel}:${violation.line}: ${violation.signature} :: ${violation.text}`,
    );
  }
  process.exit(1);
}

console.log(
  "I-PROPOSED-Z PASS: Home contains no fabricated upcoming-event signatures.",
);
