// #4548 — Host guest pack: the main buttons save a changed pack first, and the
// editor sits on the Where step. Source contract (the three owners cannot be
// mounted under the default jest config).
//
// FAILS-ON-REVERT: removing any flushGuestPack call below turns its case red.
import * as fs from "fs";
import * as path from "path";

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "../../..", rel), "utf8");

describe("save-first wiring", () => {
  test.each([
    ["src/components/event/EventCreatorWizard.tsx"],
    ["src/components/rsvp/RsvpCreatorWizard.tsx"],
  ])("%s: Continue and Publish save a changed pack first", (file) => {
    const src = read(file);
    const calls = src.match(/flushGuestPack\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // Continue stays on the step when the save fails.
    expect(src).toMatch(/if \(!result\.ok\) \{\s*handleShowToast\(result\.message\);\s*return;/);
    // Publish stops when the save fails.
    expect(src).toMatch(/if \(!packResult\.ok\) \{\s*handleShowToast\(packResult\.message\);\s*return;/);
    expect(src).toContain("guestPackEventId={guestPackEventIdForDraft(liveDraft.id)}");
  });

  test("EditPublishedScreen: Save changes saves a changed pack first", () => {
    const src = read("src/components/event/EditPublishedScreen.tsx");
    expect(src).toMatch(/flushGuestPack\(guestPackId\)/);
    expect(src).toMatch(/if \(!result\.ok\) \{\s*showToast\(result\.message\);\s*return;/);
    expect(src).toContain("onPress={handleSaveWithGuestPack}");
    expect(src).toContain("guestPackLiveEdit");
  });

  test("the Where step renders the editor under the address, not in a payload", () => {
    const where = read("src/components/event/CreatorStep3Where.tsx");
    expect(where).toContain("<LazyGuestPackEditor");
    // never a static import: the editor stays off the eager boot payload
    expect(where).not.toMatch(/from "\.\/GuestPackEditor"/);
    const lazy = read("src/components/event/LazyGuestPackEditor.tsx");
    expect(lazy).toContain('import("./GuestPackEditor")');
    const wizard = read("src/components/event/EventCreatorWizard.tsx");
    // the pack never rides in the draft or publish payload
    expect(wizard).not.toMatch(/guestPack(Note|Items)/);
  });

  test("links sit in two columns on wide desktop only, through the app's layout hook", () => {
    const editor = read("src/components/event/GuestPackEditor.tsx");
    expect(editor).toContain("useResponsiveLayout");
    expect(editor).toContain("isWideDesktop ? styles.itemsGrid : undefined");
    expect(editor).toContain("half && styles.itemHalf");
  });
});
