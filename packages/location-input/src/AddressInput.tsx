/**
 * @mingla/location-input · AddressInput
 *
 * Shared address/city picker FIELD + suggestion list, used by BOTH
 * mingla-business (every Host address field) and app-mobile (Explorer
 * discover/preferences/onboarding). Google Maps Platform behind the proxy
 * since #4334.
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
 * empty-no-results, unavailable (#4334: search itself is down — never shown as
 * "No matches"). The HOST owns the sheet chrome + where the list mounts
 * (card-below vs inline) via the `dropdown.mode` token.
 *
 * Attribution (#4334, D5): a non-interactive Google Maps logo row sits directly
 * beneath the field, above the list, whenever rows, "No matches" or
 * "unavailable" are showing — so the keyboard never covers it (retest N-2).
 *
 * Gorhom awareness (DESIGN §3.3): consumer hosts are @gorhom bottom sheets, so
 * the host injects its gorhom-aware `TextInputComponent` (BottomSheetTextInput).
 * The business host omits it → falls back to RN TextInput.
 *
 * Google docs: autocomplete https://developers.google.com/maps/documentation/places/web-service/place-autocomplete
 * session pricing https://developers.google.com/maps/documentation/places/web-service/session-pricing
 * attribution https://developers.google.com/maps/documentation/places/web-service/policies
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
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView as RNScrollView,
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  View,
  type KeyboardEvent,
  type ScrollViewProps,
  type TextInputProps,
} from "react-native";

import {
  autocompleteAddress,
  autocompletePlaces,
  newPlacesSessionToken,
  PlacesServiceError,
  retrievePlace,
  type InvokeFn,
  type PlaceAutocompleteSuggestion,
  type PlaceDetails,
} from "./placesService";
import type {
  LocationInputCopy,
  LocationInputIcon,
  LocationInputTokens,
} from "./types";
import {
  computeShowFreeTextRow,
  resolveFreeTextRowStyle,
} from "./assistFooter";

const AUTOCOMPLETE_DEBOUNCE_MS = 250;

/** Google autocomplete sessions expire; a token idle this long is replaced. */
export const SESSION_IDLE_ROTATE_MS = 3 * 60 * 1000;

// ── Keyboard-aware dropdown cap (issue #1027 · Thread A) ──────────────────────
// I-PROPOSED-1027-KEYBOARD-AWARE-DROPDOWN-CAP. The card-mode suggestion list
// renders in normal flow directly below the field. Without a keyboard-aware cap,
// a large/unbounded injected `dropdown.maxHeight` (9999 on every business host,
// 280 consumer-light) lays the list out as one tall block that overflows BEHIND
// the soft keyboard — rows past the keyboard's top edge are rendered but
// physically unreachable while typing (proven on a physical Samsung A72). These
// constants + the pure `computeDropdownMaxHeight` below cap the scroll viewport
// to the measured space between the card's top and the keyboard's top, so the
// list scrolls WITHIN the cap instead of overflowing.

/** Breathing room between the last visible row and the keyboard's top edge. */
export const DROPDOWN_SAFETY_MARGIN = 8;
/**
 * Extra reserved space on iOS for the keyboard accessory / Done bar that sits
 * above the raw keyboard frame (mirrors SmartScrollView's DEFAULT_BOTTOM_OFFSET
 * rationale). Subtracted from the available space only on iOS.
 */
export const DROPDOWN_KEYBOARD_ACCESSORY_ALLOWANCE = 44;
/**
 * Floor for the capped viewport (≈2 rows) so the dropdown is always a usable,
 * scrollable window even in very tight layouts (iPhone SE, tall Android keyboard).
 */
export const MIN_DROPDOWN_HEIGHT = 96;

/**
 * Keyboard-aware effective `maxHeight` for the card-mode suggestion list.
 *
 * - `keyboardScreenY` — the keyboard's top edge in window coords (RN
 *   `KeyboardEvent.endCoordinates.screenY`); `Infinity` when the keyboard is hidden.
 * - `cardTopY` — the dropdown card's top edge in window coords (`measureInWindow`);
 *   `null` before the card has measured.
 * - `tokenMaxHeight` — the injected `dropdown.maxHeight` token, now an UPPER BOUND.
 *
 * When the keyboard is hidden (`keyboardScreenY` non-finite) or the card has not
 * measured yet (`cardTopY === null`), returns the token unchanged — today's
 * behavior, zero regression. Otherwise caps to the measured space above the
 * keyboard, never below `MIN_DROPDOWN_HEIGHT`.
 */
