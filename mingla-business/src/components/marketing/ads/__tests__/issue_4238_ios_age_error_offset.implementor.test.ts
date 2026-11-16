/**
 * #4238 iOS P3-1: the age error line must clear the keyboard Done bar.
 * Fails against base 9f4e61651c (no helper there). The screen wiring is pinned
 * in the I-4420-HOST-WIRING gate.
 */
import {
  HOST_AD_CARET_BELOW_FIELD_IOS,
  HOST_AD_ERROR_LINE_ROOM,
  hostAdErrorLineBottomOffset,
} from "../hostAdBuilderRules";

describe("#4238 iOS age error line clears the Done bar", () => {
  it("adds Done bar + caret residual + clearance + the error line on iOS", () => {
    expect(hostAdErrorLineBottomOffset("ios", 53, 12, true)).toBe(53 + HOST_AD_CARET_BELOW_FIELD_IOS + 12 + HOST_AD_ERROR_LINE_ROOM);
    expect(hostAdErrorLineBottomOffset("ios", 42, 12, true)).toBe(42 + 13.5 + 12 + 28);
  });
  it("is larger than the default (Done bar + caret + clearance) by the error line", () => {
    const base = 53 + 13.5 + 12;
    expect((hostAdErrorLineBottomOffset("ios", 53, 12, true) as number) - base).toBe(HOST_AD_ERROR_LINE_ROOM);
  });
  it("leaves the default alone without an error line, on Android and on web", () => {
    expect(hostAdErrorLineBottomOffset("ios", 53, 12, false)).toBeNull();
    expect(hostAdErrorLineBottomOffset("android", 42, 12, true)).toBeNull();
    expect(hostAdErrorLineBottomOffset("web", 0, 12, true)).toBeNull();
  });
});
