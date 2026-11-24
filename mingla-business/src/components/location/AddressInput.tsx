/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 4
 * META-ORCH-1060 §3.2 — EXTRACTED to the shared @mingla/location-input
 * package. Google Maps Platform behind the proxy since #4334.
 *
 * This file is now a THIN per-app wrapper that injects the BUSINESS design
 * tokens + business Icon + business supabase.functions.invoke + business copy
 * into the shared AddressInput field. The props the experience importers
 * (ExperienceStopCard, CreatorStep3Where) use are UNCHANGED — this is a drop-in.
 * Token values below reproduce the pre-extraction StyleSheet byte-for-byte so
 * the experience picker renders + geocodes identically (SC-7).
 *
 * Edit the shared package for behavior; edit ONLY the token bundle here for
 * business-specific look.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

import type {
  LocationInputCopy,
  LocationSelectionState,
  LocationInputTokens,
  PlaceDetails,
} from "@mingla/location-input";
// #4334 — value imports come from their own files, never the package index:
// the index re-exports the field, which on web loads from its own chunk
// (sharedAddressField.web.tsx) to keep the Host boot payload small.
import { createThrottledReporter } from "@mingla/location-input/src/placesService";
import { SharedAddressInput } from "./sharedAddressField";

import {
  radius as radiusTokens,
  color as dsColor,
  size as sizeTokens,
  space,
  type,
} from "../../constants/designSystem";
import { Icon, type IconName } from "../ui/Icon";
import { supabase } from "../../services/supabase";
import type {
  HostAddressProximitySources,
  ProximityMemory,
} from "../../utils/addressSearchProximity";

export type { PlaceDetails };

interface AddressInputProps {
  value: string;
  onChangeText: (next: string) => void;
  onPick: (details: PlaceDetails, selectedLabel?: string) => void;
  onClear: () => void;
  error?: string;
  placeholder?: string;
  accessibilityLabel?: string;
  // Issue #1363 — business-only selected-address mode. All default-off.
  allowFreeText?: boolean;
  onFreeText?: (text: string) => void;
  selectionState?: LocationSelectionState;
  selectedLabel?: string | null;
  onChangeSelected?: () => void;
  /**
   * Issue #3291 — where to RANK suggestions from: brand point → a point
   * already picked on the draft → the draft's time zone. Rank-only; the
   * request never gains a types/country filter (INV-3 / ORCH-1079).
   */
  proximitySources?: HostAddressProximitySources;
  /**
   * Issue #3291 — an already-resolved proximity "longitude,latitude", for a
   * host that resolves once for many fields (experience stops keep their memo
   * by passing a string). Wins over `proximitySources`.
   */
  proximity?: string;
}

// ── Issue #3291 — rank-only proximity, resolved lazily ─────────────────────
// This wrapper ships in the eager `__common` web chunk (every Host screen
// shares it), so it holds NO proximity logic and NO data: the resolver and its
// time-zone table load through the dynamic `import()` below into their own
// async chunk (ORCH-1083). Until that resolves the field sends no proximity —
// only ranking is affected, and only for the first moments after mount
// (search waits for three letters plus a 250 ms debounce). A failed load is
// warned and retried by the next mount; the pick itself is never affected.
type ProximityResolver = typeof import("../../utils/addressSearchProximity");
let proximityResolver: ProximityResolver | undefined;

export const useAddressSearchProximity = (
  sources: HostAddressProximitySources | undefined,
): string | undefined => {
  const memory = useRef<ProximityMemory>({ lastDraftPoint: null }).current;
  const [, setLoaded] = useState(proximityResolver);
  const wanted = sources !== undefined;
  useEffect((): void => {
    if (!wanted || proximityResolver !== undefined) return;
    import("../../utils/addressSearchProximity").then(
      (module) => setLoaded((proximityResolver = module)),
      (error: unknown) =>
        console.warn("[AddressInput] proximity resolver load failed:", error),
    );
  }, [wanted]);
  return sources === undefined
    ? undefined
    : proximityResolver?.resolveHostAddressProximity(memory, sources);
};

// ── #4334 (Seth decision D4) — at most 5 suggestions ──────────────────────
// Google returns at most 5 rows, so the Host's 10-row request (#3827) is gone.
// Ranking now comes from the proximity bias, not from row count.

// The Host list has no height bound of its own (only the keyboard-aware cap on
// native). This bounds it to about five and a half rows; on native the
// keyboard-aware cap still shrinks it further when the keyboard is up.
export const HOST_ADDRESS_DROPDOWN_MAX_HEIGHT = 320;

