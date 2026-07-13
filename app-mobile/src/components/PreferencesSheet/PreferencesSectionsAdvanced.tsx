import React, { memo, useState, useEffect } from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  Switch,
} from "react-native";
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { TRAVEL_TIME_PRESETS } from "../../types/onboarding";
// ORCH-1361 → ORCH-1365 [location-search-relevance] — the custom starting-point
// field is the shared multi-row Mapbox suggest→retrieve picker (replacing the old
// forward/limit=1 single-row adapter). ORCH-1365 routes it through the `places`
// search mode (edge `suggest_places`: place-type filter drops POI noise +
// trailing-country strip + country ISO bias) and DROPS device proximity (OQ-4) —
// it is a "search a place you are NOT at" field, so the device bias buried the
// target place for a non-local user (evidence/ORCH-1365 §3). Business venue-name
// search stays on the SEPARATE filter-free `suggest` path (INV-3 / ORCH-1079).
import { MapboxAddressInput, type PlaceDetails } from "../location/MapboxAddressInput";
// META-ORCH-0991 Wave C — PreferencesSheet body now scrolls inside a gorhom
// BaseBottomSheet. The two text fields here must be gorhom's
// BottomSheetTextInput (so a focused field coordinates with the sheet position
// instead of being hidden by the keyboard), and the suggestions dropdown must
// use gorhom's BottomSheetScrollView (a raw RN <ScrollView> nested in a gorhom
// sheet fights the sheet pan). Both are re-exported from BaseBottomSheet because
// the sole-gorhom-consumer gate forbids importing @gorhom/bottom-sheet directly.
import {
  BottomSheetTextInput,
} from "../ui/BaseBottomSheet";

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
            <BottomSheetTextInput
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
    onClearLocation,
    onPickLocation,
    hasSelected,
    useGpsLocation,
    onToggleGps,
    isLocked,
    onLockedTap,
  }: {
    searchLocation: string;
    onLocationInputChange: (text: string) => void;
    onClearLocation?: () => void;
    // ORCH-1361 — fires when the user picks a suggestion AND retrieve resolves
    // coords; the host stores custom_lat/custom_lng from details.location.
    onPickLocation: (details: PlaceDetails) => void;
    // ORCH-1361 — a resolved location exists (selectedCoords != null) → show the
    // chip; otherwise show the editable multi-row search field.
    hasSelected: boolean;
    // ORCH-1365 — the device-proximity prop is RETIRED for this field: it is a
    // "search a place you are NOT at" field (separate GPS toggle), so biasing to
    // the current device buried the target place (evidence §3). The field now
    // routes through the `places` search mode (types filter + trailing-country
    // strip + country bias), which ranks the real place #1 without proximity.
    useGpsLocation: boolean;
    onToggleGps: (value: boolean) => void;
    isLocked?: boolean;
    onLockedTap?: () => void;
  }) => {
    const { t } = useTranslation(['preferences', 'common']);
    // ORCH-1315 [preferences-custom-location-paywall-not-firing] F-3 — the visually
    // natural tap targets (label + lock icon + the row itself) were dead: only the
    // Switch thumb fired the paywall. The row inner is shared; when `isLocked` the
    // WHOLE row becomes a pressable that presents the paywall via `onLockedTap`
    // (≥44pt target, button role), while the Switch keeps its own locked branch.
    const gpsRowInner = (
      <>
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
      </>
    );
    return (
    <View>
      {isLocked ? (
        <TouchableOpacity
          style={[styles.gpsSwitchRow, styles.gpsSwitchRowLocked, useGpsLocation && styles.gpsSwitchRowActive]}
          onPress={onLockedTap}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Upgrade to set a custom starting point"
        >
          {gpsRowInner}
        </TouchableOpacity>
      ) : (
        <View style={[styles.gpsSwitchRow, useGpsLocation && styles.gpsSwitchRowActive]}>
          {gpsRowInner}
        </View>
      )}

      {!useGpsLocation && !isLocked && (
        <>
          {/* ORCH-1365 — chip when a location is resolved; otherwise the shared
              multi-row Mapbox suggest→retrieve field in `places` search mode
              (POIs dropped + trailing-country strip + country bias). Proximity is
              DROPPED for this field (OQ-4): it is a "search a place you are NOT
              at" field, so device bias buried the target place. suggestLimit 8.
              Business venue-name search stays on the separate filter-free
              `suggest` path (INV-3 / ORCH-1079). */}
          {hasSelected ? (
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
            <View style={styles.locationFieldWrap}>
              <MapboxAddressInput
                variant="light"
                value={searchLocation}
                onChangeText={onLocationInputChange}
                onPick={onPickLocation}
                onClear={onClearLocation ?? (() => {})}
                placeholder={t('preferences:location.search_placeholder')}
                accessibilityLabel="Search for a starting point"
                leadingIcon="location"
                searchMode="places"
                minQueryLength={4}
                suggestLimit={8}
              />
            </View>
          )}
        </>
      )}

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

      {/* ORCH-1361 — the old hand-rolled suggestions dropdown is REMOVED; the
          shared MapboxAddressInput owns its own multi-row list + all states
          (searching / no-results / offline-retry / fetching-details / picked). */}
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
  // ORCH-1315 F-3 — locked GPS row is a whole-row paywall trigger; guarantee a
  // ≥44pt touch target (paddingVertical:10 + Switch already clears it, but pin it).
  gpsSwitchRowLocked: {
    minHeight: 44,
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
  // ORCH-1361 — wrapper around the shared multi-row Mapbox field (replaces the
  // old locationInputContainer + hand-rolled suggestionsContainer dropdown; the
  // shared field owns its own field chrome, row list, and states).
  locationFieldWrap: {
    marginTop: 4,
    marginBottom: 6,
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
