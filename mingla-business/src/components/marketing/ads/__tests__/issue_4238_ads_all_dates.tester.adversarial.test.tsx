/**
 * #4238 — tester adversarial suite for the Host picker and builder.
 * Different angles from the implementor's J1-J4:
 *
 *   T1  The viewer is in New York (forced below) and the event is in Lagos.
 *       Around midnight the picker line, the "+N more dates" count and the
 *       last-day label all follow the EVENT's calendar, never the viewer's.
 *   T2  The end-date cap and its sentence must agree across time zones: the
 *       day the sentence names is the day the date field lets the Host pick,
 *       picking that day is never refused, and the plan never ends after the
 *       last bookable moment (sent EQUAL to it at most).
 *   T3  A greyed-out page's reason never repeats the page's own data (title,
 *       city, link, internal reason keys), whatever the server sends.
 *   T4  Every new sentence passes the plain-language gate and names no
 *       internal code; every new server code maps to a written sentence.
 *
 * T2 is RED on 8a5c84770 for a New York viewer of a Lagos event whose last
 * bookable moment is 00:30 Lagos: the sentence says "Mon 7 Dec" while the
 * date field stops at 6 Dec, and picking 7 Dec is refused with "Your ad can
 * run until Mon 7 Dec ... Pick an earlier end date."
 */

// Force the viewer's zone before any Date is made (Node re-reads TZ).
process.env.TZ = "America/New_York";

import { hostAdPageDate, hostAdPageLastDay, hostAdPageSchedule, hostAdPageUnavailableReason } from "../hostAdPageLabels";
import { hostAdScheduleEndIso, hostAdScheduleError, hostAdScheduleLimit } from "../hostAdBuilderRules";
import { hostAdCopyIsPlain, hostAdErrorMessage } from "../hostAdCopy";
import type { HostAdPage } from "../../../../services/hostAdPlanService";

const page = (patch: Partial<HostAdPage>): HostAdPage => ({
  page_type: "event",
  id: "p",
  brand_slug: "harmattan",
  entity_slug: "sunday-rooftop",
  title: "Sunday Rooftop Sessions",
  brand_name: "Harmattan Club",
  canonical_url: "https://host.usemingla.com/e/harmattan/sunday-rooftop",
  availability: "available",
  starts_at: null,
  city: "Lagos",
  cover_url: null,
  result_kind: "tickets",
  ok: true,
  ...patch,
});

/** "YYYY-MM-DD" in the given zone. */
const dayIn = (iso: string, zone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** "Mon 7 Dec" for a "YYYY-MM-DD" calendar day (zone-free). */
const calendarLabel = (day: string): string =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );

/** The builder's own end-of-day boundary (HostAdCreateScreen scheduleBoundaryIso). */
const endOfLocalDay = (day: string): string => new Date(`${day}T23:59:59.999`).toISOString();

describe("#4238 T0 the viewer really is in New York", () => {
  it("runs with a New York offset", () => {
    // 2026-12-06 is EST (UTC-5).
    expect(new Date("2026-12-06T12:00:00Z").getTimezoneOffset()).toBe(300);
  });
});

describe("#4238 T1 Lagos event, New York viewer, around midnight", () => {
  // 23:30 UTC Sun 6 Dec = 00:30 Mon 7 Dec in Lagos = 18:30 Sun 6 Dec in New York.
  const NEXT = "2026-12-06T23:30:00Z";

  it("the picker line reads the Lagos day", () => {
    expect(hostAdPageSchedule(page({ next_date: NEXT, dates_remaining: 3, timezone: "Africa/Lagos" }))).toBe(
      "Mon 7 Dec · +2 more dates",
    );
  });

  it("falls back to the next date when starts_at is the old first date", () => {
    expect(
      hostAdPageSchedule(
        page({ starts_at: "2026-10-18T18:00:00Z", next_date: NEXT, dates_remaining: 2, timezone: "Africa/Lagos" }),
      ),
    ).toBe("Mon 7 Dec · +1 more date");
  });

  it("the last-day label reads the Lagos day", () => {
    expect(hostAdPageLastDay(page({ last_bookable_at: NEXT, timezone: "Africa/Lagos" }))).toBe("Mon 7 Dec");
  });

  it("an unknown zone never throws and still shows a date", () => {
    expect(hostAdPageDate(NEXT, "Mars/Olympus_Mons")).toBe("Sun 6 Dec");
  });

  it("dates_remaining 0 or missing shows only the date, never '+-1'", () => {
    expect(hostAdPageSchedule(page({ next_date: NEXT, dates_remaining: 0, timezone: "Africa/Lagos" }))).toBe("Mon 7 Dec");
    expect(hostAdPageSchedule(page({ next_date: NEXT, dates_remaining: null, timezone: "Africa/Lagos" }))).toBe("Mon 7 Dec");
  });
});

