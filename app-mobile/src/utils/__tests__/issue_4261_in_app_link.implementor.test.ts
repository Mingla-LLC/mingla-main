// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4261 amendment 1 (6.4) — the one in-app link helper, and every link
// tap in plans and chat routed through it.
//
// inAppLink.ts imports `@mingla/offering-rendering` (a bare package name only
// Metro / tsc resolve), so this suite loads its source with that import and its
// relative import pointed at the real files (read-only; nothing is written).
//
// FAILS-ON-REVERT:
// - classifyLink letting javascript: / intent: / maps: through, or not
//   upgrading http → the matrix fails.
// - MessageInterface (or a plan file) calling Linking.openURL /
//   openBrowserAsync again, or keeping its own InAppBrowserModal → the routing
//   case fails.

import { buildMapsDeepLink } from "../../../../packages/offering-rendering/mapsDeepLink.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n  expected ${e}\n  actual   ${a}`);
}

async function loadInAppLink() {
  const here = new URL("../inAppLink.ts", import.meta.url);
  let source = await Deno.readTextFile(here);
  source = source
    .replace(`"@mingla/offering-rendering"`, JSON.stringify(new URL("../../../../packages/offering-rendering/mapsDeepLink.ts", import.meta.url).href))
    .replace(`"./normalizeWebsiteUrl"`, JSON.stringify(new URL("../normalizeWebsiteUrl.ts", import.meta.url).href));
  assert(!/from "\.\.?\//.test(source), "every relative import was pointed at a real file");
  return await import(`data:application/typescript;base64,${btoa(unescape(encodeURIComponent(source)))}`);
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = async (rel: string) => strip(await Deno.readTextFile(new URL(rel, import.meta.url)));

Deno.test("classifyLink matrix", async () => {
  const { classifyLink } = await loadInAppLink();
  assertEquals(classifyLink("http://example.com/a"), { kind: "web", url: "https://example.com/a" }, "http → https web");
  assertEquals(classifyLink("https://example.com"), { kind: "web", url: "https://example.com" }, "https web");
  assertEquals(classifyLink(" example.com/menu "), { kind: "web", url: "https://example.com/menu" }, "bare host");
  assertEquals(classifyLink("https://x.com/menu.PDF"), { kind: "document", url: "https://x.com/menu.PDF" }, "pdf document");
  assertEquals(classifyLink("tel:+2348000000"), { kind: "system", url: "tel:+2348000000" }, "tel");
  assertEquals(classifyLink("mailto:a@b.com"), { kind: "system", url: "mailto:a@b.com" }, "mailto");
  assertEquals(classifyLink("sms:+1555"), { kind: "system", url: "sms:+1555" }, "sms");
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "intent://scan#Intent;end",
    "maps:?q=x",
    "geo:0,0?q=x",
    "mingla://chat/1",
    "",
    "   ",
    "tel:",
    "not a link",
    "https://localhost",
  ]) {
    assertEquals(classifyLink(bad), { kind: "invalid" }, `invalid: ${bad}`);
  }
});

Deno.test("mapsWebUrl is the offering-rendering web form", async () => {
  const { mapsWebUrl } = await loadInAppLink();
  assertEquals(
    mapsWebUrl({ lat: 6.43, lng: 3.42, label: "Skyline" }),
    buildMapsDeepLink({ geo: { lat: 6.43, lng: 3.42 }, label: "Skyline", platform: "web" }).url,
    "coordinates",
  );
  assertEquals(
    mapsWebUrl({ lat: null, lng: null, label: "Mama's Kitchen" }),
    buildMapsDeepLink({ geo: null, label: "Mama's Kitchen", platform: "web" }).url,
    "label only",
  );
  assert(mapsWebUrl({ lat: null, lng: null, label: "x" }).startsWith("https://"), "https, opens in Mingla");
  assertEquals(mapsWebUrl({ lat: null, lng: null, label: null }), null, "nothing to show");
});

Deno.test("plan and chat link taps route through the in-app helper", async () => {
  const chat = await read("../../components/MessageInterface.tsx");
  assert(!/Linking\.openURL\(/.test(chat), "MessageInterface: no Linking.openURL(");
  assert(!/openBrowserAsync\(/.test(chat), "MessageInterface: no openBrowserAsync(");
  assert(!/<InAppBrowserModal/.test(chat) && !/linkBrowserUrl/.test(chat), "MessageInterface: no own browser mount");
  assert(/<InAppBrowserProvider>\s*<MessageInterfaceInner/.test(chat), "MessageInterface is wrapped in the provider");
  assert(/const browser = useOpenInMingla\(\)/.test(chat), "MessageInterface reads useOpenInMingla");
  assert(/browser\.open\(url, title\)/.test(chat), "message and plan links open in Mingla");
  assert(/browser\.openDocument\(url\)/.test(chat), "documents open in the overlay");
  for (const rel of [
    "../../components/chat/PlanCardBubble.tsx",
    "../../components/chat/PlanMatchesSheet.tsx",
    "../../components/chat/PlanLinkRow.tsx",
    "../../components/chat/PlanPlaceOptions.tsx",
    "../../components/chat/PlansSheet.tsx",
    "../../components/chat/PlanCommentsSheet.tsx",
  ]) {
    const source = await read(rel);
    assert(!/Linking\.openURL\(|openBrowserAsync\(|openAuthSessionAsync\(/.test(source), `${rel}: no raw outside-link call`);
  }
  const matches = await read("../../components/chat/PlanMatchesSheet.tsx");
  assert(/<InAppBrowserProvider>/.test(matches), "Matches (its own RN Modal) has its own provider");
  assert(/browser\.open\(/.test(matches), "Matches link rows open through the helper");
  const provider = await read("../../components/InAppBrowserProvider.tsx");
  assert(/classifyLink\(/.test(provider), "the provider classifies every link");
  assert(/<InAppBrowserModal/.test(provider), "the provider mounts the shared in-app browser");
  assert(!/Linking\.openURL\(url\)/.test(provider), "a document never falls back to the system");
});
