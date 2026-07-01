/**
 * ORCH-1248 (Apple 2.1a) — "Meet Ari" disclosure MUST be dismissible via every
 * redundant escape route so it can never trap the reviewer:
 *   1. <Modal onRequestClose={onAccept}> — hardware back / system gesture.
 *   2. A full-bleed backdrop Pressable behind the sheet → onAccept.
 *   3. An always-visible close (X) button → onAccept.
 *   4. The primary CTA → onAccept.
 * AND the visual blur surface must be a pointerEvents="none" BACKGROUND sibling
 * (never in the touch path of the X / CTA — the iOS-26 tap-swallow hazard).
 *
 * Source assertions — reverting any escape route makes this FAIL (fails-on-revert).
 */
import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "AiDisclosureModal.tsx"),
  "utf8",
);

describe("AiDisclosureModal escape routes (ORCH-1248 Apple 2.1a)", () => {
  test("Modal has onRequestClose wired to onAccept (back/gesture dismiss)", () => {
    expect(SOURCE).toMatch(/onRequestClose=\{onAccept\}/);
  });

  test("full-bleed backdrop Pressable dismisses via onAccept", () => {
    // A Pressable spanning StyleSheet.absoluteFill wired to onAccept.
    expect(SOURCE).toMatch(/style=\{StyleSheet\.absoluteFill\}/);
    // Backdrop + X + CTA → at least three onPress={onAccept} hooks exist.
    const onAcceptPresses = SOURCE.match(/onPress=\{onAccept\}/g) ?? [];
    expect(onAcceptPresses.length).toBeGreaterThanOrEqual(3);
  });

  test("always-visible close (X) button exists, labelled Close, wired to onAccept", () => {
    expect(SOURCE).toContain('accessibilityLabel="Close"');
    expect(SOURCE).toMatch(/closeButton/);
    expect(SOURCE).toMatch(/closeGlyph/);
  });

  test("blur/opaque surface is a pointerEvents=none background sibling (not in touch path)", () => {
    // The visual surface component renders pointerEvents="none".
    expect(SOURCE).toMatch(/SheetBackdropSurface/);
    expect(SOURCE).toMatch(/pointerEvents="none"[\s\S]*?BlurView|BlurView[\s\S]*?pointerEvents="none"/);
    // The old pattern (interactive content nested INSIDE <BlurView>...children) is gone.
    expect(SOURCE).not.toMatch(/BlurViewOrOpaque/);
  });
});
