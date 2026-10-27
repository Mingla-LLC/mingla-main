import fs from "node:fs";
import path from "node:path";

import {
  PROGRAM_BLOCK_GAP,
  PROGRAM_CARD_PADDING,
  PROGRAM_GUTTER,
  PROGRAM_ROW_MIN_HEIGHT,
  programFormChrome,
  stripItems,
} from "../programLayout";

// #3872 round 2 (H2.1, H2.3, H2.7): cards sat 16pt further in than headings
// (the program card padded GlassCard's chrome on top of GlassCard's own
// padding), and the keyboard covered fields while the footer button rode up.
const kit = fs.readFileSync(
  path.resolve(__dirname, "..", "ProgramKit.tsx"),
  "utf8",
);

describe("program keyboard rule", () => {
  it("hides the pinned footer while typing and offers Done", () => {
    expect(programFormChrome({ keyboardVisible: true, hasFooter: true })).toEqual({
      showFooter: false,
      showDone: true,
    });
    expect(programFormChrome({ keyboardVisible: false, hasFooter: true })).toEqual({
      showFooter: true,
      showDone: false,
    });
    expect(
      programFormChrome({ keyboardVisible: false, hasFooter: false }).showFooter,
    ).toBe(false);
  });

  it("screens and sheets both read the keyboard and the shared rule", () => {
    expect(kit).toContain('from "../../wrappers/useKeyboardIsVisible"');
    expect(kit.match(/programFormChrome\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(kit).toContain('from "../../wrappers/SmartScrollView"');
  });
});

describe("Mingla spacing rule", () => {
  it("uses one 16pt gutter, one card padding, 12pt gaps and 52pt rows", () => {
    expect(PROGRAM_GUTTER).toBe(16);
    expect(PROGRAM_CARD_PADDING).toBeGreaterThanOrEqual(14);
    expect(PROGRAM_CARD_PADDING).toBeLessThanOrEqual(16);
    expect(PROGRAM_BLOCK_GAP).toBe(12);
    expect(PROGRAM_ROW_MIN_HEIGHT).toBe(52);
  });

  it("never pads a program card twice", () => {
    // The old card put padding on GlassCard's chrome `style` AND took
    // GlassCard's default padding: 32pt from the edge.
    expect(kit).not.toMatch(/card:\s*\{\s*padding:/);
    expect(kit).not.toMatch(/group:\s*\{\s*paddingHorizontal:\s*spacing\.md\s*\}/);
    expect(kit).toContain("padding={PROGRAM_CARD_PADDING}");
    expect(kit).toContain("padding={0}");
  });

  it("shows at most three numbers in a strip", () => {
    expect(stripItems([1, 2, null, 3, 4])).toEqual([1, 2, 3]);
  });
});
