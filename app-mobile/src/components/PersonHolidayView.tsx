import React, { useMemo, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  GenderOption,
  HolidayDefinition,
  HolidayCardSection,
} from "../types/holidayTypes";
import {
  STANDARD_HOLIDAYS,
  DEFAULT_PERSON_SECTIONS,
} from "../constants/holidays";
import { usePairedCards, useShufflePairedCards } from "../hooks/usePairedCards";
import { useHolidayCategories } from "../hooks/useHolidayCategories";
import { getCategoryIcon, getCategoryColor } from "../utils/categoryUtils";
import { ordinal } from "../utils/ordinalSuffix";
import { s, SCREEN_WIDTH } from "../utils/responsive";
import CalendarButton from "./CalendarButton";
import ShuffleButton from "./ShuffleButton";

interface PersonHolidayViewProps {
  pairedUserId: string;
  pairingId: string;
  displayName: string;
  birthday: string | null;
  gender: string | null;
  location: { latitude: number; longitude: number };
  userId: string;
  /** Custom holidays passed down from parent */
  customHolidays?: Array<{
    id: string;
    name: string;
    month: number;
    day: number;
    year: number;
  }>;
}

// ── Helper functions ────────────────────────────────────────────────────────

function getFirstName(displayName: string): string {
  return displayName.split(" ")[0] || displayName;
}

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

function getNextOccurrenceDate(month: number, day: number): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();
  let d = new Date(thisYear, month, day);
  d.setHours(0, 0, 0, 0);
  if (d < today) {
    d = new Date(thisYear + 1, month, day);
    d.setHours(0, 0, 0, 0);
  }
  return d;
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

/**
 * Parses a "YYYY-MM-DD" date string into local year/month/day
 * without the UTC midnight shift that `new Date("YYYY-MM-DD")` causes.
 */
function parseDateOnly(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { year: y, month: m - 1, day: d }; // month is 0-indexed
}

function formatBirthdayMonthDay(dateStr: string): string {
  const { month, day } = parseDateOnly(dateStr);
  const date = new Date(new Date().getFullYear(), month, day);
  return formatMonthDay(date);
}

/** Calculate the age the person will be turning at their next birthday */
function calculateTurningAge(birthdayStr: string): number {
  const { year: birthYear, month: birthMonth, day: birthDay } =
    parseDateOnly(birthdayStr);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();

  // Has the birthday already passed this year?
  const birthdayThisYear = new Date(thisYear, birthMonth, birthDay);
  birthdayThisYear.setHours(0, 0, 0, 0);

  if (birthdayThisYear < today) {
    // Next birthday is next year
    return thisYear + 1 - birthYear;
  }
  // Next birthday is this year (including today)
  return thisYear - birthYear;
}

function getCountdownText(daysAway: number): { big: string; small: string } {
  if (daysAway === 0) return { big: "Today!", small: "" };
  if (daysAway === 1) return { big: "1", small: "day" };
  return { big: String(daysAway), small: "days" };
}

function getSectionIcon(section: HolidayCardSection): string {
  if (section.type === "romantic") return "heart-outline";
  if (section.type === "adventurous") return "compass-outline";
  if (section.type === "friendly") return "people-outline";
  if (section.categorySlug) return getCategoryIcon(section.categorySlug);
  return "sparkles-outline";
}

function getSectionColor(section: HolidayCardSection): string {
  if (section.type === "romantic") return "#EC4899";
  if (section.type === "adventurous") return "#F59E0B";
  if (section.type === "friendly") return "#3B82F6";
  if (section.categorySlug) return getCategoryColor(section.categorySlug);
  return "#6B7280";
}

