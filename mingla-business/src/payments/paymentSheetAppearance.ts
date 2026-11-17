/**
 * #4420 D-C2c — the native PaymentSheet wears the host's colours, like the
 * checkout steps around it (checkoutTheme): the host's first colour as the
 * primary (text accents never take the gradient, #1023), the page as the
 * background, an opaque field fill (Stripe's native colours are hex only, so
 * the translucent card is composited the way the Stay Payment Element does),
 * 12pt fields and a pill button.
 *
 * Pure: no Stripe import, so it is testable in node. With no host palette
 * (Graphite) it returns undefined and PaymentSheet keeps its own look.
 */
import type { ThemePalette } from "@mingla/offering-rendering";
import {
  paymentFieldBackground,
  statusOn,
  themeTextAccent,
} from "@mingla/offering-rendering/themePalette";

export interface PaymentSheetAppearance {
  colors: {
    primary: string;
    background: string;
    componentBackground: string;
    primaryText: string;
    error: string;
  };
  shapes: { borderRadius: number };
  primaryButton: { shapes: { borderRadius: number } };
}

export function paymentSheetAppearanceFor(
  palette: ThemePalette | null,
): PaymentSheetAppearance | undefined {
  if (palette === null) return undefined;
  return {
    colors: {
      primary: themeTextAccent(palette),
      background: palette.page,
      componentBackground: paymentFieldBackground(palette),
      primaryText: palette.primaryText,
      error: statusOn(palette).error.text,
    },
    shapes: { borderRadius: 12 },
    primaryButton: { shapes: { borderRadius: 999 } },
  };
}
