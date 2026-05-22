/**
 * ORCH-0919 — adversarial: nav-stack-depth simulation proving the bug class.
 *
 * Attacks a different angle than the happy-path test (which is source-grep):
 * this test simulates a synthetic expo-router stack and proves the BUG SHAPE —
 * that `router.push(target)` from a sub-page produces a stack where one more
 * "back" tap lands on the SUB-PAGE, not the parent list. Then it proves the
 * FIX SHAPE — that `router.canGoBack() ? router.back() : router.replace(...)`
 * produces a stack where one more "back" tap lands on the LIST.
 *
 * Also asserts no other trip-related file in mingla-business/app reintroduces
 * the anti-pattern. If a future PR adds a new sub-page (e.g. /trip/[id]/blasts)
 * with the same buggy back wiring, T-A04 fires.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..");
const TRIP_ROUTE_DIR = join(REPO_ROOT, "mingla-business/app/trip");

type StackEntry = string;

function makeRouter(initialStack: StackEntry[]) {
  let stack = [...initialStack];
  return {
    get current() {
      return stack[stack.length - 1];
    },
    get depth() {
      return stack.length;
    },
    get stack() {
      return [...stack];
    },
    push(target: StackEntry) {
      stack.push(target);
    },
    back() {
      if (stack.length > 1) stack.pop();
    },
    replace(target: StackEntry) {
      stack[stack.length - 1] = target;
    },
    canGoBack() {
      return stack.length > 1;
    },
  };
}

function* walkTsx(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walkTsx(full);
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) yield full;
  }
}

describe("ORCH-0919 adversarial — nav stack simulation + repo-wide sweep", () => {
  test("T-A01 BUG SHAPE: router.push from sub-page back leaves user trapped — second back returns to sub-page", () => {
    // Simulate: trips-list → trip → money
    const router = makeRouter(["/(tabs)/trips", "/trip/abc", "/trip/abc/money"]);

    // BUGGY back: onBack={() => router.push(`/trip/${eventId}`)}
    router.push("/trip/abc");
    expect(router.current).toBe("/trip/abc");
    expect(router.depth).toBe(4);

    // User now hits back on the trip page (which correctly calls router.back())
    router.back();

    // BUG: lands on Money, not Trips
    expect(router.current).toBe("/trip/abc/money");
    expect(router.current).not.toBe("/(tabs)/trips");
  });

  test("T-A02 FIX SHAPE: canGoBack-guarded back from sub-page pops correctly — second back lands on Trips list", () => {
    const router = makeRouter(["/(tabs)/trips", "/trip/abc", "/trip/abc/money"]);

    // FIXED back: if (canGoBack) back() else replace(...)
    if (router.canGoBack()) router.back();
    else router.replace("/trip/abc");
    expect(router.current).toBe("/trip/abc");
    expect(router.depth).toBe(2);

    // User hits back on trip page
    router.back();

    // FIXED: lands on Trips list
    expect(router.current).toBe("/(tabs)/trips");
  });

  test("T-A03 FIX SHAPE edge: deep-link cold-start (no history) → replace fallback navigates correctly without pushing duplicate", () => {
    // Cold start via deep link directly into Money — no parent in stack
    const router = makeRouter(["/trip/abc/money"]);
    expect(router.canGoBack()).toBe(false);

    if (router.canGoBack()) router.back();
    else router.replace("/trip/abc");

    expect(router.current).toBe("/trip/abc");
    expect(router.depth).toBe(1);
  });

  test("T-A04 repo-wide sweep: no trip sub-page reintroduces onBack={() => router.push(`/trip/${eventId}`...) anti-pattern", () => {
    const offenders: { file: string; line: number; text: string }[] = [];
    const antiPattern = /onBack=\{\(\)\s*=>\s*router\.push\(`\/trip\/\$\{eventId\}/;

    for (const file of walkTsx(TRIP_ROUTE_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (antiPattern.test(line)) {
          offenders.push({ file: file.replace(REPO_ROOT + "/", ""), line: idx + 1, text: line.trim() });
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  test("T-A05 FIX SHAPE preserves backtracking through multiple sub-pages", () => {
    // trips → trip → travelers → trip → money
    const router = makeRouter([
      "/(tabs)/trips",
      "/trip/abc",
      "/trip/abc/travelers",
    ]);

    // Back from travelers (fixed)
    if (router.canGoBack()) router.back();
    expect(router.current).toBe("/trip/abc");

    // Navigate to money
    router.push("/trip/abc/money");
    expect(router.current).toBe("/trip/abc/money");

    // Back from money (fixed)
    if (router.canGoBack()) router.back();
    expect(router.current).toBe("/trip/abc");

    // Back from trip
    router.back();
    expect(router.current).toBe("/(tabs)/trips");
  });
});
