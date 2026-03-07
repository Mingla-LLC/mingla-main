import React from "react";
import {
  View,
  Text,
  ScrollView,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { s, vs, SCREEN_WIDTH, SCREEN_HEIGHT } from "../utils/responsive";
import { colors, spacing, radius, shadows, typography } from "../constants/designSystem";
import { SavedPerson } from "../services/savedPeopleService";
import { usePersonalizedCards } from "../hooks/usePersonalizedCards";

interface PersonRecommendationCardsProps {
  person: SavedPerson;
  location: { latitude: number; longitude: number };
}

type SourceType = "Activity" | "Audio" | "Dining";

const SOURCE_ICONS: Record<SourceType, keyof typeof Ionicons.glyphMap> = {
  Activity: "trending-up-outline",
  Audio: "mic-outline",
  Dining: "restaurant-outline",
};

function getSourceIcon(category: string): keyof typeof Ionicons.glyphMap {
  if (category.toLowerCase().includes("dining") || category.toLowerCase().includes("restaurant")) {
    return "restaurant-outline";
  }
  if (category.toLowerCase().includes("audio") || category.toLowerCase().includes("music")) {
    return "mic-outline";
  }
  return "trending-up-outline";
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
      {data.cards.map((card) => (
        <View key={card.id} style={styles.card}>
          <View style={styles.imageArea}>
            {card.imageUrl ? (
              <Image
                source={{ uri: card.imageUrl }}
                style={styles.cardImage}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.cardImage, styles.placeholderImage]} />
            )}
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryText}>{card.category}</Text>
            </View>
            <View style={styles.sourceChip}>
              <Ionicons
                name={getSourceIcon(card.category)}
                size={s(14)}
                color="#FFFFFF"
              />
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
            {card.rating ? (
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={s(12)} color="#eb7825" />
                <Text style={styles.ratingText}>{card.rating}</Text>
              </View>
            ) : null}
          </View>
        </View>
      ))}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: s(16),
    gap: s(12),
  },
  card: {
    width: s(160),
    height: s(200),
    borderRadius: s(16),
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    ...shadows.sm,
  },
  skeletonCard: {
    backgroundColor: colors.gray[100],
  },
  imageArea: {
    width: "100%",
    height: "60%",
    position: "relative",
  },
  cardImage: {
    width: "100%",
    height: "100%",
  },
  placeholderImage: {
    backgroundColor: colors.gray[300],
  },
  skeletonImage: {
    width: "100%",
    height: "60%",
    backgroundColor: colors.gray[200],
  },
  categoryBadge: {
    position: "absolute",
    top: s(8),
    left: s(8),
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: s(8),
    paddingVertical: vs(3),
    borderRadius: s(8),
  },
  categoryText: {
    fontSize: s(10),
    fontWeight: "600",
    color: "#FFFFFF",
  },
  sourceChip: {
    position: "absolute",
    top: s(8),
    right: s(8),
    backgroundColor: "rgba(0,0,0,0.5)",
    width: s(28),
    height: s(28),
    borderRadius: s(14),
    alignItems: "center",
    justifyContent: "center",
  },
  cardContent: {
    flex: 1,
    padding: s(10),
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: s(13),
    fontWeight: "600",
    color: colors.gray[800],
    marginBottom: vs(2),
  },
  cardAddress: {
    fontSize: s(11),
    color: colors.gray[500],
    marginBottom: vs(2),
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(3),
  },
  ratingText: {
    fontSize: s(11),
    fontWeight: "500",
    color: colors.gray[600],
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
