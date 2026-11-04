/**
 * @jest-environment ./__tests__/support/issue3801TimeZoneEnvironment.cjs
 *
 * #4238 — the Host builder's date fields, sentence and sent schedule agree in
 * every viewer time zone. The #3801 environment REALLY switches the process
 * zone (assigning the TZ variable inside a Jest sandbox changes nothing), and
 * every case first proves the switch took effect.
 *
 *   J5  the end-date field's last day and its sentence name the same day, in
 *       the page's zone, for 5 viewer zones × 5 page zones.
 *   J7  (r6) start and end are SENT in the page's zone: any start/end the
 *       fields accept is one the server accepts (start before, end at or
 *       before the last bookable moment); earlier end days end at the page's
 *       end of day; a saved plan reads back as the same days.
 */
import { describe, expect, it } from "@jest/globals";

import { hostAdPageDate } from "../hostAdPageLabels";
import {
  hostAdDayBoundaryIso,
  hostAdDayOf,
  hostAdScheduleEndIso,
  hostAdScheduleError,
  hostAdScheduleIsos,
  hostAdScheduleLimit,
} from "../hostAdBuilderRules";
import type { HostAdPage } from "../../../../services/hostAdPlanService";

const VIEWERS = ["America/New_York", "Africa/Lagos", "Pacific/Kiritimati", "America/Los_Angeles", "UTC"];

/** Switch the real process zone, and prove it took. */
function viewIn(zone: string): void {
  (globalThis as unknown as { __setProcessTimeZone: (z: string) => void }).__setProcessTimeZone(zone);
  const probe = new Date("2026-12-06T12:00:00Z");
  const expectedHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", hourCycle: "h23" }).format(probe),
  );
  expect(probe.getHours()).toBe(expectedHour);
}

const base = (patch: Partial<HostAdPage>): HostAdPage => ({
  page_type: "event",
  id: "p",
  brand_slug: "harmattan",
  entity_slug: "sunday-rooftop",
  title: "Sunday Rooftop Sessions",
  brand_name: "Harmattan Club",
  canonical_url: "https://host.usemingla.com/e/harmattan/sunday-rooftop",
  availability: "available",
  starts_at: "2026-11-08T18:00:00Z",
  city: "Lagos",
  cover_url: null,
  result_kind: "tickets",
  ok: true,
  ...patch,
});

