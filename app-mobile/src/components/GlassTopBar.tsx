/**
 * GlassTopBar — host container for the floating chrome above the Swipe page (ORCH-0589).
 *
 * Layout: safeAreaTop + 8 → horizontal row containing
 *   [44 Preferences] gap:12 [flex:1 SessionSwitcher] gap:12 [44 Notifications]
 *
 * Mounts only when `visible === true` (caller controls via `currentPage === 'home'`).
 * Fade + translateY enter/exit per spec §6.2.
 *
 * Spec: SPEC_ORCH-0589_FLOATING_GLASS_HOME.md §4.5
 * Tokens: designSystem.ts → glass.chrome.*
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Easing,
  AccessibilityInfo,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassIconButton } from './ui/GlassIconButton';
import { glass } from '../constants/designSystem';

const c = glass.chrome;

export type GlassTopBarProps = {
  visible: boolean;
  onOpenPreferences: () => void;
  onOpenNotifications: () => void;
  /** Null/0 hides the badge. */
  unreadNotifications: number;
  /** Pre-rendered GlassSessionSwitcher so the host stays layout-only. */
  sessionSwitcher: React.ReactNode;
  preferencesActive?: boolean;
  notificationsActive?: boolean;
  /** ORCH-0635: coach-mark target ref for the Preferences button (step 2). */
  coachPrefsRef?: (node: View | null) => void;
};

export const GlassTopBar: React.FC<GlassTopBarProps> = ({
  visible,
  onOpenPreferences,
  onOpenNotifications,
  unreadNotifications,
  sessionSwitcher,
  preferencesActive = false,
  notificationsActive = false,
  coachPrefsRef,
}) => {
  const insets = useSafeAreaInsets();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [mounted, setMounted] = useState(visible);

  // ORCH-0589 v3 (R3): Reduce-Transparency listener for the new backdrop layer —
  // when enabled (iOS setting or Android API < 31), swap BlurView for a solid tile.
  useEffect(() => {
    let m = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((rt) => {
        if (m) setReduceTransparency(rt);
      })
      .catch(() => {
        // Non-fatal: default to solid-tile fallback (more readable).
        if (m) setReduceTransparency(true);
      });
    const sub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      (enabled: boolean) => setReduceTransparency(enabled),
    );
    return () => {
      m = false;
      sub.remove();
    };
  }, []);

  const isAndroidPreBlur = Platform.OS === 'android' && Platform.Version < 31;
  const useBackdropGlass = !reduceTransparency && !isAndroidPreBlur;

  useEffect(() => {
    let m = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((rm) => {
        if (m) setReduceMotion(rm);
      })
      .catch(() => {
        // Non-fatal; default to motion on.
      });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (rm: boolean) => setReduceMotion(rm),
    );
    return () => {
      m = false;
      sub.remove();
    };
  }, []);

  // Always initialize hidden so the enter animation fires on first mount when visible=true.
  // This matches spec SC-7: "re-appears on Swipe with fade+slide" every time HomePage mounts.
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-c.motion.showTranslateY)).current;

  useEffect(() => {
    if (visible && !mounted) setMounted(true);

    if (reduceMotion) {
      opacity.setValue(visible ? 1 : 0);
      translateY.setValue(visible ? 0 : -c.motion.showTranslateY);
      if (!visible) setMounted(false);
      return;
    }

    if (visible) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: c.motion.showDurationMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: c.motion.showDurationMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: c.motion.hideDurationMs,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -c.motion.showTranslateY,
          duration: c.motion.hideDurationMs,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [visible, reduceMotion, opacity, translateY, mounted]);

  if (!mounted) return null;

  // R3: backdrop covers from the very top of the screen (status bar included) down past
  // the top-bar row, with a soft gradient at the bottom that fades into the card.
  const backdropCoreHeight =
    insets.top + c.row.topInset + c.button.size + c.backdrop.extraBottomPad;
  const backdropTotalHeight = backdropCoreHeight + c.backdrop.fadeHeight;

  return (
    <>
      {/* ORCH-0589 v3 (R3): blurred header backdrop — contained glass canvas for the
          system status bar + Mingla chrome. Shares enter/exit animation values with
          the row below so both fade/slide together. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.backdrop,
          {
            height: backdropTotalHeight,
            opacity,
            transform: [{ translateY }],
          },
        ]}
      >
        <View style={[StyleSheet.absoluteFill, { height: backdropCoreHeight }]}>
          {useBackdropGlass ? (
            <BlurView
              intensity={c.backdrop.intensity}
              tint="dark"
              experimentalBlurMethod={
                Platform.OS === 'android' ? 'dimezisBlurView' : undefined
              }
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: c.backdrop.tint }]}
          />
        </View>
        {/* Bottom edge fade: near-opaque tint → transparent so the backdrop's
            bottom edge feathers into the card without a visible seam. */}
        <LinearGradient
          colors={[c.backdrop.tint, 'rgba(12,14,18,0)']}
          locations={[0, 1]}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: backdropCoreHeight,
            height: c.backdrop.fadeHeight,
          }}
        />
      </Animated.View>

      {/* Top-bar row (existing) */}
      <Animated.View
        pointerEvents={visible ? 'box-none' : 'none'}
        style={[
          styles.container,
          {
            top: insets.top + c.row.topInset,
            paddingHorizontal: c.row.horizontalInsetTop,
            opacity,
            transform: [{ translateY }],
          },
        ]}
      >
        <View style={styles.row} pointerEvents="box-none">
          {/* ORCH-0635: coach-mark target wrapper for step 2 (Your taste, your rules).
              Transparent View; GlassIconButton renders identically inside. */}
          <View ref={coachPrefsRef} collapsable={false}>
            <GlassIconButton
              iconName="options-outline"
              onPress={onOpenPreferences}
              active={preferencesActive}
              accessibilityLabel="Preferences"
            />
          </View>
          <View style={styles.center} pointerEvents="box-none">
            {sessionSwitcher}
          </View>
          <GlassIconButton
            iconName="notifications-outline"
            onPress={onOpenNotifications}
            active={notificationsActive}
            accessibilityLabel="Notifications"
            badge={unreadNotifications > 0 ? unreadNotifications : null}
          />
        </View>
      </Animated.View>
    </>
  );
};

const styles = StyleSheet.create({
  // ORCH-0589 v3 (R3): backdrop sits under the top-bar row, overflows upward to
  // cover the status-bar area, and has a gradient fade at its bottom.
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 49, // just below the row (50) so the row renders over it
    overflow: 'hidden',
  },
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 50,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: glass.chrome.button.size,
    gap: glass.chrome.row.buttonSwitcherGap,
  },
  center: {
    flex: 1,
  },
});

export default GlassTopBar;
