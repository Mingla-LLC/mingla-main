import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../../..");
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("#3563 options editor containment", () => {
  test("the draft owns stable group and option IDs across retry", () => {
    const editor = read("src/components/venue/MenuModifierGroupEditor.tsx");
    expect(editor).toContain("createMenuModifierDraftId");
    expect(editor).toContain("() => group?.id ?? createMenuModifierDraftId()");
    expect(editor).toContain("id: modifier.id");
    expect(editor).toContain("id: createMenuModifierDraftId()");
    expect(editor).not.toContain("optionKeySeed");
  });

  test("pending state locks edits, destructive actions, cancel, and parent controls", () => {
    const editor = read("src/components/venue/MenuModifierGroupEditor.tsx");
    const itemSheet = read("src/components/venue/MenuItemSheet.tsx");
    const module = read("src/components/venue/VenueMenuModule.tsx");
    expect(editor.match(/disabled=\{saving\}/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    expect(editor).toContain('saving ? "Saving options group" : undefined');
    expect(itemSheet).toContain("optionsSaving = false");
    expect(itemSheet).toContain("dismissDisabled={optionsSaving}");
    expect(itemSheet).toContain("!saving &&\n    !optionsSaving");
    expect(module).toContain("onSavingChange={setOptionsSaving}");
  });

  test("failure stays beside the retry action with approved safe copy", () => {
    const section = read("src/components/venue/MenuItemOptionsSection.tsx");
    expect(section).toContain("We could not save this group. Your changes are still here — try again.");
    expect(section).toContain("You are offline. Reconnect, then try again. Your changes are still here.");
    expect(section).toContain("You cannot save this group with this account. Your changes are still here.");
    expect(editor).toContain('accessibilityRole="alert"');
  });
});
