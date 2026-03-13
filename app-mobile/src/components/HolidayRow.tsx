import React, { useRef, useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { s, vs, SCREEN_WIDTH } from "../utils/responsive";
import { colors } from "../constants/designSystem";
import { usePersonHeroCards } from "../hooks/usePersonHeroCards";
import { useShuffleCards } from "../hooks/useShuffleCards";
import { HolidayCard } from "../services/holidayCardsService";
import { getReadableCategoryName } from "../utils/categoryUtils";
import PersonGridCard from "./PersonGridCard";
import { PriceTierSlug } from "../constants/priceTiers";

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface HolidayRowProps {
  holiday: {
    id: string;
    name: string;
    date: Date;
    daysAway: number;
    icon: string;
    categorySlugs: string[];
  };
  isExpanded: boolean;
  isArchived: boolean;
  personId: string;
  linkedUserId?: string;
  location: { latitude: number; longitude: number };
  onToggle: () => void;
  onArchive: () => void;
  onUnarchive?: () => void;
  onCardPress: (card: HolidayCard) => void;
}

const SWIPE_THRESHOLD = 100;

const HolidayRow: React.FC<HolidayRowProps> = ({
  holiday,
  isExpanded,
  isArchived,
  personId,
  location,
  onToggle,
  onArchive,
  onUnarchive,
  onCardPress,
}) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const chevronRotation = useRef(new Animated.Value(0)).current;
  const isExpandedRef = useRef(isExpanded);
  isExpandedRef.current = isExpanded;

  // Derive curated experience type from category slugs
  const curatedExperienceType = useMemo(() => {
    if (holiday.categorySlugs.includes("romantic")) return "romantic";
    if (holiday.categorySlugs.includes("adventurous")) return "adventurous";
    return null;
  }, [holiday.categorySlugs]);

  // Pool-first cards
  const { data, isLoading, isError, refetch } = usePersonHeroCards({
    personId,
    holidayKey: holiday.id,
    categorySlugs: holiday.categorySlugs,
    curatedExperienceType,
    location,
    enabled: isExpanded && !isArchived,
  });

  const cards = data?.cards ?? [];
  const hasMore = data?.hasMore ?? false;

  // Shuffle mechanic
  const shuffleCards = useShuffleCards();
  const [isShuffling, setIsShuffling] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const handleShuffle = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsShuffling(true);

    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(async () => {
      // Await cache invalidation + refetch before fading back in
      await shuffleCards(personId, holiday.id);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setIsShuffling(false));
    });
  }, [personId, holiday.id, shuffleCards, fadeAnim]);

  useEffect(() => {
    Animated.timing(chevronRotation, {
      toValue: isExpanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isExpanded]);

  const chevronRotateInterpolation = chevronRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        !isExpandedRef.current &&
        Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dy) < 10,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx < 0) {
          translateX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -SWIPE_THRESHOLD) {
          Animated.spring(translateX, {
            toValue: -SCREEN_WIDTH,
            useNativeDriver: true,
          }).start(() => {
            handleArchive();
            translateX.setValue(0);
          });
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const handleArchive = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onArchive();
  };

  const formattedDate = `${SHORT_MONTHS[holiday.date.getMonth()]} ${holiday.date.getDate()}`;

  return (
    <View style={[styles.outerContainer, isArchived && styles.archivedOuter]}>
      {/* Swipe background */}
      <View style={styles.swipeBackground}>
        <Ionicons name="archive-outline" size={s(24)} color="#FFFFFF" />
      </View>

      <Animated.View
        style={[
          styles.rowWrapper,
          { transform: [{ translateX }] },
        ]}
        {...(isArchived ? {} : panResponder.panHandlers)}
      >
        {/* Main row */}
        <TouchableOpacity
          style={styles.row}
          onPress={onToggle}
          activeOpacity={0.7}
        >
          <View style={styles.rowLeft}>
            <Ionicons name={holiday.icon as keyof typeof Ionicons.glyphMap} size={s(22)} color={colors.gray[600]} />
            <View style={styles.rowTextGroup}>
              <Text style={styles.holidayName}>{holiday.name}</Text>
              <Text style={styles.holidayDate}>{formattedDate}</Text>
            </View>
          </View>

          <View style={styles.rowRight}>
            <View style={styles.daysBadge}>
              <Text style={styles.daysBadgeText}>{holiday.daysAway}d</Text>
            </View>

            {isArchived ? (
              <TouchableOpacity
                onPress={onUnarchive}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.actionButton}
              >
                <Ionicons
                  name="arrow-undo-outline"
                  size={s(20)}
                  color={colors.gray[500]}
                />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleArchive}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                style={styles.actionButton}
              >
                <Ionicons
                  name="archive-outline"
                  size={s(20)}
                  color={colors.gray[500]}
                />
              </TouchableOpacity>
            )}

            <Animated.View
              style={{ transform: [{ rotate: chevronRotateInterpolation }] }}
            >
              <Ionicons
                name="chevron-down"
                size={s(20)}
                color={colors.gray[400]}
              />
            </Animated.View>
          </View>
        </TouchableOpacity>

        {/* Expanded area */}
        {isExpanded && !isArchived && (
          <View style={styles.expandedArea}>
            {isLoading ? (
              <View style={styles.expandedStatus}>
                <ActivityIndicator size="small" color="#eb7825" />
                <Text style={styles.loadingText}>Finding picks...</Text>
              </View>
            ) : isError || !cards ? (
              <TouchableOpacity
                style={styles.expandedStatus}
                onPress={() => refetch()}
              >
                <Text style={styles.errorText}>
                  Couldn't load. Tap to retry.
                </Text>
              </TouchableOpacity>
            ) : cards.length === 0 ? (
              <View style={styles.expandedStatus}>
                <Text style={styles.errorText}>
                  No picks found nearby. Try a different location.
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.cardsScrollContent}
              >
                <Animated.View style={[styles.cardsAnimatedRow, { opacity: fadeAnim }]}>
                  {cards.map((card) => (
                    <PersonGridCard
                      key={card.id}
                      id={card.id}
                      title={card.title}
                      category={getReadableCategoryName(card.categorySlug || card.category)}
                      imageUrl={card.imageUrl}
                      priceTier={(card.priceTier as PriceTierSlug) ?? null}
                      priceLevel={card.priceLevel}
                      onPress={() => onCardPress(card)}
                    />
                  ))}
                </Animated.View>

                {/* Shuffle card */}
                <TouchableOpacity
                  style={styles.shuffleCard}
                  onPress={handleShuffle}
                  activeOpacity={0.7}
                  disabled={isShuffling}
                >
                  <Ionicons name="shuffle-outline" size={s(22)} color="rgba(0,0,0,0.4)" />
                  <Text style={styles.shuffleText}>Shuffle</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        )}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    position: "relative",
    marginBottom: vs(2),
    overflow: "hidden",
    borderRadius: s(12),
  },
  archivedOuter: {
    opacity: 0.6,
  },
  swipeBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#E53935",
    justifyContent: "center",
    alignItems: "flex-end",
    paddingRight: s(24),
  },
  rowWrapper: {
    backgroundColor: "#FFFFFF",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: s(16),
    paddingVertical: vs(14),
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: s(12),
  },
  rowTextGroup: {
    flex: 1,
  },
  holidayName: {
    fontSize: s(15),
    fontWeight: "600",
    color: colors.gray[800],
  },
  holidayDate: {
    fontSize: s(12),
    color: colors.gray[500],
    marginTop: vs(2),
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(10),
  },
  daysBadge: {
    backgroundColor: "#eb7825",
    paddingHorizontal: s(8),
    paddingVertical: vs(3),
    borderRadius: s(10),
  },
  daysBadgeText: {
    fontSize: s(11),
    fontWeight: "700",
    color: "#FFFFFF",
  },
  actionButton: {
    padding: s(4),
  },
  expandedArea: {
    paddingBottom: vs(12),
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  expandedStatus: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: vs(20),
    gap: s(8),
  },
  loadingText: {
    fontSize: s(13),
    color: colors.gray[500],
  },
  errorText: {
    fontSize: s(13),
    color: colors.gray[500],
  },
  cardsScrollContent: {
    paddingHorizontal: s(16),
    paddingTop: vs(12),
    paddingBottom: vs(4),
    gap: s(12),
  },
  cardsAnimatedRow: {
    flexDirection: "row",
    gap: s(12),
  },
  // Shuffle card (light theme for holiday rows)
  shuffleCard: {
    width: s(60),
    height: s(180),
    borderRadius: s(12),
    borderWidth: 1.5,
    borderColor: "rgba(0,0,0,0.1)",
    borderStyle: "dashed",
    backgroundColor: "rgba(0,0,0,0.03)",
    justifyContent: "center",
    alignItems: "center",
    gap: vs(4),
  },
  shuffleText: {
    fontSize: s(11),
    fontWeight: "600",
    color: "rgba(0,0,0,0.4)",
  },
});

export default HolidayRow;
