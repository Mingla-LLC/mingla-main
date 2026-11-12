/**
 * #4389 — the one way screens mount the Nigerian bank card
 * (BrandPaystackOnboardView). Native: the card itself, unchanged. Web
 * (LazyBrandPaystackOnboardView.web.tsx): the card loads in its own chunk when
 * it is shown, because four web chunks render it (setup F3, the web bank body,
 * the bank setup screen and Payments) and Metro would otherwise hoist it into
 * the eager web __common chunk. Do not import ./BrandPaystackOnboardView from a
 * screen.
 */
export { BrandPaystackOnboardView } from "./BrandPaystackOnboardView";
export type { BrandPaystackOnboardViewProps } from "./BrandPaystackOnboardView";
