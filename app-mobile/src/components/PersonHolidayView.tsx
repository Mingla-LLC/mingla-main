import React, { useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { SavedPerson } from "../services/savedPeopleService";
import { HolidayCard } from "../services/holidayCardsService";
import {
  GenderOption,
  HolidayDefinition,
} from "../types/holidayTypes";
import { STANDARD_HOLIDAYS, INTENT_CATEGORY_MAP } from "../constants/holidays";
import { s } from "../utils/responsive";
import { getCustomDayDaysAway } from "../utils/customDayUtils";
import BirthdayHero from "./BirthdayHero";
import CustomDayHero from "./CustomDayHero";
import HolidayRow from "./HolidayRow";
import CustomHolidayModal from "./CustomHolidayModal";
import ExpandedCardModal from "./ExpandedCardModal";
import { ExpandedCardData } from "../types/expandedCardTypes";
import { getReadableCategoryName, getCategoryIcon } from "../utils/categoryUtils";
import { useAiSummary } from "../hooks/useAiSummary";
import { useGenerateMoreCards } from "../hooks/useGenerateMoreCards";
import {
  useCustomHolidays,
  useArchivedHolidays,
  useCreateCustomHoliday,
  useArchiveHoliday,
  useUnarchiveHoliday,
} from "../hooks/useCustomHolidays";

// ── Props ─────────────────────────────────────────────────────────────────

interface PersonHolidayViewProps {
  person: SavedPerson;
  location: { latitude: number; longitude: number };
  userId: string;
}

// ── Helper functions ──────────────────────────────────────────────────────

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

function getHolidayIcon(holidayId: string): string {
  const icons: Record<string, string> = {
    new_years_day: "sparkles-outline",
    valentines_day: "heart-outline",
    intl_womens_day: "flower-outline",
    first_day_of_spring: "leaf-outline",
    mothers_day: "heart-outline",
    fathers_day: "trophy-outline",
    juneteenth: "flag-outline",
    intl_nonbinary_day: "ribbon-outline",
    independence_day: "star-outline",
    halloween: "moon-outline",
    thanksgiving: "restaurant-outline",
    christmas: "gift-outline",
    new_years_eve: "wine-outline",
  };
  return icons[holidayId] || "calendar-outline";
}

// ── Main Component ────────────────────────────────────────────────────────

const MAX_GENERATE_MORE = 5;

/** Convert a HolidayCard into ExpandedCardData for the modal */
function holidayCardToExpandedCard(card: HolidayCard): ExpandedCardData {
  const category = getReadableCategoryName(card.categorySlug || card.category);
  const categoryIcon = getCategoryIcon(category) || "compass-outline";

  const base: ExpandedCardData = {
    id: card.id,
    placeId: card.googlePlaceId || card.id,
    title: card.title,
    category,
    categoryIcon,
    description: card.description ?? "",
    fullDescription: card.description ?? "",
    image: card.imageUrl ?? "",
    images: card.imageUrl ? [card.imageUrl] : [],
    rating: card.rating ?? 0,
    reviewCount: 0,
    priceRange: card.priceTier ?? "",
    priceTier: (card.priceTier as ExpandedCardData["priceTier"]) ?? undefined,
    distance: "",
    travelTime: "",
    address: card.address ?? "",
    highlights: [],
    tags: [],
    matchScore: 0,
    matchFactors: { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    location: card.lat && card.lng ? { lat: card.lat, lng: card.lng } : undefined,
    selectedDateTime: new Date(),
    website: card.website
      ?? (card.googlePlaceId ? `https://www.google.com/maps/place/?q=place_id:${card.googlePlaceId}` : undefined),
  };

  // Curated card fields — pass through to ExpandedCardModal for CuratedPlanView
  if (card.cardType === "curated") {
    base.cardType = "curated";
    base.tagline = card.tagline ?? undefined;
    base.totalPriceMin = card.totalPriceMin ?? undefined;
    base.totalPriceMax = card.totalPriceMax ?? undefined;
    base.estimatedDurationMinutes = card.estimatedDurationMinutes ?? undefined;
    base.experienceType = card.experienceType ?? undefined;
    // stopsData is the raw JSONB array from the API; cast to CuratedStop[]
    // The ExpandedCardModal expects stops as CuratedStop[]
    if (Array.isArray(card.stopsData) && card.stopsData.length > 0) {
      base.stops = card.stopsData as unknown as import("../types/curatedExperience").CuratedStop[];
    }
    // Shopping list for picnic-type curated experiences
    if (Array.isArray(card.shoppingList)) {
      base.shoppingList = card.shoppingList as string[];
    }
  }

  return base;
}

export default function PersonHolidayView({
  person,
  location,
  userId,
}: PersonHolidayViewProps) {
  // ── State ──
  const [expandedHolidayId, setExpandedHolidayId] = useState<string | null>(null);
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false);
  const [isCustomModalVisible, setIsCustomModalVisible] = useState(false);
  const [selectedCardForExpansion, setSelectedCardForExpansion] = useState<ExpandedCardData | null>(null);
  const [isExpandedModalVisible, setIsExpandedModalVisible] = useState(false);

  // ── AI Summary ──
  const aiSummaryParams = useMemo(() => ({
    personId: person.id,
    personName: person.name,
    gender: person.gender,
    description: person.description,
    linkedUserId: undefined,
  }), [person.id, person.name, person.gender, person.description]);

  const { data: aiSummary, isLoading: isLoadingSummary } = useAiSummary(aiSummaryParams);

  // ── Generate More (kept for AI-powered deep suggestions) ──
  const [generatedCards, setGeneratedCards] = useState<HolidayCard[]>([]);
  const [generateCount, setGenerateCount] = useState(0);
  const generateMoreMutation = useGenerateMoreCards();

  const handleGenerateMore = useCallback(() => {
    if (!person.description || generateCount >= MAX_GENERATE_MORE) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    generateMoreMutation.mutate(
      {
        personId: person.id,
        description: person.description,
        location,
        linkedUserId: undefined,
        excludeCardIds: generatedCards.map((c) => c.id),
      },
      {
        onSuccess: (response) => {
          setGeneratedCards((prev) => [...prev, ...response.cards]);
          setGenerateCount((prev) => prev + 1);
        },
      }
    );
  }, [person, location, generatedCards, generateCount, generateMoreMutation]);

  const handleCardPress = useCallback((card: HolidayCard) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCardForExpansion(holidayCardToExpandedCard(card));
    setIsExpandedModalVisible(true);
  }, []);

  const handleCloseExpandedModal = useCallback(() => {
    setIsExpandedModalVisible(false);
    setSelectedCardForExpansion(null);
  }, []);

  // ── Custom Holidays ──
  const { data: customHolidays = [] } = useCustomHolidays(userId, person.id);
  const { data: archivedHolidays = [] } = useArchivedHolidays(userId, person.id);
  const createCustomHolidayMutation = useCreateCustomHoliday();
  const archiveHolidayMutation = useArchiveHoliday(userId, person.id);
  const unarchiveHolidayMutation = useUnarchiveHoliday(userId, person.id);

  const archivedKeys = useMemo(
    () => new Set(archivedHolidays.map((a) => a.holiday_key)),
    [archivedHolidays]
  );

  // ── Standard holidays only (for HolidayRows) ──
  const standardHolidays = useMemo(() => {
    const filtered = filterHolidaysByGender(STANDARD_HOLIDAYS, person.gender);
    return filtered.map((holiday) => {
      const { date, daysAway } = getNextOccurrence(holiday.getDate);
      const categorySlugs = holiday.sections
        .flatMap((sec) => {
          if (sec.categorySlug) return [sec.categorySlug];
          const mapped = INTENT_CATEGORY_MAP[sec.type];
          return mapped ?? [];
        })
        .filter(Boolean);
      return {
        id: holiday.id,
        name: holiday.name,
        date,
        daysAway,
        icon: getHolidayIcon(holiday.id),
        categorySlugs,
        isCustom: false as const,
      };
    }).sort((a, b) => a.daysAway - b.daysAway);
  }, [person.gender]);

  // ── Custom days for hero cards — sorted by days away ──
  const upcomingCustomDays = useMemo(() => {
    return customHolidays
      .map((ch) => ({
        ...ch,
        daysAway: getCustomDayDaysAway(ch.month, ch.day),
      }))
      .sort((a, b) => a.daysAway - b.daysAway);
  }, [customHolidays]);

  const activeHolidays = useMemo(
    () => standardHolidays.filter((h) => !archivedKeys.has(h.id)),
    [standardHolidays, archivedKeys]
  );

  // Archived items include both standard and custom holidays
  const archivedHolidayItems = useMemo(() => {
    const standardArchived = standardHolidays
      .filter((h) => archivedKeys.has(h.id));
    const customArchived = customHolidays
      .filter((ch) => archivedKeys.has(ch.id))
      .map((ch) => ({
        id: ch.id,
        name: ch.name,
        date: new Date(new Date().getFullYear(), ch.month - 1, ch.day),
        daysAway: getCustomDayDaysAway(ch.month, ch.day),
        icon: "star-outline" as string,
        categorySlugs: ch.categories ?? [],
        isCustom: true as const,
      }));
    return [...standardArchived, ...customArchived];
  }, [standardHolidays, customHolidays, archivedKeys]);

  // ── Handlers ──
  const handleToggleHoliday = useCallback((holidayId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedHolidayId((prev) => (prev === holidayId ? null : holidayId));
  }, []);

  const handleArchive = useCallback((holidayKey: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    archiveHolidayMutation.mutate(holidayKey, {
      onError: () => Alert.alert("Error", "Failed to archive holiday."),
    });
    if (expandedHolidayId === holidayKey) setExpandedHolidayId(null);
  }, [archiveHolidayMutation, expandedHolidayId]);

  const handleUnarchive = useCallback((archivedId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    unarchiveHolidayMutation.mutate(archivedId, {
      onError: () => Alert.alert("Error", "Failed to unarchive holiday."),
    });
  }, [unarchiveHolidayMutation]);

  const handleSaveCustomHoliday = useCallback(
    (holiday: { name: string; month: number; day: number; year: number }) => {
      createCustomHolidayMutation.mutate({
        user_id: userId,
        person_id: person.id,
        name: holiday.name,
        month: holiday.month,
        day: holiday.day,
        year: holiday.year,
        description: null,
        categories: null,
      }, {
        onError: () => Alert.alert("Error", "Failed to create holiday."),
      });
      setIsCustomModalVisible(false);
    },
    [createCustomHolidayMutation, userId, person.id]
  );

  // ── Render ──
  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Birthday Hero Card — always first */}
      <BirthdayHero
        person={person}
        personId={person.id}
        location={location}
        userId={userId}
        aiSummary={aiSummary ?? null}
        isLoadingSummary={isLoadingSummary}
        onCardPress={handleCardPress}
      />

      {/* Custom Day Hero Cards — sorted by days away, after birthday */}
      {upcomingCustomDays
        .filter((ch) => !archivedKeys.has(ch.id))
        .map((ch) => (
          <View key={ch.id} style={styles.customDayHeroWrapper}>
            <CustomDayHero
              person={person}
              personId={person.id}
              customDay={{
                id: ch.id,
                name: ch.name,
                month: ch.month,
                day: ch.day,
                year: ch.year,
              }}
              location={location}
              userId={userId}
              onCardPress={handleCardPress}
              onArchive={handleArchive}
            />
          </View>
        ))}

      {/* Generate More — AI-powered suggestions for people with descriptions */}
      {person.description && person.description.length >= 10 && (
        <TouchableOpacity
          style={styles.generateMoreRow}
          onPress={handleGenerateMore}
          activeOpacity={0.7}
          disabled={generateMoreMutation.isPending}
        >
          <Ionicons name="sparkles-outline" size={s(16)} color="#eb7825" />
          <Text style={styles.generateMoreText}>Generate more suggestions</Text>
        </TouchableOpacity>
      )}

      {/* Upcoming Holidays Section (standard holidays only) */}
      <View style={styles.holidaysContainer}>
        <View style={styles.holidaysHeader}>
          <Text style={styles.holidaysTitle}>Upcoming Holidays</Text>
          <TouchableOpacity
            style={styles.addHolidayButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setIsCustomModalVisible(true);
            }}
            accessibilityLabel={`Add a special day for ${person.name}`}
          >
            <Ionicons name="add" size={s(16)} color="#eb7825" />
          </TouchableOpacity>
        </View>

        {activeHolidays.length === 0 ? (
          <View style={styles.emptyHolidays}>
            <Text style={styles.emptyHolidaysText}>
              No upcoming holidays for {person.name}
            </Text>
            <TouchableOpacity onPress={() => setIsCustomModalVisible(true)}>
              <Text style={styles.emptyHolidaysCta}>Mark a day that matters</Text>
            </TouchableOpacity>
          </View>
        ) : (
          activeHolidays.map((holiday) => (
            <HolidayRow
              key={holiday.id}
              holiday={holiday}
              isExpanded={expandedHolidayId === holiday.id}
              isArchived={false}
              personId={person.id}
              linkedUserId={undefined}
              location={location}
              onToggle={() => handleToggleHoliday(holiday.id)}
              onArchive={() => handleArchive(holiday.id)}
              onCardPress={handleCardPress}
            />
          ))
        )}
      </View>

      {/* Archived Holidays Section */}
      {archivedHolidayItems.length > 0 && (
        <View style={styles.archivedContainer}>
          <TouchableOpacity
            style={styles.archivedToggle}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setIsArchivedExpanded(!isArchivedExpanded);
            }}
          >
            <Text style={styles.archivedToggleText}>
              Archived ({archivedHolidayItems.length})
            </Text>
            <Ionicons
              name={isArchivedExpanded ? "chevron-up-outline" : "chevron-down-outline"}
              size={s(18)}
              color="#6b7280"
            />
          </TouchableOpacity>

          {isArchivedExpanded &&
            archivedHolidayItems.map((holiday) => {
              const archivedEntry = archivedHolidays.find(
                (a) => a.holiday_key === holiday.id
              );
              return (
                <HolidayRow
                  key={holiday.id}
                  holiday={holiday}
                  isExpanded={false}
                  isArchived={true}
                  personId={person.id}
                  location={location}
                  onToggle={() => {}}
                  onArchive={() => {}}
                  onCardPress={handleCardPress}
                  onUnarchive={
                    archivedEntry
                      ? () => handleUnarchive(archivedEntry.id)
                      : undefined
                  }
                />
              );
            })}
        </View>
      )}

      {/* Custom Holiday Modal */}
      <CustomHolidayModal
        visible={isCustomModalVisible}
        onClose={() => setIsCustomModalVisible(false)}
        onSave={handleSaveCustomHoliday}
      />

      {/* Expanded Card Modal */}
      <ExpandedCardModal
        visible={isExpandedModalVisible}
        card={selectedCardForExpansion}
        onClose={handleCloseExpandedModal}
        onSave={async () => {}}
        isSaved={true}
        currentMode="solo"
        hideTravelTime
      />
    </ScrollView>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: s(80),
  },
  customDayHeroWrapper: {
    marginTop: s(16),
  },
  // Holidays
  holidaysContainer: {
    marginTop: s(32),
  },
  holidaysHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: s(16),
    marginBottom: s(12),
  },
  holidaysTitle: {
    fontSize: s(18),
    fontWeight: "700",
    color: "#111827",
    lineHeight: s(28),
  },
  addHolidayButton: {
    width: s(28),
    height: s(28),
    borderRadius: s(14),
    backgroundColor: "#fff7ed",
    borderWidth: 1.5,
    borderColor: "#fed7aa",
    justifyContent: "center",
    alignItems: "center",
  },
  // Empty holidays
  emptyHolidays: {
    alignItems: "center",
    paddingVertical: s(32),
  },
  emptyHolidaysText: {
    fontSize: s(14),
    color: "#6b7280",
    lineHeight: s(20),
  },
  emptyHolidaysCta: {
    fontSize: s(14),
    color: "#eb7825",
    fontWeight: "600",
    marginTop: s(8),
    lineHeight: s(20),
  },
  // Archived
  archivedContainer: {
    marginHorizontal: s(16),
    marginTop: s(24),
  },
  archivedToggle: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: s(16),
    paddingVertical: s(14),
    backgroundColor: "#f9fafb",
    borderRadius: s(12),
  },
  archivedToggleText: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#6b7280",
    lineHeight: s(20),
  },
  // Generate More
  generateMoreRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(6),
    paddingVertical: s(12),
    marginTop: s(8),
    marginHorizontal: s(16),
  },
  generateMoreText: {
    fontSize: s(14),
    fontWeight: "600",
    color: "#eb7825",
    lineHeight: s(20),
  },
});
