import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { EventCoverMedia } from "@mingla/offering-rendering";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { formatCurrency } from "../utils/formatters";
import type { DiscoverCardV2 } from "../../types/discoverFeed";
import { DISCOVER_SALE_LABEL_ENABLED } from "./discoverFlags";

interface Props {
  card: DiscoverCardV2;
  saved: boolean;
  onPress: () => void;
  onSave: () => void;
}

function typeLabel(card: DiscoverCardV2, t: (key: string, values?: Record<string, unknown>) => string): string | null {
  if (card.source === "ticketmaster") return card.genre?.toUpperCase() ?? null;
  if (card.kind === "experience") return (card.meta.stops ?? 0) >= 2 ? t("card.type.stops", { count: card.meta.stops }) : t("card.type.experience");
  if (card.kind === "trip") return t("card.type.trip");
  if (card.kind === "stay") return t("card.type.stay");
  return null;
}

function priceLabel(card: DiscoverCardV2, t: (key: string, values?: Record<string, unknown>) => string): string {
  if (card.source === "ticketmaster") {
    if (card.price?.minMajor == null) return "";
    return formatCurrency(card.price.minMajor, card.price.currency, card.price.currency);
  }
  if (!card.price) return "";
  if (card.price.isFree) return t("card.free");
  if (card.price.listMinor == null) return "";
  const label = formatCurrency(card.price.listMinor / 100, card.price.currency, card.price.currency);
  return card.price.unit === "per_night" ? t("card.per_night", { price: label }) : label;
}

function dateLabel(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).replace(",", " ·");
}

export const DiscoverCard = React.memo(function DiscoverCard({ card, saved, onPress, onSave }: Props) {
  const { t } = useTranslation("discover");
  const mediaUrl = card.source === "mingla" ? card.coverUrl : card.imageUrl;
  const mediaType = card.source === "mingla" ? card.coverType : "image";
  const label = typeLabel(card, t);
  const isSale = card.source === "mingla" && DISCOVER_SALE_LABEL_ENABLED && card.price?.saleMinor != null;
  const meta = card.source === "mingla"
    ? `${dateLabel(card.startsAtUtc)}${card.meta.venueOrPlace ? ` · ${card.meta.venueOrPlace}` : ""}`
    : `${card.startsLocalDate}${card.venueName ? ` · ${card.venueName}` : ""}`;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={card.title} style={styles.card}>
      <EventCoverMedia mediaUrl={mediaUrl} mediaType={mediaType} hue={card.source === "mingla" ? card.coverHue : 24} height="100%" width="100%" radius={24} autoplay={false} playbackActive={false} />
      <LinearGradient colors={["transparent", "rgba(0,0,0,.76)"]} locations={[0.35, 1]} style={StyleSheet.absoluteFill} />
      {isSale || label ? <Text style={[styles.type, card.source === "mingla" && card.kind === "trip" && styles.trip, card.source === "mingla" && card.kind === "stay" && styles.stay, isSale && styles.sale]}>{isSale ? t("card.sale") : label}</Text> : null}
      <Pressable onPress={(event) => { event.stopPropagation(); onSave(); }} accessibilityRole="button" accessibilityLabel={saved ? t("card.saved_a11y", { title: card.title }) : t("card.save_a11y", { title: card.title })} style={styles.heart}>
        <Icon name={saved ? "heart" : "heart-outline"} size={18} color={saved ? "#eb7825" : "#fff"} />
      </Pressable>
      <View style={styles.chip}>
        {card.source === "mingla" ? (
          <View style={styles.brand}><View style={styles.avatar} /><Text numberOfLines={1} style={styles.brandName}>{card.brand.name}</Text>{card.brand.verified ? <Icon name="shield-checkmark" size={12} color="#eb7825" /> : null}</View>
        ) : null}
        <Text numberOfLines={2} style={styles.title}>{card.title}</Text>
        <View style={styles.metaRow}><Text numberOfLines={1} style={styles.meta}>{meta}</Text><Text style={styles.price}>{priceLabel(card, t)}</Text></View>
      </View>
    </Pressable>
  );
});
const styles = StyleSheet.create({
  card: { flex: 1, minWidth: "46%", aspectRatio: 0.72, borderRadius: 24, overflow: "hidden", backgroundColor: "#252830", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  type: { position: "absolute", top: 10, left: 10, height: 20, lineHeight: 20, borderRadius: 10, paddingHorizontal: 8, overflow: "hidden", color: "#fff", backgroundColor: "rgba(124,58,237,.75)", fontSize: 10, fontWeight: "600", letterSpacing: 0.3 },
  trip: { backgroundColor: "rgba(14,116,144,.8)" }, stay: { backgroundColor: "rgba(21,128,61,.8)" }, sale: { backgroundColor: "#dc2626" },
  heart: { position: "absolute", top: 8, right: 8, width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,.35)" },
  chip: { position: "absolute", left: 10, right: 10, bottom: 10, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "rgba(20,20,24,.72)", borderColor: "rgba(255,255,255,.1)", borderWidth: 1 },
  brand: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 5 }, avatar: { width: 16, height: 16, borderRadius: 8, backgroundColor: "rgba(255,255,255,.2)" },
  brandName: { color: "rgba(255,255,255,.9)", fontSize: 11, fontWeight: "600", flexShrink: 1 },
  title: { color: "#fff", fontSize: 14, fontWeight: "600", lineHeight: 18 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: 4 },
  meta: { color: "rgba(255,255,255,.72)", fontSize: 11, fontWeight: "500", flex: 1 },
  price: { color: "#fff", fontSize: 11, fontWeight: "600" },
});
