// #4452 §2.10 (SC-121 server half): the Website pages editor's publish refreshes the
// site through admin-blog `revalidate_page`, which asks the marketing route for the
// `pages` tag only, is gated by the Website editor role (forms_can_edit), and
// reports success only on the route's exact answer for the site-pages tag.
// FAILS-ON-REVERT: sending {tag:"links"} or accepting any 200 fails P-1 / P-2;
// moving the action below the blog-permission check (so website editors get 403)
// fails P-3.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isPagesRevalidated, MARKETING_REVALIDATE_PATH, pagesRevalidateRequest } from "./model.ts";

const SECRET = "s".repeat(32);

Deno.test("#4452 P-1 revalidate_page asks the marketing route for the pages tag only", () => {
  const request = pagesRevalidateRequest("https://usemingla.com", SECRET);
  assertEquals(request.url, `https://usemingla.com${MARKETING_REVALIDATE_PATH}`);
  assertEquals(request.init.method, "POST");
  assertEquals(request.init.headers, { "x-mingla-revalidate-secret": SECRET, "Content-Type": "application/json" });
  assertEquals(JSON.parse(String(request.init.body)), { tag: "pages" });
});

Deno.test("#4452 P-2 a page refresh counts only on the route's exact success", () => {
  assertEquals(isPagesRevalidated(200, { revalidated: true, tag: "site-pages" }), true);
  for (const [status, payload] of [
    [200, { revalidated: true, tag: "links" }],
    [200, { revalidated: true, tag: "blog" }],
    [200, { revalidated: false, tag: "site-pages" }],
    [200, null],
    [400, { error: "unknown_tag" }],
    [500, { revalidated: true, tag: "site-pages" }],
  ] as const) {
    assertEquals(isPagesRevalidated(status, payload), false, JSON.stringify([status, payload]));
  }
});

Deno.test("#4452 P-3 revalidate_page is gated by forms_can_edit, before the blog-writer check", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const at = src.indexOf('early.action === "revalidate_page"');
  const blog = src.indexOf('userClient.rpc("issue_4137_blog_my_permissions")');
  assert(at > 0 && blog > at, "revalidate_page is answered before the blog permission check");
  const block = src.slice(at, blog);
  assert(block.includes('userClient.rpc("forms_can_edit")') && block.includes('return json({ error: "forbidden" }, 403)'));
  // #4636: the call now passes the optional page key (issue_4636_admin_blog_page_revalidate.implementor.test.ts).
  assert(block.includes("pagesRevalidateRequest(MARKETING_ORIGIN, REVALIDATE_SECRET, pageKey)"));
});
