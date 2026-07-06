import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1320 [biz Account-tab Apple crash] — T-1 (happy-path structural guard).
 *
 * The business Account-tab crash (Apple rejection 3, EXC_BAD_ACCESS SIGSEGV) was
 * a `react-native-reanimated` worklet on the always-mounted BottomNav spotlight
 * racing the Fabric mount-commit under the New Architecture. The fix de-worklets
 * BottomNav onto RN-core `Animated`. This guard asserts BottomNav (native) never
 * re-acquires a Reanimated worklet import.
 *
 * Enforces I-PROPOSED-1320-NO-WORKLET-ON-TAB-COMMIT-PATH. FAILS on revert of
 * Fix A.1 (re-adding the `react-native-reanimated` import).
 */

const root = path.resolve(__dirname, "..", "..", "..", "..");
const source = fs.readFileSync(
  path.join(root, "src/components/ui/BottomNav.tsx"),
  "utf8",
);

describe("BottomNav is reanimated-free (ORCH-1320 no-worklet-on-tab-commit-path)", () => {
  it("imports NO symbol from react-native-reanimated", () => {
    expect(source).not.toMatch(/from\s+["']react-native-reanimated["']/);
  });

  it("does not use any Reanimated worklet API on the spotlight path", () => {
    expect(source).not.toContain("useSharedValue");
    expect(source).not.toContain("useAnimatedStyle");
    expect(source).not.toContain("useReducedMotion(");
    expect(source).not.toContain("withSpring");
    expect(source).not.toContain("withTiming");
    // The Reanimated worklet API is the bare `cancelAnimation(sharedValue)`.
    // (RN-core `cancelAnimationFrame(` used by Fix A.2 is deliberately allowed.)
    expect(source).not.toContain("cancelAnimation(left");
    expect(source).not.toContain("cancelAnimation(width");
  });

  it("drives the spotlight with RN-core Animated + the non-reanimated reduce-motion helper", () => {
    // RN-core Animated imported from "react-native" (not the reanimated default).
    expect(source).toMatch(/import\s*{[^}]*\bAnimated\b[^}]*}\s*from\s*["']react-native["']/s);
    // Layout-prop animation MUST stay on the JS driver (no worklets runtime).
    expect(source).toContain("useNativeDriver: false");
    expect(source).toContain("useReducedMotionNative");
  });
});
