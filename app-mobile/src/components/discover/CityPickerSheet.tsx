/**
 * CityPickerSheet — ORCH-0809 Slice M2
 *
 * Bottom-sheet modal that lets the user pick a city for Discover's Ticketmaster
 * filter. Uses the existing `geocodingService.autocomplete()` (Google Places).
 * On selection, persists the five `discover_city_*` columns to `preferences`
 * and closes. The DiscoverScreen consumer refetches via React Query invalidation.
 *
 * Failure modes (SPEC §12):
 * - Empty query → no autocomplete call (placeholder hint visible)
 * - No matches → "No matches — try a broader query"
 * - Whitespace-only → trimmed before query; same as empty
 * - Autocomplete network failure → "Couldn't reach city search. Tap to try again."
 *
 * Hard guard: this sheet ONLY writes the discover_city_* fields. It does NOT
 * touch custom_lat/custom_lng/custom_location/use_gps_location — those remain
 * owned by the existing location settings flow (see useUserLocation).
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import * as Haptics from "expo-haptics";
import {
  BaseBottomSheet,
  BottomSheetTextInput,
} from "../ui/BaseBottomSheet";
import { geocodingService, AutocompleteSuggestion } from "../../services/geocodingService";
import { PreferencesService } from "../../services/preferencesService";
// ORCH-0824 hotfix-5b: parse the first comma-separated segment of the
// OpenStreetMap display name to derive the canonical city token (e.g.
// "Raleigh") so the consumer-side city name matches what the business
// wizard writes to events.city.
import type { DiscoverCity } from "../../types/discoverFilters";
import { Icon } from "../ui/Icon";
import { glass } from "../../constants/designSystem";

// META-ORCH-0991 Wave C Batch 1 — was an RN <Modal> slide-up with a
// KeyboardAvoidingView lifting a flex:1 sheet above the keyboard. Converted to
// BaseBottomSheet: gorhom owns keyboard coordination (keyboardBehavior
// interactive + BottomSheetTextInput), so the hand-rolled KeyboardAvoidingView
// is dropped. Fixed ['90%'] snap (the old sheet was full-height minus an 80px
// dismiss strip ≈ 90%; playbook §2 prefers a fixed snap). Bespoke dark canvas
// (rgba(20,22,26,0.98)) + topRadius 24 preserved via backgroundStyle. Mounted
// from DiscoverScreen before the floating GlassBottomNav sibling → wrapInRNModal
// (same z-order trap as the Batch-5 Night Out filter on this screen).
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

const DEBOUNCE_MS = 250;

/**
 * Best-effort parser for "Brooklyn, NY, USA" / "Paris, France" shaped strings.
 * Returns ISO-3166-1 alpha-2 country code when recognized, ISO-3166-2 state code
 * for known US states, else null/null. TM tolerates city-name-only queries, so
 * unknown locales fall through gracefully.
 */
const US_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "USA": "US",
  "United States": "US",
  "United States of America": "US",
  "UK": "GB",
  "United Kingdom": "GB",
  "Canada": "CA",
  "Mexico": "MX",
  "France": "FR",
  "Germany": "DE",
  "Spain": "ES",
  "Italy": "IT",
  "Japan": "JP",
  "Australia": "AU",
  "Brazil": "BR",
};

function parseStateCountry(fullAddress: string): {
  stateCode: string | null;
  countryCode: string | null;
} {
  const parts = fullAddress.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return { stateCode: null, countryCode: null };

  const last = parts[parts.length - 1];
  const second = parts.length >= 2 ? parts[parts.length - 2] : "";

  // Country: try the last part
  const countryCode = COUNTRY_NAME_TO_CODE[last] ?? null;

  // State: for US addresses, "City, ST, USA" pattern — second-to-last is the ST.
  let stateCode: string | null = null;
  if (countryCode === "US") {
    const candidate = second.toUpperCase();
    if (US_STATE_CODES.has(candidate)) {
      stateCode = candidate;
    } else {
      const trailing = candidate.match(/\b([A-Z]{2})\b\s*$/);
      if (trailing && US_STATE_CODES.has(trailing[1])) {
        stateCode = trailing[1];
      }
    }
  }

  return { stateCode, countryCode };
}

