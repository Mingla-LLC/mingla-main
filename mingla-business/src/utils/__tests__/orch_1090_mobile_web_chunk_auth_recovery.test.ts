import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const repoFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");

describe("ORCH-1090 mobile web chunk/auth recovery", () => {
  test("static Home does not claim signed-in state without a real session", () => {
    const source = repoFile("public/home.html");

    expect(source).toContain('id="session-label">Signed out</p>');
    expect(source).toContain("session && session.access_token");
    expect(source).toContain('email || "Signed in"');
    expect(source).not.toContain('id="session-label">Signed in</p>');
  });

  test("post-export HTML injection recovers stale async route chunks before app boot", () => {
    const source = repoFile("scripts/inject-mobile-blur-css.mjs");

    expect(source).toContain("mingla-mobile-web-chunk-recovery");
    expect(source).toContain("/_expo/static/js/web/");
    expect(source).toContain("location.reload()");
    expect(source).toContain("/home?recovered=chunk");
    expect(source).toContain("unhandledrejection");
    expect(source).toContain("ChunkLoadError");
  });

  test("mobile-web CI guard pins the Home auth label and chunk recovery contracts", () => {
    const source = repoFile("scripts/ci/orch-1085-mobile-web-signin-home.mjs");

    expect(source).toContain("must not claim Signed in without a real browser session");
    expect(source).toContain("must include stale async chunk recovery before Expo app boot");
    expect(source).toContain("dist/index.html must contain stale async chunk recovery");
  });
});
