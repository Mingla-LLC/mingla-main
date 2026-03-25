import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Dimensions,
} from "react-native";
import { Icon } from "../ui/Icon";
import { ImageWithFallback } from "../figma/ImageWithFallback";
import { useLocalePreferences } from "../../hooks/useLocalePreferences";
import { formatPriceRange } from "../utils/formatters";

function getTravelModeIcon(mode?: string): string {
  switch (mode) {
    case 'driving': return 'car';
    case 'transit': return 'bus-outline';
    case 'bicycling':
    case 'biking': return 'bicycle-outline';
    case 'walking':
    default: return 'walk-outline';
  }
}

interface BoardSessionCardProps {
  card: any;
  voteCounts?: {
    yes: number;
    no: number;
    userVote: "yes" | "no" | null;
  };
  rsvpCounts?: {
    responded: number;
    total: number;
    userRSVP: "yes" | "no" | null;
  };
  onVote?: (cardId: string, vote: "yes" | "no") => void;
  onRSVP?: (cardId: string, rsvp: "yes" | "no") => void;
  onViewDetails?: (cardId: string) => void;
  currentIndex?: number;
  totalCards?: number;
}

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const CARD_WIDTH = SCREEN_WIDTH - 32;

export const BoardSessionCard: React.FC<BoardSessionCardProps> = ({
  card,
  voteCounts = { yes: 0, no: 0, userVote: null },
  rsvpCounts = { responded: 0, total: 0, userRSVP: null },
  onVote,
  onRSVP,
  onViewDetails,
  currentIndex = 0,
  totalCards = 1,
}) => {
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const { currency } = useLocalePreferences();
  const cardData = card.card_data || card.experience_data || {};
  const images = cardData.images?.length ? cardData.images : (cardData.image ? [cardData.image] : []);
  const matchScore = Math.round(cardData.matchScore || 0);

  const handleImageSwipe = (direction: "left" | "right") => {
    if (direction === "left" && currentImageIndex < images.length - 1) {
      setCurrentImageIndex(currentImageIndex + 1);
    } else if (direction === "right" && currentImageIndex > 0) {
      setCurrentImageIndex(currentImageIndex - 1);
    }
  };

  return (
    <TouchableOpacity 
      style={styles.cardContainer} 
      activeOpacity={0.95}
      onPress={() => onViewDetails?.(card.id)}
    >
      <View style={styles.card}>
        {/* Image Section */}
        <View style={styles.imageContainer}>
          <ImageWithFallback
            source={{ uri: images[currentImageIndex] || cardData.image }}
            style={styles.cardImage}
            resizeMode="cover"
          />

          {/* Gradient Overlay */}
          <View style={styles.gradientOverlay} />

          {/* Match Score Badge */}
          <View style={styles.matchBadge}>
            <Text style={styles.matchBadgeText}>{matchScore}% Match</Text>
          </View>

          {/* Image Counter */}
          {images.length > 1 && (
            <View style={styles.imageCounter}>
              <Text style={styles.imageCounterText}>
                {currentImageIndex + 1}/{images.length}
              </Text>
            </View>
          )}

          {/* Title and Source Overlay */}
          <View style={styles.imageOverlay}>
            <View style={styles.titleSection}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {cardData.title || "Untitled"}
              </Text>
              {cardData.source && (
                <Text style={styles.sourceText}>♡ {cardData.source}</Text>
              )}
            </View>

            {/* Eye Icon Button */}
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => onViewDetails?.(card.id)}
            >
              <Icon name="eye" size={20} color="white" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Details Section */}
        <View style={styles.detailsSection}>
          {/* Stats Row */}
          <View style={styles.statsRow}>
            {cardData.rating != null && cardData.rating > 0 && (
              <View style={styles.statItem}>
                <Icon name="star" size={14} color="#fbbf24" />
                <Text style={styles.statText}>
                  {Number(cardData.rating).toFixed(1)} (
                  {cardData.reviewCount || 0})
                </Text>
              </View>
            )}
            {cardData.travelTime && cardData.travelTime !== '0 min' && (
              <View style={styles.statItem}>
                <Icon name={getTravelModeIcon(cardData.travelMode)} size={14} color="#eb7825" />
                <Text style={styles.statText}>
                  {cardData.travelTime}
                </Text>
              </View>
            )}
            <Text style={styles.priceText}>
              {cardData.priceRange ? formatPriceRange(cardData.priceRange, currency) : '—'}
            </Text>
          </View>

          {/* Description */}
          <Text style={styles.description} numberOfLines={2}>
            {cardData.description || cardData.fullDescription || ""}
          </Text>

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            {/* Thumbs Up */}
            <TouchableOpacity
              style={[styles.voteButton, styles.thumbsUpButton]}
              onPress={() => onVote?.(card.id, "yes")}
            >
              <Icon name="thumbs-up" size={20} color="white" />
              <Text style={styles.voteButtonText}>{voteCounts.yes}</Text>
            </TouchableOpacity>

            {/* Thumbs Down */}
            <TouchableOpacity
              style={[styles.voteButton, styles.thumbsDownButton]}
              onPress={() => onVote?.(card.id, "no")}
            >
              <Icon name="thumbs-down" size={20} color="#d63d1f" />
              <Text style={styles.thumbsDownText}>{voteCounts.no}</Text>
            </TouchableOpacity>
          </View>

          {/* RSVP Button */}
          <TouchableOpacity
            style={[
              styles.rsvpButton,
              rsvpCounts.userRSVP === "yes" && styles.rsvpButtonActive,
            ]}
            onPress={() => onRSVP?.(card.id, "yes")}
          >
            <Text
              style={[
                styles.rsvpButtonText,
                rsvpCounts.userRSVP === "yes" && styles.rsvpButtonTextActive,
              ]}
            >
              {rsvpCounts.userRSVP === "yes" ? "RSVP'd Yes" : "RSVP Yes"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Pagination Dots */}
      {totalCards > 1 && (
        <View style={styles.paginationDots}>
          {Array.from({ length: totalCards }).map((_, index) => (
            <View
              key={index}
              style={[
                styles.paginationDot,
                index === currentIndex && styles.paginationDotActive,
              ]}
            />
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    width: CARD_WIDTH,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  card: {
    backgroundColor: "white",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  imageContainer: {
    width: "100%",
    height: 400,
    position: "relative",
  },
  cardImage: {
    width: "100%",
    height: "100%",
  },
  gradientOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 150,
    /*    backgroundColor: "rgba(0, 0, 0, 0.5)", */
  },
  matchBadge: {
    position: "absolute",
    top: 16,
    left: 16,
    backgroundColor: "#eb7825",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  matchBadgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  imageCounter: {
    position: "absolute",
    top: 16,
    right: 16,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  imageCounterText: {
    color: "white",
    fontSize: 12,
    fontWeight: "500",
  },
  imageOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  titleSection: {
    flex: 1,
  },
  cardTitle: {
    color: "white",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 4,
  },
  sourceText: {
    color: "white",
    fontSize: 14,
    opacity: 0.9,
  },
  eyeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 12,
  },
  detailsSection: {
    padding: 16,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 16,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statText: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "500",
  },
  priceText: {
    fontSize: 14,
    color: "#eb7825",
    fontWeight: "500",
    marginLeft: "auto",
  },
  description: {
    fontSize: 14,
    color: "#6b7280",
    lineHeight: 20,
    marginBottom: 16,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
  voteButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 12,
    gap: 8,
  },
  thumbsUpButton: {
    // oklch(0.723 0.219 149.579) converted to hex
    backgroundColor: "#22c55e",
    borderRadius: 24,
  },
  thumbsDownButton: {
    // oklch(0.98 0.016 73.684) - light red/pinkish hue
    backgroundColor: "#ffebee",
    borderRadius: 24,
  },
  voteButtonActive: {
    backgroundColor: "#d63d1f",
  },
  voteButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "white",
  },
  voteButtonTextActive: {
    color: "white",
  },
  thumbsDownText: {
    color: "#d63d1f",
  },
  rsvpButton: {
    // oklch(0.98 0.016 73.684) - light red/pinkish hue
    backgroundColor: "#ffebee",
    paddingVertical: 8,
    borderRadius: 24,
    alignItems: "center",
  },
  rsvpButtonActive: {
    backgroundColor: "#eb7825",
  },
  rsvpButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#eb7825",
  },
  rsvpButtonTextActive: {
    color: "white",
  },
  paginationDots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#d1d5db",
  },
  paginationDotActive: {
    backgroundColor: "#eb7825",
    width: 24,
  },
});
