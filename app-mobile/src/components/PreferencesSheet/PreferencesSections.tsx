import React, { memo, useState } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * Memoized Experience Types Section
 * Prevents unnecessary re-renders of category buttons
 */
// Helper descriptions for curated experience types
const EXPERIENCE_TYPE_DESCRIPTIONS: Record<string, string> = {
  "adventurous":   "Something unexpected \u2014 for the ones who don\u2019t play it safe",
  "first-date":    "Easy, low-key spots where conversation flows naturally",
  "romantic":      "Intimate moments that actually feel special",
  "friendly":      "Good times with your people \u2014 no agenda required",
  "group-fun":     "The more the merrier \u2014 activities the whole crew will love",
  "picnic-dates":  "We\u2019ll curate the spread \u2014 you just show up and enjoy",
  "take-a-stroll": "A scenic route with a great bite at each end",
};

export const ExperienceTypesSection = memo(
  ({
    experienceTypes,
    selectedIntents,
    onIntentToggle,
  }: {
    experienceTypes: any[];
    selectedIntents: string[];
    onIntentToggle: (id: string) => void;
  }) => {
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
        <Text style={styles.sectionTitle}>Set the Mood</Text>
        <Text style={styles.sectionSubtitle}>
          What kind of outing are you feeling?
        </Text>
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
                <Ionicons
                  name={type.icon as any}
                  size={14}
                  color={isSelected ? "#eb7825" : "#6b7280"}
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
        {helperIntent && EXPERIENCE_TYPE_DESCRIPTIONS[helperIntent.id] && (
          <View style={styles.helperTextContainer}>
            <Ionicons name="information-circle-outline" size={14} color="#eb7825" style={{ marginRight: 6, marginTop: 1 }} />
            <Text style={styles.helperText}>
              <Text style={styles.helperTextBold}>{helperIntent.label}:</Text>{" "}
              {EXPERIENCE_TYPE_DESCRIPTIONS[helperIntent.id]}
            </Text>
          </View>
        )}
      </View>
    );
  },
  (prev, next) =>
    prev.selectedIntents.length === next.selectedIntents.length &&
    prev.selectedIntents.every((id: string) =>
      next.selectedIntents.includes(id)
    )
);

ExperienceTypesSection.displayName = "ExperienceTypesSection";

// Helper descriptions for each category
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  nature: "Trails, parks, gardens \u2014 fresh air and good scenery",
  first_meet: "Relaxed spots made for first impressions",
  picnic_park: "The best nearby parks for spreading out a blanket",
  drink: "Cocktail bars, cozy caf\u00e9s, neighborhood pubs",
  casual_eats: "Street food, quick bites, and laid-back dining",
  fine_dining: "The nice places \u2014 dress up a little",
  watch: "Movies, live shows, theatre, game day",
  creative_arts: "Galleries, museums, comedy, live music",
  play: "Arcades, bowling, escape rooms \u2014 bring your competitive side",
  wellness: "Spas, saunas, and places that melt the stress away",
  groceries_flowers: "Markets, specialty shops, and everything in between",
  work_business: "Caf\u00e9s, coworking spots, and quiet places to lock in",
};

// IDs of categories that need wider pills due to long labels
const WIDE_CATEGORY_IDS = new Set(["groceries_flowers", "creative_arts", "work_business"]);

/**
 * Memoized Categories Section
 * Prevents unnecessary re-renders of category buttons
 */
export const CategoriesSection = memo(
  ({
    filteredCategories,
    selectedCategories,
    onCategoryToggle,
  }: {
    filteredCategories: any[];
    selectedCategories: string[];
    onCategoryToggle: (id: string) => void;
  }) => {
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
        <Text style={styles.sectionTitle}>What Sounds Good?</Text>
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
                <Ionicons
                  name={category.icon as any}
                  size={14}
                  color={isSelected ? "#eb7825" : "#6b7280"}
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
        {helperCategory && CATEGORY_DESCRIPTIONS[helperCategory.id] && (
          <View style={styles.helperTextContainer}>
            <Ionicons name="information-circle-outline" size={14} color="#eb7825" style={{ marginRight: 6, marginTop: 1 }} />
            <Text style={styles.helperText}>
              <Text style={styles.helperTextBold}>{helperCategory.label}:</Text>{" "}
              {CATEGORY_DESCRIPTIONS[helperCategory.id]}
            </Text>
          </View>
        )}
      </View>
    );
  },
  (prev, next) =>
    prev.filteredCategories.length === next.filteredCategories.length &&
    prev.selectedCategories.length === next.selectedCategories.length &&
    prev.selectedCategories.every((id: string) =>
      next.selectedCategories.includes(id)
    )
);

