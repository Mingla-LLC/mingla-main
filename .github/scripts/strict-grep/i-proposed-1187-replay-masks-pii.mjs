#!/usr/bin/env node

/**
 * I-PROPOSED-1187-REPLAY-MASKS-PII (META-ORCH-1187 [Growth Analytics Hub] Phase 1)
 *
 * WHY (SECURITY GATE, §4.H / §SC-Security): session replay must mask all input
 * fields by default. A replay capturing a card field, email, password, or any
 * PII = an AUTOMATIC FAIL. This gate is the structural fails-on-revert safeguard
 * for the masking contract; the runtime recording inspection (T-16/T-17) is the
 * behavioral proof.
 *
 * GATE:
 *   1. NO client file may set any masking flag to false:
 *      `maskAllInputs: false` (web posthog-js),
 *      `maskAllTextInputs: false` / `maskAllImages: false` (native posthog-react-native).
 *   2. Every web PostHog init that enables replay (`disable_session_recording:
 *      false` and/or a `session_recording` block) MUST keep `maskAllInputs: true`.
 *
 * SCOPE: client app trees. Tests / gate scripts / artifacts exempt.
 *
 * FAILS-ON-REVERT: flipping any mask flag to false, or enabling web replay
 * without maskAllInputs:true, fails this gate.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

const SCAN_DIRS = ["mingla-marketing", "mingla-business", "app-mobile"];
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

const FORBIDDEN_FALSE = [
  /maskAllInputs\s*:\s*false/,
  /maskAllTextInputs\s*:\s*false/,
  /maskAllImages\s*:\s*false/,
];

function isExempt(rel) {
  if (rel.includes("__tests__")) return true;
  if (/\.test\.[tj]sx?$/.test(rel)) return true;
  if (rel.includes("node_modules")) return true;
  if (rel.includes(".next/")) return true;
  return false;
}

// Strip comments so doc-comment prose (e.g. "never set maskAllInputs: false")
// does not trip the false-flag detector.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(full, out);
    } else if (CODE_EXT.has(path.extname(e.name))) {
      out.push(full);
    }
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(path.join(repoRoot, d), files);

const offenders = [];
const replayUnmasked = [];

for (const file of files) {
  const rel = path.relative(repoRoot, file);
  if (isExempt(rel)) continue;
  const contents = stripComments(fs.readFileSync(file, "utf8"));

  for (const re of FORBIDDEN_FALSE) {
    if (re.test(contents)) {
      offenders.push(`${rel} (matched ${re.source})`);
      break;
    }
  }

  // Web replay enabled (session_recording block present) must keep masking on.
  if (
    /session_recording\s*:/.test(contents) &&
    !/maskAllInputs\s*:\s*true/.test(contents)
  ) {
    replayUnmasked.push(rel);
  }
}

if (offenders.length > 0 || replayUnmasked.length > 0) {
  console.error("FAIL: I-PROPOSED-1187-REPLAY-MASKS-PII violated (SECURITY)");
  if (offenders.length > 0) {
    console.error(`\n${offenders.length} file(s) disable session-replay masking:`);
    for (const f of offenders) console.error(`  - ${f}`);
  }
  if (replayUnmasked.length > 0) {
    console.error(
      `\n${replayUnmasked.length} web replay config(s) missing maskAllInputs:true:`,
    );
    for (const f of replayUnmasked) console.error(`  - ${f}`);
  }
  console.error(
    "\nSession replay MUST keep masking ON everywhere (META-ORCH-1187 §4.H). A replay capturing PII = automatic FAIL.",
  );
  process.exit(1);
}

console.log(
  `OK: I-PROPOSED-1187-REPLAY-MASKS-PII — ${files.length} client files scanned, masking intact`,
);
