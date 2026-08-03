/**
 * issue #1027 — Thread A (native keyboard/viewport) · Symptom 2 regression.
 * Implementor-owned happy-path guard for the event/RSVP description reveal.
 *
 * ROOT CAUSE (proven on a physical Samsung A72): the wizard body is a
 * KeyboardAwareScrollView, which reveals a focused input by its CARET, not its
 * full frame. The description is a tall, empty multiline whose caret sits at line
 * 1 (top of the box), so on focus KAS lifted only the top line and ~60% of the
 * box stayed behind the keyboard. Unlike Step 3's online-URL field, the
 * description was NOT additionally scrolled into view on focus.
 *
 * FIX: wire the description `<TextInput>`'s `onFocus` to the wizard's
 * `scrollToBottom` reveal (threaded via `StepBodyProps`), mirroring the proven
 * Step-3 online-URL pattern. Because the description is the last field in Basics,
 * `scrollToEnd` lifts the ENTIRE box above the keyboard; KAS then refines per-cursor.
 *
 * FAILS-ON-REVERT (proven by true line deletion in the implementation report):
 *   delete the `onFocus={() => scrollToBottom?.()}` line on the description
 *   TextInput → the "onFocus wired" assertion goes RED.
 *
 * I-PROPOSED-1027-WIZARD-MULTILINE-REVEALED-ON-FOCUS.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const SRC = (): string =>
  readFileSync(
    path.join(process.cwd(), "src/components/event/CreatorStep1Basics.tsx"),
    "utf8",
  );

/** Slice the description <TextInput> block so assertions target only that field. */
const descriptionBlock = (src: string): string => {
  const start = src.indexOf("value={draft.description}");
  const anchor = src.indexOf('accessibilityLabel="Event description"');
  expect(start).toBeGreaterThan(-1);
  expect(anchor).toBeGreaterThan(start);
  return src.slice(start, anchor + 60);
};

describe("issue #1027 · Symptom 2 — description scrolls above the keyboard on focus", () => {
  test("scrollToBottom is destructured from StepBodyProps", () => {
    const src = SRC();
    const signature = src.slice(
      src.indexOf("CreatorStep1Basics: React.FC<StepBodyProps>"),
      src.indexOf("=> {"),
    );
    expect(signature).toContain("scrollToBottom");
  });

  test("the description TextInput's onFocus calls scrollToBottom (defensive)", () => {
    const block = descriptionBlock(SRC());
    // the reveal handler must be present on the description field
    expect(block).toMatch(/onFocus=\{[^}]*scrollToBottom/);
    // defensive optional-call form (prop always threaded today, kept undefined-safe)
    expect(block).toMatch(/scrollToBottom\?\.\(\)/);
  });

  test("the reveal is wired to the DESCRIPTION field specifically (not another input)", () => {
    const block = descriptionBlock(SRC());
    expect(block).toContain("value={draft.description}");
    expect(block).toContain('accessibilityLabel="Event description"');
    expect(block).toContain("multiline");
  });
});
