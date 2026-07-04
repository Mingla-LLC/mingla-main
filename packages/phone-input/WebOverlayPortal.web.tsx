/**
 * WebOverlayPortal — WEB build. Detaches the country-picker overlay to
 * `document.body` via a react-dom portal.
 *
 * Per ORCH-1300 [rsvp-phone-picker-mobile-portal].
 *
 * WHY (runtime-proven on real mobile WebKit): CountryPickerOverlay pins itself
 * with CSS `position: fixed` so it covers the viewport above the RSVP details
 * modal. But `fixed` is only viewport-relative when NO ancestor establishes a
 * containing block via `transform` / `filter` / `perspective` / `will-change` /
 * `contain`. The RSVP public page renders the phone field deep inside `Animated`
 * wrappers (PhoneInput's own shake wrapper sets `transform`, and the page runs
 * looping animations) — so on mobile WebKit the overlay's `fixed` resolves
 * against a TRANSFORMED ancestor and lands OFF-SCREEN. Measured on iPhone-13
 * WebKit against the live page: the picker mounted (node count 231→331, "Select
 * Country" title present) but its search box sat at y = -683px, entirely above
 * the 664px viewport → invisible. Desktop Chromium is lenient and appeared to
 * work; mobile WebKit is not (this is why the ORCH-1299 Chromium-at-430px check
 * passed while the real phone stayed frozen).
 *
 * Rendering the overlay as a DIRECT child of `<body>` (zero transformed
 * ancestors) makes `fixed` truly viewport-relative on EVERY engine. React
 * portals preserve the React tree, so the overlay's props/state and the
 * `onSelect` / `onClose` callbacks + synthetic event system keep working exactly
 * as before — only the DOM insertion point changes.
 */

import { type ReactNode, type ReactElement } from "react";
import { createPortal } from "react-dom";

export function WebOverlayPortal({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  // SSR / non-DOM guard (expo-router static web export renders initial HTML with
  // no `document`). The overlay only mounts after a client-side tap, by which
  // point `document.body` exists, so this branch is crash-safety — never the
  // real render path (pickerVisible starts false, so nothing portals at SSR).
  if (typeof document === "undefined" || !document.body) {
    return <>{children}</>;
  }
  return createPortal(children, document.body);
}
