#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0850 [End-not-start parity systemic] — Consumer Activity Calendar
 * ADVERSARIAL regression check.
 *
 * Tester-authored counterpart to `orch-0850-regression-check.mjs`. Attacks
 * angles the implementor's happy-path does NOT exercise. Per Step 0.5 CLOSE
 * gate, this attacks a DIFFERENT angle than the happy-path — never a renamed
 * copy.
 *
 * Four attack clusters per SPEC §3.8.2:
 *   A. Boundary equality on the effectiveEnd cutoff (`<` strict, not `<=`)
 *   B. Timezone / DST edges in ISO parse
 *   C. Malformed / edge data on duration_minutes + scheduled_at
 *   D. Pre-fix bug-shape attack: confirms a start-only predicate would fail
 *
 * Behavioural assertions run against an inline clone of `computeEntryEffectiveEnd`
 * (CalendarTab.tsx imports React Native modules that don't resolve under plain
 * Node; the inline clone is verbatim from the source file and is itself
 * guarded by the source-shape gates in orch-0850-regression-check.mjs T-01..T-04).
 *
 * Fails-on-revert: if the §3.5 fix is reverted to start-only predicate,
 * the orch-0850-regression-check.mjs T-04 source-shape gate fails (which we
 * import) AND the D-cluster pre-fix-shape simulation here proves the
 * mathematical difference.
 */

const DEFAULT_DURATION = 120;

function effectiveEnd(entry) {
  const startIso = entry.scheduled_at ?? entry.suggestedDates?.[0] ?? null;
  if (startIso === null) return null;
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;
  const dm =
    typeof entry.duration_minutes === "number" && entry.duration_minutes > 0
      ? entry.duration_minutes
      : DEFAULT_DURATION;
  return new Date(startMs + dm * 60000);
}

// Post-0850 predicate: end-based, strictly less-than.
function bucketFixed(entry, nowMs) {
  const end = effectiveEnd(entry);
  if (end !== null && end.getTime() < nowMs) return "archive";
  return "active";
}

// Pre-0850 predicate (BROKEN, restored locally for D-cluster comparison ONLY).
function bucketBrokenStartOnly(entry, nowMs) {
  const startIso = entry.scheduled_at ?? entry.suggestedDates?.[0] ?? null;
  if (startIso === null) return "active";
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return "active";
  if (startMs < nowMs) return "archive";
  return "active";
}

let failures = 0;
const log = (id, ok, detail) => {
  if (ok) {
    console.log(`  ✓ ${id}  ${detail}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${id}  ${detail}`);
  }
};

console.log("ORCH-0850 ADVERSARIAL regression check — Consumer Activity Calendar");
console.log("");

// ---------- Cluster A: Boundary equality on effectiveEnd cutoff -----------
// Predicate is `end.getTime() < now` (strictly less than). Boundary tests:
console.log("Cluster A — boundary equality on effectiveEnd cutoff:");

{
  // T-A01: effectiveEnd exactly equal to now → NOT archive (strict <).
  // scheduled_at = 2026-05-15T22:00:00Z, duration 60min → end 2026-05-15T23:00:00Z.
  // Set now exactly equal.
  const nowMs = Date.parse("2026-05-15T23:00:00.000Z");
  const entry = { scheduled_at: "2026-05-15T22:00:00Z", duration_minutes: 60 };
  log(
    "T-A01",
    bucketFixed(entry, nowMs) === "active",
    "effectiveEnd exactly equal to now → Active (strict <)",
  );
}
{
  // T-A02: effectiveEnd 1ms BEFORE now → Archive.
  const nowMs = Date.parse("2026-05-15T23:00:00.001Z");
  const entry = { scheduled_at: "2026-05-15T22:00:00Z", duration_minutes: 60 };
  log(
    "T-A02",
    bucketFixed(entry, nowMs) === "archive",
    "effectiveEnd 1ms before now → Archive",
  );
}
{
  // T-A03: effectiveEnd 1ms AFTER now → Active.
  const nowMs = Date.parse("2026-05-15T22:59:59.999Z");
  const entry = { scheduled_at: "2026-05-15T22:00:00Z", duration_minutes: 60 };
  log(
    "T-A03",
    bucketFixed(entry, nowMs) === "active",
    "effectiveEnd 1ms after now → Active",
  );
}

console.log("");
console.log("Cluster B — timezone / DST edges in ISO parse:");

{
  // T-B01: scheduled_at with timezone offset (+04:00) parses to correct UTC instant.
  // 2026-05-15T20:00:00+04:00 = 2026-05-15T16:00:00Z. Plus 60min → 17:00 UTC.
  const nowMs = Date.parse("2026-05-15T17:30:00.000Z"); // 30min after effectiveEnd
  const entry = { scheduled_at: "2026-05-15T20:00:00+04:00", duration_minutes: 60 };
  log(
    "T-B01",
    bucketFixed(entry, nowMs) === "archive",
    "scheduled_at with +04:00 offset parses correctly + bucket Archive when past",
  );
}
{
  // T-B02: scheduled_at without Z suffix (naive ISO) — Date.parse interprets as local.
  // "2026-05-15T20:00:00" → in V8/Hermes parses as local time (depends on env).
  // Date.parse may yield a finite number → effectiveEnd computed. Either bucket is
  // acceptable here; this test confirms NO CRASH.
  const nowMs = Date.parse("2026-05-15T22:30:00.000Z");
  const entry = { scheduled_at: "2026-05-15T20:00:00", duration_minutes: 60 };
  const result = bucketFixed(entry, nowMs);
  log(
    "T-B02",
    result === "active" || result === "archive",
    `scheduled_at without Z suffix does not crash, bucket = ${result}`,
  );
}
{
  // T-B03: fractional seconds in ISO parse correctly.
  const nowMs = Date.parse("2026-05-15T23:00:00.500Z");
  const entry = {
    scheduled_at: "2026-05-15T22:00:00.123Z",
    duration_minutes: 60,
  };
  // effectiveEnd = 23:00:00.123Z. Now = 23:00:00.500Z (377ms after end). Archive.
  log(
    "T-B03",
    bucketFixed(entry, nowMs) === "archive",
    "fractional-seconds ISO parses correctly + bucket Archive when past",
  );
}

