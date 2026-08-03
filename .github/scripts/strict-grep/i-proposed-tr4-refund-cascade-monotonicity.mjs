#!/usr/bin/env node
/**
 * I-PROPOSED-TR4-REFUND-CASCADE-MONOTONICITY strict-grep gate.
 *
 * Enforces ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] invariant: every
 * code path that writes `events.refund_policy` MUST flow through a validator
 * that calls the IMMUTABLE `validate_refund_policy()` SQL function. The DB
 * CHECK constraint `events_refund_policy_valid` is the authoritative
 * enforcement, but this gate adds defense-in-depth at the client + edge fn
 * layer: any code that bypasses the validator (e.g. raw `from('events').update({refund_policy: ...})`
 * without first calling the service helper) gets caught.
 *
 * Detection rule: scan TypeScript files under `mingla-business/` for any
 * call to `.update(` whose surrounding 5 lines reference `refund_policy:`.
 * Each such hit must either:
 *   (a) live in `src/services/refundPolicyService.ts` (the canonical
 *       validator) which performs client-side monotonicity checks BEFORE
 *       the DB write, OR
 *   (b) carry an allowlist comment within 5 lines above the call:
 *       `// orch-strict-grep-allow tr4-refund-cascade-monotonicity — <reason>`
 *
 * Established by: ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] CLOSE.
 * Invariant flips DRAFT → ACTIVE on close.
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SCAN_DIR = join(REPO_ROOT, "mingla-business");
const OWNER_FILE_REL = "mingla-business/src/services/refundPolicyService.ts";
const ALLOWLIST_TAG =
  "orch-strict-grep-allow tr4-refund-cascade-monotonicity";

const UPDATE_RE = /\.update\s*\(/;
const REFUND_POLICY_RE = /refund_policy\s*:/;
const CONTEXT_LINES = 5;
const SKIP_DIRS = new Set(["node_modules", ".next", ".expo", "dist", "build"]);

let violations = 0;
let filesScanned = 0;

function* walkTs(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      yield* walkTs(full);
    } else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      yield full;
    }
  }
}

/**
 * Pure verdict. `fileEntries` = [{ rel, content }] with `rel` the repo-relative
 * POSIX path. Any file OTHER than the validator owner that mentions refund_policy
 * and performs a `.update(` whose ±CONTEXT_LINES context references `refund_policy:`
 * — with no allowlist tag in the 5 lines above — is a violation. Pushes one
 * { rel, line } record per offending call site into `failures`.
 * Behavior-preserving refactor of the original main-loop logic.
 */
function check(fileEntries, failures) {
  for (const { rel, content } of fileEntries) {
    // Owner file is exempt — it IS the validator.
    if (rel === OWNER_FILE_REL) continue;

    // Quick prefilter — skip files that don't mention refund_policy at all.
    if (!content.includes("refund_policy")) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (!UPDATE_RE.test(lines[i])) continue;
      // Look at the surrounding context for refund_policy reference.
      const start = Math.max(0, i - CONTEXT_LINES);
      const end = Math.min(lines.length, i + CONTEXT_LINES + 1);
      const context = lines.slice(start, end).join("\n");
      if (!REFUND_POLICY_RE.test(context)) continue;

      // Found a candidate violation. Check for allowlist tag in the 5 lines above.
      const above = lines.slice(start, i).join("\n");
      if (above.includes(ALLOWLIST_TAG)) continue;

      failures.push({ rel, line: i + 1 });
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

  // GOOD: the validator owner writing refund_policy (exempt) → silent.
  let f = run([
    {
      rel: OWNER_FILE_REL,
      content: 'await sb.from("events").update({ refund_policy: validated });\n',
    },
  ]);
  if (f.length) self.push("GOOD (validator owner refund_policy write) wrongly flagged");

  // BAD1 (revert-style): a raw events.update({ refund_policy }) outside the
  // validator with no allowlist → fires.
  f = run([
    {
      rel: "mingla-business/src/screens/EditRefund.tsx",
      content:
        'await sb.from("events").update({\n  refund_policy: policy,\n});\n',
    },
  ]);
  if (f.length === 0) self.push("BAD1 (raw refund_policy update outside validator) not flagged");

  // BAD2 (regression, different angle): a SECOND component writing refund_policy
  // directly (single-line update) → fires.
  f = run([
    {
      rel: "mingla-business/src/components/RefundAccordion.tsx",
      content: 'const r = await client.from("events").update({ refund_policy: next });\n',
    },
  ]);
  if (f.length === 0) self.push("BAD2 (second component direct refund_policy write) not flagged");

  // SPECIFICITY: an allowlisted direct write stays silent.
  f = run([
    {
      rel: "mingla-business/src/screens/AdminOverride.tsx",
      content:
        "// orch-strict-grep-allow tr4-refund-cascade-monotonicity — admin data migration\n" +
        'await sb.from("events").update({ refund_policy: forced });\n',
    },
  ]);
  if (f.length) self.push("allowlisted refund_policy write wrongly flagged");

  if (self.length) {
    console.error("[i-proposed-tr4-refund-cascade-monotonicity] self-test FAIL:");
    self.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log("[i-proposed-tr4-refund-cascade-monotonicity] self-test PASS (4/4 cases).");
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────── main path
const fileEntries = [];
for (const filePath of walkTs(SCAN_DIR)) {
  filesScanned += 1;
  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    continue;
  }
  fileEntries.push({ rel: relative(REPO_ROOT, filePath), content: source });
}

const failures = [];
check(fileEntries, failures);
violations = failures.length;
for (const v of failures) {
  console.error(
    `[i-proposed-tr4-refund-cascade-monotonicity] VIOLATION: ${v.rel}:${v.line} writes events.refund_policy outside the validator (${OWNER_FILE_REL}). Either route via refundPolicyService.updateRefundPolicy() OR add allowlist comment "// ${ALLOWLIST_TAG} — <reason>" within 5 lines above.`,
  );
}

if (violations === 0) {
  console.log(
    `[i-proposed-tr4-refund-cascade-monotonicity] OK — scanned ${filesScanned} TS files; zero refund_policy write-paths outside the validator.`,
  );
}

process.exit(violations === 0 ? 0 : 1);
