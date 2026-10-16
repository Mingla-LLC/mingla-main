import { describe, expect, test } from "@jest/globals";

import {
  communityMarkdownToPlainText,
  parseCommunityMarkdown,
  safeCommunityMarkdownLink,
} from "../communityMarkdown";

describe("#3720 Community plain-text rendering", () => {
  test("removes headings, emphasis, code, links and HTML without losing words", () => {
    expect(
      communityMarkdownToPlainText(
        "### **Hello**\nRead `this` [guide](https://usemingla.com) <b>now</b>.",
      ),
    ).toBe("Hello Read this guide now.");
  });

  test("never leaves the formatting symbols reported by users", () => {
    const rendered = communityMarkdownToPlainText("## `Code` and **bold**");
    expect(rendered).not.toMatch(/###|\*\*|`/);
  });

  test("preserves supported visual semantics for the expanded announcement", () => {
    expect(
      parseCommunityMarkdown("## Heading\n- **Bold** item\nRead `code`"),
    ).toEqual([
      {
        kind: "heading",
        level: 2,
        inline: [{ text: "Heading" }],
      },
      {
        kind: "bullet",
        inline: [{ text: "Bold", bold: true }, { text: " item" }],
      },
      {
        kind: "paragraph",
        inline: [{ text: "Read " }, { text: "code", code: true }],
      },
    ]);
  });

  test("allows only safe links and leaves unsafe destinations inert", () => {
    expect(safeCommunityMarkdownLink("https://usemingla.com/help")).toBe(
      "https://usemingla.com/help",
    );
    expect(safeCommunityMarkdownLink("javascript:alert(1)")).toBeNull();
    expect(
      parseCommunityMarkdown("[unsafe](javascript:alert(1))")[0].inline,
    ).toEqual([{ text: "unsafe", href: undefined }, { text: ")" }]);
  });
});
