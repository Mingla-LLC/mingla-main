/*
 * #2829 W3 (T-W3) — the Sites readability maths is a COPY of the offering
 * pages' contrast maths (site-contracts must stay dependency-free). This proves
 * the copy returns the same ratio as the original for 50 fixed pseudo-random
 * colour pairs, so the warnings an owner sees in Studio, in "Your look" and in
 * Ari agree with every other contrast number Mingla computes.
 */
import { describe, expect, test } from "@jest/globals";
import {
  contrastRatio as originalContrast,
  relativeLuminance as originalLuminance,
} from "../../../../packages/offering-rendering/themePalette";
import {
  contrastRatio as sitesContrast,
  relativeLuminance as sitesLuminance,
} from "../../../../packages/site-contracts/src/readability.ts";

// A fixed linear-congruential sequence: the same 50 pairs on every run.
function pairs(count: number): Array<[string, string]> {
  let state = 2829;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % 0x1000000;
  };
  const hex = () => `#${next().toString(16).padStart(6, "0")}`;
  return Array.from({ length: count }, () => [hex(), hex()]);
}

describe("#2829 readability parity with offering-rendering", () => {
  test("50 pairs give identical luminance and contrast", () => {
    const sample = pairs(50);
    expect(new Set(sample.map(([a, b]) => a + b)).size).toBe(50);
    for (const [a, b] of sample) {
      expect(sitesLuminance(a)).toBe(originalLuminance(a));
      expect(sitesContrast(a, b)).toBe(originalContrast(a, b));
    }
  });
});
