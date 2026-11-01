import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { EventCoverMedia } from "@mingla/offering-rendering";

import type { PurchaseTimelineItem } from "../../utils/purchaseTimeline";
import {
  formatPurchaseMoney,
  purchaseCountLabel,
  purchaseKindLabel,
  purchaseRefundLabel,
  purchaseStatusLabel,
} from "../../utils/purchasePresentation";
import { formatTicketTimeLine } from "../../utils/zoneLabel";

interface PurchaseCardProps {
  item: PurchaseTimelineItem;
  onPress: () => void;
}

export function PurchaseCard({ item, onPress }: PurchaseCardProps): React.ReactElement {
  const timeLine = formatTicketTimeLine(
    item.startsAt,
    item.timezone,
    item.venueLine,
  );
  const amount = formatPurchaseMoney(item.amountCents, item.currency);
  const refund = purchaseRefundLabel(item);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${purchaseKindLabel(item.kind)} for ${item.title}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      {item.coverMediaUrl ? (
        <View style={styles.cover}>
          <EventCoverMedia
            accessibleLabel={`${item.title} cover`}
            autoplay={false}
            height="100%"
            mediaType={item.coverMediaType}
            mediaUrl={item.coverMediaUrl}
            playbackActive={false}
            radius={0}
            width="100%"
          />
        </View>
      ) : (
        <View style={styles.coverFallback}>
          <Text style={styles.coverFallbackText}>{purchaseKindLabel(item.kind)}</Text>
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.eyebrowRow}>
          <Text style={styles.eyebrow}>{purchaseKindLabel(item.kind)}</Text>
          <Text style={styles.status}>{purchaseStatusLabel(item.status)}</Text>
        </View>
        <Text numberOfLines={2} style={styles.title}>{item.title}</Text>
        {item.brandName ? (
          <Text numberOfLines={1} style={styles.brand}>{item.brandName}</Text>
        ) : null}
        {timeLine ? <Text numberOfLines={2} style={styles.meta}>{timeLine}</Text> : null}
        <View style={styles.footer}>
          <Text style={styles.count}>{purchaseCountLabel(item)}</Text>
          <View style={styles.moneyBlock}>
            {amount ? <Text style={styles.amount}>{amount}</Text> : null}
            {refund ? <Text style={styles.refund}>{refund}</Text> : null}
          </View>
        </View>
      </View>
      <Text aria-hidden style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 132,
    flexDirection: "row",
    overflow: "hidden",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "#171a20",
  },
  pressed: { opacity: 0.78, transform: [{ scale: 0.995 }] },
  cover: {
    width: 108,
    alignSelf: "stretch",
    overflow: "hidden",
    backgroundColor: "#252932",
  },
  coverFallback: {
    width: 108,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#272018",
  },
  coverFallbackText: {
    color: "#f8a35f",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  body: { flex: 1, paddingHorizontal: 14, paddingVertical: 13 },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  eyebrow: {
    color: "#eb7825",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  status: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    fontWeight: "600",
  },
  title: { color: "#fff", fontSize: 17, fontWeight: "700", marginTop: 5 },
  brand: { color: "rgba(255,255,255,0.70)", fontSize: 13, marginTop: 2 },
  meta: { color: "rgba(255,255,255,0.56)", fontSize: 12, lineHeight: 17, marginTop: 7 },
  footer: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 9,
  },
  count: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: "600" },
  moneyBlock: { alignItems: "flex-end" },
  amount: { color: "#fff", fontSize: 13, fontWeight: "700" },
  refund: { color: "#f8a35f", fontSize: 10, fontWeight: "600", marginTop: 1 },
  chevron: {
    alignSelf: "center",
    color: "rgba(255,255,255,0.34)",
    fontSize: 28,
    lineHeight: 30,
    marginRight: 10,
  },
});
