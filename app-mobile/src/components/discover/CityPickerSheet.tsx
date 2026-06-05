/**
 * CityPickerSheet — ORCH-0809 Slice M2
 * META-ORCH-1060 [Mapbox consumer migration] §3.5 — migrated to the shared
 * @mingla/location-input Mapbox Search Box picker (dark variant).
 *
 * Bottom-sheet modal that lets the user pick a city for Discover's Ticketmaster
 * filter. On selection, persists the five `discover_city_*` columns to
 * `preferences` and closes. The DiscoverScreen consumer refetches via React
 * Query invalidation.
 *
 * META-ORCH-1060 keystone: the ISO state/country codes now come from the
 * STRUCTURED Mapbox fields (`details.regionCode` / `details.countryCode`) and
 * the clean city token from `details.city` (Mapbox context.place.name). The old
 * display-string parser + the comma-split city derivation are DELETED — codes
 * are structured, never parsed (INV-3).
 * https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
 *
 * Hard guard: this sheet ONLY writes the discover_city_* fields. It does NOT
 * touch custom_lat/custom_lng/custom_location/use_gps_location.
 */

import React, { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import * as Haptics from "expo-haptics";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { MapboxAddressInput, type PlaceDetails } from "../location/MapboxAddressInput";
import { PreferencesService } from "../../services/preferencesService";
import type { DiscoverCity } from "../../types/discoverFilters";
import { Icon } from "../ui/Icon";

const SNAP_POINTS = ["90%"];
const SHEET_BACKGROUND = {
  backgroundColor: "rgba(20,22,26,0.98)",
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
} as const;

interface CityPickerSheetProps {
  visible: boolean;
  userId: string | null;
  currentCity: DiscoverCity | null;
  onClose: () => void;
  onCityPicked: (city: DiscoverCity) => void;
}

export const CityPickerSheet: React.FC<CityPickerSheetProps> = ({
  visible,
  userId,
  currentCity,
  onClose,
  onCityPicked,
}) => {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [persisting, setPersisting] = useState(false);

  // Reset state when sheet opens
  useEffect(() => {
    if (visible) {
      setQuery("");
      setError(null);
      setPersisting(false);
    }
  }, [visible]);

  const handlePick = useCallback(
    async (details: PlaceDetails) => {
      if (persisting) return;
      if (
        !details.location ||
        typeof details.location.lat !== "number" ||
        typeof details.location.lng !== "number"
      ) {
        setError("That spot wouldn't resolve. Try another.");
        return;
      }
      setPersisting(true);
      setError(null);

      // META-ORCH-1060: codes from STRUCTURED Mapbox fields (never parsed).
      // - discover_city_name      = details.city (Mapbox context.place.name) —
      //   the clean locality token that exact-matches events.city (ORCH-0824).
      // - discover_city_state_code = details.regionCode (ISO 3166-2) — now
      //   correct for ALL countries, not just US (was a US-only string parse).
      // - discover_city_country_code = details.countryCode (ISO 3166-1 alpha-2).
      const city: DiscoverCity = {
        name: details.city,
        stateCode: details.regionCode,
        countryCode: details.countryCode,
        lat: details.location.lat,
        lng: details.location.lng,
      };

      if (userId) {
        try {
          await PreferencesService.updateUserPreferences(userId, {
            discover_city_name: details.city,
            discover_city_state_code: details.regionCode,
            discover_city_country_code: details.countryCode,
            discover_city_lat: details.location.lat,
            discover_city_lng: details.location.lng,
          });
        } catch (err) {
          console.error("[CityPickerSheet] persist failed:", err);
          setError("Couldn't save your city. Tap a city to retry.");
          setPersisting(false);
          return;
        }
      }

      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
      onCityPicked(city);
      onClose();
    },
    [persisting, userId, onCityPicked, onClose],
  );

  const header = (
    <View style={styles.headerWrap}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Choose a city
        </Text>
        <TouchableOpacity
          onPress={onClose}
          style={styles.closeBtn}
          accessibilityLabel="Close city picker"
          accessibilityRole="button"
        >
          <Icon name="x" size={22} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
      </View>

      {currentCity && (
        <Text style={styles.currentHint}>
          Currently showing events in {currentCity.name}
        </Text>
      )}
    </View>
  );

  return (
    <BaseBottomSheet
      visible={visible}
      onClose={onClose}
      snapPoints={SNAP_POINTS}
      theme="dark"
      scrollMode="scroll"
      wrapInRNModal
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={SHEET_BACKGROUND}
      accessibilityLabel="City picker"
      header={header}
      scrollProps={{
        keyboardShouldPersistTaps: "handled",
        contentContainerStyle: styles.resultsContent,
      }}
    >
      <View style={styles.fieldWrap}>
        <MapboxAddressInput
          variant="dark"
          value={query}
          onChangeText={setQuery}
          onPick={handlePick}
          onClear={() => {
            setQuery("");
            setError(null);
          }}
          error={error ?? undefined}
          placeholder="Search for a city (e.g. Brooklyn, Miami)"
          accessibilityLabel="Search for a city"
          leadingIcon="search"
          minQueryLength={2}
          autoFocus
        />
      </View>
    </BaseBottomSheet>
  );
};

const styles = StyleSheet.create({
  headerWrap: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  title: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 18,
    fontWeight: "600",
  },
  closeBtn: {
    padding: 6,
  },
  currentHint: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 13,
    marginTop: 2,
    marginBottom: 8,
  },
  fieldWrap: {
    marginTop: 12,
  },
  resultsContent: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
});
