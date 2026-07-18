/**
 * ORCH-1375 [`?next=` resume path] — T-16 / SC-5: `next` is an OPEN-REDIRECT
 * vector and `sanitizeNextRoute` is the one thing standing in front of it.
 *
 * These tests exercise the REAL shipped module. Every rejection case below is a
 * URL an attacker can put in an email; every one of them must resolve to `null`
 * (which every caller renders as "go home"), never an off-origin navigation.
 */

import {
  NEXT_ROUTE_ALLOWLIST,
  sanitizeNextRoute,
} from "../nextRoute";

describe("ORCH-1375 sanitizeNextRoute — T-16 open-redirect defence (SC-5)", () => {
  // ─── The attacks (SC-5 names these exact strings) ────────────────────────
  const ATTACKS: ReadonlyArray<[string, string]> = [
    ["protocol-relative (browser reads it as ABSOLUTE)", "//evil.com"],
    ["absolute https", "https://evil.com"],
    ["absolute http", "http://evil.com"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["backslash protocol-relative", "/\\evil.com"],
    ["encoded protocol-relative", "%2f%2fevil.com"],
    ["encoded protocol-relative, rooted", "/%2f%2fevil.com"],
    ["double-encoded protocol-relative", "/%252f%252fevil.com"],
    ["prefix confusion (segment-safety)", "/accept-brand-invitation-evil"],
    ["prefix confusion on scanner", "/accept-scanner-invitation-evil"],
    ["scheme after decode", "/%6a%61vascript:alert(1)"],
    ["off-allowlist relative path", "/brand/123/payments"],
    ["bare root", "/"],
    ["protocol-relative with credentials", "//user:pass@evil.com"],
    ["uppercase scheme", "HTTPS://evil.com"],
    ["mixed-case javascript scheme", "JaVaScRiPt:alert(1)"],
  ];

  it.each(ATTACKS)("REJECTS %s → null", (_label, attack) => {
    expect(sanitizeNextRoute(attack)).toBeNull();
  });

  it("REJECTS a 3000-char value (bounded surface)", () => {
    const long = `/accept-brand-invitation?token=${"a".repeat(3000)}`;
    expect(long.length).toBeGreaterThan(2048);
    expect(sanitizeNextRoute(long)).toBeNull();
  });

  it("REJECTS malformed percent-encoding rather than throwing", () => {
    expect(() => sanitizeNextRoute("/accept-brand-invitation?t=%E0%A4%A")).not.toThrow();
    expect(sanitizeNextRoute("/accept-brand-invitation?t=%E0%A4%A")).toBeNull();
  });

  // ─── Absence / wrong type ────────────────────────────────────────────────
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace only", "   "],
  ])("REJECTS %s → null", (_label, value) => {
    expect(sanitizeNextRoute(value as string | null | undefined)).toBeNull();
  });

  it("REJECTS an array (?next=a&next=b is not a single intent)", () => {
    expect(sanitizeNextRoute(["/accept-brand-invitation", "//evil.com"])).toBeNull();
  });

  // ─── The legitimate resume targets (must NOT be over-rejected) ───────────
  it("ACCEPTS the brand-invite resume target WITH its token, preserving encoding", () => {
    const next = "/accept-brand-invitation?token=abc123";
    expect(sanitizeNextRoute(next)).toBe(next);
  });

  it("ACCEPTS the scanner-invite resume target", () => {
    const next = "/accept-scanner-invitation?token=xyz789";
    expect(sanitizeNextRoute(next)).toBe(next);
  });

  it("ACCEPTS /rsvp/create (T-14 — the third writer)", () => {
    expect(sanitizeNextRoute("/rsvp/create")).toBe("/rsvp/create");
  });

  it("ACCEPTS /event/create (T-15 — the fourth writer)", () => {
    expect(sanitizeNextRoute("/event/create")).toBe("/event/create");
  });

  it("ACCEPTS the success sub-route (segment-safe prefix covers /…/success)", () => {
    expect(sanitizeNextRoute("/accept-brand-invitation/success?brand_id=1")).toBe(
      "/accept-brand-invitation/success?brand_id=1",
    );
  });

  it("PRESERVES a percent-encoded token verbatim (decoding it would corrupt the credential)", () => {
    const next = "/accept-brand-invitation?token=a%2Bb%3Dc";
    expect(sanitizeNextRoute(next)).toBe(next);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(sanitizeNextRoute("  /rsvp/create  ")).toBe("/rsvp/create");
  });

  // ─── The allowlist is the contract (I-PROPOSED-1375-NEXT-ALLOWLISTED) ────
  it("the allowlist contains EXACTLY the four known ?next= writers", () => {
    expect([...NEXT_ROUTE_ALLOWLIST].sort()).toEqual([
      "/accept-brand-invitation",
      "/accept-scanner-invitation",
      "/event/create",
      "/rsvp/create",
    ]);
  });

  it("NEVER returns an absolute URL for any input it accepts", () => {
    for (const base of NEXT_ROUTE_ALLOWLIST) {
      const out = sanitizeNextRoute(base);
      expect(out).not.toBeNull();
      expect(out?.startsWith("/")).toBe(true);
      expect(out?.startsWith("//")).toBe(false);
      expect(/^[a-z][a-z0-9+.-]*:/i.test(out ?? "")).toBe(false);
    }
  });
});
