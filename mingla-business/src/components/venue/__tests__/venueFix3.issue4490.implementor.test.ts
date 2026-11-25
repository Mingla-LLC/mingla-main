/**
 * #4490 fix round 3 — the rules behind the fixes: an event takes its space
 * (N101, wording, save payload, plain refusals), combinations on the Where
 * step and the Calendar's "part in use" (N106, N102), the one short booking
 * reference (N108), the waitlist seat sheet's day-first dates and "Now"
 * (N114), and the plans bar line (N87).
 */
jest.mock("../../../services/supabase", () => ({
  supabase: { rpc: jest.fn(async () => ({ data: {}, error: null })) },
}));

import { supabase } from "../../../services/supabase";
import { setEventVenue } from "../../../services/venueFeaturesService";
import { mapVenueCalendar } from "../../../services/venueOffersService";
import { blocksFor, calendarRows, eventSpaceIds } from "../features/calendar/calendarModel";
import {
  DEFAULT_EVENT_SPACE_USE,
  eventVenueErrorCopy,
  spaceUseChoices,
} from "../features/eventWhereModel";
import { shortBookingReference } from "../../../utils/venueBookingReference";
import {
  EVENT_SPACE_TAKEN_COPY,
  describeUnmappedEditGuard,
  describeUnmappedPublishGuard,
  isEventSpaceTakenRefusal,
} from "../../../utils/paidPublishGuards";
import { NOW_SLOT, nextDates, venueOpenNow } from "../waitlistSeatModel";

const rpc = supabase.rpc as unknown as jest.Mock;

describe("N101 — an event takes its space", () => {
  beforeEach(() => rpc.mockClear());

  test("a new pick takes the space unless the host says otherwise", () => {
    expect(DEFAULT_EVENT_SPACE_USE).toBe("exclusive");
  });

  test("the two choices name the place", () => {
    const [takes, shared] = spaceUseChoices("event", "The Lounge Side");
    expect(takes).toMatchObject({ value: "exclusive", label: "This event takes the space" });
    expect(takes.helper).toBe("No private hire, by-the-hour booking or block can use The Lounge Side while it runs.");
    expect(shared).toMatchObject({ value: "shared", label: "The space stays open to others" });
    expect(shared.helper).toBe("Hires and bookings can still use The Lounge Side at the same time.");
  });

  test("the whole venue reads as the whole venue", () => {
    const [takes, shared] = spaceUseChoices("experience", null);
    expect(takes.label).toBe("This experience takes the whole venue");
    expect(shared.label).toBe("The venue stays open to others");
  });

  test("the save sends the choice (it was always 'shared')", async () => {
    await setEventVenue({ eventId: "e1", venueId: "v1", spaceId: "s1", spaceUse: "exclusive" });
    expect(rpc).toHaveBeenCalledWith("issue_4490_set_event_venue", {
      p_event_id: "e1",
      p_venue_id: "v1",
      p_space_id: "s1",
      p_space_use: "exclusive",
      p_expected_updated_at: null,
      p_combination_id: null,
    });
  });

  test("a combination is saved as a combination, never with a space", async () => {
    await setEventVenue({ eventId: "e1", venueId: "v1", spaceId: null, combinationId: "c1", spaceUse: "exclusive" });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_space_id: null, p_combination_id: "c1", p_space_use: "exclusive" });
  });

  test("not at a venue: nothing is taken", async () => {
    await setEventVenue({ eventId: "e1", venueId: null, spaceId: "s1", combinationId: "c1", spaceUse: "exclusive" });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_venue_id: null, p_space_id: null, p_combination_id: null, p_space_use: "shared" });
  });

  test("a taken space is refused in plain words with a way forward", () => {
    expect(eventVenueErrorCopy("event_space_taken", null, "The Lounge Side")).toBe(
      "The Lounge Side is already hired or blocked while this event runs. Pick another space or time, or let it stay open to others.",
    );
    expect(eventVenueErrorCopy("event_one_place", null, null)).toBe("Pick one space or one combination, not both.");
  });

  test("publish and live edit say why instead of quoting the code", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    expect(isEventSpaceTakenRefusal("event_space_taken")).toBe(true);
    expect(isEventSpaceTakenRefusal("not_event_space_taken_x")).toBe(false);
    expect(describeUnmappedPublishGuard("event_space_taken")).toBe(EVENT_SPACE_TAKEN_COPY);
    expect(describeUnmappedEditGuard("event_space_taken")).toBe(EVENT_SPACE_TAKEN_COPY);
    expect(EVENT_SPACE_TAKEN_COPY).not.toMatch(/event_space_taken|Try again/);
    spy.mockRestore();
  });
});

