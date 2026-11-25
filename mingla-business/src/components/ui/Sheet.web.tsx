/**
 * Sheet.web — ORCH-0885-A Tier 1 web variant of the canonical Sheet
 * primitive.
 *
 * Metro picks this file on web; the canonical `Sheet.tsx` is the truth on
 * iOS/Android.
 *
 * # Runtime behaviour
 * - `isWideDesktop === false` (narrow web < 1024px) → renders the canonical
 *   bottom sheet via `MobileSheet`, imported from the platform-neutral
 *   `./SheetMobile`. Visual + interaction parity with iOS/Android.
 * - `isWideDesktop === true` → renders a **centred floating card** with a
 *   dimmed backdrop. Card width capped at `min(640, viewportWidth - 64)`;
 *   height auto-sized to content with max-height `min(80vh, viewport - 64)`;
 *   borderRadius `radius.lg`; backdrop alpha `rgba(0, 0, 0, 0.55)` per
 *   SPEC §7 (verified WCAG-clean against the #0c0e12 canvas).
 *
 *   NOTE (ORCH-0964): `MobileSheet` MUST be imported from `./SheetMobile`, not
 *   `./Sheet`. On web Metro resolves `./Sheet` to THIS file, so importing the
 *   Sheet value from `./Sheet` made the narrow branch render itself infinitely
 *   → mobile-web renderer OOM. The neutral `./SheetMobile` filename avoids the
 *   self-collision.
 *
 * # Sub-sheet invariant (I-SUB-SHEET-INSIDE-PARENT)
 * Sub-sheets remain JSX-children of their parent floating card. This file
 * does NOT lift any nested Sheet to a sibling render at the document root,
 * even though web DOM does not technically have the native-Modal sibling
 * problem (`feedback_rn_sub_sheet_must_render_inside_parent.md`). The rule
 * applies per-file — the JSX structure consumers compose is the contract.
 *
 * # Invariants honoured
 * - I-DESKTOP-GATE-VIA-HOOK — gates exclusively via `useResponsiveLayout()`.
 * - I-SUB-SHEET-INSIDE-PARENT — sub-sheets stay JSX-children.
 * - I-RN-COLOR-FORMATS — backdrop + card surfaces use rgba/hex only.
 * - I-KEYBOARD-NEVER-BLOCKS-INPUT — desktop browsers don't displace
 *   the viewport for soft keyboards (no virtual keyboard), so the
 *   keyboard listener in `Sheet.tsx` is irrelevant on desktop; the
 *   centred-card variant simply doesn't read it.
 *
 * Per SPEC_ORCH-0885-A §5.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import {
  color as colorTokens,
  materials,
  radius as radiusTokens,
  scrim,
  shadow as shadowTokens,
  size,
  space,
} from "../../constants/designSystem";
import {
  isSurfaceThemed,
  materials as surfaceMaterials,
} from "../../theme/surfaceTokens";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { hideModalFocusBrackets } from "./hideModalFocusBrackets";
import { Icon } from "./Icon";
import { useEscapeLayer } from "./escapeLayerStack";
import { useSheetGone } from "./useSheetGone";
// #4508 T4 — the centred card's own toast layer (as SheetMobile and Modal
// have): a toast fired while this card is open draws above it, not under it.
import { ToastHost } from "./ToastHost";

// Import the canonical bottom sheet from the platform-NEUTRAL `./SheetMobile`,
// never from the bare `./Sheet` specifier. On web, Metro resolves `./Sheet` to
// THIS file, so importing the Sheet value via that specifier makes the
// narrow-web branch render itself recursively → unbounded fiber tree →
// mobile-web renderer OOM (ORCH-0964). `./SheetMobile` has no .web variant, so
// it always resolves to the real bottom-sheet implementation.
import {
  Sheet as MobileSheet,
  SHEET_SIDE_GUTTER,
  SHEET_TOP_INSET,
  WEB_OPAQUE_BACKGROUND,
  type SheetPresentation,
  type SheetProps,
  type SheetSnapPoint,
  type SheetSnapValue,
} from "./SheetMobile";


// Re-export the type aliases so existing imports
// `import { Sheet, SheetProps, SheetSnapValue } from '.../Sheet'`
// resolve identically on web.
export type { SheetPresentation, SheetProps, SheetSnapPoint, SheetSnapValue };

const SCRIM_COLOR = scrim.modal;
const CARD_MAX_WIDTH = 640;
/** #4420 `presentation="modal"`: the kit's centred modal. */
const MODAL_WIDTH = size.modal;
/** #4420 `presentation="panel"`: the kit's right-side inspector. */
const PANEL_WIDTH = size.sidePanel;
const CARD_RADIUS = radiusTokens.xxl;
/** The panel Close button: a 44 touch target. */
const PANEL_CLOSE_SIZE = 44;
const CARD_VIEWPORT_GUTTER = 64; // 32px breathing room on each side at narrow desktops.
const CARD_MAX_HEIGHT_RATIO = 0.8;
const CARD_BACKGROUND = materials.sheet.solidFill;

