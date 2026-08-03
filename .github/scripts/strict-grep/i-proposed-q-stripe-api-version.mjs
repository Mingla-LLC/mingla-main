#!/usr/bin/env node
/**
 * I-PROPOSED-Q strict-grep gate — Stripe SDK apiVersion pinned via _shared/stripe.ts only.
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
 *   D-B2-5 pins Stripe SDK client apiVersion through one shared helper. Inline
 *   SDK overrides in individual edge functions defeat this lock and cause
 *   behavioral drift between functions.
 *
 *   Taofeek's `feat/b2-stripe-connect` branch demonstrated the failure mode: every
 *   edge function instantiated `new Stripe(...)` with `apiVersion: "2024-11-20.acacia"`
 *   inline, producing a parallel Stripe v1 universe that couldn't access Accounts v2
 *   controller properties (DEC-114 marketplace setup).
 *
 *   Single source of truth for SDK clients: `supabase/functions/_shared/stripe.ts`
 *   exports `STRIPE_API_VERSION`. Raw API v2 HTTP calls use their own
 *   `STRIPE_BLUEPRINT_API_VERSION` header contract in `_shared/stripeBlueprintClient.ts`.
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
// Repo-relative form of the canonical pin file (POSIX separators) — the exemption
// lives inside the pure check(...) so it is behavior-preserving AND self-testable.
const CANONICAL_STRIPE_CLIENT_REL = "supabase/functions/_shared/stripe.ts";

// Match `apiVersion:` followed by a Stripe-style date string (e.g., "2026-04-30.preview"
// or "2024-11-20.acacia"). Fence on date pattern to avoid false positives on unrelated
// `apiVersion:` properties in non-Stripe code.
const INLINE_API_VERSION_REGEX =
  /apiVersion\s*:\s*["']20[0-9]{2}-[0-9]{2}-[0-9]{2}/;

let violations = 0;
let filesScanned = 0;
let readFailures = 0;

/**
 * Pure verdict. `fileEntries` = [{ rel, content }] with `rel` the repo-relative
 * POSIX path (used both for the canonical-file exemption and for reporting).
 * Pushes one { rel, line, lineText } record per offending line into `failures`.
 * Behavior-preserving refactor of the original per-line scanFile logic — same
 * verdict on the same inputs.
 */
function check(fileEntries, failures) {
  for (const { rel, content } of fileEntries) {
    // Exempt the canonical Stripe client file (where the pin legitimately lives).
    if (rel === CANONICAL_STRIPE_CLIENT_REL) continue;
    // File-level allowlist tag.
    if (content.includes(ALLOWLIST_TAG)) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!INLINE_API_VERSION_REGEX.test(line)) continue;
      // Skip comments.
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
      failures.push({ rel, line: i + 1, lineText: line });
    }
  }
}

// ─────────────────────────────────────────────────────────────── self-test
if (process.argv.includes("--self-test")) {
  const self = [];
  const run = (entries) => {
    const f = [];
    check(entries, f);
    return f;
  };

  // GOOD: fn importing the shared pin, no inline apiVersion literal → silent.
  let f = run([
    {
      rel: "supabase/functions/brand-stripe-onboard/index.ts",
      content:
        'import { stripe } from "../_shared/stripe.ts";\nconst client = stripe;\n',
    },
  ]);
  if (f.length) self.push("GOOD (shared pin, no inline version) wrongly flagged");

  // BAD1 (revert-style): the acacia inline apiVersion the gate was created to stop.
  f = run([
    {
      rel: "supabase/functions/brand-stripe-onboard/index.ts",
      content:
        'const s = new Stripe(key, { apiVersion: "2024-11-20.acacia" });\n',
    },
  ]);
  if (f.length === 0) self.push("BAD1 (inline apiVersion 2024-11-20.acacia) not flagged");

  // BAD2 (regression, different angle): a DIFFERENT inline version string.
  f = run([
    {
      rel: "supabase/functions/refund-order/index.ts",
      content: '  apiVersion: "2026-04-30.preview",\n',
    },
  ]);
  if (f.length === 0) self.push("BAD2 (inline apiVersion 2026-04-30.preview) not flagged");

  // SPECIFICITY: a file carrying the allowlist tag stays silent even with an inline version.
  f = run([
    {
      rel: "supabase/functions/test-setup/index.ts",
      content:
        "// orch-strict-grep-allow stripe-inline-api-version — impl preflight fixture\n" +
        'const s = new Stripe(key, { apiVersion: "2024-11-20.acacia" });\n',
    },
  ]);
  if (f.length) self.push("allowlisted inline apiVersion wrongly flagged");

  // SPECIFICITY: the canonical pin file itself is exempt (that is where the pin lives).
  f = run([
    {
      rel: CANONICAL_STRIPE_CLIENT_REL,
      content: 'export const STRIPE_API_VERSION = "2024-11-20.acacia";\n',
    },
  ]);
  if (f.length) self.push("canonical _shared/stripe.ts pin wrongly flagged");

  if (self.length) {
    console.error("I-PROPOSED-Q self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("I-PROPOSED-Q self-test PASS (5/5 cases).");
  process.exit(0);
}

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

function reportViolation(rel, lineNumber, lineText) {
  console.error(`ERROR: I-PROPOSED-Q violation in ${rel}:${lineNumber}`);
  console.error(`  ${lineText.trim()}`);
  console.error(
    `  Inline apiVersion overrides defeat the shared Stripe SDK version pin (D-B2-5).`,
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
}

const fileEntries = [];
try {
  for (const dir of SCAN_DIRS) {
    for (const file of walkTs(dir)) {
      filesScanned += 1;
      const rel = relative(REPO_ROOT, file).split(sep).join("/");
      let source;
      try {
        source = readFileSync(file, "utf8");
      } catch (err) {
        console.error(`READ-FAIL: ${rel} — ${err.message}`);
        readFailures += 1;
        continue;
      }
      fileEntries.push({ rel, content: source });
    }
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

const failures = [];
check(fileEntries, failures);
for (const v of failures) {
  reportViolation(v.rel, v.line, v.lineText);
}
violations = failures.length;

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
