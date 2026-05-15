/**
 * ORCH-0823 regression test — every Input variant must declare both
 * autoCorrect and autoCapitalize explicitly. No variant may inherit
 * React Native's iOS defaults (autoCorrect=true, autoCapitalize="sentences"),
 * which produce two distinct space-erasure bugs:
 *   - Path B: autocorrect near-miss substitutions ("Big P" → "Bigot")
 *   - Path A: autoCapitalize="sentences" + hardware capslock erases
 *     trailing space (proven via patched-build QA on 2026-05-13).
 *
 * Policy enforced here:
 *   - Every variant MUST declare autoCorrect (boolean) AND autoCapitalize.
 *   - autoCorrect MUST be false on every variant (no near-miss substitutions
 *     anywhere in mingla-business).
 *   - autoCapitalize MUST NOT be "sentences" on any variant (Path A
 *     mitigation). Valid values: "none" | "words" | "characters".
 *
 * If this test fails, DO NOT weaken it. Update the VARIANT_BEHAVIOUR entry
 * in src/components/ui/Input.variants.ts to satisfy the policy.
 */

import { describe, expect, test } from "@jest/globals";

// Import from Input.variants directly (pure-data sibling — no JSX, no
// React Native runtime imports beyond a `type` reference). Node test env
// cannot transform JSX, so importing from Input.tsx would fail.
import { VARIANT_BEHAVIOUR } from "../Input.variants";

const EXPECTED_VARIANTS = [
  "text",
  "email",
  "phone",
  "number",
  "password",
  "search",
] as const;

// ORCH-0823 v2 policy: "sentences" is banned (Path A capslock interaction).
const VALID_AUTOCAPITALIZE = new Set([
  "none",
  "words",
  "characters",
]);

describe("Input VARIANT_BEHAVIOUR — ORCH-0823 regression", () => {
  EXPECTED_VARIANTS.forEach((variant) => {
    describe(`variant: ${variant}`, () => {
      const behaviour = VARIANT_BEHAVIOUR[variant];

      test("entry exists", () => {
        expect(behaviour).toBeDefined();
      });

      test("declares autoCorrect explicitly", () => {
        expect(Object.prototype.hasOwnProperty.call(behaviour, "autoCorrect")).toBe(true);
        expect(typeof behaviour.autoCorrect).toBe("boolean");
      });

      test("declares autoCapitalize explicitly", () => {
        expect(Object.prototype.hasOwnProperty.call(behaviour, "autoCapitalize")).toBe(true);
        expect(VALID_AUTOCAPITALIZE.has(behaviour.autoCapitalize as string)).toBe(true);
      });

      test("autoCorrect is false (Mingla policy — no near-miss substitutions)", () => {
        expect(behaviour.autoCorrect).toBe(false);
      });

      test('autoCapitalize is NOT "sentences" (ORCH-0823 v2 — capslock collision)', () => {
        expect(behaviour.autoCapitalize).not.toBe("sentences");
      });
    });
  });
});
