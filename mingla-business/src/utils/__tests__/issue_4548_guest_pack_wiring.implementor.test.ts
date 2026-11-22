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
    expect(src).toContain("eventId={guestPackEventIdForDraft(liveDraft.id)}");
    expect(src).toContain("guestPackSlot={");
  });

  test("EditPublishedScreen: Save changes saves a changed pack first", () => {
    const src = read("src/components/event/EditPublishedScreen.tsx");
    expect(src).toMatch(/flushGuestPack\(guestPackId\)/);
    expect(src).toMatch(/if \(!result\.ok\) \{\s*showToast\(result\.message\);\s*return;/);
    expect(src).toContain("onPress={handleSaveWithGuestPack}");
    expect(src).toContain("guestPackSlot={");
    expect(src).toMatch(/liveEdit\s*\n\s*onShowToast=\{showToast\}/);
  });

  test("the Where step renders the editor under the address, not in a payload", () => {
    const where = read("src/components/event/CreatorStep3Where.tsx");
    // the step carries only a slot: no editor code reaches the eager boot payload
    expect(where).toContain("{guestPackSlot}");
    expect(where).not.toMatch(/GuestPackEditor/);
    // every owner loads the editor through its own dynamic import (one chunk)
    for (const f of [
      "src/components/event/EventCreatorWizard.tsx",
      "src/components/rsvp/RsvpCreatorWizard.tsx",
      "src/components/event/EditPublishedScreen.tsx",
      "src/components/experience/ExperienceCreatorWizard.tsx",
    ]) {
      const src = read(f);
      expect(src).toMatch(/import\("(\.\/|\.\.\/event\/)GuestPackEditor"\)/);
      expect(src).not.toMatch(/from "(\.\/|\.\.\/event\/)GuestPackEditor"/);
    }
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

  test("experiences: the same editor on the Stops step, saved first by Continue, Publish and Save changes", () => {
    const src = read("src/components/experience/ExperienceCreatorWizard.tsx");
    // one editor, one gate: no second copy of either
    expect(src).toContain('from "../../utils/guestPackGate"');
    expect(src).not.toMatch(/guestPackSession/);
    // the block sits on the Stops step (step 2), after the stops and their places
    expect(src).toMatch(/\{step === 2 \? \(\s*<React\.Suspense fallback=\{null\}>\s*<GuestPackEditorLazy\s*eventId=\{experienceId\}\s*liveEdit=\{isLiveEdit\}\s*onShowToast=\{setToast\}/);
    // Continue stays on the step when the save fails
    expect(src).toMatch(/if \(!result\.ok\) \{\s*setToast\(result\.message\);\s*return;/);
    // Publish and Save changes stop when the save fails
    expect((src.match(/if \(!packResult\.ok\) \{\s*setToast\(packResult\.message\);\s*return;/g) ?? []).length).toBe(2);
    expect(src).toMatch(/releaseGuestPackSession\(experienceId\)/);
    // never inside a graph, publish or live-edit payload
    expect(src).not.toMatch(/guestPack(Note|Items)/);
  });
});
