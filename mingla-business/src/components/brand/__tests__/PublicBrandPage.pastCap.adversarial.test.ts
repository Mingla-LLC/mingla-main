/**
 * ORCH-0963 T-09 ADVERSARIAL — Past tab cap at 10 holds across both kinds.
 *
 * Attacks a DIFFERENT angle: list-rendering bounds. The past-trips memo MUST
 * apply .slice(0, PAST_TRIP_CAP) AND the past-events memo MUST preserve its
 * pre-ORCH-0963 .slice(0, PAST_EVENT_CAP). Either being removed by a careless
 * refactor would let "Past" lists grow without bound — visual noise + potential
 * perf cliff on long-lived brands.
 *
 * Fails-on-revert: removing either .slice() FAILs the regex match.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("ORCH-0963 T-09 ADVERSARIAL — Past cap = 10 for both kinds", () => {
  const pageSrc = readFileSync(
    join(__dirname, "..", "PublicBrandPage.tsx"),
    "utf8",
  );

  test("T-09a PAST_EVENT_CAP and PAST_TRIP_CAP constants both equal 10", () => {
    expect(pageSrc).toMatch(/const\s+PAST_EVENT_CAP\s*=\s*10;/);
    expect(pageSrc).toMatch(/const\s+PAST_TRIP_CAP\s*=\s*10;/);
  });

  test("T-09b pastEvents memo applies .slice(0, PAST_EVENT_CAP)", () => {
    const memo = pageSrc.match(
      /const\s+pastEvents\s*=\s*useMemo<LiveEvent\[\]>\([\s\S]*?\}\,\s*\[events\]\);/,
    );
    expect(memo).not.toBeNull();
    expect(memo![0]).toMatch(/\.slice\(0,\s*PAST_EVENT_CAP\)/);
  });

  test("T-09c pastTrips memo applies .slice(0, PAST_TRIP_CAP)", () => {
    const memo = pageSrc.match(
      /const\s+pastTrips\s*=\s*useMemo<PublicTripCard\[\]>\([\s\S]*?\}\,\s*\[isTripBrand,\s*trips\]\);/,
    );
    expect(memo).not.toBeNull();
    expect(memo![0]).toMatch(/\.slice\(0,\s*PAST_TRIP_CAP\)/);
  });

  test("T-09d past memos sort descending by date (most-recent first)", () => {
    const eventMemo = pageSrc.match(
      /const\s+pastEvents\s*=\s*useMemo<LiveEvent\[\]>\([\s\S]*?\}\,\s*\[events\]\);/,
    );
    const tripMemo = pageSrc.match(
      /const\s+pastTrips\s*=\s*useMemo<PublicTripCard\[\]>\([\s\S]*?\}\,\s*\[isTripBrand,\s*trips\]\);/,
    );
    expect(eventMemo).not.toBeNull();
    expect(tripMemo).not.toBeNull();
    // Descending sort: (b, a) => (b.x).localeCompare(a.x) — newest-first.
    expect(eventMemo![0]).toMatch(/\.sort\(\(a,\s*b\)\s*=>\s*\(b\.date\s*\?\?\s*""\)\.localeCompare\(a\.date\s*\?\?\s*""\)\)/);
    expect(tripMemo![0]).toMatch(/\.sort\(\(a,\s*b\)\s*=>\s*\(b\.endAt\s*\?\?\s*""\)\.localeCompare\(a\.endAt\s*\?\?\s*""\)\)/);
  });

  test("T-09e past-trips filter pins status='ended' (not status='past' or generic isPast)", () => {
    const tripMemo = pageSrc.match(
      /const\s+pastTrips\s*=\s*useMemo<PublicTripCard\[\]>\([\s\S]*?\}\,\s*\[isTripBrand,\s*trips\]\);/,
    );
    expect(tripMemo).not.toBeNull();
    expect(tripMemo![0]).toMatch(/t\.status\s*===\s*"ended"/);
  });

  test("T-09f upcoming-trips memo filters scheduled+live (not just scheduled)", () => {
    const upcomingTripMemo = pageSrc.match(
      /const\s+upcomingTrips\s*=\s*useMemo<PublicTripCard\[\]>\([\s\S]*?\}\,\s*\[isTripBrand,\s*trips\]\);/,
    );
    expect(upcomingTripMemo).not.toBeNull();
    expect(upcomingTripMemo![0]).toMatch(
      /t\.status\s*===\s*"scheduled"\s*\|\|\s*t\.status\s*===\s*"live"/,
    );
  });
});
