/**
 * GlassBottomNav — floating glass capsule with orange spotlight (ORCH-0589, Variant A).
 *
 * One glass capsule holding 5 tabs (icon + label, always visible).
 * Active tab is highlighted by an orange-tinted "spotlight" pill absolutely positioned
 * behind the active tab; it slides between tab positions on tap with a spring-like motion.
 *
 * Layers:
 *   L1 BlurView (intensity 28, dark tint) — container
 *   L2 tint floor
 *   L3 top highlight
 *   L4 hairline border
 *   L5 drop shadow
 *   Spotlight (absolute positioned, orange tint + border + glow)
 *
 * Fallback: solid tile for Reduce Transparency / Android API < 31. Spotlight orange stays.
 *
 * Spec: SPEC_ORCH-0589_FLOATING_GLASS_HOME.md §5 Variant A
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
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Icon, type IconName } from './ui/Icon';
import { glass } from '../constants/designSystem';

const c = glass.chrome;

export type BottomNavPage =
  | 'home'
  | 'discover'
  | 'connections'
  | 'likes'
  | 'profile';

type TabConfig = {
  key: BottomNavPage;
  icon: IconName;
  label: string;
};

export type GlassBottomNavProps = {
  currentPage: BottomNavPage;
  onNavigate: (page: BottomNavPage) => void;
  /** Labels are injected to allow i18n resolution by the parent. */
  labels: Record<BottomNavPage, string>;
  /** Unread count badges per tab (only connections + likes today). */
  badges?: Partial<Record<BottomNavPage, number>>;
};

const isAndroidPreBlur = Platform.OS === 'android' && Platform.Version < 31;

const TAB_ORDER: BottomNavPage[] = ['home', 'discover', 'connections', 'likes', 'profile'];

const ICON_MAP: Record<BottomNavPage, IconName> = {
  home: 'compass-outline',       // swipe deck (keep existing "explore" iconography semantic)
  discover: 'map-outline',
  connections: 'people-outline',
  likes: 'heart-outline',
  profile: 'person-outline',
};

