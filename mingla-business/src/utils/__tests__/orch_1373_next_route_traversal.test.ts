/**
 * ORCH-1373 [accept-invite-infinite-loader] — P2-1: dot-segment traversal
 * defeats the `next` allowlist.
 *
 * THE DEFECT (tester-proven, executed):
 *   REJECT  "/brand/123/payments"                            -> null
 *   ACCEPT  "/accept-brand-invitation/../brand/123/payments" -> returned verbatim
 *
 * `isAllowlistedPath` judges the PRE-RESOLUTION string; `remove_dot_segments`
 * (RFC 3986 §5.2.4) runs later in the router/URL parser. So the validator and
 * the browser saw different strings, and traversal walked through the allowlist
 * to the exact path the allowlist exists to refuse.
 *
 * ⚠️ HONEST SCOPE — this is NOT an open redirect, and this file does not claim
 * one. Every accepted value stays same-origin and scheme-less; the tester
 * confirmed that independently against the real WHATWG URL parser (39/39). What
 * is broken is the allowlist's STATED INTENT ("enumerate, don't generalise") —
 * a real defect on its own terms, and nothing more.
 *
 * Fails-on-revert: line-delete the two `hasDotSegment(...)` guards from
 * `nextRoute.ts` and every test in the first block FAILS.
 */

import { describe, expect, it } from "@jest/globals";

import { sanitizeNextRoute } from "../nextRoute";

describe("ORCH-1373 P2-1 — traversal can no longer defeat the allowlist", () => {
  it.each([
    // The headline: resolves to /brand/123/payments, which is REJECTED outright.
    "/accept-brand-invitation/../brand/123/payments",
    "/accept-brand-invitation/../../evil",
    "/rsvp/create/../../../evil.com",
    // Percent-encoded spelling — a browser resolves %2e%2e exactly like ..
    "/accept-brand-invitation/%2e%2e/%2e%2e/evil",
    // Case-insensitivity of the encoding.
    "/accept-brand-invitation/%2E%2E/evil",
    // Mixed literal + encoded.
    "/accept-brand-invitation/.%2e/evil",
    // Single-dot segments resolve away too.
    "/accept-brand-invitation/./../evil",
  ])("rejects traversal: %s", (candidate) => {
    expect(sanitizeNextRoute(candidate)).toBeNull();
  });

  it("PROOF OF EQUIVALENCE: the traversal target and its resolved form are now BOTH rejected", () => {
    // This pair is the whole bug in two lines: before the fix these disagreed.
    expect(sanitizeNextRoute("/brand/123/payments")).toBeNull();
    expect(
      sanitizeNextRoute("/accept-brand-invitation/../brand/123/payments"),
    ).toBeNull();
  });
});

describe("ORCH-1373 P2-1 — the other direction: legitimate resumes still work", () => {
  it.each([
    "/accept-brand-invitation",
    "/accept-brand-invitation/success",
    "/accept-scanner-invitation",
    "/rsvp/create",
    "/event/create",
  ])("still accepts the legitimate resume target %s", (candidate) => {
    expect(sanitizeNextRoute(candidate)).toBe(candidate);
  });

  it("a real invite token survives verbatim (the encoding must NOT be corrupted)", () => {
    const withToken = "/accept-brand-invitation?token=abc.def-123_XYZ%3D%3D";
    expect(sanitizeNextRoute(withToken)).toBe(withToken);
  });

  it("dots INSIDE a token (query string) are untouched — the guard is path-only", () => {
    // `hasDotSegment` runs on pathSegmentOf(), so a token full of dots is safe.
    const dotty = "/accept-brand-invitation?token=..%2e...&x=../..";
    expect(sanitizeNextRoute(dotty)).toBe(dotty);
  });

  it("a filename-ish dot in a path segment is NOT a dot-segment (no over-rejection)", () => {
    // ".." and "." are dot-segments; "a.b" is not. Over-rejecting here would
    // break legitimate sub-paths.
    expect(sanitizeNextRoute("/accept-brand-invitation/v1.2")).toBe(
      "/accept-brand-invitation/v1.2",
    );
  });

  it("double-encoded %252e%252e is NOT traversal and is judged on its merits", () => {
    // Survives one decode as the literal text "%2e%2e" — an ordinary segment to
    // a browser. The allowlist then judges the same string the router receives,
    // so there is no validator/router divergence. It is rejected here only
    // because it is not an allowlisted path shape, not by the dot guard.
    expect(sanitizeNextRoute("/%252e%252e/evil")).toBeNull();
  });
});

describe("ORCH-1373 P2-1 — the ORCH-1375 attack corpus still passes (no regression)", () => {
  it.each([
    "//evil.com",
    "/\\evil.com",
    "javascript:alert(1)",
    "data:text/html,x",
    "https://evil.example/phish",
    "/%2f%2fevil.com",
    "/accept-brand-invitation-evil",
  ])("still rejects the pre-existing attack %s", (candidate) => {
    expect(sanitizeNextRoute(candidate)).toBeNull();
  });
});
