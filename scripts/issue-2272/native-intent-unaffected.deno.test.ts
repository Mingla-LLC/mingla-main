/**
 * issue #2272 — "a phone WITH the app is unaffected", EXECUTED.
 *
 * #2272 changed only the web. The claim that a phone with the Explorer app still
 * behaves exactly as #2219 left it therefore rests on two things: no
 * `.well-known` file moved (pinned by `web-app-link-landings.model.test.mjs` M4,
 * by SHA-256), and `app-mobile/app/+native-intent.tsx` still sends these four
 * families to home.
 *
 * M5 asserts the second by PARSING `SERVED_ROUTE_SEGMENTS`. That is a real
 * guard, and it is not enough on its own: the Set could stay exactly as it is
 * while `firstSegment`, the host check, or the R-3 branch changes underneath it,
 * and the parse would still be green. So this file RUNS the function.
 *
 * Deno rather than `node --test` because `+native-intent.tsx` is TypeScript with
 * a `.tsx` extension (no JSX in it), which Node's type-stripping will not load.
 *
 * The last case is the non-vacuity control: a route the app really does serve
 * must come back UNCHANGED, or "everything goes home" would be trivially true
 * and this file would prove nothing.
 *
 * Run:  deno test --allow-read --no-check scripts/issue-2272/native-intent-unaffected.deno.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { redirectSystemPath } from "../../app-mobile/app/+native-intent.tsx";

const HOME = "/";

Deno.test("the four families #2272 now serves on the web still land on HOME in the app", () => {
  const urls = [
    "https://usemingla.com/orders/0a0870b0-c117-4707-bdf4-21fc64bebcab/chat",
    "https://usemingla.com/orders",
    "https://usemingla.com/chat/0a0870b0-c117-4707-bdf4-21fc64bebcab",
    "https://usemingla.com/chat",
    "https://usemingla.com/board/9F3KQ2",
    "https://usemingla.com/board",
    "https://usemingla.com/invite/ADA2026",
    "https://usemingla.com/invite",
  ];
  for (const url of urls) {
    assertEquals(
      redirectSystemPath({ path: url, initial: true }),
      HOME,
      `${url} no longer lands on home in the app. #2272 fixed the BROWSER case only; if the app grew a real screen for one of these, that is #2245 and this expectation must move there deliberately.`,
    );
  }
});

Deno.test("NON-VACUITY: a route the app really serves is still handed through untouched", () => {
  const real = "https://usemingla.com/e/alte-nights/rooftop-sessions?pid=bio_youtube";
  assertEquals(
    redirectSystemPath({ path: real, initial: true }),
    real,
    "a genuine deep link is now being sent to home too, so the assertion above is trivially true and proves nothing",
  );
});
