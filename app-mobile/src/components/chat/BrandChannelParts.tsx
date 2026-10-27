/**
 * Issue #4114 Wave 6 — the brand channel's small pieces inside the thread:
 *  - the event marker drawn where the source event changes;
 *  - the "Sending to {event} ▾" chip above the composer (only with two or more
 *    upcoming events, D10);
 *  - the "Send to" picker sheet listing your events.
 * The rules live in connections/brandChannelModel.ts.
 */
import React from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { chatTokens } from "../../constants/chatTokens";
import { isEventEnded, type BrandChannelEvent } from "../connections/brandChannelModel";

const SEND_SHEET_SNAP = ["55%"];

export function formatBrandEventDate(iso: string | null | undefined, locale: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
}

export function BrandChannelEventMarker({
  event,
  now,
  locale,
  onPress,
}: {
  event: BrandChannelEvent;
  now: number;
  locale: string | undefined;
  onPress?: () => void;
}): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const ended = isEventEnded(event, now);
  const date = formatBrandEventDate(event.startAt, locale);
  const label = ended
    ? t("chat:brandEventMarkerEnded", { title: event.title })
    : date
      ? `${event.title} · ${date}`
      : event.title;
  return (
    <View style={styles.markerRow} testID={`brand-channel-marker-${event.conversationId}`}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        style={({ pressed }) => [styles.marker, ended && styles.markerEnded, pressed && styles.pressed]}
        accessibilityRole={onPress ? "button" : "text"}
        accessibilityLabel={onPress ? t("chat:brandEventMarkerA11y", { label }) : label}
      >
        <Icon name={event.linkedEntityType === "trip" ? "map" : "calendar"} size={12} color={ended ? chatTokens.textMuted : chatTokens.textSecondary} />
        <Text style={[styles.markerText, ended && styles.markerTextEnded]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    </View>
  );
}

export function BrandChannelSendChip({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  return (
    <View style={styles.chipRow}>
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        style={styles.chip}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel={t("chat:sendingToA11y", { title })}
        testID="brand-channel-sending-to"
      >
        <Text style={styles.chipLabel} numberOfLines={1}>
          {t("chat:sendingTo")}{" "}
          <Text style={styles.chipTitle}>{title}</Text>
        </Text>
        {disabled ? null : <Icon name="chevron-down" size={14} color={chatTokens.textSecondary} />}
      </TouchableOpacity>
    </View>
  );
}

export function BrandChannelSendSheet({
  visible,
  onClose,
  events,
  selectedConversationId,
  now,
  locale,
  onSelect,
  onOpenGuests,
}: {
  visible: boolean;
  onClose: () => void;
  events: readonly BrandChannelEvent[];
  selectedConversationId: string | null;
  now: number;
  locale: string | undefined;
  onSelect: (conversationId: string) => void;
  onOpenGuests: (conversationId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={SEND_SHEET_SNAP}
      wrapInRNModal
      theme="dark"
      scrollMode="scroll"
      backgroundStyle={styles.sheetBackground}
      accessibilityLabel={t("chat:sendToTitle")}
      header={<Text style={styles.sheetTitle} accessibilityRole="header">{t("chat:sendToTitle")}</Text>}
    >
      <View style={styles.sheetBody}>
        {events.map((event) => {
          const ended = isEventEnded(event, now);
          const selected = event.conversationId === selectedConversationId;
          const date = formatBrandEventDate(event.startAt, locale);
          const people = event.linkedEntityType === "trip"
            ? ended
              ? t("chat:sendToTravelled", { count: event.participantCount })
              : t("chat:audienceTravellingCount", { count: event.participantCount })
            : ended
              ? t("chat:sendToWent", { count: event.participantCount })
              : t("chat:sendToGoing", { count: event.participantCount });
          const meta = ended
            ? `${t("chat:sendToEnded", { date })} · ${people}`
            : date
              ? `${date} · ${people}`
              : people;
          return (
            <View key={event.conversationId} style={styles.sheetRow}>
              <Pressable
                onPress={() => onSelect(event.conversationId)}
                disabled={ended}
                style={({ pressed }) => [styles.sheetRowMain, pressed && styles.pressed]}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: ended }}
                accessibilityLabel={`${event.title}, ${meta}`}
                testID={`brand-channel-send-to-${event.conversationId}`}
              >
                <View style={styles.sheetRowCopy}>
                  <Text style={[styles.sheetRowTitle, ended && styles.mutedText]} numberOfLines={1}>{event.title}</Text>
                  <Text style={styles.sheetRowMeta} numberOfLines={1}>{meta}</Text>
                </View>
                {selected ? <Icon name="checkmark" size={18} color={chatTokens.accent} /> : null}
              </Pressable>
              <TouchableOpacity
                onPress={() => onOpenGuests(event.conversationId)}
                style={styles.guestsButton}
                accessibilityRole="button"
                accessibilityLabel={t("chat:sendToViewGuests", { title: event.title })}
              >
                <Icon name="people-outline" size={18} color={chatTokens.textSecondary} />
              </TouchableOpacity>
            </View>
          );
        })}
        <Text style={styles.sheetNote}>{t("chat:sendToNote")}</Text>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.7,
  },
  markerRow: {
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  marker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: chatTokens.strip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.hairline,
  },
  markerEnded: {
    backgroundColor: "transparent",
  },
  markerText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "600",
    color: chatTokens.textSecondary,
  },
  markerTextEnded: {
    color: chatTokens.textMuted,
  },
  chipRow: {
    flexDirection: "row",
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: chatTokens.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: chatTokens.hairline,
  },
  chipLabel: {
    flexShrink: 1,
    fontSize: 13,
    color: chatTokens.textSoft,
  },
  chipTitle: {
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  sheetBackground: {
    backgroundColor: chatTokens.surface,
  },
  sheetTitle: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
    fontSize: 17,
    fontWeight: "700",
    color: chatTokens.textPrimary,
  },
  sheetBody: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  sheetRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.hairline,
  },
  sheetRowMain: {
    flex: 1,
    minWidth: 0,
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
  },
  sheetRowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sheetRowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: chatTokens.textPrimary,
  },
  sheetRowMeta: {
    fontSize: 13,
    color: chatTokens.textSoft,
  },
  mutedText: {
    color: chatTokens.textMuted,
  },
  guestsButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetNote: {
    paddingHorizontal: 8,
    paddingTop: 14,
    fontSize: 13,
    lineHeight: 18,
    color: chatTokens.textSoft,
  },
});
