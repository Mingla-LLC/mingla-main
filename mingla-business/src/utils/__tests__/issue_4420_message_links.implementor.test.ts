/**
 * #4420 SC-15 / SC-16 — links in messages open, and text can be selected.
 *
 * FAILS ON REVERT: linkify a javascript:/data: address, keep trailing
 * punctuation or an unmatched ")" in a link, drop selectable from the message
 * text, drop the in-app browser / noopener opener, or remove Select text from
 * the phone menu, and the matching test fails.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildBrandGroupMessageMenu } from "../brandGroupThreadModel";
import { isOpenableMessageLink, linkifyMessageText, messageLinkHref } from "../messageLinks";

const source = (relative: string): string => readFileSync(join(process.cwd(), relative), "utf8");
const links = (text: string): string[] =>
  linkifyMessageText(text).flatMap((token) => (token.type === "link" ? [token.url] : []));
const joined = (text: string): string => linkifyMessageText(text).map((token) => token.text).join("");

describe("SC-15 the linkify tokenizer", () => {
  test("http, https and www. become links; www. opens as https", () => {
    expect(links("see https://usemingla.com/e/abc and http://a.io")).toEqual(["https://usemingla.com/e/abc", "http://a.io"]);
    expect(links("tickets at www.usemingla.com today")).toEqual(["https://www.usemingla.com"]);
    expect(messageLinkHref("www.x.com")).toBe("https://www.x.com");
  });

  test("javascript:, data:, file: and custom schemes are never links", () => {
    expect(links("javascript:alert(1)")).toEqual([]);
    expect(links("data:text/html;base64,PHNjcmlwdD4=")).toEqual([]);
    expect(links("file:///etc/passwd")).toEqual([]);
    expect(links("mingla://open intent://x")).toEqual([]);
    expect(links("xhttps://evil.com")).toEqual([]);
    expect(isOpenableMessageLink("javascript:alert(1)")).toBe(false);
    expect(isOpenableMessageLink("https://")).toBe(false);
    expect(isOpenableMessageLink("https://ok.com/x")).toBe(true);
  });

  test("trailing punctuation is not part of the link", () => {
    expect(links("see https://x.com/a.")).toEqual(["https://x.com/a"]);
    expect(links("is it https://x.com/a?!")).toEqual(["https://x.com/a"]);
    expect(links("go to https://x.com, then")).toEqual(["https://x.com"]);
  });

  test("a URL inside parentheses keeps its own brackets only", () => {
    expect(links("(https://x.com)")).toEqual(["https://x.com"]);
    expect(links("https://en.wikipedia.org/wiki/A_(b)")).toEqual(["https://en.wikipedia.org/wiki/A_(b)"]);
    expect(joined("(https://x.com).")).toBe("(https://x.com).");
  });

  test("a very long URL is one link and the text round-trips", () => {
    const long = `https://x.com/${"a".repeat(3000)}?q=${"b".repeat(2000)}`;
    expect(links(`look ${long} now`)).toEqual([long]);
    expect(joined(`look ${long} now`)).toBe(`look ${long} now`);
  });

  test("text with no URL is unchanged, one text token", () => {
    expect(linkifyMessageText("Doors at 6pm, see you Friday.")).toEqual([{ type: "text", text: "Doors at 6pm, see you Friday." }]);
    expect(linkifyMessageText("")).toEqual([{ type: "text", text: "" }]);
  });

  test("multiple URLs and unicode around them", () => {
    const text = "Café 🎉https://a.com/ü and «www.b.org» 東京 https://c.io!";
    expect(links(text)[0]).toBe("https://a.com/ü");
    expect(links(text)).toContain("https://c.io");
    expect(joined(text)).toBe(text);
  });

  test("a link does not start mid-word", () => {
    expect(links("foo.www.bar.com")).toEqual([]);
  });

  test("links open in the in-app browser (phones) or a noopener tab (web)", () => {
    const opener = source("src/components/messages/openMessageLink.ts");
    expect(opener).toContain('await import("expo-web-browser")');
    expect(opener).toContain("WebBrowser.openBrowserAsync(url)");
    expect(opener).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(opener).toContain("if (!isOpenableMessageLink(url)) throw");
  });

  test("a long-press on a link opens the menu, never the link and the bubble tap together", () => {
    const row = source("src/components/messages/BrandGroupMessageRow.tsx");
    expect(row).toContain("onPress={() => onOpenLink(token.url)}");
    expect(row).toContain("onLongPress={onLongPress ?? (() => undefined)}");
    const thread = source("app/messages/[conversationId].tsx");
    expect(thread).toContain("onOpenLink={openLink} onLongPress={() => setMenuMessage(message)}");
    // The Guests side gets the same renderer from the thread.
    expect(thread).toContain("renderText: (content: string, mine: boolean) => (");
  });
});

describe("SC-16 part of a message can be selected and copied", () => {
  test("message text is selectable (web selects natively)", () => {
    expect(source("src/components/messages/BrandGroupMessageRow.tsx")).toContain('selectable testID="brand-group-message-text"');
    expect(source("src/components/groupChat/GroupChatPanel.tsx")).toContain("selectable\n");
  });

  test("phones keep Copy and add Select text; web keeps Copy only", () => {
    const phone = buildBrandGroupMessageMenu({ senderName: "Ada", hasText: true, canSupport: false, selected: false, canSelectText: true });
    expect(phone.map((action) => action.key)).toEqual(["reply", "copy", "select_text", "select"]);
    const web = buildBrandGroupMessageMenu({ senderName: "Ada", hasText: true, canSupport: false, selected: false, canSelectText: false });
    expect(web.map((action) => action.key)).not.toContain("select_text");
    const file = buildBrandGroupMessageMenu({ senderName: "Ada", hasText: false, canSupport: false, selected: false, canSelectText: true });
    expect(file.map((action) => action.key)).not.toContain("select_text");
  });

  test("the Select text sheet is a read-only selectable field with close, backdrop and back dismiss", () => {
    const thread = source("app/messages/[conversationId].tsx");
    expect(thread).toContain('case "select_text":');
    expect(thread).toContain("canSelectText: Platform.OS !== \"web\"");
    expect(thread).toContain("onRequestClose={() => setSelectText(null)}");
    expect(thread).toContain('accessibilityLabel="Close select text"');
    expect(thread).toContain('testID="brand-group-select-text-close"');
    expect(thread).toContain("showSoftInputOnFocus={false}");
    expect(thread).toContain("onChangeText={() => undefined}");
  });
});
