/**
 * #3040 Appendix A §10 (motion) and §11 (accessibility) for the cover sheet.
 * Pins the design's numbers, the reduced-motion variants, the live-region
 * thresholds, the progressbar value text, the Dynamic-Type stacking rule, and
 * the wiring in CoverPicker.
 * FAILS ON REVERT: change a duration, announce every %, drop the reduced-motion
 * branch, or drop a hint / the hidden live region from CoverPicker.
 */
import React from "react";
import { readFileSync } from "fs";
import { join } from "path";
import { AccessibilityInfo, Animated, LayoutAnimation, Text } from "react-native";

import {
  CardPresence,
  CrossfadeLayers,
  FadeOnChange,
  coverSwapSignal,
  MOTION_SPEC,
  announceBucket,
  prefersStackedActions,
  progressValueText,
  uploadAnnouncement,
} from "../coverUploadMotion";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (predicate: (node: { type: unknown; props: Record<string, unknown> }) => boolean) => { props: Record<string, unknown> }[] };
    update: (element: React.ReactElement) => void;
    unmount: () => void;
  };
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const picker = readFileSync(join(__dirname, "..", "CoverPicker.tsx"), "utf8");

describe("#3040 §10 motion numbers", () => {
  it("match the design table, with the reduced-motion variants", () => {
    expect(MOTION_SPEC.determinateBar).toEqual({ durationMs: 200, reducedMs: 0 });
    expect(MOTION_SPEC.cardTitle).toEqual({ durationMs: 120, reducedMs: 0 });
    expect(MOTION_SPEC.stepperSegment).toEqual({ durationMs: 260, reducedMs: 0 });
    expect(MOTION_SPEC.cardEnter).toEqual({ durationMs: 260, reducedMs: 120, translateY: 8 });
    expect(MOTION_SPEC.cardExit).toEqual({ durationMs: 180, reducedMs: 120 });
    expect(MOTION_SPEC.coverSwap).toEqual({ durationMs: 320, reducedMs: 120 });
    expect(MOTION_SPEC.badgePop).toEqual({ from: 0.6, mass: 1, stiffness: 260, damping: 18 });
    expect(MOTION_SPEC.inlineConfirm).toEqual({ durationMs: 200, reducedMs: 0 });
    expect(MOTION_SPEC.offlineNudge).toEqual({ totalMs: 240, cycles: 3, distance: 4, reducedMs: 0 });
    expect(MOTION_SPEC.galleryRing).toEqual({ durationMs: 200, reducedMs: 0 });
  });
});

describe("#3040 §11 announcements", () => {
  it("announces % only at 25 / 50 / 75 / 100", () => {
    expect([0, 10, 24, 25, 49, 50, 74, 75, 99, 100].map(announceBucket))
      .toEqual([null, null, null, 25, 25, 50, 50, 75, 75, 100]);
    expect(uploadAnnouncement("Uploading", 12)).toBe("Uploading");
    expect(uploadAnnouncement("Uploading", 51)).toBe("Uploading, 50 percent");
    expect(uploadAnnouncement("Preparing at Mingla", null)).toBe("Preparing at Mingla");
  });

  it("reads the progressbar as '42 percent, 7.1 of 16.8 megabytes'", () => {
    const mb = 1024 * 1024;
    expect(progressValueText(42.4, 7.1 * mb, 16.8 * mb)).toBe("42 percent, 7.1 of 16.8 megabytes");
    expect(progressValueText(42, null, null)).toBe("42 percent");
  });

  it("stacks the two-up actions when a label could truncate (Dynamic Type)", () => {
    expect(prefersStackedActions({ wide: false, fontScale: 1, sheetWidth: 700, longestLabelChars: 12 })).toBe(true);
    expect(prefersStackedActions({ wide: true, fontScale: 1, sheetWidth: 700, longestLabelChars: 17 })).toBe(false);
    expect(prefersStackedActions({ wide: true, fontScale: 1.5, sheetWidth: 700, longestLabelChars: 17 })).toBe(true);
    expect(prefersStackedActions({ wide: true, fontScale: 1.2, sheetWidth: 600, longestLabelChars: 40 })).toBe(true);
  });
});

describe("#3040 §10 components", () => {
  afterEach(() => jest.restoreAllMocks());

  it("CardPresence fades the last card out, closes the height, then unmounts it", async () => {
    const layout = jest.spyOn(LayoutAnimation, "configureNext");
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<CardPresence visible><Text>Uploading</Text></CardPresence>);
    });
    expect(renderer.root.findAll((node) => node.type === Text)).toHaveLength(1);
    await TestRenderer.act(async () => {
      renderer.update(<CardPresence visible={false}>{null}</CardPresence>);
    });
    expect(layout).toHaveBeenCalled();
    expect(renderer.root.findAll((node) => node.type === Text)).toHaveLength(0);
    renderer.unmount();
  });

  it("reduced motion: no layout animation on exit, and FadeOnChange skips its first render when asked", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const layout = jest.spyOn(LayoutAnimation, "configureNext");
    const timing = jest.spyOn(Animated, "timing");
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <FadeOnChange swapKey="a" durationMs={120} reducedMs={0} animateInitial={false}><Text>T</Text></FadeOnChange>,
      );
    });
    expect(timing).not.toHaveBeenCalled();
    renderer.unmount();
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<CardPresence visible><Text>Card</Text></CardPresence>);
    });
    await TestRenderer.act(async () => {
      renderer.update(<CardPresence visible={false}>{null}</CardPresence>);
    });
    expect(layout).not.toHaveBeenCalled();
    renderer.unmount();
  });
});

