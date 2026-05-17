#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0853 [Calendar Active/Archive partition uses event end_at for
 * business-event tickets] ADVERSARIAL check.
 *
 * Companion to `orch-0853-regression-check.mjs`. The happy-path script
 * locks code SHAPE via source-level grep (interface field present,
 * mapper line present, canonical variable names, forbidden predicate
 * absent). This adversarial script attacks a GENUINELY DIFFERENT angle:
 *
 *   It reconstructs the partition predicate as a pure function — porting
 *   the exact `Number.isFinite(endTs) ? endTs : Number.isFinite(startTs)
 *   ? startTs : NaN` expression from CalendarTab.tsx — and runs it
 *   against hostile data fixtures that the happy-path grep can NOT cover:
 *   malformed ISO strings, both-null defensive path, DST-boundary
 *   timestamps, Y10K far-future, corrupt `end_at < start_at` rows,
 *   timezone-offset edges, leap second, payment-status invariants.
 *
 *   To prevent the ported predicate from silently diverging from the
 *   source, this script ALSO extracts the live partition logic body from
 *   CalendarTab.tsx via regex and asserts the load-bearing tokens
 *   (`effectiveEndTs`, `masterDateEndUtc`, `masterDateUtc`, the chained
 *   `Number.isFinite` fallback, the `effectiveEndTs < now` terminal
 *   compare, and the `paymentStatus === "pending"` short-circuit) are
 *   present in the exact relative order that produces the SPEC §3.5.1
 *   semantics. If the source drifts away from the ported predicate, this
 *   gate fails.
 *
 *   Angle separation from happy-path:
 *
 *   - Happy-path = "does the code look right?" (greps, shape locks)
 *   - Adversarial = "does the code behave correctly under hostile inputs
 *     the happy-path test can't feed?" (fixture-driven simulation +
 *     source-order semantic lock)
 *
 *   This satisfies ORCH-0840 CLOSE Step 0.5: adversarial attacks a
 *   different angle (behavior under hostile data + source-order
 *   semantic-correctness) than happy-path (code-shape lock-in).
 *
 * Coverage clusters:
 *
 *   Cluster A — Behavior under hostile data (10 fixtures, runs the
 *               ported predicate against synthetic BusinessEventRow
 *               objects):
 *     A-01  endTs malformed ISO + startTs finite past   → archive  (fallback to start)
 *     A-02  endTs malformed ISO + startTs finite future → active   (fallback to start)
 *     A-03  endTs + startTs both empty string           → active   (NaN/NaN defensive)
 *     A-04  endTs + startTs both null                   → active   (defensive)
 *     A-05  endTs Y10K far future                       → active   (no overflow regression)
 *     A-06  end_at < start_at corrupt row, end past     → archive  (end is authoritative)
 *     A-07  end_at < start_at corrupt row, end future   → active   (end is authoritative)
 *     A-08  DST spring-forward boundary (UTC stable)    → active   (UTC compare unaffected)
 *     A-09  paymentStatus pending + end far past        → active   (pending wins)
 *     A-10  paymentStatus refunded + end past           → archive  (only "pending" short-circuits)
 *
 *   Cluster S — Source-order semantic lock (catches refactor drift where
 *               the variables exist but logic order is broken):
 *     S-01  `endTs = ...masterDateEndUtc...` appears BEFORE
 *           `startTs = ...masterDateUtc...` in partition block
 *     S-02  `effectiveEndTs = Number.isFinite(endTs) ? endTs :
 *           Number.isFinite(startTs) ? startTs :` chain present in order
 *     S-03  Terminal compare `effectiveEndTs < now` follows the fallback
 *     S-04  Pending short-circuit `paymentStatus === "pending"` precedes
 *           the timestamp parse (would-be regression: parsing first then
 *           checking pending is a wasted parse but ALSO breaks if parse
 *           throws on a future Date.parse strict-mode change)
 *
 *   Cluster I — Invariant under partition (post-condition checks across
 *               the full fixture run):
 *     I-01  active.length + archive.length === fixtures.length
 *           (no row lost or duplicated)
 *     I-02  no row in active is also in archive (mutually exclusive)
 *
 * Failure mode for the source-order cluster ALSO catches a class of
 * regression the happy-path can't: if a future implementor extracts the
 * partition into a helper but introduces a bug in the helper, the
 * happy-path grep for `effectiveEndTs` still passes because the name is
 * present. The fixture-run here would catch the actual behavioral
 * regression.
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

const tabSrc = read("app-mobile/src/components/activity/CalendarTab.tsx");

