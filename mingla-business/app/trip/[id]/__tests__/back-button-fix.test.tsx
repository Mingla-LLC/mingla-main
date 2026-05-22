/**
 * ORCH-0919 — trip sub-page back-button fix happy-path regression test.
 *
 * Bug: ORCH-0913 wired the Money and Travelers sub-page top-bar back buttons
 * with `router.push(/trip/${eventId})`, which adds a new history entry instead
 * of popping. Sequence trips-list → trip → money → back → trip → back routed
 * the user BACK into Money instead of out to the Trips list because the second
 * "back" popped the pushed trip entry off the stack, landing on Money.
 *
 * Fix: replace `router.push(...)` with the codebase's canonical canGoBack-guarded
 * pattern (mirrors `brand/[id]/blasts.tsx:63-66`):
 *   if (router.canGoBack()) router.back();
 *   else router.replace(`/trip/${eventId}` as never);
 *
 * fails-on-revert: reverting either onBack handler back to
 * `router.push(\`/trip/${eventId}\` as never)` will fail T-01 and T-02.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

const MONEY = read("mingla-business/app/trip/[id]/money/index.tsx");
const TRAVELERS = read("mingla-business/app/trip/[id]/travelers/index.tsx");

describe("ORCH-0919 trip sub-page back button uses canGoBack guard", () => {
  test("T-01 Money page onBack uses router.canGoBack() guard, not bare router.push", () => {
    expect(MONEY).toContain("router.canGoBack()");
    expect(MONEY).toContain("router.back()");
    expect(MONEY).not.toMatch(/onBack=\{\(\)\s*=>\s*router\.push\(`\/trip\/\$\{eventId\}/);
  });

  test("T-02 Travelers page onBack uses router.canGoBack() guard, not bare router.push", () => {
    expect(TRAVELERS).toContain("router.canGoBack()");
    expect(TRAVELERS).toContain("router.back()");
    expect(TRAVELERS).not.toMatch(/onBack=\{\(\)\s*=>\s*router\.push\(`\/trip\/\$\{eventId\}/);
  });

  test("T-03 fallback uses router.replace (not router.push) when canGoBack is false", () => {
    expect(MONEY).toContain("router.replace(`/trip/${eventId}` as never)");
    expect(TRAVELERS).toContain("router.replace(`/trip/${eventId}` as never)");
  });
});
