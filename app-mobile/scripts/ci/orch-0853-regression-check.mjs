#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0853 [Calendar Active/Archive partition uses event end_at for
 * business-event tickets] regression check (happy-path).
 *
 * Asserts that the consumer Calendar tab partitions paid business-event
 * tickets into Active vs Archive using EFFECTIVE END time
 * (event_dates.end_at when present; start_at fallback when null) rather
 * than the pre-0853 start-only `masterDateUtc < now` predicate.
 *
 * Bug it locks in: The Reckoning event ran 10pm–3am; pre-fix the buyer's
 * paid ticket flipped to Archive at 10:01pm because the partition asked
 * "did it start?" instead of "did it end?". Sibling fix to ORCH-0850
 * [End-not-start parity systemic — four surfaces]; this is the fifth
 * surface the original sweep's `scheduled_at` grep scope did not catch.
 *
 * Coverage angles (all source-level structural — happy-path):
 *
 * (S) Service-layer contract — `BusinessEventCalendarRow` declares
 *     `masterDateEndUtc` and the mapper propagates `event_dates.end_at`.
 *
 * (P) Partition-layer contract — CalendarTab.tsx uses `masterDateEndUtc`
 *     and `effectiveEndTs`, computes end-or-start fallback, and the
 *     pre-fix start-only `masterDateUtc < now` predicate is gone.
 *
 * Fails-on-revert keys:
 *   - S-01 (interface field present)
 *   - S-02 (mapper line present)
 *   - P-01 (effectiveEndTs variable present)
 *   - P-04 (forbidden pre-fix predicate absent)
 *
 * Reverting EITHER the service-layer field OR the partition replacement
 * causes 2+ failures here. Tester writes adversarial second test from a
 * different angle (data-contract attack vectors) per CLOSE Step 0.5.
 *
 * Exit 1 on any FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(root, "..");

const read = (relFromRepoRoot) => {
  const abs = path.join(repoRoot, relFromRepoRoot);
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
};

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const serviceSrc = read("app-mobile/src/services/calendarService.ts");
const tabSrc = read("app-mobile/src/components/activity/CalendarTab.tsx");

// ── Service-layer contract ───────────────────────────────────────────────

check(
  "S-01 BusinessEventCalendarRow declares `masterDateEndUtc: string | null`",
  serviceSrc !== null &&
    /masterDateEndUtc:\s*string\s*\|\s*null/.test(serviceSrc),
  "Row shape must carry the end-of-event UTC timestamp for the consumer Calendar partition to use end-not-start logic.",
);

check(
  "S-02 fetchUserBusinessEventOrders mapper propagates event_dates.end_at",
  serviceSrc !== null &&
    /masterDateEndUtc:\s*masterDate\?\.end_at\s*\?\?\s*null/.test(serviceSrc),
  "Mapper must wire `masterDateEndUtc` from `masterDate?.end_at ?? null`. Without this line every row's end timestamp is undefined and the partition silently falls back to start.",
);

check(
  "S-03 event_dates select clause includes end_at (regression guard)",
  serviceSrc !== null &&
    /event_dates!left\s*\(\s*id,\s*start_at,\s*end_at,\s*is_master\s*\)/.test(
      serviceSrc,
    ),
  "The Supabase select must continue to fetch end_at. Dropping it breaks the mapper and silently reverts to start-only partition.",
);

// ── Partition-layer contract ─────────────────────────────────────────────

// Locate the business-orders partition useMemo block.
const partitionMatch = tabSrc
  ? tabSrc.match(
      /\{\s*activeBusinessOrders,\s*archiveBusinessOrders\s*\}\s*=\s*useMemo\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[businessOrders\]\s*\)/,
    )
  : null;
const partitionBlock = partitionMatch ? partitionMatch[0] : "";

check(
  "P-01 partition block defines `effectiveEndTs` (SPEC §3.5.1 canonical name)",
  partitionBlock.length > 0 && /\beffectiveEndTs\b/.test(partitionBlock),
  "Partition must compute `effectiveEndTs = endTs ?? startTs ?? NaN` and compare against `now`. Missing canonical variable name signals revert to start-only logic.",
);

check(
  "P-02 partition reads `order.masterDateEndUtc` (end-of-event field)",
  partitionBlock.length > 0 &&
    /order\.masterDateEndUtc/.test(partitionBlock),
  "Partition must read the new end-of-event field. If only masterDateUtc is referenced, the fix is not wired through.",
);

check(
  "P-03 partition computes end-with-start-fallback (Number.isFinite chain)",
  partitionBlock.length > 0 &&
    /Number\.isFinite\(\s*endTs\s*\)\s*\?\s*endTs\s*:\s*Number\.isFinite\(\s*startTs\s*\)\s*\?\s*startTs\s*:/.test(
      partitionBlock,
    ),
  "Fallback contract: prefer endTs; fall back to startTs only when end is null/NaN; both null → NaN (lands in Active per scheduled-card parity).",
);

check(
  "P-04 forbidden pre-fix predicate `ts < now` on bare masterDateUtc-derived var is GONE",
  partitionBlock.length > 0 &&
    !/const\s+ts\s*=\s*order\.masterDateUtc[\s\S]{0,80}?ts\s*<\s*now/.test(
      partitionBlock,
    ),
  "The pre-0853 `const ts = order.masterDateUtc ? ... : NaN; if (ts < now) archive` pattern must not reappear — that is the exact bug ORCH-0853 fixes.",
);

check(
  "P-05 pending-payment short-circuit preserved",
  partitionBlock.length > 0 &&
    /paymentStatus\s*===\s*"pending"/.test(partitionBlock) &&
    /active\.push\(order\);\s*continue;/.test(partitionBlock),
  "Pending orders must continue to short-circuit into Active regardless of timestamps — preserves pre-fix behavior for unconfirmed checkouts.",
);

check(
  "P-06 partition still finalizes with effectiveEndTs < now comparison",
  partitionBlock.length > 0 &&
    /effectiveEndTs\s*<\s*now/.test(partitionBlock),
  "The terminal compare must be `effectiveEndTs < now`. Any other right-hand side (e.g. `now + 24h`) would reintroduce a synthetic-window heuristic.",
);

// ── Scheduled-card partition untouched (ORCH-0850 preservation) ──────────

check(
  "G-01 scheduled-card `computeEntryEffectiveEnd` helper still present (ORCH-0850 preserved)",
  tabSrc !== null && /\bcomputeEntryEffectiveEnd\b/.test(tabSrc),
  "ORCH-0853 must not regress ORCH-0850's scheduled-card end-not-start fix. The helper must still be referenced.",
);

// ── Report ───────────────────────────────────────────────────────────────

let failed = 0;
for (const c of checks) {
  if (c.pass) {
    console.log(`  PASS  ${c.name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${c.name}`);
    console.error(`        ${c.detail}`);
  }
}

console.log("");
if (failed > 0) {
  console.error(
    `orch-0853-regression-check: ${failed} of ${checks.length} check(s) FAILED.`,
  );
  console.error(
    `See SPEC at Mingla_Artifacts/specs/SPEC_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md`,
  );
  process.exit(1);
}
console.log(
  `orch-0853-regression-check: all ${checks.length} checks PASSED.`,
);
process.exit(0);
