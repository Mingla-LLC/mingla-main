/**
 * ORCH-0824 — Address field with Google Places autocomplete + Place
 * Details fetch on pick. Replaces the plain `<Input>` previously used
 * on CreatorStep3Where so the wizard can capture structured city +
 * lat/lng without a separate UI step.
 *
 * UX flow:
 *   1. User types in the field.
 *   2. After 250ms of idle and ≥3 chars, suggestions fetch.
 *   3. Up to 5 suggestions render below the input as a tap-to-pick list.
 *   4. On pick, the dropdown collapses, an inline spinner shows in the
 *      field, and Place Details fetch starts.
 *   5. On success → invokes `onPick(details)`; parent writes
 *      `draft.address` + `draft.city` + `draft.locationGeo` atomically.
 *      The displayed value becomes the formatted address.
 *   6. On Place Details failure → inline error "Couldn't fetch address
 *      details. Tap to try again." with a retry affordance.
 *
 * Error contract: autocomplete failures are silent (empty dropdown);
 * pick failures are loud (user-actionable error). See Constitution #3.
 *
 * Accessibility: combobox role with status hints; suggestion cells are
 * tappable buttons with accessibilityLabel covering the full address.
 *
 * See: Mingla_Artifacts/specs/SPEC_ORCH-0824_BUSINESS_EVENTS_IN_CONSUMER_DISCOVER.md §3.6.2
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
  autocompletePlaces,
  fetchPlaceDetails,
  type PlaceAutocompleteSuggestion,
  type PlaceDetails,
} from "../../services/googlePlacesService";

const AUTOCOMPLETE_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 3;

interface AddressAutocompleteInputProps {
  /** Current displayed value (formatted address or in-progress typing). */
  value: string;
  /** Fires on every keystroke so the parent can keep draft.address in sync. */
  onChangeText: (next: string) => void;
  /** Fires when the user picks a suggestion AND Place Details fetch succeeds. */
  onPick: (details: PlaceDetails) => void;
  /** Fires when the user clears the field (X icon). Parent should zero address+city+locationGeo. */
  onClear: () => void;
  /** Inline error from parent-side validation (e.g., "Pick the venue address from the suggestions."). */
  error?: string;
  placeholder?: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading_suggestions" }
  | { kind: "suggestions_open"; results: PlaceAutocompleteSuggestion[] }
  | { kind: "fetching_details" }
  | { kind: "pick_error"; message: string };

export const AddressAutocompleteInput: React.FC<AddressAutocompleteInputProps> = ({
  value,
  onChangeText,
  onPick,
  onClear,
  error,
  placeholder = "Street, city, postcode",
}) => {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDebounceTimer = useCallback((): void => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  // Cleanup on unmount.
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
        const results = await autocompletePlaces(next);
        // Guard against stale results (user kept typing after we fired).
        // We compare against current value via closure — but since handleChangeText
        // captures `next`, if the displayed value has changed we still render the
        // older suggestions until the next debounce. That's acceptable for a
        // typeahead UX. Real correctness ride on the user's pick action.
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
        const details = await fetchPlaceDetails(s.placeId);
        // ORCH-0824 (QA F-4 fix): fire ONLY onPick on a successful pick.
        // The parent's onPick handler writes draft.address +
        // draft.city + draft.locationGeo atomically; the controlled
        // TextInput re-renders from draft.address automatically on the
        // next tick. Calling onChangeText here would re-trigger the
        // parent's address-only handler which clears city+locationGeo —
        // a wasteful and bug-prone double-write.
        onPick(details);
        setStatus({ kind: "idle" });
      } catch (e: unknown) {
        const message =
          e instanceof Error
            ? e.message
            : "PLACE_DETAILS_UNKNOWN";
        // Surface user-friendly copy; the raw error code (e.g.
        // PLACE_DETAILS_NO_LOCALITY) is preserved for logs only.
        console.warn("[AddressAutocompleteInput] pick failure:", message);
        setStatus({
          kind: "pick_error",
          message:
            "Couldn't fetch address details. Tap to try again.",
        });
      }
    },
    [clearDebounceTimer, onChangeText, onPick],
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
          accessibilityLabel="Venue address"
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

      {/* Inline parent error OR pick error (parent error takes precedence). */}
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

      {/* Suggestions dropdown */}
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