export const CityPickerSheet: React.FC<CityPickerSheetProps> = ({
  visible,
  userId,
  currentCity,
  onClose,
  onCityPicked,
}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AutocompleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persisting, setPersisting] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when sheet opens
  useEffect(() => {
    if (visible) {
      setQuery("");
      setResults([]);
      setError(null);
      setPersisting(false);
    }
  }, [visible]);

  // Debounced autocomplete
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    debounceRef.current = setTimeout(async () => {
      try {
        const suggestions = await geocodingService.autocomplete(trimmed);
        setResults(suggestions);
        setLoading(false);
      } catch (err) {
        console.error("[CityPickerSheet] autocomplete failed:", err);
        setResults([]);
        setError("Couldn't reach city search. Tap to try again.");
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handlePick = useCallback(
    async (suggestion: AutocompleteSuggestion) => {
      if (persisting) return;
      if (!suggestion.location) {
        setError("This city couldn't be resolved. Try another.");
        return;
      }
      setPersisting(true);
      const { stateCode, countryCode } = parseStateCountry(suggestion.fullAddress);

      // ORCH-0824 hotfix-5b: resolve `locality` so the stored city name
      // matches what the business wizard writes to events.city. The
      // merged Discover endpoint does an EXACT string match on
      // `events.city`; without symmetric extraction, the consumer would
      // search for "Raleigh, NC, USA" while business events have
      // city="Raleigh" — zero matches.
      //
      // Parse the first comma-separated segment from the OpenStreetMap
      // display name as the canonical city token like "Raleigh" / "London".
      let resolvedCityName = suggestion.displayName;
      const firstSegment = suggestion.displayName.split(",")[0]?.trim();
      if (firstSegment && firstSegment.length > 0) resolvedCityName = firstSegment;

      const city: DiscoverCity = {
        name: resolvedCityName,
        stateCode,
        countryCode,
        lat: suggestion.location.lat,
        lng: suggestion.location.lng,
      };

      if (userId) {
        try {
          await PreferencesService.updateUserPreferences(userId, {
            discover_city_name: city.name,
            discover_city_state_code: city.stateCode,
            discover_city_country_code: city.countryCode,
            discover_city_lat: city.lat,
            discover_city_lng: city.lng,
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

      <View style={styles.inputWrap}>
        <Icon name="search" size={18} color="rgba(255,255,255,0.5)" />
        <BottomSheetTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search for a city (e.g. Brooklyn, Miami)"
          placeholderTextColor="rgba(255,255,255,0.4)"
          style={styles.input}
          autoCorrect={false}
          autoCapitalize="words"
          accessibilityLabel="Search for a city"
          autoFocus
        />
      </View>
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
      {loading && (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={glass.chrome.active.glowColor} />
          <Text style={styles.statusText}>Searching…</Text>
        </View>
      )}

      {!loading && error && (
        <TouchableOpacity onPress={() => setQuery(query)} style={styles.statusRow}>
          <Icon name="cloud-offline-outline" size={18} color="rgba(255,255,255,0.5)" />
          <Text style={styles.statusText}>{error}</Text>
        </TouchableOpacity>
      )}

      {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
        <View style={styles.statusRow}>
          <Text style={styles.statusText}>
            No matches — try a broader query.
          </Text>
        </View>
      )}

      {!loading && !error && query.trim().length < 2 && (
        <View style={styles.statusRow}>
          <Text style={styles.statusText}>
            Type at least 2 letters to search.
          </Text>
        </View>
      )}

      {!loading &&
        results.map((suggestion, idx) => (
          <TouchableOpacity
            key={`${idx}-${suggestion.displayName}`}
            onPress={() => handlePick(suggestion)}
            disabled={persisting}
            style={[
              styles.resultRow,
              persisting && styles.resultRowDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Pick ${suggestion.displayName}`}
          >
            <Icon name="location-outline" size={18} color="rgba(255,255,255,0.55)" />
            <View style={styles.resultText}>
              <Text style={styles.resultPrimary} numberOfLines={1}>
                {suggestion.displayName}
              </Text>
              <Text style={styles.resultSecondary} numberOfLines={1}>
                {suggestion.fullAddress}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
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
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 12,
    paddingHorizontal: 14,
    marginTop: 12,
    marginBottom: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    color: "rgba(255,255,255,0.95)",
    fontSize: 16,
    paddingVertical: 14,
  },
  resultsContent: {
    paddingHorizontal: 20,
    paddingBottom: 36,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 4,
    gap: 10,
  },
  statusText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 14,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 4,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  resultRowDisabled: {
    opacity: 0.5,
  },
  resultText: {
    flex: 1,
  },
  resultPrimary: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 15,
    fontWeight: "500",
  },
  resultSecondary: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    marginTop: 2,
  },
});
