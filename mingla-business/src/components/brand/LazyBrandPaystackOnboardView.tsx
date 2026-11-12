/**
 * #4389 — the one way screens mount the Nigerian bank card
 * (BrandPaystackOnboardView). Native: the card itself, rendered straight
 * through. Web (LazyBrandPaystackOnboardView.web.tsx): the card loads in its
 * own chunk when it is shown, because four web chunks render it (setup F3, the
 * web bank body, the bank setup screen and Payments) and Metro would otherwise
 * hoist it into the eager web __common chunk. Do not import
 * ./BrandPaystackOnboardView from a screen.
 *
 * It renders the card (rather than re-exporting it) so static reach checks,
 * such as the orch-0892 keyboard gate, still see the card's fields behind it.
 */
import React from "react";

import {
  BrandPaystackOnboardView as Card,
  type BrandPaystackOnboardViewProps,
} from "./BrandPaystackOnboardView";

export type { BrandPaystackOnboardViewProps } from "./BrandPaystackOnboardView";

export const BrandPaystackOnboardView: React.FC<BrandPaystackOnboardViewProps> = (props) => (
  <Card {...props} />
);
