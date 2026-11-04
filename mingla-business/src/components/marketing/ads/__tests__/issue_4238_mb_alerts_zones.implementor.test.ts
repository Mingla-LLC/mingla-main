/**
 * @jest-environment ./__tests__/support/issue3801TimeZoneEnvironment.cjs
 *
 * #4238 media-buyer, wave D — "still learning", pacing and "paused
 * because…" read the same in every viewer time zone (days come from the
 * page's own calendar).
 */
import { describe, expect, it } from "@jest/globals";

import {
  hostAdLearningAlert,
  hostAdNextLiveEditAt,
  hostAdPacingAlert,
  hostAdPausedReason,
  hostAdRunDay,
} from "../hostAdAlerts";
import { hostAdCopyIsPlain } from "../hostAdCopy";

const VIEWERS = ["America/New_York", "Africa/Lagos", "Pacific/Kiritimati", "America/Los_Angeles", "UTC"];

function viewIn(zone: string): void {
  (globalThis as unknown as { __setProcessTimeZone: (z: string) => void }).__setProcessTimeZone(zone);
  const probe = new Date("2026-12-06T12:00:00Z");
  const expectedHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(probe),
  );
  expect(probe.getHours()).toBe(expectedHour);
}

describe("#4238 D3 alerts in every viewer zone", () => {
  it.each(VIEWERS)("an ad started 23:30 Lagos time is on day 5 four days later, for a viewer in %s", (zone) => {
    viewIn(zone);
    const started = "2026-11-03T22:30:00Z"; // 23:30 in Lagos on 3 Nov
    const now = "2026-11-07T10:00:00Z";
    expect(hostAdRunDay(started, now, "Africa/Lagos")).toBe(5);
    const learning = hostAdLearningAlert({ name: "Sunday Rooftop", live: true, startedAt: started, nowIso: now, timezone: "Africa/Lagos" });
    expect(learning?.body).toBe(
      "Day 5. The apps are still finding who buys. Leave it running for about a week before changing it.",
    );
    expect(hostAdLearningAlert({ name: "x", live: true, startedAt: started, nowIso: "2026-11-12T10:00:00Z", timezone: "Africa/Lagos" })).toBeNull();
    const pacing = hostAdPacingAlert({
      live: true, spentCents: 610_000_00, dailyCents: 150_000_00, capCents: 5_000_000_00,
      startedAt: started, nowIso: now, timezone: "Africa/Lagos", currency: "NGN",
    });
    // Planned by today: 4 full days × NGN 150,000 = NGN 600,000 → on plan.
    expect(pacing).toBeNull();
    const slow = hostAdPacingAlert({
      live: true, spentCents: 300_000_00, dailyCents: 150_000_00, capCents: 5_000_000_00,
      startedAt: started, nowIso: now, timezone: "Africa/Lagos", currency: "NGN",
    });
    expect(slow?.title).toBe("Spending slower than planned");
    expect(slow?.body).toBe("NGN 300,000.00 spent of NGN 600,000.00 planned by today. This is normal in the first week.");
  });
});

describe("#4238 D3 paused because… and once a day", () => {
  it("names the reason plainly", () => {
    for (const reason of ["destination_unavailable", "destination_check_failed", "end_date_passed", "spend_fetch_failed", "cap_reached", "sold_out"]) {
      const line = hostAdPausedReason(reason);
      expect(line?.startsWith("Paused because")).toBe(true);
      expect(hostAdCopyIsPlain(line as string)).toBe(true);
    }
    expect(hostAdPausedReason("something_new")).toBeNull();
  });
  it("the next edit opens 24 hours after the last one", () => {
    expect(hostAdNextLiveEditAt("2026-11-07T10:00:00Z", "2026-11-07T20:00:00Z")).toBe("2026-11-08T10:00:00.000Z");
    expect(hostAdNextLiveEditAt("2026-11-07T10:00:00Z", "2026-11-08T10:00:01Z")).toBeNull();
    expect(hostAdNextLiveEditAt(null, "2026-11-08T10:00:00Z")).toBeNull();
  });
});
