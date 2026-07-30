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
  autocompleteMapbox,
  autocompletePlacesMapbox,
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
import {
  computeShowFreeTextRow,
  resolveFreeTextRowStyle,
} from "./assistFooter";

const AUTOCOMPLETE_DEBOUNCE_MS = 250;

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
}): number {
  const { keyboardScreenY, cardTopY, tokenMaxHeight, isIOS } = params;
  if (!Number.isFinite(keyboardScreenY) || cardTopY === null) {
    return tokenMaxHeight;
  }
  const accessory = isIOS ? DROPDOWN_KEYBOARD_ACCESSORY_ALLOWANCE : 0;
  const availableBelow =
    keyboardScreenY - cardTopY - DROPDOWN_SAFETY_MARGIN - accessory;
  return Math.max(MIN_DROPDOWN_HEIGHT, Math.min(tokenMaxHeight, availableBelow));
}

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

  // ── ORCH-1361 [location-suggestions] · OPTIONAL Mapbox rank bias (ADDITIVE) ─
  // Threaded to the suggest call so results RANK to the user's area instead of
  // the edge datacenter IP. All optional — when every one is absent the request
  // is byte-identical to the pre-1361 behavior (business pickers + CityPicker
  // callers that pass none are unchanged). NO types/country FILTER — the suggest
  // handler must stay filter-free so business venue-name search returns POIs
  // (INV-3 / ORCH-1079); proximity biases ranking without excluding results.
  // Doc format: proximity "longitude,latitude"; limit ≤ 10.
  /** User-proximity rank bias "longitude,latitude" (Mapbox order). */
  proximity?: string;
  /** suggest `limit` override (≤10). Default (omitted) → edge default 5. */
  suggestLimit?: number;

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
  searchMode = "venue",
  ScrollComponent,
  haptics,
  autoFocus = false,
  proximity,
  suggestLimit,
  allowFreeText = false,
  onFreeText,
  selectionState = "editing",
  selectedLabel = null,
  onChangeSelected,
}) => {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [focused, setFocused] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingSelectedLabel, setPendingSelectedLabel] = useState<string | null>(
    null,
  );
  const [focusRevision, setFocusRevision] = useState(0);
  // Issue #1363 — set true right after a successful pick, reset on the next
  // keystroke. Used ONLY to hide the Tier-2 free-text row immediately after a
  // pick (so the picked address doesn't re-offer "Use '<address>'").
  const justPicked = useRef<boolean>(false);
  // One Mapbox session token per typing session; reused across suggest→retrieve.
  const sessionToken = useRef<string>(newMapboxSessionToken());

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

  const handleChangeText = useCallback(
    (next: string): void => {
      // Issue #1363 — any keystroke means the value is no longer a just-picked
      // address, so the Tier-2 free-text row may show again.
      justPicked.current = false;
      onChangeText(next);
      clearDebounceTimer();
      if (next.trim().length < minQueryLength) {
        setStatus({ kind: "idle" });
        return;
      }
      setStatus({ kind: "loading_suggestions" });
      debounceTimer.current = setTimeout(async (): Promise<void> => {
        try {
          // ORCH-1365 — route by searchMode. "places" (consumer) → the edge
          // `suggest_places` action (place-type filter + trailing-country strip +
          // country bias, POIs dropped). "venue" (business, DEFAULT) → the
          // filter-free `suggest` action, BYTE-IDENTICAL to pre-1365
          // (INV-3 / ORCH-1079). ORCH-1361 — the optional proximity/limit bias is
          // merged only when present → byte-identical request when omitted.
          const results =
            searchMode === "places"
              ? await autocompletePlacesMapbox(
                  next,
                  sessionToken.current,
                  { invoke },
                  { proximity, limit: suggestLimit },
                )
              : await autocompleteMapbox(
                  next,
                  sessionToken.current,
                  { invoke },
                  { proximity, limit: suggestLimit },
                );
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
    [announce, clearDebounceTimer, copy.noResults, copy.offline, invoke, minQueryLength, onChangeText, proximity, searchMode, suggestLimit],
  );

  const handlePickSuggestion = useCallback(
    async (s: PlaceAutocompleteSuggestion): Promise<void> => {
      clearDebounceTimer();
      fireHaptic("selection");
      const label =
        s.fullAddress.trim().length > 0 ? s.fullAddress : s.displayName;
      setPendingSelectedLabel(label);
      setStatus({ kind: "fetching_details" });
      try {
        const details = await retrieveMapboxPlace(s.placeId, sessionToken.current, {
          invoke,
        });
        onPick(details, label);
        // Issue #1363 — a completed pick hides the Tier-2 free-text row until
        // the next keystroke.
        justPicked.current = true;
        setStatus({ kind: "idle" });
        setPendingSelectedLabel(null);
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

  const handleChangeSelected = useCallback((): void => {
    clearDebounceTimer();
    setPendingSelectedLabel(null);
    setStatus({ kind: "idle" });
    onChangeSelected?.();
    setFocusRevision((current) => current + 1);
  }, [clearDebounceTimer, onChangeSelected]);

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

  // Single-row status blocks (loading / no-results / offline). ORCH-1365 — kept
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
    </>
  );

  const rowsOpen = status.kind === "suggestions_open" ? status.results : null;

  // Inline mode content — UNCHANGED (rows flow directly on the host canvas, no
  // scroll wrapper; the dark CityPicker sheet already scrolls its own body).
  const inlineContent = (
    <>
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
  const dropdownMaxHeight = computeDropdownMaxHeight({
    keyboardScreenY,
    cardTopY,
    tokenMaxHeight: tokens.dropdown.maxHeight,
    isIOS: Platform.OS === "ios",
  });

  const wrappedList =
    tokens.dropdown.mode === "card" ? (
      status.kind === "suggestions_open" ||
      status.kind === "loading_suggestions" ||
      status.kind === "no_results" ||
      status.kind === "offline" ? (
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
  cardShadow: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
});

export default MapboxAddressInput;