export const GlassBottomNav: React.FC<GlassBottomNavProps> = ({
  currentPage,
  onNavigate,
  labels,
  badges,
}) => {
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async (): Promise<void> => {
      try {
        const [rt, rm] = await Promise.all([
          AccessibilityInfo.isReduceTransparencyEnabled(),
          AccessibilityInfo.isReduceMotionEnabled(),
        ]);
        if (mounted) {
          setReduceTransparency(rt);
          setReduceMotion(rm);
        }
      } catch (err) {
        if (__DEV__) console.warn('[GlassBottomNav] a11y init failed:', err);
        if (mounted) {
          setReduceTransparency(true);
          setReduceMotion(true);
        }
      }
    })();
    const rtSub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      (enabled: boolean) => setReduceTransparency(enabled),
    );
    const rmSub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => setReduceMotion(enabled),
    );
    return () => {
      mounted = false;
      rtSub.remove();
      rmSub.remove();
    };
  }, []);

  const useGlass = !reduceTransparency && !isAndroidPreBlur;

  // Track tab layout for spotlight positioning.
  const tabLayoutsRef = useRef<Record<BottomNavPage, { x: number; width: number } | undefined>>({
    home: undefined,
    discover: undefined,
    connections: undefined,
    likes: undefined,
    profile: undefined,
  });
  // ORCH-0589 v3 (R6): layoutTick is now READ as well as set — included in the
  // spotlight effect's dep array so the effect re-runs when tab layouts arrive.
  // v2 discarded the value, which meant onLayout re-renders didn't re-trigger the
  // spotlight-positioning effect → spotlight stayed at x:0, width:0 on first mount.
  const [layoutTick, setLayoutTick] = useState(0);

  const handleTabLayout = (key: BottomNavPage, x: number, width: number): void => {
    tabLayoutsRef.current[key] = { x, width };
    setLayoutTick((v) => v + 1);
  };

  // Spotlight animation: translateX + width interpolates to the active tab's position.
  const spotlightX = useRef(new Animated.Value(0)).current;
  const spotlightWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const layout = tabLayoutsRef.current[currentPage];
    if (!layout) return;
    const targetX = layout.x + c.nav.spotlightInset;
    const targetWidth = layout.width - c.nav.spotlightInset * 2;

    if (reduceMotion) {
      spotlightX.setValue(targetX);
      spotlightWidth.setValue(targetWidth);
      return;
    }

    Animated.parallel([
      Animated.spring(spotlightX, {
        toValue: targetX,
        damping: c.motion.springDamping,
        stiffness: c.motion.springStiffness,
        mass: c.motion.springMass,
        useNativeDriver: false,
      }),
      Animated.spring(spotlightWidth, {
        toValue: targetWidth,
        damping: c.motion.springDamping,
        stiffness: c.motion.springStiffness,
        mass: c.motion.springMass,
        useNativeDriver: false,
      }),
    ]).start();
    // R6 fix: layoutTick included so this effect re-runs when onLayout fires
    // for the active tab on first mount.
  }, [currentPage, layoutTick, reduceMotion, spotlightX, spotlightWidth]);

  return (
    <View style={styles.container}>
      {/* L1 — blur or fallback */}
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
      {/* L2 */}
      {useGlass ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: c.tint.floor }]}
        />
      ) : null}
      {/* ORCH-0589 v4 (V5): top-highlight line removed — see designSystem comment. */}

      {/* Spotlight */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.spotlight,
          {
            left: spotlightX,
            width: spotlightWidth,
          },
        ]}
      />

      {/* Tabs */}
      <View style={styles.tabsRow}>
        {TAB_ORDER.map((key) => {
          const active = key === currentPage;
          const badge = badges?.[key] ?? 0;
          return (
            <Pressable
              key={key}
              onPress={() => {
                if (active) return;
                if (Platform.OS === 'ios') {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
                }
                onNavigate(key);
              }}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                handleTabLayout(key, x, width);
              }}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityLabel={labels[key]}
              accessibilityState={{ selected: active }}
            >
              <View style={styles.tabIconWrap}>
                <Icon
                  name={ICON_MAP[key]}
                  size={c.nav.iconSize}
                  color={active ? c.nav.activeIconColor : c.inactive.iconColor}
                />
                {badge > 0 ? (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText} allowFontScaling={false}>
                      {badge > 99 ? '99+' : String(badge)}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                style={[
                  styles.tabLabel,
                  active ? styles.tabLabelActive : styles.tabLabelInactive,
                ]}
                numberOfLines={1}
              >
                {labels[key]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: glass.chrome.nav.capsuleHeight,
    borderRadius: glass.chrome.nav.radius,
    borderWidth: 1,
    borderColor: glass.chrome.border.hairline,
    overflow: 'hidden',
    shadowColor: glass.chrome.shadow.color,
    shadowOffset: glass.chrome.shadow.offset,
    shadowOpacity: glass.chrome.shadow.opacity,
    shadowRadius: glass.chrome.shadow.radius,
    elevation: glass.chrome.shadow.elevation,
  },
  // ORCH-0589 v4 (V5): topHighlight style deleted.
  tabsRow: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: glass.chrome.nav.horizontalPadding,
    paddingVertical: glass.chrome.nav.verticalPadding,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: glass.chrome.nav.labelGap,
  },
  tabIconWrap: {
    position: 'relative',
    width: glass.chrome.nav.iconSize + 4,
    height: glass.chrome.nav.iconSize + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
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
  tabBadgeText: {
    color: glass.chrome.badge.textColor,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  // ORCH-0589 v6.3 tune: fontSize 11 → 10 so the label sits tighter to the icon
  // under the active spotlight; the pair reads as one unit. Matches the labelGap: 3
  // token change in designSystem.ts.
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
  },
  // ORCH-0589 v3 (R7): unified with session-pill active — white label on translucent
  // orange glass (same tokens as glass.chrome.active.labelColor used in GlassSessionSwitcher).
  tabLabelActive: {
    color: glass.chrome.active.labelColor,
    fontWeight: '600',
  },
  tabLabelInactive: {
    color: glass.chrome.inactive.labelColor,
  },
  // ORCH-0589 v3 (R7): nav spotlight now matches session-pill active visual treatment —
  // translucent orange glass fill + orange hairline border + orange outer glow. One
  // unified active-state language across all chrome selection surfaces (sessions, nav,
  // icon buttons all use glass.chrome.active.*).
  spotlight: {
    position: 'absolute',
    top: glass.chrome.nav.verticalPadding,
    bottom: glass.chrome.nav.verticalPadding,
    borderRadius: glass.chrome.nav.spotlightRadius,
    backgroundColor: glass.chrome.active.tint,
    borderWidth: 1,
    borderColor: glass.chrome.active.border,
    shadowColor: glass.chrome.active.glowColor,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: glass.chrome.active.glowOpacity,
    shadowRadius: glass.chrome.active.glowRadius,
    elevation: 4,
  },
});

export default GlassBottomNav;
