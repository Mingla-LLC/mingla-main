/**
 * ORCH-0964 hot-fix (post-operator-smoke-test 2026-05-26):
 * Hex input commit-gate must reject partial input + accept full 7-char #RRGGBB
 * so the field doesn't silently destroy what the user types.
 *
 * Step 0.5 regression — fails-on-revert: if `normalizeColor` is ever changed
 * to commit on every keystroke (e.g., returning the trimmed text regardless
 * of validity, OR matching against `^#[0-9a-fA-F]{0,6}$`), these assertions
 * fail.
 */

import { describe, expect, test } from "@jest/globals";

import { normalizeHexColor as normalizeColor } from "../normalizeHexColor";

describe("ORCH-0964 hot-fix — hex input commit-gate", () => {
  test("returns null for null / undefined / empty / whitespace", () => {
    expect(normalizeColor(null)).toBeNull();
    expect(normalizeColor(undefined)).toBeNull();
    expect(normalizeColor("")).toBeNull();
    expect(normalizeColor("   ")).toBeNull();
  });

  test("returns null for partial hex (the bug operator hit on iPhone)", () => {
    // These are the keystrokes a user types as they enter #FF1493 char-by-char.
    // Each one must NOT commit (return null) so the on-keystroke commit handler
    // doesn't overwrite the user's in-progress draft with a normalized value.
    expect(normalizeColor("#")).toBeNull();
    expect(normalizeColor("#F")).toBeNull();
    expect(normalizeColor("#FF")).toBeNull();
    expect(normalizeColor("#FF1")).toBeNull();
    expect(normalizeColor("#FF14")).toBeNull();
    expect(normalizeColor("#FF149")).toBeNull();
  });

  test("returns trimmed hex when full 7-char #RRGGBB is reached", () => {
    expect(normalizeColor("#FF1493")).toBe("#FF1493");
    expect(normalizeColor("#ff1493")).toBe("#ff1493");
    expect(normalizeColor("#000000")).toBe("#000000");
    expect(normalizeColor("#ffffff")).toBe("#ffffff");
  });

  test("trims whitespace around the value", () => {
    expect(normalizeColor("  #FF1493  ")).toBe("#FF1493");
    expect(normalizeColor("\t#000000\n")).toBe("#000000");
  });

  test("rejects malformed hex (wrong length, missing #, non-hex chars)", () => {
    expect(normalizeColor("FF1493")).toBeNull(); // missing #
    expect(normalizeColor("#FF14")).toBeNull(); // too short
    expect(normalizeColor("#FF14930")).toBeNull(); // too long
    expect(normalizeColor("#ZZ1493")).toBeNull(); // non-hex char
    expect(normalizeColor("#FF 1493")).toBeNull(); // internal space
    expect(normalizeColor("not-a-hex")).toBeNull();
    expect(normalizeColor("rgb(255, 20, 147)")).toBeNull();
  });

  test("accepts mixed-case hex (frontend doesn't case-normalize; DB layer + render layer accept either)", () => {
    expect(normalizeColor("#Ff14a3")).toBe("#Ff14a3");
    expect(normalizeColor("#aBcDeF")).toBe("#aBcDeF");
  });
});
