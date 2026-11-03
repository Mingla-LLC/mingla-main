import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { EventCoverMedia } from "@mingla/offering-rendering";

import type {
  PurchaseCoverMediaType,
  PurchaseTimelineItem,
} from "../../utils/purchaseTimeline";
import {
  formatPurchaseMoney,
  purchaseCountLabel,
  purchaseKindLabel,
  purchaseStatusLabel,
} from "../../utils/purchasePresentation";
import { formatTicketTimeLine } from "../../utils/zoneLabel";

interface PurchaseCardProps {
  item: PurchaseTimelineItem;
  onPress: () => void;
  /** Past tab: the card is slightly dimmed. */
  dimmed?: boolean;
}

// #4251 — the cover is a fixed square. The card's height comes from its four
// text rows, never from the media, so a tall poster can't stretch the card.
export const PURCHASE_CARD_COVER_SIZE = 72;

/** The cover renders only for a URL whose type the cover component can draw. */
export function purchaseCardCoverType(
  item: Pick<PurchaseTimelineItem, "coverMediaUrl" | "coverMediaType">,
): PurchaseCoverMediaType | null {
  if (!item.coverMediaUrl || item.coverMediaUrl.trim().length === 0) return null;
  const type = item.coverMediaType;
  return type === "image" || type === "video" || type === "gif" ? type : null;
}

export interface PurchaseDateTileParts {
  weekday: string;
  day: string;
  month: string;
}

/** Weekday, day and month of the start, in the event's own time zone. */
export function purchaseDateTileParts(
  startsAt: string | null | undefined,
  timezone: string | null | undefined,
  locale = "en-GB",
): PurchaseDateTileParts | null {
  if (!startsAt) return null;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return null;
  const part = (zone: string, option: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(locale, { timeZone: zone, ...option }).format(date);
  const build = (zone: string): PurchaseDateTileParts => ({
    weekday: part(zone, { weekday: "short" }).replace(/\.$/, "").toUpperCase(),
    day: part(zone, { day: "numeric" }),
    month: part(zone, { month: "short" }).replace(/\.$/, "").toUpperCase(),
  });
  try {
    return build(timezone || "UTC");
  } catch {
    return build("UTC");
  }
}

function isRefundStatus(status: string): boolean {
  return status === "refunded" || status === "partial_refund";
}

function isCancelledStatus(status: string): boolean {
  return status.startsWith("cancelled");
}

export function PurchaseCard({
  item,
  onPress,
  dimmed = false,
}: PurchaseCardProps): React.ReactElement {
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => {
    setCoverFailed(false);
  }, [item.coverMediaUrl, item.coverMediaType]);
  const handleCoverError = useCallback((): void => setCoverFailed(true), []);

  const coverType = coverFailed ? null : purchaseCardCoverType(item);
  const kindLabel = purchaseKindLabel(item.kind);
  const dateLine = formatTicketTimeLine(item.startsAt, item.timezone, null);
  const countLabel = purchaseCountLabel(item);
  const whenLine = dateLine ? `${dateLine} · ${countLabel}` : countLabel;
  const whereLine = [item.brandName, item.venueLine]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0)
    .join(" · ");
  const amount = formatPurchaseMoney(item.amountCents, item.currency);
  const refundState = isRefundStatus(item.status);
  const cancelled = isCancelledStatus(item.status);
  const tile = purchaseDateTileParts(item.startsAt, item.timezone);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${kindLabel} for ${item.title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        dimmed && styles.dimmed,
        pressed && styles.pressed,
      ]}
    >
      {coverType !== null && item.coverMediaUrl ? (
        <View testID="purchase-card-cover" style={styles.cover}>
          <EventCoverMedia
            accessibleLabel={`${item.title} cover`}
            autoplay={false}
            height={PURCHASE_CARD_COVER_SIZE}
            mediaType={coverType}
            mediaUrl={item.coverMediaUrl}
            onMediaError={handleCoverError}
            playbackActive={false}
            radius={0}
            width={PURCHASE_CARD_COVER_SIZE}
          />
          {cancelled ? <View style={styles.coverCancelled} /> : null}
          {coverType === "video" ? (
            <View style={styles.play}>
              <Svg width={9} height={9} viewBox="0 0 10 10">
                <Path d="M2 1l7 4-7 4z" fill="#fff" />
              </Svg>
            </View>
          ) : null}
        </View>
      ) : (
        <View testID="purchase-card-date-tile" style={[styles.cover, styles.tile]}>
          {tile ? (
            <>
              <Text style={styles.tileWeekday}>{tile.weekday}</Text>
              <Text style={styles.tileDay}>{tile.day}</Text>
              <Text style={styles.tileMonth}>{tile.month}</Text>
            </>
          ) : (
            <Text numberOfLines={1} style={styles.tileWeekday}>{kindLabel}</Text>
          )}
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.row1}>
          <Text numberOfLines={1} style={styles.kind}>{kindLabel}</Text>
          <Text
            numberOfLines={1}
            style={[styles.status, (refundState || cancelled) && styles.statusWarn]}
          >
            {purchaseStatusLabel(item.status)}
          </Text>
          {amount ? (
            <Text
              numberOfLines={1}
              style={[styles.amount, item.status === "refunded" && styles.amountStruck]}
            >
              {amount}
            </Text>
          ) : null}
        </View>
        <Text numberOfLines={1} style={styles.title}>{item.title}</Text>
        <Text numberOfLines={1} style={styles.when}>{whenLine}</Text>
        {whereLine ? (
          <Text numberOfLines={1} style={styles.where}>{whereLine}</Text>
        ) : null}
      </View>
      <Text aria-hidden style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 10,
    paddingRight: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "#171a20",
  },
  dimmed: { opacity: 0.86 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  cover: {
    width: PURCHASE_CARD_COVER_SIZE,
    height: PURCHASE_CARD_COVER_SIZE,
    flexShrink: 0,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#252932",
  },
  coverCancelled: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(60,62,68,0.62)",
  },
  play: {
    position: "absolute",
    right: 5,
    bottom: 5,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  tile: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(235,120,37,0.28)",
    backgroundColor: "#2a1f14",
  },
  tileWeekday: {
    color: "#f8a35f",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  tileDay: {
    color: "#fff",
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "800",
  },
  tileMonth: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  row1: { flexDirection: "row", alignItems: "center", gap: 6 },
  kind: {
    flexShrink: 0,
    color: "#f08a3e",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  status: {
    flexShrink: 1,
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontWeight: "600",
  },
  statusWarn: { color: "#f8a35f" },
  amount: {
    flexShrink: 0,
    marginLeft: "auto",
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  amountStruck: {
    color: "rgba(255,255,255,0.62)",
    textDecorationLine: "line-through",
  },
  title: { color: "#fff", fontSize: 16, lineHeight: 21, fontWeight: "700" },
  when: { color: "rgba(255,255,255,0.80)", fontSize: 13, lineHeight: 17 },
  where: { color: "rgba(255,255,255,0.62)", fontSize: 12, lineHeight: 16 },
  chevron: {
    flexShrink: 0,
    color: "rgba(255,255,255,0.34)",
    fontSize: 28,
    lineHeight: 30,
  },
});
