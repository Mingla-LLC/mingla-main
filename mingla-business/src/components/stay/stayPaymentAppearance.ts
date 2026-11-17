// issue #4420 wave 2 (D-S1) — the Stripe Payment Element follows the page:
// Stripe's "stripe" theme on a light page, "night" on a dark one, with the
// host's FIRST colour as the primary (text accents never take the gradient,
// #1023). The element takes one colour, so the caller hands in the same
// one-colour `accent` it already passes to the payment element. Same font and radius as the Connect pages (5313edba88).
//
// Pure: no React, no Stripe import, so it is testable in node.

import type { ThemePalette } from "@mingla/offering-rendering";
import {
  neutralControl,
  paletteIsDark,
  paymentFieldBackground,
  statusOn,
} from "@mingla/offering-rendering/themePalette";

export interface StayPaymentAppearance {
  theme: "stripe" | "night";
  variables: {
    colorPrimary: string;
    colorBackground: string;
    colorText: string;
    colorDanger: string;
    fontFamily: string;
    borderRadius: string;
    spacingUnit: string;
  };
  rules: Record<string, Record<string, string>>;
}

export const STAY_PAYMENT_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const stayPaymentAppearance = (
  palette: ThemePalette,
  primary: string,
): StayPaymentAppearance => {
  const dark = paletteIsDark(palette);
  return {
    theme: dark ? "night" : "stripe",
    variables: {
      colorPrimary: primary,
      colorBackground: paymentFieldBackground(palette),
      colorText: palette.primaryText,
      colorDanger: statusOn(palette).error.text,
      fontFamily: STAY_PAYMENT_FONT,
      borderRadius: "12px",
      spacingUnit: "4px",
    },
    rules: {
      ".Input": { boxShadow: `inset 0 0 0 1px ${neutralControl(palette)}` },
      ".Tab--selected": { boxShadow: `inset 0 0 0 2px ${primary}` },
    },
  };
};
