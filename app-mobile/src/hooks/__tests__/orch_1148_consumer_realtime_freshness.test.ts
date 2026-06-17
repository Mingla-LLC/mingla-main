// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1148 [venue-e2e-validation] — consumer realtime freshness gate.
//
// Goal (Seth, verbatim): "make sure changes that the business makes update in
// real time for the user". When a business operator flips reservations on/off or
// changes the reservation fee/currency, the consumer venue card MUST reflect it
// the moment they (re)open the card — not after a multi-minute cache.
//
// THE GAP THIS PROTECTS: useVenueReservable (the gate that shows/hides "Reserve
// a table" + carries brand_id/currency) previously used `staleTime: 5*60*1000`
// (5 min) — so enabling reservations / changing the fee on the business side was
// invisible to the consumer for up to 5 minutes. The fix makes it re-check on
// every mount/focus. This gate FAILS if anyone silently regresses it back to a
// long cache or drops the refetch flags.
//
// app-mobile has no jest/RTL runner; the repo convention is node:assert
// source-assertions (see orch_1138_consumer_trip_brand_cover.test.ts). Every
// assertion FAILS on a true LINE-DELETION of the policy it protects
// (fails-on-revert vs the pre-fix commit 6074cb19f / the staleTime:5*60*1000
// baseline), NOT merely on a comment-out.
//
// Run with:
//   node app-mobile/src/hooks/__tests__/orch_1148_consumer_realtime_freshness.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const reservableSrc = read("src/hooks/useVenueReservable.ts");
const availabilitySrc = read("src/hooks/useVenueAvailability.ts");

// Strip block + line comments so every assertion below bites on real CODE only
// (a regression hidden behind a comment must NOT keep this green).
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const reservableCode = stripComments(reservableSrc);
const availabilityCode = stripComments(availabilitySrc);

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── A: useVenueReservable re-checks live on every card open ───────────────────
ok(
  "A1 useVenueReservable uses staleTime: 0 (always re-check reservability/fee/currency)",
  /staleTime:\s*0\b/.test(reservableCode),
  "must be staleTime 0 so business reservation-config changes are seen immediately",
);
ok(
  "A2 useVenueReservable does NOT keep the old 5-minute (or any minutes) stale cache",
  !/staleTime:\s*5\s*\*\s*60\s*\*\s*1000/.test(reservableCode) &&
    !/staleTime:\s*[0-9]+\s*\*\s*60\s*\*\s*1000/.test(reservableCode),
  "regressing to staleTime: N*60*1000 re-hides business changes for minutes — the bug",
);
ok(
  "A3 useVenueReservable sets refetchOnMount: \"always\" (re-pulls on every card expand)",
  /refetchOnMount:\s*["']always["']/.test(reservableCode),
  "each venue-card expand must re-pull, even inside the gcTime window",
);
ok(
  "A4 useVenueReservable sets refetchOnWindowFocus: true (re-pulls on app return)",
  /refetchOnWindowFocus:\s*true/.test(reservableCode),
);

// ── B: useVenueAvailability re-pulls live slot capacity on focus ──────────────
ok(
  "B1 useVenueAvailability keeps a short slot stale window (≤30s)",
  /staleTime:\s*30\s*\*\s*1000/.test(availabilityCode),
  "slots go stale fast as other guests book; keep the short window",
);
ok(
  "B2 useVenueAvailability sets refetchOnWindowFocus: true (returning to slot step re-pulls)",
  /refetchOnWindowFocus:\s*true/.test(availabilityCode),
  "the prior 'refetch on focus' comment was aspirational — the flag must be real",
);

console.log(
  `\n# ORCH-1148 consumer realtime freshness — ${passed} checks PASS`,
);
