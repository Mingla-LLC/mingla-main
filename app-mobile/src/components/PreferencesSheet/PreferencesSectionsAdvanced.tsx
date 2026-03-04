import React, { memo, useCallback, useState } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Switch,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getCurrencySymbol, formatNumberWithCommas } from "../../utils/currency";
import { getRate } from "../../services/currencyService";

/**
 * Memoized Budget Section
 */
export const BudgetSection = memo(
  ({
    budgetMax,
    budgetPresets,
    onBudgetChange,
    onBudgetPresetClick,
    onFocus,
    accountPreferences,
    shouldHide,
  }: {
    budgetMax: number | "";
    budgetPresets: any[];
    onBudgetChange: (value: string) => void;
    onBudgetPresetClick: (max: number) => void;
    onFocus: () => void;
    accountPreferences?: any;
    shouldHide?: boolean;
  }) => {
    if (shouldHide) return null;

    const currencyCode = accountPreferences?.currency || 'USD';
    const symbol = getCurrencySymbol(currencyCode);
    const rate = getRate(currencyCode);
    const convertedPresets = budgetPresets.map((p: any) => Math.round(p.max * rate));
    const isCustomValue = typeof budgetMax === 'number' && budgetMax > 0 && !convertedPresets.includes(budgetMax);
    const [showCustom, setShowCustom] = useState(isCustomValue);
    const isPresetSelected = (max: number) => !showCustom && budgetMax === max;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Maximum Budget per Person</Text>
        <Text style={styles.sectionSubtitle}>
          What's the most you want to spend?
        </Text>
        <View style={styles.budgetPresetsContainer}>
          {budgetPresets.map((preset) => {
            const convertedMax = Math.round(preset.max * rate);
            const label = `Up to ${symbol}${formatNumberWithCommas(convertedMax)}`;
            const selected = isPresetSelected(convertedMax);
            return (
              <TouchableOpacity
                key={preset.label}
                onPress={() => {
                  setShowCustom(false);
                  onBudgetPresetClick(convertedMax);
                }}
                style={[
                  styles.budgetPresetPill,
                  selected && styles.budgetPresetPillSelected,
                ]}
              >
                <Text style={[
                  styles.budgetPresetPillText,
                  selected && styles.budgetPresetPillTextSelected,
                ]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.customBudgetToggleRow}>
          <Text style={styles.customBudgetToggleLabel}>Custom amount</Text>
          <Switch
            value={showCustom}
            onValueChange={(val) => {
              setShowCustom(val);
              if (!val) onBudgetChange("");
            }}
            trackColor={{ false: "#d1d5db", true: "#fdba74" }}
            thumbColor={showCustom ? "#eb7825" : "#f4f3f4"}
          />
        </View>
        {showCustom && (
          <View style={styles.budgetInputContainer}>
            <Text style={styles.dollarSign}>
              {symbol}
            </Text>
            <TextInput
              value={budgetMax?.toString() || ""}
              onChangeText={onBudgetChange}
              onFocus={onFocus}
              keyboardType="numeric"
              style={styles.budgetInput}
              placeholder="Enter maximum amount"
              placeholderTextColor="#9ca3af"
            />
          </View>
        )}
      </View>
    );
  },
  (prev, next) =>
    prev.budgetMax === next.budgetMax &&
    prev.shouldHide === next.shouldHide &&
    prev.accountPreferences?.currency === next.accountPreferences?.currency
);

BudgetSection.displayName = "BudgetSection";

/**
 * Memoized Travel Limit Section
 */
export const TravelLimitSection = memo(
  ({
    constraintType,
    constraintValue,
    onConstraintTypeChange,
    onConstraintValueChange,
    onFocus,
    accountPreferences,
  }: {
    constraintType: "time" | "distance";
    constraintValue: number | "";
    onConstraintTypeChange: (type: "time" | "distance") => void;
    onConstraintValueChange: (value: string) => void;
    onFocus: () => void;
    accountPreferences?: any;
  }) => (
    <View style={styles.section}>
      <View style={styles.sectionHeaderWithBadge}>
        <Text style={styles.sectionTitle}>Travel Limit</Text>
        <View style={styles.requiredBadge}>
          <Text style={styles.requiredBadgeText}>Required</Text>
        </View>
      </View>
      <Text style={styles.sectionQuestion}>
        How far are you willing to travel?
      </Text>
      <View style={styles.constraintTypeContainer}>
        <TouchableOpacity
          onPress={() => onConstraintTypeChange("time")}
          style={[
            styles.constraintTypeButton,
            constraintType === "time" && styles.constraintTypeButtonSelected,
          ]}
        >
          <Ionicons
            name="time-outline"
            size={16}
            color={constraintType === "time" ? "#ffffff" : "#6b7280"}
          />
          <Text
            style={[
              styles.constraintTypeText,
              constraintType === "time" && styles.constraintTypeTextSelected,
            ]}
          >
            By Time
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => onConstraintTypeChange("distance")}
          style={[
            styles.constraintTypeButton,
            constraintType === "distance" &&
              styles.constraintTypeButtonSelected,
          ]}
        >
          <Ionicons
            name="location-outline"
            size={16}
            color={constraintType === "distance" ? "#ffffff" : "#6b7280"}
          />
          <Text
            style={[
              styles.constraintTypeText,
              constraintType === "distance" &&
                styles.constraintTypeTextSelected,
            ]}
          >
            By Distance
          </Text>
        </TouchableOpacity>
      </View>
      <View style={styles.constraintInputSection}>
        <Text style={styles.constraintInputLabel}>
          {constraintType === "time"
            ? "Maximum travel time (minutes)"
            : `Maximum travel distance (${
                accountPreferences?.measurementSystem === "Metric"
                  ? "km"
                  : "miles"
              })`}
        </Text>
        <View style={styles.constraintInputContainer}>
          <Ionicons
            name={
              constraintType === "time"
                ? "time-outline"
                : "paper-plane-outline"
            }
            size={16}
            color="#6b7280"
            style={styles.constraintInputIcon}
          />
          <TextInput
            value={constraintValue?.toString() || ""}
            onChangeText={onConstraintValueChange}
            onFocus={onFocus}
            keyboardType="numeric"
            style={styles.constraintInput}
            placeholder={
              constraintType === "time"
                ? "e.g. 20"
                : accountPreferences?.measurementSystem === "Metric"
                  ? "e.g. 5"
                  : "e.g. 3"
            }
          />
        </View>
      </View>
    </View>
  ),
  (prev, next) =>
    prev.constraintType === next.constraintType &&
    prev.constraintValue === next.constraintValue
);

TravelLimitSection.displayName = "TravelLimitSection";

/**
 * Memoized Location Input with Suggestions
 */
export const LocationInputSection = memo(
  ({
    searchLocation,
    onLocationInputChange,
    onFocus,
    onBlur,
    showSuggestions,
    suggestions,
    isLoadingSuggestions,
    onSuggestionSelect,
    isInputFocused,
    useGpsLocation,
    onToggleGps,
  }: {
    searchLocation: string;
    onLocationInputChange: (text: string) => void;
    onFocus: () => void;
    onBlur: () => void;
    showSuggestions: boolean;
    suggestions: any[];
    isLoadingSuggestions: boolean;
    onSuggestionSelect: (suggestion: any) => void;
    isInputFocused: boolean;
    useGpsLocation: boolean;
    onToggleGps: (value: boolean) => void;
  }) => (
    <View>
      <View style={styles.gpsSwitchRow}>
        <Ionicons name="locate-outline" size={16} color="#6b7280" />
        <Text style={styles.gpsSwitchLabel}>Use my current GPS location</Text>
        <Switch
          value={useGpsLocation}
          onValueChange={onToggleGps}
          trackColor={{ false: '#d1d5db', true: '#eb7825' }}
          thumbColor="#ffffff"
        />
      </View>
      <View
        style={[
          styles.locationInputContainer,
          isInputFocused && !useGpsLocation && styles.locationInputContainerFocused,
        ]}
      >
        <Ionicons
          name="location"
          size={16}
          color="#6b7280"
          style={styles.locationInputIcon}
        />
        <TextInput
          style={[
            styles.locationTextInput,
            useGpsLocation && styles.locationTextInputDisabled,
          ]}
          placeholder={
            useGpsLocation
              ? "Using your current GPS location"
              : "Search to change your starting location..."
          }
          placeholderTextColor="#9ca3af"
          value={useGpsLocation ? "" : searchLocation}
          onChangeText={useGpsLocation ? undefined : onLocationInputChange}
          onFocus={useGpsLocation ? undefined : onFocus}
          onBlur={useGpsLocation ? undefined : onBlur}
          editable={!useGpsLocation}
          autoCapitalize="words"
          returnKeyType="done"
        />
      </View>

      {/* Helper text */}
      <View style={styles.locationHelperContainer}>
        <Ionicons
          name="information-circle-outline"
          size={14}
          color="#6b7280"
        />
        <Text style={styles.locationHelperText}>
          Type to search Google Maps locations
        </Text>
      </View>

      {/* Suggestions Dropdown */}
      {showSuggestions &&
        (suggestions.length > 0 || isLoadingSuggestions) && (
          <ScrollView
            style={styles.suggestionsContainer}
            nestedScrollEnabled={true}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={true}
          >
            {isLoadingSuggestions ? (
              <View style={styles.suggestionItem}>
                <ActivityIndicator size="small" color="#eb7825" />
                <Text style={styles.suggestionText}>Searching...</Text>
              </View>
            ) : (
              suggestions.map((suggestion, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.suggestionItem}
                  onPress={() => onSuggestionSelect(suggestion)}
                  activeOpacity={0.7}
                  delayPressIn={0}
                >
                  <Ionicons
                    name="location-outline"
                    size={16}
                    color="#6b7280"
                  />
                  <View style={styles.suggestionTextContainer}>
                    <Text style={styles.suggestionText}>
                      {suggestion.displayName}
                    </Text>
                    {suggestion.fullAddress !== suggestion.displayName && (
                      <Text
                        style={styles.suggestionSubtext}
                        numberOfLines={1}
                      >
                        {suggestion.fullAddress}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        )}
    </View>
  )
);

LocationInputSection.displayName = "LocationInputSection";

const styles = StyleSheet.create({
  section: {
    backgroundColor: "white",
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#f3f4f6",
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
  sectionHeaderWithBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  requiredBadge: {
    backgroundColor: "#fee2e2",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  requiredBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#dc2626",
  },
  budgetInputContainer: {
    position: "relative",
    marginBottom: 12,
  },
  dollarSign: {
    position: "absolute",
    left: 12,
    top: 12,
    fontSize: 16,
    color: "#6b7280",
    zIndex: 1,
  },
  budgetInput: {
    paddingLeft: 28,
    paddingRight: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    fontSize: 14,
    backgroundColor: "white",
  },
  budgetPresetsContainer: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 12,
  },
  budgetPresetPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "white",
  },
  budgetPresetPillSelected: {
    backgroundColor: "#fff7ed",
    borderColor: "#eb7825",
  },
  budgetPresetPillText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#374151",
  },
  budgetPresetPillTextSelected: {
    color: "#eb7825",
    fontWeight: "600",
  },
  customBudgetToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  customBudgetToggleLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6b7280",
  },
  constraintTypeContainer: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 12,
  },
  constraintTypeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    backgroundColor: "white",
  },
  constraintTypeButtonSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
  },
  constraintTypeText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
  },
  constraintTypeTextSelected: {
    color: "#ffffff",
  },
  constraintInputSection: {
    marginBottom: 16,
  },
  constraintInputLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: "#111827",
    marginBottom: 6,
  },
  constraintInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  constraintInputIcon: {
    marginRight: 12,
  },
  constraintInput: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
    padding: 0,
  },
  gpsSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  gpsSwitchLabel: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
  },
  locationInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderWidth: 1.5,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 6,
  },
  locationInputContainerFocused: {
    borderColor: "#eb7825",
    borderWidth: 2,
  },
  locationInputIcon: {
    marginRight: 12,
  },
  locationTextInput: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
    padding: 0,
  },
  locationTextInputDisabled: {
    backgroundColor: 'transparent',
    color: '#9ca3af',
  },
  locationHelperContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  locationHelperText: {
    fontSize: 11,
    color: "#6b7280",
  },
  suggestionsContainer: {
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginTop: 4,
    marginBottom: 8,
    maxHeight: 200,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  suggestionTextContainer: {
    flex: 1,
    marginLeft: 12,
  },
  suggestionText: {
    fontSize: 13,
    color: "#111827",
    fontWeight: "500",
  },
  suggestionSubtext: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 2,
  },
});
