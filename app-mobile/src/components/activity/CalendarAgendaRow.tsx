/**
 * Issue #4265 — one plan in the Likes → Calendar agenda (approved design:
 * Calendar.dc.html). 56pt photo, title, "time · place", a colour-coded type
 * tag, an orange "Ticket" button when a pass exists, and a "···" button for
 * the plan's actions. Past plans render dimmed with an "Again" button.
 *
 * Memoised: the list re-renders a row only when its row object, its time
 * label or a handler identity changes.
 */
import React, { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { EventCoverMedia } from "@mingla/offering-rendering";
import { useTranslation } from "react-i18next";

import { Icon, type IconName } from "../ui/Icon";
import { glass, ANDROID_GLASS_USES_OPAQUE_FALLBACK } from "../../constants/designSystem";
import type { AgendaTag, UnifiedRow } from "./calendarAgendaModel";
import type { CalendarAgendaSources } from "./calendarAgendaTypes";
import { ReservationRefundStatus } from "./ReservationRefundStatus";

const L = glass.likes;
const C = L.calendar;
const OPAQUE = ANDROID_GLASS_USES_OPAQUE_FALLBACK;

export type CalendarRow = UnifiedRow<CalendarAgendaSources>;

const TAG_KEY: Record<AgendaTag, string> = {
  ticket: "activity:calendarTab.tagTicket",
  reservation: "activity:calendarTab.tagReservation",
  plan: "activity:calendarTab.tagPlan",
  stay: "activity:calendarTab.tagStay",
};

const FALLBACK_ICON: Record<AgendaTag, IconName> = {
  ticket: "ticket-outline",
  reservation: "restaurant-outline",
  plan: "calendar-outline",
  stay: "key",
};

/** The secondary line: "8:00 PM · Terra Kulture", "+2 more", party, status. */
export function useAgendaMeta(row: CalendarRow, timeLabel: string): string {
  const { t } = useTranslation(["activity"]);
  const parts: string[] = [];
  if (timeLabel) parts.push(timeLabel);
  if (row.statusNote === "finalizing") parts.push(t("activity:calendarTab.statusFinalizing"));
  else if (row.statusNote === "awaitingApproval") parts.push(t("activity:calendarTab.statusAwaitingApproval"));
  else if (row.statusNote === "requested") parts.push(t("activity:calendarTab.statusRequested"));
  else if (row.statusNote === "cancelled") parts.push(t("activity:calendarTab.statusCancelled"));
  if (row.partySize > 0) parts.push(t("activity:calendarTab.partyOf", { n: row.partySize }));
  if (row.place) {
    parts.push(
      row.stopCount > 1
        ? `${row.place} ${t("activity:calendarTab.morePlaces", { n: row.stopCount - 1 })}`
        : row.place,
    );
  }
  return parts.join(" · ");
}

function AgendaThumb({ row, size }: { row: CalendarRow; size: number }): React.ReactElement {
  const frame = { width: size, height: size, borderRadius: size === C.rowPhoto ? C.rowPhotoRadius : 10 };
  if (row.imageUrl && (row.mediaType === "video" || row.mediaType === "gif")) {
    return (
      <View style={[styles.thumb, frame]}>
        <EventCoverMedia
          accessibleLabel={null}
          autoplay={false}
          height="100%"
          mediaType={row.mediaType}
          mediaUrl={row.imageUrl}
          playbackActive={false}
          radius={frame.borderRadius}
          width="100%"
        />
      </View>
    );
  }
  if (row.imageUrl) {
    return (
      <ExpoImage
        source={{ uri: row.imageUrl }}
        style={[styles.thumb, frame]}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={L.card.imageFadeMs}
        accessible={false}
      />
    );
  }
  return (
    <View style={[styles.thumb, styles.thumbFallback, frame]}>
      <Icon name={FALLBACK_ICON[row.tag]} size={size > 48 ? 22 : 18} color={L.textSecondary} />
    </View>
  );
}

export function AgendaTagPill({ tag }: { tag: AgendaTag }): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  const tone = C.tag[tag];
  return (
    <View style={[styles.tag, { backgroundColor: OPAQUE ? tone.bgOpaque : tone.bg }]}>
      <Text style={[styles.tagText, { color: tone.fg }]} numberOfLines={1}>
        {t(TAG_KEY[tag])}
      </Text>
    </View>
  );
}

interface CalendarAgendaRowProps {
  row: CalendarRow;
  timeLabel: string;
  onOpen: (row: CalendarRow) => void;
  onTicket: (row: CalendarRow) => void;
  onMore: (row: CalendarRow) => void;
}

