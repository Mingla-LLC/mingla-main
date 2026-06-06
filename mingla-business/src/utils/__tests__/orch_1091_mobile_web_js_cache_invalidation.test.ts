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

  test("mobile-web CI guard pins the JS cache invalidation contract", () => {
    const source = repoFile("scripts/ci/orch-1085-mobile-web-signin-home.mjs");

    expect(source).toContain("web JS bundles must not be served immutable");
    expect(source).toContain("post-export injection must cache-bust eager Expo JS script URLs");
    expect(source).toContain("dist/index.html must cache-bust eager Expo JS script URLs");
  });
});