export function computeDropdownMaxHeight(params: {
  keyboardScreenY: number;
  cardTopY: number | null;
  tokenMaxHeight: number;
  isIOS: boolean;
  /**
   * #4334 N-2 — height of a fixed row inside the card ABOVE the list (Google's
   * logo row). The list's viewport gives it up so the list bottom stays above
   * the keyboard. Default 0 = the #1027 result unchanged.
   */
  reservedHeight?: number;
}): number {
  const { keyboardScreenY, cardTopY, isIOS } = params;
  const reserved = Math.max(0, params.reservedHeight ?? 0);
  const tokenMaxHeight = Math.max(0, params.tokenMaxHeight - reserved);
  if (!Number.isFinite(keyboardScreenY) || cardTopY === null) {
    return tokenMaxHeight;
  }
  const accessory = isIOS ? DROPDOWN_KEYBOARD_ACCESSORY_ALLOWANCE : 0;
  const availableBelow =
    keyboardScreenY - cardTopY - DROPDOWN_SAFETY_MARGIN - accessory - reserved;
  return Math.max(MIN_DROPDOWN_HEIGHT, Math.min(tokenMaxHeight, availableBelow));
}

// ── Issue #3291 — the saved address carries the tapped name ────────────────
// A row shows a bold name ("Didi Museum") over a grey line. The grey line is
// Google's `secondaryText` — only the SURROUNDING AREA ("Akin Adesola Street,
// Lagos, Nigeria"), never the name. Saving the grey line (#1407) dropped the
// venue/street/city name.
// One rule for the pending pill, the saved label and the row a11y label:
//   grey line begins with the name → the grey line (no doubling)
//   otherwise                      → "<name>, <grey line>"
//   after retrieve, the looked-up full address wins ONLY when it begins with
//   the name.
// "Begins with" compares the leading comma-separated part, ignoring case and
// spacing — a substring check would treat "Greater London" as "London".
// Kept in this file (not a module of its own) because the picker ships in the
// eager `__common` web chunk and every module costs a wrapper (ORCH-1083).

const normaliseLabel = (value: string): string =>
  value.replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim().toLowerCase();

/** True when `address` leads with `name` as its first comma-separated part. */
export function addressBeginsWithName(address: string, name: string): boolean {
  const n = normaliseLabel(name);
  const a = normaliseLabel(address);
  return n.length > 0 && (a === n || a.startsWith(`${n},`));
}

/** The row's label: always carries the name, never repeats it. */
export function composeSuggestionLabel(s: {
  displayName: string;
  fullAddress: string;
}): string {
  const name = (s.displayName ?? "").trim();
  const secondary = (s.fullAddress ?? "").trim();
  if (name.length === 0 || addressBeginsWithName(secondary, name)) {
    return secondary || name;
  }
  return secondary.length > 0 ? `${name}, ${secondary}` : name;
}

/** The label saved after retrieve: the full address if it still names the row. */
export function resolvePickedLabel(
  s: { displayName: string; fullAddress: string },
  retrievedAddress: string | null | undefined,
): string {
  const retrieved = (retrievedAddress ?? "").trim();
  const name = (s.displayName ?? "").trim();
  return retrieved.length > 0 &&
    (name.length === 0 || addressBeginsWithName(retrieved, name))
    ? retrieved
    : composeSuggestionLabel(s);
}

type HapticsLike = {
  selectionAsync?: () => Promise<void>;
  notificationAsync?: (type: unknown) => Promise<void>;
  NotificationFeedbackType?: { Success?: unknown; Error?: unknown };
};

