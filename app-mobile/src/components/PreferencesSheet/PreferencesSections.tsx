import React, { memo, useState } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';

/**
 * Memoized Experience Types Section
 * Prevents unnecessary re-renders of category buttons
 */
// Helper descriptions for curated experience types
const EXPERIENCE_TYPE_DESCRIPTION_KEYS: Record<string, string> = {
  "adventurous":   "experience_descriptions.adventurous",
  "first-date":    "experience_descriptions.first-date",
  "romantic":      "experience_descriptions.romantic",
  "group-fun":     "experience_descriptions.group-fun",
  "picnic-dates":  "experience_descriptions.picnic-dates",
  "take-a-stroll": "experience_descriptions.take-a-stroll",
};

export const ExperienceTypesSection = memo(
  ({
    experienceTypes,
    selectedIntents,
    onIntentToggle,
    minMessage,
    isCuratedLocked,
    onLockedTap,
  }: {
    experienceTypes: any[];
    selectedIntents: string[];
    onIntentToggle: (id: string) => void;
    minMessage?: boolean;
    isCuratedLocked?: boolean;
    onLockedTap?: () => void;
  }) => {
    const { t } = useTranslation(['preferences', 'common']);
    const [lastTappedIntent, setLastTappedIntent] = useState<string | null>(null);

    const handlePress = (id: string) => {
      setLastTappedIntent(id);
      onIntentToggle(id);
    };

    const helperIntent = lastTappedIntent && selectedIntents.includes(lastTappedIntent)
      ? experienceTypes.find((t: any) => t.id === lastTappedIntent)
      : null;

    return (
      <View style={[styles.section, { marginTop: 20 }]}>
        <Text style={styles.sectionTitle}>{t('preferences:experience_types.title')}</Text>
        <Text style={styles.sectionSubtitle}>
          {t('preferences:experience_types.subtitle')}
        </Text>
        {isCuratedLocked && (
          <TouchableOpacity
            onPress={onLockedTap}
            activeOpacity={0.7}
            style={styles.curatedLockedBanner}
          >
            <Icon name="lock-closed" size={14} color="#f97316" />
            <Text style={styles.curatedLockedText}>
              {t('preferences:experience_types.curated_locked')}
            </Text>
          </TouchableOpacity>
        )}
        <View style={styles.experienceTypesContainer}>
          {experienceTypes.map((type) => {
            const isSelected = selectedIntents.includes(type.id);
            return (
              <TouchableOpacity
                key={type.id}
                onPress={() => handlePress(type.id)}
                style={[
                  styles.experienceTypeButton,
                  isSelected && styles.experienceTypeButtonSelected,
                ]}
              >
                <Icon
                  name={type.icon}
                  size={14}
                  color={isSelected ? "#ffffff" : "#6b7280"}
                />
                <Text
                  style={[
                    styles.experienceTypeText,
                    isSelected && styles.experienceTypeTextSelected,
                  ]}
                >
                  {type.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {helperIntent && EXPERIENCE_TYPE_DESCRIPTION_KEYS[helperIntent.id] && (
          <View style={styles.helperTextContainer}>
            <Icon name="information-circle-outline" size={14} color="#eb7825" style={{ marginRight: 6, marginTop: 1 }} />
            <Text style={styles.helperText}>
              <Text style={styles.helperTextBold}>{helperIntent.label}:</Text>{" "}
              {t(`preferences:${EXPERIENCE_TYPE_DESCRIPTION_KEYS[helperIntent.id]}`)}
            </Text>
          </View>
        )}
        {minMessage && (
          <Text style={styles.capMessage}>{t('preferences:experience_types.min_message')}</Text>
        )}
      </View>
    );
  },
  (prev, next) =>
    prev.selectedIntents.length === next.selectedIntents.length &&
    prev.minMessage === next.minMessage &&
    prev.isCuratedLocked === next.isCuratedLocked &&
    prev.selectedIntents.every((id: string) =>
      next.selectedIntents.includes(id)
    )
);

ExperienceTypesSection.displayName = "ExperienceTypesSection";

// Keys for each category description in the preferences namespace
const CATEGORY_DESCRIPTION_KEYS: Record<string, string> = {
  nature: "category_descriptions.nature",
  first_meet: "category_descriptions.first_meet",
  picnic_park: "category_descriptions.picnic_park",
  drink: "category_descriptions.drink",
  casual_eats: "category_descriptions.casual_eats",
  fine_dining: "category_descriptions.fine_dining",
  watch: "category_descriptions.watch",
  live_performance: "category_descriptions.live_performance",
  creative_arts: "category_descriptions.creative_arts",
  play: "category_descriptions.play",
  wellness: "category_descriptions.wellness",
  flowers: "category_descriptions.flowers",
};

// IDs of categories that need wider pills due to long labels
const WIDE_CATEGORY_IDS = new Set(["live_performance", "creative_arts"]);

/**
 * Memoized Categories Section
 * Prevents unnecessary re-renders of category buttons
 */
export const CategoriesSection = memo(
  ({
    filteredCategories,
    selectedCategories,
    onCategoryToggle,
    capMessage,
    minMessage,
  }: {
    filteredCategories: any[];
    selectedCategories: string[];
    onCategoryToggle: (id: string) => void;
    capMessage?: boolean;
    minMessage?: boolean;
  }) => {
    const { t } = useTranslation(['preferences', 'common']);
    const [lastTappedCategory, setLastTappedCategory] = useState<string | null>(null);

    const handlePress = (id: string) => {
      setLastTappedCategory(id);
      onCategoryToggle(id);
    };

    // Show description for last tapped category (only if it's currently selected)
    const helperCategory = lastTappedCategory && selectedCategories.includes(lastTappedCategory)
      ? filteredCategories.find((c: any) => c.id === lastTappedCategory)
      : null;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('preferences:categories.title')}</Text>
        <View style={styles.categoriesContainer}>
          {filteredCategories.map((category) => {
            const isSelected = selectedCategories.includes(category.id);
            const isWide = WIDE_CATEGORY_IDS.has(category.id);
            return (
              <TouchableOpacity
                key={category.id}
                onPress={() => handlePress(category.id)}
                style={[
                  styles.categoryButton,
                  isWide && styles.categoryButtonWide,
                  isSelected && styles.categoryButtonSelected,
                ]}
              >
                <Icon
                  name={isSelected ? (category.icon as string).replace('-outline', '') : category.icon}
                  size={14}
                  color={isSelected ? "#ffffff" : "#6b7280"}
                />
                <Text
                  style={[
                    styles.categoryText,
                    isSelected && styles.categoryTextSelected,
                  ]}
                  numberOfLines={1}
                >
                  {category.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {helperCategory && CATEGORY_DESCRIPTION_KEYS[helperCategory.id] && (
          <View style={styles.helperTextContainer}>
            <Icon name="information-circle-outline" size={14} color="#eb7825" style={{ marginRight: 6, marginTop: 1 }} />
            <Text style={styles.helperText}>
              <Text style={styles.helperTextBold}>{helperCategory.label}:</Text>{" "}
              {t(`preferences:${CATEGORY_DESCRIPTION_KEYS[helperCategory.id]}`)}
            </Text>
          </View>
        )}
        {capMessage && (
          <Text style={styles.capMessage}>{t('preferences:categories.cap_message')}</Text>
        )}
        {minMessage && (
          <Text style={styles.capMessage}>{t('preferences:categories.min_message')}</Text>
        )}
      </View>
    );
  },
  (prev, next) =>
    prev.filteredCategories.length === next.filteredCategories.length &&
    prev.selectedCategories.length === next.selectedCategories.length &&
    prev.capMessage === next.capMessage &&
    prev.minMessage === next.minMessage &&
    prev.selectedCategories.every((id: string) =>
      next.selectedCategories.includes(id)
    )
);

CategoriesSection.displayName = "CategoriesSection";

/**
 * Memoized Date & Time Section
 */
// Time slots — defined here for rendering in DateTimeSection
const TIME_SLOT_KEYS = [
  { id: "brunch", labelKey: "time_slots.brunch", timeKey: "time_slots.brunch_time", icon: "cafe-outline" },
  { id: "afternoon", labelKey: "time_slots.afternoon", timeKey: "time_slots.afternoon_time", icon: "sunny-outline" },
  { id: "dinner", labelKey: "time_slots.dinner", timeKey: "time_slots.dinner_time", icon: "restaurant-outline" },
  { id: "lateNight", labelKey: "time_slots.late_night", timeKey: "time_slots.late_night_time", icon: "moon-outline" },
  { id: "anytime", labelKey: "time_slots.anytime", timeKey: "time_slots.anytime_time", icon: "time-outline" },
];

export const DateTimeSection = memo(
  ({
    dateOptions,
    selectedDateOption,
    onDateOptionSelect,
    showWeekendInfo,
    showCalendarInput,
    selectedDate,
    onShowCalendar,
    showTimeSection,
    selectedTimeSlot,
    onTimeSlotSelect,
    formatDateForDisplay,
  }: any) => {
    const { t } = useTranslation(['preferences', 'common']);
    return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('preferences:datetime.title')}</Text>
      <Text style={styles.sectionQuestion}>{t('preferences:datetime.question')}</Text>
      <View style={styles.dateOptionsGrid}>
        {dateOptions.map((option: any) => {
          const isSelected = selectedDateOption === option.id;
          return (
            <TouchableOpacity
              key={option.id}
              onPress={() => onDateOptionSelect(option.id)}
              style={[
                styles.dateOptionPill,
                isSelected && styles.dateOptionPillSelected,
              ]}
            >
              <Text
                style={[
                  styles.dateOptionPillLabel,
                  isSelected && styles.dateOptionPillLabelSelected,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {showWeekendInfo && (
        <TouchableOpacity style={styles.weekendInfoCard}>
          <Icon
            name="calendar"
            size={20}
            color="#0369a1"
            style={styles.weekendInfoIcon}
          />
          <View style={styles.weekendInfoContent}>
            <Text style={styles.weekendInfoLabel}>{t('preferences:datetime.this_weekend')}</Text>
            <Text style={styles.weekendInfoDescription}>
              {t('preferences:datetime.friday_through_sunday')}
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {showCalendarInput && (
        <TouchableOpacity
          style={styles.dateInputField}
          onPress={onShowCalendar}
        >
          <Icon name="calendar" size={16} color="#eb7825" />
          {selectedDate ? (
            <Text style={styles.dateInputText}>
              {formatDateForDisplay(selectedDate)}
            </Text>
          ) : (
            <Text style={styles.dateInputPlaceholder}>{t('preferences:datetime.date_placeholder')}</Text>
          )}
        </TouchableOpacity>
      )}

      {showTimeSection && (
        <View style={styles.timeSlotSection}>
          <Text style={styles.timeSlotLabel}>{t('preferences:datetime.time_label')}</Text>
          <View style={styles.timeSlotsGrid}>
            {TIME_SLOT_KEYS.map((slot) => {
              const isSelected = selectedTimeSlot === slot.id;
              return (
                <TouchableOpacity
                  key={slot.id}
                  onPress={() => onTimeSlotSelect(slot.id)}
                  style={[
                    styles.timeSlotPill,
                    isSelected && styles.timeSlotPillSelected,
                  ]}
                >
                  <Icon
                    name={slot.icon}
                    size={14}
                    color={isSelected ? "#ffffff" : "#6b7280"}
                  />
                  <Text
                    style={[
                      styles.timeSlotPillLabel,
                      isSelected && styles.timeSlotPillLabelSelected,
                    ]}
                  >
                    {t(`preferences:${slot.labelKey}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
    );
  }
);

DateTimeSection.displayName = "DateTimeSection";

/**
 * Memoized Travel Mode Section
 */
export const TravelModeSection = memo(
  ({
    travelModes,
    travelMode,
    onTravelModeChange,
  }: {
    travelModes: any[];
    travelMode: string;
    onTravelModeChange: (mode: string) => void;
  }) => {
    const { t } = useTranslation(['preferences', 'common']);
    return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('preferences:travel_mode.title')}</Text>
      <Text style={styles.sectionQuestion}>{t('preferences:travel_mode.question')}</Text>
      <View style={styles.travelModesGrid}>
        {travelModes.map((mode) => {
          const isSelected = travelMode === mode.id;
          return (
            <TouchableOpacity
              key={mode.id}
              onPress={() => onTravelModeChange(mode.id)}
              style={[
                styles.travelModeCard,
                isSelected && styles.travelModeCardSelected,
              ]}
            >
              <Icon
                name={mode.icon}
                size={14}
                color={isSelected ? "#ffffff" : "#6b7280"}
              />
              <Text
                style={[
                  styles.travelModeLabel,
                  isSelected && styles.travelModeLabelSelected,
                ]}
              >
                {mode.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
    );
  },
  (prev, next) => prev.travelMode === next.travelMode
);

TravelModeSection.displayName = "TravelModeSection";

/**
 * Memoized Loading Indicator
 */
export const LoadingShimmer = memo(() => {
  const { t } = useTranslation(['preferences', 'common']);
  return (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#eb7825" />
    <Text style={styles.loadingText}>{t('preferences:loading.text')}</Text>
  </View>
  );
});

LoadingShimmer.displayName = "LoadingShimmer";

const styles = StyleSheet.create({
  section: {
    backgroundColor: "#ffffff",
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 16,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#f0ebe6",
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 10,
  },
  sectionQuestion: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 10,
  },
  curatedLockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fed7aa',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  curatedLockedText: {
    flex: 1,
    fontSize: 12,
    color: '#c2410c',
    fontWeight: '500',
  },
  experienceTypesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  experienceTypeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fafafa",
  },
  experienceTypeButtonSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    borderWidth: 1.5,
  },
  experienceTypeText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#374151",
  },
  experienceTypeTextSelected: {
    color: "#ffffff",
    fontWeight: "600",
  },
  categoriesContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "#fafafa",
  },
  categoryButtonSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  categoryText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#374151",
  },
  categoryTextSelected: {
    color: "#ffffff",
    fontWeight: "700",
  },
  categoryButtonWide: {
    // Natural flex wrap — no fixed width needed
  },
  helperTextContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#fff7ed",
    borderLeftWidth: 3,
    borderLeftColor: "#eb7825",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  helperText: {
    fontSize: 12,
    color: "#92400e",
    flex: 1,
    lineHeight: 17,
  },
  helperTextBold: {
    fontWeight: "700",
    color: "#eb7825",
  },
  capMessage: {
    color: "#dc2626",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    overflow: "hidden",
  },
  dateOptionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  dateOptionPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fafafa",
  },
  dateOptionPillSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    borderWidth: 1.5,
  },
  dateOptionPillLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: "#374151",
  },
  dateOptionPillLabelSelected: {
    color: "#ffffff",
    fontWeight: "600",
  },
  weekendInfoCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    backgroundColor: "#e0f2fe",
    marginTop: 8,
    borderWidth: 0,
  },
  weekendInfoIcon: {
    marginRight: 12,
  },
  weekendInfoContent: {
    flex: 1,
  },
  weekendInfoLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0369a1",
    marginBottom: 2,
  },
  weekendInfoDescription: {
    fontSize: 12,
    color: "#0c4a6e",
    opacity: 0.9,
  },
  dateInputField: {
    width: "100%",
    padding: 12,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#eb7825",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  dateInputText: {
    fontSize: 14,
    color: "#111827",
    marginLeft: 8,
    flex: 1,
  },
  dateInputPlaceholder: {
    fontSize: 14,
    color: "#9ca3af",
    marginLeft: 8,
    flex: 1,
  },
  timeSlotSection: {
    marginTop: 12,
  },
  timeSlotLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 8,
  },
  timeSlotsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  timeSlotPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fafafa",
  },
  timeSlotPillSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    borderWidth: 1.5,
  },
  timeSlotPillLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: "#374151",
  },
  timeSlotPillLabelSelected: {
    color: "#ffffff",
    fontWeight: "600",
  },
  travelModesGrid: {
    flexDirection: "row",
    gap: 6,
  },
  travelModeCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fafafa",
  },
  travelModeCardSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    borderWidth: 1.5,
  },
  travelModeLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
  },
  travelModeLabelSelected: {
    color: "#ffffff",
    fontWeight: "600",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#ffffff",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#6b7280",
    fontWeight: "500",
  },
});
