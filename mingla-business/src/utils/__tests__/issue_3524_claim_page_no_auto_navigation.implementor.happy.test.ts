/**
 * issue #3524 — THE EMAIL'S LANDING PAGE STOPS DEAD-ENDING.
 *
 * WHAT WAS BROKEN, exactly. `/attendance/claim` fired
 * `window.open("com.mingla.app.v2://attendance-claim#…", "_blank", "noopener")`
 * from a `useEffect` ON MOUNT — outside any gesture. Every modern browser blocks
 * that, and on iOS Safari an unhandled scheme raises a blocking "the address is
 * invalid" alert. The guest saw a pop-up warning or a dead tab, and then a page
 * offering them a CHOICE of two app stores.
 *
 * WHAT THIS FILE ASSERTS. The source itself, not a render: the
 * `Platform.OS`-class bug this route family keeps producing is invisible to a
 * native-mode render harness, which is exactly how it survived review the first
 * time (#2217's own test file says so).
 *
 *   - nothing navigates outside a tap,
 *   - `Linking.openURL` appears nowhere — every navigation goes through
 *     mingla-business's single owner,
 *   - the desktop branch is LAZY, so the QR dependency never enters the
 *     business-web boot payload the budget gate measures,
 *   - the #871/#2979 fragment-scrub bootstrap is still there, untouched,
 *   - the deep-link validator takes the emailed token form and the scanned
 *     handoff form, and never a mixture of the two.
 *
 * FAILS-ON-REVERT. Restore `Linking.openURL`, restore the mount-time
 * auto-attempt, make the desktop sheet a static import, or widen the fragment
 * validator, and a NAMED assertion below goes red.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

import {
  ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP,
  attendanceAppUrlFromFragment,
} from "../attendanceClaimDeepLink";

const claimSource = readFileSync(
  join(__dirname, "..", "..", "..", "app", "attendance", "claim.tsx"),
  "utf8",
);

/**
 * The SOURCE WITH ITS COMMENTS REMOVED.
 *
 * This file's whole subject is a docblock that describes, in detail, the
 * `Linking.openURL("com.mingla.app.v2://…")` call that was deleted. A naive
 * `not.toContain("Linking.openURL")` reads that prose and fails — the audit
 * regex matching a comment in the same file, which is a known way to get a
 * test that is red for a reason nobody intended. Assertions about what the CODE
 * does are made against this; assertions about what the page SAYS are made
 * against the raw source, where the copy actually lives.
 */
const claimCode = claimSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const TOKEN = "A".repeat(43);
const CODE = "B".repeat(43);