// Business token bundle — reproduces the pre-extraction dark-glass StyleSheet.
const BUSINESS_TOKENS: LocationInputTokens = {
  // #4334 (D5) — the Host field is dark glass: the on-dark attribution.
  attribution: { variant: "dark" },
  field: {
    bg: dsColor.fill.inset,
    bgFocused: dsColor.fill.inset, // business field had no focus bg lift
    border: dsColor.line,
    borderFocused: dsColor.line, // business had a static border
    borderError: dsColor.danger,
    radius: radiusTokens.md,
    hasBorder: true,
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    focusBorderWidth: 1, // business used borderWidth:1 in all states
    // #4420 (native run): same height as every other Host input (48), not
    // padding-derived (~38pt beside a 48pt title field on the trip form).
    minHeight: sizeTokens.input,
  },
  text: {
    input: dsColor.text1,
    placeholder: dsColor.text4,
  },
  icon: {
    leading: dsColor.text3,
    clear: dsColor.text3,
  },
  spinner: dsColor.accent,
  dropdown: {
    mode: "card",
    bg: dsColor.fill.inset,
    border: dsColor.line,
    radius: radiusTokens.md,
    maxHeight: HOST_ADDRESS_DROPDOWN_MAX_HEIGHT,
    hasShadow: false,
  },
  row: {
    pressBg: dsColor.accentLine,
    textPrimary: dsColor.text1,
    textSecondary: dsColor.text3,
    divider: "transparent", // business rows had no divider
    style: "flat",
    primaryFontSize: type.body.fontSize,
    primaryLineHeight: type.body.lineHeight,
    primaryWeight: "400",
    secondaryFontSize: type.caption.fontSize,
    secondaryLineHeight: type.caption.lineHeight,
    paddingVertical: space[2],
    paddingHorizontal: space[4],
  },
  status: {
    text: dsColor.text3,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
  },
  error: {
    text: dsColor.danger,
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
  },
  // Issue #1363 (device-UX F2) — brand-accent treatment for the Tier-2 free-text
  // ACTION row so it reads as a tappable button (orange text + icon + a subtle
  // tinted, bordered pill), visually distinct from the muted suggestion/status
  // rows. Consumer bundles omit `action` → the shared field falls back to the
  // muted styling → byte-identical consumer render.
  // #4490 N15 (orange on an orange-brown fill read poorly) is met by #4522
  // W-11's readable accent text on the lighter warm tint (merge of main).
  action: {
    text: dsColor.accentText, // readable brand orange on dark (#4522 W-11); the pill keeps the warm tint
    bg: dsColor.accentTint, // subtle warm pill fill, light enough for the text on it to read
    border: dsColor.accentLine, // warm pill border
  },
};

const BUSINESS_COPY: LocationInputCopy = {
  minLengthHint: "Type at least 3 characters to search.",
  searching: "Searching…",
  noResults: "No matches — try a broader search.",
  // #4334 — search itself is down (never "No matches").
  unavailable: "Address search isn't working right now. Tap to try again.",
  pickError: "Couldn't fetch address details. Tap to try again.",
};

type ReportNonFatalModule = typeof import("../../diagnostics/reportNonFatal");

// #4334 — throttled Sentry report when address search is unavailable.
// Lazy require (same pattern as copyAddressText / sharePublicUrl): the reporter
// pulls in the Sentry SDK, which must not join this field's module-scope import
// graph — every screen with an address field (and its render suites) loads it,
// and some web/Jest environments cannot parse the SDK's ESM entry.
const reportSearchUnavailable = createThrottledReporter((code: string) => {
  const { reportNonFatal } =
    require("../../diagnostics/reportNonFatal") as ReportNonFatalModule;
  reportNonFatal("address_search", new Error(`address_search_unavailable:${code}`), { code });
});

const invoke = (fn: string, options: { body: Record<string, unknown> }) =>
  supabase.functions.invoke(fn, options);

const LocationInputIcon: React.FC<{
  name: string;
  size: number;
  color: string;
}> = ({ name, size, color }) => {
  const mappedName: IconName =
    name === "location-outline"
      ? "location"
      : name === "cloud-offline-outline"
        ? "refund"
        : (name as IconName);
  return <Icon name={mappedName} size={size} color={color} />;
};

export const AddressInput: React.FC<AddressInputProps> = ({
  value,
  onChangeText,
  onPick,
  onClear,
  error,
  placeholder = "Pick a place",
  accessibilityLabel = "Address",
  allowFreeText,
  onFreeText,
  selectionState,
  selectedLabel,
  onChangeSelected,
  proximitySources,
  proximity,
}) => {
  const tokens = useMemo(() => BUSINESS_TOKENS, []);
  const resolvedProximity = useAddressSearchProximity(proximitySources);
  return (
    <SharedAddressInput
      value={value}
      onChangeText={onChangeText}
      onPick={onPick}
      onClear={onClear}
      error={error}
      placeholder={placeholder}
      accessibilityLabel={accessibilityLabel}
      tokens={tokens}
      IconComponent={LocationInputIcon}
      invoke={invoke}
      copy={BUSINESS_COPY}
      minQueryLength={3}
      leadingIcon="location"
      allowFreeText={allowFreeText}
      onFreeText={onFreeText}
      selectionState={selectionState}
      selectedLabel={selectedLabel}
      onChangeSelected={onChangeSelected}
      proximity={proximity ?? resolvedProximity}
      onSearchUnavailable={reportSearchUnavailable}
    />
  );
};

export default AddressInput;
