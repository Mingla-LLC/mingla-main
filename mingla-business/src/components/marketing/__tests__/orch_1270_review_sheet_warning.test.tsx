/**
 * ORCH-1270 RC-3 — ComposerReviewSheet out-of-window warning contract.
 *
 * Run: npx jest src/components/marketing/__tests__/orch_1270_review_sheet_warning.test.tsx --runInBand
 *
 * This is a SOURCE-CONTRACT test (not an RTL mount): @testing-library/react-native
 * and react-test-renderer are NOT committed deps of mingla-business (they are
 * provisioned per-worktree for the dedicated render configs), and the sheet
 * pulls in the Sheet primitive → reanimated/gesture-handler which the default
 * node/ts-jest config cannot mount. Per feedback_biz_web_authed_runtime_unreachable_cap_claims,
 * source-contract is the honest ceiling here. It reads ComposerReviewSheet.tsx and
 * asserts the warning renders ONLY when isSendNow && smsOutsideWindow, carries the
 * EXACT copy, wires the secondary CTA to onScheduleForNextWindow, and meets the
 * 44 px WCAG target. fails-on-revert: deleting the warning block / copy / gate /
 * wiring fails these assertions.
 */

import { readFileSync } from "fs";
import path from "path";

const SRC = readFileSync(
  path.join(__dirname, "../ComposerReviewSheet.tsx"),
  "utf8",
);

describe("ORCH-1270 ComposerReviewSheet — out-of-window warning", () => {
  it("declares the three additive optional props", () => {
    expect(SRC).toMatch(/smsOutsideWindow\?\s*:\s*boolean/);
    expect(SRC).toMatch(/nextWindowLabel\?\s*:\s*string/);
    expect(SRC).toMatch(/onScheduleForNextWindow\?\s*:\s*\(\)\s*=>\s*void/);
  });

  it("gates the warning on isSendNow && smsOutsideWindow (non-blocking)", () => {
    // The derived predicate must require BOTH send-now and the out-of-window flag.
    expect(SRC).toMatch(
      /isSendNow\s*&&\s*smsOutsideWindow\s*===\s*true/,
    );
    // …and the block is conditionally rendered on it.
    expect(SRC).toMatch(/showOutsideWindowWarning\s*\?/);
  });

  it("uses the EXACT approved title + body copy", () => {
    expect(SRC).toContain("Outside texting hours right now");
    expect(SRC).toContain(
      "It's before 8 AM or after 9 PM local for your whole audience, so nothing sends this instant. Tap Send now and Mingla holds each text until that person's next morning window — or schedule it for ",
    );
  });

  it("keeps 'Send now' as the primary CTA and offers 'Schedule for {label}' as secondary", () => {
    // Primary label unchanged.
    expect(SRC).toMatch(/const ctaLabel = isSendNow \? "Send now" : "Schedule";/);
    // Secondary CTA label + firing.
    expect(SRC).toContain("Schedule for ${nextWindowLabel");
    expect(SRC).toMatch(/onPress=\{onScheduleForNextWindow\}/);
  });

  it("meets WCAG: secondary CTA is an accessible button ≥ 44 px", () => {
    // The scheduleForBtn style must set minHeight 44.
    expect(SRC).toMatch(/scheduleForBtn:\s*\{[\s\S]*?minHeight:\s*44/);
    // The Pressable carries a button role + a schedule label.
    expect(SRC).toMatch(/accessibilityRole="button"[\s\S]*?accessibilityLabel=\{scheduleForLabel\}/);
  });
});
