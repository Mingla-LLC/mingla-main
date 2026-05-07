#!/usr/bin/env node
/**
 * I-PROPOSED-Q strict-grep gate — Stripe API version pinned via _shared/stripe.ts only.
 *
 * Gate logic:
 *   For every .ts file in supabase/functions/:
 *     If file (excluding _shared/stripe.ts itself) declares an `apiVersion:` literal
 *     OR imports the Stripe SDK constructor and instantiates it inline with a different
 *     version string → VIOLATION (exit 1)
 *     Unless an allowlist comment exists in the file:
 *       // orch-strict-grep-allow stripe-inline-api-version — <reason>
 *
 * Per B2a Path C SPEC §5 + INVARIANT_REGISTRY I-PROPOSED-Q (post-DEC-121).
 *
 * RATIONALE:
 *   D-B2-5 pins the Stripe API version to `2026-04-30.preview` (Accounts v2 public
 *   preview) globally for the Mingla Connect platform. Inline overrides in individual
 *   edge functions defeat this lock and cause behavioral drift between functions
 *   (e.g., one fn on v1 production, another on v2 preview, with different account
 *   shape contracts and webhook event types).
 *
 *   Taofeek's `feat/b2-stripe-connect` branch demonstrated the failure mode: every
 *   edge function instantiated `new Stripe(...)` with `apiVersion: "2024-11-20.acacia"`
 *   inline, producing a parallel Stripe v1 universe that couldn't access Accounts v2
 *   controller properties (DEC-114 marketplace setup).
 *
 *   Single source of truth: `supabase/functions/_shared/stripe.ts` exports the `stripe`
 *   client + `STRIPE_API_VERSION` constant. All edge functions import from there.
 *
 * EXEMPTIONS:
 *   - `_shared/stripe.ts` itself (where the canonical pin lives)
 *   - Test fixtures + IMPL pre-flight setup (use allowlist comment)
 *
 * Exit codes:
 *   0 — no violations (clean)
 *   1 — at least one violation
 *   2 — script error
 *
 * Established by: B2a Path C SPEC + DEC-121 [confirmed at CLOSE].
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIRS = [join(REPO_ROOT, "supabase", "functions")];

const ALLOWLIST_TAG = "orch-strict-grep-allow stripe-inline-api-version";

// File path that holds the canonical pin — exempt from this gate by design.
const CANONICAL_STRIPE_CLIENT_PATH = join(
  REPO_ROOT,
  "supabase",
  "functions",
  "_shared",
  "stripe.ts",
);

// Match `apiVersion:` followed by a Stripe-style date string (e.g., "2026-04-30.preview"
// or "2024-11-20.acacia"). Fence on date pattern to avoid false positives on unrelated
// `apiVersion:` properties in non-Stripe code.
const INLINE_API_VERSION_REGEX =
  /apiVersion\s*:\s*["']20[0-9]{2}-[0-9]{2}-[0-9]{2}/;

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

function reportViolation(filePath, lineNumber, lineText) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-PROPOSED-Q violation in ${rel}:${lineNumber}`);
  console.error(`  ${lineText.trim()}`);
  console.error(
    `  Inline apiVersion overrides defeat the global Stripe API version pin (D-B2-5).`,
  );
  console.error(
    `  Use the canonical client: import { stripe } from "../_shared/stripe.ts";`,
  );
  console.error(
    `  Allowlist (rare): // orch-strict-grep-allow stripe-inline-api-version — <reason>`,
  );
  console.error(
    `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-Q`,
  );
  console.error("");
  violations += 1;
}

function scanFile(filePath) {
  filesScanned += 1;

  // Exempt the canonical Stripe client file
  if (filePath === CANONICAL_STRIPE_CLIENT_PATH) return;

  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (err) {
    const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
    console.error(`READ-FAIL: ${rel} — ${err.message}`);
    readFailures += 1;
    return;
  }

  if (source.includes(ALLOWLIST_TAG)) return;

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!INLINE_API_VERSION_REGEX.test(line)) continue;

    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    reportViolation(filePath, i + 1, line);
  }
}

try {
  for (const dir of SCAN_DIRS) {
    for (const file of walkTs(dir)) {
      scanFile(file);
    }
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

console.error("");
console.error(
  `I-PROPOSED-Q gate: scanned ${filesScanned} .ts files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
