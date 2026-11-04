/**
 * Issue #4265 — the Calendar's non-list states (approved design:
 * Calendar.dc.html): the "Nothing booked" card, the collapsible
 * "Past plans · N" row, and row-shaped skeletons for the first-ever load.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon } from "../ui/Icon";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";

const L = glass.likes;
const C = L.calendar;
const OPAQUE = ANDROID_GLASS_USES_OPAQUE_FALLBACK;
const SKELETON_ROWS = [0, 1, 2, 3];

/** What the empty agenda is empty of: everything, the selected day, or the shown week. */
export type CalendarEmptyScope = "all" | "day" | "week";

const EMPTY_TITLE_KEY: Record<CalendarEmptyScope, string> = {
  all: "activity:calendarTab.emptyTitleYet",
  day: "activity:calendarTab.emptyTitleDay",
  week: "activity:calendarTab.emptyTitleWeek",
};

export function CalendarEmptyCard({
  scope,
  onPlanFromSaves,
}: {
  scope: CalendarEmptyScope;
  /** Absent → the button is hidden (never a dead tap). */
  onPlanFromSaves?: () => void;
}): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  return (
    <View style={styles.emptyWrap}>
      <View style={styles.emptyCard}>
        <View style={styles.emptyIcon}>
          <Icon name="calendar-outline" size={22} color={L.accent} />
        </View>
        <View style={styles.emptyText}>
          <Text style={styles.emptyTitle} accessibilityRole="header">
            {t(EMPTY_TITLE_KEY[scope])}
          </Text>
          <Text style={styles.emptyBody}>{t("activity:calendarTab.emptyBody")}</Text>
        </View>
      </View>
      {onPlanFromSaves ? (
        <Pressable
          onPress={onPlanFromSaves}
          style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.emptyButtonText}>{t("activity:calendarTab.planFromSaves")}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CalendarPastToggle({
  count,
  expanded,
  onToggle,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  const label = t("activity:calendarTab.pastPlans", { n: count });
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [styles.pastToggle, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
    >
      <Text style={styles.pastToggleText}>{label}</Text>
      <Icon name={expanded ? "chevron-up" : "chevron-down"} size={18} color={L.textSecondary} />
    </Pressable>
  );
}

export function CalendarAgendaSkeleton({
  reduceMotion,
  accessibilityLabel,
}: {
  reduceMotion: boolean;
  accessibilityLabel: string;
}): React.ReactElement {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return undefined;
    }
    const half = L.skeleton.shimmerMs / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: L.skeleton.shimmerLowOpacity, duration: half, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: half, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
      style={styles.skeleton}
    >
      <Animated.View style={[styles.skelHeader, { opacity: pulse }]} />
      {SKELETON_ROWS.map((i) => (
        <Animated.View key={i} style={[styles.skelRow, { opacity: pulse }]}>
          <View style={styles.skelPhoto} />
          <View style={styles.skelLines}>
            <View style={styles.skelTitle} />
            <View style={styles.skelMeta} />
            <View style={styles.skelTag} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

const block = OPAQUE ? L.skeleton.blockOpaque : L.skeleton.block;
const blockDim = OPAQUE ? L.skeleton.blockDimOpaque : L.skeleton.blockDim;

const styles = StyleSheet.create({
  emptyWrap: {
    marginTop: 18,
  },
  emptyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.emptyBorder,
    backgroundColor: OPAQUE ? C.emptyFillOpaque : C.emptyFill,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.emptyIconFill,
  },
  emptyText: {
    flex: 1,
    gap: 4,
  },
  emptyTitle: {
    color: L.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  emptyBody: {
    color: L.textBody,
    fontSize: 13,
  },
  emptyButton: {
    marginTop: 10,
    minHeight: C.emptyButtonHeight,
    borderRadius: 14,
    backgroundColor: L.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  pastToggle: {
    marginTop: 22,
    marginBottom: 8,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pastToggleText: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 14,
    fontWeight: "600",
  },
  skeleton: {
    paddingTop: 14,
    gap: 8,
  },
  skelHeader: {
    width: 72,
    height: 14,
    borderRadius: 7,
    backgroundColor: block,
    marginBottom: 4,
  },
  skelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: C.rowPadding,
    borderRadius: C.rowRadius,
    backgroundColor: OPAQUE ? C.rowFillOpaque : C.rowFill,
  },
  skelPhoto: {
    width: C.rowPhoto,
    height: C.rowPhoto,
    borderRadius: C.rowPhotoRadius,
    backgroundColor: block,
  },
  skelLines: {
    flex: 1,
    gap: 6,
  },
  skelTitle: {
    width: "70%",
    height: 14,
    borderRadius: 7,
    backgroundColor: block,
  },
  skelMeta: {
    width: "50%",
    height: 11,
    borderRadius: 6,
    backgroundColor: blockDim,
  },
  skelTag: {
    width: 56,
    height: C.tagHeight,
    borderRadius: 999,
    backgroundColor: blockDim,
  },
  pressed: {
    opacity: 0.75,
  },
});
