/**
 * Independent tester guard for issue #2011.
 *
 * The form may temporarily opt the single global keyboard toolbar into arrow
 * navigation, but that opt-in must never leak to unrelated Business inputs.
 * Dirty native exits must also stay blocked until the operator makes an
 * explicit keep/discard choice.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (relative: string): string =>
  readFileSync(join(__dirname, "..", relative), "utf8");

describe("issue #2011 tester adversarial isolation", () => {
  it("keeps Previous/Next inside the active Availability scope and preserves Done-only globally", () => {
    const nativeToolbar = read("../../wrappers/KeyboardToolbarRoot.native.tsx");
    const scopedStart = nativeToolbar.indexOf("if (scoped !== null)");
    const scopedArrows = nativeToolbar.indexOf("showArrows={true}");
    const globalDoneOnly = nativeToolbar.lastIndexOf("showArrows={false}");

    expect(scopedStart).toBeGreaterThan(-1);
    expect(scopedArrows).toBeGreaterThan(scopedStart);
    expect(globalDoneOnly).toBeGreaterThan(scopedArrows);
    expect(nativeToolbar.slice(0, scopedStart)).not.toContain(
      "showArrows={true}",
    );
    expect(nativeToolbar.slice(globalDoneOnly)).not.toContain(
      "showArrows={true}",
    );
  });

  it("keeps the web toolbar seam inert instead of importing native keyboard machinery", () => {
    const webToolbar = read("../../wrappers/KeyboardToolbarRoot.tsx");

    expect(webToolbar).not.toMatch(
      /from\s+["']react-native-keyboard-controller["']/,
    );
    expect(webToolbar).toMatch(
      /setAvailabilityNumericToolbarState\([\s\S]*?\):\s*void\s*\{\s*\/\/ Browsers use their native Tab \/ Shift\+Tab flow and have no soft-keyboard bar\./,
    );
  });

  it("blocks native route removal and resumes only through the sanctioned action", () => {
    const availability = read("VenueAvailabilityModule.tsx");
    const beforeRemoveStart = availability.indexOf('"beforeRemove" as never');
    const beforeRemoveEnd = availability.indexOf(
      "return unsubscribe;",
      beforeRemoveStart,
    );
    const guard = availability.slice(beforeRemoveStart, beforeRemoveEnd);

    expect(beforeRemoveStart).toBeGreaterThan(-1);
    expect(guard).toContain("event.preventDefault();");
    expect(guard).toContain("requestLeave(() => {");
    expect(guard).toContain("sanctionedExitRef.current = true;");
    expect(guard).toContain("navigation.dispatch(event.data.action as never);");
    expect(guard.indexOf("event.preventDefault();")).toBeLessThan(
      guard.indexOf("requestLeave(() => {"),
    );
    expect(guard.indexOf("sanctionedExitRef.current = true;")).toBeLessThan(
      guard.indexOf("navigation.dispatch(event.data.action as never);"),
    );
  });
});
