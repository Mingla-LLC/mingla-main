#!/usr/bin/env node
/**
 * I-PROPOSED-V strict-grep gate — Stripe edge fns must dispatch via notify-dispatch.
 *
 * Status: DRAFT — flips ACTIVE on B2a Path C V3 CLOSE.
 *
 * Gate logic:
 *   For every supabase/functions/{brand-stripe-*,stripe-*}/index.ts (NOT
 *   notify-dispatch itself):
 *     Flag direct usage of:
 *       - imports of `_shared/push-utils` (or any module re-exporting sendPush)
 *       - imports of the Resend SDK (`from "resend"`, `from "https://esm.sh/resend"`)
 *       - direct fetch calls to `https://api.resend.com/`
 *       - direct calls to `sendPush(`
 *     Allowlist tag exemption: `// orch-strict-grep-allow stripe-notification-direct — <reason>`
 *     anywhere in the file.
 *
 * Per B2a Path C V3 SPEC §3 + INVARIANT_REGISTRY I-PROPOSED-V (post-DEC-121).
 *
 * RATIONALE:
 *   Centralized notification dispatch ensures: (a) consistent multi-channel delivery
 *   (email + push + in-app), (b) respects user preferences (notification_preferences
 *   table), (c) provides a single surface for analytics + quiet-hours + unsubscribe,
 *   (d) all notifications get an audit_log row + a persisted notifications row for
 *   in-app inbox surfacing, (e) future channels (e.g., SMS) can be added in one
 *   place. Direct sendPush/Resend bypasses all of this and creates fragmentation.
 *
 *   Acceptable pattern: `supabase.functions.invoke('notify-dispatch', { body: {...} })`.
 *
 * EXEMPTIONS:
 *   - `notify-dispatch/index.ts` itself (the central dispatcher — must use the
 *     primitives directly)
 *   - `_shared/push-utils.ts` (the push primitive — exempt from scanning)
 *   - Test files
 *   - Files using the allowlist tag
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation
 *   2 — script error
 *
 * Established by: B2a Path C V3 SPEC + DEC-121 [confirmed at CLOSE].
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIR = join(REPO_ROOT, "supabase", "functions");

const ALLOWLIST_TAG = "orch-strict-grep-allow stripe-notification-direct";

// Forbidden patterns (any one match in a file = violation, with allowlist
// tag opt-out).
const FORBIDDEN_PATTERNS = [
  {
    re: /from\s+["'][^"']*\/_shared\/push-utils["']/,
    label: "import from _shared/push-utils",
    fix: "Use supabase.functions.invoke('notify-dispatch', { body: {...} }) instead.",
  },
  {
    re: /from\s+["'](?:resend|https?:\/\/[^"']*\/resend[^"']*)["']/,
    label: "import of Resend SDK",
    fix: "Use supabase.functions.invoke('notify-dispatch', ...) — notify-dispatch wraps Resend.",
  },
  {
    re: /["']https:\/\/api\.resend\.com\b/,
    label: "direct fetch to Resend HTTP API",
    fix: "Use supabase.functions.invoke('notify-dispatch', ...) — never call Resend HTTP directly.",
  },
  {
    re: /\bsendPush\s*\(/,
    label: "direct sendPush() call",
    fix: "Use supabase.functions.invoke('notify-dispatch', ...) — sendPush is for notify-dispatch internal use.",
  },
];

function isStripeEdgeFnEntry(filePath) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  if (!rel.startsWith("supabase/functions/")) return false;
  if (!rel.endsWith("/index.ts") && !rel.endsWith(".ts")) return false;
  const parts = rel.slice("supabase/functions/".length).split("/");
  const fnName = parts[0];
  // Skip notify-dispatch (it IS the dispatcher), _shared (primitives layer)
  if (fnName === "notify-dispatch") return false;
  if (fnName === "_shared") return false;
  // Only scan brand-stripe-* and stripe-* edge fns
  if (!fnName.startsWith("brand-stripe-") && !fnName.startsWith("stripe-")) {
    return false;
  }
  // Skip test files
  if (rel.includes("/__tests__/") || rel.endsWith(".test.ts")) return false;
  return true;
}

let violations = 0;
let filesScanned = 0;
let readFailures = 0;

function* walkTs(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".git") continue;
      yield* walkTs(full);
    } else if (st.isFile() && entry.endsWith(".ts")) {
      yield full;
    }
  }
}

function reportViolation(filePath, lineNumber, lineText, label, fix) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-PROPOSED-V violation in ${rel}:${lineNumber}`);
  console.error(`  ${lineText.trim()}`);
  console.error(`  Forbidden: ${label}`);
  console.error(`  ${fix}`);
  console.error(
    `  Allowlist (rare): // orch-strict-grep-allow stripe-notification-direct — <reason>`,
  );
  console.error(
    `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-V`,
  );
  console.error("");
  violations += 1;
}

function scanFile(filePath) {
  filesScanned += 1;
  if (!isStripeEdgeFnEntry(filePath)) return;

  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
    console.error(`READ-FAIL: ${rel} — ${err.message}`);
    readFailures += 1;
    return;
  }

  // Whole-file allowlist tag opt-out
  if (source.includes(ALLOWLIST_TAG)) return;

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Skip pure comment lines so we don't flag examples in doc comments
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    for (const pat of FORBIDDEN_PATTERNS) {
      if (pat.re.test(line)) {
        reportViolation(filePath, i + 1, line, pat.label, pat.fix);
        break;
      }
    }
  }
}

try {
  for (const file of walkTs(SCAN_DIR)) {
    scanFile(file);
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

console.error("");
console.error(
  `I-PROPOSED-V gate: scanned ${filesScanned} .ts files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