// ── Card Components ─────────────────────────────────────────────────────────

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
    cardType: "single" | "curated";
    experienceType: string | null;
    stops: number;
    estimatedDurationMinutes: number | null;
  };
}) {
  const isCurated = card.cardType === "curated";
  const color = isCurated
    ? card.experienceType === "romantic"
      ? "#EC4899"
      : card.experienceType === "adventurous"
      ? "#F59E0B"
      : card.experienceType === "friendly"
      ? "#3B82F6"
      : "#6B7280"
    : getCategoryColor(card.category);
  const icon = isCurated
    ? card.experienceType === "romantic"
      ? "heart-outline"
      : card.experienceType === "adventurous"
      ? "compass-outline"
      : "people-outline"
    : getCategoryIcon(card.category);

  return (
    <View style={styles.personalizedCard}>
      <View style={[styles.personalizedCardAccent, { backgroundColor: color }]} />
      <View style={styles.personalizedCardContent}>
        <View style={styles.personalizedCardHeader}>
          <Ionicons name={icon as any} size={s(16)} color={color} />
          <Text style={styles.personalizedCardCategory} numberOfLines={1}>
            {isCurated
              ? (card.experienceType
                  ? card.experienceType.charAt(0).toUpperCase() + card.experienceType.slice(1)
                  : "Curated")
              : card.category}
          </Text>
        </View>
        {isCurated && card.stops > 0 && (
          <Text style={styles.personalizedCardStops}>
            {card.stops} stop{card.stops !== 1 ? "s" : ""}
            {card.estimatedDurationMinutes
              ? ` · ${card.estimatedDurationMinutes}min`
              : ""}
          </Text>
        )}
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
        {card.rating != null && (
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

// ── Card Row (6 cards + shuffle) ────────────────────────────────────────────

function CardRow({
  pairedUserId,
  holidayKey,
  sections,
  location,
  onShuffleCategories,
}: {
  pairedUserId: string;
  holidayKey: string;
  sections: HolidayCardSection[];
  location: { latitude: number; longitude: number };
  /** Optional callback to re-generate AI categories on shuffle (for holiday sections) */
  onShuffleCategories?: () => Promise<void>;
}) {
  const { data, isLoading } = usePairedCards({
    pairedUserId,
    holidayKey,
    location,
    sections,
  });

  const shufflePairedCards = useShufflePairedCards();

  const handleShuffle = useCallback(async () => {
    // Fetch new cards first — edge function handles category selection
    // server-side in shuffle mode, so current sections are fine
    await shufflePairedCards(pairedUserId, holidayKey, sections, location);
    // Then re-generate AI categories for the next render's labels
    if (onShuffleCategories) {
      onShuffleCategories();
    }
  }, [shufflePairedCards, pairedUserId, holidayKey, sections, location, onShuffleCategories]);

  const cards = data?.cards ?? [];

  if (isLoading) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color="#eb7825" />
        <Text style={styles.loadingText}>Loading recommendations...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.cardsScrollContent}
    >
      {cards.length > 0
        ? cards.map((card) => <PersonalizedCard key={card.id} card={card} />)
        : sections.map((section, idx) => (
            <PlaceholderCard key={`ph-${idx}`} section={section} />
          ))}
      <ShuffleButton onShuffle={handleShuffle} />
    </ScrollView>
  );
}

// ── Holiday Section Component ──────────────────────────────────────────────

function HolidaySectionView({
  holiday,
  daysAway,
  date,
  pairedUserId,
  pairingId,
  firstName,
  location,
}: {
  holiday: HolidayDefinition;
  daysAway: number;
  date: Date;
  pairedUserId: string;
  pairingId: string;
  firstName: string;
  location: { latitude: number; longitude: number };
}) {
  const { sections: aiSections, invalidate: invalidateCategories } =
    useHolidayCategories(holiday.id, holiday.name);

  const countdown = getCountdownText(daysAway);

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
          <Text style={styles.holidaySectionDaysNumber}>{countdown.big}</Text>
          {countdown.small !== "" && (
            <Text style={styles.holidaySectionDaysLabel}>
              {countdown.small}
            </Text>
          )}
        </View>
      </View>

      {/* Calendar button */}
      <View style={styles.holidayCalendarRow}>
        <CalendarButton
          holidayKey={holiday.id}
          pairingId={pairingId}
          eventTitle={holiday.name}
          nextOccurrence={date}
          notes={`Reminder from Mingla — ${firstName}'s ${holiday.name}`}
          personName={firstName}
          occasionLabel={holiday.name}
        />
      </View>

      {/* Cards scroll */}
      <CardRow
        pairedUserId={pairedUserId}
        holidayKey={holiday.id}
        sections={aiSections}
        location={location}
        onShuffleCategories={invalidateCategories}
      />
    </View>
  );
}

// ── Custom Holiday Section ──────────────────────────────────────────────────

function CustomHolidaySectionView({
  holiday,
  pairedUserId,
  pairingId,
  firstName,
  location,
}: {
  holiday: { id: string; name: string; month: number; day: number; year: number };
  pairedUserId: string;
  pairingId: string;
  firstName: string;
  location: { latitude: number; longitude: number };
}) {
  const daysAway = getDaysUntil(holiday.month - 1, holiday.day);
  const nextDate = getNextOccurrenceDate(holiday.month - 1, holiday.day);
  const countdown = getCountdownText(daysAway);

  const { sections: aiSections, invalidate: invalidateCategories } =
    useHolidayCategories(`custom_${holiday.id}`, holiday.name);

  // Commemoration year calculation
  const thisYear = new Date().getFullYear();
  const yearsElapsed = thisYear - holiday.year;
  const commemorationText =
    yearsElapsed <= 0
      ? "First year"
      : `${ordinal(yearsElapsed)} year`;

  return (
    <View style={styles.holidaySection}>
      {/* Custom holiday hero */}
      <View style={styles.birthdayHeroCard}>
        <View style={styles.birthdayHeroContent}>
          <View style={styles.birthdayHeroLeft}>
            <Text style={styles.birthdayHeroTitle}>{holiday.name}</Text>
            <Text style={styles.birthdayHeroSubtitle}>
              {formatMonthDay(new Date(thisYear, holiday.month - 1, holiday.day))}
            </Text>
            <Text style={styles.birthdayHeroAge}>{commemorationText}</Text>
          </View>
          <View style={styles.birthdayHeroDays}>
            <Text style={styles.birthdayHeroDaysNumber}>{countdown.big}</Text>
            {countdown.small !== "" && (
              <Text style={styles.birthdayHeroDaysText}>{countdown.small}</Text>
            )}
          </View>
        </View>
        <CalendarButton
          holidayKey={`custom_${holiday.id}`}
          pairingId={pairingId}
          eventTitle={holiday.name}
          nextOccurrence={nextDate}
          notes={`Reminder from Mingla — ${holiday.name}`}
          personName={firstName}
          occasionLabel={holiday.name}
        />
      </View>

      {/* Cards */}
      <CardRow
        pairedUserId={pairedUserId}
        holidayKey={`custom_${holiday.id}`}
        sections={aiSections}
        location={location}
        onShuffleCategories={invalidateCategories}
      />
    </View>
  );
}

// ── Birthday Section Component ─────────────────────────────────────────────

function BirthdaySection({
  birthday,
  displayName,
  pairedUserId,
  pairingId,
  location,
}: {
  birthday: string | null;
  displayName: string;
  pairedUserId: string;
  pairingId: string;
  location: { latitude: number; longitude: number };
}) {
  if (!birthday) return null;

  const firstName = getFirstName(displayName);
  const { month: bdMonth, day: bdDay } = parseDateOnly(birthday);
  const daysAway = getDaysUntil(bdMonth, bdDay);
  const turningAge = calculateTurningAge(birthday);
  const countdown = getCountdownText(daysAway);
  const nextBirthdayDate = getNextOccurrenceDate(bdMonth, bdDay);

  return (
    <View style={styles.birthdaySection}>
      {/* Birthday hero card */}
      <View style={styles.birthdayHeroCard}>
        <View style={styles.birthdayHeroContent}>
          <View style={styles.birthdayHeroLeft}>
            <Text style={styles.birthdayHeroTitle}>{firstName}</Text>
            <Text style={styles.birthdayHeroSubtitle}>
              Birthday · {formatBirthdayMonthDay(birthday)}
            </Text>
            <Text style={styles.birthdayHeroAge}>Turning {turningAge}</Text>
          </View>
          <View style={styles.birthdayHeroDays}>
            <Text style={styles.birthdayHeroDaysNumber}>{countdown.big}</Text>
            {countdown.small !== "" && (
              <Text style={styles.birthdayHeroDaysText}>
                {countdown.small}
              </Text>
            )}
          </View>
        </View>
        <CalendarButton
          holidayKey="birthday"
          pairingId={pairingId}
          eventTitle={`${firstName}'s Birthday`}
          nextOccurrence={nextBirthdayDate}
          notes={`Reminder from Mingla — ${firstName}'s Birthday`}
          personName={firstName}
          occasionLabel="Birthday"
        />
      </View>

      {/* Birthday cards — 6 default cards + shuffle */}
      <CardRow
        pairedUserId={pairedUserId}
        holidayKey="birthday"
        sections={DEFAULT_PERSON_SECTIONS}
        location={location}
      />
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
  customHolidays,
}: PersonHolidayViewProps) {
  const firstName = getFirstName(displayName);

  // Filter and sort standard holidays
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
        pairingId={pairingId}
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
              pairingId={pairingId}
              firstName={firstName}
              location={location}
            />
          ))}
        </View>
      )}

      {/* Custom holidays */}
      {customHolidays && customHolidays.length > 0 && (
        <View style={styles.holidaysContainer}>
          <Text style={styles.holidaysTitle}>Your Special Days</Text>
          {customHolidays.map((ch) => (
            <CustomHolidaySectionView
              key={ch.id}
              holiday={ch}
              pairedUserId={pairedUserId}
              pairingId={pairingId}
              firstName={firstName}
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
    marginBottom: s(2),
  },
  birthdayHeroAge: {
    fontSize: s(15),
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.95)",
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
  holidayCalendarRow: {
    paddingHorizontal: s(16),
    paddingBottom: s(8),
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
  personalizedCardStops: {
    fontSize: s(10),
    fontWeight: "500",
    color: "#9ca3af",
    marginBottom: s(4),
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