CategoriesSection.displayName = "CategoriesSection";

/**
 * Memoized Date & Time Section
 */
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
    exactTime,
    onShowTimePicker,
    formatDateForDisplay,
  }: any) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>When</Text>
      <Text style={styles.sectionQuestion}>When are you heading out?</Text>
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
          <Ionicons
            name="calendar"
            size={20}
            color="#0369a1"
            style={styles.weekendInfoIcon}
          />
          <View style={styles.weekendInfoContent}>
            <Text style={styles.weekendInfoLabel}>This Weekend</Text>
            <Text style={styles.weekendInfoDescription}>
              Friday through Sunday
            </Text>
          </View>
        </TouchableOpacity>
      )}

      {showCalendarInput && (
        <TouchableOpacity
          style={styles.dateInputField}
          onPress={onShowCalendar}
        >
          <Ionicons name="calendar" size={16} color="#eb7825" />
          {selectedDate ? (
            <Text style={styles.dateInputText}>
              {formatDateForDisplay(selectedDate)}
            </Text>
          ) : (
            <Text style={styles.dateInputPlaceholder}>mm/dd/yyyy</Text>
          )}
        </TouchableOpacity>
      )}

      {showTimeSection && (
        <View style={styles.exactTimeSection}>
          <Text style={styles.exactTimeLabel}>Around What Time?</Text>
          <TouchableOpacity
            style={styles.exactTimeInput}
            onPress={onShowTimePicker}
          >
            <Ionicons
              name="time-outline"
              size={16}
              color={exactTime ? "#eb7825" : "#9ca3af"}
            />
            {exactTime ? (
              <Text style={styles.exactTimeInputTextSelected}>{exactTime}</Text>
            ) : (
              <Text style={styles.exactTimeInputText}>HH:MM AM/PM</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
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
  }) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Getting There</Text>
      <Text style={styles.sectionQuestion}>How are you rolling?</Text>
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
              <Ionicons
                name={mode.icon as any}
                size={14}
                color={isSelected ? "#eb7825" : "#6b7280"}
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
  ),
  (prev, next) => prev.travelMode === next.travelMode
);

TravelModeSection.displayName = "TravelModeSection";

/**
 * Memoized Loading Indicator
 */
export const LoadingShimmer = memo(() => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#eb7825" />
    <Text style={styles.loadingText}>Setting the mood...</Text>
  </View>
));

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
    backgroundColor: "#fff7ed",
    borderColor: "#eb7825",
  },
  experienceTypeText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#374151",
  },
  experienceTypeTextSelected: {
    color: "#eb7825",
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
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fafafa",
  },
  categoryButtonSelected: {
    backgroundColor: "#fff7ed",
    borderColor: "#eb7825",
  },
  categoryText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#374151",
  },
  categoryTextSelected: {
    color: "#eb7825",
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
    borderColor: "#d1d5db",
    backgroundColor: "white",
  },
  dateOptionPillSelected: {
    backgroundColor: "#fff7ed",
    borderColor: "#eb7825",
  },
  dateOptionPillLabel: {
    fontSize: 11,
    fontWeight: "500",
    color: "#374151",
  },
  dateOptionPillLabelSelected: {
    color: "#eb7825",
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
  exactTimeSection: {
    marginTop: 16,
  },
  exactTimeLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 8,
  },
  exactTimeInput: {
    width: "100%",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
  },
  exactTimeInputText: {
    fontSize: 14,
    color: "#9ca3af",
    marginLeft: 8,
    flex: 1,
  },
  exactTimeInputTextSelected: {
    fontSize: 14,
    color: "#111827",
    marginLeft: 8,
    flex: 1,
    fontWeight: "500",
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
    backgroundColor: "#fff7ed",
    borderColor: "#eb7825",
  },
  travelModeLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
  },
  travelModeLabelSelected: {
    color: "#eb7825",
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
