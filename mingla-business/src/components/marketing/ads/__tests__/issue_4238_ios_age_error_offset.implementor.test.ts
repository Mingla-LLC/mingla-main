/**
 * #4238 iOS P3-1: the age error line must clear the keyboard Done bar.
 * Fails against base 9f4e61651c (the helper and the
 * screen wiring below are what that commit adds).
 */
import fs from "fs";
import path from "path";
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
  it("the builder renders the age error inline and passes the offset to its scroll view", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../../../screens/hostAds/HostAdCreateScreen.tsx"), "utf8");
    expect(src).toMatch(/hostAdErrorLineBottomOffset\(\s*Platform\.OS,\s*DONE_BAR_OCCUPIED/);
    expect(src).toContain('testID="host-ad-age-error"');
    expect(src).toContain("{...scrollOffsetProps}");
  });
});
