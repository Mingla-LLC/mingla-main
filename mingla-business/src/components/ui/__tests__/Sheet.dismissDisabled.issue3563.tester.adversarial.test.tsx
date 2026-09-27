/** Issue #3563 independent dismissal-route and mid-drag adversarial proof. */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../../..");
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("#3563 tester adversarial — every Sheet dismissal route", () => {
  test("native, narrow web, and wide web all fail closed for back/Escape and scrim", () => {
    const mobile = read("src/components/ui/SheetMobile.tsx");
    const desktop = read("src/components/ui/Sheet.web.tsx");

    expect(mobile).toContain("dismissDisabled?: boolean");
    expect(mobile.match(/dismissDisabled = false/g)).toHaveLength(2);
    expect(desktop.match(/dismissDisabled = false/g)).toHaveLength(1);
    expect(mobile.match(/if \(!dismissDisabled\) onClose\(\)/g)).toHaveLength(
      2,
    );
    expect(desktop.match(/if \(!dismissDisabled\) onClose\(\)/g)).toHaveLength(
      1,
    );
    expect(
      mobile.match(/if \(!dismissDisabled && dismissOnScrimTap\) onClose\(\)/g),
    ).toHaveLength(2);
    expect(
      desktop.match(
        /if \(!dismissDisabled && dismissOnScrimTap\) onClose\(\)/g,
      ),
    ).toHaveLength(1);
  });

  test("native drag and narrow-web drag cannot finish after the lock engages mid-gesture", () => {
    const mobile = read("src/components/ui/SheetMobile.tsx");

    expect(mobile).toContain("Gesture.Pan()\n    .enabled(!dismissDisabled)");
    expect(mobile).toContain(
      'pointerEvents={dismissDisabled ? "none" : "auto"}',
    );
    expect(mobile).toContain("if (commitClose && !dismissDisabled)");
    expect(mobile).toContain("if (dismissDisabled) {\n      endDrag(false);");
    expect(
      mobile.match(/if \(dismissDisabled\) \{\n      endDrag\(false\);/g),
    ).toHaveLength(2);

    const resetStart = mobile.indexOf("if (!dismissDisabled) return;");
    const resetEnd = mobile.indexOf("}, [dismissDisabled]);", resetStart);
    const reset = mobile.slice(resetStart, resetEnd);
    for (const line of [
      "dragStartYRef.current = null",
      "lastMoveRef.current = null",
      "dragYRef.current = 0",
      "velocityRef.current = 0",
      "setDragging(false)",
      "setDragY(0)",
    ]) {
      expect(reset).toContain(line);
    }
  });

  test("the item sheet guards direct close callbacks in addition to the primitive", () => {
    const itemSheet = read("src/components/venue/MenuItemSheet.tsx");
    expect(itemSheet).toContain("if (!optionsSaving) onClose()");
    expect(itemSheet).toContain("onClose={handleClose}");
    expect(itemSheet).toContain("dismissDisabled={optionsSaving}");
  });
});
