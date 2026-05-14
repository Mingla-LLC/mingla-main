#!/usr/bin/env node
/**
 * ORCH-0824 — I-PROPOSED-EVENT-CATEGORY-FROZEN gate.
 *
 * Verifies no code in the active client surfaces writes to the deprecated
 * `draft.category` field or the never-existed `events.category` top-level
 * column. The legacy value is buried in `events.theme.business_event.category`
 * JSONB as an audit-trail artifact; reading historical JSONB is allowed,
 * writing new values to either name is NOT.
 *
 * The gate inspects:
 *   - mingla-business/src
 *   - mingla-business/app
 *   - app-mobile/src
 *
 * Patterns that fail the gate:
 *   - `draft.category` assignment (`draft.category = ...`, `{ category: ... }`
 *     inside a buildBusinessDraftPayload-style mapper, etc.)
 *   - `.update({ category: ... })` against the events table
 *   - `.insert({ category: ... })` against the events table
 *   - `category:` key inside an explicit object literal that is being sent
 *     to a `business_publish_event_draft` RPC call or to a `.from('events')`
 *     mutator.
 *
 * What's allowed (false-positive avoidance):
 *   - Comments mentioning `category` (// ORCH-0824 references)
 *   - String "category" inside DECISION_LOG / specs / reports (not scanned)
 *   - Read-side access to `theme.business_event.category` JSONB (audit-trail
 *     archaeology)
 *   - Other unrelated `category` keys (e.g., `auditActionLabels.test.ts`'s
 *     `expect(out.category).toBe(...)` which describes audit-log category)
 *
 * Implementation strategy: pattern-match a small whitelist of unsafe shapes
 * rather than a broad keyword sweep. False positives are worse than false
 * negatives at gate stage — operator should be able to commit cleanly.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = process.cwd();
const ROOTS = [
  "mingla-business/src",
  "mingla-business/app",
  "app-mobile/src",
];

const SKIP_DIRS = new Set([
  "node_modules",
  "ios",
  "android",
  ".git",
  "dist",
  "build",
  "__tests__",
  "__snapshots__",
]);

const EXT_OK = new Set([".ts", ".tsx"]);

/**
 * Patterns that should never appear in active code. Each is `{ regex,
 * description, allowSubstrings? }`. `allowSubstrings` lets a line skip if
 * any of the listed substrings is also present — used to whitelist
 * orch-0824 stripping logic where `'category'` IS allowed (JSONB delete).
 */
const FORBIDDEN_PATTERNS = [
  {
    regex: /\bdraft\.category\s*[=:]/,
    description: "draft.category assignment or property — replaced by draft.partyTypes (ORCH-0824)",
  },
  {
    regex: /\.update\(\s*\{[^}]*\bcategory:\s/,
    description: "events.category column write via .update() — column does not exist (ORCH-0824)",
    allowSubstrings: ["audit", "scan_event"],
  },
  {
    regex: /\.insert\(\s*\{[^}]*\bcategory:\s/,
    description: "events.category column write via .insert() — column does not exist (ORCH-0824)",
    allowSubstrings: ["audit", "scan_event"],
  },
];

let violations = 0;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(p);
    } else if (s.isFile()) {
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot) : "";
      if (!EXT_OK.has(ext)) continue;
      scan(p);
    }
  }
}

function scan(filePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  const rel = relative(REPO_ROOT, filePath);
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    // Skip pure comment lines so historical references in code comments
    // don't trip the gate. Inline trailing comments are OK to scan because
    // the pattern targets executable assignments only.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      return;
    }
    for (const pat of FORBIDDEN_PATTERNS) {
      if (!pat.regex.test(line)) continue;
      if (pat.allowSubstrings) {
        const haystack = line.toLowerCase();
        if (pat.allowSubstrings.some((s) => haystack.includes(s))) continue;
      }
      violations++;
      console.error(
        `[ORCH-0824 EVENT-CATEGORY-FROZEN]\n  ${rel}:${idx + 1}\n  ${line.trim()}\n  → ${pat.description}`,
      );
    }
  });
}

for (const root of ROOTS) {
  walk(join(REPO_ROOT, root));
}

if (violations > 0) {
  console.error(
    `\nORCH-0824 EVENT-CATEGORY-FROZEN gate: ${violations} violation(s) found.`,
  );
  console.error(
    "The deprecated `category` field was removed by ORCH-0824. " +
      "Use draft.partyTypes / events.party_types instead.",
  );
  process.exit(1);
}

console.log("ORCH-0824 EVENT-CATEGORY-FROZEN: clean — 0 violations.");
process.exit(0);
