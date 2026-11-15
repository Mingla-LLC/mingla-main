import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { competition as competitionTokens } from "../../../../constants/designSystem";

describe("issue 2796 premium competition presentation", () => {
  const brief = readFileSync(resolve(__dirname, "../CompetitorBriefSheet.tsx"), "utf8");
  const add = readFileSync(resolve(__dirname, "../CompetitorAddSheet.tsx"), "utf8");
  const tokens = readFileSync(resolve(__dirname, "../../../../constants/designSystem.ts"), "utf8");
  it("owns responsive geometry and opaque cross-platform cards", () => {
    for (const expected of ["contentInsetCompact: 16", "contentInsetRegular: 24", "contentInsetWide: 32", "readableCopyMaxWidth: 600", "surface: materials.pane.solidFill", "surfaceRaised: color.card"]) expect(tokens).toContain(expected);
    // [TEST-MOD-APPROVED #4420] the competition surfaces alias the opaque Graphite solids; both still resolve to 6-digit hex.
    expect(competitionTokens.surface).toMatch(/^#[0-9a-f]{6}$/i);
    expect(competitionTokens.surfaceRaised).toMatch(/^#[0-9a-f]{6}$/i);
    expect(brief).toContain("useWindowDimensions");
    expect(brief).toContain("elevation: 0");
  });
  it("keeps the accessibility-size Close action inside the safe content width", () => {
    expect(brief).toContain("isLargeText(fontScale)");
    expect(brief).toContain("headerTopAccessible");
    expect(brief).toContain("closeAccessible");
    expect(brief).toContain('alignSelf: "flex-end", minWidth: 44, minHeight: 44');
    expect(brief.match(/maxFontSizeMultiplier=\{BUTTON_MAX_FONT_SCALE\}/g)).toHaveLength(2);
  });
  it("renders the fixed decision-first hierarchy and one inline disclosure per signal", () => {
    for (const expected of ["WEEKLY COMPETITOR BRIEF", "WHAT HAPPENED", "WHY CARE", "DO THIS NEXT", "Signal health", "CURRENT PUBLIC SIGNALS", "COMPETITIVE READ", "YOUR MOVE", "Evidence ·"] ) expect(brief).toContain(expected);
    for (const forbidden of ["SOURCE EVIDENCE", "Open source evidence", "View evidence"]) expect(brief).not.toContain(forbidden);
  });
  it("keeps all nine truthful report states", () => {
    for (const expected of ["current", "partial", "stale", "refreshing", "no-change", "insufficient", "offline", "budget-delayed", "error"]) expect(brief).toContain(`\"${expected}\"`);
  });
  it("uses a content-bounded nearby flow and exactly one manual save action", () => {
    for (const expected of ["Search by venue name", "We’ll prefill public details when we can.", "Enter details manually", "SOURCES MINGLA CAN WATCH", "SAVED REFERENCE", "Saved link only", "stickyFooterMinHeight"]) expect(add).toContain(expected);
    expect(add).not.toContain('label="Cancel"');
  });
});
