import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { s, vs, SCREEN_HEIGHT } from "../utils/responsive";
import { SavedPerson } from "../services/savedPeopleService";
import { HolidayCard } from "../services/holidayCardsService";
import PersonGridCard from "./PersonGridCard";
import PersonCuratedCard from "./PersonCuratedCard";
import { getReadableCategoryName } from "../utils/categoryUtils";
import { PriceTierSlug } from "../constants/priceTiers";
import { usePersonHeroCards } from "../hooks/usePersonHeroCards";
import { useShuffleCards } from "../hooks/useShuffleCards";
import { useCustomDayAiSummary } from "../hooks/useCustomDayAiSummary";
import { DEFAULT_PERSON_SECTIONS, INTENT_CATEGORY_MAP } from "../constants/holidays";

// ── Constants ────────────────────────────────────────────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SKELETON_COUNT = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCustomDayDaysAway(month: number, day: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();
  let next = new Date(thisYear, month - 1, day);
  next.setHours(0, 0, 0, 0);
  if (next < today) {
    next = new Date(thisYear + 1, month - 1, day);
    next.setHours(0, 0, 0, 0);
  }
  return Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getCommemorationYear(originalYear: number, month: number, day: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();
  const thisYearDate = new Date(thisYear, month - 1, day);
  thisYearDate.setHours(0, 0, 0, 0);
  let year = thisYear - originalYear;
  if (thisYearDate < today) {
    year = thisYear + 1 - originalYear;
  }
  return year;
}

