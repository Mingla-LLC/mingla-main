/**
 * ORCH-0911 [Buyer-web checkout confirm black screen] — trip confirm
 * happy-path regression tests.
 *
 * The repo does not currently install @testing-library/react-native, so this
 * pins the render-branch contract at source level: the `?cs=` + result-null
 * path must render the visible trip hero, and the full success render must
 * keep the trip CTA.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "../confirm.tsx"), "utf8");

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const activeSource = stripComments(source);

function sliceBetween(start: string, end: string): string {
  const startIndex = activeSource.indexOf(start);
  const endIndex = activeSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return activeSource.slice(startIndex, endIndex);
}

describe("ORCH-0911 — trip confirm visible loading state", () => {
  it("T-10: ?cs= + result null + trip null renders the Confirming your reservation hero", () => {
    const resultNullBranch = sliceBetween(
      "if (result === null)",
      "if (trip === null)",
    );

    expect(resultNullBranch).toContain('Platform.OS === "web"');
    expect(resultNullBranch).toContain("const hasCs = /[?&]cs=/.test");
    expect(resultNullBranch).toContain("if (hasCs)");
    expect(resultNullBranch).toContain("Confirming your reservation…");
    expect(resultNullBranch).toContain(
      "Payment received. Your tickets will appear here in a moment.",
    );
    expect(activeSource).not.toMatch(
      /result === null\s*&&\s*realtimePending\s*&&\s*trip !== null/,
    );
  });

  it("T-11: full success render still contains the resolved hero and Back to trip CTA", () => {
    const fullRender = activeSource.slice(
      activeSource.indexOf("return (\n    <View style={styles.host}>"),
    );

    expect(fullRender).toContain("You&apos;re in");
    expect(fullRender).toContain('label="Back to trip"');
    expect(fullRender).toContain("TicketQrCarousel");
  });
});
