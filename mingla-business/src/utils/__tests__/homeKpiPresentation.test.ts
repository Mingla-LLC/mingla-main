import {
  formatActiveEventsSub,
  getActiveEventsKpiSub,
} from "../homeKpiPresentation";

const counts = {
  all: 12,
  active: 5,
  live: 0,
  upcoming: 4,
  draft: 1,
  past: 7,
};

describe("home KPI presentation", () => {
  it("keeps active events as a compact two-line KPI on wide desktop", () => {
    expect(getActiveEventsKpiSub(counts, true)).toBeUndefined();
  });

  it("keeps the active event breakdown on mobile and narrow web", () => {
    expect(getActiveEventsKpiSub(counts, false)).toBe(
      "0 live · 4 upcoming · 1 draft",
    );
  });

  it("formats the empty active-events state for non-desktop layouts", () => {
    expect(
      formatActiveEventsSub({
        active: 0,
        all: 0,
        live: 0,
        upcoming: 0,
        draft: 0,
        past: 0,
      }),
    ).toBe("No active events");
  });
});
