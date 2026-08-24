/**
 * #2521 happy-path regression — the preview must draw markup, not print it.
 *
 * The composer preview rendered each paragraph into a bare React Native
 * `<Text>`, which shows its children literally. A body containing
 * `<a href="…">Get your free ticket</a>` therefore displayed the tag, and the
 * organiser reasonably concluded recipients would receive that.
 *
 * They would not. `renderMarketingEmail` parsed the anchor correctly all
 * along — the 189 We Go Again emails wrote 197 marketing_clicks rows, one per
 * recipient. The EMAIL was right; the PREVIEW was lying.
 *
 * FAILS ON REVERT: return the raw string from previewSpans and the link /
 * bold / italic assertions go red.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { previewSpans } from "../previewInline";

const SRC = join(__dirname, "..", "..", "..");

describe("#2521 previewSpans", () => {
  it("renders an anchor as link TEXT, never as the tag", () => {
    const spans = previewSpans(
      '<a href="https://example.test/t">Get your free ticket</a>',
    );
    const joined = spans.map((s) => s.text).join("");
    expect(joined).toBe("Get your free ticket");
    expect(joined).not.toContain("<a");
    expect(joined).not.toContain("href");
    expect(spans.some((s) => s.href === "https://example.test/t")).toBe(true);
  });

  it("keeps the words around a link intact", () => {
    const spans = previewSpans('Tap <a href="https://x.test">here</a> now.');
    expect(spans.map((s) => s.text).join("")).toBe("Tap here now.");
    const link = spans.find((s) => s.href !== null);
    expect(link?.text).toBe("here");
  });

  it("marks bold and italic without printing their tags", () => {
    const spans = previewSpans("Hi <strong>there</strong> and <em>you</em>.");
    expect(spans.map((s) => s.text).join("")).toBe("Hi there and you.");
    expect(spans.find((s) => s.text === "there")?.bold).toBe(true);
    expect(spans.find((s) => s.text === "you")?.italic).toBe(true);
  });

  it("preserves paragraph shape so the preview matches the sent email", () => {
    // #2520 gave the real email its paragraph breaks back; the preview must
    // show the same shape or the two disagree again in the other direction.
    const spans = previewSpans("First.\n\nSecond.");
    expect(spans.map((s) => s.text).join("")).toContain("First.");
    expect(spans.map((s) => s.text).join("")).toContain("Second.");
    expect(spans.some((s) => s.text === "\n")).toBe(true);
  });

  it("leaves plain text completely alone", () => {
    const spans = previewSpans("Just words.");
    expect(spans).toHaveLength(1);
    expect(spans[0]).toEqual({
      text: "Just words.",
      bold: false,
      italic: false,
      href: null,
    });
  });

  it("returns nothing for an empty body", () => {
    expect(previewSpans("")).toEqual([]);
  });
});

describe("#2521 the fix is ONE implementation for web AND mobile", () => {
  const PANE_DIR = join(SRC, "components", "marketing");

  it("the preview pane has no platform-split twin", () => {
    // A `.web.tsx` / `.native.tsx` twin is how this surface has diverged
    // before (the editor is deliberately split that way). If someone adds one
    // here, web and mobile can drift and only one gets the fix.
    expect(existsSync(join(PANE_DIR, "EmailPreviewPane.tsx"))).toBe(true);
    expect(existsSync(join(PANE_DIR, "EmailPreviewPane.web.tsx"))).toBe(false);
    expect(existsSync(join(PANE_DIR, "EmailPreviewPane.native.tsx"))).toBe(false);
  });

  it("the preview pane does not branch on Platform", () => {
    const pane = readFileSync(join(PANE_DIR, "EmailPreviewPane.tsx"), "utf8");
    expect(pane).not.toMatch(/Platform\.(OS|select)/);
  });

  it("the parser is platform-free, so both runtimes get identical spans", () => {
    const parser = readFileSync(
      join(SRC, "services", "marketing", "previewInline.ts"),
      "utf8",
    );
    expect(parser).not.toContain("react-native");
    expect(parser).not.toMatch(/Platform\./);
  });
});
