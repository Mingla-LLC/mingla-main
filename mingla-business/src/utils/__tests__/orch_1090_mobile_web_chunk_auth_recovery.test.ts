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

  // [TEST-MOD-APPROVED ORCH-1485] Issue #1485 P2-1 removed the recovery
  // script's second-failure `location.replace("/home?…")` branch (and the
  // identical `catch` fallback). Both destroyed the user's URL: an anonymous
  // buyer on `/checkout/<eventId>` was hard-redirected to the AUTHENTICATED
  // brand dashboard with the checkout URL erased from history. The `toContain`
  // pin on that redirect string is REPLACED — not deleted, not weakened — by
  // the strictly stronger inverse pin plus a pin on the shared cooldown record
  // that took its place. Full behavioural coverage (30 cases, incl. the
  // two-owner no-double-reload proof) lives in the append-only
  // `__tests__/issue1485_p2_1_one_chunk_recovery_owner.test.ts`.
  test("post-export HTML injection recovers stale async route chunks before app boot", () => {
    const source = repoFile("scripts/inject-mobile-blur-css.mjs");

    expect(source).toContain("mingla-mobile-web-chunk-recovery");
    expect(source).toContain("/_expo/static/js/web/");
    expect(source).toContain("location.reload()");
    expect(source).not.toContain("/home?recovered=chunk");
    expect(source).toContain("mingla:last-chunk-reload");
    expect(source).toContain("unhandledrejection");
    expect(source).toContain("ChunkLoadError");
  });

  // [TEST-MOD-APPROVED ORCH-1098] The orch-1085 static-Home CI gate was retired
  // with the static /home stand-in. The stale-chunk recovery contract it pinned
  // is now asserted directly against the inject script in the test above.
});
