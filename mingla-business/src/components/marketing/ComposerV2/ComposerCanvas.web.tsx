/**
 * ComposerCanvas.web — ORCH-0891 M2 side-by-side composer layout.
 *
 * Per SPEC_ORCH-0891 §3.5.2 + DESIGN_SPEC §2 (composer canvas split
 * layout breakpoint table). On wide-desktop (≥1024px), splits the
 * composer route into a 2-pane (editor | preview) OR 3-pane (editor |
 * drawer | preview) layout. On narrow web (<1024px), passes through as
 * a single column — preview mounts via the Modal-triggered Preview
 * button in compose.tsx (mobile behavior preserved).
 *
 * # Viewport breakpoints (design-spec §2.1)
 *
 *   Narrow web        < 1024px  → single column (passthrough)
 *   1024–1279px       editor 60% | preview 40%   (drawer closed)
 *                     editor 44% | drawer 280px | preview 36%   (drawer open)
 *   1280–1535px       editor 62% | preview 38%   (drawer closed)
 *                     editor 48% | drawer 320px | preview 32%   (drawer open)
 *   ≥ 1536px          editor max 720px | preview max 560px   (drawer closed)
 *                     editor max 640px | drawer 360px | preview max 520px   (drawer open)
 *
 * # Visual contract (design-spec §2.3)
 * - Editor pane: glass.tint.profileBase + glass.border.profileBase + radius.lg + shadows.glassCardBase
 * - Drawer pane (elevated): glass.tint.profileElevated + glass.border.profileElevated + shadows.glassCardElevated
 * - Preview pane: same as editor pane
 * - Internal gap between panes: spacing.md (16pt)
 * - Outer host padding: spacing.md (16pt) on all sides
 *
 * # Invariants honoured
 * - **I-DESKTOP-GATE-VIA-HOOK** — branches via `useResponsiveLayout()`.
 * - **I-CROSS-SURFACE-IMPACT** — native passthrough sibling
 *   (`ComposerCanvas.tsx`) keeps iOS/Android byte-identical to today.
 * - **I-RN-COLOR-FORMATS** — all colors via designSystem tokens (hex/rgba).
 *
 * Per SPEC_ORCH-0891 §3.5.2 + DESIGN_SPEC §2.
 */

import React from "react";
import { StyleSheet, View } from "react-native";

import {
  glass,
  radius,
  shadows,
  spacing,
} from "../../../constants/designSystem";
import { useResponsiveLayout } from "../../../hooks/useResponsiveLayout";

export interface ComposerCanvasProps {
  /** Editor + footer column. Always rendered. */
  editor: React.ReactNode;
  /** Live email preview pane. Rendered as the right pane on wide-desktop. */
  preview?: React.ReactNode;
  /** Template drawer content. Rendered as the middle pane when drawerOpen. */
  drawer?: React.ReactNode;
  /** Drawer-open flag. Controls the 2-pane vs 3-pane shape on wide-desktop. */
  drawerOpen?: boolean;
}

/**
 * Resolve the flex ratio + width specs for the three panes given the
 * viewport width + drawer-open state. Returns numeric flex values for
 * the editor and preview (so RN flexbox handles distribution) and a
 * fixed pixel width for the drawer (it's a content-density pane, not
 * a flex-grow pane).
 *
 * The breakpoint logic mirrors DESIGN_SPEC §2.1 verbatim.
 */
interface PaneSpec {
  /** Editor pane flex ratio (numeric). */
  editorFlex: number;
  /** Editor pane optional max-width (pt) when canvas is very wide. */
  editorMaxWidth?: number;
  /** Drawer width (pt). 0 when drawer is closed. */
  drawerWidth: number;
  /** Preview pane flex ratio (numeric). */
  previewFlex: number;
  /** Preview pane optional max-width (pt) when canvas is very wide. */
  previewMaxWidth?: number;
}

function resolvePaneSpec(width: number, drawerOpen: boolean): PaneSpec {
  // Width buckets per design-spec §2.1
  const isWide = width >= 1536;
  const isMid = width >= 1280 && width < 1536;
  // isNarrow: 1024 <= width < 1280

  if (drawerOpen) {
    if (isWide) {
      return {
        editorFlex: 1,
        editorMaxWidth: 640,
        drawerWidth: 360,
        previewFlex: 1,
        previewMaxWidth: 520,
      };
    }
    if (isMid) {
      // editor 48%, drawer 320, preview 32% — translate %-of-canvas into
      // flex ratios. Canvas width minus drawer = ratio space. We honor
      // the design intent (editor wider than preview) via 48:32 = 3:2.
      return {
        editorFlex: 48,
        drawerWidth: 320,
        previewFlex: 32,
      };
    }
    // 1024–1279px — editor 44%, drawer 280, preview 36%
    return {
      editorFlex: 44,
      drawerWidth: 280,
      previewFlex: 36,
    };
  }

  // Drawer closed — 2-pane shape
  if (isWide) {
    return {
      editorFlex: 1,
      editorMaxWidth: 720,
      drawerWidth: 0,
      previewFlex: 1,
      previewMaxWidth: 560,
    };
  }
  if (isMid) {
    // editor 62%, preview 38% → 62:38 ≈ 8:5
    return { editorFlex: 62, drawerWidth: 0, previewFlex: 38 };
  }
  // 1024–1279px — editor 60%, preview 40%
  return { editorFlex: 60, drawerWidth: 0, previewFlex: 40 };
}

