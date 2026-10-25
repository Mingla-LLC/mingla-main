import { calculateMediaViewerStage, fitContain } from "../fitContain";

describe("#3988 media viewer contain geometry", () => {
  it("fits a 4K portrait video in the 1470x779 desktop stage", () => {
    const stage = calculateMediaViewerStage({ viewportWidth: 1470, viewportHeight: 779, insetTop: 0, insetBottom: 0, wideDesktop: true, hasBottomArea: true });
    expect(stage).toEqual({ width: 1294, height: 619, topArea: 56, bottomArea: 72 });
    const box = fitContain(2160, 3840, stage.width, stage.height);
    expect(box.width).toBeCloseTo(348.19, 1);
    expect(box.height).toBe(619);
    expect(stage.topArea + box.top).toBeGreaterThanOrEqual(56);
    expect(stage.topArea + box.top + box.height).toBeLessThanOrEqual(779 - stage.bottomArea);
  });

  it("fits a 3840x1080 video without cropping on desktop", () => {
    const stage = calculateMediaViewerStage({ viewportWidth: 1470, viewportHeight: 779, insetTop: 0, insetBottom: 0, wideDesktop: true, hasBottomArea: true });
    const box = fitContain(3840, 1080, stage.width, stage.height);
    expect(box.width).toBe(1294);
    expect(box.height).toBeCloseTo(363.94, 1);
    expect(box.left).toBe(0);
  });

  it("keeps portrait media within phone-web and native safe areas", () => {
    const phoneWeb = calculateMediaViewerStage({ viewportWidth: 390, viewportHeight: 844, insetTop: 0, insetBottom: 0, wideDesktop: false, hasBottomArea: true });
    const webBox = fitContain(2160, 3840, phoneWeb.width, phoneWeb.height);
    expect(webBox.width).toBeLessThanOrEqual(358);
    expect(webBox.height).toBeLessThanOrEqual(phoneWeb.height);

    const native = calculateMediaViewerStage({ viewportWidth: 393, viewportHeight: 852, insetTop: 59, insetBottom: 34, wideDesktop: false, hasBottomArea: true });
    const nativeBox = fitContain(2160, 3840, native.width, native.height);
    expect(native.topArea).toBe(115);
    expect(native.bottomArea).toBe(106);
    expect(native.topArea + nativeBox.top).toBeGreaterThanOrEqual(115);
    expect(native.topArea + nativeBox.top + nativeBox.height).toBeLessThanOrEqual(852 - native.bottomArea);
  });

  it("uses the whole safe stage until natural dimensions are known", () => {
    expect(fitContain(null, null, 340, 520)).toEqual({ width: 340, height: 520, left: 0, top: 0 });
    expect(fitContain(100, 100, -1, 40)).toEqual({ width: 0, height: 0, left: 0, top: 20 });
  });

  it("grows both control bars instead of clipping largest accessibility text", () => {
    const regular = calculateMediaViewerStage({ viewportWidth: 393, viewportHeight: 852, insetTop: 59, insetBottom: 34, wideDesktop: false, hasBottomArea: true, fontScale: 1 });
    const largestText = calculateMediaViewerStage({ viewportWidth: 393, viewportHeight: 852, insetTop: 59, insetBottom: 34, wideDesktop: false, hasBottomArea: true, fontScale: 2.5 });
    expect(largestText.topArea).toBeGreaterThan(regular.topArea);
    expect(largestText.bottomArea).toBeGreaterThan(regular.bottomArea);
    expect(largestText.topArea).toBe(157);
    expect(largestText.bottomArea).toBe(166);
    expect(largestText.height).toBeGreaterThanOrEqual(0);
  });
});
