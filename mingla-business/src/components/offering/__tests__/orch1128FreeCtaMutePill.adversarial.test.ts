/**
 * ORCH-1128 [public offering-page polish] — TESTER ADVERSARIAL regression.
 *
 * Attacks a DIFFERENT ANGLE than the implementor happy-path test
 * (orch1128FreeCtaMutePill.test.ts), which asserts the `buttonFull` style
 * EXISTS and is APPLIED for the non-buy kinds, and that the mute `bottom`
 * equals the literal 22.
 *
 * This adversarial suite instead defends the INVARIANTS that a sloppy "fix"
 * would silently break while still passing the happy-path assertions:
 *
 *   A1 — PAID-BUY MUST NOT GO FULL-WIDTH. The full-width style must be gated
 *        STRICTLY behind `kind !== "buy"`. A regression that applies
 *        `buttonFull` unconditionally — or gates it on the wrong predicate
 *        (e.g. `=== "free"`, which silently drops the waitlist kind, or just
 *        always-on) — would still satisfy the implementor's "applied for
 *        non-buy" check but would collapse the paid price-left / button-right
 *        split. We pin the EXACT guard token and assert the price column is
 *        emitted ONLY on the `buy` branch.
 *
 *   A2 — THE EMPTY PLACEHOLDER COLUMN (the actual root cause) IS GONE. The
 *        non-buy branch must NOT re-introduce a sibling `<View priceCol />`
 *        that would steal half the row even if `buttonFull` were present.
 *
 *   A3 — MUTE PILL CLEARANCE IS A STRICT INCREASE OVER THE ORCH-1124 BASELINE
 *        (14), parsed NUMERICALLY (not a literal-22 string match), so a
 *        partial bump that still bleeds (e.g. 16) OR a silent revert to 14
 *        both FAIL — and the style block must remain a BOTTOM anchor with NO
 *        `top:` key (catching a topRight regression that the literal default
 *        string `audioControlPosition = "bottomRight"` check could miss if the
 *        bottomRight STYLE itself were corrupted to a top offset).
 *
 * Source-assertion style, matching the sibling ORCH-1117 / ORCH-1124 / 1128
 * source tests (Node harness, no react-test-renderer).
 *
 * fails-on-revert (verified by the tester via true line-deletion / value swap):
 *   A1  — change the apply guard to `cta.kind === "free"` or remove the guard  → fails.
 *   A2  — restore the `) : ( <View style={styles.priceCol} /> )` placeholder    → fails.
 *   A3  — restore `bottom: 14` (or any value <= 14) in audioControlBottomRight  → fails.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const businessBar = (): string =>
  readFileSync(path.resolve(__dirname, "../FloatingOfferingBar.tsx"), "utf8");

const nativeBar = (): string =>
  readFileSync(
    path.resolve(
      __dirname,
      "../../../../../app-mobile/src/components/offering/FloatingOfferingBar.tsx",
    ),
    "utf8",
  );

const coverMedia = (): string =>
  readFileSync(
    path.resolve(
      __dirname,
      "../../../../../packages/event-rendering/EventCoverMedia.tsx",
    ),
    "utf8",
  );

describe("ORCH-1128 adversarial A1 — paid 'buy' must keep its split (full-width gated off buy)", () => {
  const assertBuyNotFullWidth = (src: string): void => {
    // The full-width style is applied ONLY when the kind is NOT "buy".
    // A regression to `=== "free"` (drops waitlist) or an unconditional apply
    // must NOT slip through.
    expect(src).toMatch(/cta\.kind !== "buy" && styles\.buttonFull/);
    // It must NOT be gated on the narrower `=== "free"` predicate (that would
    // leave the waitlist CTA hugging the right of an empty row again).
    expect(src).not.toMatch(/cta\.kind === "free" && styles\.buttonFull/);
    // It must NOT be applied unconditionally (no bare `styles.buttonFull,` line
    // inside the Pressable style array without the kind guard on the same line).
    const guarded = (src.match(/styles\.buttonFull/g) ?? []).length;
    const withGuard = (src.match(/cta\.kind !== "buy" && styles\.buttonFull/g) ?? [])
      .length;
    expect(guarded).toBe(withGuard);
    // The paid price column is emitted ONLY on the buy branch.
    expect(src).toMatch(/cta\.kind === "buy" \?\s*\(?\s*<View style={styles\.priceCol}>/);
  };

  test("buyer-web bar keeps the paid price-left / button-right split", () => {
    assertBuyNotFullWidth(businessBar());
  });

  test("consumer-native bar keeps the paid price-left / button-right split", () => {
    assertBuyNotFullWidth(nativeBar());
  });
});

describe("ORCH-1128 adversarial A2 — the empty placeholder column is gone (root cause)", () => {
  const assertNoEmptyPlaceholder = (src: string): void => {
    // The non-buy branch must collapse to `null`, not an empty flex:1 column.
    expect(src).not.toMatch(
      /\) : \(\s*<View style={styles\.priceCol}\s*\/>\s*\)/,
    );
    // Belt-and-suspenders: there is no self-closing empty priceCol View anywhere.
    expect(src).not.toMatch(/<View style={styles\.priceCol}\s*\/>/);
  };

  test("buyer-web bar has no empty priceCol placeholder", () => {
    assertNoEmptyPlaceholder(businessBar());
  });

  test("consumer-native bar has no empty priceCol placeholder", () => {
    assertNoEmptyPlaceholder(nativeBar());
  });
});

describe("ORCH-1128 adversarial A3 — mute pill clears the seam by a strict margin, still bottom-anchored", () => {
  test("bottom offset is numerically > the ORCH-1124 baseline of 14, and no top: key", () => {
    const src = coverMedia();
    const idx = src.indexOf("audioControlBottomRight:");
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 400);
    // Numeric parse of the actual bottom value (not a literal-22 string match):
    const m = block.match(/bottom:\s*(\d+)/);
    expect(m).not.toBeNull();
    const bottom = Number(m?.[1]);
    // STRICT increase over the flush ORCH-1124 baseline — a partial bump that
    // still bleeds (<=14) fails just as a full revert to 14 does.
    expect(bottom).toBeGreaterThan(14);
    // The bottomRight style must remain a BOTTOM anchor: no `top:` key smuggled
    // in (which would silently turn it into a top-pinned pill — the exact
    // ORCH-1124 regression this position contract forbids).
    expect(block).not.toMatch(/top:\s*\d+/);
    // And the right anchor is preserved.
    expect(block).toMatch(/right:\s*14/);
  });

  test("the shared default position is bottomRight (no topRight regression)", () => {
    const src = coverMedia();
    expect(src).toContain('audioControlPosition = "bottomRight"');
    // The bottomRight style key is referenced by the position switch.
    expect(src).toMatch(
      /audioControlPosition === "bottomRight"\s*&&\s*\n?\s*styles\.audioControlBottomRight/,
    );
  });
});
