// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 simulator QA run 2 (evidence 06): links in bubbles were neither
// tappable nor styled, and a message without mention data underlined
// everything from "@" to the end.
//
// FAILS-ON-REVERT: drop link detection, style an "@" that is not a
// participant, run a mention to the end of the text, or unwire the bubble's
// link handlers, and the matching case fails.

import { linkifyText, tokenizeMessageText, withSelfMentionCandidate } from "../messageTextTokens.ts";

const root = new URL("../../", import.meta.url);
const read = (path: string) => Deno.readTextFile(new URL(path, root));
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const kinds = (tokens) => tokens.map((t) => `${t.type}:${t.text}`).join("|");

const people = [
  { userId: "u-ben", displayName: "Ben Carter" },
  { userId: "u-ben2", displayName: "Ben" },
  { userId: "u-ada", displayName: "Ada" },
];

Deno.test("QA run 2: links are detected and keep sentence punctuation as text", () => {
  assert(kinds(linkifyText("see https://usemingla.com/e/x.")) === "text:see |link:https://usemingla.com/e/x|text:.", "trailing dot");
  const www = linkifyText("go to www.usemingla.com now");
  assert(www[1].type === "link" && www[1].url === "https://www.usemingla.com", "www opens as https");
  assert(kinds(linkifyText("(https://a.com/x)")) === "text:(|link:https://a.com/x|text:)", "unmatched bracket stays text");
  assert(kinds(linkifyText("https://en.wikipedia.org/wiki/A_(b)")) === "link:https://en.wikipedia.org/wiki/A_(b)", "matched bracket kept");
  assert(kinds(linkifyText("no links here")) === "text:no links here", "plain");
  assert(linkifyText("email me@www.example.com").every((t) => t.type === "text"), "not inside a word");
});

Deno.test("QA run 2: '@' only styles a real participant, never to the end", () => {
  const plain = tokenizeMessageText("ping @someone about the plan tonight", [], people);
  assert(plain.every((t) => t.type === "text"), `unknown @ is plain: ${kinds(plain)}`);
  const real = tokenizeMessageText("hey @Ben Carter see you at 8", [], people);
  assert(kinds(real) === "text:hey |mention:@Ben Carter|text: see you at 8", `longest participant name: ${kinds(real)}`);
  assert(real[1].userId === "u-ben", "maps to the participant");
  const short = tokenizeMessageText("@Ben, you in?", [], people);
  assert(kinds(short) === "mention:@Ben|text:, you in?", `word boundary: ${kinds(short)}`);
  const partial = tokenizeMessageText("@Adam is here", [], people);
  assert(partial.every((t) => t.type === "text"), "a longer word is not a mention");
  const email = tokenizeMessageText("mail x@Ada now", [], people);
  assert(email.every((t) => t.type === "text"), "@ inside a word is not a mention");
});

Deno.test("QA run 2: composer mentions keep their offsets, links still detected around them", () => {
  const content = "@Ada look https://a.com";
  const tokens = tokenizeMessageText(content, [{ userId: "u-ada", displayName: "Ada", startOffset: 0, endOffset: 4 }], []);
  assert(kinds(tokens) === "mention:@Ada|text: look |link:https://a.com", kinds(tokens));
});

Deno.test("QA run 2: the bubble renders tokens with link handlers and the link token", async () => {
  const bubble = strip(await read("components/chat/MessageBubble.tsx"));
  assert(!/\(@\[\\w\\s\]\+\?\)/.test(bubble), "the to-the-end fallback regex is gone");
  assert(/tokenizeMessageText\(content, structured, \[\.\.\.candidates\]\)/.test(bubble), "renders through the tokenizer");
  assert(/accessibilityRole="link"/.test(bubble), "links are links to screen readers");
  assert(/onPress=\{handlers\.onLinkPress \? \(\) => handlers\.onLinkPress\?\.\(token\.url\) : undefined\}/.test(bubble), "tap opens");
  assert(/onLongPress=\{handlers\.onLinkLongPress \? \(\) => handlers\.onLinkLongPress\?\.\(token\.url\) : undefined\}/.test(bubble), "long-press copies");
  assert(/linkReceived: \{\s*color: receivedBubbleTokens\.link,/.test(bubble), "dark bubble link token");
  const chat = strip(await read("components/MessageInterface.tsx"));
  assert(/mentionCandidates=\{mentionCandidates\}\s*onLinkPress=\{handleLinkPress\}\s*onLinkLongPress=\{handleLinkLongPress\}/.test(chat), "thread wires them");
  assert(/<InAppBrowserModal\s+visible=\{linkBrowserUrl !== null\}/.test(chat), "in-app browser");
  assert(/copyAddressText\(url\)/.test(chat), "long-press copies the url");
});

Deno.test("QA run 2: the received link colour passes AA on the dark bubble", async () => {
  const tokens = await read("constants/chatTokens.ts");
  const block = tokens.slice(tokens.indexOf("export const receivedBubbleTokens"));
  const hex = (name) => /#([0-9a-f]{6})/i.exec(new RegExp(`\\b${name}: "([^"]+)"`).exec(block)[1])[1];
  const lum = (h) => {
    const n = parseInt(h, 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const a = lum(hex("link"));
  const b = lum(hex("bubble"));
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert(ratio >= 4.5, `link contrast ${ratio.toFixed(2)}`);
});

// QA run 3 (P3): "@Your Name" was plain text because the participant list
// leaves you out. FAILS-ON-REVERT: drop withSelfMentionCandidate, or feed it
// into the mention suggestions instead of only the bubble styling.
Deno.test("QA run 3: your own name is styled, but you are never a suggestion", async () => {
  const styled = withSelfMentionCandidate(people, "u-me", "Seth Ogieva");
  assert(kinds(tokenizeMessageText("hey @Seth Ogieva look", [], styled)) === "text:hey |mention:@Seth Ogieva|text: look", "self mention styled");
  assert(kinds(tokenizeMessageText("hey @Seth Ogieva look", [], people)) === "text:hey @Seth Ogieva look", "without you it is plain (the bug)");
  assert(withSelfMentionCandidate(people, "u-ada", "Ada").length === people.length, "no duplicate");
  assert(withSelfMentionCandidate(people, null, "Seth").length === people.length, "no id");
  assert(withSelfMentionCandidate(people, "u-me", "  ").length === people.length, "no name");

  const chat = strip(await read("components/MessageInterface.tsx"));
  const candidates = chat.slice(chat.indexOf("const mentionCandidates = useMemo("), chat.indexOf("const handleLinkPress"));
  assert(/withSelfMentionCandidate\([\s\S]*currentUserId,\s*currentUserName,/.test(candidates), "bubble styling includes you");
  assert(/useChatInputController\(\{\s*participants: participantsQuery\.data \?\? \[\],/.test(chat), "suggestions still come from the participants without you");
  const hook = strip(await read("hooks/useConversationParticipants.ts"));
  assert(/\.filter\(\(id\) => id !== currentUserId\)/.test(hook), "the participants query still leaves you out");
});
