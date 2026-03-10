import React, { useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { SavedPerson } from "../services/savedPeopleService";
import {
  GenderOption,
  HolidayDefinition,
} from "../types/holidayTypes";
import { STANDARD_HOLIDAYS } from "../constants/holidays";
import { s } from "../utils/responsive";
import BirthdayHero from "./BirthdayHero";
import PersonRecommendationCards from "./PersonRecommendationCards";
import HolidayRow from "./HolidayRow";
import CustomHolidayModal from "./CustomHolidayModal";
import { useAiSummary } from "../hooks/useAiSummary";
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

function getCustomHolidayDaysAway(month: number, day: number): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const thisYear = today.getFullYear();
  // month is 1-based in custom holidays, Date uses 0-based
  let next = new Date(thisYear, month - 1, day);
  next.setHours(0, 0, 0, 0);
  if (next < today) {
    next = new Date(thisYear + 1, month - 1, day);
    next.setHours(0, 0, 0, 0);
  }
  return Math.ceil((next.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// ── Main Component ────────────────────────────────────────────────────────

export default function PersonHolidayView({
  person,
  location,
  userId,
}: PersonHolidayViewProps) {
  // ── State ──
  const [expandedHolidayId, setExpandedHolidayId] = useState<string | null>(null);
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false);
  const [isCustomModalVisible, setIsCustomModalVisible] = useState(false);

  // ── Hooks ──
  const aiSummaryParams = useMemo(() => ({
    personId: person.id,
    personName: person.name,
    gender: person.gender,
    description: person.description,
    linkedUserId: person.linked_user_id ?? undefined,
  }), [person.id, person.name, person.gender, person.description, person.linked_user_id]);

  const { data: aiSummary, isLoading: isLoadingSummary } = useAiSummary(aiSummaryParams);

  const { data: customHolidays = [] } = useCustomHolidays(userId, person.id);
  const { data: archivedHolidays = [] } = useArchivedHolidays(userId, person.id);
  const createCustomHolidayMutation = useCreateCustomHoliday();
  const archiveHolidayMutation = useArchiveHoliday(userId, person.id);
  const unarchiveHolidayMutation = useUnarchiveHoliday(userId, person.id);

  const archivedKeys = useMemo(
    () => new Set(archivedHolidays.map((a) => a.holiday_key)),
    [archivedHolidays]
  );

  // ── Sorted standard holidays ──
  const allHolidays = useMemo(() => {
    const filtered = filterHolidaysByGender(STANDARD_HOLIDAYS, person.gender);
    const standardItems = filtered.map((holiday) => {
      const { date, daysAway } = getNextOccurrence(holiday.getDate);
      const categorySlugs = holiday.sections
        .map((sec) => sec.categorySlug || sec.type)
        .filter(Boolean);
      return {
        id: holiday.id,
        name: holiday.name,
        date,
        daysAway,
        icon: getHolidayIcon(holiday.id),
        categorySlugs,
        isCustom: false,
      };
    });

    const customItems = customHolidays.map((ch) => ({
      id: ch.id,
      name: ch.name,
      date: new Date(new Date().getFullYear(), ch.month - 1, ch.day),
      daysAway: getCustomHolidayDaysAway(ch.month, ch.day),
      icon: "star-outline" as string,
      categorySlugs: ch.categories,
      isCustom: true,
    }));

    return [...standardItems, ...customItems].sort((a, b) => a.daysAway - b.daysAway);
  }, [person.gender, customHolidays]);

  const activeHolidays = useMemo(
    () => allHolidays.filter((h) => !archivedKeys.has(h.id)),
    [allHolidays, archivedKeys]
  );

  const archivedHolidayItems = useMemo(
    () => allHolidays.filter((h) => archivedKeys.has(h.id)),
    [allHolidays, archivedKeys]
  );

  // ── Handlers ──
  const handleToggleHoliday = useCallback((holidayId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpandedHolidayId((prev) => (prev === holidayId ? null : holidayId));
  }, []);

  const handleArchive = useCallback((holidayKey: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    archiveHolidayMutation.mutate(holidayKey);
    if (expandedHolidayId === holidayKey) setExpandedHolidayId(null);
  }, [archiveHolidayMutation, expandedHolidayId]);

  const handleUnarchive = useCallback((archivedId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    unarchiveHolidayMutation.mutate(archivedId);
  }, [unarchiveHolidayMutation]);

  const handleSaveCustomHoliday = useCallback(
    (holiday: { name: string; month: number; day: number; description: string | null; categories: string[] }) => {
      createCustomHolidayMutation.mutate({
        user_id: userId,
        person_id: person.id,
        name: holiday.name,
        month: holiday.month,
        day: holiday.day,
        description: holiday.description,
        categories: holiday.categories,
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
      {/* Birthday Hero Card */}
      <BirthdayHero
        person={person}
        aiSummary={aiSummary ?? null}
        isLoadingSummary={isLoadingSummary}
      />

      {/* Person Recommendation Cards */}
      <PersonRecommendationCards person={person} location={location} />

      {/* Upcoming Holidays Section */}
      <View style={styles.holidaysContainer}>
        <View style={styles.holidaysHeader}>
          <Text style={styles.holidaysTitle}>Upcoming Holidays</Text>
          <TouchableOpacity
            style={styles.addHolidayButton}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setIsCustomModalVisible(true);
            }}
            accessibilityLabel="Add custom holiday"
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
              <Text style={styles.emptyHolidaysCta}>Add a special day</Text>
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
              linkedUserId={person.linked_user_id ?? undefined}
              location={location}
              onToggle={() => handleToggleHoliday(holiday.id)}
              onArchive={() => handleArchive(holiday.id)}
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
});
