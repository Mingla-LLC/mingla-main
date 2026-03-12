import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Animated,
  PanResponder,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { s, vs, SCREEN_WIDTH, SCREEN_HEIGHT } from "../utils/responsive";
import { colors, spacing, radius, shadows, typography } from "../constants/designSystem";
import { useHolidayCards } from "../hooks/useHolidayCards";
import { getReadableCategoryName, getCategoryColor, getCategoryIcon } from "../utils/categoryUtils";

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
}

const SWIPE_THRESHOLD = 100;

const HolidayRow: React.FC<HolidayRowProps> = ({
  holiday,
  isExpanded,
  isArchived,
  personId,
  linkedUserId,
  location,
  onToggle,
  onArchive,
  onUnarchive,
}) => {
  const translateX = useRef(new Animated.Value(0)).current;
  const chevronRotation = useRef(new Animated.Value(0)).current;

  const { data, isLoading, isError, refetch } = useHolidayCards({
    holidayKey: holiday.id,
    personId,
    linkedUserId,
    location,
    categorySlugs: holiday.categorySlugs,
    enabled: isExpanded && !isArchived,
  });

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
            <Ionicons name={holiday.icon as any} size={s(22)} color={colors.gray[600]} />
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
            ) : isError || !data ? (
              <TouchableOpacity
                style={styles.expandedStatus}
                onPress={() => refetch()}
              >
                <Text style={styles.errorText}>
                  Couldn't load. Tap to retry.
                </Text>
              </TouchableOpacity>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.cardsScrollContent}
              >
                {data.map((card) => {
                  const slugKey = card.categorySlug || card.category;
                  const categoryColor = getCategoryColor(slugKey);
                  const categoryIcon = getCategoryIcon(slugKey);
                  const categoryLabel = getReadableCategoryName(slugKey);

                  return (
                    <TouchableOpacity
                      key={card.id}
                      style={styles.holidayCard}
                      activeOpacity={0.85}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        if (card.lat && card.lng) {
                          Linking.openURL(
                            `https://www.google.com/maps/search/?api=1&query=${card.lat},${card.lng}`
                          ).catch(() => {});
                        } else if (card.address) {
                          Linking.openURL(
                            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(card.address)}`
                          ).catch(() => {});
                        }
                      }}
                    >
                      <View style={styles.cardImageArea}>
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
  holidayCard: {
    width: s(180),
    height: s(230),
    borderRadius: s(16),
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    ...shadows.md,
  },
  cardImageArea: {
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
});

export default HolidayRow;
