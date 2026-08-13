/** Issue #2011 implementor structural guard — CI runs this through the full Business suite. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (relative: string): string =>
  readFileSync(join(__dirname, "..", relative), "utf8");

describe("issue #2011 keyboard-safe availability contract", () => {
  it("the shell uses SmartScrollView and routes module switches through the dirty guard", () => {
    const shell = read("VenueSuiteShell.tsx");
    expect(shell).toContain('from "../../wrappers/SmartScrollView"');
    expect(shell).toContain("availabilityRef.current.requestLeave");
    expect(shell).not.toMatch(
      /import\s*\{[^}]*ScrollView[^}]*\}\s*from\s*["']react-native["']/s,
    );
  });

  it("the form owns strings, one save mutation, exact state copy, and no per-key persistence", () => {
    const availability = read("VenueAvailabilityModule.tsx");
    expect(availability).toContain(
      "setDraft((current) => ({ ...current, [key]: next }))",
    );
    expect(availability).toContain(
      "upsertConfig.mutate(buildAvailabilityPatch(savedDraft)",
    );
    expect(availability).toContain("Fix the highlighted fields before saving.");
    expect(availability).toContain("Your changes are still here — try again.");
    expect(availability).toContain("maxWidth: suiteFormMaxWidth");
    expect(availability).not.toContain("parseIntClamp");
    expect(availability).not.toMatch(
      /onChangeText[\s\S]{0,180}upsertConfig\.mutate/,
    );
  });

  it("the scoped root exposes arrows only for the registered numeric group", () => {
    const nativeToolbar = read("../../wrappers/KeyboardToolbarRoot.native.tsx");
    expect(nativeToolbar).toContain("setAvailabilityNumericToolbarState");
    expect(nativeToolbar).toContain("showArrows={true}");
    expect(nativeToolbar).toContain("showArrows={false}");
    expect(nativeToolbar).toContain("Moves to the previous availability field");
    expect(nativeToolbar).toContain("Closes the keyboard without saving");
  });

  it("Input and ConfirmDialog expose generic a11y/focus seams without changing defaults", () => {
    const input = read("../ui/Input.tsx");
    const confirm = read("../ui/ConfirmDialog.tsx");
    expect(input).toContain("renderErrorMessage = true");
    expect(input).toContain('"aria-invalid": true');
    expect(input).toContain("outlineWidth: 2");
    expect(confirm).toContain('initialFocus?: "cancel" | "confirm"');
    expect(confirm).toContain("restoreFocus?.()");
  });
});
