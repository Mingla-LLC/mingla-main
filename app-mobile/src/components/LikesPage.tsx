/**
 * LikesPage — Saved + Calendar tabs behind a glass header. ORCH-0610: matches the
 * Home / Discover / Friends glass language.
 *
 * Issue #4265: the full-width orange segmented bar is replaced by the design's
 * small, left-aligned pill switcher (Main.dc.html) — a 4pt-padded, fully
 * rounded quiet capsule holding two 32pt pills; the selected one is white with
 * dark text. The white pill glides 150 ms between the two (instant under
 * reduce motion).
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
  withTiming,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
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

// Issue #4265: small Saved | Calendar switcher tokens.
const S = glass.likes.switcher;
// 32pt pills + 6pt vertical slop each side = a 44pt touch target.
const SWITCHER_HIT_SLOP = { top: 6, bottom: 6, left: 0, right: 0 } as const;

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
  /** Issue #4265: "Find something" / "Find similar" land on Explore. */
  onExplore?: () => void;
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
  onExplore,
}: LikesPageProps): React.ReactElement {
  // ORCH-0679 Wave 2A: Dev-only render counter (I-TAB-PROPS-STABLE verification).
  const renderCountRef = React.useRef(0);
  if (__DEV__) {
    renderCountRef.current += 1;
    console.log(`[render-count] LikesPage: ${renderCountRef.current}`);
  }

  useScreenLogger('likes');
  const { t } = useTranslation(['saved', 'activity']);
  // Issue #4265: "N saved" on the title row, reported by SavedTab net of cards
  // still inside their Undo window. Hidden on Calendar, loading and error.
  const [savedCount, setSavedCount] = useState<number | null>(null);
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
  // Issue #4265: the switcher band keeps its 52pt height (the small 40pt
  // switcher sits 8pt below the title inside it), so HEADER_PANEL_HEIGHT — and
  // with it the content paddingTop BOTH tabs rely on — is unchanged.
  const g = glass.discover;
  const c = glass.chrome;
  const TITLE_TOP = insets.top + c.row.topInset;
  const TITLE_BAND_HEIGHT = 36;
  const PILL_BAR_HEIGHT = 52;
  const PILL_BAR_TOP = TITLE_TOP + TITLE_BAND_HEIGHT;
  const HEADER_PANEL_HEIGHT = PILL_BAR_TOP + PILL_BAR_HEIGHT + 4;
  const HEADER_PANEL_RADIUS = 28;

  // ── Small pill switcher (Issue #4265) ──────────────────
  const TABS: Array<{ id: LikesTab; label: string }> = [
    { id: "saved", label: t('saved:tab_saved') },
    { id: "calendar", label: t('saved:tab_calendar') },
  ];

  const tabLayoutsRef = useRef<Record<LikesTab, { x: number; width: number } | undefined>>({
    saved: undefined,
    calendar: undefined,
  });
  const [layoutTick, setLayoutTick] = useState(0);
  // Issue #1638 — geometry animates on the UI THREAD via Reanimated shared
  // values (never a JS-thread layout spring one frame into the page's life).
  const pillX = useSharedValue(0);
  const pillWidth = useSharedValue(0);
  const pillPlacedRef = useRef(false);

  const handleTabLayout = (id: LikesTab, x: number, width: number): void => {
    tabLayoutsRef.current[id] = { x, width };
    setLayoutTick((v) => v + 1);
  };

  // layoutTick dep: re-fires when onLayout arrives for the first time.
  useEffect(() => {
    const layout = tabLayoutsRef.current[activeTab];
    if (!layout) return;
    const targetX = layout.x;
    const targetWidth = layout.width;
    // First placement and reduce motion: no glide.
    if (reduceMotion || !pillPlacedRef.current) {
      pillPlacedRef.current = true;
      pillX.value = targetX;
      pillWidth.value = targetWidth;
      return;
    }
    const timing = { duration: glass.likes.switcher.moveMs };
    pillX.value = withTiming(targetX, timing);
    pillWidth.value = withTiming(targetWidth, timing);
  }, [activeTab, layoutTick, reduceMotion, pillX, pillWidth]);

  // UI-thread animated style for the white pill (left + width).
  const pillAnimatedStyle = useAnimatedStyle(() => ({
    left: pillX.value,
    width: pillWidth.value,
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
          {activeTab === "saved" && savedCount !== null && savedCount > 0 ? (
            <Text style={styles.countText} numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {t('activity:savedTab.countSaved', { count: savedCount })}
            </Text>
          ) : null}
        </View>

        {/* Issue #4265: small left-aligned pill switcher */}
        <View style={[styles.switcherBand, { top: PILL_BAR_TOP, height: PILL_BAR_HEIGHT }]}>
          <View style={styles.switcher} accessibilityRole="tablist">
            {/* The white selected pill */}
            <Animated.View pointerEvents="none" style={[styles.switcherPill, pillAnimatedStyle]} />
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
                  hitSlop={SWITCHER_HIT_SLOP}
                  style={styles.switcherTab}
                  accessibilityRole="tab"
                  accessibilityLabel={tab.label}
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={[
                      styles.switcherLabel,
                      active ? styles.switcherLabelActive : styles.switcherLabelInactive,
                    ]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.3}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
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
            onExplore={onExplore}
            onSavedCountChange={setSavedCount}
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
    // Issue #4265: title left, "N saved" right on the same row.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  countText: {
    color: glass.likes.textSecondary,
    fontSize: 13,
    flexShrink: 0,
  },
  titleText: {
    flexShrink: 1,
    color: glass.discover.title.color,
    fontSize: glass.discover.title.fontSize,
    fontWeight: glass.discover.title.fontWeight,
    lineHeight: 36,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },

  // Issue #4265: small pill switcher (Main.dc.html)
  switcherBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: glass.discover.title.horizontalPadding,
    paddingTop: 8,
    alignItems: 'flex-start',
  },
  switcher: {
    flexDirection: 'row',
    gap: S.gap,
    padding: S.padding,
    borderRadius: 999,
    backgroundColor: isAndroidPreBlur ? S.fillOpaque : S.fill,
  },
  switcherPill: {
    position: 'absolute',
    top: S.padding,
    height: S.pillHeight,
    borderRadius: S.pillHeight / 2,
    backgroundColor: S.selectedBg,
  },
  switcherTab: {
    height: S.pillHeight,
    paddingHorizontal: S.pillPaddingH,
    borderRadius: S.pillHeight / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switcherLabel: {
    fontSize: S.fontSize,
    includeFontPadding: false,
  },
  switcherLabelActive: {
    color: S.selectedText,
    fontWeight: '600',
  },
  switcherLabelInactive: {
    color: S.text,
    fontWeight: '500',
  },
});

// ORCH-0679 Wave 2A: I-TAB-SCREENS-MEMOIZED.
export default React.memo(LikesPage);
