/**
 * ComposerCanvas — native passthrough.
 *
 * On native (iOS / Android) AND on web narrow viewports (<1024px), the
 * composer renders as a single column with the preview pane mounted as
 * a Modal via the existing Preview-button trigger in compose.tsx. This
 * file is the passthrough Fragment — Metro picks `ComposerCanvas.web.tsx`
 * on web (≥1024px gets the split layout) and falls back to this file on
 * iOS/Android.
 *
 * Per SPEC_ORCH-0891 §3.5.2.
 */

import React from "react";

export interface ComposerCanvasProps {
  /** Editor + footer column. Always rendered. */
  editor: React.ReactNode;
  /** Email preview pane content. Mobile: NOT rendered here (modal-triggered). */
  preview?: React.ReactNode;
  /** Template drawer content. Mobile: NOT rendered here (sheet-triggered). */
  drawer?: React.ReactNode;
  /** Drawer-open flag. Mobile: ignored (sheet has its own open state). */
  drawerOpen?: boolean;
}

/**
 * Native variant: pure passthrough — returns the editor child verbatim.
 * The drawer + preview props are accepted (to match the web variant's
 * surface) but ignored on native, where they mount via existing
 * Modal/Sheet triggers in compose.tsx.
 */
export const ComposerCanvas: React.FC<ComposerCanvasProps> = ({ editor }) => {
  return <>{editor}</>;
};

export default ComposerCanvas;