describe("#4238 T2 the end-date cap agrees with its own sentence across zones", () => {
  const CASES: [string, string, string][] = [
    // [last_bookable_at, event zone, why]
    ["2026-12-06T23:30:00Z", "Africa/Lagos", "00:30 Mon in Lagos is Sun evening in New York"],
    ["2026-12-07T04:30:00Z", "America/Los_Angeles", "20:30 Sun in LA is 23:30 Sun in New York"],
    ["2026-12-06T22:00:00Z", "Africa/Lagos", "23:00 Sun in Lagos, 17:00 Sun in New York"],
    ["2026-12-07T10:00:00Z", "Pacific/Kiritimati", "00:00 Tue in Kiritimati is Mon morning in New York"],
  ];

  it.each(CASES)("%s in %s (%s)", (last, zone) => {
    const p = page({ last_bookable_at: last, timezone: zone });
    const limit = hostAdScheduleLimit(p, (iso) => hostAdPageDate(iso, p.timezone));
    expect(limit).not.toBeNull();
    const eventDay = dayIn(last, zone);
    // The sentence ("Your ad can run until <label>") and the date field's last
    // pickable day (lastDay) must name the SAME calendar day — whichever zone
    // the fix picks — so the Host is never told "until Mon 7 Dec" by a field
    // that stops at 6 Dec, or refused for picking the day the sentence names.
    expect(limit!.label).toBe(calendarLabel(limit!.lastDay));
    expect(hostAdScheduleError("", limit!.lastDay, limit)).toBeNull();
    const labelDay = [eventDay, dayIn(last, "America/New_York")].find((d) => calendarLabel(d) === limit!.label);
    expect(labelDay).toBeDefined();
    expect(hostAdScheduleError("", String(labelDay), limit)).toBeNull();
    // Whatever day is picked, the plan never ends after the last bookable moment.
    for (const picked of [limit!.lastDay, eventDay]) {
      const sent = hostAdScheduleEndIso(endOfLocalDay(picked), limit);
      expect(Date.parse(String(sent))).toBeLessThanOrEqual(Date.parse(last));
    }
    // No end picked → exactly the last bookable moment.
    expect(hostAdScheduleEndIso(null, limit)).toBe(new Date(last).toISOString());
  });

  it("an end one millisecond past the limit is pulled back to the limit exactly", () => {
    const limit = hostAdScheduleLimit(page({ last_bookable_at: "2026-12-06T22:00:00.000Z" }), () => "Sun 6 Dec");
    expect(hostAdScheduleEndIso("2026-12-06T22:00:00.001Z", limit)).toBe("2026-12-06T22:00:00.000Z");
    expect(hostAdScheduleEndIso("2026-12-06T22:00:00.000Z", limit)).toBe("2026-12-06T22:00:00.000Z");
  });

  it("a Postgres microsecond timestamp is capped to the same instant the server checks", () => {
    const limit = hostAdScheduleLimit(page({ last_bookable_at: "2026-12-06T22:00:00.123456+00:00" }), () => "Sun 6 Dec");
    // The server (adScheduleBoundError) compares at millisecond precision.
    expect(hostAdScheduleEndIso(null, limit)).toBe("2026-12-06T22:00:00.123Z");
  });
});

describe("#4238 T3 a greyed-out reason never repeats the page's data", () => {
  const hostile = page({
    ok: false,
    title: "Private: CEO birthday dinner",
    city: "Ikoyi",
    canonical_url: "https://host.usemingla.com/e/x/secret",
    availability_reason: "admin.dest.private",
  });
  it.each(["draft", "private", "unlisted", "ended", "nothing_on_sale", "bookings_closed", "not_live", "<script>", ""])(
    "availability %j",
    (availability) => {
      const reason = String(hostAdPageUnavailableReason({ ...hostile, availability }));
      expect(reason).not.toMatch(/CEO|birthday|Ikoyi|secret|https?:|admin\.dest|<script>/i);
      expect(hostAdCopyIsPlain(reason)).toBe(true);
    },
  );
});

describe("#4238 T4 every new sentence is plain and names no code", () => {
  const limit = hostAdScheduleLimit(page({ last_bookable_at: "2026-12-06T22:00:00Z", timezone: "Africa/Lagos" }), (iso) =>
    hostAdPageDate(iso, "Africa/Lagos"),
  );
  const sentences = [
    String(hostAdScheduleError("", "2027-01-01", limit)),
    String(hostAdScheduleError("2027-01-01", "", limit)),
    `Leave the start empty to begin after approval. Your ad runs until ${limit!.label} at the latest, the last day people can book.`,
    "None of your pages can be promoted right now. Each one says why.",
    ...[
      "schedule_end_required",
      "schedule_ends_after_last_date",
      "schedule_starts_after_last_date",
      "destination_ended",
      "destination_nothing_on_sale",
      "destination_bookings_closed",
      "destination_unlisted_not_linkable",
    ].map((detail) => hostAdErrorMessage({ code: "plan_preflight_failed", detail })),
  ];
  it.each(sentences)("%s", (text) => {
    expect(hostAdCopyIsPlain(text)).toBe(true);
    expect(text).not.toMatch(/_|destination|canonical|last_bookable|preflight|null|undefined|NaN/);
  });

  it("each new server code has its own sentence, not the generic fallback", () => {
    const fallback = hostAdErrorMessage({ code: "plan_preflight_failed", detail: "zz_unknown_zz" });
    for (const detail of [
      "schedule_end_required",
      "schedule_starts_after_last_date",
      "destination_nothing_on_sale",
      "destination_bookings_closed",
      "destination_unlisted_not_linkable",
    ]) {
      expect(hostAdErrorMessage({ code: "plan_preflight_failed", detail })).not.toBe(fallback);
    }
  });
});
