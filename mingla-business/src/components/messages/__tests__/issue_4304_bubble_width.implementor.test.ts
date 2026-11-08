/**
 * #4304 — a long Brand-group message must wrap inside its column, never grow
 * past it. Production 2026-11-08 (Ctrl group, web): a long message was wider
 * than the 78% column and its start was cut off, because React Native row
 * items do not shrink by default and the bubble sat in a row beside the
 * message-menu button.
 *
 * Fails on revert: dropping flexShrink/minWidth from the bubble, or the width
 * cap from the bubble line, fails the assertions below.
 */
import fs from "fs";
import path from "path";

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "BrandGroupMessageRow.tsx"),
  "utf8",
);

function styleBlock(name: string): string {
  const match = new RegExp(`\\n  ${name}: \\{([^}]*)\\}`).exec(SRC);
  if (!match) throw new Error(`style ${name} not found`);
  return match[1];
}

describe("#4304 Brand-group bubble stays inside its column", () => {
  it("the column caps the message width", () => {
    expect(styleBlock("column")).toMatch(/maxWidth:\s*"78%"/);
    expect(styleBlock("column")).toMatch(/minWidth:\s*0/);
  });

  it("the bubble line is never wider than the column", () => {
    const line = styleBlock("bubbleLine");
    expect(line).toMatch(/maxWidth:\s*"100%"/);
    expect(line).toMatch(/minWidth:\s*0/);
  });

  it("the bubble is the part that shrinks, so long text wraps", () => {
    const bubble = styleBlock("bubble");
    expect(bubble).toMatch(/flexShrink:\s*1/);
    expect(bubble).toMatch(/minWidth:\s*0/);
  });

  it("the bubble really sits in the bubble line", () => {
    expect(SRC).toMatch(/<View style=\{\[styles\.bubbleLine,[^\n]*\n\s*<BrandGroupBubbleGestures[^\n]*>\n\s*\{bubble\}/);
  });
});
