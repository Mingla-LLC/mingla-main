/**
 * GlassCard — bento container for the Profile page (ORCH-0627).
 *
 * Layer stack (top to bottom):
 *   L1 BlurView (intensity from tokens, dark tint) — real backdrop blur
 *   L2 card bg tint (rgba white wash) — glass surface color
 *   L3 top highlight 1px (rgba white) — catches light on top edge
 *   L4 border 1px (rgba white hairline) — cut line all around
 *   L5 drop shadow — lifts card off the warm-charcoal canvas
 *
 * Fallback paths (render solid warm-dark tile with identical border + shadow):
 *   - iOS with Reduce Transparency enabled (reactive listener)
 *   - Android API < 31 (one-shot Platform check)
 *
 * Variants:
 *   - base:     glass.profile.card.*       (standard bento tile)
 *   - elevated: glass.profile.cardElevated.* (hero card — slightly lifted)
 *
 * Tokens: designSystem.ts → glass.profile.card / glass.profile.cardElevated
 * Spec:   Mingla_Artifacts/outputs/DESIGN_ORCH-0627_PROFILE_GLASS_REFRESH_SPEC.md §2
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Platform,
  AccessibilityInfo,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { glass } from '../../constants/designSystem';

export type GlassCardVariant = 'base' | 'elevated';

export type GlassCardProps = {
  variant?: GlassCardVariant;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

const isAndroidPreBlur = Platform.OS === 'android' && Platform.Version < 31;

export const GlassCard: React.FC<GlassCardProps> = ({
  variant = 'base',
  children,
  style,
  accessibilityLabel,
}) => {
  const [reduceTransparency, setReduceTransparency] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (mounted) setReduceTransparency(enabled);
      })
      .catch(() => {
        // Fall back to solid (more readable default) on init failure.
        if (mounted) setReduceTransparency(true);
      });

    const sub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      (enabled: boolean) => setReduceTransparency(enabled),
    );

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const t = variant === 'elevated' ? glass.profile.cardElevated : glass.profile.card;
  const useGlass = !reduceTransparency && !isAndroidPreBlur;

  const cardStyle: StyleProp<ViewStyle> = [
    styles.base,
    {
      borderRadius: t.radius,
      borderColor: t.border,
      borderWidth: t.borderWidth,
      marginHorizontal: t.marginHorizontal,
      marginBottom: t.marginBottom,
      paddingHorizontal: t.paddingHorizontal,
      paddingVertical: t.paddingVertical,
      shadowColor: t.shadow.color,
      shadowOffset: t.shadow.offset,
      shadowOpacity: t.shadow.opacity,
      shadowRadius: t.shadow.radius,
      elevation: t.shadow.elevation,
    },
    style,
  ];

  return (
    <View
      style={cardStyle}
      accessibilityLabel={accessibilityLabel}
    >
      {/* L1 — blur (iOS + Android API 31+) OR solid fallback */}
      {useGlass ? (
        <BlurView
          intensity={t.blurIntensity}
          tint="dark"
          pointerEvents="none"
          experimentalBlurMethod={
            Platform.OS === 'android' ? 'dimezisBlurView' : undefined
          }
          style={[StyleSheet.absoluteFill, { borderRadius: t.radius }]}
        />
      ) : (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: t.bgFallback, borderRadius: t.radius },
          ]}
        />
      )}

      {/* L2 — card bg tint (glass path only; fallback is already opaque) */}
      {useGlass ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: t.bg, borderRadius: t.radius },
          ]}
        />
      ) : null}

      {/* L3 — top highlight (catches the eye as a premium cue) */}
      <View
        pointerEvents="none"
        style={[
          styles.topHighlight,
          { backgroundColor: t.topHighlight, borderTopLeftRadius: t.radius, borderTopRightRadius: t.radius },
        ]}
      />

      {/* Content */}
      <View>{children}</View>
    </View>
  );
};

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
});

export default GlassCard;