describe("issue #3524 the claim page never navigates on its own", () => {
  test("the mount-time auto-attempt is gone", () => {
    // The old effect opened the app scheme with no user gesture in sight.
    // NOTE the assertions are against `claimCode`: the file's own docblock
    // quotes the deleted `window.open(…, "_blank", "noopener")` call verbatim,
    // and reading that prose as evidence of the bug is the audit-regex-matches-
    // its-own-comment trap.
    expect(claimCode).not.toContain("window.open");
    expect(claimCode).not.toMatch(/noopener/);
    // The scheme is reached only from a named tap handler, never from an effect.
    const body = claimCode.slice(claimCode.indexOf("export default"));
    const schemeCallIndex = body.indexOf("openAppScheme(");
    expect(schemeCallIndex).toBeGreaterThan(-1);
    const enclosing = body.slice(0, schemeCallIndex);
    expect(enclosing).toMatch(/navigateFromTap|onPress|const open/);
    // …and no effect in the file opens anything.
    for (const effect of claimCode.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?\n  \}/g) ?? []) {
      expect(effect).not.toContain("openAppScheme(");
      expect(effect).not.toContain("openExternal(");
      expect(effect).not.toContain("openAttendanceClaimWithFallback(");
    }
  });

  test("Linking.openURL appears nowhere — there is one owner of navigation", () => {
    expect(claimCode).not.toContain("Linking.openURL");
    expect(claimCode).not.toMatch(/from\s+["']expo-linking["']/);
    expect(claimCode).not.toMatch(/\bLinking\b/);
    expect(claimCode).toContain("openExternal");
    expect(claimCode).toContain("openAppScheme");
  });

  test("the desktop sheet is lazy, so the QR never enters the boot payload", () => {
    expect(claimCode).toContain("React.lazy(");
    expect(claimCode).toContain("ContinueOnPhoneSheet");
    // A static import of the sheet would drag react-qr-code into the eager
    // chunk and fail the business-web boot-payload budget.
    expect(claimCode).not.toMatch(
      /^import\s+ContinueOnPhoneSheet\s+from/m,
    );
    expect(claimCode).toContain("Suspense");
  });

  test("both phone branches say which platform was detected and offer the other", () => {
    // Detection is a guess, and a wrong guess has to be recoverable. These are
    // also the visible marker the post-deploy grep looks for, so the bytes
    // matter: the apostrophe is typographic.
    expect(claimSource).toContain("Looks like you’re on iPhone.");
    expect(claimSource).toContain("Looks like you’re on Android.");
    expect(claimSource).toContain("On Android instead?");
    expect(claimSource).toContain("On iPhone instead?");
  });

  test("the platform is resolved from the BROWSER, never from Platform.OS", () => {
    // react-native-web reports Platform.OS === 'web' for an iPhone and an
    // Android alike, which is the #2217 defect. This page must not repeat it.
    expect(claimCode).toContain("detectClientPlatform");
    expect(claimCode).not.toMatch(/Platform\.OS\s*===\s*["'](ios|android)["']/);
  });

  test("the #871/#2979 fragment-scrub bootstrap is untouched", () => {
    // The page still consumes and scrubs the fragment exactly as before…
    expect(claimCode).toContain("consumeAttendanceClaimFragment");
    expect(claimCode).toContain("createAttendanceClaimFragmentScrubber");
    // …and the bootstrap it pairs with is still exported, still inert, and
    // still writes the fragment nowhere a later reader could find it.
    expect(typeof ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP).toBe("string");
    expect(ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP.length).toBeGreaterThan(0);
    for (const sink of ["localStorage", "sessionStorage", "document.cookie", "fetch("]) {
      expect(ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP).not.toContain(sink);
    }
  });

  test("#2211's scroll container survives", () => {
    expect(claimCode).toMatch(/flexGrow:\s*1/);
  });
});

describe("issue #3524 one validator, two credential shapes, never a mixture", () => {
  const frag = (parts: Record<string, string>): string =>
    new URLSearchParams(parts).toString();

  test("the emailed token form still resolves to the app URL", () => {
    const url = attendanceAppUrlFromFragment(
      frag({ v: "1", kind: "order", event: UUID_A, source: UUID_B, token: TOKEN }),
    );
    expect(url).toBe(
      `com.mingla.app.v2://attendance-claim#v=1&kind=order&event=${UUID_A}&source=${UUID_B}&token=${TOKEN}`,
    );
  });

  test("the scanned handoff form resolves too, carrying hc and not token", () => {
    const url = attendanceAppUrlFromFragment(
      frag({ v: "1", kind: "order", event: UUID_A, source: UUID_B, hc: CODE }),
    );
    expect(url).toBe(
      `com.mingla.app.v2://attendance-claim#v=1&kind=order&event=${UUID_A}&source=${UUID_B}&hc=${CODE}`,
    );
    expect(url).not.toContain("token=");
  });

  test("the exhaustive key-set validation stays exhaustive", () => {
    // Both credentials at once — the shape that would let a caller choose which
    // rule applies.
    expect(
      attendanceAppUrlFromFragment(
        frag({ v: "1", kind: "order", event: UUID_A, source: UUID_B, token: TOKEN, hc: CODE }),
      ),
    ).toBeNull();
    // Neither.
    expect(
      attendanceAppUrlFromFragment(frag({ v: "1", kind: "order", event: UUID_A, source: UUID_B })),
    ).toBeNull();
    // A stranger key.
    expect(
      attendanceAppUrlFromFragment(
        frag({ v: "1", kind: "order", event: UUID_A, source: UUID_B, token: TOKEN, x: "1" }),
      ),
    ).toBeNull();
    // A handoff code of the wrong length.
    expect(
      attendanceAppUrlFromFragment(
        frag({ v: "1", kind: "order", event: UUID_A, source: UUID_B, hc: "B".repeat(42) }),
      ),
    ).toBeNull();
    // A malformed identifier.
    expect(
      attendanceAppUrlFromFragment(
        frag({ v: "1", kind: "order", event: "nope", source: UUID_B, hc: CODE }),
      ),
    ).toBeNull();
    // A duplicated key.
    expect(
      attendanceAppUrlFromFragment(
        `v=1&kind=order&event=${UUID_A}&source=${UUID_B}&hc=${CODE}&hc=${CODE}`,
      ),
    ).toBeNull();
  });
});
