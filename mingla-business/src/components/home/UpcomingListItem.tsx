import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Trip } from "../../services/tripsService";
import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";
import type { UpcomingItem } from "../../hooks/useUpcomingForBrand";
import type { EventSalesSummary } from "../../utils/eventSalesSummary";
import {
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { formatCurrencyRound } from "../../utils/currency";
import { formatDraftDateLine } from "../../utils/eventDateDisplay";
import { formatRelativeTime } from "../../utils/relativeTime";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { Pill } from "../ui/Pill";
import { HomeTripRow } from "./HomeTripRow";

export interface UpcomingListItemProps {
  item: UpcomingItem;
  currentBrandCurrency: string | undefined;
  eventSalesSummaries: Record<string, EventSalesSummary | undefined>;
  onOpenDraft: (draft: DraftEvent) => void;
  onOpenTrip: (trip: Trip) => void;
  onOpenLiveEvent: (event: LiveEvent) => void;
}

const getEventName = (name: string, fallback: string): string =>
  name.trim().length > 0 ? name : fallback;

const UpcomingListItemComponent: React.FC<UpcomingListItemProps> = ({
  item,
  currentBrandCurrency,
  eventSalesSummaries,
  onOpenDraft,
  onOpenTrip,
  onOpenLiveEvent,
}) => {
  if (item.kind === "draft") {
    const draft = item.source as DraftEvent;
    return (
      <Pressable
        onPress={() => onOpenDraft(draft)}
        accessibilityRole="button"
        accessibilityLabel={`Resume draft: ${draft.name || "Untitled"}`}
        style={styles.eventRow}
      >
        <View style={styles.eventCoverWrap}>
          <EventCoverMedia
            hue={draft.coverHue}
            mediaUrl={draft.coverMediaUrl}
            mediaType={draft.coverMediaType}
            radius={12}
            label=""
            height={56}
            width={56}
          />
        </View>
        <View style={styles.eventTextCol}>
          <View style={styles.eventPillRow}>
            <Pill variant="draft">Draft</Pill>
          </View>
          <Text style={styles.eventTitle} numberOfLines={1}>
            {getEventName(draft.name, "Untitled draft")}
          </Text>
          <Text style={styles.eventWhen} numberOfLines={1}>
            {`Step ${draft.lastStepReached + 1} of 7 · ${formatRelativeTime(
              draft.updatedAt,
            )}`}
          </Text>
        </View>
        <View style={styles.eventSoldCol}>
          <Text style={styles.eventSoldValue}>—</Text>
          <Text style={styles.eventSoldLabel}>resume</Text>
        </View>
      </Pressable>
    );
  }

  if (item.kind === "trip") {
    const trip = item.source as Trip;
    return (
      <HomeTripRow
        trip={trip}
        status={item.status === "live" ? "live" : "upcoming"}
        onPress={() => onOpenTrip(trip)}
      />
    );
  }

  const event = item.source as LiveEvent;
  const salesSummary = eventSalesSummaries[event.id];
  const soldLabel = salesSummary?.soldLabel ?? "0 sold";
  const rowSoldLabel =
    salesSummary?.finiteCapacity !== null && salesSummary !== undefined
      ? `${soldLabel} sold`
      : soldLabel;
  const revenueLabel =
    salesSummary?.revenueLabel ??
    formatCurrencyRound(0, event.currency ?? currentBrandCurrency ?? "GBP");
  const isLive = item.status === "live";

  return (
    <Pressable
      onPress={() => onOpenLiveEvent(event)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.kind}: ${
        event.name || "Untitled"
      }. ${rowSoldLabel}. ${revenueLabel}.`}
      style={styles.eventRow}
    >
      <View style={styles.eventCoverWrap}>
        <EventCoverMedia
          hue={event.coverHue}
          mediaUrl={event.coverMediaUrl}
          mediaType={event.coverMediaType}
          radius={12}
          label=""
          height={56}
          width={56}
        />
      </View>
      <View style={styles.eventTextCol}>
        <View style={styles.eventPillRow}>
          <Pill variant={isLive ? "live" : "accent"} livePulse={isLive}>
            {isLive ? "Live" : "Upcoming"}
          </Pill>
        </View>
        <Text style={styles.eventTitle} numberOfLines={1}>
          {getEventName(event.name, "Untitled event")}
        </Text>
        <Text style={styles.eventWhen} numberOfLines={1}>
          {formatDraftDateLine(event)}
        </Text>
      </View>
      <View style={styles.eventSoldCol}>
        <Text style={styles.eventSoldValue}>{rowSoldLabel}</Text>
        <Text style={styles.eventRevenueValue}>{revenueLabel}</Text>
      </View>
    </Pressable>
  );
};

export const UpcomingListItem = React.memo(
  UpcomingListItemComponent,
  (prev, next) => {
    const prevSummary = prev.eventSalesSummaries[prev.item.id];
    const nextSummary = next.eventSalesSummaries[next.item.id];
    return (
      prev.item === next.item &&
      prev.currentBrandCurrency === next.currentBrandCurrency &&
      prevSummary === nextSummary &&
      prev.onOpenDraft === next.onOpenDraft &&
      prev.onOpenTrip === next.onOpenTrip &&
      prev.onOpenLiveEvent === next.onOpenLiveEvent
    );
  },
);

const styles = StyleSheet.create({
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radiusTokens.lg,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  eventCoverWrap: {
    width: 56,
    height: 56,
    flexShrink: 0,
  },
  eventTextCol: {
    flex: 1,
    minWidth: 0,
  },
  eventPillRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  eventTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
    marginBottom: 2,
  },
  eventWhen: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  eventSoldCol: {
    alignItems: "flex-end",
    paddingRight: 2,
    minWidth: 74,
  },
  eventSoldValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  eventRevenueValue: {
    fontSize: 11,
    fontWeight: "700",
    color: textTokens.primary,
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  eventSoldLabel: {
    fontSize: 10,
    color: textTokens.tertiary,
  },
});

export default UpcomingListItem;
