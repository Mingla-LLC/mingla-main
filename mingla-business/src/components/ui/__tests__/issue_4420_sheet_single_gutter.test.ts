/**
 * #4420 native run: Sheet's body pads its content by SHEET_SIDE_GUTTER (20).
 * Five bespoke sheet bodies still added their own side padding on top, so the
 * Repeat pattern title sat at 44pt. Invariant: a ScrollView content style used
 * directly inside <Sheet> carries no horizontal padding of its own.
 */
import fs from "fs";
import path from "path";

const SRC = path.join(__dirname, "..", "..", "..");
const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), "utf8");
const block = (src: string, name: string): string =>
  src.match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`))?.[0] ?? "";

describe("#4420 sheet bodies have one side gutter", () => {
  test.each([
    ["components/event/CreatorStep2When.tsx", "sheetContent"],
    ["components/event/CreatorStep2WhenRepeatPickerSheet.tsx", "sheetContent"],
    ["components/event/MultiDateOverrideSheet.tsx", "sheetContent"],
    ["components/event/TicketTierEditSheet.tsx", "sheetContent"],
    ["components/door/DoorModeScreen.tsx", "sheetBody"],
    // [TEST-MOD-APPROVED #4420] device round 2: Add to guest list.
    ["components/guests/AddCompGuestSheet.tsx", "body"],
  ])("%s %s adds no paddingHorizontal", (rel, name) => {
    const style = block(read(rel), name);
    expect(style.length).toBeGreaterThan(0);
    expect(style).not.toContain("paddingHorizontal");
  });

  test("Sheet's mobile body still owns the gutter", () => {
    const sheet = read("components/ui/SheetMobile.tsx");
    expect(sheet).toContain("export const SHEET_SIDE_GUTTER = space[5];");
    expect(block(sheet, "body")).toContain("paddingHorizontal: SHEET_SIDE_GUTTER");
  });
});
