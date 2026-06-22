/**
 * ORCH-1220 [business-reviewer-bypass] — implementor defense-in-depth test for
 * the AuthContext reviewer-routing branch.
 *
 * The CI-ENFORCED regression guard is the strict-grep gate
 * `.github/scripts/strict-grep/orch-1220-reviewer-bypass-locked.mjs` (wired into
 * strict-grep-mingla-business.yml). Business jest is NOT a blocking CI job, so
 * this test is a SECONDARY layer, not the protection of record.
 *
 * Runner: mingla-business/jest.config.cjs (node + ts-jest, NO RTL — same
 * constraint the ORCH-1204 AuthContext tests document). We do NOT mount React;
 * we pin the exact production-source statements that implement the bypass so a
 * revert (removing the email constant, the send-code skip, or the verify-path
 * routing) goes RED here in addition to failing the CI gate.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, it } from "@jest/globals";

const AUTH_CONTEXT_SOURCE = readFileSync(
  path.resolve(__dirname, "..", "AuthContext.tsx"),
  "utf8",
);

describe("ORCH-1220 reviewer bypass — AuthContext routing", () => {
  it("defines the reviewer email constant exactly as the locked address", () => {
    expect(AUTH_CONTEXT_SOURCE).toMatch(
      /const\s+REVIEWER_EMAIL\s*=\s*["']appreview@usemingla\.com["']/,
    );
  });

  it("only routes the reviewer email to the function (single REVIEWER_EMAIL literal)", () => {
    const defs = AUTH_CONTEXT_SOURCE.match(
      /REVIEWER_EMAIL\s*=\s*["'][^"']+["']/g,
    );
    expect(defs).not.toBeNull();
    expect(defs).toHaveLength(1);
    // The only reviewer literal that exists is the locked address.
    expect(defs?.[0]).toContain("appreview@usemingla.com");
  });

  it("invokes the reviewer-signin edge function in the verify path", () => {
    expect(AUTH_CONTEXT_SOURCE).toMatch(
      /functions\.invoke\(\s*["']reviewer-signin["']/,
    );
  });

  it("gates the reviewer-signin invoke behind the reviewer-email check", () => {
    const guardIdx = AUTH_CONTEXT_SOURCE.search(/isReviewerEmail\s*\(/);
    const invokeIdx = AUTH_CONTEXT_SOURCE.search(
      /functions\.invoke\(\s*["']reviewer-signin["']/,
    );
    expect(guardIdx).toBeGreaterThan(-1);
    expect(invokeIdx).toBeGreaterThan(-1);
    // The reviewer-email guard must appear BEFORE the invoke in source order.
    expect(guardIdx).toBeLessThan(invokeIdx);
  });

  it("sets the session from the function-returned tokens on success", () => {
    // setSession with access_token + refresh_token must follow the invoke.
    expect(AUTH_CONTEXT_SOURCE).toMatch(/setSession\(\s*\{/);
    expect(AUTH_CONTEXT_SOURCE).toMatch(/access_token:\s*accessToken/);
    expect(AUTH_CONTEXT_SOURCE).toMatch(/refresh_token:\s*refreshToken/);
  });

  it("skips the real signInWithOtp send for the reviewer email (no stray email)", () => {
    // The send-code path must short-circuit for the reviewer BEFORE signInWithOtp.
    const skipIdx = AUTH_CONTEXT_SOURCE.search(
      /if\s*\(\s*isReviewerEmail\(\s*trimmed\s*\)\s*\)\s*\{[\s\S]*?return\s*\{\s*error:\s*null/,
    );
    const otpSendIdx = AUTH_CONTEXT_SOURCE.search(
      /supabase\.auth\.signInWithOtp\(/,
    );
    expect(skipIdx).toBeGreaterThan(-1);
    expect(otpSendIdx).toBeGreaterThan(-1);
    // The reviewer skip-return must precede the real signInWithOtp call.
    expect(skipIdx).toBeLessThan(otpSendIdx);
  });

  it("surfaces a generic invalid-code error on bypass failure (no detail leak)", () => {
    // On function error / missing tokens the reviewer branch reuses the same
    // wrong-OTP copy, so a failed bypass is indistinguishable from a wrong code.
    expect(AUTH_CONTEXT_SOURCE).toContain(
      "That code didn't match or has expired. Try again.",
    );
  });
});
