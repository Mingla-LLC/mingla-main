import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { s, vs, SCREEN_WIDTH, SCREEN_HEIGHT } from "../utils/responsive";
import { colors } from "../constants/designSystem";
import { SavedPerson } from "../services/savedPeopleService";
import { HolidayCard } from "../services/holidayCardsService";
import PersonGridCard from "./PersonGridCard";
import PersonCuratedCard from "./PersonCuratedCard";
import { getReadableCategoryName } from "../utils/categoryUtils";
import { PriceTierSlug } from "../constants/priceTiers";

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
  aiSummary: string | null;
  isLoadingSummary: boolean;
  heroCards: HolidayCard[];
  isLoadingHeroCards: boolean;
  generatedCards: HolidayCard[];
  isGenerating: boolean;
  canGenerateMore: boolean;
  onGenerateMore: () => void;
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
  aiSummary,
  isLoadingSummary,
  heroCards,
  isLoadingHeroCards,
  generatedCards,
  isGenerating,
  canGenerateMore,
  onGenerateMore,
  onCardPress,
}) => {
  const hasBirthday = !!person.birthday;
  const allCards = [...heroCards, ...generatedCards];

  // ── Birthday info ──
  const daysAway = hasBirthday ? getDaysUntilBirthday(person.birthday!) : 0;
  const formattedDate = hasBirthday ? formatBirthdayDate(person.birthday!) : "";
  const nextAge = hasBirthday ? getNextAge(person.birthday!) : 0;
  const daysLabel =
    daysAway === 0 ? "today!" : daysAway === 1 ? "day away" : "days away";

  // ── Loading state (only if no summary AND loading) ──
  if (isLoadingSummary && !aiSummary && allCards.length === 0 && isLoadingHeroCards) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={colors.gray[400]} />
      </View>
    );
  }

  const containerStyle = hasBirthday
    ? styles.birthdayContainer
    : styles.noBirthdayContainer;

  const showGenerateMore =
    canGenerateMore && !!person.description && !isGenerating;

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
        {isLoadingHeroCards && allCards.length === 0
          ? Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <SkeletonCard key={`skeleton-${i}`} />
            ))
          : allCards.map((card) =>
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

        {/* Generating spinner */}
        {isGenerating && (
          <View style={styles.generatingContainer}>
            <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" />
          </View>
        )}

        {/* Generate More button */}
        {showGenerateMore && (
          <TouchableOpacity
            style={styles.generateMoreButton}
            onPress={onGenerateMore}
            activeOpacity={0.7}
          >
            <Ionicons
              name="add-circle-outline"
              size={s(28)}
              color="rgba(255,255,255,0.8)"
            />
            <Text style={styles.generateMoreText}>More</Text>
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
  // ── Generating spinner ──
  generatingContainer: {
    width: s(80),
    height: s(240),
    justifyContent: "center",
    alignItems: "center",
  },
  // ── Generate More button ──
  generateMoreButton: {
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
  generateMoreText: {
    fontSize: s(12),
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
  },
});

export default BirthdayHero;
