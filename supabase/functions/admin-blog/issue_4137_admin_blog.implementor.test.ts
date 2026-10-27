import { assertEquals, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { blogDocumentReferences } from "../../../packages/blog-document/src/index.ts";
import { classifyLinkStatus, collectBlogLinkReferences, isBlogNotReadyError, isPrivateAddress, validateLinkCheckUrl } from "./model.ts";

Deno.test("#4137 admin-blog rejects SSRF destinations and non-https URLs", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.1.1", "::1", "fe80::1"]) assertEquals(isPrivateAddress(address), true, address);
  for (const url of ["http://usemingla.com", "https://127.0.0.1/path", "https://[::1]/", "https://user:pass@example.com/"]) assertThrows(() => validateLinkCheckUrl(url));
  assertEquals(validateLinkCheckUrl("https://usemingla.com/blog").hostname, "usemingla.com");
});

Deno.test("#4137 admin-blog classifies live status and rollout errors", () => {
  assertEquals([199, 200, 204, 301, 399, 400, 500].map(classifyLinkStatus), [false, true, true, true, true, false, false]);
  assertEquals(isBlogNotReadyError({ code: "42P01" }), true);
  assertEquals(isBlogNotReadyError({ code: "PGRST202", message: "function not found" }), true);
  assertEquals(isBlogNotReadyError({ code: "42501" }), false);
});

Deno.test("#4137 admin-blog link walker stays in parity with the shared reference walker", () => {
  const document = { version: 1 as const, blocks: [
    { id: "para01", type: "paragraph" as const, html: '<a href="https://example.com/a">A</a>' },
    { id: "list01", type: "list" as const, ordered: false, items: ['<a href="/help">Help</a>'] },
    { id: "button1", type: "button" as const, label: "Host", target: { kind: "page" as const, path: "/host" } },
    { id: "embed1", type: "embed" as const, provider: "youtube" as const, url: "https://www.youtube.com/watch?v=abc123" },
    { id: "city01", type: "city" as const, citySlug: "raleigh-nc" },
  ] };
  const shared = blogDocumentReferences(document);
  const local = collectBlogLinkReferences(document).map((item) => item.url);
  assertEquals(shared.urls.sort(), ["https://example.com/a", "https://www.youtube.com/watch?v=abc123"].sort());
  assertEquals(local.filter((url) => shared.urls.includes(url)).sort(), shared.urls.sort());
  assertEquals(local.sort(), ["https://example.com/a", "https://usemingla.com/help", "https://usemingla.com/host", "https://www.youtube.com/watch?v=abc123", "https://usemingla.com/cities/raleigh-nc"].sort());
});
