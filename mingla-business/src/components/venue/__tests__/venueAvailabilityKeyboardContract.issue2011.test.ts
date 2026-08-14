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

  it("the form owns strings, one save mutation, authoritative rebasing, and no per-key persistence", () => {
    const availability = read("VenueAvailabilityModule.tsx");
    expect(availability).toContain(
      "const nextDraft = { ...draftRef.current, [key]: next }",
    );
    expect(availability).toContain("setDraft(nextDraft)");
    expect(availability).toContain(
      "upsertConfig.mutate(buildAvailabilityPatch(submittedDraft)",
    );
    expect(availability).toContain("onSuccess: (authoritativeConfig) =>");
    expect(availability).toMatch(
      /availabilityDraftFromConfig\(\s*authoritativeConfig\s*,?\s*\)/,
    );
    expect(availability).not.toContain("setBaseline(submittedDraft)");
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
    expect(confirm).toContain("if (restoreFocus !== undefined) restoreFocus()");
  });

  it("the mutation resolves only after authoritative refetch and caches that exact row", () => {
    const hook = read("../../hooks/useVenueAvailability.ts");
    const upsertStart = hook.indexOf(
      "export function useUpsertVenueAvailabilityConfig",
    );
    const upsertEnd = hook.indexOf(
      "/* ----------------------------- blackouts",
      upsertStart,
    );
    const upsert = hook.slice(upsertStart, upsertEnd);

    expect(upsert).toMatch(
      /await fetchVenueAvailabilityConfig\(\s*brandId,\s*venueId,?\s*\)/,
    );
    expect(upsert).toContain('throw new Error("availability_refetch_missing")');
    expect(upsert).toContain("queryClient.setQueryData(");
    expect(upsert.indexOf(".upsert(row")).toBeLessThan(
      upsert.indexOf("await fetchVenueAvailabilityConfig"),
    );
    expect(upsert.indexOf("await fetchVenueAvailabilityConfig")).toBeLessThan(
      upsert.indexOf("return authoritative"),
    );
  });

  it("focuses the actual Button ref without an accessible wrapper or numeric-field restore", () => {
    const button = read("../ui/Button.tsx");
    const confirm = read("../ui/ConfirmDialog.tsx");
    const availability = read("VenueAvailabilityModule.tsx");

    expect(button).toContain("forwardRef<");
    expect(button).toContain("ref={forwardedRef}");
    expect(confirm).toContain("ref={cancelFocusRef}");
    expect(confirm).not.toMatch(
      /<View[\s\S]{0,250}accessible=\{initialFocus === "cancel"\}/,
    );
    expect(availability).not.toContain("restoreActiveFieldFocus");
    expect(availability).not.toContain(
      "restoreFocus={restoreActiveFieldFocus}",
    );
  });

  it("carries the actual TopBar Back initiator into Availability instead of trusting Modal", () => {
    const iconChrome = read("../ui/IconChrome.tsx");
    const topBar = read("../ui/TopBar.tsx");
    const page = read("../../../app/venue/[venueId]/index.tsx");
    const store = read("../../store/venueSuiteStore.ts");
    const availability = read("VenueAvailabilityModule.tsx");

    expect(iconChrome).toContain("await onPress(restoreFocus)");
    expect(iconChrome).toContain("AccessibilityInfo.setAccessibilityFocus(handle)");
    expect(topBar).toContain("onBack?: (restoreFocus?: () => void) => void");
    expect(page).toContain("setPendingLeaveFocus(restoreFocus ?? null)");
    expect(store).toContain("takePendingLeaveFocus");
    expect(availability).toContain(".takePendingLeaveFocus()");
    expect(availability).toContain("restoreFocus={() => {");
  });

  it("uses capability guards for focus and records dirty truth in the keystroke turn", () => {
    const desktopShell = read("../suite/SuiteDesktopShell.tsx");
    const iconChrome = read("../ui/IconChrome.tsx");
    const pillRow = read("VenueModulePillRow.tsx");
    const availability = read("VenueAvailabilityModule.tsx");

    for (const source of [desktopShell, iconChrome, pillRow]) {
      expect(source).toContain("function hasFocusCapability(");
      expect(source).toContain("if (hasFocusCapability(control)) control.focus()");
      expect(source).not.toContain("as unknown as");
    }
    expect(availability).toContain("draftRef.current = nextDraft");
    expect(availability).toContain(
      "dirtyRef.current = !availabilityDraftsEqual(nextDraft, baseline)",
    );
  });
});