describe("#4238 J5 (rework) the end-date field and its sentence name the same day in the page's zone", () => {
  // [last bookable moment, page zone, that moment's day in the page zone]
  const PAGES: [string, string, string][] = [
    ["2026-12-06T23:30:00Z", "Africa/Lagos", "2026-12-07"],
    ["2026-12-07T04:30:00Z", "America/Los_Angeles", "2026-12-06"],
    ["2026-12-07T10:00:00Z", "Pacific/Kiritimati", "2026-12-08"],
    ["2026-12-06T12:00:00Z", "Asia/Tokyo", "2026-12-06"],
    ["2026-12-06T23:59:00Z", "UTC", "2026-12-06"],
  ];
  const cases = VIEWERS.flatMap((viewer) => PAGES.map(([last, zone, day]) => [viewer, last, zone, day] as const));
  it.each(cases)("viewer %s, last bookable %s in %s", (viewer, last, zone, day) => {
    viewIn(viewer);
    const page = base({ last_bookable_at: last, timezone: zone });
    const limit = hostAdScheduleLimit(page, (iso) => hostAdPageDate(iso, page.timezone));
    expect(limit?.lastDay).toBe(day);
    const named = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${day}T12:00:00Z`));
    expect(limit?.label).toBe(named);
    // Picking the named day is allowed, and runs to the last bookable moment.
    expect(hostAdScheduleError("", day, limit)).toBeNull();
    const endOfPickedDay = new Date(`${day}T23:59:59.999`).toISOString();
    expect(hostAdScheduleEndIso(endOfPickedDay, limit, day)).toBe(new Date(last).toISOString());
    // The day after is refused in words that name the same day.
    const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    expect(hostAdScheduleError("", next, limit)).toBe(
      `Your ad can run until ${named}, the last day people can book. Pick an earlier end date.`,
    );
  });

  it.each(VIEWERS)("viewer %s: an unknown page zone falls back to the viewer's day for both", (viewer) => {
    viewIn(viewer);
    const last = "2026-12-06T23:30:00Z";
    const page = base({ last_bookable_at: last, timezone: "Mars/Olympus_Mons" });
    const limit = hostAdScheduleLimit(page, (iso) => hostAdPageDate(iso, page.timezone));
    const d = new Date(last);
    const viewerDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    expect(limit?.lastDay).toBe(viewerDay);
    expect(limit?.timezone).toBeNull();
    expect(limit?.label).toBe(hostAdPageDate(last, null));
  });
});


describe("#4238 J7 (r6) start and end are sent in the page's zone, so the server never refuses a day the fields accept", () => {
  const PAGES: [string, string][] = [
    ["2026-12-06T23:30:00Z", "Africa/Lagos"],
    ["2026-12-06T10:30:00Z", "Pacific/Kiritimati"],
    ["2026-12-07T04:30:00Z", "America/Los_Angeles"],
    ["2026-12-06T12:00:00Z", "Asia/Tokyo"],
    ["2026-12-06T23:59:00Z", "UTC"],
  ];
  const dayInZone = (iso: string, zone: string): string =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const timeInZone = (iso: string, zone: string): string =>
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso));

  const cases = VIEWERS.flatMap((viewer) => PAGES.map(([last, zone]) => [viewer, last, zone] as const));
  it.each(cases)("viewer %s, last bookable %s in %s", (viewer, last, zone) => {
    viewIn(viewer);
    const page = base({ last_bookable_at: last, timezone: zone });
    const limit = hostAdScheduleLimit(page, (iso) => hostAdPageDate(iso, page.timezone));
    expect(limit?.timezone).toBe(zone);
    const lastDay = String(limit?.lastDay);
    const dayBefore = new Date(Date.parse(`${lastDay}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    for (const startDay of [dayBefore, lastDay]) {
      for (const endDay of ["", dayBefore, lastDay]) {
        if (endDay !== "" && endDay < startDay) continue;
        if (hostAdScheduleError(startDay, endDay, limit) !== null) continue;
        const sent = hostAdScheduleIsos(startDay, endDay, limit, page.timezone);
        // What ad-plan's adScheduleBoundError checks, verbatim.
        expect(sent.endsAt).not.toBeNull();
        expect(Date.parse(String(sent.endsAt))).toBeLessThanOrEqual(Date.parse(last));
        expect(Date.parse(String(sent.startsAt))).toBeLessThan(Date.parse(last));
        // The start is that day's midnight in the PAGE's zone.
        expect(dayInZone(String(sent.startsAt), zone)).toBe(startDay);
        expect(timeInZone(String(sent.startsAt), zone)).toBe("00:00:00");
        // An earlier end day ends at that day's end in the page's zone (P3-3).
        if (endDay === dayBefore) {
          expect(dayInZone(String(sent.endsAt), zone)).toBe(dayBefore);
          expect(timeInZone(String(sent.endsAt), zone)).toBe("23:59:59");
        }
        if (endDay === lastDay || endDay === "") expect(sent.endsAt).toBe(new Date(last).toISOString());
      }
    }
    // A saved plan reads back as the same days.
    expect(hostAdDayOf(last, zone)).toBe(lastDay);
  });

  it.each(VIEWERS)("viewer %s: a start whose first moment is the last bookable moment is refused in the builder, not by the server", (viewer) => {
    viewIn(viewer);
    // Exactly Lagos midnight Mon 7 Dec.
    const page = base({ last_bookable_at: "2026-12-06T23:00:00Z", timezone: "Africa/Lagos" });
    const limit = hostAdScheduleLimit(page, (iso) => hostAdPageDate(iso, page.timezone));
    expect(limit?.lastDay).toBe("2026-12-07");
    expect(hostAdScheduleError("2026-12-07", "", limit)).toBe(
      "Your ad has to start by Mon 7 Dec, the last day people can book.",
    );
  });

  it.each(VIEWERS)("viewer %s: without a page zone the viewer's calendar is used for both", (viewer) => {
    viewIn(viewer);
    expect(hostAdDayBoundaryIso("2026-12-07", "start", null)).toBe(new Date(2026, 11, 7, 0, 0, 0, 0).toISOString());
    expect(hostAdDayBoundaryIso("2026-12-07", "end", "Mars/Olympus_Mons")).toBe(
      new Date(2026, 11, 7, 23, 59, 59, 999).toISOString(),
    );
    expect(hostAdDayBoundaryIso("bad", "start", "UTC")).toBeNull();
  });
});
