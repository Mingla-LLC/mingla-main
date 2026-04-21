/**
 * GlassIconButton — circular dark-glass icon button for floating chrome (ORCH-0589).
 *
 * Extends the glass language of GlassBadge (ORCH-0566) into a larger, pressable,
 * self-standing chrome element. Used for:
 *   - Floating Preferences button (top-left of Swipe page)
 *   - Floating Notifications button (top-right of Swipe page) — with badge
 *
 * Layers (same 5 as GlassBadge, using glass.chrome tokens):
 *   L1 BlurView (intensity 28, dark tint)  — or solid tile fallback
 *   L2 tint floor rgba(12,14,18,0.48)
 *   L3 top highlight
 *   L4 hairline border
 *   L5 drop shadow
 *   + L6 orange glow when active
 *
 * Reduce Transparency (iOS) + Android API < 31 → solid-tile fallback with identical silhouette.
 *
 * Spec: Mingla_Artifacts/outputs/SPEC_ORCH-0589_FLOATING_GLASS_HOME.md §4.2 + §4.3
 * Tokens: designSystem.ts → glass.chrome.*
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  AccessibilityInfo,
  Animated,
  Easing,
} from 'react-native';
import type { ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Icon, type IconName } from './Icon';
import { glass } from '../../constants/designSystem';

const c = glass.chrome;

export type GlassIconButtonProps = {
  iconName: IconName;
  onPress: () => void;
  /** When true, icon tints orange + L6 orange glow fires (e.g., linked sheet open). */
  active?: boolean;
  accessibilityLabel: string;
  /** Unread count overlay for notifications variant; omit or null for no badge. */
  badge?: number | null;
  /** Override default button size. Defaults to c.button.size (44). */
  size?: number;
};

const isAndroidPreBlur = Platform.OS === 'android' && Platform.Version < 31;

export const GlassIconButton: React.FC<GlassIconButtonProps> = ({
  iconName,
  onPress,
  active = false,
  accessibilityLabel,
  badge,
  size,
}) => {
  const [reduceTransparency, setReduceTransparency] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async (): Promise<void> => {
      try {
        const rt = await AccessibilityInfo.isReduceTransparencyEnabled();
        if (mounted) setReduceTransparency(rt);
      } catch (err) {
        if (__DEV__) console.warn('[GlassIconButton] a11y init failed:', err);
        if (mounted) setReduceTransparency(true);
      }
    })();
    const sub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      (enabled: boolean) => setReduceTransparency(enabled),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const useGlass = !reduceTransparency && !isAndroidPreBlur;

  const pressScale = useRef(new Animated.Value(1)).current;
  const pressTintOpacity = useRef(new Animated.Value(0)).current;

  const handlePressIn = (): void => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
        // Haptics are non-fatal.
      });
    }
    Animated.parallel([
      Animated.timing(pressScale, {
        toValue: c.motion.pressScale,
        duration: c.motion.pressDurationMs,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(pressTintOpacity, {
        toValue: 1,
        duration: c.motion.pressDurationMs,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
  };

  const handlePressOut = (): void => {
    Animated.parallel([
      Animated.timing(pressScale, {
        toValue: 1,
        duration: c.motion.pressDurationMs,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(pressTintOpacity, {
        toValue: 0,
        duration: c.motion.pressDurationMs,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
  };

  const resolvedSize = size ?? c.button.size;
  const resolvedRadius = resolvedSize / 2;

  const baseStyle: ViewStyle = useMemo(
    () => ({
      width: resolvedSize,
      height: resolvedSize,
      borderRadius: resolvedRadius,
    }),
    [resolvedSize, resolvedRadius],
  );

  // Active state: orange glow shadow replaces the default black shadow.
  const activeShadow: ViewStyle = active
    ? {
        shadowColor: c.active.glowColor,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: c.active.glowOpacity,
        shadowRadius: c.active.glowRadius,
        elevation: c.active.glowElevation,
      }
    : {};

  const iconColor = active ? c.active.iconColor : c.inactive.iconColorStrong;

  const a11yLabel = useMemo<string>(() => {
    if (typeof badge === 'number' && badge > 0) {
      return `${accessibilityLabel}, ${badge} unread`;
    }
    return accessibilityLabel;
  }, [accessibilityLabel, badge]);

  const badgeText = useMemo<string | null>(() => {
    if (badge == null || badge <= 0) return null;
    if (badge > 99) return '99+';
    return String(badge);
  }, [badge]);

  return (
    <Animated.View
      style={[
        styles.base,
        baseStyle,
        activeShadow,
        { transform: [{ scale: pressScale }] },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        hitSlop={c.button.hitSlop}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityState={active ? { expanded: true } : undefined}
        style={styles.pressable}
      >
        {/* L1 — blur or solid fallback */}
        {useGlass ? (
          <BlurView
            intensity={c.blur.intensity}
            tint={c.blur.tint}
            pointerEvents="none"
            experimentalBlurMethod={
              Platform.OS === 'android' ? 'dimezisBlurView' : undefined
            }
            style={StyleSheet.absoluteFill}
          />
        ) : (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: c.fallback.solid }]}
          />
        )}

        {/* L2 — tint floor (glass only) */}
        {useGlass ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: c.tint.floor }]}
          />
        ) : null}

        {/* L2b — active orange tint overlay */}
        {active ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: c.active.tint }]}
          />
        ) : null}

        {/* L2c — pressed-state darkening */}
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: useGlass ? c.tint.pressed : c.fallback.solid, opacity: pressTintOpacity },
          ]}
        />

        {/* ORCH-0589 v4 (V5): top-highlight line removed — rendered as visible
            artifact on chrome scale. Full-perimeter hairline border remains. */}

        {/* L4 — active orange border override (on top of hairline border) */}
        {active ? (
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                borderRadius: resolvedRadius,
                borderWidth: 1,
                borderColor: c.active.border,
              },
            ]}
          />
        ) : null}

        {/* Icon */}
        <View style={styles.content} pointerEvents="none">
          <Icon name={iconName} size={c.button.iconSize} color={iconColor} />
        </View>
      </Pressable>

      {/* Unread badge overlay */}
      {badgeText != null ? (
        <View style={styles.badgeContainer} pointerEvents="none">
          <View
            style={[
              styles.badge,
              badgeText === '99+' && styles.badgeWide,
              badgeText.length === 2 && styles.badgeMedium,
            ]}
          >
            <Text style={styles.badgeText} allowFontScaling={false}>
              {badgeText}
            </Text>
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  base: {
    overflow: 'visible', // badge sits outside
    // L5 drop shadow — default; overridden by activeShadow when active=true
    shadowColor: glass.chrome.shadow.color,
    shadowOffset: glass.chrome.shadow.offset,
    shadowOpacity: glass.chrome.shadow.opacity,
    shadowRadius: glass.chrome.shadow.radius,
    elevation: glass.chrome.shadow.elevation,
  },
  pressable: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: glass.chrome.button.radius,
    borderWidth: 1,
    borderColor: glass.chrome.border.hairline,
    overflow: 'hidden',
  },
  // ORCH-0589 v4 (V5): topHighlight style deleted.
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeContainer: {
    position: 'absolute',
    top: -2,
    right: -2,
  },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: glass.chrome.badge.bgColor,
    borderWidth: glass.chrome.badge.borderWidth,
    borderColor: glass.chrome.badge.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeMedium: {
    minWidth: 20,
  },
  badgeWide: {
    minWidth: 24,
  },
  badgeText: {
    color: glass.chrome.badge.textColor,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});

export default GlassIconButton;
