import { mapPoolOpeningHoursToBrandHours } from "../mapPoolOpeningHoursToBrandHours";

describe("mapPoolOpeningHoursToBrandHours", () => {
  test("returns default week when opening_hours is null", () => {
    const rows = mapPoolOpeningHoursToBrandHours(null);
    expect(rows).toHaveLength(7);
    expect(rows[6]?.isClosed).toBe(true);
  });

  test("maps Google Sunday period to weekday 6", () => {
    const rows = mapPoolOpeningHoursToBrandHours({
      periods: [
        {
          open: { day: 0, hour: 11, minute: 0 },
          close: { day: 0, hour: 22, minute: 0 },
        },
      ],
    });
    const sun = rows.find((r) => r.weekday === 6);
    expect(sun?.isClosed).toBe(false);
    expect(sun?.openTime).toBe("11:00");
    expect(sun?.closeTime).toBe("22:00");
  });

  test("maps Google Monday period to weekday 0", () => {
    const rows = mapPoolOpeningHoursToBrandHours({
      periods: [
        {
          open: { day: 1, hour: 9, minute: 30 },
          close: { day: 1, hour: 17, minute: 0 },
        },
      ],
    });
    const mon = rows.find((r) => r.weekday === 0);
    expect(mon?.openTime).toBe("09:30");
    expect(mon?.closeTime).toBe("17:00");
  });
});
