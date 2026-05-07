#!/usr/bin/env node
/**
 * I-PROPOSED-W strict-grep gate — notifications table reads must filter by app-type prefix.
 *
 * Status: DRAFT — flips ACTIVE on B2a Path C V3 CLOSE.
 *
 * Gate logic:
 *   The `public.notifications` table is shared across all Mingla frontends. UI
 *   scoping is achieved by app-specific type-prefix filters at read time.
 *
 *   Consumer app reads (app-mobile/src/) MUST exclude rows where type matches
 *     `stripe.%` or `business.%`.
 *   Mingla Business app reads (mingla-business/src/) MUST include only rows
 *     where type matches `stripe.%` or `business.%`.
 *
 *   For each `.from('notifications')` chain, look forward up to 25 lines for the
 *   chained query ops. Treat the chain as SAFE if any of:
 *     - Chain contains `.delete(` or `.update(` or `.insert(` — modifying ops
 *       are not cross-type contamination risks (they target by id or by
 *       explicit type filter).
 *     - Chain contains `.eq('type', ...)` (or `.eq("type", ...)`) — the query
 *       is already scoped to a specific known type, so cannot leak across apps.
 *     - Chain contains the consumer-side exclusion: BOTH
 *       `.not('type', 'like', 'stripe.%')` AND `.not('type', 'like', 'business.%')`
 *       (or `ilike` variants).
 *     - Chain contains the business-side inclusion: `.or('type.like.stripe.%`
 *       or `.like('type', 'stripe.%')` or `.like('type', 'business.%')`.
 *     - File contains the allowlist tag.
 *
 * Per B2a Path C V3 SPEC §6 + INVARIANT_REGISTRY I-PROPOSED-W (post-Sub-dispatch-A hotfix).
 *
 * RATIONALE:
 *   Mingla's architecture uses one Supabase backend across all frontends, with one
 *   `notifications` table keyed by auth.users.id. A user who is both a consumer
 *   and a brand admin = same auth.users.id row = one notifications inbox at the
 *   data layer. UI scoping is achieved by type prefix filtering, not separate
 *   tables. Without this filter, a consumer scrolling their inbox would see
 *   "Your KYC deadline is in 3 days" alongside "Sarah liked your event" —
 *   confusing UX and a privacy/intent leak across product surfaces.
 *
 * NAMING CONVENTION:
 *   stripe.* — Mingla Business only (B2 cycle types)
 *   business.* — Mingla Business only (future B2/B3/B5 types)
 *   anything else — Mingla consumer only
 *
 * SCAN SURFACES:
 *   - app-mobile/src/ — must EXCLUDE stripe.% and business.%
 *   - mingla-business/src/ — must INCLUDE stripe.% or business.% (or eq.type
 *     to a specific known business/stripe type)
 *   - mingla-admin/src/ — exempt by design (cross-app reads for support)
 *
 * EXEMPTIONS:
 *   - Test files
 *   - mingla-admin (entire surface)
 *   - Files using `// orch-strict-grep-allow notifications-cross-app-read — <reason>`
 *
 * Exit codes:
 *   0 — no violations
 *   1 — at least one violation
 *   2 — script error
 *
 * Established by: B2a Path C V3 Sub-dispatch A hotfix 2026-05-06 [confirmed at V3 CLOSE].
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const ALLOWLIST_TAG = "orch-strict-grep-allow notifications-cross-app-read";

const SCAN_TARGETS = [
  {
    dir: join(REPO_ROOT, "app-mobile", "src"),
    side: "consumer",
  },
  {
    dir: join(REPO_ROOT, "mingla-business", "src"),
    side: "business",
  },
];

const FROM_NOTIFICATIONS_REGEX = /\.from\s*\(\s*["']notifications["']\s*\)/;

// Modifying ops — exempt
const MODIFY_OP_REGEX = /\.\s*(?:delete|update|insert|upsert)\s*\(/;

// type-eq scoping — exempt (query targets specific known type)
const TYPE_EQ_REGEX = /\.\s*eq\s*\(\s*["']type["']\s*,/;

// Consumer-side exclusion: BOTH not(type, like, stripe.%) AND not(type, like, business.%)
const CONSUMER_NOT_STRIPE_REGEX =
  /\.\s*not\s*\(\s*["']type["']\s*,\s*["']i?like["']\s*,\s*["']stripe\.%["']\s*\)/;
const CONSUMER_NOT_BUSINESS_REGEX =
  /\.\s*not\s*\(\s*["']type["']\s*,\s*["']i?like["']\s*,\s*["']business\.%["']\s*\)/;

// Business-side inclusion patterns (any one suffices)
const BUSINESS_INCLUSION_PATTERNS = [
  /\.\s*or\s*\(\s*["'][^"']*type\.i?like\.stripe\.%[^"']*["']/,
  /\.\s*or\s*\(\s*["'][^"']*type\.i?like\.business\.%[^"']*["']/,
  /\.\s*like\s*\(\s*["']type["']\s*,\s*["']stripe\.%["']\s*\)/,
  /\.\s*like\s*\(\s*["']type["']\s*,\s*["']business\.%["']\s*\)/,
  /\.\s*ilike\s*\(\s*["']type["']\s*,\s*["']stripe\.%["']\s*\)/,
  /\.\s*ilike\s*\(\s*["']type["']\s*,\s*["']business\.%["']\s*\)/,
];

let violations = 0;
let filesScanned = 0;
let readFailures = 0;

function* walkTsTsx(dir) {
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
      if (entry === "node_modules" || entry === ".git" || entry === ".expo") {
        continue;
      }
      yield* walkTsTsx(full);
    } else if (
      st.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx"))
    ) {
      yield full;
    }
  }
}

function isExemptFile(filePath) {
  return (
    filePath.endsWith(".test.ts") ||
    filePath.endsWith(".test.tsx") ||
    filePath.includes(`${sep}__tests__${sep}`)
  );
}

function reportViolation(filePath, lineNumber, lineText, side, reason) {
  const rel = relative(REPO_ROOT, filePath).split(sep).join("/");
  console.error(`ERROR: I-PROPOSED-W violation in ${rel}:${lineNumber}`);
  console.error(`  ${lineText.trim()}`);
  console.error(`  ${reason}`);
  if (side === "consumer") {
    console.error(
      `  Add: .not('type', 'like', 'stripe.%').not('type', 'like', 'business.%')`,
    );
  } else {
    console.error(
      `  Add: .or('type.like.stripe.%,type.like.business.%') (or .like / .ilike with the prefixes)`,
    );
  }
  console.error(
    `  Allowlist (rare): // orch-strict-grep-allow notifications-cross-app-read — <reason>`,
  );
  console.error(
    `  See: Mingla_Artifacts/INVARIANT_REGISTRY.md I-PROPOSED-W`,
  );
  console.error("");
  violations += 1;
}

function chainHas(chainText, pattern) {
  return pattern.test(chainText);
}

function chainHasAny(chainText, patterns) {
  return patterns.some((p) => p.test(chainText));
}

function scanFile(filePath, side) {
  filesScanned += 1;
  if (isExemptFile(filePath)) return;

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
    if (!FROM_NOTIFICATIONS_REGEX.test(line)) continue;

    // Skip pure comment lines
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    // Capture the chain: from this line, look forward up to 25 lines (until
    // the chain semicolon or `await` boundary).
    const chainEnd = Math.min(lines.length, i + 25);
    const chainText = lines.slice(i, chainEnd).join("\n");

    // Modifying ops — exempt
    if (chainHas(chainText, MODIFY_OP_REGEX)) continue;

    // Type-eq scoping — exempt (query is already pinned to a specific type)
    if (chainHas(chainText, TYPE_EQ_REGEX)) continue;

    if (side === "consumer") {
      const hasStripeNot = chainHas(chainText, CONSUMER_NOT_STRIPE_REGEX);
      const hasBusinessNot = chainHas(chainText, CONSUMER_NOT_BUSINESS_REGEX);
      if (hasStripeNot && hasBusinessNot) continue;
      reportViolation(
        filePath,
        i + 1,
        line,
        side,
        "Consumer notifications query does not exclude stripe.% AND business.% prefixes.",
      );
    } else if (side === "business") {
      if (chainHasAny(chainText, BUSINESS_INCLUSION_PATTERNS)) continue;
      reportViolation(
        filePath,
        i + 1,
        line,
        side,
        "Mingla Business notifications query does not include stripe.% or business.% prefix.",
      );
    }
  }
}

try {
  for (const target of SCAN_TARGETS) {
    for (const file of walkTsTsx(target.dir)) {
      scanFile(file, target.side);
    }
  }
} catch (err) {
  console.error(`SCRIPT ERROR: ${err.message}`);
  process.exit(2);
}

console.error("");
console.error(
  `I-PROPOSED-W gate: scanned ${filesScanned} .ts/.tsx files · ${violations} violations · ${readFailures} read failures`,
);

if (readFailures > 0 && filesScanned === readFailures) {
  process.exit(2);
}
if (violations > 0) {
  process.exit(1);
}
process.exit(0);
