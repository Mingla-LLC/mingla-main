/**
 * topbar-padding-parity.adversarial.test.ts — ORCH-0973 adversarial.
 *
 * Different angle from the happy-path test:
 *   The happy-path asserts home/account barWrap has NO paddingTop.
 *   This adversarial asserts the ENTIRE `barWrap` block in all four
 *   canonical tab shells (hub/_layout, marketing/_layout, home, account)
 *   is structurally identical — same key set, same token values,
 *   whitespace-normalized.
 *
 * Catches bidirectional drift the happy-path misses:
 *   - Someone adds `paddingTop` to hub/_layout or marketing/_layout
 *     (would re-skew parity in the OTHER direction).
 *   - Someone replaces `spacing.sm` with a different token in any one
 *     barWrap (visual drift not caught by absence-of-paddingTop).
 *   - Someone adds a new padding key (e.g., `paddingVertical`) to only
 *     one of the four files.
 *
 * Fails-on-revert: reintroducing `paddingTop: spacing.sm` to home/account
 * barWrap makes those two extracted blocks diverge from hub/marketing
 * blocks, so the equality assertion below fails.
 */

import fs from "node:fs";
import path from "node:path";

const ROUTES = {
  hub: path.resolve(__dirname, "..", "hub", "_layout.tsx"),
  marketing: path.resolve(__dirname, "..", "marketing", "_layout.tsx"),
  home: path.resolve(__dirname, "..", "home.tsx"),
  account: path.resolve(__dirname, "..", "account.tsx"),
} as const;

function extractAndNormalizeBarWrap(filePath: string): string {
  const source = fs.readFileSync(filePath, "utf8");
  const match = source.match(/barWrap:\s*\{([^}]*)\}/);
  if (match === null) {
    throw new Error(`barWrap not found in ${filePath}`);
  }
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort()
    .join(",");
}

describe("ORCH-0973 adversarial — bidirectional barWrap drift across all four tab shells", () => {
  it("hub/_layout, marketing/_layout, home, and account barWrap blocks are structurally identical", () => {
    const hub = extractAndNormalizeBarWrap(ROUTES.hub);
    const marketing = extractAndNormalizeBarWrap(ROUTES.marketing);
    const home = extractAndNormalizeBarWrap(ROUTES.home);
    const account = extractAndNormalizeBarWrap(ROUTES.account);

    expect(home).toBe(hub);
    expect(account).toBe(hub);
    expect(marketing).toBe(hub);
  });
});
