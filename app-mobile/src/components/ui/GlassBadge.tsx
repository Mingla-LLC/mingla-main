/**
 * GlassBadge — premium glassmorphism chip for discovery cards.
 *
 * Five-layer stack:
 *   L1 BlurView (intensity 24, dark tint) — real backdrop blur
 *   L2 tint floor rgba(12,14,18,0.42) — readability floor on bright photos
 *   L3 top highlight 1px rgba(255,255,255,0.22) — light on the top bevel
 *   L4 border 1px rgba(255,255,255,0.14) — hairline cut line
 *   L5 drop shadow — lifts chip off the photo
 *
 * Fallback paths (render a solid tile with identical border + shadow — silhouette preserved):
 *   - iOS with Reduce Transparency enabled (reactive listener)
 *   - Android API < 31 (one-shot Platform check at mount)
 *
 * Entry motion: pass `entryIndex` to animate in with stagger (opacity 0→1 + translateY 8→0,
 * 220ms ease-out, 40ms × index delay). Omit for static render (e.g., nextCard preview).
 *
 * Spec: Mingla_Artifacts/outputs/SPEC_ORCH-0566_GLASS_CARD_LABELS.md
 * Tokens: designSystem.ts → glass.badge.*
 */
import React, { useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Animated,
  Easing,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Icon, type IconName } from './Icon';
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from '../../constants/designSystem';
import { useA11yPreferences } from '../../hooks/useA11yPreferences';

const t = glass.badge;

export type GlassBadgeProps = {
  /**
   * #1609 — `accent` is the curated card's LEADING chip. It is the same five-layer
   * stack with the tint + border swapped for the existing glass.chrome.active values,
   * so it introduces no new token. It is deliberately never the ONLY differentiator:
   * the curated chip also carries a distinct icon and the word "Plan".
   */
  variant?: 'default' | 'circular' | 'accent';
  iconName?: IconName;
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  /**
   * When provided, the badge animates in with opacity + translateY stagger
   * (delay = entryIndex × 40ms). Omit for non-animated render (e.g., preview layers).
   * Reduced Motion is respected — animation is skipped when enabled.
   */
  entryIndex?: number;
  /**
   * #1609 — light-fill ("liquid") glass, for chips sitting ON the deck scrim rather
   * than on bare photo. Swaps the darkening `tint.floor` for `liquid.fill`, brightens
   * the rim and the specular top bevel. Same idiom as GlassIconButton's `liquid`.
   * Derivation + measured L* values: designSystem.ts → glass.badge.liquid.
   */
  liquid?: boolean;
};

// META-ORCH-1002 Sub-1 (S2): shared Android-opaque-fallback gate (was the per-component Android-11 version gate).
const isAndroidPreBlur = ANDROID_GLASS_USES_OPAQUE_FALLBACK;

