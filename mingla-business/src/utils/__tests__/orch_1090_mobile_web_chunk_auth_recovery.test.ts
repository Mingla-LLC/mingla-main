import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const repoFile = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, "mingla-business", relativePath), "utf8");

describe("ORCH-1090 mobile web chunk/auth recovery", () => {
  // [TEST-MOD-APPROVED ORCH-1098] The static /home stand-in was retired by
  // ORCH-1098 Stage 3 (the real Expo app now boots on phones), so the
  // "static Home session-label" assertion was removed. The stale-chunk recovery
  // contract — the genuinely orthogonal, KEPT part of ORCH-1090 — is preserved
  // in the two tests below.

  test("post-export HTML injection recovers stale async route chunks before app boot", () => {
    const source = repoFile("scripts/inject-mobile-blur-css.mjs");

    expect(source).toContain("mingla-mobile-web-chunk-recovery");
    expect(source).toContain("/_expo/static/js/web/");
    expect(source).toContain("location.reload()");
    expect(source).toContain("/home?recovered=chunk");
    expect(source).toContain("unhandledrejection");
    expect(source).toContain("ChunkLoadError");
  });

  // [TEST-MOD-APPROVED ORCH-1098] The orch-1085 static-Home CI gate was retired
  // with the static /home stand-in. The stale-chunk recovery contract it pinned
  // is now asserted directly against the inject script in the test above.
});
