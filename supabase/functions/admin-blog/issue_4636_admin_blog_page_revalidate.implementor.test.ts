// #4636 (build 2): publishing one page refreshes that page. revalidate_page takes an
// optional pageKey (a site page, a staff-made page `p-<hex>` or 'site-settings') and
// asks the marketing route for {"tag":"pages","page":<key>}, which also drops the
// page's own cache tag `site-page:<key>`. Without a key the #4452 whole-site call is
// unchanged. A malformed key is a 400 before anything is sent; success counts only
// when the route answers for that same page.
// FAILS-ON-REVERT: dropping `page` from the request body fails R-1; accepting any
// site-pages answer for a keyed call fails R-2; removing the bad_page check fails R-4.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  isPagesRevalidated,
  pagesRevalidateRequest,
  revalidatePageKey,
} from "./model.ts";

const SECRET = "s".repeat(32);

Deno.test("#4636 R-1 a keyed refresh names the page; an unkeyed one is the #4452 body exactly", () => {
  assertEquals(
    JSON.parse(
      String(
        pagesRevalidateRequest("https://usemingla.com", SECRET, "host").init
          .body,
      ),
    ),
    { tag: "pages", page: "host" },
  );
  assertEquals(
    JSON.parse(
      String(
        pagesRevalidateRequest(
          "https://usemingla.com",
          SECRET,
          "p-0123456789ab",
        ).init.body,
      ),
    ),
    { tag: "pages", page: "p-0123456789ab" },
  );
  assertEquals(
    JSON.parse(
      String(
        pagesRevalidateRequest("https://usemingla.com", SECRET, "site-settings")
          .init.body,
      ),
    ),
    { tag: "pages", page: "site-settings" },
  );
  assertEquals(
    JSON.parse(
      String(pagesRevalidateRequest("https://usemingla.com", SECRET).init.body),
    ),
    { tag: "pages" },
  );
  assertEquals(
    JSON.parse(
      String(
        pagesRevalidateRequest("https://usemingla.com", SECRET, null).init.body,
      ),
    ),
    { tag: "pages" },
  );
});

Deno.test("#4636 R-2 a keyed refresh counts only when the route answers for that page", () => {
  assertEquals(
    isPagesRevalidated(200, {
      revalidated: true,
      tag: "site-pages",
      page: "host",
    }, "host"),
    true,
  );
  assertEquals(
    isPagesRevalidated(200, { revalidated: true, tag: "site-pages" }, "host"),
    false,
    "an old route that ignored the page",
  );
  assertEquals(
    isPagesRevalidated(200, {
      revalidated: true,
      tag: "site-pages",
      page: "about",
    }, "host"),
    false,
  );
  assertEquals(
    isPagesRevalidated(200, { revalidated: true, tag: "site-pages" }),
    true,
    "the unkeyed #4452 answer still counts",
  );
});

Deno.test("#4636 R-3 the page key: absent, valid, or refused", () => {
  assertEquals(revalidatePageKey({ action: "revalidate_page" }), undefined);
  assertEquals(revalidatePageKey(null), undefined);
  for (const ok of ["home", "going-out", "p-0123456789ab", "site-settings"]) {
    assertEquals(revalidatePageKey({ pageKey: ok }), ok);
  }
  for (const bad of ["Home", "../x", "a b", "", "x".repeat(65), 7, { k: 1 }]) {
    assertEquals(revalidatePageKey({ pageKey: bad }), null, String(bad));
  }
});

Deno.test("#4636 R-4 revalidate_page refuses a malformed key before it sends anything", async () => {
  const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const at = src.indexOf('early.action === "revalidate_page"');
  const send = src.indexOf(
    "pagesRevalidateRequest(MARKETING_ORIGIN, REVALIDATE_SECRET, pageKey)",
  );
  const refuse = src.indexOf(
    'if (pageKey === null) return json({ error: "bad_page" }, 400);',
  );
  assert(
    at > 0 && refuse > at && send > refuse,
    "bad_page is answered after the editor check and before the request is built",
  );
  assert(
    src.includes(
      "isPagesRevalidated(response.status, await response.json().catch(() => null), pageKey)",
    ),
  );
});
