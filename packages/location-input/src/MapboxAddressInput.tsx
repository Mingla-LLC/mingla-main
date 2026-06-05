/**
 * @mingla/location-input · MapboxAddressInput
 *
 * Shared Mapbox Search Box address/city picker FIELD + suggestion list, used by
 * BOTH mingla-business (experience stops) and app-mobile (consumer
 * discover/preferences/onboarding). Extracted from
 * mingla-business/src/components/location/MapboxAddressInput.tsx per
 * META-ORCH-1060 §3.2.
 *
 * THE TOKEN RULE (DESIGN §0): the field owns NO design-system import. The host
 * injects a fully-resolved `tokens` bundle + `IconComponent` + `invoke` + copy.
 * Two consumer variants (light/dark) + the business variant are just different
 * injected bundles — same component.
 *
 * The field owns the suggest→retrieve state machine, 250ms debounce, ≥
 * minQueryLength gate, the row markup, a11y, haptics, and these states (DESIGN
 * §6): idle/typing-hint, loading-suggestions, suggestions-open, fetching-details
 * (NEW for consumer — the retrieve round-trip), picked, pick-error (NEW),
 * empty-no-results, offline. The HOST owns the sheet chrome + where the list
 * mounts (card-below vs inline) via the `dropdown.mode` token.
 *
 * Gorhom awareness (DESIGN §3.3): consumer hosts are @gorhom bottom sheets, so
 * the host injects its gorhom-aware `TextInputComponent` (BottomSheetTextInput).
 * The business host omits it → falls back to RN TextInput.
 *
 * Mapbox docs: suggest https://docs.mapbox.com/api/search/search-box/#get-suggestions
 * retrieve https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature
 * session billing https://docs.mapbox.com/api/search/search-box/#session-billing
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  View,
  type TextInputProps,
} from "react-native";

import {
  autocompleteMapbox,
  newMapboxSessionToken,
  retrieveMapboxPlace,
  type InvokeFn,
  type PlaceAutocompleteSuggestion,
  type PlaceDetails,
} from "./mapboxGeocodeService";
import type {
  LocationInputCopy,
  LocationInputIcon,
  LocationInputTokens,
} from "./types";

const AUTOCOMPLETE_DEBOUNCE_MS = 250;

type HapticsLike = {
  selectionAsync?: () => Promise<void>;
  notificationAsync?: (type: unknown) => Promise<void>;
  NotificationFeedbackType?: { Success?: unknown; Error?: unknown };
};

export interface MapboxAddressInputProps {
  /** Current displayed value (formatted address or in-progress typing). */
  value: string;
  /** Fires on every keystroke so the parent can keep its address in sync. */
  onChangeText: (next: string) => void;
  /** Fires when the user picks a suggestion AND retrieve succeeds. */
  onPick: (details: PlaceDetails) => void;
  /** Fires when the user clears the field (X icon). Parent zeroes address+geo. */
  onClear: () => void;
  /** Inline error from parent-side validation (host-owned). */
  error?: string;
  placeholder?: string;
  /** a11y label (e.g. "Search for a city" / "Stop 2 address"). */
  accessibilityLabel?: string;

  // ── Injection (THE TOKEN RULE) ──────────────────────────────────────────
  tokens: LocationInputTokens;
  IconComponent: LocationInputIcon;
  /** The host's supabase.functions.invoke. */
  invoke: InvokeFn;
  copy: LocationInputCopy;

  // ── Behavior knobs (DESIGN §12.3) ───────────────────────────────────────
  /** Minimum chars before suggest fires. Default 3. Hosts: City 2, Prefs 4, etc. */
  minQueryLength?: number;
  /** Leading glyph: "search" (City) | "location" (Prefs/Onboarding). */
  leadingIcon?: string;
  /** Gorhom-aware TextInput (BottomSheetTextInput). Falls back to RN TextInput. */
  TextInputComponent?: React.ComponentType<TextInputProps>;
  /** Host's expo-haptics module (optional; haptics no-op if absent). */
  haptics?: HapticsLike;
  /** autoFocus the field on mount (City does). */
  autoFocus?: boolean;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading_suggestions" }
  | { kind: "suggestions_open"; results: PlaceAutocompleteSuggestion[] }
  | { kind: "no_results" }
  | { kind: "offline" }
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
  tokens,
  IconComponent,
  invoke,
  copy,
  minQueryLength = 3,
  leadingIcon = "location",
  TextInputComponent,
  haptics,
  autoFocus = false,
}) => {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [focused, setFocused] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One Mapbox session token per typing session; reused across suggest→retrieve.
  const sessionToken = useRef<string>(newMapboxSessionToken());

  const TextInput = TextInputComponent ?? RNTextInput;

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

  const fireHaptic = useCallback(
    (kind: "selection" | "success" | "error"): void => {
      if (!haptics) return;
      try {
        if (kind === "selection") {
          void haptics.selectionAsync?.();
        } else if (kind === "success") {
          void haptics.notificationAsync?.(
            haptics.NotificationFeedbackType?.Success,
          );
        } else {
          void haptics.notificationAsync?.(
            haptics.NotificationFeedbackType?.Error,
          );
        }
      } catch {
        // haptics are best-effort; never crash the field
      }
    },
    [haptics],
  );

  const announce = useCallback((message: string): void => {
    try {
      AccessibilityInfo.announceForAccessibility(message);
    } catch {
      // best-effort
    }
  }, []);

  const handleChangeText = useCallback(
    (next: string): void => {
      onChangeText(next);
      clearDebounceTimer();
      if (next.trim().length < minQueryLength) {
        setStatus({ kind: "idle" });
        return;
      }
      setStatus({ kind: "loading_suggestions" });
      debounceTimer.current = setTimeout(async (): Promise<void> => {
        try {
          const results = await autocompleteMapbox(next, sessionToken.current, {
            invoke,
          });
          if (results.length === 0) {
            setStatus({ kind: "no_results" });
            announce(copy.noResults);
          } else {
            setStatus({ kind: "suggestions_open", results });
          }
        } catch {
          // autocompleteMapbox itself swallows; this guards the unexpected.
          setStatus({ kind: "offline" });
          announce(copy.offline);
        }
      }, AUTOCOMPLETE_DEBOUNCE_MS);
    },
    [announce, clearDebounceTimer, copy.noResults, copy.offline, invoke, minQueryLength, onChangeText],
  );

  const handlePickSuggestion = useCallback(
    async (s: PlaceAutocompleteSuggestion): Promise<void> => {
      clearDebounceTimer();
      fireHaptic("selection");
      setStatus({ kind: "fetching_details" });
      try {
        const details = await retrieveMapboxPlace(s.placeId, sessionToken.current, {
          invoke,
        });
        onPick(details);
        setStatus({ kind: "idle" });
        fireHaptic("success");
        // Rotate the session token AFTER a completed suggest→retrieve pair.
        sessionToken.current = newMapboxSessionToken();
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "MAPBOX_UNKNOWN";
        console.warn("[MapboxAddressInput] pick failure:", message);
        fireHaptic("error");
        setStatus({ kind: "pick_error", message: copy.pickError });
      }
    },
    [clearDebounceTimer, copy.pickError, fireHaptic, invoke, onPick],
  );

  const handleClear = useCallback((): void => {
    clearDebounceTimer();
    setStatus({ kind: "idle" });
    onClear();
  }, [clearDebounceTimer, onClear]);

  const handleRetry = useCallback((): void => {
    setStatus({ kind: "idle" });
  }, []);

  const isBusy =
    status.kind === "loading_suggestions" || status.kind === "fetching_details";
  const showClear = value.length > 0 && !isBusy;
  const hasError = error !== undefined || status.kind === "pick_error";

  const fieldStyle = useMemo(
    () => ({
      flexDirection: "row" as const,
      alignItems: "center" as const,
      borderRadius: tokens.field.radius,
      overflow: "hidden" as const,
      borderWidth: hasError
        ? tokens.field.focusBorderWidth
        : focused
          ? tokens.field.focusBorderWidth
          : tokens.field.hasBorder
            ? 1
            : 0,
      borderColor: hasError
        ? tokens.field.borderError
        : focused
          ? tokens.field.borderFocused
          : tokens.field.border,
      backgroundColor: focused ? tokens.field.bgFocused : tokens.field.bg,
      paddingHorizontal: tokens.field.paddingHorizontal,
      paddingVertical: tokens.field.paddingVertical,
      gap: 8,
    }),
    [focused, hasError, tokens.field],
  );

  const renderRows = (results: PlaceAutocompleteSuggestion[]): React.ReactNode =>
    results.map((s) => (
      <Pressable
        key={s.placeId}
        onPress={() => handlePickSuggestion(s)}
        disabled={status.kind === "fetching_details"}
        accessibilityRole="button"
        accessibilityLabel={s.fullAddress || s.displayName}
        style={({ pressed }) => [
          {
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: tokens.row.paddingVertical,
            paddingHorizontal: tokens.row.paddingHorizontal,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: tokens.row.divider,
          },
          pressed && { backgroundColor: tokens.row.pressBg },
          status.kind === "fetching_details" && { opacity: 0.5 },
        ]}
      >
        <IconComponent
          name="location-outline"
          size={tokens.row.style === "chip" ? 18 : 16}
          color={tokens.row.textSecondary}
        />
        <View style={{ flex: 1 }}>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              color: tokens.row.textPrimary,
              fontSize: tokens.row.primaryFontSize,
              lineHeight: tokens.row.primaryLineHeight,
              fontWeight: tokens.row.primaryWeight,
            }}
          >
            {s.displayName}
          </Text>
          {s.fullAddress !== s.displayName ? (
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                color: tokens.row.textSecondary,
                fontSize: tokens.row.secondaryFontSize,
                lineHeight: tokens.row.secondaryLineHeight,
                marginTop: 2,
              }}
            >
              {s.fullAddress}
            </Text>
          ) : null}
        </View>
      </Pressable>
    ));

  const statusText = (text: string): React.ReactNode => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingVertical: 16,
        paddingHorizontal: 4,
      }}
    >
      <Text
        accessibilityLiveRegion="polite"
        style={{
          color: tokens.status.text,
          fontSize: tokens.status.fontSize,
          lineHeight: tokens.status.lineHeight,
        }}
      >
        {text}
      </Text>
    </View>
  );

  // List content rendered into the host-chosen slot. For "card" mode the host
  // gets a bordered card; for "inline" the rows flow directly on the canvas.
  const listContent = (
    <>
      {status.kind === "loading_suggestions" ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 16,
            paddingHorizontal: 4,
          }}
        >
          <ActivityIndicator size="small" color={tokens.spinner} />
          <Text
            style={{
              color: tokens.status.text,
              fontSize: tokens.status.fontSize,
              lineHeight: tokens.status.lineHeight,
            }}
          >
            {copy.searching}
          </Text>
        </View>
      ) : null}

      {status.kind === "no_results" ? statusText(copy.noResults) : null}

      {status.kind === "offline" ? (
        <Pressable
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel={`Retry: ${copy.offline}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 16,
            paddingHorizontal: 4,
          }}
        >
          <IconComponent
            name="cloud-offline-outline"
            size={18}
            color={tokens.icon.leading}
          />
          <Text
            style={{
              color: tokens.status.text,
              fontSize: tokens.status.fontSize,
              lineHeight: tokens.status.lineHeight,
            }}
          >
            {copy.offline}
          </Text>
        </Pressable>
      ) : null}

      {status.kind === "suggestions_open" || status.kind === "fetching_details" ? (
        status.kind === "suggestions_open" ? (
          renderRows(status.results)
        ) : null
      ) : null}
    </>
  );

  const wrappedList =
    tokens.dropdown.mode === "card" ? (
      status.kind === "suggestions_open" ||
      status.kind === "loading_suggestions" ||
      status.kind === "no_results" ||
      status.kind === "offline" ? (
        <View
          style={[
            {
              marginTop: 4,
              borderRadius: tokens.dropdown.radius,
              borderWidth: 1,
              borderColor: tokens.dropdown.border,
              backgroundColor: tokens.dropdown.bg,
              overflow: "hidden",
              maxHeight: tokens.dropdown.maxHeight,
            },
            tokens.dropdown.hasShadow ? styles.cardShadow : null,
          ]}
        >
          {listContent}
        </View>
      ) : null
    ) : (
      // inline mode — rows flow directly on the host canvas
      listContent
    );

  return (
    <View>
      <View style={fieldStyle}>
        <IconComponent
          name={leadingIcon}
          size={18}
          color={tokens.icon.leading}
        />
        <TextInput
          value={value}
          onChangeText={handleChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={tokens.text.placeholder}
          autoCorrect={false}
          autoCapitalize="words"
          autoFocus={autoFocus}
          style={{
            flex: 1,
            fontSize: 16,
            lineHeight: 24,
            color: tokens.text.input,
            padding: 0,
            ...(Platform.OS === "android" ? { paddingVertical: 0 } : null),
          }}
          accessibilityRole="combobox"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Type a couple letters to see places, then pick one."
        />
        {isBusy ? (
          <ActivityIndicator
            size="small"
            color={tokens.spinner}
            style={{ marginLeft: 4 }}
          />
        ) : showClear ? (
          <Pressable
            onPress={handleClear}
            accessibilityRole="button"
            accessibilityLabel="Clear"
            hitSlop={10}
            style={{
              marginLeft: 4,
              width: 24,
              height: 24,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <IconComponent name="close" size={16} color={tokens.icon.clear} />
          </Pressable>
        ) : null}
      </View>

      {error !== undefined ? (
        <Text
          style={{
            color: tokens.error.text,
            fontSize: tokens.error.fontSize,
            lineHeight: tokens.error.lineHeight,
            marginTop: 4,
          }}
        >
          {error}
        </Text>
      ) : status.kind === "pick_error" ? (
        <Pressable
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel={`Retry: ${status.message}`}
          hitSlop={4}
        >
          <Text
            style={{
              color: tokens.error.text,
              fontSize: tokens.error.fontSize,
              lineHeight: tokens.error.lineHeight,
              marginTop: 4,
            }}
          >
            {status.message}
          </Text>
        </Pressable>
      ) : null}

      {wrappedList}
    </View>
  );
};

const styles = StyleSheet.create({
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
});

export default MapboxAddressInput;
