import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { EventCoverMedia } from "@mingla/offering-rendering";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { formatCurrency } from "../utils/formatters";
import type { DiscoverCardV2 } from "../../types/discoverFeed";
import { DISCOVER_SALE_LABEL_ENABLED } from "./discoverFlags";
import { discoverVenueCardModel, type DiscoverVenueCardModel } from "./discoverVenueCard";
import { colors, fontWeights, radius, spacing, typography } from "../../constants/designSystem";

interface Props {
  card: DiscoverCardV2;
  saved: boolean;
  onPress: () => void;
  onSave: () => void;
  /** #4490 W6a: the clock for "On tonight" (tests pin it; the screen passes nothing). */
  now?: Date;
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
  const displayMinor = DISCOVER_SALE_LABEL_ENABLED && card.price.saleMinor != null
    ? card.price.saleMinor
    : card.price.listMinor;
  if (displayMinor == null) return "";
  const label = formatCurrency(displayMinor / 100, card.price.currency, card.price.currency);
  return card.price.unit === "per_night" ? t("card.per_night", { price: label }) : label;
}

function dateLabel(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).replace(",", " ·");
}

export const DiscoverCard = React.memo(function DiscoverCard({ card, saved, onPress, onSave, now }: Props) {
  const { t } = useTranslation("discover");
  // #4490 Explorer W6a: a venue card says its type, area, lead offer and "On tonight".
  const venue = discoverVenueCardModel(card, now ?? new Date());
  if (venue !== null && card.source === "mingla") {
    return <DiscoverVenueCardBody card={card} venue={venue} saved={saved} onPress={onPress} onSave={onSave} t={t} />;
  }
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
/** The venue variant: the same frame, heart and glass panel as every Discover card. */
function DiscoverVenueCardBody({ card, venue, saved, onPress, onSave, t }: {
  card: Extract<DiscoverCardV2, { source: "mingla" }>;
  venue: DiscoverVenueCardModel;
  saved: boolean;
  onPress: () => void;
  onSave: () => void;
  t: (key: string, values?: Record<string, unknown>) => string;
}) {
  // #4490 W6 fix 1 (W6-N4): the same translated words as the W3 deck's event chip.
  const eventChip = venue.eventChip === "On tonight"
    ? t("cards:deck.on_tonight", { defaultValue: "On tonight" })
    : venue.eventChip === "On today"
    ? t("cards:deck.on_today", { defaultValue: "On today" })
    : null;
  const a11y = [card.title, venue.typeLabel, venue.offerLine, eventChip].filter(Boolean).join(", ");
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} style={styles.card}>
      <EventCoverMedia mediaUrl={card.coverUrl} mediaType={card.coverType} hue={card.coverHue} height="100%" width="100%" radius={24} autoplay={false} playbackActive={false} />
      <LinearGradient colors={["transparent", "rgba(0,0,0,.76)"]} locations={[0.35, 1]} style={StyleSheet.absoluteFill} />
      {venue.typeLabel ? <Text numberOfLines={1} style={[styles.type, styles.venueType]}>{venue.typeLabel}</Text> : null}
      {eventChip ? (
        <View style={styles.venueOn} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.venueOnDot} />
          <Text style={styles.venueOnText}>{eventChip}</Text>
        </View>
      ) : null}
      <Pressable onPress={(event) => { event.stopPropagation(); onSave(); }} accessibilityRole="button" accessibilityLabel={saved ? t("card.saved_a11y", { title: card.title }) : t("card.save_a11y", { title: card.title })} style={styles.heart}>
        <Icon name={saved ? "heart" : "heart-outline"} size={18} color={saved ? "#eb7825" : "#fff"} />
      </Pressable>
      <View style={styles.chip}>
        <Text numberOfLines={2} style={styles.title}>{card.title}</Text>
        {card.meta.venueOrPlace ? <Text numberOfLines={1} style={[styles.meta, styles.venueArea]}>{card.meta.venueOrPlace}</Text> : null}
        {/* #4490 W6 fix 2 (W6-D1): the lead line may wrap to a second line, so a price ("Hire from ₦1,800,000") is never cut mid-number. */}
        {venue.offerLine ? <Text numberOfLines={2} style={styles.venueOffer}>{venue.offerLine}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", aspectRatio: 0.72, borderRadius: 24, overflow: "hidden", backgroundColor: "#252830", shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
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
  // #4490 Explorer W6a venue variant (tokens only).
  venueType: { maxWidth: "70%", backgroundColor: colors.orange[800] },
  venueOn: { position: "absolute", top: 36, left: 10, flexDirection: "row", alignItems: "center", gap: spacing.xs, height: 20, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.gray[900] },
  venueOnDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  venueOnText: { color: colors.text.inverse, fontSize: typography.xs.fontSize, fontWeight: fontWeights.bold },
  venueArea: { flex: 0, marginTop: spacing.xxs },
  venueOffer: { color: colors.text.inverse, fontSize: typography.xs.fontSize, fontWeight: fontWeights.semibold, marginTop: spacing.xxs },
});
