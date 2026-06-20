/**
 * [TEST-MOD-APPROVED ORCH-1165]
 *
 * ORCH-1165 — keyboard Done-bar MOUNT-COVERAGE + KEYED-OFFSET adversarial test
 * (tester-authored; a DIFFERENT angle than the implementor's clearance test,
 *  which only asserts DEFAULT_BOTTOM_OFFSET >= 42 and showArrows={false}).
 *
 * This test attacks two contracts the implementor's happy-path test does NOT:
 *
 *  (A) MOUNT COVERAGE (SC-1 + SC-4). The Done bar can only reach a focused
 *      field if a <KeyboardToolbarRoot/> is rendered in the SAME native window.
 *      The spec requires THREE distinct mount sites because native <Modal>
 *      hosts render in a separate window unreachable by the root toolbar:
 *        1. app/_layout.tsx        — root window (all normal screens)
 *        2. SheetMobile.tsx        — sheet's own native Modal window (SC-4 sheet)
 *        3. ui/Modal.tsx           — Modal's own native window (SC-4 CancelOrderDialog)
 *      If ANY of these three loses its mount, sheet/modal inputs silently get
 *      no Done bar — a regression invisible to the clearance test. We assert
 *      each host file (a) imports KeyboardToolbarRoot and (b) renders it.
 *
 *  (B) KEYED-ON-KEYBOARD-OPEN OFFSET (SC-3, not unconditional). The +42pt the
 *      at-risk surfaces add MUST be gated on the keyboard being open. If the
 *      +42 were applied unconditionally it would leave a permanent dead 42pt
 *      gap at the bottom of those surfaces even with no keyboard — a UX
 *      regression. We assert the +42 appears INSIDE a `> 0 ?` ternary for the
 *      three numeric-padding surfaces, and that the two chat composers lift
 *      with keyboardVerticalOffset={42} (not 0).
 *
 * Source-text approach (mirrors the implementor's clearance test + the
 * KeyboardRoot.test.tsx pattern) so no RN native runtime is needed.
 *
 * Fails-on-revert: removing any of the three mounts, or changing any keyed
 * `> 0 ? ... + 42` back to an unconditional/zero offset, makes this FAIL.
 */

import fs from "node:fs";
import path from "node:path";

const BIZ_ROOT = path.resolve(__dirname, "..", "..", "..");

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(BIZ_ROOT, relativePath), "utf8");

