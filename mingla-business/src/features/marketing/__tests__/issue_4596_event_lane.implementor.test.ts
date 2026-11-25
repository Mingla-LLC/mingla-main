/**
 * #4596 — every event audience rides the combined lane (the only lane that
 * counts RSVP guests, quotes them and refuses a blast to nobody). An old
 * event_buyers draft maps to its event key and so takes that lane on open (A1).
 */
import {
  needsCombinedLane,
  sourceKeysForDefinition,
} from "../blastSendModel";

describe("#4596 event audiences ride the combined lane", () => {
  it("one event by one method is combined", () => {
    expect(needsCombinedLane(["event:x"], ["email"])).toBe(true);
    expect(needsCombinedLane(["event:x"], ["sms"])).toBe(true);
  });
  it("a single non-event group by one method keeps its own lane", () => {
    expect(needsCombinedLane(["brand_buyers"], ["email"])).toBe(false);
    expect(needsCombinedLane(["book"], ["sms"])).toBe(false);
    expect(needsCombinedLane([], ["email"])).toBe(false);
  });
});

describe("#4596 A1 an event_buyers draft opens onto the combined lane", () => {
  it("maps the stored definition to its event key, which needs the combined lane", () => {
    const keys = sourceKeysForDefinition("a", { kind: "event_buyers", event_id: "X" });
    expect(keys).toEqual(["event:X"]);
    expect(needsCombinedLane(keys, ["email"])).toBe(true);
  });
});
