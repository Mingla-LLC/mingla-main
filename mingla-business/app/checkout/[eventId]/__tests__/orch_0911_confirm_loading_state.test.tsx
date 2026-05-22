/**
 * ORCH-0911 [Buyer-web checkout confirm black screen] — event confirm
 * happy-path regression tests.
 *
 * The repo does not currently install @testing-library/react-native, so this
 * pins the render-branch contract at source level: the `?cs=` + result-null
 * path must render the visible hero, while non-resume paths keep the defensive
 * bare host shell.
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

describe("ORCH-0911 — event confirm visible loading state", () => {
  it("T-06: ?cs= + result null + event null renders the Confirming your tickets hero", () => {
    const resultNullBranch = sliceBetween(
      "if (result === null)",
      "if (event === null)",
    );

    expect(resultNullBranch).toContain('Platform.OS === "web"');
    expect(resultNullBranch).toContain("const hasCs = /[?&]cs=/.test");
    expect(resultNullBranch).toContain("if (hasCs)");
    expect(resultNullBranch).toContain("Confirming your tickets…");
    expect(resultNullBranch).toContain(
      "Payment received. Your tickets will appear here in a moment.",
    );
    expect(activeSource).not.toMatch(
      /result === null\s*&&\s*realtimePending\s*&&\s*event !== null/,
    );
  });

  it("T-07: result populated + event null renders the same loading hero", () => {
    const eventNullBranch = sliceBetween(
      "if (event === null)",
      "return (\n    <View style={styles.host}>",
    );

    expect(eventNullBranch).toContain("Confirming your tickets…");
    expect(eventNullBranch).toContain(
      "Payment received. Your tickets will appear here in a moment.",
    );
  });

  it("T-08: no ?cs= + result null preserves the defensive bare host shell", () => {
    const resultNullBranch = sliceBetween(
      "if (result === null)",
      "if (event === null)",
    );

    expect(resultNullBranch).toContain("return <View style={styles.host} />;");
  });

  it("T-09: full success render still contains the resolved hero and Back to event CTA", () => {
    const fullRender = activeSource.slice(
      activeSource.indexOf("return (\n    <View style={styles.host}>"),
    );

    expect(fullRender).toContain("You&apos;re in");
    expect(fullRender).toContain('label="Back to event"');
    expect(fullRender).toContain("TicketQrCarousel");
  });
});
