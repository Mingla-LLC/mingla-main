import fs from "node:fs";
import path from "node:path";

// [TEST-MOD-APPROVED #3655] dismissGuard routes closes through requestDismiss /
// De Morgan endDrag guard; pin the live shapes, not the pre-#1548 literals.

const repoRoot = path.resolve(__dirname, "../../../..");
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("#3563 Sheet dismissal lock", () => {
  test("the opt-in lock is default-compatible across native, narrow web, and desktop web", () => {
    const mobile = read("src/components/ui/SheetMobile.tsx");
    const web = read("src/components/ui/Sheet.web.tsx");
    expect(mobile).toContain("dismissDisabled?: boolean");
    expect(
      mobile.match(/dismissDisabled = false/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(mobile).toContain(".enabled(!dismissDisabled)");
    expect(mobile).toContain("if (!commitClose || dismissDisabled) return;");
    expect(mobile).toContain("dragStartYRef.current = null");
    expect(mobile).toContain("setDragging(false)");
    expect(mobile).toContain("setDragY(0)");
    expect(mobile.match(/if \(dismissDisabled\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(mobile).toContain("if (dismissOnScrimTap) requestDismiss()");
    expect(web).toContain("dismissDisabled = false");
    expect(web).toContain(
      "if (!dismissDisabled && dismissOnScrimTap) onClose()",
    );
    const itemSheet = read("src/components/venue/MenuItemSheet.tsx");
    // #3572 / #3655 — close routes through handleClose, which refuses while
    // optionsSaving (and optionsDirty / itemDirty); Sheet also gets the lock.
    expect(itemSheet).toContain("if (optionsSaving) return;");
    expect(itemSheet).toContain("onClose={handleClose}");
    expect(itemSheet).toContain("dismissDisabled={optionsSaving}");
  });
});