function CalendarAgendaRowImpl({ row, timeLabel, onOpen, onTicket, onMore }: CalendarAgendaRowProps): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  const meta = useAgendaMeta(row, timeLabel);
  const open = useCallback(() => onOpen(row), [onOpen, row]);
  const ticket = useCallback(() => onTicket(row), [onTicket, row]);
  const more = useCallback(() => onMore(row), [onMore, row]);
  const tagLabel = t(TAG_KEY[row.tag]);
  return (
    <View style={styles.row}>
      <Pressable
        onPress={open}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={[row.title, meta, tagLabel].filter(Boolean).join(", ")}
      >
        <AgendaThumb row={row} size={C.rowPhoto} />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>
            {row.title}
          </Text>
          {meta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          <AgendaTagPill tag={row.tag} />
        </View>
      </Pressable>
      {row.hasTicket ? (
        <Pressable
          onPress={ticket}
          style={({ pressed }) => [styles.ticketButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t("activity:calendarTab.ticketA11y", { title: row.title })}
          hitSlop={4}
        >
          <Text style={styles.ticketText}>{t("activity:calendarTab.ticketButton")}</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={more}
        style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={t("activity:calendarTab.moreA11y", { title: row.title })}
        hitSlop={4}
      >
        <Icon name="ellipsis-horizontal" size={18} color={L.textPrimary} />
      </Pressable>
    </View>
  );
}

export const CalendarAgendaRow = memo(CalendarAgendaRowImpl);

interface CalendarPastRowProps {
  row: CalendarRow;
  timeLabel: string;
  onOpen: (row: CalendarRow) => void;
  onAgain: (row: CalendarRow) => void;
}

function CalendarPastRowImpl({ row, timeLabel, onOpen, onAgain }: CalendarPastRowProps): React.ReactElement {
  const { t } = useTranslation(["activity"]);
  const meta = useAgendaMeta(row, timeLabel);
  const open = useCallback(() => onOpen(row), [onOpen, row]);
  const again = useCallback(() => onAgain(row), [onAgain, row]);
  const refund = row.kind === "reservation" ? row.reservation.refund ?? null : null;
  return (
    <View style={styles.pastWrap}>
      <View style={styles.pastRow}>
        <Pressable
          onPress={open}
          style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={[row.title, meta].filter(Boolean).join(", ")}
        >
          <AgendaThumb row={row} size={C.pastPhoto} />
          <View style={styles.body}>
            <Text style={styles.pastTitle} numberOfLines={1}>
              {row.title}
            </Text>
            {meta ? (
              <Text style={styles.meta} numberOfLines={1}>
                {meta}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable
          onPress={again}
          style={({ pressed }) => [styles.againButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t("activity:calendarTab.againA11y", { title: row.title })}
          hitSlop={4}
        >
          <Text style={styles.againText}>{t("activity:calendarTab.again")}</Text>
        </Pressable>
      </View>
      {refund ? (
        <View style={styles.refund}>
          <ReservationRefundStatus refund={refund} />
        </View>
      ) : null}
    </View>
  );
}

export const CalendarPastRow = memo(CalendarPastRowImpl);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: C.rowPadding,
    borderRadius: C.rowRadius,
    backgroundColor: OPAQUE ? C.rowFillOpaque : C.rowFill,
    borderWidth: 1,
    borderColor: C.rowBorder,
    marginBottom: 8,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
  },
  thumb: {
    overflow: "hidden",
    backgroundColor: OPAQUE ? L.card.photoPlaceholderOpaque : L.card.photoPlaceholder,
  },
  thumbFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  title: {
    color: L.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  meta: {
    color: L.textSecondary,
    fontSize: 12,
  },
  tag: {
    alignSelf: "flex-start",
    minHeight: C.tagHeight,
    paddingHorizontal: 8,
    borderRadius: 999,
    justifyContent: "center",
  },
  tagText: {
    fontSize: 11,
    fontWeight: "700",
  },
  ticketButton: {
    minHeight: C.rowButton,
    minWidth: 44,
    paddingHorizontal: 12,
    borderRadius: C.rowButtonRadius,
    backgroundColor: L.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  ticketText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
  moreButton: {
    width: 44,
    minHeight: 44,
    borderRadius: C.rowButtonRadius,
    borderWidth: 1,
    borderColor: L.card.quietBorder,
    backgroundColor: OPAQUE ? L.card.quietFillOpaque : L.card.quietFill,
    alignItems: "center",
    justifyContent: "center",
  },
  pastWrap: {
    marginBottom: 8,
  },
  pastRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: C.rowPadding,
    borderRadius: C.rowRadius,
    backgroundColor: OPAQUE ? C.pastRowFillOpaque : C.pastRowFill,
    opacity: C.pastOpacity,
  },
  pastTitle: {
    color: L.textPrimary,
    fontSize: 14,
    fontWeight: "600",
  },
  againButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: L.card.quietBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  againText: {
    color: L.textPrimary,
    fontSize: 12,
    fontWeight: "600",
  },
  refund: {
    marginTop: 6,
    marginLeft: C.rowPadding,
  },
  pressed: {
    opacity: 0.75,
  },
});
