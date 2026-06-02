/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 4
 *
 * MapboxAddressInput — address field with Mapbox Search Box autocomplete +
 * retrieve-on-pick for the experience stops builder. A drop-in sibling of
 * AddressAutocompleteInput (the event venue picker): SAME props, SAME Status
 * state machine, SAME StyleSheet tokens, SAME 250ms debounce / ≥3-char gate /
 * ≤5-suggestion dropdown / inline pick spinner / loud pick error / silent
 * autocomplete failures / combobox a11y.
 *
 * WHY a new component (not a `provider` prop on AddressAutocompleteInput):
 * the existing event picker is Google-wired (hardcoded "Venue address" label,
 * Google service import). A clean sibling keeps the proven event path
 * untouched (lower blast radius). Both satisfy the same PlaceDetails boundary,
 * so a future consolidation is trivial (v1.1 cleanup, not Sub-A scope).
 *
 * Differences from AddressAutocompleteInput:
 *   - Calls autocompleteMapbox / retrieveMapboxPlace with a per-session UUID
 *     held in a ref (one token per typing session → suggest+retrieve = one
 *     Mapbox billing session).
 *   - accessibilityLabel is parametrized (parent passes "Stop {n} address").
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { Icon } from "../ui/Icon";
import {
  autocompleteMapbox,
  newMapboxSessionToken,
  retrieveMapboxPlace,
  type PlaceAutocompleteSuggestion,
  type PlaceDetails,
} from "../../services/mapboxGeocodeService";

const AUTOCOMPLETE_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 3;

interface MapboxAddressInputProps {
  /** Current displayed value (formatted address or in-progress typing). */
  value: string;
  /** Fires on every keystroke so the parent can keep the stop's address in sync. */
  onChangeText: (next: string) => void;
  /** Fires when the user picks a suggestion AND retrieve succeeds. */
  onPick: (details: PlaceDetails) => void;
  /** Fires when the user clears the field (X icon). Parent zeroes address+geo. */
  onClear: () => void;
  /** Inline error from parent-side validation. */
  error?: string;
  placeholder?: string;
  /** Parametrized a11y label (e.g. "Stop 2 address"). */
  accessibilityLabel?: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading_suggestions" }
  | { kind: "suggestions_open"; results: PlaceAutocompleteSuggestion[] }
  | { kind: "fetching_details" }
  | { kind: "pick_error"; message: string };

export const MapboxAddressInput: React.FC<MapboxAddressInputProps> = ({
  value,
  onChangeText,
  onPick,
  onClear,
  error,
  placeholder = "Pick a place",
  accessibilityLabel = "Address",
}) => {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One Mapbox session token per typing session; reused across suggest→retrieve.
  const sessionToken = useRef<string>(newMapboxSessionToken());

  const clearDebounceTimer = useCallback((): void => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  useEffect((): (() => void) => {
    return (): void => {
      clearDebounceTimer();
    };
  }, [clearDebounceTimer]);

  const handleChangeText = useCallback(
    (next: string): void => {
      onChangeText(next);
      clearDebounceTimer();
      if (next.trim().length < MIN_QUERY_LENGTH) {
        setStatus({ kind: "idle" });
        return;
      }
      setStatus({ kind: "loading_suggestions" });
      debounceTimer.current = setTimeout(async (): Promise<void> => {
        const results = await autocompleteMapbox(next, sessionToken.current);
        if (results.length === 0) {
          setStatus({ kind: "idle" });
        } else {
          setStatus({ kind: "suggestions_open", results });
        }
      }, AUTOCOMPLETE_DEBOUNCE_MS);
    },
    [clearDebounceTimer, onChangeText],
  );

  const handlePickSuggestion = useCallback(
    async (s: PlaceAutocompleteSuggestion): Promise<void> => {
      clearDebounceTimer();
      setStatus({ kind: "fetching_details" });
      try {
        const details = await retrieveMapboxPlace(s.placeId, sessionToken.current);
        // Fire ONLY onPick on a successful pick — the parent writes
        // address + city + region + countryCode + lat/lng atomically and the
        // controlled TextInput re-renders from the parent's value next tick.
        onPick(details);
        setStatus({ kind: "idle" });
        // Rotate the session token AFTER a completed suggest→retrieve pair so
        // the next typing session bills as a fresh Mapbox session.
        sessionToken.current = newMapboxSessionToken();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "MAPBOX_UNKNOWN";
        console.warn("[MapboxAddressInput] pick failure:", message);
        setStatus({
          kind: "pick_error",
          message: "Couldn't fetch address details. Tap to try again.",
        });
      }
    },
    [clearDebounceTimer, onPick],
  );

  const handleClear = useCallback((): void => {
    clearDebounceTimer();
    setStatus({ kind: "idle" });
    onClear();
  }, [clearDebounceTimer, onClear]);

  const handleRetry = useCallback((): void => {
    setStatus({ kind: "idle" });
  }, []);

  const showClear =
    value.length > 0 &&
    status.kind !== "fetching_details" &&
    status.kind !== "loading_suggestions";

  return (
    <View>
      <View
        style={[
          styles.inputWrap,
          (error !== undefined || status.kind === "pick_error") &&
            styles.inputWrapError,
        ]}
      >
        <TextInput
          value={value}
          onChangeText={handleChangeText}
          placeholder={placeholder}
          placeholderTextColor={textTokens.quaternary}
          autoCorrect={false}
          autoCapitalize="words"
          style={styles.input}
          accessibilityRole="combobox"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Type at least 3 characters to see suggestions, then pick one."
        />
        {status.kind === "loading_suggestions" || status.kind === "fetching_details" ? (
          <ActivityIndicator size="small" color={accent.warm} style={styles.indicator} />
        ) : showClear ? (
          <Pressable
            onPress={handleClear}
            accessibilityRole="button"
            accessibilityLabel="Clear address"
            hitSlop={8}
            style={styles.clearBtn}
          >
            <Icon name="close" size={16} color={textTokens.tertiary} />
          </Pressable>
        ) : null}
      </View>

      {error !== undefined ? (
        <Text style={styles.helperError}>{error}</Text>
      ) : status.kind === "pick_error" ? (
        <Pressable
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel={`Retry: ${status.message}`}
          hitSlop={4}
        >
          <Text style={styles.helperError}>{status.message}</Text>
        </Pressable>
      ) : null}

      {status.kind === "suggestions_open" ? (
        <View style={styles.dropdown}>
          {status.results.map((s) => (
            <Pressable
              key={s.placeId}
              onPress={() => handlePickSuggestion(s)}
              accessibilityRole="button"
              accessibilityLabel={s.fullAddress}
              style={({ pressed }) => [
                styles.suggestionRow,
                pressed && styles.suggestionRowPressed,
              ]}
            >
              <Icon name="location" size={14} color={textTokens.tertiary} />
              <View style={styles.suggestionTextCol}>
                <Text style={styles.suggestionMain} numberOfLines={1}>
                  {s.displayName}
                </Text>
                {s.fullAddress !== s.displayName ? (
                  <Text style={styles.suggestionSub} numberOfLines={1}>
                    {s.fullAddress}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputWrapError: {
    borderColor: semantic.error,
  },
  input: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    padding: 0,
  },
  indicator: {
    marginLeft: spacing.xs,
  },
  clearBtn: {
    marginLeft: spacing.xs,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  dropdown: {
    marginTop: spacing.xs,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  suggestionRowPressed: {
    backgroundColor: accent.tint,
  },
  suggestionTextCol: {
    flex: 1,
  },
  suggestionMain: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
  },
  suggestionSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
});

export default MapboxAddressInput;
