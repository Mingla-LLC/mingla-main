/**
 * issue #4522 W-11 — the trip checkout details step's Continue must not sit
 * inside another button (React: "<button> cannot contain a nested <button>").
 * The hint tap for a disabled Continue is an overlay sibling of the Button.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import path from "path";

const src = readFileSync(path.join(__dirname, "..", "buyer.tsx"), "utf-8");

describe("trip checkout details step — Continue", () => {
  test("no Pressable wraps the Continue Button", () => {
    const at = src.indexOf("<Button\n            label={continueLabel}");
    expect(at).toBeGreaterThan(-1);
    const before = src.slice(Math.max(0, at - 400), at);
    expect(before).not.toMatch(/<Pressable[\s\S]*$/);
  });
  test("a disabled Continue still answers a tap (consent hint) via an overlay sibling", () => {
    const at = src.indexOf('testID="checkout-trip-continue-disabled-hint"');
    expect(at).toBeGreaterThan(-1);
    const overlay = src.slice(src.lastIndexOf("<Pressable", at), at);
    expect(overlay).toContain("onPress={showConsentHint}");
    expect(overlay).toContain("StyleSheet.absoluteFill");
    expect(src).toMatch(/\{continueDisabled \? \(\s*<Pressable/);
  });
});
