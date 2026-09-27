import fs from "node:fs";
import path from "node:path";

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
    expect(mobile).toContain("if (commitClose && !dismissDisabled)");
    expect(mobile).toContain("dragStartYRef.current = null");
    expect(mobile).toContain("setDragging(false)");
    expect(mobile).toContain("setDragY(0)");
    expect(mobile.match(/if \(dismissDisabled\)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(mobile).toContain(
      "if (!dismissDisabled && dismissOnScrimTap) onClose()",
    );
    expect(web).toContain("dismissDisabled = false");
    expect(web).toContain(
      "if (!dismissDisabled && dismissOnScrimTap) onClose()",
    );
    const itemSheet = read("src/components/venue/MenuItemSheet.tsx");
    expect(itemSheet).toContain("if (!optionsSaving) onClose()");
    expect(itemSheet).toContain("onClose={handleClose}");
  });
});