export interface AddressInputProps {
  /** Current displayed value (formatted address or in-progress typing). */
  value: string;
  /** Fires on every keystroke so the parent can keep its address in sync. */
  onChangeText: (next: string) => void;
  /** Fires when the user picks a suggestion AND retrieve succeeds. */
  onPick: (details: PlaceDetails, selectedLabel?: string) => void;
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
  // ── ORCH-1365 [location-search-relevance] ─────────────────────────────────
  /**
   * Which autocomplete backend the field queries. Default `"venue"` keeps the
   * BUSINESS venue-name search (edge `suggest`, filter-free, POIs resolve —
   * byte-identical, INV-3 / ORCH-1079). `"places"` routes the CONSUMER place
   * search (edge `suggest_places`: place-type filter + trailing-country strip +
   * `country` ISO bias, POIs dropped). This is the ONLY behavioral switch;
   * omitting it preserves business behavior exactly.
   */
  searchMode?: "venue" | "places";
  /**
   * Gorhom-aware scroll container for the card-mode suggestion list (consumer
   * hosts inject `BottomSheetScrollView` so the list scrolls inside a gorhom
   * bottom sheet). Falls back to RN `ScrollView`. Only used in `dropdown.mode:
   * "card"`; inline mode is unaffected.
   */
  ScrollComponent?: React.ComponentType<ScrollViewProps>;
  /** Host's expo-haptics module (optional; haptics no-op if absent). */
  haptics?: HapticsLike;
  /** autoFocus the field on mount (City does). */
  autoFocus?: boolean;

  // ── ORCH-1361 [location-suggestions] · OPTIONAL rank bias ─────────────────
  // Threaded to the suggest call so results RANK to the user's area. NO type or
  // region FILTER on the Host search — venue names (POIs) must resolve.
  /** User-proximity rank bias "longitude,latitude" (client contract; the proxy swaps it). */
  proximity?: string;
  /**
   * #4334 — called when search is unavailable (the proxy's error code), so
   * the host can report it (throttled Sentry capture). Never called for an
   * honest empty result.
   */
  onSearchUnavailable?: (code: string) => void;

  // ── Issue #1363 [pinless selected-address mode] ────────────────────────────
  // All OPTIONAL + default-off. When every one is absent the assist footer is
  // omitted entirely and the field renders BYTE-IDENTICALLY (every app-mobile
  // consumer host passes none → consumer stays unchanged).
  /**
   * When true, the field renders a "Use '<typed text>'" affordance so the host
   * can accept free text as the display address (Tier 2). Default false → today.
   */
  allowFreeText?: boolean;
  /**
   * Fires with the raw controlled value when the user commits free text.
   */
  onFreeText?: (text: string) => void;
  /** Controlled business-only selected-address state. Omitted = legacy picker. */
  selectionState?: LocationSelectionState;
  /** Authoritative label shown in the selected-address pill. */
  selectedLabel?: string | null;
  /** X-to-change callback. The host clears committed location metadata. */
  onChangeSelected?: () => void;
}

export type LocationSelectionState =
  | "editing"
  | "resolving"
  | "selected"
  | "needs_context"
  | "error";

type Status =
  | { kind: "idle" }
  | { kind: "loading_suggestions" }
  | { kind: "suggestions_open"; results: PlaceAutocompleteSuggestion[] }
  | { kind: "no_results" }
  | { kind: "unavailable"; query: string }
  | { kind: "fetching_details" }
  | { kind: "pick_error"; message: string };

