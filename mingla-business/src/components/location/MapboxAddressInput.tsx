/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 4
 * META-ORCH-1060 [Mapbox consumer migration] · §3.2 — EXTRACTED to the shared
 * @mingla/location-input package.
 *
 * This file is now a THIN per-app wrapper that injects the BUSINESS design
 * tokens + business Icon + business supabase.functions.invoke + business copy
 * into the shared MapboxAddressInput field. The props the experience importers
 * (ExperienceStopCard, CreatorStep3Where) use are UNCHANGED — this is a drop-in.
 * Token values below reproduce the pre-extraction StyleSheet byte-for-byte so
 * the experience picker renders + geocodes identically (SC-7).
 *
 * Edit the shared package for behavior; edit ONLY the token bundle here for
 * business-specific look.
 */

import React, { useMemo } from "react";

import {
  MapboxAddressInput as SharedMapboxAddressInput,
  type LocationInputCopy,
  type LocationSelectionState,
  type LocationInputTokens,
  type PlaceDetails,
} from "@mingla/location-input";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon, type IconName } from "../ui/Icon";
import { supabase } from "../../services/supabase";

export type { PlaceDetails };

interface MapboxAddressInputProps {
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
}

// Business token bundle — reproduces the pre-extraction dark-glass StyleSheet.
const BUSINESS_TOKENS: LocationInputTokens = {
  field: {
    bg: glass.tint.profileBase,
    bgFocused: glass.tint.profileBase, // business field had no focus bg lift
    border: glass.border.profileBase,
    borderFocused: glass.border.profileBase, // business had a static border
    borderError: semantic.error,
    radius: radiusTokens.md,
    hasBorder: true,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    focusBorderWidth: 1, // business used borderWidth:1 in all states
  },
  text: {
    input: textTokens.primary,
    placeholder: textTokens.quaternary,
  },
  icon: {
    leading: textTokens.tertiary,
    clear: textTokens.tertiary,
  },
  spinner: accent.warm,
  dropdown: {
    mode: "card",
    bg: glass.tint.profileBase,
    border: glass.border.profileBase,
    radius: radiusTokens.md,
    maxHeight: 9999, // business dropdown was unbounded
    hasShadow: false,
  },
  row: {
    pressBg: accent.tint,
    textPrimary: textTokens.primary,
    textSecondary: textTokens.tertiary,
    divider: "transparent", // business rows had no divider
    style: "flat",
    primaryFontSize: typography.body.fontSize,
    primaryLineHeight: typography.body.lineHeight,
    primaryWeight: "400",
    secondaryFontSize: typography.caption.fontSize,
    secondaryLineHeight: typography.caption.lineHeight,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  status: {
    text: textTokens.tertiary,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  error: {
    text: semantic.error,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
  },
  // Issue #1363 (device-UX F2) — brand-accent treatment for the Tier-2 free-text
  // ACTION row so it reads as a tappable button (orange text + icon + a subtle
  // tinted, bordered pill), visually distinct from the muted suggestion/status
  // rows. Consumer bundles omit `action` → the shared field falls back to the
  // muted styling → byte-identical consumer render.
  action: {
    text: accent.warm, // #eb7825 brand action
    bg: accent.tint, // subtle warm pill fill
    border: accent.border, // warm pill border
  },
};

const BUSINESS_COPY: LocationInputCopy = {
  minLengthHint: "Type at least 3 characters to search.",
  searching: "Searching…",
  noResults: "No matches — try a broader search.",
  offline: "Couldn't reach search. Tap to try again.",
  pickError: "Couldn't fetch address details. Tap to try again.",
};

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

export const MapboxAddressInput: React.FC<MapboxAddressInputProps> = ({
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
}) => {
  const tokens = useMemo(() => BUSINESS_TOKENS, []);
  return (
    <SharedMapboxAddressInput
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
    />
  );
};

export default MapboxAddressInput;
