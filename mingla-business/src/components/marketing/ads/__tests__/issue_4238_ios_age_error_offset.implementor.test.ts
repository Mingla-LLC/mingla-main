/**
 * #4238 P3-1: the age error line must clear the keyboard Done bar on iOS and
 * on Android. The iOS half fails against base 9f4e61651c (no helper there);
 * the Android half failed against d8a443ad2d (helper returned null on Android).
 * The screen wiring is pinned in the I-4420-HOST-WIRING and 4238 wiring gates.
 */
import {
  HOST_AD_CARET_BELOW_FIELD,
  HOST_AD_ERROR_LINE_ROOM,
  hostAdErrorLineBottomOffset,
} from "../hostAdBuilderRules";

describe("#4238 age error line clears the Done bar", () => {
  it("adds Done bar + caret residual + clearance + the error line on iOS", () => {
    expect(hostAdErrorLineBottomOffset("ios", 53, 12, true)).toBe(53 + 13.5 + 12 + HOST_AD_ERROR_LINE_ROOM);
    expect(hostAdErrorLineBottomOffset("ios", 42, 12, true)).toBe(42 + 13.5 + 12 + 34);
  });
  it("adds the same room on Android, with Android's caret residual", () => {
    expect(hostAdErrorLineBottomOffset("android", 42, 12, true)).toBe(42 + 3.16 + 12 + 34);
    expect(HOST_AD_CARET_BELOW_FIELD.android).toBe(3.16);
  });
  it("room covers the error line's footprint: stack gap 16 + caption line 18", () => {
    expect(HOST_AD_ERROR_LINE_ROOM).toBe(34);
    for (const platform of ["ios", "android"] as const) {
      const base = 42 + HOST_AD_CARET_BELOW_FIELD[platform] + 12;
      expect((hostAdErrorLineBottomOffset(platform, 42, 12, true) as number) - base).toBe(HOST_AD_ERROR_LINE_ROOM);
    }
  });
  it("leaves the default alone without an error line, and on web", () => {
    expect(hostAdErrorLineBottomOffset("ios", 53, 12, false)).toBeNull();
    expect(hostAdErrorLineBottomOffset("android", 42, 12, false)).toBeNull();
    expect(hostAdErrorLineBottomOffset("web", 0, 12, true)).toBeNull();
  });
});
