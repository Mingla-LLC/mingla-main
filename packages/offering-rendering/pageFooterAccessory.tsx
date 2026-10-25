// #2331 — an optional host-provided accessory rendered at the END of every
// public offering page's content (ParallaxCoverShell). Business buyer web
// provides the "Your privacy choices" link here; hosts that provide nothing
// (consumer app, business native, brand sites) render byte-identically.
import React from "react";

export interface PageFooterAccessoryProps {
  /** A readable text colour on this page's themed background. */
  color: string;
}

export type PageFooterAccessory = React.ComponentType<PageFooterAccessoryProps>;

export const PageFooterAccessoryContext =
  React.createContext<PageFooterAccessory | null>(null);