export const AddressInput: React.FC<AddressInputProps> = ({
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
  searchMode = "venue",
  ScrollComponent,
  haptics,
  autoFocus = false,
  proximity,
  onSearchUnavailable,
  allowFreeText = false,
  onFreeText,
  selectionState = "editing",
  selectedLabel = null,
  onChangeSelected,
}) => {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [focused, setFocused] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Issue #1363 SC-10 — every user action advances this monotonic generation.
  // Async suggest/retrieve completions may mutate state only while still current.
  const requestGeneration = useRef(0);
  const [pendingSelectedLabel, setPendingSelectedLabel] = useState<string | null>(
    null,
  );
  const [focusRevision, setFocusRevision] = useState(0);
  // Issue #1363 — set true right after a successful pick, reset on the next
  // keystroke. Used ONLY to hide the Tier-2 free-text row immediately after a
  // pick (so the picked address doesn't re-offer "Use '<address>'").
  const justPicked = useRef<boolean>(false);
  // One session token per typing session; reused across suggest→retrieve and
  // rotated after a pick, after Clear, and after 3 minutes idle (#4334).
  const sessionToken = useRef<string>(newPlacesSessionToken());
  const sessionLastUsed = useRef<number>(Date.now());
  const currentSessionToken = useCallback((): string => {
    const now = Date.now();
    if (now - sessionLastUsed.current > SESSION_IDLE_ROTATE_MS) {
      sessionToken.current = newPlacesSessionToken();
    }
    sessionLastUsed.current = now;
    return sessionToken.current;
  }, []);

  // issue #1027 (Thread A) — keyboard-aware card-mode dropdown cap. Track the
  // soft keyboard's top edge (window coords) + the dropdown card's own top edge
  // so the suggestion list caps its scroll viewport to the space above the
  // keyboard instead of overflowing behind it. Infinity/null → no constraint
  // (keyboard hidden / not yet measured), preserving today's token-driven height.
  const [keyboardScreenY, setKeyboardScreenY] = useState<number>(
    Number.POSITIVE_INFINITY,
  );
  const [cardTopY, setCardTopY] = useState<number | null>(null);
  const cardRef = useRef<View>(null);

  const TextInput = TextInputComponent ?? RNTextInput;

  const clearDebounceTimer = useCallback((): void => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, []);

  useEffect((): (() => void) => {
    return (): void => {
      requestGeneration.current += 1;
      clearDebounceTimer();
    };
  }, [clearDebounceTimer]);

  // issue #1027 (Thread A) — subscribe to the soft keyboard's frame so the
  // card-mode dropdown can cap to the space above it. `endCoordinates.screenY`
  // is the keyboard's top in window coords; when hidden we treat it as Infinity
  // (no constraint). Listeners are cleaned up on unmount.
  useEffect((): (() => void) => {
    const onFrame = (e: KeyboardEvent): void => {
      const y = e?.endCoordinates?.screenY;
      setKeyboardScreenY(
        typeof y === "number" && Number.isFinite(y) && y > 0
          ? y
          : Number.POSITIVE_INFINITY,
      );
    };
    const onHide = (): void => setKeyboardScreenY(Number.POSITIVE_INFINITY);
    const subs = [
      Keyboard.addListener("keyboardDidShow", onFrame),
      Keyboard.addListener("keyboardDidChangeFrame", onFrame),
      Keyboard.addListener("keyboardWillChangeFrame", onFrame),
      Keyboard.addListener("keyboardDidHide", onHide),
      Keyboard.addListener("keyboardWillHide", onHide),
    ];
    return (): void => {
      subs.forEach((s) => s.remove());
    };
  }, []);

  // issue #1027 (Thread A) — measure the dropdown card's top edge in window
  // coords. Called on the card's onLayout AND re-invoked whenever the keyboard
  // frame or the open/closed status changes (below), so the cap tracks reality.
  const measureCard = useCallback((): void => {
    const node = cardRef.current;
    if (node && typeof node.measureInWindow === "function") {
      node.measureInWindow((_x: number, y: number): void => {
        if (typeof y === "number" && Number.isFinite(y)) {
          setCardTopY(y);
        }
      });
    }
  }, []);

  useEffect((): void => {
    measureCard();
  }, [measureCard, keyboardScreenY, status.kind]);

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

  const runSearch = useCallback(
    (next: string, generation: number): void => {
      setStatus({ kind: "loading_suggestions" });
      debounceTimer.current = setTimeout(async (): Promise<void> => {
        // ORCH-1365 — "places" (Explorer) → suggest_places (areas only);
        // "venue" (Host, default) → suggest, filter-free so venue names resolve.
        const token = currentSessionToken();
        const result =
          searchMode === "places"
            ? await autocompletePlaces(next, token, { invoke }, { proximity })
            : await autocompleteAddress(next, token, { invoke }, { proximity });
        if (generation !== requestGeneration.current) return;
        if (!result.ok) {
          // #4334 / #338 — search is DOWN: say so, never "No matches".
          setStatus({ kind: "unavailable", query: next });
          announce(copy.unavailable);
          onSearchUnavailable?.(result.code);
        } else if (result.rows.length === 0) {
          setStatus({ kind: "no_results" });
          announce(copy.noResults);
        } else {
          setStatus({ kind: "suggestions_open", results: result.rows });
        }
      }, AUTOCOMPLETE_DEBOUNCE_MS);
    },
    [announce, copy.noResults, copy.unavailable, currentSessionToken, invoke, onSearchUnavailable, proximity, searchMode],
  );

  const handleChangeText = useCallback(
    (next: string): void => {
      const generation = ++requestGeneration.current;
      // Issue #1363 — any keystroke means the value is no longer a just-picked
      // address, so the Tier-2 free-text row may show again.
      justPicked.current = false;
      onChangeText(next);
      clearDebounceTimer();
      if (next.trim().length < minQueryLength) {
        setStatus({ kind: "idle" });
        return;
      }
      runSearch(next, generation);
    },
    [clearDebounceTimer, minQueryLength, onChangeText, runSearch],
  );

  const handlePickSuggestion = useCallback(
    async (s: PlaceAutocompleteSuggestion): Promise<void> => {
      const generation = ++requestGeneration.current;
      clearDebounceTimer();
      fireHaptic("selection");
      // Issue #3291 — the label must carry the tapped name. The grey line alone
      // is only the surrounding area for streets, cities and venues.
      let label = composeSuggestionLabel(s);
      setPendingSelectedLabel(label);
      setStatus({ kind: "fetching_details" });
      try {
        // Explorer place picks are preference anchors: coordinates from the
        // Geocoding API by place id (spec v2 A2). Host picks end the session
        // with Place Details.
        const details = await retrievePlace(
          s.placeId,
          currentSessionToken(),
          { invoke },
          searchMode === "places" ? { lookup: "geocoding" } : {},
        );
        if (generation !== requestGeneration.current) return;
        // Issue #3291 — prefer the looked-up full address, but only when it
        // still begins with the tapped name.
        label = resolvePickedLabel(s, details.formattedAddress);
        onPick(details, label);
        // Issue #1363 — a completed pick hides the Tier-2 free-text row until
        // the next keystroke.
        justPicked.current = true;
        setStatus({ kind: "idle" });
        setPendingSelectedLabel(null);
        fireHaptic("success");
        // Rotate the session token AFTER a completed suggest→retrieve pair.
        sessionToken.current = newPlacesSessionToken();
      } catch (e: unknown) {
        if (generation !== requestGeneration.current) return;
        const code = e instanceof PlacesServiceError ? e.code : "network";
        fireHaptic("error");
        setStatus({ kind: "pick_error", message: copy.pickError });
        announce(copy.pickError);
        onSearchUnavailable?.(code);
        if (code === "provider_id_retired") {
          // #4334 — a pre-#4334 id can never resolve: drop the stale
          // selection so the user searches again.
          setPendingSelectedLabel(null);
          sessionToken.current = newPlacesSessionToken();
          onClear();
        }
      }
    },
    [announce, clearDebounceTimer, copy.pickError, currentSessionToken, fireHaptic, invoke, onClear, onPick, onSearchUnavailable, searchMode],
  );

  const handleClear = useCallback((): void => {
    requestGeneration.current += 1;
    clearDebounceTimer();
    setStatus({ kind: "idle" });
    sessionToken.current = newPlacesSessionToken();
    onClear();
  }, [clearDebounceTimer, onClear]);

  const handleChangeSelected = useCallback((): void => {
    requestGeneration.current += 1;
    clearDebounceTimer();
    setPendingSelectedLabel(null);
    setStatus({ kind: "idle" });
    onChangeSelected?.();
    setFocusRevision((current) => current + 1);
  }, [clearDebounceTimer, onChangeSelected]);

  const handleRetry = useCallback((): void => {
    const generation = ++requestGeneration.current;
    clearDebounceTimer();
    // #4334 — "Tap to try again" re-runs the same query.
    if (status.kind === "unavailable" && status.query.trim().length >= minQueryLength) {
      runSearch(status.query, generation);
      return;
    }
    setStatus({ kind: "idle" });
  }, [clearDebounceTimer, minQueryLength, runSearch, status]);

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
        accessibilityLabel={composeSuggestionLabel(s)}
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

  // Single-row status blocks (loading / no-results / unavailable). ORCH-1365 — kept
  // OUTSIDE the scrollable row list so they never scroll; shared by card + inline.
  const statusContent = (
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

      {status.kind === "unavailable" ? (
        <Pressable
          onPress={handleRetry}
          accessibilityRole="button"
          accessibilityLabel={copy.unavailable}
          accessibilityLiveRegion="polite"
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
            {copy.unavailable}
          </Text>
        </Pressable>
      ) : null}
    </>
  );

  // #4334 (D5, retest N-2) — the list is Google's, so Google's logo sits
  // DIRECTLY BENEATH THE FIELD, above the suggestions: the keyboard rises from
  // the bottom, so a footer row could be covered while the user types (iPhone SE,
  // notched phones, short sheets); a row under the field never is.
  const showAttribution =
    status.kind === "suggestions_open" ||
    status.kind === "no_results" ||
    status.kind === "unavailable";
  const attribution = showAttribution ? (
    <PoweredByGoogle variant={tokens.attribution?.variant ?? "light"} />
  ) : null;

  const rowsOpen = status.kind === "suggestions_open" ? status.results : null;

  // Inline mode content — UNCHANGED (rows flow directly on the host canvas, no
  // scroll wrapper; the dark CityPicker sheet already scrolls its own body).
  const inlineContent = (
    <>
      {attribution}
      {statusContent}
      {rowsOpen ? renderRows(rowsOpen) : null}
    </>
  );

  // ORCH-1365 (F-5) — gorhom-aware scroll container so the card-mode suggestion
  // list is actually scrollable (was `overflow:hidden` + a maxHeight that CLIPPED
  // rows 6-8). The host injects `BottomSheetScrollView`; falls back to RN
  // ScrollView. maxHeight now BOUNDS the scroll viewport instead of clipping the
  // card; the outer card keeps border/bg/shadow/radius with `overflow:hidden`
  // (radius clip). Status rows stay above the scroll (single-row).
  const Scroll = ScrollComponent ?? RNScrollView;

  // issue #1027 (Thread A) — the injected `dropdown.maxHeight` token is now an
  // UPPER BOUND; the effective viewport is capped to the space above the keyboard
  // (falls back to the token unchanged when the keyboard is hidden / not measured).
  // #4334 N-2 — the logo row sits inside the card above the list, so the list's
  // viewport gives up that row's height to keep its bottom above the keyboard.
  const dropdownMaxHeight = computeDropdownMaxHeight({
    keyboardScreenY,
    cardTopY,
    tokenMaxHeight: tokens.dropdown.maxHeight,
    isIOS: Platform.OS === "ios",
    reservedHeight: showAttribution ? GOOGLE_MAPS_ATTRIBUTION_ROW_HEIGHT : 0,
  });

  const wrappedList =
    tokens.dropdown.mode === "card" ? (
      status.kind === "suggestions_open" ||
      status.kind === "loading_suggestions" ||
      status.kind === "no_results" ||
      status.kind === "unavailable" ? (
        <View
          ref={cardRef}
          onLayout={measureCard}
          style={[
            {
              marginTop: 4,
              borderRadius: tokens.dropdown.radius,
              borderWidth: 1,
              borderColor: tokens.dropdown.border,
              backgroundColor: tokens.dropdown.bg,
              overflow: "hidden",
            },
            tokens.dropdown.hasShadow ? styles.cardShadow : null,
          ]}
        >
          {attribution}
          {statusContent}
          {rowsOpen ? (
            <Scroll
              style={{ maxHeight: dropdownMaxHeight }}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {renderRows(rowsOpen)}
            </Scroll>
          ) : null}
        </View>
      ) : null
    ) : (
      // inline mode — rows flow directly on the host canvas (UNCHANGED)
      inlineContent
    );

  // ── Issue #1363 — selected free-text assist footer ────────────────────────
  // Rendered as a sibling BELOW the field/error (and the suggestion list), NOT
  // inside the dropdown card — so it shows in both card + inline dropdown modes
  // and regardless of whether the dropdown is open. When BOTH rows are hidden
  // the whole footer is omitted → BYTE-IDENTICAL render for consumer hosts that
  // do not opt into `allowFreeText`.
  const trimmedValue = value.trim();
  // Issue #1363 (device-UX F2) — TIMING: the action row must never compete with
  // a live suggestion list. It shows on `no_results` (primary) + idle-after-typing
  // with a full address; NEVER during loading_suggestions / suggestions_open /
  // fetching_details. Pure rule in ./assistFooter (unit-tested, fails-on-revert).
  const showFreeTextRow = computeShowFreeTextRow({
    allowFreeText: allowFreeText === true,
    hasOnFreeText: onFreeText !== undefined,
    justPicked: justPicked.current,
    statusKind: status.kind,
    trimmedLength: trimmedValue.length,
  });
  // Issue #1363 (device-UX F2) — ACCENT: when the host injects `tokens.action`
  // (business = brand orange) the row renders as an accent pill button; without
  // it (consumer) → the exact muted fallback → byte-identical render.
  const freeTextRowStyle = resolveFreeTextRowStyle(tokens.action, {
    text: tokens.status.text,
    icon: tokens.icon.leading,
  });
  const assistFooter =
    showFreeTextRow ? (
      <View style={{ marginTop: 4, gap: 2 }}>
        {showFreeTextRow ? (
          <Pressable
            onPress={() => {
              requestGeneration.current += 1;
              clearDebounceTimer();
              setStatus({ kind: "idle" });
              onFreeText?.(value);
            }}
            accessibilityRole="button"
            accessibilityLabel="Can't find it in the list? Use what you typed."
            hitSlop={8}
            style={({ pressed }) => [
              styles.assistRow,
              freeTextRowStyle.pill,
              pressed ? { opacity: 0.6 } : null,
            ]}
          >
            <IconComponent
              name="location-outline"
              size={16}
              color={freeTextRowStyle.iconColor}
            />
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                flex: 1,
                color: freeTextRowStyle.textColor,
                fontSize: tokens.status.fontSize,
                lineHeight: tokens.status.lineHeight,
                fontWeight: freeTextRowStyle.fontWeight,
              }}
            >
              {"Can't find it in the list? Use what you typed."}
            </Text>
          </Pressable>
        ) : null}
      </View>
    ) : null;

  const effectiveSelectionState: LocationSelectionState =
    selectionState !== "editing"
      ? selectionState
      : status.kind === "fetching_details"
        ? "resolving"
        : status.kind === "pick_error" && pendingSelectedLabel !== null
          ? "error"
          : "editing";
  const effectiveSelectedLabel =
    selectedLabel ?? pendingSelectedLabel ?? (value.length > 0 ? value : null);

  if (
    effectiveSelectionState !== "editing" &&
    effectiveSelectedLabel !== null
  ) {
    const stateMessage =
      effectiveSelectionState === "resolving"
        ? "Placing address…"
        : effectiveSelectionState === "needs_context"
          ? "Add a city or country so we can place this approximately."
          : effectiveSelectionState === "error"
            ? "We couldn't place this yet. Try again."
            : null;
    return (
      <View>
        <View
          accessibilityLiveRegion="polite"
          style={[fieldStyle, styles.selectedPill]}
        >
          {effectiveSelectionState === "resolving" ? (
            <ActivityIndicator size="small" color={tokens.spinner} />
          ) : (
            <IconComponent
              name="location-outline"
              size={18}
              color={tokens.icon.leading}
            />
          )}
          <Text
            accessibilityLabel={effectiveSelectedLabel}
            numberOfLines={2}
            style={[
              styles.selectedLabel,
              {
                color: tokens.text.input,
                fontSize: tokens.row.primaryFontSize,
                lineHeight: tokens.row.primaryLineHeight,
              },
            ]}
          >
            {effectiveSelectedLabel}
          </Text>
          <Pressable
            onPress={handleChangeSelected}
            accessibilityRole="button"
            accessibilityLabel="Change address"
            accessibilityHint="Returns to address search."
            hitSlop={8}
            style={({ pressed }) => [
              styles.changeAddressButton,
              pressed ? { opacity: 0.6 } : null,
            ]}
          >
            <IconComponent name="close" size={18} color={tokens.icon.clear} />
          </Pressable>
        </View>
        {stateMessage !== null ? (
          <View style={styles.selectedStatusRow}>
            <Text
              accessibilityLiveRegion="polite"
              style={{
                flex: 1,
                color:
                  effectiveSelectionState === "error"
                    ? tokens.error.text
                    : tokens.status.text,
                fontSize: tokens.status.fontSize,
                lineHeight: tokens.status.lineHeight,
              }}
            >
              {stateMessage}
            </Text>
            {effectiveSelectionState === "error" ? (
              <Pressable
                onPress={() => onFreeText?.(effectiveSelectedLabel)}
                accessibilityRole="button"
                accessibilityLabel="Retry placing address"
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed ? { opacity: 0.6 } : null,
                ]}
              >
                <Text
                  style={{
                    color: tokens.action?.text ?? tokens.text.input,
                    fontWeight: "600",
                  }}
                >
                  Retry
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View>
      <View style={fieldStyle}>
        <IconComponent
          name={leadingIcon}
          size={18}
          color={tokens.icon.leading}
        />
        <TextInput
          key={`location-input-${focusRevision}`}
          value={value}
          onChangeText={handleChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          placeholderTextColor={tokens.text.placeholder}
          autoCorrect={false}
          autoCapitalize="words"
          autoFocus={autoFocus || focusRevision > 0}
          // ORCH-1365 (F-6) — text-clip fix. Removed the forced `lineHeight:24`
          // (it capped the single-line box so descenders like g/y/p clipped at
          // the bottom); the platform now computes the line box and reserves
          // descender space. Android: `textAlignVertical:"center"` (keeps default
          // includeFontPadding so descenders are reserved) replaces the old
          // `paddingVertical:0` that squeezed them.
          style={{
            flex: 1,
            fontSize: 16,
            color: tokens.text.input,
            padding: 0,
            ...(Platform.OS === "android"
              ? { textAlignVertical: "center" as const }
              : null),
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

      {assistFooter}
    </View>
  );
};

const styles = StyleSheet.create({
  assistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  selectedPill: {
    minHeight: 52,
  },
  selectedLabel: {
    flex: 1,
  },
  changeAddressButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  selectedStatusRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  retryButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  // Google's clear space around the logo: 10 dp left, right and top, 5 dp bottom.
  attributionRow: {
    paddingTop: 10,
    paddingBottom: 5,
    paddingHorizontal: 10,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
});

/**
 * #4334 (Seth decision D5) — Google Maps attribution: a non-interactive row
 * directly beneath the field, above the suggestion list (retest N-2: never
 * where the keyboard can cover it). Google's own logo files, unmodified
 * (packages/location-input/assets, from Google_Maps_Attribution_Assets.zip,
 * approved by Seth 2026-11-08), drawn at 98×18 dp — their native aspect ratio
 * and inside Google's 16–19 dp height rule — with the required clear space:
 * 10 dp left, right and top, 5 dp bottom. Plain backgrounds only, so the
 * non-outlined logo: DarkGray on light surfaces, White on dark ones (the dark
 * Host sheets and the Explorer city picker).
 * https://developers.google.com/maps/documentation/places/web-service/policies
 */
// The image requires are GETTERS, so they run only when a logo row renders (an
// open suggestion list) — not when any screen merely imports the field. A
// module-scope image require pulled the PNGs into every importer's graph and
// broke jest configs that have no image transform (#1486 render batch).
// Metro still resolves both: a static require string inside a getter is bundled.
export const GOOGLE_MAPS_LOGO = {
  get light(): number {
    return require("../assets/google-maps-logo-dark-gray.png") as number;
  },
  get dark(): number {
    return require("../assets/google-maps-logo-white.png") as number;
  },
};
export const GOOGLE_MAPS_LOGO_SIZE = { width: 98, height: 18 } as const;
/** The logo row's full height: 10 dp clear space above + 18 dp logo + 5 dp below. */
export const GOOGLE_MAPS_ATTRIBUTION_ROW_HEIGHT = 33;

export function PoweredByGoogle({ variant }: { variant: "light" | "dark" }): React.ReactElement {
  return (
    <View style={styles.attributionRow} testID="powered-by-google">
      <Image
        source={GOOGLE_MAPS_LOGO[variant]}
        style={GOOGLE_MAPS_LOGO_SIZE}
        resizeMode="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel="Google Maps"
        testID="google-maps-logo"
      />
    </View>
  );
}

export default AddressInput;
