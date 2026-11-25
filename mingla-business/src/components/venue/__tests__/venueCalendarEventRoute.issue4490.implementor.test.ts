/**
 * #4490 W3 fix 1 — an event block on the venue Calendar opens the screen for
 * that event's type (the canonical events-table route, I-PROPOSED-TR2-EVENTS-TYPE-FILTER), from
 * the calendar's own event row.
 *
 * Fails-on-revert: hard-coding `/event/${id}` again sends the trip, experience
 * and RSVP cases to the ticketed event dashboard (R-2..R-4 fail).
 */
import { calendarEventRoute } from "../features/calendar/calendarModel";

const cal = (eventType: string | null, status = "scheduled") => ({
  events: [{
    eventId: "e1", title: "Night", spaceId: null, spaceUse: null, status,
    startsAt: "2026-11-22T18:00:00Z", endsAt: "2026-11-22T22:00:00Z", eventType,
  }],
});

describe("venue calendar event route (#4490)", () => {
  it("R-1 a ticketed event opens its dashboard", () => {
    expect(calendarEventRoute(cal("event"), "e1")).toBe("/event/e1");
  });
  it("R-2 a trip at the venue opens the trip dashboard", () => {
    expect(calendarEventRoute(cal("trip"), "e1")).toBe("/trip/e1");
  });
  it("R-3 an experience at the venue opens the experience dashboard", () => {
    expect(calendarEventRoute(cal("experience", "live"), "e1")).toBe("/experience/e1");
  });
  it("R-4 an RSVP at the venue opens the RSVP dashboard", () => {
    expect(calendarEventRoute(cal("rsvp"), "e1")).toBe("/rsvp/e1");
  });
  it("R-5 an older server (no type) or an unlisted event opens the event dashboard", () => {
    expect(calendarEventRoute(cal(null), "e1")).toBe("/event/e1");
    expect(calendarEventRoute(cal("trip"), "other")).toBe("/event/other");
  });
});