describe("#3040 §10 H-15 true crossfade", () => {
  afterEach(() => jest.restoreAllMocks());

  const run = async (reduce: boolean) => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduce);
    const timing = jest.spyOn(Animated, "timing");
    const settled = jest.fn();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    const tree = (signal: string | null, outgoing: React.ReactNode) => (
      <CrossfadeLayers signal={signal} outgoing={outgoing} onSettled={settled}>
        <Text>NEW</Text>
      </CrossfadeLayers>
    );
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(tree(null, null));
    });
    await TestRenderer.act(async () => {
      renderer.update(tree("job-1", <Text>OLD</Text>));
    });
    return { renderer, timing, settled, tree };
  };

  it("keeps the old layer over the new one and fades both for 320 ms", async () => {
    const { renderer, timing, settled } = await run(false);
    const texts = renderer.root.findAll((node) => node.type === Text).map((node) => node.props.children);
    expect(texts).toEqual(["NEW", "OLD"]);
    const durations = timing.mock.calls.map((call) => (call[1] as { duration: number }).duration);
    expect(durations).toEqual([320, 320]);
    const targets = timing.mock.calls.map((call) => (call[1] as { toValue: number }).toValue);
    expect(targets).toEqual([1, 0]);
    expect(settled).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it("is still a crossfade under reduced motion, at 120 ms", async () => {
    const { renderer, timing } = await run(true);
    const durations = timing.mock.calls.map((call) => (call[1] as { duration: number }).duration);
    expect(durations.slice(-2)).toEqual([120, 120]);
    expect(renderer.root.findAll((node) => node.type === Text).map((node) => node.props.children)).toEqual(["NEW", "OLD"]);
    renderer.unmount();
  });

  it("runs once per applied job, and only once the job's video is on screen", () => {
    expect(coverSwapSignal({ justAppliedJobId: "j", appliedUrl: "https://v/new.mp4", shownUrl: "https://v/old.mp4" })).toBeNull();
    expect(coverSwapSignal({ justAppliedJobId: "j", appliedUrl: "https://v/new.mp4", shownUrl: "https://v/new.mp4" })).toBe("j");
    expect(coverSwapSignal({ justAppliedJobId: null, appliedUrl: "https://v/new.mp4", shownUrl: "https://v/new.mp4" })).toBeNull();
  });
});

describe("#3040 §10/§11 CoverPicker wiring", () => {
  it("the determinate bar eases, and jumps under reduced motion", () => {
    expect(picker).toMatch(/\{reduceMotion \? \(\s*<View style=\{\[styles\.progressFill, \{ transform: \[\{ scaleX: copy\.percent \/ 100 \}\] \}\]\} \/>\s*\) : \(\s*<AnimatedProgressFill fraction=\{copy\.percent \/ 100\}/);
  });

  it("the card's live region holds only the title and the % step", () => {
    expect(picker).toContain("const announcement = uploadAnnouncement(model.title, determinate ? copy.percent : null);");
    expect(picker).toContain('<View style={styles.uploadCardHeaderText} accessibilityLiveRegion="polite" aria-live="polite">');
    expect(picker).toContain("{percentStep !== null ? <Text style={styles.srOnly}>{`${percentStep} percent`}</Text> : null}");
    expect(picker).toContain("const percentStep = announceBucket(determinate ? copy.percent : null);");
    expect(picker).toContain('<Text style={styles.uploadCardPercent} accessibilityElementsHidden importantForAccessibility="no">');
    expect(picker).toContain("useIosAnnouncement(announcement);");
    expect(picker).toContain('useFocusOnAlertEntry(titleRef, model.stateId, model.role === "alert");');
    expect(picker).toContain("text: progressValueText(copy.percent, bytes.confirmed, bytes.total)");
  });

  it("title crossfade, stepper fill, card presence, inline confirm, H-15 swap and the H-10 nudge are wired", () => {
    expect(picker).toMatch(/<FadeOnChange\s+swapKey=\{model\.title\}/);
    expect(picker).toContain("<StepperSegmentFill");
    expect(picker).toContain("<CardPresence visible={cardModel !== null}>");
    expect(picker).toContain("animateInlineConfirmSwap(reduceMotion);");
    expect(picker).toMatch(/<FadeOnChange\s+swapKey=\{confirming\}/);
    expect(picker).toMatch(/<CrossfadeLayers\s+signal=\{swapFade\?\.signal \?\? null\}/);
    expect(picker).toContain("<PopOnSignal signal={coverSwapSignal} style={styles.selectedBadge}>");
    expect(picker).toContain('<NudgeOnSignal signal={model.stateId === "H-10" ? nudgeSignal : 0}>');
    expect(picker).toContain("setOfflineNudge((count) => count + 1);");
  });

  it("every cover action carries its §11 hint, and two-up yields to Dynamic Type", () => {
    expect(picker).toContain("accessibilityHint={coverAction.hint}");
    expect(picker).toContain('accessibilityHint="Asks before removing."');
    expect(picker).toMatch(/const wide = twoUpWidth && !prefersStackedActions\(/);
  });
});
