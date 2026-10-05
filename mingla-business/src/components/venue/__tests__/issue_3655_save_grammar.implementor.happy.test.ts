/**
 * #3655 Story 2 — save grammar renames and wizard dock step look.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..");

describe("#3655 save grammar", () => {
  test("wizard Continue uses step variant and draft-on-phone caption", () => {
    const src = fs.readFileSync(
      path.join(root, "VenueCreatorWizard.tsx"),
      "utf8",
    );
    expect(src).toContain('variant="step"');
    expect(src).toContain("Draft saved on this phone");
    expect(src).toContain('trailingIcon="chevR"');
  });

  test("category time picker Done is Set times (step)", () => {
    const src = fs.readFileSync(
      path.join(root, "MenuCategorySheet.tsx"),
      "utf8",
    );
    expect(src).toContain('label="Set times"');
    expect(src).toContain('variant="step"');
    // Episode 18 — Start advances to End; only End dismisses the dock.
    expect(src).toContain("handleSetTimes");
    expect(src).toContain('if (pickerMode === "start")');
    expect(src).toContain('setPickerMode("end")');
  });

  test("menu money hydrate keeps full fraction digits", () => {
    const money = fs.readFileSync(
      path.join(root, "menuMoneyDraft.ts"),
      "utf8",
    );
    const item = fs.readFileSync(path.join(root, "MenuItemSheet.tsx"), "utf8");
    expect(money).toContain("formatMenuMoneyDraftFromMinor");
    expect(money).toContain("major.toFixed(scale)");
    expect(item).toContain("formatMenuMoneyDraftFromMinor");
    expect(item).not.toContain("String(majorFromMinor");
  });

  test("order pad Done is secondary; Send actions carry send icon", () => {
    const src = fs.readFileSync(
      path.join(root, "orderPad", "VenueOrderPadSheet.tsx"),
      "utf8",
    );
    expect(src).toMatch(/label="Done"[\s\S]*?variant="secondary"/);
    expect(src).toContain('leadingIcon="send"');
    expect(src).toContain('label="Send to kitchen"');
    expect(src).toContain('label="Send the bill"');
  });

  test("deck readiness stages cover/gallery until Save deck details", () => {
    const src = fs.readFileSync(
      path.join(root, "VenueDeckReadinessSetup.tsx"),
      "utf8",
    );
    expect(src).toContain('label={busy === "save" ? "Saving…" : "Save deck details"}');
    expect(src).toContain("Not saved yet");
    expect(src).toContain("coverDirty");
    expect(src).toContain("galleryDirty");
    expect(src).toContain("websiteDirty");
    expect(src).toContain("deferPreviousCleanup");
    expect(src).toContain("disabled={busy !== null || !formDirty}");
    // Immediate sync on pick is gone; sync runs inside Save.
    expect(src).not.toMatch(
      /handleCoverChange[\s\S]{0,200}await syncHeroMedia/,
    );
  });

  test("Settings sticky bar uses SaveCommitBar", () => {
    const src = fs.readFileSync(
      path.join(root, "VenueSettingsModule.tsx"),
      "utf8",
    );
    expect(src).toContain("SaveCommitBar");
    expect(src).toContain('label="Save settings"');
    expect(src).toContain("venue-settings-save-bar");
  });

  test("Availability Save changes uses SaveCommitBar what-changed caption", () => {
    const src = fs.readFileSync(
      path.join(root, "VenueAvailabilityModule.tsx"),
      "utf8",
    );
    expect(src).toContain("SaveCommitBar");
    expect(src).toContain('label="Save changes"');
    expect(src).toContain("availabilityChangedLabels");
    expect(src).toContain("changedLabels={changedLabels}");
    expect(src).toContain('testID="venue-avail-save"');
  });
});
