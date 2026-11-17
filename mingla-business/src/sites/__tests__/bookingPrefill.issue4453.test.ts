/**
 * #4453 milestone 5 — the buyer-web pre-fill parameters a Mingla website sends.
 * Bad values are ignored, never trusted.
 */
import { prefillCount, prefillDate, prefillTime, venuePrefill } from "../bookingPrefill";

describe("#4453 M5 venue page pre-fill", () => {
  it("reads a site's table link", () => {
    expect(venuePrefill({ tab: "book", date: "2026-11-20", time: "18:30", party: "4" })).toEqual({
      tab: "reservations", date: "2026-11-20", time: "18:30", party: 4, checkin: null, checkout: null, guests: null, room: null,
    });
  });
  it("reads a site's stay link (checkout must follow check-in)", () => {
    const room = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";
    expect(venuePrefill({ tab: "stay", checkin: "2026-11-20", checkout: "2026-11-22", guests: "2", room })).toMatchObject({ tab: "reservations", checkin: "2026-11-20", checkout: "2026-11-22", guests: 2, room });
    expect(venuePrefill({ tab: "stay", checkin: "2026-11-22", checkout: "2026-11-20" }).checkout).toBeNull();
  });
  it("adversarial: bad values are ignored, never passed on", () => {
    expect(prefillDate("2026-02-31")).toBeNull();
    expect(prefillDate("<script>")).toBeNull();
    expect(prefillTime("25:00")).toBeNull();
    expect(prefillTime("7pm")).toBeNull();
    expect(prefillCount("0")).toBeNull();
    expect(prefillCount("21")).toBeNull();
    expect(venuePrefill({ party: "13" }).party).toBeNull();
    expect(venuePrefill({ party: "12" }).party).toBe(12);
    expect(prefillCount("4e1")).toBeNull();
    expect(venuePrefill({ tab: "admin", room: "../../x" })).toMatchObject({ tab: null, room: null });
    expect(venuePrefill({ date: ["2026-11-20", "2026-11-21"] }).date).toBe("2026-11-20");
  });
});

import { experiencePrefill, matchExperienceDate } from "../bookingPrefill";

describe("#4453 M5 experience pre-fill", () => {
  const dates = [
    { id: "d1", startAt: "2026-11-20T11:00:00Z", timezone: "Africa/Lagos" },
    { id: "d2", startAt: "2026-11-20T15:00:00Z", timezone: "Africa/Lagos" },
    { id: "d3", startAt: "2026-11-21T11:00:00Z", timezone: "Africa/Lagos" },
  ];
  it("matches the date and slot in the date's own zone", () => {
    expect(matchExperienceDate(dates, experiencePrefill({ date: "2026-11-20", slot: "16:00" }), "UTC")?.id).toBe("d2");
    expect(matchExperienceDate(dates, experiencePrefill({ date: "2026-11-21" }), "UTC")?.id).toBe("d3");
  });
  it("adversarial: a time that is not a slot, or a bad value, picks nothing", () => {
    expect(matchExperienceDate(dates, experiencePrefill({ date: "2026-11-20", slot: "11:00" }), "UTC")).toBeNull();
    expect(matchExperienceDate(dates, experiencePrefill({ date: "2026-13-01", slot: "16:00" }), "UTC")).toBeNull();
    expect(experiencePrefill({ guests: "0", slot: "9pm" })).toEqual({ date: null, slot: null, guests: null });
  });
});
