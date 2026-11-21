// #2331 (D5) — the RN-web Modal box ends at the privacy strip's top edge, so a
// sheet's keyboard lift is measured from there, not from the layout bottom.
// Without the band the panel floated the strip's 28px above the iOS keyboard
// and, with the keyboard closed, its top sat 28px under the screen edge.
import { sheetAnchorMetrics } from "../sheetAnchorMetrics";

describe("#2331 SheetMobile anchors at the strip", () => {
  it("iOS keyboard open: the panel bottom lands on the visible bottom, not 28px above it", () => {
    const m = sheetAnchorMetrics({ inner: 844, visible: 508, offsetTop: 0, band: 28 });
    // Panel bottom = anchor − lift = (844 − 28) − 308 = 508 = visible bottom.
    expect(m.layoutHeight).toBe(816);
    expect(m.visibleBottomGap).toBe(308);
    expect(m.layoutHeight - m.visibleBottomGap).toBe(508);
    expect(m.visibleHeight).toBe(508);
  });

  it("keyboard closed: no lift, and the panel is bounded to the box above the strip", () => {
    const m = sheetAnchorMetrics({ inner: 844, visible: 844, offsetTop: 0, band: 28 });
    expect(m.visibleBottomGap).toBe(0);
    expect(m.visibleHeight).toBe(816);
  });

  it("Android keyboard (offsetTop shift) and no strip box (band 0) keep the old maths", () => {
    expect(sheetAnchorMetrics({ inner: 600, visible: 600, offsetTop: 0, band: 0 })).toEqual({
      visibleHeight: 600, layoutHeight: 600, offsetTop: 0, visibleBottomGap: 0,
    });
    const android = sheetAnchorMetrics({ inner: 500, visible: 300, offsetTop: 100, band: 28 });
    expect(android.layoutHeight - android.visibleBottomGap).toBe(400);
  });
});
