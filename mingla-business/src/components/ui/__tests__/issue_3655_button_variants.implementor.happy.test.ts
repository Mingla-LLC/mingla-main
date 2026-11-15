/**
 * #3655 — Button step + destructiveOutline tokens exist and differ from primary.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const buttonSrc = fs.readFileSync(
  path.join(__dirname, "..", "Button.tsx"),
  "utf8",
);

describe("#3655 Button variants", () => {
  test("declares step and destructiveOutline variants", () => {
    expect(buttonSrc).toContain('| "step"');
    expect(buttonSrc).toContain('| "destructiveOutline"');
    // [TEST-MOD-APPROVED #4420] both looks map onto shared Graphite token sets.
    expect(buttonSrc).toContain("destructiveOutline: DANGER_TEXT");
    // [TEST-MOD-APPROVED #4420] the step look is the Graphite Paper primary
    // (color.paper) instead of a hard-coded #F5F5F6; same "moves you on" intent.
    expect(buttonSrc).toContain("step: PAPER");
  });

  test("ConfirmDialog leave variant stacks Save / Discard / Keep editing", () => {
    const dialogSrc = fs.readFileSync(
      path.join(__dirname, "..", "ConfirmDialog.tsx"),
      "utf8",
    );
    expect(dialogSrc).toContain('| "leave"');
    expect(dialogSrc).toContain('variant === "leave"');
    expect(dialogSrc).toContain("Save changes");
    expect(dialogSrc).toContain("Discard changes");
    expect(dialogSrc).toContain("Keep editing");
    expect(dialogSrc).toContain('variant="destructiveOutline"');
  });

  test("SheetMobile exposes dismissGuard and always-settle pan end", () => {
    const sheetSrc = fs.readFileSync(
      path.join(__dirname, "..", "SheetMobile.tsx"),
      "utf8",
    );
    expect(sheetSrc).toContain("dismissGuard?:");
    expect(sheetSrc).toContain("onRequestClose?:");
    expect(sheetSrc).toContain("handlePanEndJs");
    expect(sheetSrc).toContain("Math.min(96, event.translationY * 0.35)");
  });
});
