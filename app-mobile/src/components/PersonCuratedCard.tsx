import React from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet } from "react-native";
import { Icon } from "./ui/Icon";
import { s, vs } from "../utils/responsive";
import { colors } from "../constants/designSystem";
import { useLocalePreferences } from "../hooks/useLocalePreferences";
import { formatCurrency } from "./utils/formatters";

export interface PersonCuratedCardProps {
  id: string;
  title: string;
  tagline: string | null;
  categoryLabel: string;
  imageUrl: string | null;
  stops: number;
  totalPriceMin: number | null;
  totalPriceMax: number | null;
  rating: number | null;
  onPress: () => void;
}

const CARD_WIDTH = s(180);
const CARD_HEIGHT = s(240);
const IMAGE_HEIGHT_RATIO = 0.55;
const AMBER = "#F59E0B";

const PersonCuratedCard: React.FC<PersonCuratedCardProps> = ({
  title,
  tagline,
  categoryLabel,
  imageUrl,
  stops,
  totalPriceMin,
  totalPriceMax,
  rating,
  onPress,
}) => {
  const { currency } = useLocalePreferences();
  const priceRange = totalPriceMin != null && totalPriceMax != null
    ? `${formatCurrency(totalPriceMin, currency)}–${formatCurrency(totalPriceMax, currency)}`
    : totalPriceMin != null
      ? `${formatCurrency(totalPriceMin, currency)}+`
      : null;
  const hasRating = rating != null;
  const hasMeta = hasRating || priceRange != null;

  const metaParts: string[] = [];
  if (hasRating) {
    metaParts.push(`\u2605 ${rating}`);
  }
  if (priceRange != null) {
    metaParts.push(priceRange);
  }
  const metaText = metaParts.join(" \u00B7 ");

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.imageSection}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Icon
              name="compass-outline"
              size={s(28)}
              color="rgba(255,255,255,0.6)"
            />
          </View>
        )}
        {stops > 0 && (
          <View style={styles.stopBadge}>
            <Text style={styles.stopBadgeText}>
              {stops} {stops === 1 ? "stop" : "stops"}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.infoSection}>
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryBadgeText}>{categoryLabel}</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {hasMeta && (
          <View style={styles.metaContainer}>
            <Text style={styles.metaText}>{metaText}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: s(16),
    overflow: "hidden",
    backgroundColor: "#1C1C1E",
  },
  imageSection: {
    width: "100%",
    height: CARD_HEIGHT * IMAGE_HEIGHT_RATIO,
    position: "relative",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imagePlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: colors.gray[200],
    alignItems: "center",
    justifyContent: "center",
  },
  stopBadge: {
    position: "absolute",
    top: s(8),
    left: s(8),
    backgroundColor: AMBER,
    borderRadius: s(6),
    paddingHorizontal: s(6),
    paddingVertical: vs(2),
  },
  stopBadgeText: {
    color: "#FFFFFF",
    fontSize: s(10),
    fontWeight: "700",
  },
  infoSection: {
    flex: 1,
    padding: s(10),
  },
  categoryBadge: {
    backgroundColor: AMBER,
    borderRadius: s(6),
    paddingHorizontal: s(6),
    paddingVertical: vs(2),
    alignSelf: "flex-start",
  },
  categoryBadgeText: {
    color: "#FFFFFF",
    fontSize: s(10),
    fontWeight: "700",
  },
  title: {
    color: "#FFFFFF",
    fontSize: s(13),
    fontWeight: "700",
    marginTop: vs(6),
  },
  metaContainer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  metaText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: s(10),
  },
});

export default PersonCuratedCard;
