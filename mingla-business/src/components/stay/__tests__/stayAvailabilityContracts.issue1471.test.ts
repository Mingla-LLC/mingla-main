import {
  buildStayPlaceSchedule,
  stayRoomNightCalendarKey,
} from "../stayAvailabilityContracts";

const base = {
  timezone: "America/New_York",
  fromDate: "2026-08-01",
  toDate: "2026-08-07",
  startTime: "09:00",
  endTime: "17:00",
  stopSell: false,
};

describe("Issue #1471 Stay availability contracts", () => {
  it("omits the forbidden end date from a one-off fixed slot", () => {
    const schedule = buildStayPlaceSchedule({
      ...base,
      mode: "fixed_slots",
    });

    expect(schedule).not.toHaveProperty("localEndDate");
    expect(schedule).toMatchObject({
      mode: "fixed_slots",
      localStartDate: "2026-08-01",
      weekdays: [],
      localStartTime: "09:00",
      localEndTime: "17:00",
    });
  });

  it.each(["repeating_windows", "full_day"] as const)(
    "keeps the requested date range for %s",
    (mode) => {
      expect(buildStayPlaceSchedule({ ...base, mode })).toHaveProperty(
        "localEndDate",
        "2026-08-07",
      );
    },
  );

  it("uses the Room-night composite identity as the render key", () => {
    expect(stayRoomNightCalendarKey("offering-1", "2026-08-01")).toBe(
      "offering-1:2026-08-01",
    );
  });
});
