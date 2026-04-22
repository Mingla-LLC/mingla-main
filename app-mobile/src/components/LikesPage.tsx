/**
 * LikesPage — Saved + Calendar tabs behind a glass header with orange-spotlight
 * pill switcher. ORCH-0610: matches the Home / Discover / Friends glass language;
 * the pill switcher mirrors GlassBottomNav's spotlight pattern.
 */
import React, { useState, useEffect, useRef } from "react";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  Platform,
  AccessibilityInfo,
  Animated,
  Easing,
} from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Icon, type IconName } from './ui/Icon';
import SavedTab from "./activity/SavedTab";
import CalendarTab from "./activity/CalendarTab";
import { mixpanelService } from "../services/mixpanelService";
import { useScreenLogger } from "../hooks/useScreenLogger";
import { useAppLayout } from "../hooks/useAppLayout";
import { glass } from "../constants/designSystem";
import { useTranslation } from 'react-i18next';

// Tab types for Likes screen
export type LikesTab = "saved" | "calendar";

const isAndroidPreBlur = Platform.OS === 'android' && Platform.Version < 31;

interface LikesPageProps {
  isTabVisible?: boolean;
  savedCards?: any[];
  userPreferences?: any;
  accountPreferences?: {
    currency: string;
    measurementSystem: "Metric" | "Imperial";
  };
  calendarEntries?: any[];
  isLoadingSavedCards?: boolean;
  isSavedCardsError?: boolean;
  onRetrySavedCards?: () => void;
  isLoadingCalendarEntries?: boolean;
  onScheduleFromSaved?: (savedCard: any) => void;
  onPurchaseFromSaved?: (card: any, purchaseOption: any) => void;
  onRemoveFromCalendar?: (entry: any) => void;
  onShareCard?: (card: any) => void;
  onAddToCalendar?: (entry: any) => void;
  onShowQRCode?: (entryId: string) => void;
  navigationData?: {
    activeTab?: LikesTab;
  } | null;
  onNavigationComplete?: () => void;
}

