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
} from "react-native";
// Issue #1638 — the header spotlight moved from RN `Animated` (JS thread) to Reanimated
// (UI thread), mirroring what ORCH-0995 already did for the bottom nav. That removed the
// file's only RN-`Animated`/`Easing` consumers, so both of those imports are gone and
// `Animated` here is Reanimated's.
//
// These names are deliberately NOT aliased. `react-native-worklets/plugin` decides what
// to auto-workletize by matching the CALLEE NAME, so an aliased `useAnimatedStyle` is
// silently left as a plain JS function and the app hard-crashes on the UI thread with
// "[Worklets] Tried to synchronously call a non-worklet function". Caught on-device.
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Icon, type IconName } from './ui/Icon';
import SavedTab from "./activity/SavedTab";
import CalendarTab from "./activity/CalendarTab";
import { mixpanelService } from "../services/mixpanelService";
import { useScreenLogger } from "../hooks/useScreenLogger";
import { useAppLayout } from "../hooks/useAppLayout";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../constants/designSystem";
import { useA11yPreferences } from "../hooks/useA11yPreferences";
import { useTranslation } from 'react-i18next';
import { useAppStore } from "../store/appStore";

// Tab types for Likes screen
export type LikesTab = "saved" | "calendar";

// META-ORCH-1002 Sub-1 (S2): shared Android-opaque-fallback gate (was the per-component Android-11 version gate).
const isAndroidPreBlur = ANDROID_GLASS_USES_OPAQUE_FALLBACK;

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
  /**
   * ORCH-1030: notification deep-link params for Likes (calendar/review routes).
   * `{ tab: 'calendar', entryId }` (calendar reminder) or
   * `{ tab: 'calendar', experienceId }` (review — v1 lands the Calendar
   * container, experienceId is carried, not dropped). Seeds the Calendar tab +
   * selects the entry. Mirrors the `navigationData`/`onNavigationComplete`
   * pattern. Consumed once, then `onDeepLinkHandled` clears it.
   */
  deepLinkParams?: Record<string, string> | null;
  onDeepLinkHandled?: () => void;
}

function LikesPage({
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
  deepLinkParams,
  onDeepLinkHandled,
}: LikesPageProps): React.ReactElement {
  // ORCH-0679 Wave 2A: Dev-only render counter (I-TAB-PROPS-STABLE verification).
  const renderCountRef = React.useRef(0);
  if (__DEV__) {
    renderCountRef.current += 1;
    console.log(`[render-count] LikesPage: ${renderCountRef.current}`);
  }

  useScreenLogger('likes');
  const { t } = useTranslation(['saved']);
  const insets = useSafeAreaInsets();
  const { bottomNavTotalHeight } = useAppLayout();
  // ORCH-0679 Wave 2.8.1: preserve inner-tab selection across tab unmount/remount.
  // Snapshot the registry at mount; sync via useEffect below.
  const likesActiveTabSnapshot = useAppStore.getState().likesActiveTab;
  const setLikesActiveTabRegistry = useAppStore((s) => s.setLikesActiveTab);
  const [activeTab, setActiveTab] = useState<LikesTab>(likesActiveTabSnapshot);
  useEffect(() => {
    setLikesActiveTabRegistry(activeTab);
  }, [activeTab, setLikesActiveTabRegistry]);

  // ── Accessibility state (glass + spotlight motion) ───────────
  // Issue #1638 — served from the shared app-wide probe. See useA11yPreferences.ts.
  const { reduceTransparency, reduceMotion } = useA11yPreferences();

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

  // ── Notification deep-link → Calendar entry select (ORCH-1030) ──
  // A `calendar_reminder_*` (entryId) or `review` (experienceId) notification
  // routes here with `deepLinkParams.tab === 'calendar'`. v1 = land the
  // Calendar tab and select the entry (CalendarTab auto-expands the match);
  // no scroll. The experienceId is carried, never silently dropped (F-11).
  const [deepLinkEntryId, setDeepLinkEntryId] = useState<string | null>(null);
  useEffect(() => {
    if (deepLinkParams?.tab === 'calendar') {
      setActiveTab('calendar');
      // entryId for calendar reminders; experienceId for review links (the
      // review's entry shares the experience id in v1 — carry it forward).
      setDeepLinkEntryId(deepLinkParams.entryId ?? deepLinkParams.experienceId ?? null);
      onDeepLinkHandled?.();
    }
  }, [deepLinkParams, onDeepLinkHandled]);

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
  // Issue #1638 — `left`/`width` now animate on the UI THREAD via Reanimated shared
  // values. They used to be an RN Animated.spring WITHOUT the native driver, i.e. a
  // JS-thread-driven layout spring, and its `layoutTick` dep guarantees it fires ONE
  // FRAME INTO THE NEW PAGE'S LIFE — precisely when the JS thread is busiest committing
  // the rest of the mount. ORCH-0995 already did exactly this migration for the bottom
  // nav (GlassBottomNav.tsx) and left the page headers behind; this closes that gap for
  // Likes. Reanimated animates `left`/`width` on the UI thread — it is NOT subject to the
  // RN-Animated native-driver restriction on layout props — and the resting geometry is
  // pixel-identical (true `left`/`width`, no scaleX radius distortion).
  const spotlightX = useSharedValue(0);
  const spotlightWidth = useSharedValue(0);

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
      // Instant set, no animation (a11y reduce-motion path preserved).
      spotlightX.value = targetX;
      spotlightWidth.value = targetWidth;
      return;
    }
    // designSystem motion tokens map 1:1 onto Reanimated withSpring config.
    const springConfig = {
      damping: c.motion.springDamping,
      stiffness: c.motion.springStiffness,
      mass: c.motion.springMass,
    };
    spotlightX.value = withSpring(targetX, springConfig);
    spotlightWidth.value = withSpring(targetWidth, springConfig);
  }, [activeTab, layoutTick, reduceMotion, spotlightX, spotlightWidth, c.motion.springDamping, c.motion.springStiffness, c.motion.springMass, c.nav.spotlightInset]);

  // UI-thread animated style for the spotlight pill (left + width).
  const spotlightAnimatedStyle = useAnimatedStyle(() => ({
    left: spotlightX.value,
    width: spotlightWidth.value,
  }));

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
              style={[styles.spotlight, spotlightAnimatedStyle]}
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

      {/* Content
          ORCH-1189: the `content` View carries paddingTop ONLY (header clearance).
          It must NOT carry a frame-shrinking `paddingBottom` — that would lift the
          ScrollView frame up off the physical screen bottom and expose the black
          app-root background (#000/#0c0e12) below it as a "black bar" under the
          floating GlassBottomNav. Instead, `content` paints full-bleed to the
          screen bottom (covering the black root) and the floating-nav clearance is
          applied on each tab's INNER scroll `contentContainerStyle.paddingBottom`
          via the threaded `bottomNavTotalHeight` prop — mirroring ConnectionsPage
          (`content` = paddingTop only; chat list = `bottomNavTotalHeight + 24`). */}
      <View
        style={[
          styles.content,
          {
            paddingTop: HEADER_PANEL_HEIGHT + 8,
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
            bottomNavTotalHeight={bottomNavTotalHeight}
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
            selectedEntryId={deepLinkEntryId}
            bottomNavTotalHeight={bottomNavTotalHeight}
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

// ORCH-0679 Wave 2A: I-TAB-SCREENS-MEMOIZED.
export default React.memo(LikesPage);
