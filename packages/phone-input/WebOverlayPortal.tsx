/**
 * WebOverlayPortal — NATIVE (and any non-web) build.
 *
 * Per ORCH-1300 [rsvp-phone-picker-mobile-portal].
 *
 * There is no DOM to portal into on native, so this simply renders its children
 * inline. It is also effectively dead code on native: the country-picker OVERLAY
 * is a WEB-only surface (resolvePickerPresentation gates `'overlay'` to web;
 * native always uses the <Modal>), so CountryPickerOverlay never renders off web.
 *
 * The whole point of this file existing is Metro platform resolution: on native
 * Metro resolves THIS `.tsx`, NOT the `WebOverlayPortal.web.tsx` sibling, so
 * `react-dom` (a web-only dep) NEVER enters the native bundle. Same split the
 * package already uses for `ThemeEntranceAnimation` / `PostHogAnalyticsProvider`.
 */

import { type ReactNode, type ReactElement } from "react";

export function WebOverlayPortal({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return <>{children}</>;
}
