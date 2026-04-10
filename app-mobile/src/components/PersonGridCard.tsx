// NOTE: Visually mirrors DiscoverScreen's inline GridCard. If For You tab design changes, update both.

import React from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet } from "react-native";
import { Icon } from "./ui/Icon";
import { s, vs, SCREEN_WIDTH } from "../utils/responsive";
import { colors, shadows } from "../constants/designSystem";
import { getCategoryIcon, getReadableCategoryName } from "../utils/categoryUtils";
import {
  formatTierLabel,
  googleLevelToTierSlug,
  PriceTierSlug,
} from "../constants/priceTiers";
import { useLocalePreferences } from "../hooks/useLocalePreferences";
import { getCurrencySymbol, getCurrencyRate } from "./utils/formatters";

export const PERSON_GRID_CARD_WIDTH = s(180);

export interface PersonGridCardProps {
  id: string;
  title: string;
  category: string;
  imageUrl: string | null;
  priceTier: PriceTierSlug | null;
  priceLevel: string | null;
  onPress: () => void;
  width?: number;
}

const PersonGridCard: React.FC<PersonGridCardProps> = ({
  title,
  category,
  imageUrl,
  priceTier,
  priceLevel,
  onPress,
  width,
}) => {
  const { currency } = useLocalePreferences();
  const resolvedTier: PriceTierSlug =
    priceTier ?? googleLevelToTierSlug(priceLevel);
  const formattedPrice = formatTierLabel(resolvedTier, getCurrencySymbol(currency), getCurrencyRate(currency));
  const categoryIconName = getCategoryIcon(category);

  return (
    <TouchableOpacity
      style={[styles.card, width != null && { width }]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={styles.imageContainer}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.image}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.imagePlaceholder}>
            <Icon
              name={categoryIconName}
              size={s(28)}
              color="rgba(255,255,255,0.6)"
            />
          </View>
        )}
        <View style={styles.categoryBadge}>
          <Icon
            name={categoryIconName}
            size={s(16)}
            color="#eb7825"
          />
        </View>
      </View>

      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.categoryLabel} numberOfLines={1}>
          {getReadableCategoryName(category)}
        </Text>
        <View style={styles.footer}>
          <Text style={styles.priceText} numberOfLines={1}>
            {formattedPrice}
          </Text>
          <View style={styles.arrowButton}>
            <Icon name="chevron-right" size={s(14)} color="#FFFFFF" />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    width: PERSON_GRID_CARD_WIDTH,
    height: s(240),
    borderRadius: s(16),
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: s(8),
    elevation: 3,
  },
  imageContainer: {
    width: "100%",
    height: s(130),
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
  categoryBadge: {
    position: "absolute",
    bottom: s(8),
    left: s(8),
    width: s(28),
    height: s(28),
    borderRadius: s(14),
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: s(12),
    flex: 1,
  },
  title: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#111827",
    lineHeight: s(18),
    minHeight: s(36),
  },
  categoryLabel: {
    fontSize: s(12),
    fontWeight: "500",
    color: "#6b7280",
    marginBottom: vs(8),
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  priceText: {
    fontSize: s(9),
    fontWeight: "500",
    color: "#eb7825",
    flex: 1,
  },
  arrowButton: {
    width: s(24),
    height: s(24),
    borderRadius: s(12),
    backgroundColor: "#eb7825",
    alignItems: "center",
    justifyContent: "center",
  },
});

export default PersonGridCard;