export const GlassBadge: React.FC<GlassBadgeProps> = ({
  variant = 'default',
  iconName,
  children,
  onPress,
  accessibilityLabel,
  entryIndex,
  liquid = false,
}) => {
  // Issue #1638 — shared app-wide probe instead of a PER-INSTANCE one. Badges are
  // rendered several to a card, so this component multiplied the per-mount
  // per-instance a11y-probe cost more than any other. See useA11yPreferences.ts.
  const { reduceTransparency, reduceMotion } = useA11yPreferences();

  const useGlass = !reduceTransparency && !isAndroidPreBlur;
  const animateEntry = typeof entryIndex === 'number' && !reduceMotion;

  // Entry motion — resets on mount (card key changes → new mount → new stagger).
  const entryOpacity = useRef(new Animated.Value(animateEntry ? 0 : 1)).current;
  const entryTranslateY = useRef(
    new Animated.Value(animateEntry ? t.motion.entryTranslateY : 0),
  ).current;

  useEffect(() => {
    if (!animateEntry) {
      entryOpacity.setValue(1);
      entryTranslateY.setValue(0);
      return;
    }
    const delay = (entryIndex ?? 0) * t.motion.staggerMs;
    Animated.parallel([
      Animated.timing(entryOpacity, {
        toValue: 1,
        duration: t.motion.entryDurationMs,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(entryTranslateY, {
        toValue: 0,
        duration: t.motion.entryDurationMs,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [animateEntry, entryIndex, entryOpacity, entryTranslateY]);

  // Press-feedback animations (only active when onPress provided).
  const pressScale = useRef(new Animated.Value(1)).current;
  const pressTintOpacity = useRef(new Animated.Value(0)).current;

  const handlePressIn = (): void => {
    if (Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
        // Haptics failure is non-fatal.
      });
    }
    Animated.parallel([
      Animated.timing(pressScale, {
        toValue: t.motion.pressScale,
        duration: t.motion.pressDurationMs,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(pressTintOpacity, {
        toValue: 1,
        duration: t.motion.pressDurationMs,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
  };

  const handlePressOut = (): void => {
    Animated.parallel([
      Animated.timing(pressScale, {
        toValue: 1,
        duration: t.motion.pressDurationMs,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(pressTintOpacity, {
        toValue: 0,
        duration: t.motion.pressDurationMs,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }),
    ]).start();
  };

  const shapeStyle: ViewStyle = useMemo(() => {
    if (variant === 'circular') {
      return {
        width: t.size.circular,
        height: t.size.circular,
        borderRadius: t.radius.circular,
        alignItems: 'center',
        justifyContent: 'center',
      };
    }
    return {
      paddingHorizontal: t.padding.horizontal,
      paddingVertical: t.padding.vertical,
      borderRadius: t.radius.default,
    };
  }, [variant]);

  const resolvedLabel = useMemo<string>(() => {
    if (accessibilityLabel) return accessibilityLabel;
    if (typeof children === 'string' || typeof children === 'number') {
      return String(children);
    }
    return '';
  }, [accessibilityLabel, children]);

  const innerLayers = (
    <>
      {/* L1 — blur or solid fallback */}
      {useGlass ? (
        <BlurView
          intensity={liquid ? t.liquid.blurIntensity : t.blur.intensity}
          tint={liquid ? t.liquid.blurTint : t.blur.tint}
          pointerEvents="none"
          experimentalBlurMethod={
            Platform.OS === 'android' ? 'dimezisBlurView' : undefined
          }
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: liquid ? t.liquid.fallbackSolid : t.fallback.solid },
          ]}
        />
      )}

      {/* L2 — tint floor (glass path only; fallback is already dark).
          #1609: the accent variant paints its tint on BOTH paths, because on the
          opaque Android fallback there is no floor layer to tint and the chip would
          otherwise lose its accent entirely. */}
      {useGlass ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor:
                variant === 'accent'
                  ? glass.chrome.active.tint
                  : liquid
                    ? t.liquid.fill
                    : t.tint.floor,
            },
          ]}
        />
      ) : variant === 'accent' ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: glass.chrome.active.tint }]}
        />
      ) : null}

      {/* L2b — pressed-state tint overlay */}
      {onPress ? (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: useGlass ? t.tint.pressed : t.fallback.solid,
              opacity: pressTintOpacity,
            },
          ]}
        />
      ) : null}

      {/* L3 — top highlight (the specular bevel; brighter on the liquid path) */}
      <View
        pointerEvents="none"
        style={[
          styles.topHighlight,
          liquid ? { backgroundColor: t.liquid.topHighlight } : null,
        ]}
      />

      {/* Content */}
      <View style={variant === 'circular' ? styles.contentCircular : styles.contentRow}>
        {iconName ? (
          <Icon
            name={iconName}
            size={t.icon.size}
            color={t.icon.color}
            style={styles.icon}
          />
        ) : null}
        <Text
          style={variant === 'circular' ? styles.textCircular : styles.textDefault}
          numberOfLines={1}
          allowFontScaling={variant !== 'circular'}
        >
          {children}
        </Text>
      </View>
    </>
  );

  const baseBoxStyle: StyleProp<ViewStyle> = [
    styles.base,
    shapeStyle,
    liquid ? { borderColor: t.liquid.border } : null,
    // accent keeps its orange rim — it is already a lightening fill and reads.
    variant === 'accent' ? { borderColor: glass.chrome.active.border } : null,
  ];

  const animatedOuterStyle = {
    opacity: entryOpacity,
    transform: onPress
      ? [{ translateY: entryTranslateY }, { scale: pressScale }]
      : [{ translateY: entryTranslateY }],
  };

  if (onPress) {
    return (
      <Animated.View style={[baseBoxStyle, animatedOuterStyle]}>
        <Pressable
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          hitSlop={t.hitSlop}
          accessibilityRole="button"
          accessibilityLabel={resolvedLabel}
          style={styles.pressable}
        >
          {innerLayers}
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[baseBoxStyle, animatedOuterStyle]}
      accessibilityRole="text"
      accessibilityLabel={resolvedLabel}
    >
      {innerLayers}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: glass.badge.border.hairline,
    shadowColor: glass.badge.shadow.color,
    shadowOffset: glass.badge.shadow.offset,
    shadowOpacity: glass.badge.shadow.opacity,
    shadowRadius: glass.badge.shadow.radius,
    elevation: glass.badge.shadow.elevation,
    alignSelf: 'flex-start',
  },
  pressable: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: glass.badge.border.topHighlight,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: glass.badge.gap,
  },
  contentCircular: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  icon: {
    opacity: glass.badge.icon.opacity,
  },
  textDefault: {
    color: glass.badge.text.color,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.2,
    lineHeight: 18,
  },
  textCircular: {
    color: glass.badge.text.color,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
    textAlign: 'center',
  },
});

export default GlassBadge;
