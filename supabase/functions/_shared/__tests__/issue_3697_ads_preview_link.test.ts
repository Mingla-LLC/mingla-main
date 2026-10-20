// MINGLA-INVARIANT: I-3697-META-PREVIEW-SRC-DECODED | issue #3697 | the Meta preview URL taken from generatepreviews' iframe HTML is HTML-entity decoded before it is parsed, so its d and t parameters both reach Meta
/**
 * Issue #3697 — "Open preview in new tab" showed Meta's "Not Found".
 *
 * Meta's generatepreviews body is HTML; its iframe src carries `&amp;t=`.
 * admin-ad-preview parsed it raw, so the URL kept `&amp;t=…` (a parameter
 * named `amp;t`) and Meta never received `t`.
 *
 * FAILS ON REVERT: drop decodeHtmlAttribute from admin-ad-preview/index.ts.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decodeHtmlAttribute } from "../adPreviewIframe.ts";

const META_BODY =
  '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=AQKzX1&amp;t=AWm9Q2" width="274" height="213" scrolling="yes" style="border: none;"></iframe>';

const rawSrc = () => {
  const frame = META_BODY.match(/<iframe\b[^>]*>/gi)![0];
  return frame.match(/\ssrc\s*=\s*(["'])(.*?)\1/i)![2];
};

Deno.test("#3697 the raw iframe src loses Meta's t parameter (the bug)", () => {
  const broken = new URL(rawSrc());
  assertEquals(broken.searchParams.get("t"), null);
  assertEquals(broken.searchParams.get("amp;t"), "AWm9Q2");
});

Deno.test("#3697 the decoded src carries both d and t", () => {
  const url = new URL(decodeHtmlAttribute(rawSrc()));
  assertEquals(url.searchParams.get("d"), "AQKzX1");
  assertEquals(url.searchParams.get("t"), "AWm9Q2");
  assertEquals(
    url.toString(),
    "https://www.facebook.com/ads/api/preview_iframe.php?d=AQKzX1&t=AWm9Q2",
  );
});

Deno.test("#3697 decodes numeric references and leaves unknown ones alone", () => {
  assertEquals(decodeHtmlAttribute("a&#38;b&#x26;c&quot;"), 'a&b&c"');
  assertEquals(decodeHtmlAttribute("a&unknown;b"), "a&unknown;b");
  assertEquals(decodeHtmlAttribute("plain"), "plain");
});

Deno.test("#3697 admin-ad-preview decodes before it parses the URL", () => {
  const source = Deno.readTextFileSync(
    new URL("../../admin-ad-preview/index.ts", import.meta.url),
  );
  assert(source.includes("new URL(decodeHtmlAttribute(srcMatch[2]))"));
  assert(!source.includes("url = new URL(srcMatch[2])"));
});
