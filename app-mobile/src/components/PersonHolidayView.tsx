import React, { useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
  GenderOption,
  HolidayDefinition,
  HolidayCardSection,
} from "../types/holidayTypes";
import {
  STANDARD_HOLIDAYS,
  DEFAULT_PERSON_SECTIONS,
} from "../constants/holidays";
import { usePersonalizedCards } from "../hooks/usePersonalizedCards";
import { getCategoryIcon, getCategoryColor } from "../utils/categoryUtils";
import { s, SCREEN_WIDTH } from "../utils/responsive";

interface PersonHolidayViewProps {
  pairedUserId: string;
  pairingId: string;
  displayName: string;
  birthday: string | null;
  gender: string | null;
  location: { latitude: number; longitude: number };
  userId: string;
}

// ── Helper functions ────────────────────────────────────────────────────────

function getDaysUntil(targetMonth: number, targetDay: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thisYear = today.getFullYear();
  let nextOccurrence = new Date(thisYear, targetMonth, targetDay);
  nextOccurrence.setHours(0, 0, 0, 0);

  if (nextOccurrence < today) {
    nextOccurrence = new Date(thisYear + 1, targetMonth, targetDay);
    nextOccurrence.setHours(0, 0, 0, 0);
  }

  const diffTime = nextOccurrence.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getNextOccurrence(
  getDate: (year: number) => Date
): { date: Date; daysAway: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thisYear = today.getFullYear();
  let occurrence = getDate(thisYear);
  occurrence.setHours(0, 0, 0, 0);

  if (occurrence < today) {
    occurrence = getDate(thisYear + 1);
    occurrence.setHours(0, 0, 0, 0);
  }

  const diffTime = occurrence.getTime() - today.getTime();
  const daysAway = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return { date: occurrence, daysAway };
}

function filterHolidaysByGender(
  holidays: HolidayDefinition[],
  gender: GenderOption | string | null
): HolidayDefinition[] {
  return holidays.filter((holiday) => {
    if (!holiday.genderFilter) return true;
    if (!gender) return true;
    return holiday.genderFilter.includes(gender as GenderOption);
  });
}

function formatMonthDay(date: Date): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function formatBirthdayMonthDay(dateStr: string): string {
  const date = new Date(dateStr);
  return formatMonthDay(date);
}

function getSectionIcon(section: HolidayCardSection): string {
  if (section.type === "romantic") return "heart-outline";
  if (section.type === "adventurous") return "compass-outline";
  if (section.categorySlug) return getCategoryIcon(section.categorySlug);
  return "sparkles-outline";
}

function getSectionColor(section: HolidayCardSection): string {
  if (section.type === "romantic") return "#EC4899";
  if (section.type === "adventurous") return "#F59E0B";
  if (section.categorySlug) return getCategoryColor(section.categorySlug);
  return "#6B7280";
}

// ── Card Placeholder Component ─────────────────────────────────────────────

function PlaceholderCard({
  section,
}: {
  section: HolidayCardSection;
}) {
  const icon = getSectionIcon(section);
  const color = getSectionColor(section);

  return (
    <View style={styles.placeholderCard}>
      <View style={[styles.placeholderCardAccent, { backgroundColor: color }]} />
      <View style={styles.placeholderCardContent}>
        <View style={[styles.placeholderIconContainer, { backgroundColor: color + "20" }]}>
          <Ionicons name={icon as any} size={s(24)} color={color} />
        </View>
        <Text style={styles.placeholderCardLabel}>{section.label}</Text>
        <Text style={styles.placeholderCardHint}>Tap to explore</Text>
      </View>
    </View>
  );
}

// ── Personalized Card Component ────────────────────────────────────────────

function PersonalizedCard({
  card,
}: {
  card: {
    id: string;
    title: string;
    category: string;
    imageUrl: string | null;
    rating: number | null;
    priceLevel: string | null;
    address: string | null;
  };
}) {
  const color = getCategoryColor(card.category);
  const icon = getCategoryIcon(card.category);

  return (
    <View style={styles.personalizedCard}>
      <View style={[styles.personalizedCardAccent, { backgroundColor: color }]} />
      <View style={styles.personalizedCardContent}>
        <View style={styles.personalizedCardHeader}>
          <Ionicons name={icon as any} size={s(16)} color={color} />
          <Text style={styles.personalizedCardCategory} numberOfLines={1}>
            {card.category}
          </Text>
        </View>
        <Text style={styles.personalizedCardTitle} numberOfLines={2}>
          {card.title}
        </Text>
        {card.address && (
          <View style={styles.personalizedCardLocation}>
            <Ionicons name="location-outline" size={s(12)} color="#6b7280" />
            <Text style={styles.personalizedCardAddress} numberOfLines={1}>
              {card.address}
            </Text>
          </View>
        )}
        {card.rating && (
          <View style={styles.personalizedCardRating}>
            <Ionicons name="star" size={s(12)} color="#F59E0B" />
            <Text style={styles.personalizedCardRatingText}>
              {card.rating.toFixed(1)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Holiday Section Component ──────────────────────────────────────────────

function HolidaySectionView({
  holiday,
  daysAway,
  date,
  pairedUserId,
  location,
}: {
  holiday: HolidayDefinition;
  daysAway: number;
  date: Date;
  pairedUserId: string;
  location: { latitude: number; longitude: number };
}) {
  const personalizedParams = pairedUserId
    ? {
        linkedUserId: pairedUserId,
        occasion: holiday.id,
        location,
      }
    : null;

  const { data: personalizedData, isLoading } =
    usePersonalizedCards(personalizedParams);

  const hasPersonalized =
    personalizedData?.personalized === true && personalizedData.cards.length > 0;

  return (
    <View style={styles.holidaySection}>
      {/* Holiday header */}
      <View style={styles.holidaySectionHeader}>
        <View style={styles.holidaySectionHeaderLeft}>
          <Text style={styles.holidaySectionName}>{holiday.name}</Text>
          <Text style={styles.holidaySectionDate}>
            {formatMonthDay(date)}
          </Text>
        </View>
        <View style={styles.holidaySectionDays}>
          <Text style={styles.holidaySectionDaysNumber}>{daysAway}</Text>
          <Text style={styles.holidaySectionDaysLabel}>
            {daysAway === 1 ? "day" : "days"}
          </Text>
        </View>
      </View>

      {/* Cards scroll */}
      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#eb7825" />
          <Text style={styles.loadingText}>Loading recommendations...</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cardsScrollContent}
        >
          {hasPersonalized
            ? personalizedData!.cards.map((card) => (
                <PersonalizedCard key={card.id} card={card} />
              ))
            : holiday.sections.map((section, idx) => (
                <PlaceholderCard key={`${holiday.id}-${idx}`} section={section} />
              ))}
        </ScrollView>
      )}
    </View>
  );
}

// ── Birthday Section Component ─────────────────────────────────────────────

function BirthdaySection({
  birthday,
  displayName,
  pairedUserId,
  location,
}: {
  birthday: string | null;
  displayName: string;
  pairedUserId: string;
  location: { latitude: number; longitude: number };
}) {
  if (!birthday) return null;

  const birthdayDate = new Date(birthday);
  const daysAway = getDaysUntil(birthdayDate.getMonth(), birthdayDate.getDate());

  const personalizedParams = pairedUserId
    ? {
        linkedUserId: pairedUserId,
        occasion: "birthday",
        location,
        isBirthday: true,
      }
    : null;

  const { data: personalizedData, isLoading } =
    usePersonalizedCards(personalizedParams);

  const hasPersonalized =
    personalizedData?.personalized === true && personalizedData.cards.length > 0;

  return (
    <View style={styles.birthdaySection}>
      {/* Birthday hero card */}
      <View style={styles.birthdayHeroCard}>
        <View style={styles.birthdayHeroContent}>
          <View style={styles.birthdayHeroLeft}>
            <Text style={styles.birthdayHeroTitle}>
              {displayName}'s Birthday
            </Text>
            <Text style={styles.birthdayHeroSubtitle}>
              {formatBirthdayMonthDay(birthday!)}
            </Text>
          </View>
          <View style={styles.birthdayHeroDays}>
            <Text style={styles.birthdayHeroDaysNumber}>{daysAway}</Text>
            <Text style={styles.birthdayHeroDaysText}>
              {daysAway === 1 ? "day" : "days"}
            </Text>
            <Text style={styles.birthdayHeroDaysLabel}>away</Text>
          </View>
        </View>
      </View>

      {/* Birthday cards */}
      {isLoading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#eb7825" />
          <Text style={styles.loadingText}>Loading recommendations...</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cardsScrollContent}
        >
          {hasPersonalized
            ? personalizedData!.cards.map((card) => (
                <PersonalizedCard key={card.id} card={card} />
              ))
            : DEFAULT_PERSON_SECTIONS.map((section, idx) => (
                <PlaceholderCard key={`birthday-${idx}`} section={section} />
              ))}
        </ScrollView>
      )}
    </View>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function PersonHolidayView({
  pairedUserId,
  pairingId,
  displayName,
  birthday,
  gender,
  location,
  userId,
}: PersonHolidayViewProps) {
  // Filter and sort holidays
  const sortedHolidays = useMemo(() => {
    const filtered = filterHolidaysByGender(STANDARD_HOLIDAYS, gender);
    return filtered
      .map((holiday) => {
        const { date, daysAway } = getNextOccurrence(holiday.getDate);
        return { holiday, date, daysAway };
      })
      .sort((a, b) => a.daysAway - b.daysAway);
  }, [gender]);

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Birthday section */}
      <BirthdaySection
        birthday={birthday}
        displayName={displayName}
        pairedUserId={pairedUserId}
        location={location}
      />

      {/* Standard holidays */}
      {sortedHolidays.length > 0 && (
        <View style={styles.holidaysContainer}>
          <Text style={styles.holidaysTitle}>Upcoming Holidays</Text>
          {sortedHolidays.map(({ holiday, date, daysAway }) => (
            <HolidaySectionView
              key={holiday.id}
              holiday={holiday}
              daysAway={daysAway}
              date={date}
              pairedUserId={pairedUserId}
              location={location}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const CARD_WIDTH = s(160);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: s(80),
  },
  // Birthday section
  birthdaySection: {
    marginBottom: s(24),
  },
  birthdayHeroCard: {
    backgroundColor: "#eb7825",
    borderRadius: s(20),
    padding: s(20),
    marginBottom: s(16),
  },
  birthdayHeroContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  birthdayHeroLeft: {
    flex: 1,
  },
  birthdayHeroTitle: {
    fontSize: s(22),
    fontWeight: "700",
    color: "white",
    marginBottom: s(4),
  },
  birthdayHeroSubtitle: {
    fontSize: s(14),
    color: "rgba(255, 255, 255, 0.9)",
  },
  birthdayHeroDays: {
    alignItems: "flex-end",
  },
  birthdayHeroDaysNumber: {
    fontSize: s(36),
    fontWeight: "700",
    color: "white",
    lineHeight: s(40),
  },
  birthdayHeroDaysText: {
    fontSize: s(16),
    fontWeight: "700",
    color: "white",
    lineHeight: s(24),
    marginTop: s(4),
  },
  birthdayHeroDaysLabel: {
    fontSize: s(14),
    color: "rgba(255, 255, 255, 0.9)",
  },
  // Holidays container
  holidaysContainer: {
    marginBottom: s(24),
  },
  holidaysTitle: {
    fontSize: s(18),
    fontWeight: "700",
    color: "#111827",
    marginBottom: s(16),
  },
  // Holiday section
  holidaySection: {
    backgroundColor: "white",
    borderRadius: s(12),
    marginBottom: s(12),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
    overflow: "hidden",
  },
  holidaySectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: s(16),
    paddingHorizontal: s(16),
  },
  holidaySectionHeaderLeft: {
    flex: 1,
  },
  holidaySectionName: {
    fontSize: s(16),
    fontWeight: "600",
    color: "#111827",
    marginBottom: s(2),
  },
  holidaySectionDate: {
    fontSize: s(13),
    fontWeight: "500",
    color: "#eb7825",
  },
  holidaySectionDays: {
    alignItems: "flex-end",
    marginLeft: s(16),
  },
  holidaySectionDaysNumber: {
    fontSize: s(20),
    fontWeight: "700",
    color: "#eb7825",
  },
  holidaySectionDaysLabel: {
    fontSize: s(12),
    color: "#6b7280",
  },
  // Loading
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: s(24),
    gap: s(12),
  },
  loadingText: {
    fontSize: s(14),
    color: "#6b7280",
  },
  // Cards scroll
  cardsScrollContent: {
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    paddingBottom: s(16),
    gap: s(12),
  },
  // Placeholder card
  placeholderCard: {
    width: CARD_WIDTH,
    backgroundColor: "#fafafa",
    borderRadius: s(12),
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  placeholderCardAccent: {
    height: s(4),
  },
  placeholderCardContent: {
    padding: s(14),
    alignItems: "center",
    justifyContent: "center",
    minHeight: s(100),
  },
  placeholderIconContainer: {
    width: s(44),
    height: s(44),
    borderRadius: s(22),
    justifyContent: "center",
    alignItems: "center",
    marginBottom: s(8),
  },
  placeholderCardLabel: {
    fontSize: s(13),
    fontWeight: "600",
    color: "#374151",
    textAlign: "center",
    marginBottom: s(4),
  },
  placeholderCardHint: {
    fontSize: s(11),
    color: "#9ca3af",
  },
  // Personalized card
  personalizedCard: {
    width: CARD_WIDTH,
    backgroundColor: "white",
    borderRadius: s(12),
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  personalizedCardAccent: {
    height: s(4),
  },
  personalizedCardContent: {
    padding: s(10),
  },
  personalizedCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
    marginBottom: s(6),
  },
  personalizedCardCategory: {
    fontSize: s(11),
    fontWeight: "500",
    color: "#6b7280",
    flex: 1,
  },
  personalizedCardTitle: {
    fontSize: s(13),
    fontWeight: "600",
    color: "#111827",
    marginBottom: s(4),
    lineHeight: s(17),
  },
  personalizedCardLocation: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
    marginBottom: s(4),
  },
  personalizedCardAddress: {
    fontSize: s(11),
    color: "#6b7280",
    flex: 1,
  },
  personalizedCardRating: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(3),
  },
  personalizedCardRatingText: {
    fontSize: s(11),
    fontWeight: "500",
    color: "#1f2937",
  },
});
