import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { s, vs, SCREEN_HEIGHT } from "../utils/responsive";
import { colors } from "../constants/designSystem";
import { SavedPerson } from "../services/savedPeopleService";
import { HolidayCard } from "../services/holidayCardsService";
import PersonGridCard from "./PersonGridCard";
import PersonCuratedCard from "./PersonCuratedCard";
import { getReadableCategoryName } from "../utils/categoryUtils";
import { PriceTierSlug } from "../constants/priceTiers";
import { usePersonHeroCards } from "../hooks/usePersonHeroCards";
import { useShuffleCards } from "../hooks/useShuffleCards";
import { DEFAULT_PERSON_SECTIONS, INTENT_CATEGORY_MAP } from "../constants/holidays";

// ── Constants ────────────────────────────────────────────────────────────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SKELETON_COUNT = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDaysUntilBirthday(birthdayStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const bday = new Date(birthdayStr);
  const thisYear = today.getFullYear();
  let next = new Date(thisYear, bday.getMonth(), bday.getDate());
  next.setHours(0, 0, 0, 0);
  if (next < today) {
    next = new Date(thisYear + 1, bday.getMonth(), bday.getDate());
  }
  return Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatBirthdayDate(birthdayStr: string): string {
  const bday = new Date(birthdayStr);
  return `${MONTHS[bday.getMonth()]} ${bday.getDate()}`;
}

function getAge(birthdayStr: string): number {
  const today = new Date();
  const bday = new Date(birthdayStr);
  let age = today.getFullYear() - bday.getFullYear();
  const monthDiff = today.getMonth() - bday.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < bday.getDate())) {
    age--;
  }
  return age;
}

function getNextAge(birthdayStr: string): number {
  return getAge(birthdayStr) + 1;
}

// ── Props ────────────────────────────────────────────────────────────────────

interface BirthdayHeroProps {
  person: SavedPerson;
  personId: string;
  location: { latitude: number; longitude: number };
  userId: string;
  aiSummary: string | null;
  isLoadingSummary: boolean;
  onCardPress: (card: HolidayCard) => void;
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

const BirthdayHero: React.FC<BirthdayHeroProps> = ({
  person,
  personId,
  location,
  userId,
  aiSummary,
  isLoadingSummary,
  onCardPress,
}) => {
  const hasBirthday = !!person.birthday;

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

  // ── Pool-first hero cards ──
  const { data, isLoading: isLoadingHeroCards } = usePersonHeroCards({
    personId,
    holidayKey: "hero",
    categorySlugs,
    curatedExperienceType,
    location,
    enabled: true,
  });

  const heroCards = data?.cards ?? [];
  const hasMore = data?.hasMore ?? false;

  // ── Shuffle mechanic ──
  const shuffleCards = useShuffleCards();
  const [isShuffling, setIsShuffling] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const handleShuffle = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsShuffling(true);

    // Fade out
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(async () => {
      // Invalidate cache → triggers refetch; await ensures data is ready before fade-in
      await shuffleCards(personId, "hero");
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setIsShuffling(false));
    });
  }, [personId, shuffleCards, fadeAnim]);

  // ── Birthday info ──
  const daysAway = hasBirthday ? getDaysUntilBirthday(person.birthday!) : 0;
  const formattedDate = hasBirthday ? formatBirthdayDate(person.birthday!) : "";
  const nextAge = hasBirthday ? getNextAge(person.birthday!) : 0;
  const daysLabel =
    daysAway === 0 ? "today!" : daysAway === 1 ? "day away" : "days away";

  // ── Loading state (only if no summary AND loading) ──
  if (isLoadingSummary && !aiSummary && heroCards.length === 0 && isLoadingHeroCards) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={colors.gray[400]} />
      </View>
    );
  }

  const containerStyle = hasBirthday
    ? styles.birthdayContainer
    : styles.noBirthdayContainer;

  return (
    <View
      style={[styles.container, containerStyle]}
      accessibilityLabel={
        hasBirthday
          ? `${person.name}'s birthday in ${daysAway} days`
          : `${person.name}'s Picks`
      }
    >
      {/* ── Info section ── */}
      {hasBirthday ? (
        <>
          <View style={styles.infoRow}>
            <View style={styles.infoLeft}>
              <Text style={styles.birthdayTitle}>{person.name}'s Birthday</Text>
              <Text style={styles.birthdayDate}>{formattedDate}</Text>
            </View>
            <View style={styles.ageBadge}>
              <Text style={styles.ageBadgeText}>Turning {nextAge}</Text>
            </View>
          </View>

          <View style={styles.countdownSection}>
            {daysAway === 0 ? (
              <Text style={styles.countdownNumber}>!</Text>
            ) : (
              <Text style={styles.countdownNumber}>{daysAway}</Text>
            )}
            <Text style={styles.countdownLabel}>{daysLabel}</Text>
          </View>
        </>
      ) : (
        <View style={styles.noBirthdayHeader}>
          <Text style={styles.noBirthdayTitle}>{person.name}'s Picks</Text>
          <Text style={styles.noBirthdaySubtitle}>Experiences they'd love</Text>
        </View>
      )}

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
  },
  loadingContainer: {
    backgroundColor: colors.gray[200],
    justifyContent: "center",
    alignItems: "center",
  },
  birthdayContainer: {
    backgroundColor: "#eb7825",
  },
  noBirthdayContainer: {
    backgroundColor: colors.gray[800],
  },
  // ── Info row (birthday variant) ──
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: s(12),
  },
  infoLeft: {
    flex: 1,
  },
  birthdayTitle: {
    fontSize: s(22),
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: vs(4),
  },
  birthdayDate: {
    fontSize: s(16),
    fontWeight: "500",
    color: "rgba(255,255,255,0.85)",
  },
  ageBadge: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: s(12),
    paddingHorizontal: s(12),
    paddingVertical: vs(6),
  },
  ageBadgeText: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#FFFFFF",
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
  },
  // ── No-birthday header ──
  noBirthdayHeader: {
    marginBottom: vs(12),
  },
  noBirthdayTitle: {
    fontSize: s(24),
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: vs(8),
  },
  noBirthdaySubtitle: {
    fontSize: s(16),
    fontWeight: "400",
    color: "rgba(255,255,255,0.7)",
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

export default BirthdayHero;
