/**
 * topbar-padding-parity.test.ts — ORCH-0973 happy-path regression.
 *
 * Hub (`hub/_layout.tsx`) and Marketing (`marketing/_layout.tsx`) own the
 * canonical TopBar chrome: the host View applies `paddingTop: insets.top`
 * for the safe-area inset, and the `barWrap` block holds horizontal +
 * bottom padding only — NO `paddingTop`.
 *
 * Home (`home.tsx`) and Account (`account.tsx`) historically added an
 * extra `paddingTop: spacing.sm` inside `barWrap`, which on mobile pushed
 * the TopBar visibly lower than on Hub/Blasts. ORCH-0973 deleted that
 * line.
 *
 * Source-grep style — reads the route files from disk and asserts the
 * `barWrap` block does NOT contain `paddingTop:`.
 *
 * Fails-on-revert: reintroducing `paddingTop: spacing.sm` inside
 * `barWrap` in either file causes both `home.tsx` and `account.tsx`
 * assertions below to fail.
 */

import fs from "node:fs";
import path from "node:path";

const HOME_PATH = path.resolve(__dirname, "..", "home.tsx");
const ACCOUNT_PATH = path.resolve(__dirname, "..", "account.tsx");

function extractBarWrapBlock(source: string): string {
  const match = source.match(/barWrap:\s*\{([^}]*)\}/);
  if (match === null) {
    throw new Error("barWrap block not found in source");
  }
  return match[1];
}

describe("ORCH-0973 — Home + Account TopBar padding parity with Hub/Blasts", () => {
  it("home.tsx barWrap has no paddingTop", () => {
    const source = fs.readFileSync(HOME_PATH, "utf8");
    const barWrap = extractBarWrapBlock(source);
    expect(barWrap).not.toMatch(/paddingTop\s*:/);
  });

  it("account.tsx barWrap has no paddingTop", () => {
    const source = fs.readFileSync(ACCOUNT_PATH, "utf8");
    const barWrap = extractBarWrapBlock(source);
    expect(barWrap).not.toMatch(/paddingTop\s*:/);
  });
});