describe("N102 / N106 — the Calendar and combinations", () => {
  const cal = mapVenueCalendar({
    timezone: "Africa/Lagos",
    from: "2026-11-28",
    to: "2026-11-28",
    spaces: [
      { id: "north", name: "Green Area North", capacity: 150 },
      { id: "south", name: "Green Area South", capacity: 150 },
      { id: "lounge", name: "The Lounge Side", capacity: 200 },
    ],
    combinations: [
      { id: "green", name: "Whole Green Area", spaceIds: ["north", "south"] },
      { id: "greenlounge", name: "Green Area + Lounge", spaceIds: ["north", "south", "lounge"] },
    ],
    claims: [],
    combinationBlocks: [],
    requests: [],
    days: [],
    events: [
      { eventId: "e1", title: "Arcade Afterdark", spaceId: "lounge", spaceIds: ["lounge"], spaceUse: "shared", status: "scheduled", startsAt: "2026-11-28T20:00:00Z", endsAt: "2026-11-28T22:59:00Z" },
      { eventId: "e2", title: "Garden party", spaceId: null, combinationId: "green", spaceIds: ["north", "south"], spaceUse: "shared", status: "scheduled", startsAt: "2026-11-28T12:00:00Z", endsAt: "2026-11-28T15:00:00Z" },
    ],
  });
  const rows = calendarRows(cal);
  const row = (key: string) => rows.find((r) => r.key === key)!;

  test("a combination event sits on each part and on its combination", () => {
    expect(blocksFor(cal, row("s:north"), "2026-11-28").map((b) => b.title)).toEqual(["Garden party"]);
    expect(blocksFor(cal, row("s:north"), "2026-11-28")[0].detail).toBe("13:00–16:00 · Whole Green Area");
    expect(blocksFor(cal, row("c:green"), "2026-11-28").map((b) => `${b.tone}:${b.title}`)).toEqual(["event:Garden party"]);
  });

  test("a combination containing an event's space shows 'Part in use' that day", () => {
    const blocks = blocksFor(cal, row("c:greenlounge"), "2026-11-28");
    expect(blocks.map((b) => `${b.tone}:${b.title}`)).toEqual([
      "part:Part in use · Garden party",
      "part:Part in use · Arcade Afterdark",
    ]);
    expect(blocks[1].detail).toBe("21:00–23:59 · The Lounge Side");
    expect(blocks[1].label).toBe("Part in use: Arcade Afterdark on The Lounge Side, 21:00–23:59");
  });

  test("older servers without spaceIds still place the event", () => {
    expect(eventSpaceIds(cal, { ...cal.events[1], spaceIds: [] })).toEqual(["north", "south"]);
    expect(eventSpaceIds(cal, { ...cal.events[0], spaceId: null, combinationId: null, spaceIds: [] })).toEqual(["north", "south", "lounge"]);
  });
});

describe("N108 — one short reference", () => {
  test("the long server reference reads as eight", () => {
    expect(shortBookingReference("VB-8CCAC3230254495296AF")).toBe("VB-8CCAC323");
    expect(shortBookingReference("st-0123456789abcdef0123")).toBe("ST-01234567");
  });
  test("anything else is left alone", () => {
    expect(shortBookingReference("VB-1234")).toBe("VB-1234");
    expect(shortBookingReference(null)).toBeNull();
  });
});

describe("N114 — the seat sheet", () => {
  test("days read day first, in the venue's zone", () => {
    const days = nextDates(4, "Africa/Lagos", new Date("2026-11-19T23:30:00Z"));
    // 00:30 in Lagos: already Friday 20 Nov there.
    expect(days.map((d) => d.label)).toEqual(["Today", "Tomorrow", "Sun 22 Nov", "Mon 23 Nov"]);
    expect(days[0].iso).toBe("2026-11-20");
  });
  test("'Now' only while the venue is taking tables", () => {
    const now = Date.parse("2026-11-21T14:17:00Z");
    expect(NOW_SLOT).toBe("now");
    expect(venueOpenNow([{ slotStartUtc: "2026-11-21T17:00:00Z" }], now)).toBe(false);
    expect(venueOpenNow([{ slotStartUtc: "2026-11-21T14:30:00Z" }, { slotStartUtc: "2026-11-21T21:00:00Z" }], now)).toBe(true);
    expect(venueOpenNow([], now)).toBe(false);
  });
});
