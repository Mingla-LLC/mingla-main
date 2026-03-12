import React from "react";
import {
  View,
  Text,
  ScrollView,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { s, vs, SCREEN_WIDTH, SCREEN_HEIGHT } from "../utils/responsive";
import { colors, spacing, radius, shadows, typography } from "../constants/designSystem";
import { SavedPerson } from "../services/savedPeopleService";
import { usePersonalizedCards } from "../hooks/usePersonalizedCards";
import { getReadableCategoryName, getCategoryColor, getCategoryIcon } from "../utils/categoryUtils";

interface PersonRecommendationCardsProps {
  person: SavedPerson;
  location: { latitude: number; longitude: number };
}

const PersonRecommendationCards: React.FC<PersonRecommendationCardsProps> = ({
  person,
  location,
}) => {
  const { data, isLoading, isError, refetch } = usePersonalizedCards(
    person.linked_user_id
      ? {
          linkedUserId: person.linked_user_id,
          occasion: "general",
          location,
          isBirthday: false,
        }
      : null
  );

  if (isLoading) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {Array.from({ length: 3 }).map((_, i) => (
          <View key={i} style={[styles.card, styles.skeletonCard]}>
            <View style={styles.skeletonImage} />
            <View style={styles.cardContent}>
              <View style={styles.skeletonTitle} />
              <View style={styles.skeletonAddress} />
            </View>
          </View>
        ))}
      </ScrollView>
    );
  }

  if (!person.linked_user_id) {
    return null;
  }

  if (isError || !data) {
    return (
      <TouchableOpacity style={styles.errorContainer} onPress={() => refetch()}>
        <Text style={styles.errorText}>Couldn't load picks. Tap to retry.</Text>
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
    >
      {data.cards.map((card) => {
        const categoryColor = getCategoryColor(card.category);
        const categoryIcon = getCategoryIcon(card.category);
        const categoryLabel = getReadableCategoryName(card.category);

        return (
          <TouchableOpacity
            key={card.id}
            style={styles.card}
            activeOpacity={0.85}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (card.location?.latitude && card.location?.longitude) {
                Linking.openURL(
                  `https://www.google.com/maps/search/?api=1&query=${card.location.latitude},${card.location.longitude}`
                ).catch(() => {});
              } else if (card.address) {
                Linking.openURL(
                  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.address)}`
                ).catch(() => {});
              }
            }}
          >
            <View style={styles.imageArea}>
              {card.imageUrl ? (
                <Image
                  source={{ uri: card.imageUrl }}
                  style={styles.cardImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.cardImage, styles.placeholderImage]}>
                  <Ionicons name={categoryIcon as any} size={s(28)} color="rgba(255,255,255,0.6)" />
                </View>
              )}
              <LinearGradient
                colors={["transparent", "rgba(0,0,0,0.5)"]}
                style={styles.cardGradient}
              />
              <View style={[styles.categoryBadge, { backgroundColor: categoryColor }]}>
                <Text style={styles.categoryText}>{categoryLabel}</Text>
              </View>
            </View>
            <View style={styles.cardContent}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {card.title}
              </Text>
              {card.address ? (
                <Text style={styles.cardAddress} numberOfLines={1}>
                  {card.address}
                </Text>
              ) : null}
              <View style={styles.cardFooter}>
                {card.rating ? (
                  <View style={styles.ratingRow}>
                    <Ionicons name="star" size={s(11)} color="#F59E0B" />
                    <Text style={styles.ratingText}>{card.rating.toFixed(1)}</Text>
                  </View>
                ) : null}
                <View style={styles.mapHint}>
                  <Ionicons name="navigate-outline" size={s(11)} color={colors.gray[400]} />
                </View>
              </View>
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: s(16),
    paddingBottom: vs(4),
    gap: s(12),
  },
  card: {
    width: s(180),
    height: s(230),
    borderRadius: s(16),
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    ...shadows.md,
  },
  skeletonCard: {
    backgroundColor: colors.gray[100],
  },
  imageArea: {
    width: "100%",
    height: "55%",
    position: "relative",
  },
  cardImage: {
    width: "100%",
    height: "100%",
  },
  cardGradient: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "50%",
  },
  placeholderImage: {
    backgroundColor: colors.gray[200],
    alignItems: "center",
    justifyContent: "center",
  },
  skeletonImage: {
    width: "100%",
    height: "55%",
    backgroundColor: colors.gray[200],
  },
  categoryBadge: {
    position: "absolute",
    top: s(8),
    left: s(8),
    paddingHorizontal: s(8),
    paddingVertical: vs(3),
    borderRadius: s(8),
  },
  categoryText: {
    fontSize: s(10),
    fontWeight: "700",
    color: "#FFFFFF",
  },
  cardContent: {
    flex: 1,
    padding: s(12),
    justifyContent: "space-between",
  },
  cardTitle: {
    fontSize: s(13),
    fontWeight: "700",
    color: colors.gray[800],
  },
  cardAddress: {
    fontSize: s(11),
    color: colors.gray[500],
    marginTop: vs(2),
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: vs(4),
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(3),
  },
  ratingText: {
    fontSize: s(11),
    fontWeight: "600",
    color: colors.gray[700],
  },
  mapHint: {
    opacity: 0.6,
  },
  skeletonTitle: {
    width: "80%",
    height: vs(12),
    backgroundColor: colors.gray[200],
    borderRadius: s(4),
    marginBottom: vs(6),
  },
  skeletonAddress: {
    width: "60%",
    height: vs(10),
    backgroundColor: colors.gray[200],
    borderRadius: s(4),
  },
  errorContainer: {
    paddingHorizontal: s(16),
    paddingVertical: vs(24),
    alignItems: "center",
  },
  errorText: {
    fontSize: s(14),
    color: colors.gray[500],
    textAlign: "center",
  },
});

export default PersonRecommendationCards;
