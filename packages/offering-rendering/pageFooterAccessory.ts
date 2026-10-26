// #2331 — an optional host-provided accessory rendered at the END of every
// public offering page's content (ParallaxCoverShell). Business buyer web
// registers the "Your privacy choices" link here once at boot; hosts that
// register nothing (consumer app, business native, brand sites) render
// byte-identically.
//
// A plain module slot rather than a React context on purpose: this file stays
// free of any `react` import, so the root layout can import it eagerly without
// pulling the rendering package into the boot chunk.

export interface PageFooterAccessoryProps {
  /** A readable text colour on this page's themed background. */
  color: string;
}

/** A component taking {@link PageFooterAccessoryProps} (typed loosely so this file needs no `react` import). */
export type PageFooterAccessory = (props: PageFooterAccessoryProps) => unknown;

let registered: PageFooterAccessory | null = null;

/** Register (or clear, with null) the end-of-content accessory. Call once at boot. */
export function setPageFooterAccessory(accessory: PageFooterAccessory | null): void {
  registered = accessory;
}

/** The registered accessory, or null when the host registered none. */
export function getPageFooterAccessory(): PageFooterAccessory | null {
  return registered;
}
