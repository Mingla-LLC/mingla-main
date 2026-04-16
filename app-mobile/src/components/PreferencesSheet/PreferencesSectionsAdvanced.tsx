import React, { memo, useState, useEffect } from "react";
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
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { TRAVEL_TIME_PRESETS } from "../../types/onboarding";

export const TravelLimitSection = memo(
  ({
    constraintValue,
    onConstraintValueChange,
    onFocus,
  }: {
    constraintValue: number | "";
    onConstraintValueChange: (value: string) => void;
    onFocus: () => void;
  }) => {
    const { t } = useTranslation(['preferences', 'common']);
    const numericValue = typeof constraintValue === "number" ? constraintValue : 0;
    const isPreset = (TRAVEL_TIME_PRESETS as readonly number[]).includes(numericValue);
    const [showCustom, setShowCustom] = useState(
      numericValue > 0 && !isPreset
    );

    useEffect(() => {
      const val = typeof constraintValue === "number" ? constraintValue : 0;
      const preset = (TRAVEL_TIME_PRESETS as readonly number[]).includes(val);
      if (val > 0 && !preset) {
        setShowCustom(true);
      }
    }, [constraintValue]);

    const isPresetSelected = (mins: number) => !showCustom && numericValue === mins;

    return (
      <View style={styles.section}>
        <View style={styles.travelPresetsContainer}>
          {TRAVEL_TIME_PRESETS.map((mins) => {
            const selected = isPresetSelected(mins);
            return (
              <TouchableOpacity
                key={mins}
                onPress={() => {
                  setShowCustom(false);
                  onConstraintValueChange(mins.toString());
                }}
                style={[
                  styles.travelPresetPill,
                  selected && styles.travelPresetPillSelected,
                ]}
              >
                <Text
                  style={[
                    styles.travelPresetPillText,
                    selected && styles.travelPresetPillTextSelected,
                  ]}
                >
                  {mins} {t('preferences:travel_limit.min_unit')}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.customBudgetToggleRow}>
          <Text style={styles.customBudgetToggleLabel}>{t('preferences:travel_limit.set_your_own')}</Text>
          <Switch
            value={showCustom}
            onValueChange={(val) => {
              setShowCustom(val);
              if (!val) {
                const nearest = TRAVEL_TIME_PRESETS.reduce((prev, curr) =>
                  Math.abs(curr - numericValue) < Math.abs(prev - numericValue) ? curr : prev
                );
                onConstraintValueChange(nearest.toString());
              }
            }}
            trackColor={{ false: "#d1d5db", true: "#fdba74" }}
            thumbColor={showCustom ? "#eb7825" : "#f4f3f4"}
          />
        </View>
        {showCustom && (
          <View style={styles.constraintInputContainer}>
            <Icon
              name="time-outline"
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
              placeholder={t('preferences:travel_limit.custom_placeholder')}
              placeholderTextColor="#9ca3af"
              maxLength={3}
            />
            <Text style={styles.travelInputUnit}>{t('preferences:travel_limit.min_unit')}</Text>
          </View>
        )}
      </View>
    );
  },
  (prev, next) => prev.constraintValue === next.constraintValue
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
    onClearLocation,
    isInputFocused,
    useGpsLocation,
    onToggleGps,
    isLocked,
    onLockedTap,
  }: {
    searchLocation: string;
    onLocationInputChange: (text: string) => void;
    onFocus: () => void;
    onBlur: () => void;
    showSuggestions: boolean;
    suggestions: any[];
    isLoadingSuggestions: boolean;
    onSuggestionSelect: (suggestion: any) => void;
    onClearLocation?: () => void;
    isInputFocused: boolean;
    useGpsLocation: boolean;
    onToggleGps: (value: boolean) => void;
    isLocked?: boolean;
    onLockedTap?: () => void;
  }) => {
    const { t } = useTranslation(['preferences', 'common']);
    return (
    <View>
      <View style={[styles.gpsSwitchRow, useGpsLocation && styles.gpsSwitchRowActive]}>
        <Icon
          name={useGpsLocation ? "navigate" : "navigate-outline"}
          size={16}
          color={useGpsLocation ? "#ffffff" : "#6b7280"}
        />
        <Text style={[styles.gpsSwitchLabel, useGpsLocation && styles.gpsSwitchLabelActive]}>
          {useGpsLocation ? "Using your current location" : "Use my current location"}
        </Text>
        {isLocked && (
          <Icon name="lock-closed" size={14} color="#9CA3AF" style={{ marginRight: 4 }} />
        )}
        <Switch
          value={useGpsLocation}
          onValueChange={(val) => {
            if (isLocked && !val) {
              onLockedTap?.();
              return;
            }
            onToggleGps(val);
          }}
          trackColor={{ false: '#e5e7eb', true: '#ffffff' }}
          thumbColor={useGpsLocation ? '#eb7825' : '#ffffff'}
          ios_backgroundColor={useGpsLocation ? '#ffffff' : '#e5e7eb'}
        />
      </View>

      {!useGpsLocation && !isLocked && (
        <>
          {/* Show chip when location is selected and not editing */}
          {searchLocation.length > 0 && !isInputFocused ? (
            <View style={styles.locationChip}>
              <Icon name="location" size={14} color="#ffffff" />
              <Text style={styles.locationChipText} numberOfLines={1}>{searchLocation}</Text>
              <TouchableOpacity
                onPress={onClearLocation}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityLabel="Clear location"
              >
                <Icon name="close-circle" size={18} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            </View>
          ) : (
          <View
            style={[
              styles.locationInputContainer,
              isInputFocused && styles.locationInputContainerFocused,
            ]}
          >
            <Icon
              name="location"
              size={16}
              color="#6b7280"
              style={styles.locationInputIcon}
            />
            <TextInput
              style={styles.locationTextInput}
              placeholder={t('preferences:location.search_placeholder')}
              placeholderTextColor="#9ca3af"
              value={searchLocation}
              onChangeText={onLocationInputChange}
              onFocus={onFocus}
              onBlur={onBlur}
              autoCapitalize="words"
              returnKeyType="done"
            />
          </View>
          )}
        </>
      )}

      {/* Helper text — always visible, state-aware */}
      <View style={styles.locationHelperContainer}>
        <Icon
          name="information-circle-outline"
          size={14}
          color="#9ca3af"
        />
        <Text style={styles.locationHelperText}>
          {useGpsLocation
            ? t('preferences:location.gps_helper')
            : t('preferences:location.manual_helper')}
        </Text>
      </View>

      {/* Locked hint for free users */}
      {isLocked && (
        <TouchableOpacity onPress={onLockedTap} activeOpacity={0.7}>
          <View style={styles.lockedHintContainer}>
            <Icon name="sparkles" size={14} color="#f97316" />
            <Text style={styles.lockedHintText}>
              {t('preferences:location.pro_feature')}
            </Text>
          </View>
        </TouchableOpacity>
      )}

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
                <Text style={styles.suggestionText}>{t('preferences:location.searching')}</Text>
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
                  <Icon
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
    );
  }
);

LocationInputSection.displayName = "LocationInputSection";

const styles = StyleSheet.create({
  // Content container — glass card is provided by parent Animated.View in PreferencesSheet
  section: {
    backgroundColor: 'transparent',
  },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#eb7825',
    borderWidth: 1,
    borderColor: '#eb7825',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 8,
    shadowColor: '#eb7825',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  locationChipText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  sectionQuestion: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 10,
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
  constraintInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderRadius: 999,
    paddingHorizontal: 14,
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
  travelPresetsContainer: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 12,
  },
  travelPresetPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    shadowColor: 'rgba(0, 0, 0, 0.04)',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 1,
  },
  travelPresetPillSelected: {
    backgroundColor: "#eb7825",
    borderColor: "#eb7825",
    shadowColor: '#eb7825',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  travelPresetPillText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#374151",
  },
  travelPresetPillTextSelected: {
    color: "#ffffff",
    fontWeight: "600",
  },
  travelInputUnit: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6b7280",
    marginLeft: 8,
  },
  gpsSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  gpsSwitchRowActive: {
    backgroundColor: '#eb7825',
    borderColor: '#eb7825',
  },
  gpsSwitchLabel: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
    fontWeight: '500',
  },
  gpsSwitchLabelActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  locationInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 6,
  },
  locationInputContainerFocused: {
    borderColor: "#eb7825",
    borderWidth: 1.5,
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
  lockedHintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  lockedHintText: {
    fontSize: 12,
    color: '#f97316',
    fontWeight: '500',
  },
});