export const ComposerCanvas: React.FC<ComposerCanvasProps> = ({
  editor,
  preview,
  drawer,
  drawerOpen = false,
}) => {
  const { isWideDesktop, width } = useResponsiveLayout();

  // Narrow web fall-through (phone/tablet web, < 1024px). Mobile native is
  // covered by the sibling `ComposerCanvas.tsx` Fragment passthrough (Metro
  // picks .tsx on native).
  //
  // ─── #2262 P1-1 — THE ScrollView THAT USED TO BE HERE IS DELETED ─────────
  //
  // ORCH-1100 RC-3 wrapped the whole editor column in a `ScrollView` because
  // the column, sized by a fixed 450pt body inside a chrome budget that
  // under-counted the TopBar, was taller than the viewport and its bottom was
  // unreachable. That was the right recovery for a column whose height was a
  // CONSTANT.
  //
  // Under the band architecture it became the defect. A scroll container's
  // content box has AUTO height, so every `flex:1` / `minHeight:0` /
  // `overflow:hidden` inside it resolved against CONTENT rather than the
  // viewport: `column`, Band B, the sheet and `bodyHost` all grew to the
  // natural height of `.ProseMirror`, Band B's clip never bound, and the
  // commit bar — a correct flow sibling — was pushed down WITHOUT BOUND.
  // Measured in real Chromium: +57px at 4 paragraphs and +2335px at 32 on a
  // 390x750 phone browser; +44px at 2 and +3183px at 32 at 320x568. The
  // baseline it replaced was a CONSTANT 89px, so for a long draft the
  // half-fixed state was worse than the bug.
  //
  // It also put the commit bar INSIDE a scroll container, which DESIGN
  // constraint 10.1 forbids outright on every surface.
  //
  // The recovery §4.3 step 4 requires on web has not gone anywhere — it moved
  // to where it belongs. Band B (`composer-flex-region` in `compose.tsx`)
  // carries its own web `overflow: auto`, so the region that can overflow
  // scrolls, and the scrim and the commit bar are its FLOW SIBLINGS, outside
  // the thing that scrolls. That satisfies 10.1 and §4.3 step 4 at the same
  // time: the column scrolls, and the bar cannot move, because it is not in it.
  //
  // With the wrapper gone the chain is identical to the desktop one, which the
  // independent tester measured holding flat at every draft length from 1 to 32
  // paragraphs.
  //
  // NOTE: Stage F.7's constraint (pell's WebView inside a ScrollView blocks
  // taps on iOS) never applied here — this file is `.web.tsx` and runs Tiptap,
  // not a WebView. Native's no-column-scroll behaviour is untouched.
  if (!isWideDesktop) {
    return (
      <View style={styles.narrowHost} testID="composer-canvas-narrow-web-host">
        {editor}
      </View>
    );
  }

  const spec = resolvePaneSpec(width, drawerOpen);

  return (
    <View style={styles.host}>
      <View
        style={[
          styles.editorPane,
          { flex: spec.editorFlex },
          spec.editorMaxWidth !== undefined
            ? { maxWidth: spec.editorMaxWidth }
            : null,
        ]}
        testID="composer-canvas-editor-pane"
      >
        {editor}
      </View>

      {drawerOpen && drawer !== undefined ? (
        <View
          style={[styles.drawerPane, { width: spec.drawerWidth }]}
          testID="composer-canvas-drawer-pane"
        >
          {drawer}
        </View>
      ) : null}

      {preview !== undefined ? (
        <View
          style={[
            styles.previewPane,
            { flex: spec.previewFlex },
            spec.previewMaxWidth !== undefined
              ? { maxWidth: spec.previewMaxWidth }
              : null,
          ]}
          testID="composer-canvas-preview-pane"
        >
          {preview}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  // #2262 P1-1 — a BOUNDED box, not a scroll container. It hands the band
  // column a definite height (from `kavHost`, itself bounded by the
  // viewport-pinned route host), which is the precondition every `flex:1` and
  // `overflow:hidden` below it needs in order to mean anything. The scroll
  // recovery lives on Band B inside the column, where it wraps only the region
  // that can overflow and leaves the commit bar outside it.
  narrowHost: {
    flex: 1,
    minHeight: 0,
  },
  host: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    minHeight: 0, // RN flex-row requires explicit min-height: 0 so children can shrink
  },
  /**
   * #2262 10.9 — `overflow: "hidden"` STAYS here: it is what clips the pane's
   * contents to its `radius.lg` corners. What changed is that the composer's
   * Band B (`composer-flex-region` in `compose.tsx`) is now itself a scroll
   * recovery on web, and Band B is a DESCENDANT of this pane — so the 77px this
   * pane used to swallow silently at 1024x700 is reachable, while the commit bar
   * stays OUTSIDE any scroll container (10.1). Wrapping this pane's whole
   * child in a scroll would put the bar inside one, which is the failure mode
   * the issue exists to end.
   */
  editorPane: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    borderRadius: radius.lg,
    overflow: "hidden",
    minWidth: 0,
    ...shadows.glassCardBase,
  },
  drawerPane: {
    backgroundColor: glass.tint.profileElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileElevated,
    borderRadius: radius.lg,
    overflow: "hidden",
    flexShrink: 0,
    ...shadows.glassCardElevated,
  },
  previewPane: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    borderRadius: radius.lg,
    overflow: "hidden",
    minWidth: 0,
    ...shadows.glassCardBase,
  },
});

export default ComposerCanvas;
