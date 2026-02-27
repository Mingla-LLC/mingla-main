import React, { memo } from "react";
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
export const ExperienceTypesSection = memo(
  ({
    experienceTypes,
    selectedIntents,
    onIntentToggle,
  }: {
    experienceTypes: any[];
    selectedIntents: string[];
    onIntentToggle: (id: string) => void;
  }) => (
    <View style={[styles.section, { marginTop: 20 }]}>
      <Text style={styles.sectionTitle}>Experience Type</Text>
      <Text style={styles.sectionSubtitle}>
        Date Idea / Friends / Romantic / Solo Adventure
      </Text>
      <View style={styles.experienceTypesContainer}>
        {experienceTypes.map((type) => {
          const isSelected = selectedIntents.includes(type.id);
          return (
            <TouchableOpacity
              key={type.id}
              onPress={() => onIntentToggle(type.id)}
              style={[
                styles.experienceTypeButton,
                isSelected && styles.experienceTypeButtonSelected,
              ]}
            >
              <Ionicons
                name={type.icon as any}
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
    </View>
  ),
  (prev, next) =>
    prev.selectedIntents.length === next.selectedIntents.length &&
    prev.selectedIntents.every((id: string) =>
      next.selectedIntents.includes(id)
    )
);

ExperienceTypesSection.displayName = "ExperienceTypesSection";

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
  }) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Categories</Text>
      <View style={styles.categoriesContainer}>
        {filteredCategories.map((category) => {
          const isSelected = selectedCategories.includes(category.id);
          return (
            <TouchableOpacity
              key={category.id}
              onPress={() => onCategoryToggle(category.id)}
              style={[
                styles.categoryButton,
                isSelected && styles.categoryButtonSelected,
              ]}
            >
              <Ionicons
                name={category.icon as any}
                size={16}
                color={isSelected ? "#eb7825" : "#6b7280"}
              />
              <Text
                style={[
                  styles.categoryText,
                  isSelected && styles.categoryTextSelected,
                ]}
              >
                {category.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  ),
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
      <Text style={styles.sectionTitle}>Date & Time</Text>
      <Text style={styles.sectionQuestion}>When do you want to go?</Text>
      <View style={styles.dateOptionsGrid}>
        {dateOptions.map((option: any) => {
          const isSelected = selectedDateOption === option.id;
          return (
            <TouchableOpacity
              key={option.id}
              onPress={() => onDateOptionSelect(option.id)}
              style={[
                styles.dateOptionCard,
                isSelected && styles.dateOptionCardSelected,
              ]}
            >
              <View style={styles.dateOptionContent}>
                <Text
                  style={[
                    styles.dateOptionLabel,
                    isSelected && styles.dateOptionLabelSelected,
                  ]}
                >
                  {option.label}
                </Text>
                <Text
                  style={[
                    styles.dateOptionDescription,
                    isSelected && styles.dateOptionDescriptionSelected,
                  ]}
                >
                  {option.description}
                </Text>
              </View>
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
              Includes Friday, Saturday & Sunday
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
          <Text style={styles.exactTimeLabel}>Select Time</Text>
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
      <Text style={styles.sectionTitle}>Travel Mode</Text>
      <Text style={styles.sectionQuestion}>How will you get there?</Text>
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
                size={20}
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
    <Text style={styles.loadingText}>Loading preferences...</Text>
  </View>
));

LoadingShimmer.displayName = "LoadingShimmer";

const styles = StyleSheet.create({
  section: {
    backgroundColor: "white",
    marginHorizontal: 12,
    marginBottom: 12,
    padding: 12,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 5,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 3,
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
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "white",
  },
  experienceTypeButtonSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  experienceTypeText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
  },
  experienceTypeTextSelected: {
    color: "#ffffff",
  },
  categoriesContainer: {
    flexDirection: "column",
    gap: 8,
  },
  categoryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "white",
    minWidth: "47%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  categoryButtonSelected: {
    backgroundColor: "#fef3e2",
    shadowColor: "#eb7825",
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  categoryText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
    flex: 1,
  },
  categoryTextSelected: {
    color: "#eb7825",
  },
  dateOptionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 12,
  },
  dateOptionCard: {
    width: "47.5%",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    backgroundColor: "#f9fafb",
    borderColor: "#e5e7eb",
    minHeight: 60,
    justifyContent: "center",
  },
  dateOptionCardSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    borderWidth: 2,
  },
  dateOptionContent: {
    alignItems: "center",
  },
  dateOptionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    marginBottom: 2,
  },
  dateOptionLabelSelected: {
    color: "#ffffff",
  },
  dateOptionDescription: {
    fontSize: 11,
    color: "#6b7280",
  },
  dateOptionDescriptionSelected: {
    color: "#ffffff",
    opacity: 0.9,
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
    flexWrap: "wrap",
    gap: 10,
  },
  travelModeCard: {
    width: "47%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "white",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  travelModeCardSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  travelModeLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#111827",
  },
  travelModeLabelSelected: {
    color: "#ffffff",
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