describe("ORCH-1165 Done-bar mount coverage + keyed offsets (adversarial)", () => {
  // ---- (A) MOUNT COVERAGE — all three host windows ----
  const HOSTS: ReadonlyArray<{ label: string; rel: string }> = [
    { label: "app root", rel: "app/_layout.tsx" },
    { label: "Sheet native host", rel: "src/components/ui/SheetMobile.tsx" },
    { label: "Modal native host", rel: "src/components/ui/Modal.tsx" },
  ];

  it.each(HOSTS)(
    "$label imports AND renders <KeyboardToolbarRoot/> (its own native window)",
    ({ rel }) => {
      const src = read(rel);

      // (a) imports the wrapper
      expect(src).toMatch(
        /import\s*\{\s*KeyboardToolbarRoot\s*\}\s*from\s*["'][^"']*KeyboardToolbarRoot["']/,
      );

      // (b) actually renders it as JSX — strip the import line first so the
      //     import alone cannot satisfy the render assertion.
      const withoutImports = src
        .split("\n")
        .filter((l) => !/^\s*import\b/.test(l))
        .join("\n");
      expect(withoutImports).toMatch(/<KeyboardToolbarRoot\s*\/?>/);
    },
  );

  // ---- (B) KEYED-ON-KEYBOARD-OPEN +42 OFFSETS (not unconditional) ----

  it("BusinessWelcomeScreen adds +42 only when keyboardPad > 0", () => {
    const src = read("src/components/auth/BusinessWelcomeScreen.tsx");
    // +42 must live inside a keyboard-open ternary, never unconditional.
    expect(src).toMatch(/keyboardPad\s*>\s*0\s*\?\s*keyboardPad\s*\+\s*42\s*:/);
  });

  it("JoinWaitlistSheet adds +42 only when keyboardPadding > 0", () => {
    const src = read("src/components/waitlist/JoinWaitlistSheet.tsx");
    expect(src).toMatch(/keyboardPadding\s*>\s*0\s*\?\s*42\s*:/);
  });

  it("ComposerV2Editor adds +42 to the keyboard-height term only when keyboard up", () => {
    const src = read(
      "src/components/marketing/ComposerV2/ComposerV2Editor.tsx",
    );
    expect(src).toMatch(/keyboardHeight\s*>\s*0\s*\?\s*keyboardHeight\s*\+\s*42\s*:/);
  });

  it.each([
    "src/components/groupChat/GroupChatPanel.tsx",
    "src/components/support/SupportThread.native.tsx",
  ])("%s lifts its composer with keyboardVerticalOffset={42}", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/keyboardVerticalOffset\s*=\s*\{\s*42\s*\}/);
    // And must NOT have left the old =0 lift (would put composer under the bar).
    expect(src).not.toMatch(/keyboardVerticalOffset\s*=\s*\{\s*0\s*\}/);
  });

  // ---- (C) AMENDMENT REWORK: the 9 newly-found at-risk surfaces ----
  // SPEC_AMENDMENT_ORCH-1165_AT_RISK_COMPLETE.md A2 rows 1–9 (the DEFECT +
  // 8 NEW-REWORK). Each must add the +42 (or keyboardVerticalOffset={42})
  // KEYED ON KEYBOARD-OPEN — never a permanent dead gap, never the web/closed
  // branch. Source-regex assertions; fails-on-revert by line-deletion.

  it("Ari composer adds +42 to the keyboard-open paddingBottom term only", () => {
    const src = read("src/screens/ari/AriChatScreen.tsx");
    // keyboard-open branch: keyboardHeight + spacing.sm + 42
    expect(src).toMatch(
      /keyboardHeight\s*>\s*0[\s\S]*?\?\s*keyboardHeight\s*\+\s*spacing\.sm\s*\+\s*42/,
    );
    // web branch must NOT get +42 (no accessory bar on web).
    expect(src).not.toMatch(/===\s*["']web["']\s*\?\s*spacing\.sm\s*\+\s*42/);
  });

  // The five identical "keyboardHeight + 140" checkout scrollviews (event
  // buyer/payment, trip buyer, experience buyer/payment) → + 140 + 42,
  // strictly inside the `keyboardHeight > 0 ?` ternary.
  it.each([
    "app/checkout/[eventId]/buyer.tsx",
    "app/checkout/[eventId]/payment.tsx",
    "app/checkout-trip/[tripEventId]/buyer.tsx",
    "app/checkout-experience/[experienceEventId]/buyer.tsx",
    "app/checkout-experience/[experienceEventId]/payment.tsx",
  ])("%s adds +42 only inside the keyboardHeight > 0 padding branch", (rel) => {
    const src = read(rel);
    expect(src).toMatch(
      /keyboardHeight\s*>\s*0\s*\?\s*\{\s*paddingBottom:\s*keyboardHeight\s*\+\s*140\s*\+\s*42\s*\}\s*:\s*null/,
    );
    // The keyboard-CLOSED static padding must stay 140 (no permanent +42 gap).
    expect(src).toMatch(/paddingBottom:\s*insets\.bottom\s*\+\s*140\s*\}/);
  });

  it("trip checkout intake (tight spacing.xl) adds +42 only when keyboard open", () => {
    const src = read("app/checkout-trip/[tripEventId]/intake.tsx");
    expect(src).toMatch(
      /keyboardHeight\s*>\s*0[\s\S]*?\?\s*\{\s*paddingBottom:\s*keyboardHeight\s*\+\s*spacing\.xl\s*\+\s*42\s*\}/,
    );
    // keyboard-closed branch must stay insets.bottom + 120 (no +42 dead gap).
    expect(src).toMatch(/:\s*\{\s*paddingBottom:\s*insets\.bottom\s*\+\s*120\s*\}/);
  });

  it("trip checkout payment (plan-aware) adds +42 only when keyboard open", () => {
    const src = read("app/checkout-trip/[tripEventId]/payment.tsx");
    expect(src).toMatch(
      /keyboardHeight\s*>\s*0[\s\S]*?\?\s*\{\s*paddingBottom:\s*keyboardHeight\s*\+\s*\(isPlanActive\s*\?\s*260\s*:\s*140\)\s*\+\s*42\s*\}/,
    );
    // keyboard-closed static padding must NOT carry the +42.
    expect(src).toMatch(
      /paddingBottom:\s*insets\.bottom\s*\+\s*\(isPlanActive\s*\?\s*260\s*:\s*140\)\s*\}/,
    );
  });

  it("BrandPaystackOnboardView bank-picker KAV lifts with keyboardVerticalOffset={42}", () => {
    const src = read("src/components/brand/BrandPaystackOnboardView.tsx");
    expect(src).toMatch(/keyboardVerticalOffset\s*=\s*\{\s*42\s*\}/);
    expect(src).not.toMatch(/keyboardVerticalOffset\s*=\s*\{\s*0\s*\}/);
  });
});
