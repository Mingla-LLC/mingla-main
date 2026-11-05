/**
 * Issue #4265 — the Calendar's controls on the Likes header line, to the
 * right of the Saved | Calendar switcher (Seth: "everything is on one line").
 *
 *   [≡ ▦ ▤]  List · Week · Month as three 32pt icon buttons in one pill.
 *   [⏷]      The plan-type filter: an icon button (white when a type is on)
 *            that drops a menu — All plans, Tickets, Reservations, Plans,
 *            Stays — each with its tag colour, its upcoming count and a check
 *            on the selected one.
 *
 * The menu is a transparent Modal so it draws above the list and the floating
 * nav. It opens with a 120 ms fade + scale from the top (none under reduce
 * motion) and returns accessibility focus to the button when it closes.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  findNodeHandle,
  useWindowDimensions,
} from "react-native";
import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "../ui/Icon";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";
import { useA11yPreferences } from "../../hooks/useA11yPreferences";
import {
  AGENDA_TYPE_FILTERS,
  CALENDAR_VIEWS,
  TYPE_FILTER_TAG,
  isTypeFilterActive,
  type AgendaTypeCounts,
  type AgendaTypeFilter,
  type CalendarView,
} from "./calendarAgendaModel";

const L = glass.likes;
const C = L.calendar;
const OPAQUE = ANDROID_GLASS_USES_OPAQUE_FALLBACK;
const ICON_BUTTON = 32;
const HIT_SLOP = { top: 6, bottom: 6, left: 2, right: 2 } as const;
const MENU_WIDTH = 220;
const MENU_OPEN_MS = 120;

const VIEW_ICON: Record<CalendarView, IconName> = {
  list: "list-outline",
  week: "calendar-range",
  month: "today-outline",
};

const VIEW_A11Y_KEY: Record<CalendarView, string> = {
  list: "activity:calendarTab.viewListA11y",
  week: "activity:calendarTab.viewWeekA11y",
  month: "activity:calendarTab.viewMonthA11y",
};

export const FILTER_LABEL_KEY: Record<AgendaTypeFilter, string> = {
  all: "activity:calendarTab.filterAllPlans",
  tickets: "activity:calendarTab.typeTickets",
  reservations: "activity:calendarTab.typeReservations",
  plans: "activity:calendarTab.typePlans",
  stays: "activity:calendarTab.typeStays",
};

// ── View icons ──────────────────────────────────────────────────────────────

export const CalendarViewIcons = memo(function CalendarViewIcons({
  view,
  onChange,
}: {
  view: CalendarView;
  onChange: (view: CalendarView) => void;
}): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  return (
    <View style={styles.viewTrack} accessibilityRole="tablist" accessibilityLabel={t("activity:calendarTab.viewToggleLabel")}>
      {CALENDAR_VIEWS.map((id) => {
        const on = id === view;
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            hitSlop={HIT_SLOP}
            style={[styles.iconButton, on && styles.iconButtonOn]}
            accessibilityRole="tab"
            accessibilityLabel={t(VIEW_A11Y_KEY[id])}
            accessibilityState={{ selected: on }}
          >
            <Icon name={VIEW_ICON[id]} size={17} color={on ? C.toggleSelectedText : C.toggleIdleText} />
          </Pressable>
        );
      })}
    </View>
  );
});

// ── Filter button + dropdown ────────────────────────────────────────────────

interface Anchor {
  top: number;
  right: number;
}

export const CalendarFilterMenu = memo(function CalendarFilterMenu({
  value,
  counts,
  onChange,
}: {
  value: AgendaTypeFilter;
  counts: AgendaTypeCounts;
  onChange: (value: AgendaTypeFilter) => void;
}): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  const { reduceMotion } = useA11yPreferences();
  const { width: windowWidth } = useWindowDimensions();
  const buttonRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const active = isTypeFilterActive(value);
  const current = t(FILTER_LABEL_KEY[value]);

  const open = useCallback(() => {
    buttonRef.current?.measureInWindow((x, y, w, h) => {
      setAnchor({ top: y + h + 6, right: Math.max(8, windowWidth - (x + w)) });
    });
  }, [windowWidth]);

  const close = useCallback(() => {
    setAnchor(null);
    // Return focus to the button the menu came from.
    const node = buttonRef.current ? findNodeHandle(buttonRef.current) : null;
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);

  useEffect(() => {
    if (anchor === null) {
      progress.setValue(0);
      return;
    }
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, { toValue: 1, duration: MENU_OPEN_MS, useNativeDriver: true }).start();
  }, [anchor, progress, reduceMotion]);

  const pick = (next: AgendaTypeFilter): void => {
    onChange(next);
    close();
  };

  return (
    <>
      <Pressable
        ref={buttonRef}
        onPress={open}
        hitSlop={HIT_SLOP}
        style={[styles.filterButton, active && styles.iconButtonOn]}
        accessibilityRole="button"
        accessibilityLabel={t("activity:calendarTab.filterButtonA11y", { current })}
        accessibilityState={{ expanded: anchor !== null }}
        testID="calendar-filter-button"
      >
        <Icon name="filter" size={16} color={active ? C.toggleSelectedText : L.textPrimary} />
      </Pressable>
      <Modal visible={anchor !== null} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel={t("common:close", "Close")} />
        {anchor ? (
          <Animated.View
            accessibilityRole="menu"
            accessibilityLabel={t("activity:calendarTab.filterMenuTitle")}
            style={[
              styles.menu,
              { top: anchor.top, right: anchor.right },
              {
                opacity: progress,
                transform: [
                  { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) },
                  { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
                ],
              },
            ]}
          >
            <Text style={styles.menuTitle} accessibilityRole="header">
              {t("activity:calendarTab.filterMenuTitle")}
            </Text>
            {AGENDA_TYPE_FILTERS.map((id) => {
              const on = id === value;
              const label = t(FILTER_LABEL_KEY[id]);
              return (
                <Pressable
                  key={id}
                  onPress={() => pick(id)}
                  style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
                  accessibilityRole="menuitem"
                  accessibilityLabel={`${label}, ${counts[id]}`}
                  accessibilityState={{ selected: on, checked: on }}
                  testID={`calendar-filter-${id}`}
                >
                  <View
                    style={[
                      styles.menuDot,
                      { backgroundColor: id === "all" ? L.textSecondary : C.tag[TYPE_FILTER_TAG[id]].dot },
                    ]}
                  />
                  <Text style={[styles.menuLabel, on && styles.menuLabelOn]} numberOfLines={1}>
                    {label}
                  </Text>
                  <Text style={styles.menuCount}>{counts[id]}</Text>
                  <View style={styles.menuCheck}>
                    {on ? <Icon name="checkmark" size={16} color={L.accent} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </Animated.View>
        ) : null}
      </Modal>
    </>
  );
});

const styles = StyleSheet.create({
  viewTrack: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 999,
    backgroundColor: OPAQUE ? C.toggleTrackOpaque : C.toggleTrack,
  },
  iconButton: {
    width: ICON_BUTTON,
    height: ICON_BUTTON,
    borderRadius: ICON_BUTTON / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonOn: {
    backgroundColor: C.toggleSelectedBg,
  },
  filterButton: {
    width: ICON_BUTTON + 6,
    height: ICON_BUTTON + 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    backgroundColor: OPAQUE ? C.toggleTrackOpaque : C.toggleTrack,
    alignItems: "center",
    justifyContent: "center",
  },
  menu: {
    position: "absolute",
    width: MENU_WIDTH,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.10)",
    backgroundColor: L.sheet.bg,
    ...(OPAQUE
      ? {}
      : {
        shadowColor: "#000",
        shadowOpacity: 0.4,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
      }),
  },
  menuTitle: {
    color: L.textSecondary,
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 6,
  },
  menuRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
  },
  menuDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  menuLabel: {
    flex: 1,
    color: L.textPrimary,
    fontSize: 15,
    fontWeight: "500",
  },
  menuLabelOn: {
    fontWeight: "700",
  },
  menuCount: {
    color: L.textSecondary,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  menuCheck: {
    width: 18,
    alignItems: "flex-end",
  },
  pressed: {
    opacity: 0.7,
  },
});
