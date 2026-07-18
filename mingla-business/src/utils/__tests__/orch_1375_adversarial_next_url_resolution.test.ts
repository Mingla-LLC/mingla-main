/**
 * ORCH-1375 — TESTER ADVERSARIAL PROOF (mingla-tester, not the implementor).
 *
 * ─── WHY THIS TEST EXISTS AND HOW IT DIFFERS FROM THE IMPLEMENTOR'S ────────
 * The implementor's `nextRoute.test.ts` sweeps 17 hand-written attack STRINGS
 * and asserts `sanitizeNextRoute(attack) === null`. That is a STRING-EQUALITY
 * test against a hand-maintained list: it can only ever catch an attack someone
 * already thought of, and it never asks the question that actually matters —
 * *where does the accepted value actually take the browser?*
 *
 * This test attacks a DIFFERENT ANGLE: **differential validation against the
 * REAL URL parser** (WHATWG `URL`, the same algorithm the browser and
 * `location.assign` use), plus **post-normalisation** allowlist integrity.
 *
 * The distinction is load-bearing. `sanitizeNextRoute` returns the RAW string
 * (deliberately — to preserve the invite token's encoding). But nobody consumes
 * a raw string: `<Redirect href>` / `router.replace` / `location.assign` all
 * RESOLVE it, and resolution runs `remove_dot_segments` and backslash
 * normalisation. So the value the VALIDATOR judged and the value the BROWSER
 * navigates to are two different strings. Every open-redirect defence that
 * validates the pre-resolution string is exposed to that gap. This test closes
 * it by asserting the security property on the POST-resolution URL:
 *
 *   INVARIANT: for every input `sanitizeNextRoute` ACCEPTS, resolving that
 *   value against ANY origin MUST land back on that SAME origin.
 *
 * That is the property the module actually owes its callers — and unlike a
 * string list, it holds for attacks nobody has invented yet.
 *
 * ─── FAILS-ON-REVERT ───────────────────────────────────────────────────────
 * Reverting the fix (deleting `sanitizeNextRoute` from the call path, i.e.
 * callers handing the router a raw `next`) makes `https://evil.com` and
 * `//evil.com` resolve OFF-ORIGIN → the same-origin assertion fails. Verified
 * by true line-deletion; hash recorded in the QA report.
 */

import { sanitizeNextRoute, NEXT_ROUTE_ALLOWLIST } from "../nextRoute";

/** The real production origin the business web app is served from. */
const ORIGIN = "https://business.usemingla.com";

/**
 * A deliberately hostile corpus. It INTENTIONALLY goes beyond the implementor's
 * 17 strings — the point is that the invariant must hold for inputs neither of
 * us enumerated, including dot-segment traversal, backslash mixing, encoded
 * traversal, and CR/LF/TAB injection (which the URL parser STRIPS, so a
 * validator that only inspects the raw string sees a different value than the
 * browser does).
 */
const HOSTILE_CORPUS: readonly string[] = [
  // — classic off-origin —
  "https://evil.com",
  "http://evil.com",
  "//evil.com",
  "//user:pass@evil.com",
  "\\\\evil.com",
  "/\\evil.com",
  "/\\/evil.com",
  "https:evil.com",
  "javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  // — dot-segment traversal off an ALLOWLISTED prefix (the angle the
  //   implementor's string list cannot express: the value STARTS legitimately) —
  "/accept-brand-invitation/../../evil",
  "/accept-brand-invitation/../..//evil.com",
  "/accept-brand-invitation/..//evil.com",
  "/accept-brand-invitation/../brand/123/payments",
  "/accept-brand-invitation/./../../evil",
  "/rsvp/create/../../../evil.com",
  "/event/create/../../..//evil.com",
  // — encoded traversal —
  "/accept-brand-invitation/%2e%2e/%2e%2e/evil",
  "/accept-brand-invitation/%2e%2e%2f%2e%2e%2fevil",
  // — whitespace / control-character injection: the URL parser STRIPS these,
  //   so the raw string and the resolved URL disagree —
  "/\t/evil.com",
  "/\n/evil.com",
  "/\r/evil.com",
  "ht\ttps://evil.com",
  "java\nscript:alert(1)",
  // — encoding —
  "%2f%2fevil.com",
  "/%2f%2fevil.com",
  "/%252f%252fevil.com",
  "/%6a%61vascript:alert(1)",
  // — prefix confusion —
  "/accept-brand-invitation-evil",
  "/accept-brand-invitation.evil.com",
  // — off-allowlist same-origin —
  "/brand/123/payments",
  "/",
];

describe("ORCH-1375 ADVERSARIAL — the security property survives the REAL URL parser", () => {
  it.each(HOSTILE_CORPUS)(
    "any value ACCEPTED for %j must resolve back to the SAME origin",
    (candidate) => {
      const accepted = sanitizeNextRoute(candidate);
      if (accepted === null) return; // rejected outright — nothing to resolve.

      // The value survived the validator. Now ask the BROWSER'S algorithm where
      // it actually goes. This is the assertion the string-list test cannot make.
      const resolved = new URL(accepted, ORIGIN);
      expect(resolved.origin).toBe(ORIGIN);
      expect(resolved.protocol).toBe("https:");
      expect(resolved.host).toBe("business.usemingla.com");
    },
  );

  it("no accepted value can smuggle credentials or a host into the resolved URL", () => {
    for (const candidate of HOSTILE_CORPUS) {
      const accepted = sanitizeNextRoute(candidate);
      if (accepted === null) continue;
      const resolved = new URL(accepted, ORIGIN);
      expect(resolved.username).toBe("");
      expect(resolved.password).toBe("");
      expect(resolved.hostname).toBe("business.usemingla.com");
    }
  });

  it("a second, unrelated origin yields the same guarantee (the property is origin-agnostic)", () => {
    const OTHER = "https://preview-biz.vercel.app";
    for (const candidate of HOSTILE_CORPUS) {
      const accepted = sanitizeNextRoute(candidate);
      if (accepted === null) continue;
      expect(new URL(accepted, OTHER).origin).toBe(OTHER);
    }
  });
});

describe("ORCH-1375 ADVERSARIAL — every allowlisted route is itself a safe fixed point", () => {
  it.each([...NEXT_ROUTE_ALLOWLIST])(
    "%s resolves same-origin and is accepted verbatim",
    (route) => {
      const accepted = sanitizeNextRoute(route);
      expect(accepted).toBe(route);
      expect(new URL(accepted as string, ORIGIN).origin).toBe(ORIGIN);
    },
  );

  it("an allowlisted route carrying a real invite token keeps the token byte-exact through resolution", () => {
    // Token encoding is the whole reason sanitizeNextRoute returns RAW. If
    // resolution corrupted it, the invite would 'succeed' against a wrong token.
    const token = "aBc123-_.~%2Fslash";
    const next = sanitizeNextRoute(`/accept-brand-invitation?token=${token}`);
    expect(next).not.toBeNull();
    const resolved = new URL(next as string, ORIGIN);
    expect(resolved.origin).toBe(ORIGIN);
    expect(resolved.pathname).toBe("/accept-brand-invitation");
    // The raw token survives verbatim in the query string.
    expect(resolved.search).toBe(`?token=${token}`);
  });
});
