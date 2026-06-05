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

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  glass,
  radius as radiusTokens,
  shadows,
} from "../../constants/designSystem";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";

// Import the canonical bottom sheet from the platform-NEUTRAL `./SheetMobile`,
// never from the bare `./Sheet` specifier. On web, Metro resolves `./Sheet` to
// THIS file, so importing the Sheet value via that specifier makes the
// narrow-web branch render itself recursively → unbounded fiber tree →
// mobile-web renderer OOM (ORCH-0964). `./SheetMobile` has no .web variant, so
// it always resolves to the real bottom-sheet implementation.
import {
  Sheet as MobileSheet,
  type SheetProps,
  type SheetSnapPoint,
  type SheetSnapValue,
} from "./SheetMobile";

// Re-export the type aliases so existing imports
// `import { Sheet, SheetProps, SheetSnapValue } from '.../Sheet'`
// resolve identically on web.
export type { SheetProps, SheetSnapPoint, SheetSnapValue };

const SCRIM_COLOR = "rgba(0, 0, 0, 0.55)";
const CARD_MAX_WIDTH = 640;
const CARD_VIEWPORT_GUTTER = 64; // 32px breathing room on each side at narrow desktops.
const CARD_MAX_HEIGHT_RATIO = 0.8;
const CARD_BACKGROUND = "rgba(20, 22, 26, 0.92)";

const OPEN_DURATION_MS = 200;
const CLOSE_DURATION_MS = 180;
const UNMOUNT_DELAY_MS = 220; // close anim + 40ms safety
const OPEN_EASING = Easing.out(Easing.cubic);
const CLOSE_EASING = Easing.in(Easing.cubic);
const OPEN_TIMING = { duration: OPEN_DURATION_MS, easing: OPEN_EASING } as const;
const CLOSE_TIMING = { duration: CLOSE_DURATION_MS, easing: CLOSE_EASING } as const;

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
  testID,
  style,
}) => {
  const reduceMotion = useReducedMotion();
  const scrimOpacity = useSharedValue(0);
  const cardOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0.96);

  // Lazy-mount + delayed unmount so close animation completes.
  const [mounted, setMounted] = useState<boolean>(visible);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (visible) {
      scrimOpacity.value = withTiming(1, OPEN_TIMING);
      cardOpacity.value = withTiming(1, OPEN_TIMING);
      // Reduce-motion: skip scale, fade only (per SPEC §5).
      cardScale.value = reduceMotion ? 1 : withTiming(1, OPEN_TIMING);
    } else {
      scrimOpacity.value = withTiming(0, CLOSE_TIMING);
      cardOpacity.value = withTiming(0, CLOSE_TIMING);
      cardScale.value = reduceMotion ? 1 : withTiming(0.96, CLOSE_TIMING);
    }
  }, [cardOpacity, cardScale, reduceMotion, scrimOpacity, visible]);

  useEffect(() => {
    return (): void => {
      cancelAnimation(scrimOpacity);
      cancelAnimation(cardOpacity);
      cancelAnimation(cardScale);
    };
  }, [cardOpacity, cardScale, scrimOpacity]);

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: scrimOpacity.value,
  }));

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));

  // Card width / max-height — recompute on every render so window resize
  // (which already re-renders this component via useWindowDimensions
  // upstream of useResponsiveLayout) re-clamps correctly.
  const { width: viewportWidth, height: viewportHeight } = Dimensions.get("window");
  const cardWidth = useMemo(
    () => Math.min(CARD_MAX_WIDTH, Math.max(viewportWidth - CARD_VIEWPORT_GUTTER, 280)),
    [viewportWidth],
  );
  const cardMaxHeight = useMemo(
    () =>
      Math.min(
        viewportHeight * CARD_MAX_HEIGHT_RATIO,
        Math.max(viewportHeight - CARD_VIEWPORT_GUTTER, 240),
      ),
    [viewportHeight],
  );

  const handleScrimPress = (): void => {
    if (dismissOnScrimTap) onClose();
  };

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        pointerEvents={visible ? "auto" : "none"}
        style={StyleSheet.absoluteFill}
        testID={testID}
      >
        {/* Backdrop — dimmed canvas + tap-to-dismiss. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM_COLOR }, scrimStyle]}
        >
          <Pressable
            style={styles.scrimPress as StyleProp<ViewStyle>}
            onPress={handleScrimPress}
            accessibilityLabel="Dismiss sheet"
            accessibilityRole="button"
          />
        </Animated.View>

        {/* Centred floating card. The outer View positions the card; the
            inner Animated.View carries the fade + scale-in. Sub-sheets
            MUST live inside `children` here — never as Fragment siblings
            of this <Sheet> (I-SUB-SHEET-INSIDE-PARENT). */}
        <View style={styles.cardWrap} pointerEvents="box-none">
          <Animated.View
            style={[
              styles.card,
              {
                width: cardWidth,
                maxHeight: cardMaxHeight,
                backgroundColor: CARD_BACKGROUND,
                borderColor: glass.border.profileElevated,
              },
              shadows.glassModal,
              cardAnimatedStyle,
              style,
            ]}
          >
            <View style={styles.cardBody}>{children}</View>
          </Animated.View>
        </View>
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
      web: { cursor: "default" as const },
      default: {},
    }),
  },
  cardWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  card: {
    borderRadius: radiusTokens.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardBody: {
    flexShrink: 1,
  },
});

export default Sheet;
