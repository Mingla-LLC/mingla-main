/**
 * Issue #4265 — "When are you going?" quick schedule sheet (Main.dc.html).
 *
 * Shows the next four times the place is open as a 2×2 grid of 64pt tiles.
 * One tap hands the time to SavedTab, which runs the EXISTING scheduling path
 * (hours check → calendar entry → device calendar → saved-card removal). The
 * full date picker stays one row below.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";
import { HapticFeedback } from "../../utils/hapticFeedback";
import { quickSlotDayLabel, type QuickSlot, type QuickSlotResult } from "./savedGridModel";

const L = glass.likes;
const SNAP_POINTS = ["50%"];
const BACKGROUND_STYLE = {
  backgroundColor: L.sheet.bg,
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
} as const;

interface SavedScheduleSheetProps {
  visible: boolean;
  title: string;
  result: QuickSlotResult;
  locale: string;
  onPick: (at: Date) => void;
  onPickAnother: () => void;
  onClose: () => void;
  /** Fires once the native modal is fully gone — safe to present the next one. */
  onDismissed?: () => void;
}

export function formatQuickSlotDay(
  slot: QuickSlot,
  locale: string,
  t: (key: string) => string,
): string {
  const label = quickSlotDayLabel(slot);
  if (label === "tonight") return t("activity:savedTab.slotTonight");
  if (label === "today") return t("activity:savedTab.slotToday");
  if (label === "tomorrow") return t("activity:savedTab.slotTomorrow");
  return slot.at.toLocaleDateString(
    locale,
    slot.dayOffset < 7 ? { weekday: "short" } : { weekday: "short", day: "numeric", month: "short" },
  );
}

export function formatQuickSlotTime(slot: QuickSlot, locale: string): string {
  return slot.at.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

export default function SavedScheduleSheet({
  visible,
  title,
  result,
  locale,
  onPick,
  onPickAnother,
  onClose,
  onDismissed,
}: SavedScheduleSheetProps): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  const subtitle =
    result.source === "default"
      ? t("activity:savedTab.sheetSubtitleDefault", { title })
      : t("activity:savedTab.sheetSubtitleOpen", { title });

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      onNativeDismiss={onDismissed}
      theme="dark"
      snapPoints={SNAP_POINTS}
      wrapInRNModal
      backgroundStyle={BACKGROUND_STYLE}
      accessibilityLabel={t("activity:savedTab.sheetTitle")}
      scrollMode="scroll"
    >
      <View style={styles.body}>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            {t("activity:savedTab.sheetTitle")}
          </Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>

        {result.slots.length > 0 ? (
          <View style={styles.grid}>
            {result.slots.map((slot) => {
              const day = formatQuickSlotDay(slot, locale, t);
              const time = formatQuickSlotTime(slot, locale);
              return (
                <Pressable
                  key={slot.at.getTime()}
                  onPress={() => {
                    HapticFeedback.light();
                    onPick(slot.at);
                  }}
                  style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={t("activity:savedTab.a11ySlot", { day, time })}
                >
                  <Text style={styles.tileDay} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                    {day}
                  </Text>
                  <Text style={styles.tileTime} numberOfLines={1} maxFontSizeMultiplier={1.4}>
                    {time}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Text style={styles.noTimes}>{t("activity:savedTab.sheetNoTimes")}</Text>
        )}

        <Pressable
          onPress={() => {
            HapticFeedback.light();
            onPickAnother();
          }}
          style={({ pressed }) => [styles.anotherRow, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.anotherText}>{t("activity:savedTab.sheetPickAnother")}</Text>
        </Pressable>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 16,
    gap: 14,
  },
  heading: {
    gap: 2,
  },
  title: {
    color: L.textPrimary,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
  },
  subtitle: {
    color: L.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tile: {
    // Two per row inside the 16pt gutters with a 10pt gap.
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: L.sheet.tileHeight,
    borderRadius: L.sheet.tileRadius,
    borderWidth: 1,
    borderColor: L.sheet.tileBorder,
    backgroundColor: ANDROID_GLASS_USES_OPAQUE_FALLBACK ? L.sheet.tileFillOpaque : L.sheet.tileFill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: "center",
    gap: 2,
  },
  tileDay: {
    color: L.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  tileTime: {
    color: L.textSecondary,
    fontSize: 12,
  },
  noTimes: {
    color: L.textBody,
    fontSize: 14,
    lineHeight: 20,
  },
  anotherRow: {
    minHeight: L.sheet.rowHeight,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  anotherText: {
    color: L.accent,
    fontSize: 15,
    fontWeight: "600",
  },
  pressed: {
    opacity: 0.75,
  },
});