const OPEN_DURATION_MS = 200;
const CLOSE_DURATION_MS = 180;
const UNMOUNT_DELAY_MS = 220; // close anim + 40ms safety
// ORCH-1136 R3: compositor CSS transition easings (replacing the reanimated
// withTiming path). Match the prior native timings: ease-out-cubic on open,
// ease-in-cubic on close.
const OPEN_EASE_CSS = "cubic-bezier(0.33, 1, 0.68, 1)"; // Easing.out(cubic)
const CLOSE_EASE_CSS = "cubic-bezier(0.33, 0, 0.67, 1)"; // Easing.in(cubic)

// ORCH-1136 R3: this file is web-only (Metro picks it on web). reanimated's
// useReducedMotion is itself a JSReanimated hook; the CSS-transition path calls
// ZERO reanimated hooks, so read the media query directly.
const useWebReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState<boolean>(false);
  useEffect(() => {
    const mql = (
      globalThis as unknown as {
        matchMedia?: (q: string) => {
          matches: boolean;
          addEventListener?: (t: string, l: () => void) => void;
          removeEventListener?: (t: string, l: () => void) => void;
        };
      }
    ).matchMedia?.("(prefers-reduced-motion: reduce)");
    if (mql === undefined) return;
    setReduced(mql.matches);
    const onChange = (): void => setReduced(mql.matches);
    mql.addEventListener?.("change", onChange);
    return (): void => mql.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
};

// Narrow web (< 1024px) renders the canonical bottom sheet (MobileSheet, from
// the neutral "./SheetMobile" — NOT "./Sheet", which would self-resolve to this
// file and recurse infinitely; ORCH-0964). Wide web renders the centred card.
export const Sheet: React.FC<SheetProps> = (props) => {
  const { isWideDesktop } = useResponsiveLayout();
  if (!isWideDesktop) {
    return <MobileSheet {...props} />;
  }
  return <DesktopCenteredCard {...props} />;
};

const DesktopCenteredCard: React.FC<SheetProps> = ({
  visible,
  onClose,
  children,
  dismissOnScrimTap = true,
  dismissDisabled = false,
  verticalAlign = "center",
  testID,
  style,
  panelBackground,
  presentation,
  onDismissed,
}) => {
  // #3645 — this card's own Escape is handled by the platform modal
  // (onRequestClose). Registering it as an Escape layer is what stops the
  // sheet or dialog UNDERNEATH from closing on the same key press.
  useEscapeLayer(visible);
  const competition = presentation === "competition";
  const sidePanel = presentation === "panel";
  const reduceMotion = useWebReducedMotion();

  // Lazy-mount + delayed unmount so close animation completes.
  const [mounted, setMounted] = useState<boolean>(visible);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // #4270: tell the caller once the card has gone (after it unmounts).
  useSheetGone(mounted, onDismissed);

  // ORCH-1136 R3: animateOpen drives the compositor CSS transition. Starts
  // false so the card mounts at the CLOSED state (opacity 0, scale 0.96); the
  // next-frame flip to true fires the transition to OPEN. Flipping in the same
  // commit as mount = no transition (instant pop), so the next-frame flip is
  // load-bearing.
  const [animateOpen, setAnimateOpen] = useState<boolean>(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    } else if (mounted) {
      closeTimerRef.current = setTimeout(() => {
        setMounted(false);
        closeTimerRef.current = null;
      }, UNMOUNT_DELAY_MS);
    }
    return (): void => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [mounted, visible]);

  useEffect(() => {
    const cancelRaf = (): void => {
      if (rafRef.current !== null) {
        const caf = (
          globalThis as unknown as {
            cancelAnimationFrame?: (h: number) => void;
          }
        ).cancelAnimationFrame;
        caf?.(rafRef.current);
        rafRef.current = null;
      }
    };
    if (visible && mounted) {
      setAnimateOpen(false);
      const raf = (
        globalThis as unknown as {
          requestAnimationFrame?: (cb: () => void) => number;
        }
      ).requestAnimationFrame;
      if (raf !== undefined) {
        rafRef.current = raf(() => {
          rafRef.current = raf(() => setAnimateOpen(true));
        });
      } else {
        const t = setTimeout(() => setAnimateOpen(true), 0);
        return (): void => clearTimeout(t);
      }
    } else if (!visible) {
      cancelRaf();
      setAnimateOpen(false);
    }
    return cancelRaf;
  }, [visible, mounted]);

  const openDur = animateOpen ? OPEN_DURATION_MS : CLOSE_DURATION_MS;
  const ease = animateOpen ? OPEN_EASE_CSS : CLOSE_EASE_CSS;

  const scrimWebStyle = {
    transition: `opacity ${openDur}ms ${ease}`,
    opacity: animateOpen ? 1 : 0,
    willChange: "opacity",
  } as unknown as ViewStyle;

  // Reduce-motion: opacity-only (scale stays 1).
  const cardWebStyle = {
    transition: reduceMotion
      ? `opacity ${openDur}ms ${ease}`
      : `opacity ${openDur}ms ${ease}, transform ${openDur}ms ${ease}`,
    opacity: animateOpen ? 1 : 0,
    transform: reduceMotion
      ? "scale(1)"
      : animateOpen
        ? "scale(1)"
        : "scale(0.96)",
    willChange: "transform",
  } as unknown as ViewStyle;

  // Card width / max-height — recompute on every render so window resize
  // (which already re-renders this component via useWindowDimensions
  // upstream of useResponsiveLayout) re-clamps correctly.
  const { width: viewportWidth, height: viewportHeight } =
    Dimensions.get("window");
  const cardWidth = Math.min(
    competition
      ? viewportWidth < 1280
        ? 640
        : 720
      : presentation === "modal"
        ? MODAL_WIDTH
        : sidePanel
          ? PANEL_WIDTH
          : CARD_MAX_WIDTH,
    Math.max(viewportWidth - CARD_VIEWPORT_GUTTER, 280),
  );
  const cardMaxHeight = competition
    ? Math.max(viewportHeight - CARD_VIEWPORT_GUTTER, 240)
    : Math.min(
        viewportHeight * CARD_MAX_HEIGHT_RATIO,
        Math.max(viewportHeight - CARD_VIEWPORT_GUTTER, 240),
      );

  const handleScrimPress = (): void => {
    if (!dismissDisabled && dismissOnScrimTap) onClose();
  };

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={() => {
        if (!dismissDisabled) onClose();
      }}
      statusBarTranslucent
    >
      <View
        ref={hideModalFocusBrackets}
        pointerEvents={visible ? "auto" : "none"}
        style={StyleSheet.absoluteFill}
        testID={testID}
      >
        {/* Backdrop — dimmed canvas + tap-to-dismiss. */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: SCRIM_COLOR,
            },
            scrimWebStyle,
          ]}
        >
          <Pressable
            style={styles.scrimPress as StyleProp<ViewStyle>}
            onPress={handleScrimPress}
            accessibilityLabel="Dismiss sheet"
            accessibilityRole="button"
          />
        </View>

        {/* Centred floating card. The outer View positions the card; the
            inner Animated.View carries the fade + scale-in. Sub-sheets
            MUST live inside `children` here — never as Fragment siblings
            of this <Sheet> (I-SUB-SHEET-INSIDE-PARENT). */}
        <View
          style={[
            styles.cardWrap,
            sidePanel ? styles.panelWrap : null,
            verticalAlign === "top" && !sidePanel
              ? {
                  justifyContent: "flex-start",
                  // Anchor near the top (~12vh) so the card grows/shrinks with
                  // content without the whole sheet re-centring as you type.
                  paddingTop: Math.max(viewportHeight * 0.12, 48),
                }
              : null,
          ]}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.card,
              {
                width: cardWidth,
                maxHeight: sidePanel ? undefined : cardMaxHeight,
                // ORCH-1186 Fix 3 — brand fill override (solid, edge-to-edge).
                backgroundColor: panelBackground ?? CARD_BACKGROUND,
                borderColor: materials.sheet.rim.edge,
                borderTopColor: materials.sheet.rim.top ?? materials.sheet.rim.edge,
                // #4518 — inside a host-themed checkout the panel is the host's
                // sheet colour, so its themed content is never dark on dark.
                ...(isSurfaceThemed()
                  ? {
                      backgroundColor:
                        panelBackground ?? surfaceMaterials.sheet.solidFill,
                      borderColor: surfaceMaterials.sheet.rim.edge,
                      borderTopColor: surfaceMaterials.sheet.rim.edge,
                    }
                  : null),
              },
              sidePanel ? styles.sidePanel : null,
              shadowTokens.dialog,
              cardWebStyle,
              style,
            ]}
            testID={
              competition && testID !== undefined
                ? `${testID}-competition-panel`
                : undefined
            }
            accessibilityViewIsModal={competition || undefined}
          >
            {/* #3827 — an opaque base under every default card, the SAME
                underlay the narrow-web bottom sheet uses (ORCH-1207): the
                card's own glass fill is see-through, so a picker opened over
                a form (Tickets → Visibility) showed the form's text through
                its options. A brand / Competition `panelBackground` is
                already solid and is left alone. */}
            {panelBackground === undefined ? (
              <View
                style={[StyleSheet.absoluteFill, styles.opaqueBase]}
                pointerEvents="none"
                testID={testID !== undefined ? `${testID}-desktop-opaque-base` : undefined}
              />
            ) : null}
            {/* #3827 — the card has no drag handle, so it reserves the
                handle's band as top padding (SHEET_TOP_INSET, the SAME
                constant the bottom sheet's handle is sized from). Without it
                every consumer's first line sat flush on the card's top
                border on desktop while it had room on a phone. The
                Competition panel lays out its own insets edge-to-edge. */}
            <View
              style={[
                styles.cardBody,
                competition ? null : styles.cardBodyInset,
                competition ? null : styles.cardBodyGutter,
                competition ? null : styles.cardBodyBreathing,
                sidePanel && !dismissDisabled ? styles.cardBodyUnderClose : null,
              ]}
              testID={testID !== undefined ? `${testID}-desktop-body` : undefined}
            >
              {children}
            </View>
            {/* #4490 I3: a side panel (inspector) always shows its own Close, so it is
                never closable only by tapping the backdrop. Consumers need not add one. */}
            {sidePanel && !dismissDisabled ? (
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={styles.panelClose}
                testID={testID !== undefined ? `${testID}-panel-close` : undefined}
              >
                <Icon name="close" size={18} color={colorTokens.text1} />
              </Pressable>
            ) : null}
          </View>
        </View>
        {/* #4508 T4 / #4420 B4 / #4490 D6: toasts fired while this card is open
            draw above it (the root host sits under this Modal's portal), so
            cover-picker toasts no longer show behind the sheet. SheetMobile,
            Modal and ConfirmDialog mount the same host. */}
        <ToastHost layer="overlay" open={visible} />
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  scrimPress: {
    flex: 1,
    // Web-only: ensure default cursor doesn't suggest the backdrop is a
    // primary action. RN-web maps cursor styles.
    ...Platform.select({
      // RN's CursorValue type lists only "auto" | "pointer"; react-native-web
      // accepts any CSS cursor (same cast pattern as the transition styles).
      web: { cursor: "default" } as unknown as ViewStyle,
      default: {},
    }),
  },
  cardWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  // #4420 `panel`: pinned to the right edge, full height, a 12 bezel.
  panelWrap: {
    alignItems: "flex-end",
    justifyContent: "flex-start",
    padding: size.bezel,
  },
  card: {
    borderRadius: CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopWidth: 1,
    overflow: "hidden",
  },
  sidePanel: {
    flex: 1,
    borderRadius: radiusTokens.xl,
  },
  cardBody: {
    flexShrink: 1,
  },
  // Room for the panel's Close button so no heading runs under it.
  cardBodyUnderClose: {
    paddingTop: PANEL_CLOSE_SIZE + space[2],
  },
  panelClose: {
    position: "absolute",
    top: space[2],
    right: space[2],
    width: PANEL_CLOSE_SIZE,
    height: PANEL_CLOSE_SIZE,
    borderRadius: radiusTokens.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colorTokens.fill.inset,
  },
  opaqueBase: {
    backgroundColor: WEB_OPAQUE_BACKGROUND,
  },
  // #3355 (Seth's UI vet, 12 Nov) — breathing room at all times: the card
  // also keeps room UNDER its content, the same spacing.lg a phone sheet keeps
  // below its body (SheetMobile `body` paddingBottom). Without it a pinned
  // footer (SheetScrollLayout) sat flush on the card's bottom border.
  // Invariant I-SHEET-BREATHING-ROOM | issue #3355 | Every default wide-web
  // sheet card reserves spacing.lg below its content. Enforced by
  // issue_3827_desktop_sheet_inset_and_opaque.implementor.test.tsx.
  cardBodyInset: {
    paddingTop: SHEET_TOP_INSET,
  },
  // #4420 (shots-bundle 03/04) — the card keeps the SAME 20 side gutter the
  // bottom sheet's body keeps. #4420 moved the side padding off
  // SheetScrollLayout onto the bottom sheet's body; this card never had one,
  // so every desktop sheet's text, inputs, rows and buttons sat flush on the
  // card edge and a bordered row was clipped by it.
  // Invariant I-4420-SHEET-SIDE-GUTTER | issue #4420 | Every default wide-web
  // sheet card pads its body by SHEET_SIDE_GUTTER on both sides. Enforced by
  // issue_3827_desktop_sheet_inset_and_opaque.implementor.test.tsx and the
  // strict-grep gate issue-3827-sheet-top-inset-and-opaque.mjs (S4).
  cardBodyGutter: {
    paddingHorizontal: SHEET_SIDE_GUTTER,
  },
  cardBodyBreathing: {
    paddingBottom: space[6],
  },
});

export default Sheet;
