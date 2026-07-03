/**
 * ORCH-1270 F-1 — ComposerReviewSheet SMS timing info-note contract.
 *
 * Run: npx jest src/components/marketing/__tests__/orch_1270_review_sheet_warning.test.tsx --runInBand
 *
 * This is a SOURCE-CONTRACT test (not an RTL mount): @testing-library/react-native
 * and react-test-renderer are NOT committed deps of mingla-business (they are
 * provisioned per-worktree for the dedicated render configs), and the sheet
 * pulls in the Sheet primitive → reanimated/gesture-handler which the default
 * node/ts-jest config cannot mount. Per feedback_biz_web_authed_runtime_unreachable_cap_claims,
 * source-contract is the honest ceiling here.
 *
 * F-1 turned the old dead conditional warning (gated on an always-true
 * predicate) into an ALWAYS-ON informational note for an SMS "Send now": it
 * reads ComposerReviewSheet.tsx and asserts the note renders whenever
 * `isSendNow && smsInfoNote`, carries the EXACT approved "How SMS timing works"
 * copy (neutral, not alarming), wires the "Schedule for …" secondary CTA to
 * onScheduleForNextWindow, and meets the 44 px WCAG target. fails-on-revert:
 * deleting the note block / copy / gate / wiring fails these assertions.
 */

import { readFileSync } from "fs";
import path from "path";

const SRC = readFileSync(
  path.join(__dirname, "../ComposerReviewSheet.tsx"),
  "utf8",
);

describe("ORCH-1270 F-1 ComposerReviewSheet — SMS timing info note", () => {
  it("declares the three additive optional props", () => {
    expect(SRC).toMatch(/smsInfoNote\?\s*:\s*boolean/);
    expect(SRC).toMatch(/nextWindowLabel\?\s*:\s*string/);
    expect(SRC).toMatch(/onScheduleForNextWindow\?\s*:\s*\(\)\s*=>\s*void/);
  });

  it("shows the note for every SMS send-now (isSendNow && smsInfoNote — always-on, not conditional)", () => {
    // The derived predicate requires ONLY send-now + the SMS flag — there is no
    // longer an in/out-of-window gate (F-1 removed the dead conditional).
    expect(SRC).toMatch(
      /isSendNow\s*&&\s*smsInfoNote\s*===\s*true/,
    );
    // …and the block is conditionally rendered on it.
    expect(SRC).toMatch(/showSmsInfoNote\s*\?/);
    // The dead out-of-window predicate must be gone.
    expect(SRC).not.toMatch(/isAnyMarketInSendWindow|smsOutsideWindow/);
  });

  it("uses the EXACT approved informational title + body copy", () => {
    expect(SRC).toContain("How SMS timing works");
    expect(SRC).toContain(
      "Texts only send during each recipient's local hours (8 AM–9 PM). Anyone outside that window right now is automatically held and sent in their next morning window — nothing is lost. You can also schedule the whole blast for ",
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