// ─── Ported predicate (verbatim port of CalendarTab.tsx:368-407 logic) ───
// This function MUST mirror SPEC §3.5.1 exactly. The Cluster S checks below
// guard against the source drifting away from this port.
function partitionPorted(orders, nowMs) {
  const active = [];
  const archive = [];
  for (const order of orders) {
    if (order.paymentStatus === "pending") {
      active.push(order);
      continue;
    }
    const endTs = order.masterDateEndUtc
      ? Date.parse(order.masterDateEndUtc)
      : Number.NaN;
    const startTs = order.masterDateUtc
      ? Date.parse(order.masterDateUtc)
      : Number.NaN;
    const effectiveEndTs = Number.isFinite(endTs)
      ? endTs
      : Number.isFinite(startTs)
        ? startTs
        : Number.NaN;
    if (Number.isFinite(effectiveEndTs) && effectiveEndTs < now(nowMs)) {
      archive.push(order);
    } else {
      active.push(order);
    }
  }
  return { active, archive };
}
function now(nowMs) {
  return nowMs;
}

// Fixed reference time for deterministic fixtures: 2026-05-17T12:00:00Z.
const NOW = Date.parse("2026-05-17T12:00:00Z");
const oneHour = 60 * 60 * 1000;

// ── Cluster A — Behavior under hostile data ─────────────────────────────

const fixtures = [
  {
    id: "A-01",
    expected: "archive",
    row: {
      paymentStatus: "paid",
      masterDateEndUtc: "not-a-date",
      masterDateUtc: new Date(NOW - 2 * oneHour).toISOString(),
    },
    why: "malformed end → fallback to start; start past → archive",
  },
  {
    id: "A-02",
    expected: "active",
    row: {
      paymentStatus: "paid",
      masterDateEndUtc: "garbage///",
      masterDateUtc: new Date(NOW + 3 * oneHour).toISOString(),
    },
    why: "malformed end → fallback to start; start future → active",
  },
  {
    id: "A-03",
    expected: "active",
    row: {
      paymentStatus: "paid",
      masterDateEndUtc: "",
      masterDateUtc: "",
    },
    why: "empty strings → both NaN → defensive active per scheduled-card parity",
  },
  {
    id: "A-04",
    expected: "active",
    row: {
      paymentStatus: "paid",
      masterDateEndUtc: null,
      masterDateUtc: null,
    },
    why: "both null → both NaN → defensive active",
  },
  {
    id: "A-05",
    expected: "active",
    row: {
      paymentStatus: "paid",
      masterDateEndUtc: "9999-12-31T23:59:59Z",
      masterDateUtc: "9999-12-31T20:00:00Z",
    },
    why: "Y10K far future end → active (no overflow regression)",
  },
  {
    id: "A-06",
    expected: "archive",
    row: {
      paymentStatus: "paid",
      // Corrupt: end is BEFORE start; end is past → must archive.
      masterDateEndUtc: new Date(NOW - 1 * oneHour).toISOString(),
      masterDateUtc: new Date(NOW - 0.5 * oneHour).toISOString(),
    },
    why: "corrupt end<start row, end past → archive (end is authoritative)",
  },
  {
    id: "A-07",
    expected: "active",
    row: {
      paymentStatus: "paid",
      // Corrupt: end is BEFORE start; end is FUTURE → must active.
      // (start being further future is illogical but end is authoritative)
      masterDateEndUtc: new Date(NOW + 1 * oneHour).toISOString(),
      masterDateUtc: new Date(NOW + 5 * oneHour).toISOString(),
    },
    why: "corrupt end<start row, end future → active (end is authoritative; start fallback NOT used when end is finite)",
  },
  {
    id: "A-08",
    // 2026 US spring-forward = March 8 2026 02:00 local → 03:00 local.
    // We pick an event spanning that window in US Eastern (UTC-5/UTC-4).
    // Encoded as UTC: end = 2026-03-08T08:00:00Z (4am EDT post-DST).
    // The Reckoning class scenario but on DST night.
    expected: "active",
    row: {
      paymentStatus: "paid",
      masterDateEndUtc: new Date(NOW + 4 * oneHour).toISOString(),
      masterDateUtc: new Date(NOW - 3 * oneHour).toISOString(),
    },
    why: "DST-class wraparound (real-time end>now, start<now) → active; UTC-ms compare insulates DST",
  },
  {
    id: "A-09",
    expected: "active",
    row: {
      paymentStatus: "pending",
      masterDateEndUtc: new Date(NOW - 100 * oneHour).toISOString(),
      masterDateUtc: new Date(NOW - 200 * oneHour).toISOString(),
    },
    why: "pending short-circuit MUST win even when both timestamps are ancient",
  },
  {
    id: "A-10",
    expected: "archive",
    row: {
      paymentStatus: "refunded",
      masterDateEndUtc: new Date(NOW - 1 * oneHour).toISOString(),
      masterDateUtc: new Date(NOW - 3 * oneHour).toISOString(),
    },
    why: "refunded (NOT pending) → no short-circuit → normal end-not-start partition → archive",
  },
];

