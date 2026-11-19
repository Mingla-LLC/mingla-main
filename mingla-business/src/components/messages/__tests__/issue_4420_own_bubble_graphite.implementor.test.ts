/**
 * #4420 D2 — your own bubble is the selected graphite material, never an
 * orange field (approved design; Seth's "no orange fields" rule). Text and
 * links on it are white (links stay underlined), pending uploads match.
 *
 * FAILS ON REVERT: point mineBubble back at color.accent, or the bubble text
 * back at the ink-on-orange colour, and this fails.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { brandGroupChat } from "../../../constants/brandGroupChatTokens";
import { color } from "../../../constants/designSystem";

const source = (relative: string): string => readFileSync(join(process.cwd(), relative), "utf8");

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("#4420 D2 own bubble", () => {
  test("is graphite, not the brand orange", () => {
    expect(brandGroupChat.mineBubble).toBe(color.card3);
    expect(brandGroupChat.mineBubble).not.toBe(color.accent);
    expect(brandGroupChat.otherBubble).toBe(color.card);
  });
  test("its text and links read on it (WCAG AA 4.5:1) on both bubbles", () => {
    expect(contrast(brandGroupChat.mineBubbleText, brandGroupChat.mineBubble)).toBeGreaterThan(4.5);
    expect(contrast(brandGroupChat.otherText, brandGroupChat.otherBubble)).toBeGreaterThan(4.5);
    const row = source("src/components/messages/BrandGroupMessageRow.tsx");
    expect(row).toContain("textMine: { color: brandGroupChat.mineBubbleText }");
    expect(row).toContain('textDecorationLine: "underline"');
  });
  test("pending uploads and file cards use the same bubble text", () => {
    expect(source("src/components/messages/BrandGroupPendingUploadRow.tsx")).not.toContain("brandGroupChat.mineText");
    expect(source("app/messages/[conversationId].tsx")).toContain("messageTextMine: { color: brandGroupChat.mineBubbleText }");
  });
});

describe("#4420 D3 sticky day marker", () => {
  test("its chip is opaque, above the bubbles, with a top inset", () => {
    const route = source("app/messages/[conversationId].tsx");
    const dayRow = /dayRow: \{[^}]*\}/.exec(route)?.[0] ?? "";
    const dayText = /dayText: \{[^}]*\}/.exec(route)?.[0] ?? "";
    expect(dayRow).toContain("zIndex: 3");
    expect(dayRow).toContain("paddingTop: space[2]");
    expect(dayText).toContain("backgroundColor: color.card2");
    expect(dayText).not.toContain("brandGroupChat.strip");
    expect(color.card2.startsWith("#")).toBe(true);
  });
});

describe("#4420 D4 Media is Team-only", () => {
  test("the Guests side has no Media button, rail tab, menu row or full-screen panel", () => {
    const route = source("app/messages/[conversationId].tsx");
    expect(route).toContain('const mediaShown = side === "team";');
    expect(route).toContain('(desktopDetailTab === "media" && !mediaShown) ? "people"');
    expect(route).toContain("if (!showRail && mediaPanelOpen && mediaShown && conversationId) {");
    expect(route).toContain('...(mediaShown ? [{ key: "media"');
    expect((route.match(/\{mediaShown \? \(/g) ?? []).length).toBe(2);
  });
});

describe("#4420 D5 narrow header subtitle", () => {
  test("phones and narrow web use the short subtitle on both sides", () => {
    const route = source("app/messages/[conversationId].tsx");
    expect(route).toContain('t(narrowHeader ? "messages.subtitle_guests_short" : "messages.subtitle_guests")');
    expect(route).toContain('narrowHeader ? t("messages.subtitle_team_short")');
    const english = JSON.parse(source("src/i18n/locales/en/brandMessages.json")) as { messages: Record<string, string> };
    expect(english.messages.subtitle_guests_short).toBe("Guests room");
    expect(english.messages.subtitle_team_short).toBe("Team chat · private");
  });
});
