/**
 * ORCH-1186 [experience reserve polish] — source-string regression for the 5
 * device-test fixes. Same source-grep pattern as experiencePageRedesign.orch1138
 * (the RN components can't mount under ts-jest). Pure-add test → no TEST-MOD token.
 *
 * Covers:
 *   Fix 1 — adaptive banner in the shared body; start-pill + dates-chip removed;
 *           the route no longer injects a surface availabilityBlock.
 *   Fix 2 — vibe chip TEXT uses palette.primaryText (icon stays accent).
 *   Fix 3 — the reserve sheet fills with the brand page color edge-to-edge.
 *   Fix 4 — the open-daily reserve picker is a 3-step TAP-TO-ADVANCE wizard,
 *           and the {eventDateId, quantity} checkout handoff is unchanged.
 *   Fix 5 — the keyboard Done bar is gated on keyboard visibility.
 *
 * fails-on-revert: deleting any asserted line flips a case red.
 * Owner: mingla-implementor.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

// repo-root-relative reads (cwd is mingla-business).
const bodySrc = read("../packages/offering-rendering/ExperienceOfferingBody.tsx");
const bannerSrc = read(
  "../packages/offering-rendering/experienceAvailabilityBanner.ts",
);
const routeSrc = read("app/exp/[brandSlug]/[experienceSlug].tsx");
const pickerSrc = read("src/components/experience/ExperienceReservePicker.tsx");
const consumerPickerSrc = read(
  "../app-mobile/src/components/expandedCard/ExperienceReservePicker.tsx",
);
const sheetSrc = read("src/components/ui/SheetMobile.tsx");
const sheetWebSrc = read("src/components/ui/Sheet.web.tsx");
const kbBizSrc = read("src/wrappers/KeyboardToolbarRoot.native.tsx");
const kbConsumerSrc = read(
  "../app-mobile/src/wrappers/KeyboardToolbarRoot.native.tsx",
);

describe("ORCH-1186 — Fix 1 adaptive availability banner", () => {
  test("the shared body computes ONE adaptive banner from the normalized data", () => {
    expect(bodySrc).toMatch(/experienceAvailabilityBanner\(data\)/);
    // rendered as the in-body availability strip with the shared Clock icon.
    expect(bodySrc).toMatch(/experience-body-availability/);
    expect(bodySrc).toMatch(/availability\.primary/);
  });

  test("the pure banner covers all four cases", () => {
    expect(bannerSrc).toMatch(/Open daily/);
    expect(bannerSrc).toMatch(/Reserve any upcoming day/);
    expect(bannerSrc).toMatch(/upcoming dates/);
    expect(bannerSrc).toMatch(/Available anytime/);
  });

  test("the misleading START pill is removed from the meta row", () => {
    // No MetaChip driven by startTimeLabel any more.
    expect(bodySrc).not.toMatch(/icon="clock">\s*\{data\.startTimeLabel\}/);
    expect(bodySrc).not.toMatch(/data\.startTimeLabel !== null \? \(/);
  });

  test("the dates CHIP is removed from the meta row (info now in the banner)", () => {
    expect(bodySrc).not.toMatch(/icon="calendar">\s*\{data\.datesLabel\}/);
  });

  test("the route no longer injects a surface availabilityBlock", () => {
    expect(routeSrc).not.toMatch(/availabilityBlock=\{availabilityBlock\}/);
    expect(routeSrc).not.toMatch(/function formatOpenHours/);
  });
});

describe("ORCH-1186 — Fix 2 vibe chip color parity", () => {
  test("vibe chip TEXT uses palette.primaryText (icon stays accent)", () => {
    expect(bodySrc).toMatch(/styles\.vibeChipText,\s*\n?\s*\{\s*color: palette\.primaryText/);
    // the Sparkles icon keeps accent.
    expect(bodySrc).toMatch(/<Sparkles size=\{13\} color=\{palette\.accent\}/);
  });
});

describe("ORCH-1186 — Fix 3 brand fill fills the whole sheet", () => {
  test("the Sheet primitive supports a solid panelBackground fill", () => {
    expect(sheetSrc).toMatch(/panelBackground\?: string/);
    expect(sheetSrc).toMatch(/panelBackground !== undefined \? \(/);
    expect(sheetWebSrc).toMatch(/panelBackground \?\? CARD_BACKGROUND/);
  });

  test("the business picker passes panelBackground={palette.page}", () => {
    expect(pickerSrc).toMatch(/panelBackground=\{palette\.page\}/);
  });

  test("the consumer picker fills the content with palette.page edge-to-edge", () => {
    expect(consumerPickerSrc).toMatch(/flexGrow: 1, backgroundColor: palette\.page/);
    // gorhom backgroundStyle still themed to the page.
    expect(consumerPickerSrc).toMatch(/backgroundStyle=\{\{ \.\.\.styles\.sheetBackground, \.\.\.sheetBg \}\}/);
  });
});

describe("ORCH-1186 — Fix 4 three-step tap-to-advance wizard", () => {
  for (const [label, src] of [
    ["business", pickerSrc],
    ["consumer", consumerPickerSrc],
  ] as const) {
    test(`${label}: step state machine day → time → party, reset on open`, () => {
      expect(src).toMatch(/useState<"day" \| "time" \| "party">\("day"\)/);
      expect(src).toMatch(/setStep\("day"\)/); // reset on open
    });

    test(`${label}: tapping a day advances to time; tapping a time advances to party`, () => {
      expect(src).toMatch(/if \(isWizard\) setStep\("time"\)/);
      expect(src).toMatch(/setStep\("party"\)/);
    });

    test(`${label}: a Back affordance steps backward`, () => {
      expect(src).toMatch(/setStep\(step === "party" \? "time" : "day"\)/);
    });

    test(`${label}: the {eventDateId, quantity} checkout handoff is unchanged`, () => {
      expect(src).toMatch(/onConfirm\(\{ eventDateId: selectedDate\.\w+, quantity: party \}\)/);
      expect(src).toMatch(/onConfirm\(\{ eventDateId: selectedDate\.\w+, quantity: 1 \}\)/);
    });
  }
});

describe("ORCH-1186 — Fix 5 keyboard Done bar gated on visibility", () => {
  test("business: KeyboardToolbarRoot returns null when no keyboard is visible", () => {
    expect(kbBizSrc).toMatch(/useKeyboardIsVisible\(\)/);
    expect(kbBizSrc).toMatch(/if \(!visible\) return null/);
    // still Done-only when shown.
    expect(kbBizSrc).toMatch(/showArrows=\{false\}/);
  });

  test("consumer: KeyboardToolbarRoot gated on useKeyboardState().isVisible", () => {
    expect(kbConsumerSrc).toMatch(/useKeyboardState\(\)/);
    expect(kbConsumerSrc).toMatch(/if \(!isVisible\) return null/);
    expect(kbConsumerSrc).toMatch(/showArrows=\{false\}/);
  });
});
