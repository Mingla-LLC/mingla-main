// NOTE: Visually mirrors DiscoverScreen's inline GridCard. If For You tab design changes, update both.

import React, { useEffect, useState } from "react";
import { View, Text, Image, TouchableOpacity, StyleSheet } from "react-native";
import { Icon } from "./ui/Icon";
import { s, vs, SCREEN_WIDTH } from "../utils/responsive";
import { colors, shadows } from "../constants/designSystem";
import { getCategoryIcon, getReadableCategoryName } from "../utils/categoryUtils";
import { PriceTierSlug } from "../constants/priceTiers";

export const PERSON_GRID_CARD_WIDTH = s(180);

export interface PersonGridCardProps {
  id: string;
  title: string;
  category: string;
  imageUrl: string | null;
  priceTier: PriceTierSlug | null;
  priceLevel: string | null;
  priceRange?: string | null;
  onPress: () => void;
  width?: number;
}

const PersonGridCard: React.FC<PersonGridCardProps> = ({
  title,
  category,
  imageUrl,
  priceRange,
  onPress,
  width,
}) => {
  const categoryIconName = getCategoryIcon(category);
  const readableCategory = getReadableCategoryName(category);
  // Issue #1540 §3.6: the placeholder was gated on `imageUrl` being FALSY, so a
  // present-but-dead URL (404, expired signed URL, offline) rendered a blank
  // white band and no placeholder ever appeared. On a grid of remote,
  // user-saved images that happens routinely.
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [imageUrl]);

  return (
    <TouchableOpacity
      style={[styles.card, width != null && { width }]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      // Issue #1540 §3.6: without these VoiceOver read three loose text
      // fragments beside an unlabelled control.
      accessibilityLabel={`${title}, ${readableCategory}`}
    >
      <View style={styles.imageContainer}>
        {!imageUrl || imageFailed ? (
          <View style={styles.imagePlaceholder}>
            <Icon
              name={categoryIconName}
              size={s(28)}
              // Issue #1540 §3.6: was rgba(255,255,255,0.6) on gray[200] —
              // 1.09:1, effectively invisible. gray[600] on gray[100] is 6.87:1.
              color={colors.gray[600]}
            />
          </View>
        ) : (
          <Image
            source={{ uri: imageUrl }}
            style={styles.image}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
          />
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
          {readableCategory}
        </Text>
        <View style={styles.footer}>
          {priceRange ? (
            <Text style={styles.priceText} numberOfLines={1}>
              {priceRange}
            </Text>
          ) : <View />}
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
    // Issue #1540 §3.6: gray[100] pairs with the gray[600] glyph for 6.87:1.
    backgroundColor: colors.gray[100],
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
