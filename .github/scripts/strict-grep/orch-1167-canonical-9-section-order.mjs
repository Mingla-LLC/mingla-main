#!/usr/bin/env node
/**
 * ORCH-1167 [event-page-canonical] — I-PROPOSED-1167-CANONICAL-9-SECTION-ORDER.
 *
 * The shared `EventOfferingBody` renders the canonical structure in the locked
 * order. This gate asserts the body emits the section markers in the SPEC §3A order
 * (2..8 inside the body; cover=1 + floating bar=9 are surface-owned), so a reorder
 * trips CI. It anchors on stable section comments/testIDs in
 * packages/offering-rendering/EventOfferingBody.tsx:
 *   (2) Event name lead block
 *   (3) Date & time meta chips
 *   (4) Pills row              → testID "orch-1167-pills-row"
 *   (5) TICKET BOX             → testID "orch-1167-ticket-box"
 *   (6) Presented By           → "Presented by"
 *   (7) About                  → secTitle "About"
 *   (8) Where you'll be        → "Where you" (Where you'll be)
 *
 * Fails if any anchor is missing OR they appear out of order. Self-test proves a
 * reordered body trips the gate.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const BODY = "packages/offering-rendering/EventOfferingBody.tsx";

// Ordered anchors (string searched in raw source, first-occurrence index).
const ANCHORS = [
  ["(2) Event name", "(2) Event name lead block"],
  ["(3) Date & time", "(3) Date & time meta chips"],
  ["(4) Pills row", 'testID="orch-1167-pills-row"'],
  ["(5) TICKET BOX", 'testID="orch-1167-ticket-box"'],
  ["(6) Presented By", "(6) Presented By"],
  ["(7) About", "(7) About"],
  ["(8) Where", "(8) Where you'll be"],
];

function check(src, label) {
  const failures = [];
  let prev = -1;
  let prevName = "<start>";
  for (const [name, needle] of ANCHORS) {
    const idx = src.indexOf(needle);
    if (idx === -1) {
      failures.push(`${label}: missing section anchor ${name} ("${needle}").`);
      continue;
    }
    if (idx < prev) {
      failures.push(
        `${label}: section ${name} appears BEFORE ${prevName} — the canonical ` +
          "9-section order (SPEC §3A) was reordered.",
      );
    }
    prev = idx;
    prevName = name;
  }
  return failures;
}

function runSelfTest() {
  const good = ANCHORS.map(([, n]) => `// ${n}`).join("\n");
  // Swap pills (4) and ticket box (5) to force an out-of-order failure.
  const reordered = [
    "// (2) Event name lead block",
    "// (3) Date & time meta chips",
    '// testID="orch-1167-ticket-box"',
    '// testID="orch-1167-pills-row"',
    "// (6) Presented By",
    "// (7) About",
    "// (8) Where you'll be",
  ].join("\n");
  const goodPasses = check(good, "synthetic-good").length === 0;
  const badFails = check(reordered, "synthetic-bad").length > 0;
  if (!goodPasses) {
    console.error("SELF-TEST FAIL: ordered anchors wrongly tripped the gate.");
    process.exit(1);
  }
  if (!badFails) {
    console.error("SELF-TEST FAIL: reordered sections did not trip the gate.");
    process.exit(1);
  }
  console.log("ORCH-1167 canonical-9-section-order gate SELF-TEST PASS.");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const path = join(root, BODY);
  if (!existsSync(path)) {
    console.error(`ORCH-1167 canonical-9-section-order gate FAILED: ${BODY} missing.`);
    process.exit(1);
  }
  const failures = check(readFileSync(path, "utf8"), BODY);
  if (failures.length > 0) {
    console.error("\nORCH-1167 canonical-9-section-order gate FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("ORCH-1167 canonical-9-section-order gate PASS.");
}
