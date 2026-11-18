// issue #4420 — an optional real-blur material, injected by the host app.
//
// The public pages are shared by the Host app (mingla-business, web + native)
// and Explorer (app-mobile). This package must not import expo-blur (it would
// pull the native blur module into every node render suite and into the
// anonymous public web bundle), so the glass surfaces here (the bottom bar,
// the header band, the venue tab strip) paint a translucent page-tone fill on
// their own. An app that owns a real material can hand it in:
//
//   <OfferingGlassProvider value={{ Backdrop, blursTint }}>…</OfferingGlassProvider>
//
//   • `blursTint(tint)` says whether the app will really blur behind a surface
//     of that tone on this device right now (false on Android, under Reduce
//     Transparency, on phone web). When it answers true the surface drops to a
//     lighter fill so the blur shows through; otherwise it keeps its
//     near-opaque fill and the Backdrop is never mounted.
//   • `Backdrop` draws the blur layer, absolutely filling its parent and
//     clipped to `radius`. It never takes touches.
//
// No provider (Explorer today) ⇒ exactly the near-opaque fill, unchanged.
// Pure: react + react-native only.

import React from "react";

export interface OfferingGlassBackdropProps {
  /** Corner radius the blur clips to. */
  radius: number;
  /** The page tone the surface sits on. */
  tint: "dark" | "light";
}

export interface OfferingGlassMaterial {
  Backdrop: React.ComponentType<OfferingGlassBackdropProps>;
  blursTint: (tint: "dark" | "light") => boolean;
}

const OfferingGlassContext = React.createContext<OfferingGlassMaterial | null>(
  null,
);

export interface OfferingGlassProviderProps {
  value: OfferingGlassMaterial | null;
  children?: React.ReactNode;
}
export const OfferingGlassProvider = ({ value, children }: OfferingGlassProviderProps) => (
  <OfferingGlassContext.Provider value={value}>
    {children}
  </OfferingGlassContext.Provider>
);

/** The injected material, or null (near-opaque fill). */
export const useOfferingGlass = (): OfferingGlassMaterial | null =>
  React.useContext(OfferingGlassContext);

/**
 * Pure: should a glass surface of this tone draw the injected blur? Exported
 * for the regression test; components call it with `useOfferingGlass()`.
 */
export const glassBlurActive = (
  material: OfferingGlassMaterial | null,
  tint: "dark" | "light",
): boolean => material !== null && material.blursTint(tint) === true;

/**
 * The fill alpha a glass surface paints over its page colour: lighter over a
 * real blur, near-opaque without one (Android always opaque).
 */
export const glassFillAlpha = (args: {
  platform: string;
  blurred: boolean;
  desktopWeb: boolean;
}): number => {
  if (args.platform === "android") return 1;
  if (args.blurred) return 0.72;
  // No blur behind it (phone web, native without an injected material):
  // opaque, so text scrolling under the bar never ghosts through it.
  if (args.platform === "web" && args.desktopWeb) return 0.82;
  return 1;
};

/** Renders the injected blur behind a glass surface, or nothing. */
export const OfferingGlassBackdrop = ({
  radius,
  tint,
}: OfferingGlassBackdropProps) => {
  const material = useOfferingGlass();
  if (!glassBlurActive(material, tint) || material === null) return null;
  const { Backdrop } = material;
  return <Backdrop radius={radius} tint={tint} />;
};
