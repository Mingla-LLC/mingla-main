#!/usr/bin/env node
/**
 * I-PROPOSED-X strict-grep gate — WEB-EXPORT-CLEAN.
 *
 * Parses stderr from expo export -p web and fails on RN-web deprecation
 * warnings or source-owned SSR property errors traceable to mingla-business.
 *
 * Per META-ORCH-0744-PROCESS / SPEC §3.5.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const STDERR_LOG_PATH = process.argv[2] ?? resolve("/tmp/expo-export-web.stderr");
const FAIL_PATTERNS = [
  {
    re: /"shadow\*"\s+style\s+props\s+are\s+deprecated/gi,
    label: "shadow* deprecation",
    fix: "replace RN-only shadow props with web-safe CSS shadow tokens.",
  },
  {
    re: /"textShadow\*?"\s+style\s+props?\s+are\s+deprecated/gi,
    label: "textShadow* deprecation",
    fix: "remove textShadow* from web-rendered styles or isolate to native-only code.",
  },
  {
    re: /"elevation"\s+(?:style\s+prop|not\s+supported)/gi,
    label: "elevation deprecation",
    fix: "replace elevation with web-safe shadow tokens.",
  },
];
const PROPERTY_NOT_EXIST_RE = /Property\s+'([^']+)'\s+doesn't\s+exist/g;

if (!existsSync(STDERR_LOG_PATH)) {
  console.error(
    `[I-PROPOSED-X] SCRIPT ERROR — stderr log not found at ${STDERR_LOG_PATH}.`,
  );
  console.error(
    "Fix: capture `expo export -p web` stderr before running this parser.",
  );
  process.exit(2);
}

const stderr = readFileSync(STDERR_LOG_PATH, "utf8");
const violations = [];

for (const pattern of FAIL_PATTERNS) {
  const matches = stderr.match(pattern.re) ?? [];
  if (matches.length > 0) {
    violations.push({
      kind: pattern.label,
      count: matches.length,
      sample: matches[0],
      fix: pattern.fix,
    });
  }
}

let match;
PROPERTY_NOT_EXIST_RE.lastIndex = 0;
while ((match = PROPERTY_NOT_EXIST_RE.exec(stderr)) !== null) {
  const start = Math.max(0, match.index - 160);
  const end = Math.min(stderr.length, match.index + 260);
  const context = stderr.slice(start, end);
  if (/mingla-business\/(src|app)\//.test(context)) {
    violations.push({
      kind: `Property '${match[1]}' doesn't exist (mingla-business source)`,
      count: 1,
      sample: match[0],
      fix: "fix the source-owned SSR/runtime access or guard it for web export.",
    });
  }
}

if (violations.length > 0) {
  console.error(
    `[I-PROPOSED-X] FAIL — ${violations.length} web-export violation class(es):`,
  );
  for (const violation of violations) {
    console.error(
      `  - ${violation.kind} (${violation.count}x) — violating pattern: "${violation.sample}"`,
    );
    console.error(`    Suggested fix: ${violation.fix}`);
  }
  console.error(
    "\nIf the warning is dependency-owned, add an explicit allowlist in this script with source-path proof.",
  );
  process.exit(1);
}

console.log("[I-PROPOSED-X] PASS — zero web-deprecation warnings.");
process.exit(0);
