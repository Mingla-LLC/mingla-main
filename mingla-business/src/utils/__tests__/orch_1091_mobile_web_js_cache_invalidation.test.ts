import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const repoFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");

describe("ORCH-1091 mobile web JS cache invalidation", () => {
  test("Vercel does not serve async web JS manifests as immutable", () => {
    const vercel = JSON.parse(repoFile("vercel.json"));
    const webJsHeader = vercel.headers.find(
      (header: { source?: string }) => header.source === "/_expo/static/js/web/(.*)",
    );

    expect(JSON.stringify(webJsHeader?.headers ?? [])).toContain(
      "max-age=0, must-revalidate",
    );
  });

  test("Vercel web JS header overrides the broad immutable static header", () => {
    const vercel = JSON.parse(repoFile("vercel.json"));
    const broadStaticIndex = vercel.headers.findIndex(
      (header: { source?: string }) => header.source === "/_expo/static/(.*)",
    );
    const webJsIndex = vercel.headers.findIndex(
      (header: { source?: string }) => header.source === "/_expo/static/js/web/(.*)",
    );

    expect(broadStaticIndex).toBeGreaterThanOrEqual(0);
    expect(webJsIndex).toBeGreaterThan(broadStaticIndex);
  });

  test("post-export injection cache-busts eager Expo JS script URLs", () => {
    const source = repoFile("scripts/inject-mobile-blur-css.mjs");

    expect(source).toContain("orch1091-js-cache-bust");
    expect(source).toContain("JS_CACHE_BUST_PARAM");
    expect(source).toContain("/_expo/static/js/web/");
    expect(source).toContain("?v=${JS_CACHE_BUST_PARAM}");
  });

  // NOTE (#1062 B1 junk-pin removal): the 4th test previously pinned the
  // existence + string-content of `scripts/ci/orch-1085-mobile-web-signin-home.mjs`,
  // a firewall-gate script INTENTIONALLY RETIRED in ORCH-1098 Stage 3
  // (commit 76a10b126 — "Retire the obsolete ORCH-1085→1096 firewall gate
  // scripts"). The JS-cache-invalidation contract it nominally guarded is
  // fully covered by the three tests above, which assert the real runtime
  // behavior against the live vercel.json headers + the post-export inject
  // script. Deleting the pin drops zero behavioral coverage.
});
