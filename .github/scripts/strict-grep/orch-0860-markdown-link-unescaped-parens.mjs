#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0860 [Strict-grep CI gate for unescaped (tabs) parens in markdown links].
 *
 * Markdown links use `[text](url)` — the FIRST `)` terminates the URL. So a
 * link like `[events.tsx](mingla-business/app/(tabs)/hub/events.tsx)` gets
 * silently truncated by markdown parsers at `mingla-business/app/(tabs` —
 * breaking the link and failing the docs-artifact-regression CI gate.
 *
 * This bug class has recurred 3 times in 24 hours (commits 7750f7d6,
 * b2d26b2b, 08852dfc — all hotfix commits to URL-encode parens after CI
 * caught the broken links). This gate catches it BEFORE the docs-artifact-
 * regression gate, with a clearer error message + suggested fix.
 *
 * **Scope:** all .md files under `Mingla_Artifacts/` (where the docs-artifact-
 * regression gate is enforced). Root README + docs/ + per-package READMEs
 * are not scanned (out of the docs-artifact-regression baseline).
 *
 * **Detection:** for each markdown link `[text](url)`, fail if `url` contains
 * an unescaped `(` or `)`. The fix is URL-encoding: `(` → `%28`, `)` → `%29`.
 * GitHub + VS Code preview both resolve the encoded links correctly.
 *
 * **Exit 1 on any FAIL.**
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const SCAN_ROOT = resolve(REPO_ROOT, "Mingla_Artifacts");

// Walk Mingla_Artifacts/ recursively and collect every .md file.
function walkMarkdownFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (name === "archive") continue; // legacy historical — out of scope
      out.push(...walkMarkdownFiles(path));
    } else if (stat.isFile() && name.endsWith(".md")) {
      out.push(path);
    }
  }
  return out;
}

// Find markdown links with unescaped parens in the URL portion.
// Matches `](` then captures the URL up to the FIRST `)` (which is how
// the markdown parser actually behaves). If that captured URL contains
// `(` then the URL is broken because the parser ended it early.
//
// Heuristic for the inverse case (URL contains a `)` that closes a `(`
// inside the URL): if we see `](something_with_paren(` followed by stuff
// then `)`, the first `)` ALREADY closed the URL, so this case is auto-
// caught by the same rule above.
//
// We deliberately use a simple per-line scan rather than full markdown
// AST parsing — keeps the gate fast + zero dependencies.
function findOffendingLinks(content) {
  const lines = content.split("\n");
  const findings = [];
  const linkRe = /\]\(([^)]*)\)/g; // ](URL) — URL is anything up to first `)`
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let match;
    linkRe.lastIndex = 0;
    while ((match = linkRe.exec(line)) !== null) {
      const url = match[1];
      // If the captured URL contains an unescaped `(`, the link is broken —
      // the next `)` will end the URL early, dropping everything after.
      // We allow `%28` and `%29` (already encoded) — those don't appear as
      // literal `(` / `)` in the URL string anyway, so the check is direct.
      if (url.includes("(")) {
        findings.push({
          line: i + 1,
          url,
          suggestion: url.replace(/\(/g, "%28").replace(/\)/g, "%29"),
          column: match.index + 2, // `](` is 2 chars
        });
      }
    }
  }
  return findings;
}

const files = walkMarkdownFiles(SCAN_ROOT);
let totalFindings = 0;
const offendingByFile = new Map();

for (const path of files) {
  const content = readFileSync(path, "utf8");
  const findings = findOffendingLinks(content);
  if (findings.length > 0) {
    offendingByFile.set(path, findings);
    totalFindings += findings.length;
  }
}

console.log("\nORCH-0860 markdown-link unescaped parens gate");
console.log(
  `Scanned ${files.length} .md files under Mingla_Artifacts/ (excluding archive/).\n`,
);

if (totalFindings === 0) {
  console.log("PASS — no broken markdown links found.\n");
  process.exit(0);
}

console.log(`FAIL — ${totalFindings} broken markdown link(s) found:\n`);
for (const [path, findings] of offendingByFile.entries()) {
  const rel = relative(REPO_ROOT, path);
  console.log(`  ${rel}`);
  for (const f of findings) {
    console.log(`    line ${f.line}: ${f.url}`);
    console.log(`      → fix:  ${f.suggestion}`);
  }
  console.log("");
}

console.log(
  "Why this matters: markdown parsers terminate `](url)` at the FIRST `)`. " +
    "A path like `mingla-business/app/(tabs)/hub/events.tsx` is truncated " +
    "to `mingla-business/app/(tabs` — breaking the link and failing the " +
    "docs-artifact-regression CI gate.\n",
);
console.log(
  "Fix: URL-encode parens — `(` → `%28`, `)` → `%29`. GitHub + VS Code " +
    "preview resolve the encoded links correctly. This gate runs BEFORE " +
    "docs-artifact-regression for a clearer error message.\n",
);

process.exit(1);
