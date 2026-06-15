/**
 * RT-2 — ORCH-1130 additive-palette-prop gate (ORCH-1138 B5).
 *
 * The ORCH-1130 payment components (TripPaymentChoice / TripCheckoutFlow) were
 * WRAPPED with an ADDITIVE optional `palette` prop. When ABSENT, they must
 * render BYTE-IDENTICAL to pre-1138 — protecting /checkout-trip/.../payment.tsx
 * and the wizard Step-5 caller, which pass NO palette. This gate proves the
 * additive contract structurally + at the override-resolution boundary.
 *
 * Cites I-PROPOSED-1138-ADDITIVE-PALETTE-PROP: a future change may NOT make
 * `palette` required without re-theming every consumer.
 *
 * fails-on-revert: (a) deleting the `if (palette === undefined) return {}`
 * early-out in paletteOverrides makes the no-palette path apply overrides →
 * T-RT2-EMPTY fails; (b) removing the `?` from `palette?:` (making it required)
 * → T-RT2-OPTIONAL fails; (c) adding `palette=` to the protected callers →
 * T-RT2-CALLERS fails. Owner: mingla-implementor.
 *
 * Source-string assertions (mirrors the existing PublicEventPage source tests):
 * these components import react-native at runtime, so they cannot be mounted
 * under the node/ts-jest config — the structural source is the gate.
 */

import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const read = (rel: string): string =>
  readFileSync(path.join(process.cwd(), rel), "utf8");

const paymentChoiceSrc = read("src/components/trip/TripPaymentChoice.tsx");
const checkoutFlowSrc = read("src/components/trip/TripCheckoutFlow.tsx");
const paymentRouteSrc = read("app/checkout-trip/[tripEventId]/payment.tsx");
const wizardStep5Src = read("src/components/trip/TripCreatorStep5Review.tsx");

describe("RT-2 ORCH-1138 — ORCH-1130 payment wrap is additive (byte-identical without palette)", () => {
  test("T-RT2-OPTIONAL: `palette` is OPTIONAL on both payment components", () => {
    expect(paymentChoiceSrc).toContain("palette?: ThemePalette");
    expect(checkoutFlowSrc).toContain("palette?: ThemePalette");
    // a future edit that makes it required (no `?`) would flip these.
    expect(paymentChoiceSrc).not.toContain("palette: ThemePalette;");
    expect(checkoutFlowSrc).not.toContain("palette: ThemePalette;");
  });

  test("T-RT2-EMPTY: paletteOverrides(undefined) early-returns an EMPTY override set", () => {
    // The no-palette branch must be the FIRST statement of paletteOverrides so a
    // caller with no palette applies ZERO theming (byte-identical).
    expect(paymentChoiceSrc).toContain(
      "if (palette === undefined) return {};",
    );
    // Every selected-state override is applied CONDITIONALLY (… ? ov.x : null),
    // so an empty override set means no style delta at all.
    expect(paymentChoiceSrc).toContain("isFull ? ov.selectedSegment : null");
    expect(paymentChoiceSrc).toContain(
      "isInstallments ? ov.selectedSegment : null",
    );
  });

  test("T-RT2-CALLERS: the protected callers pass NO palette (stay pre-1138)", () => {
    // payment.tsx renders TripPaymentChoice without a palette prop.
    const pcUsage =
      paymentRouteSrc.match(/<TripPaymentChoice[\s\S]*?\/>/)?.[0] ?? "";
    expect(pcUsage).not.toContain("palette");
    // wizard Step-5 renders TripPreview without a palette prop (LEGACY mode).
    const tpUsage = wizardStep5Src.match(/<TripPreview[\s\S]*?\/>/)?.[0] ?? "";
    expect(tpUsage).not.toContain("palette");
  });

  test("T-RT2-PASSTHROUGH: TripCheckoutFlow forwards palette to TripPaymentChoice", () => {
    expect(checkoutFlowSrc).toContain("palette={palette}");
  });
});