function formatCustomDayDate(month: number, day: number): string {
  return `${MONTHS[month - 1]} ${day}`;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface CustomDayHeroProps {
  person: SavedPerson;
  personId: string;
  customDay: {
    id: string;
    name: string;
    month: number;
    day: number;
    year: number;
  };
  location: { latitude: number; longitude: number };
  userId: string;
  onCardPress: (card: HolidayCard) => void;
  onArchive: (holidayId: string) => void;
}

// ── Skeleton Card ────────────────────────────────────────────────────────────

const SkeletonCard: React.FC = () => (
  <View style={styles.skeletonCard}>
    <View style={styles.skeletonImage} />
    <View style={styles.skeletonContent}>
      <View style={styles.skeletonLine} />
      <View style={styles.skeletonLineShort} />
    </View>
  </View>
);

// ── Main Component ───────────────────────────────────────────────────────────

const CustomDayHero: React.FC<CustomDayHeroProps> = ({
  person,
  personId,
  customDay,
  location,
  userId,
  onCardPress,
  onArchive,
}) => {
  // ── Derive category slugs from DEFAULT_PERSON_SECTIONS ──
  const categorySlugs = useMemo(() => {
    return DEFAULT_PERSON_SECTIONS
      .flatMap((sec) => {
        if (sec.categorySlug) return [sec.categorySlug];
        const mapped = INTENT_CATEGORY_MAP[sec.type];
        return mapped ?? [];
      })
      .filter(Boolean);
  }, []);

  const curatedExperienceType = useMemo(() => {
    const hasRomantic = DEFAULT_PERSON_SECTIONS.some((s) => s.type === "romantic");
    return hasRomantic ? "romantic" : null;
  }, []);

  // ── Pool-first hero cards — unique cache key per custom day ──
  const holidayKey = `custom-${customDay.id}`;
  const { data, isLoading: isLoadingHeroCards } = usePersonHeroCards({
    personId,
    holidayKey,
    categorySlugs,
    curatedExperienceType,
    location,
    enabled: true,
  });

  const heroCards = data?.cards ?? [];

  // ── AI Summary ──
  const commemorationYear = getCommemorationYear(
    customDay.year,
    customDay.month,
    customDay.day
  );

  const aiParams = useMemo(() => ({
    personId,
    personName: person.name,
    gender: person.gender,
    description: person.description,
    linkedUserId: undefined,
    customDayName: customDay.name,
    customDayYear: commemorationYear,
    dayId: customDay.id,
  }), [personId, person.name, person.gender, person.description, customDay.name, commemorationYear, customDay.id]);

  const { data: aiSummary } = useCustomDayAiSummary(aiParams);

  // ── Shuffle mechanic ──
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
      await shuffleCards(personId, holidayKey);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setIsShuffling(false));
    });
  }, [personId, holidayKey, shuffleCards, fadeAnim]);

  // ── Day info ──
  const daysAway = getCustomDayDaysAway(customDay.month, customDay.day);
  const formattedDate = formatCustomDayDate(customDay.month, customDay.day);
  const isToday = daysAway === 0;

  const daysLabel = isToday
    ? "It's today. Go make it unforgettable."
    : daysAway === 1
      ? "day to make it count"
      : "days to make it count";

  return (
    <View
      style={styles.container}
      accessibilityLabel={`${person.name}'s ${customDay.name} in ${daysAway} days`}
    >
      {/* ── Info section ── */}
      <View style={styles.infoRow}>
        <View style={styles.infoLeft}>
          <Text style={styles.heroTitle}>
            {person.name}&apos;s {customDay.name}
          </Text>
          <Text style={styles.heroDate}>{formattedDate}</Text>
        </View>
        <View style={styles.infoRight}>
          {commemorationYear > 0 ? (
            <View style={styles.yearBadge}>
              <Text style={styles.yearBadgeText}>Year {commemorationYear}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={styles.archiveButton}
            onPress={() => {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onArchive(customDay.id);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={`Archive ${customDay.name}`}
          >
            <Ionicons
              name="archive-outline"
              size={s(18)}
              color="rgba(255,255,255,0.7)"
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Countdown ── */}
      <View style={styles.countdownSection}>
        <Text style={styles.countdownNumber}>
          {isToday ? "!" : daysAway}
        </Text>
        <Text style={styles.countdownLabel}>{daysLabel}</Text>
      </View>

      {/* ── Gift suggestion ── */}
      {aiSummary ? (
        <View style={styles.summarySection}>
          <Ionicons
            name="gift-outline"
            size={s(14)}
            color="rgba(255,255,255,0.85)"
            style={styles.giftIcon}
          />
          <Text style={styles.summaryText}>{aiSummary}</Text>
        </View>
      ) : null}

      {/* ── Hero cards scroll ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.cardsScrollContent}
        style={styles.cardsScroll}
      >
        <Animated.View style={[styles.cardsAnimatedRow, { opacity: fadeAnim }]}>
          {isLoadingHeroCards && heroCards.length === 0
            ? Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                <SkeletonCard key={`skeleton-${i}`} />
              ))
            : heroCards.map((card) =>
                card.cardType === "curated" ? (
                  <PersonCuratedCard
                    key={card.id}
                    id={card.id}
                    title={card.title}
                    tagline={card.tagline ?? card.description}
                    categoryLabel={getReadableCategoryName(card.categorySlug || card.category)}
                    imageUrl={card.imageUrl}
                    stops={card.stops}
                    totalPriceMin={card.totalPriceMin}
                    totalPriceMax={card.totalPriceMax}
                    rating={card.rating}
                    onPress={() => onCardPress(card)}
                  />
                ) : (
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
                )
              )}
        </Animated.View>

        {/* Shuffle card */}
        {heroCards.length > 0 && (
          <TouchableOpacity
            style={styles.shuffleCard}
            onPress={handleShuffle}
            activeOpacity={0.7}
            disabled={isShuffling}
          >
            <Ionicons name="shuffle-outline" size={s(28)} color="rgba(255,255,255,0.8)" />
            <Text style={styles.shuffleText}>Shuffle</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
};

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: "100%",
    minHeight: SCREEN_HEIGHT * 0.55,
    borderRadius: s(16),
    padding: s(24),
    paddingBottom: s(16),
    overflow: "hidden",
    backgroundColor: "#eb7825",
  },
  // ── Info row ──
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: s(12),
  },
  infoLeft: {
    flex: 1,
  },
  infoRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },
  heroTitle: {
    fontSize: s(22),
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: vs(4),
  },
  heroDate: {
    fontSize: s(16),
    fontWeight: "500",
    color: "rgba(255,255,255,0.85)",
  },
  yearBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: s(12),
    paddingHorizontal: s(12),
    paddingVertical: vs(6),
  },
  yearBadgeText: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#FFFFFF",
  },
  archiveButton: {
    width: s(32),
    height: s(32),
    borderRadius: s(16),
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  // ── Countdown ──
  countdownSection: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: vs(8),
  },
  countdownNumber: {
    fontSize: s(56),
    fontWeight: "800",
    color: "#FFFFFF",
    lineHeight: s(64),
  },
  countdownLabel: {
    fontSize: s(18),
    fontWeight: "600",
    color: "rgba(255,255,255,0.9)",
    marginTop: vs(4),
    textAlign: "center",
  },
  // ── Gift suggestion ──
  summarySection: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: vs(12),
  },
  giftIcon: {
    marginRight: s(6),
    marginTop: vs(2),
  },
  summaryText: {
    flex: 1,
    fontSize: s(14),
    fontStyle: "italic",
    color: "rgba(255,255,255,0.85)",
    lineHeight: s(20),
  },
  // ── Cards scroll ──
  cardsScroll: {
    marginHorizontal: -s(24),
    marginTop: vs(8),
  },
  cardsScrollContent: {
    paddingHorizontal: s(16),
    gap: s(12),
    alignItems: "flex-start",
  },
  cardsAnimatedRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: s(12),
  },
  // ── Skeleton card ──
  skeletonCard: {
    width: s(180),
    height: s(240),
    borderRadius: s(16),
    backgroundColor: "rgba(255,255,255,0.15)",
    overflow: "hidden",
  },
  skeletonImage: {
    width: "100%",
    height: s(130),
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  skeletonContent: {
    padding: s(12),
  },
  skeletonLine: {
    width: "80%",
    height: vs(12),
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: s(4),
    marginBottom: vs(8),
  },
  skeletonLineShort: {
    width: "50%",
    height: vs(10),
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: s(4),
  },
  // ── Shuffle card ──
  shuffleCard: {
    width: s(80),
    height: s(240),
    borderRadius: s(16),
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
    borderStyle: "dashed",
    backgroundColor: "rgba(255,255,255,0.15)",
    justifyContent: "center",
    alignItems: "center",
    gap: vs(6),
  },
  shuffleText: {
    fontSize: s(12),
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
  },
});

export default CustomDayHero;