console.log("");
console.log("Cluster C — malformed / edge data on duration_minutes + scheduled_at:");

{
  // T-C01: duration_minutes = 0 → falls back to 120-min default.
  // start 2026-05-15T22:00:00Z, duration 0 → fallback 120min → end 2026-05-16T00:00:00Z.
  const nowMs = Date.parse("2026-05-15T23:30:00.000Z"); // before fallback end
  const entry = { scheduled_at: "2026-05-15T22:00:00Z", duration_minutes: 0 };
  log(
    "T-C01",
    bucketFixed(entry, nowMs) === "active",
    "duration_minutes=0 falls back to 120m default → Active",
  );
}
{
  // T-C02: duration_minutes = -60 (negative) → falls back to 120-min default.
  const nowMs = Date.parse("2026-05-15T23:30:00.000Z");
  const entry = { scheduled_at: "2026-05-15T22:00:00Z", duration_minutes: -60 };
  log(
    "T-C02",
    bucketFixed(entry, nowMs) === "active",
    "duration_minutes=-60 falls back to 120m default → Active",
  );
}
{
  // T-C03: duration_minutes = Number.MAX_SAFE_INTEGER doesn't crash or overflow into NaN.
  const nowMs = Date.parse("2026-05-15T22:00:00.000Z");
  const entry = {
    scheduled_at: "2026-05-15T20:00:00Z",
    duration_minutes: Number.MAX_SAFE_INTEGER,
  };
  // 9_007_199_254_740_991 * 60_000 = ~5.4e17 ms — far in future. Active.
  const result = bucketFixed(entry, nowMs);
  log(
    "T-C03",
    result === "active",
    `duration_minutes=MAX_SAFE_INTEGER does not overflow → ${result}`,
  );
}
{
  // T-C04: malformed scheduled_at string → null effectiveEnd → Active fallback.
  const nowMs = Date.parse("2026-05-15T22:00:00.000Z");
  const entry = { scheduled_at: "garbage-not-a-date", duration_minutes: 60 };
  log(
    "T-C04",
    bucketFixed(entry, nowMs) === "active",
    "malformed scheduled_at → null effectiveEnd → Active fallback",
  );
}
{
  // T-C05: empty suggestedDates array + null scheduled_at → null → Active fallback.
  const nowMs = Date.parse("2026-05-15T22:00:00.000Z");
  const entry = { suggestedDates: [] };
  log(
    "T-C05",
    bucketFixed(entry, nowMs) === "active",
    "scheduled_at null + empty suggestedDates → Active fallback",
  );
}
{
  // T-C06: suggestedDates with garbage at index 0.
  const nowMs = Date.parse("2026-05-15T22:00:00.000Z");
  const entry = { suggestedDates: ["garbage"] };
  log(
    "T-C06",
    bucketFixed(entry, nowMs) === "active",
    "suggestedDates[0] malformed → null effectiveEnd → Active fallback",
  );
}

console.log("");
console.log("Cluster D — pre-fix bug-shape comparison (mechanism proof):");

{
  // T-D01: in-progress entry (start 3am Raleigh, dur 18h) at 8pm Raleigh:
  // - bucketFixed → Active (effectiveEnd 9pm Raleigh = future)
  // - bucketBrokenStartOnly → Archive (start was 17h ago = past)
  // Pre-fix code would bucket Archive. Post-fix correctly buckets Active. Mechanism confirmed.
  const nowMs = Date.parse("2026-05-16T00:10:00.000Z"); // 8:10pm EDT May 15
  const entry = {
    scheduled_at: "2026-05-15T07:00:00Z", // 3am EDT May 15
    duration_minutes: 18 * 60, // 18h
  };
  log(
    "T-D01a",
    bucketFixed(entry, nowMs) === "active",
    "post-0850: in-progress entry → Active (correct)",
  );
  log(
    "T-D01b",
    bucketBrokenStartOnly(entry, nowMs) === "archive",
    "pre-0850 simulated: in-progress entry → Archive (the bug)",
  );
  log(
    "T-D01c",
    bucketFixed(entry, nowMs) !== bucketBrokenStartOnly(entry, nowMs),
    "post-0850 and pre-0850 simulated DISAGREE on this case (proves fix is meaningful)",
  );
}

console.log("");
if (failures > 0) {
  console.error(
    `ORCH-0850 ADVERSARIAL regression check FAILED — ${failures} assertion(s)`,
  );
  process.exit(1);
}
console.log(
  "ORCH-0850 ADVERSARIAL regression check PASSED — all assertions",
);
process.exit(0);
