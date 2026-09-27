/**
 * Issue #3563 independent tester proof for races and failure preservation.
 *
 * The implementor suite checks the intended pieces exist. This suite attacks
 * ordering and absence: the same-tick latch must close before mutate, failures
 * may only change the nearby error, and no refetch-driven hydration may replace
 * an open draft.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "../../../..");
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("#3563 tester adversarial — retry/race/pending containment", () => {
  test("the rapid-double-gesture latch closes synchronously before the network mutation", () => {
    const section = read("src/components/venue/MenuItemOptionsSection.tsx");
    const guard = section.indexOf(
      "if (submissionInFlightRef.current || saveGroup.isPending) return",
    );
    const latch = section.indexOf(
      "submissionInFlightRef.current = true",
      guard,
    );
    const rpcGesture = section.indexOf("saveGroup.mutate(input", latch);
    const release = section.indexOf(
      "submissionInFlightRef.current = false",
      rpcGesture,
    );

    expect(guard).toBeGreaterThan(-1);
    expect(latch).toBeGreaterThan(guard);
    expect(rpcGesture).toBeGreaterThan(latch);
    expect(release).toBeGreaterThan(rpcGesture);
    expect(
      section.slice(guard, rpcGesture).match(/saveGroup\.mutate/g) ?? [],
    ).toHaveLength(0);
  });

  test("offline, permission, generic, and ambiguous failures preserve the draft and retry identities", () => {
    const section = read("src/components/venue/MenuItemOptionsSection.tsx");
    const editor = read("src/components/venue/MenuModifierGroupEditor.tsx");
    const errorStart = section.indexOf("onError: (error) =>");
    const settledStart = section.indexOf("onSettled: () =>", errorStart);
    const failureHandler = section.slice(errorStart, settledStart);

    expect(failureHandler).toContain(
      "setSaveError(modifierGroupSaveError(error))",
    );
    expect(failureHandler).not.toMatch(
      /setEditing|setCreating|setName|setMode|setRequired|setOptions/,
    );
    expect(section).toContain(
      "You are offline. Reconnect, then try again. Your changes are still here.",
    );
    expect(section).toContain(
      "You cannot save this group with this account. Your changes are still here.",
    );
    expect(section).toContain(
      "We could not save this group. Your changes are still here — try again.",
    );

    expect(editor).toContain(
      "const [draftGroupId] = useState<string>(\n    () => group?.id ?? createMenuModifierDraftId(),",
    );
    expect(editor).toContain(
      '{ id: createMenuModifierDraftId(), name: "", price: "" }',
    );
    expect(editor).not.toContain("useEffect(");
    expect(editor).not.toContain("setOptions(\n      (group?.modifiers");
    expect(editor).toContain("id: draftGroupId");
    expect(editor).toContain("id: option.id");
  });

  test("pending blocks every draft and parent mutation while the editor remains scrollable", () => {
    const editor = read("src/components/venue/MenuModifierGroupEditor.tsx");
    const itemSheet = read("src/components/venue/MenuItemSheet.tsx");
    const section = read("src/components/venue/MenuItemOptionsSection.tsx");

    expect(
      editor.match(/disabled=\{saving\}/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(8);
    expect(editor).toContain("if (saving) return;\n    setOptions");
    expect(editor).toContain("if (saving) return;\n      setOptions");
    expect(editor).toContain("disabled={deleting || saving}");
    expect(editor).toContain(
      'accessibilityLabel={saving ? "Saving options group" : undefined}',
    );
    expect(editor).toContain('accessibilityRole="alert"');
    expect(editor).toContain('aria-live="assertive"');

    for (const parentLock of [
      "!optionsSaving",
      "dismissDisabled={optionsSaving}",
      "disabled={optionsSaving}",
      "disabled={deleting || optionsSaving}",
    ]) {
      expect(itemSheet).toContain(parentLock);
    }
    expect(section).toContain("onSavingChange?.(true)");
    expect(section).toContain("onSavingChange?.(false)");

    // No pointer-events lock is applied to the editor or sheet body, so the
    // existing scroll container remains available while controls are disabled.
    expect(editor).not.toContain('pointerEvents="none"');
    expect(itemSheet).not.toContain('pointerEvents="none"');
  });
});