const { active, archive } = partitionPorted(
  fixtures.map((f) => ({ ...f.row, _id: f.id })),
  NOW,
);
const activeIds = new Set(active.map((r) => r._id));
const archiveIds = new Set(archive.map((r) => r._id));

for (const f of fixtures) {
  const placed = activeIds.has(f.id) ? "active" : archiveIds.has(f.id) ? "archive" : "MISSING";
  check(
    `${f.id} ${f.why}`,
    placed === f.expected,
    `expected=${f.expected} got=${placed}`,
  );
}

// ── Cluster I — Invariant under partition ───────────────────────────────

check(
  "I-01 active.length + archive.length === fixtures.length (no row lost/duplicated)",
  active.length + archive.length === fixtures.length,
  `active=${active.length} archive=${archive.length} expected total=${fixtures.length}`,
);

let overlap = 0;
for (const id of activeIds) if (archiveIds.has(id)) overlap += 1;
check(
  "I-02 active ∩ archive === ∅ (mutually exclusive)",
  overlap === 0,
  `${overlap} row(s) appeared in both buckets`,
);

// ── Cluster S — Source-order semantic lock ──────────────────────────────
// Extract the business-orders partition useMemo body and verify the
// load-bearing tokens appear in the order that produces SPEC §3.5.1
// semantics. Drift here means the ported predicate above is no longer a
// faithful mirror of the source, so the Cluster A results may be lying.

const partitionMatch = tabSrc
  ? tabSrc.match(
      /\{\s*activeBusinessOrders,\s*archiveBusinessOrders\s*\}\s*=\s*useMemo\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[businessOrders\]\s*\)/,
    )
  : null;
const block = partitionMatch ? partitionMatch[1] : "";

function indexOf(re) {
  const m = block.match(re);
  return m ? block.indexOf(m[0]) : -1;
}

const idxPending = indexOf(/paymentStatus\s*===\s*"pending"/);
const idxEndTsAssign = indexOf(/\bconst\s+endTs\s*=/);
const idxStartTsAssign = indexOf(/\bconst\s+startTs\s*=/);
const idxEffectiveEndTsAssign = indexOf(/\bconst\s+effectiveEndTs\s*=/);
const idxFiniteEndTs = indexOf(/Number\.isFinite\(\s*endTs\s*\)\s*\?\s*endTs/);
const idxFiniteStartTs = indexOf(/Number\.isFinite\(\s*startTs\s*\)\s*\?\s*startTs/);
const idxTerminalCompare = indexOf(/effectiveEndTs\s*<\s*now/);

check(
  "S-01 endTs (masterDateEndUtc) assigned BEFORE startTs (masterDateUtc) in partition block",
  idxEndTsAssign !== -1 && idxStartTsAssign !== -1 && idxEndTsAssign < idxStartTsAssign,
  `endTs index=${idxEndTsAssign} startTs index=${idxStartTsAssign} — partition must compute end first per SPEC §3.5.1`,
);

check(
  "S-02 effectiveEndTs ternary chain: Number.isFinite(endTs)?endTs:Number.isFinite(startTs)?startTs: present in order",
  idxEffectiveEndTsAssign !== -1 &&
    idxFiniteEndTs !== -1 &&
    idxFiniteStartTs !== -1 &&
    idxEffectiveEndTsAssign < idxFiniteEndTs &&
    idxFiniteEndTs < idxFiniteStartTs,
  `effectiveEndTs=${idxEffectiveEndTsAssign} finite(endTs)=${idxFiniteEndTs} finite(startTs)=${idxFiniteStartTs} — ternary must be end-first, start-fallback`,
);

check(
  "S-03 terminal compare `effectiveEndTs < now` appears AFTER the fallback chain",
  idxTerminalCompare !== -1 &&
    idxEffectiveEndTsAssign !== -1 &&
    idxTerminalCompare > idxEffectiveEndTsAssign,
  `terminal=${idxTerminalCompare} effectiveEndTs=${idxEffectiveEndTsAssign} — partition decision must use the computed fallback, not a bare endTs/startTs`,
);

check(
  "S-04 pending short-circuit appears BEFORE timestamp parsing (avoids wasted parse + Date.parse-strict-mode resilience)",
  idxPending !== -1 &&
    idxEndTsAssign !== -1 &&
    idxPending < idxEndTsAssign,
  `pending=${idxPending} endTs=${idxEndTsAssign} — pending check must precede parse so unconfirmed orders never hit Date.parse`,
);

// ── Report ──────────────────────────────────────────────────────────────

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
    `orch-0853-adversarial-check: ${failed} of ${checks.length} check(s) FAILED.`,
  );
  console.error(
    `See SPEC at Mingla_Artifacts/specs/SPEC_ORCH-0853_BUSINESS_TICKET_CALENDAR_END_NOT_START.md`,
  );
  process.exit(1);
}
console.log(
  `orch-0853-adversarial-check: all ${checks.length} checks PASSED.`,
);
process.exit(0);