export default function LikesPage({
  savedCards,
  userPreferences,
  accountPreferences,
  calendarEntries = [],
  isLoadingSavedCards = false,
  isSavedCardsError = false,
  onRetrySavedCards,
  isLoadingCalendarEntries = false,
  onScheduleFromSaved,
  onPurchaseFromSaved,
  onRemoveFromCalendar,
  onShareCard,
  onAddToCalendar,
  onShowQRCode,
  navigationData,
  onNavigationComplete,
}: LikesPageProps): React.ReactElement {
  useScreenLogger('likes');
  const { t } = useTranslation(['saved']);
  const insets = useSafeAreaInsets();
  const { bottomNavTotalHeight } = useAppLayout();
  const [activeTab, setActiveTab] = useState<LikesTab>("saved");

  // ── Accessibility state (glass + spotlight motion) ───────────
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
      } catch {
        if (mounted) {
          setReduceTransparency(true);
          setReduceMotion(true);
        }
      }
    })();
    const rtSub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduceTransparency);
    const rmSub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      rtSub.remove();
      rmSub.remove();
    };
  }, []);

  const useGlass = !reduceTransparency && !isAndroidPreBlur;

  // ── External navigation ────────────────────────────────
  useEffect(() => {
    if (navigationData) {
      if (navigationData.activeTab) {
        setActiveTab(navigationData.activeTab);
      }
      if (onNavigationComplete) {
        onNavigationComplete();
      }
    }
  }, [navigationData, onNavigationComplete]);

  const handleTabChange = (tab: LikesTab): void => {
    if (tab === activeTab) return;
    if (Platform.OS === "ios") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    setActiveTab(tab);
    mixpanelService.trackTabViewed({ screen: "Likes", tab: tab === "saved" ? "Saved" : "Calendar" });
  };

  // ── Glass header geometry ──────────────────────────────
  const g = glass.discover;
  const c = glass.chrome;
  const TITLE_TOP = insets.top + c.row.topInset;
  const TITLE_BAND_HEIGHT = 36;
  const PILL_BAR_HEIGHT = 52;
  const PILL_BAR_TOP = TITLE_TOP + TITLE_BAND_HEIGHT;
  const HEADER_PANEL_HEIGHT = PILL_BAR_TOP + PILL_BAR_HEIGHT + 4;
  const HEADER_PANEL_RADIUS = 28;

  // ── Spotlight pill switcher (mirrors GlassBottomNav pattern) ──
  const TABS: Array<{ id: LikesTab; label: string; icon: IconName }> = [
    { id: "saved", label: t('saved:tab_saved'), icon: "bookmark-outline" },
    { id: "calendar", label: t('saved:tab_calendar'), icon: "calendar-outline" },
  ];

  const tabLayoutsRef = useRef<Record<LikesTab, { x: number; width: number } | undefined>>({
    saved: undefined,
    calendar: undefined,
  });
  const [layoutTick, setLayoutTick] = useState(0);
  const spotlightX = useRef(new Animated.Value(0)).current;
  const spotlightWidth = useRef(new Animated.Value(0)).current;

  const handleTabLayout = (id: LikesTab, x: number, width: number): void => {
    tabLayoutsRef.current[id] = { x, width };
    setLayoutTick((v) => v + 1);
  };

  // ORCH-0610: layoutTick dep included so the spotlight re-fires when onLayout
  // arrives for the first time (mirrors GlassBottomNav R6 fix).
  useEffect(() => {
    const layout = tabLayoutsRef.current[activeTab];
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
  }, [activeTab, layoutTick, reduceMotion, spotlightX, spotlightWidth, c.motion.springDamping, c.motion.springStiffness, c.motion.springMass, c.nav.spotlightInset]);

  return (
    <View style={styles.container}>
      {/* Glass header panel — status bar + title + pill switcher */}
      <View
        pointerEvents="box-none"
        style={[
          styles.headerPanel,
          {
            height: HEADER_PANEL_HEIGHT,
            borderBottomLeftRadius: HEADER_PANEL_RADIUS,
            borderBottomRightRadius: HEADER_PANEL_RADIUS,
          },
        ]}
      >
        {useGlass ? (
          <BlurView
            intensity={g.stickyHeader.blurIntensity}
            tint="dark"
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        ) : null}
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: useGlass ? g.stickyHeader.tint : g.stickyHeader.fallbackSolid },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.headerPanelHairline,
            { borderBottomLeftRadius: HEADER_PANEL_RADIUS, borderBottomRightRadius: HEADER_PANEL_RADIUS },
          ]}
        />

        {/* Title row */}
        <View
          pointerEvents="none"
          style={[styles.titleRow, { top: TITLE_TOP, height: TITLE_BAND_HEIGHT }]}
        >
          <Text style={styles.titleText} numberOfLines={1} allowFontScaling accessibilityRole="header">
            {t('saved:page_title', 'Likes')}
          </Text>
        </View>

        {/* Spotlight pill switcher — mirrors GlassBottomNav pattern */}
        <View style={[styles.pillBarAbsolute, { top: PILL_BAR_TOP, height: PILL_BAR_HEIGHT }]}>
          <View style={styles.pillBarCapsule}>
            {/* Orange spotlight */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.spotlight,
                { left: spotlightX, width: spotlightWidth },
              ]}
            />
            {/* Tabs */}
            <View style={styles.tabsRow}>
              {TABS.map((tab) => {
                const active = tab.id === activeTab;
                return (
                  <Pressable
                    key={tab.id}
                    onPress={() => handleTabChange(tab.id)}
                    onLayout={(e) => {
                      const { x, width } = e.nativeEvent.layout;
                      handleTabLayout(tab.id, x, width);
                    }}
                    style={styles.tab}
                    accessibilityRole="tab"
                    accessibilityLabel={tab.label}
                    accessibilityState={{ selected: active }}
                  >
                    <Icon
                      name={tab.icon}
                      size={16}
                      color={active ? c.active.iconColor : c.inactive.iconColor}
                    />
                    <Text
                      style={[
                        styles.tabLabel,
                        active ? styles.tabLabelActive : styles.tabLabelInactive,
                      ]}
                      numberOfLines={1}
                      allowFontScaling
                    >
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </View>

      {/* Content */}
      <View
        style={[
          styles.content,
          {
            paddingTop: HEADER_PANEL_HEIGHT + 8,
            paddingBottom: bottomNavTotalHeight + 16,
          },
        ]}
      >
        {activeTab === "saved" && (
          <SavedTab
            savedCards={savedCards}
            calendarEntries={calendarEntries}
            isLoading={isLoadingSavedCards}
            isError={isSavedCardsError}
            onRetry={onRetrySavedCards}
            onScheduleFromSaved={onScheduleFromSaved || (() => {})}
            onPurchaseFromSaved={onPurchaseFromSaved || (() => {})}
            onShareCard={onShareCard || (() => {})}
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
          />
        )}

        {activeTab === "calendar" && (
          <CalendarTab
            calendarEntries={calendarEntries}
            isLoading={isLoadingCalendarEntries}
            onRemoveFromCalendar={onRemoveFromCalendar || (() => {})}
            onShareCard={onShareCard || (() => {})}
            onAddToCalendar={onAddToCalendar || (() => {})}
            onShowQRCode={onShowQRCode || (() => {})}
            userPreferences={userPreferences}
            accountPreferences={accountPreferences}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: glass.discover.screenBg,
  },
  content: {
    flex: 1,
  },

  // Glass header panel
  headerPanel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    overflow: 'hidden',
  },
  headerPanelHairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.discover.stickyHeader.bottomHairline,
  },
  titleRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: glass.discover.title.horizontalPadding,
    justifyContent: 'center',
  },
  titleText: {
    color: glass.discover.title.color,
    fontSize: glass.discover.title.fontSize,
    fontWeight: glass.discover.title.fontWeight,
    lineHeight: 36,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },

  // Pill bar
  pillBarAbsolute: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: glass.discover.filterBar.paddingHorizontal,
    justifyContent: 'center',
  },
  pillBarCapsule: {
    height: 44,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
  },
  tabsRow: {
    flex: 1,
    flexDirection: 'row',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  spotlight: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    borderRadius: 20,
    backgroundColor: glass.chrome.active.tint,
    borderWidth: 1,
    borderColor: glass.chrome.active.border,
    shadowColor: glass.chrome.active.glowColor,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: glass.chrome.active.glowOpacity,
    shadowRadius: glass.chrome.active.glowRadius,
    elevation: 4,
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: glass.chrome.active.labelColor,
    fontWeight: '600',
  },
  tabLabelInactive: {
    color: glass.chrome.inactive.labelColor,
  },
});
