/**
 * Consumer MapboxAddressInput wrapper — META-ORCH-1060 [Mapbox consumer
 * migration] §3.2 / DESIGN §0–§6.
 *
 * Thin per-app wrapper that injects CONSUMER design tokens (light/dark variant)
 * + the consumer Icon + the consumer supabase.functions.invoke + consumer copy
 * + expo-haptics + the gorhom BottomSheetTextInput into the shared
 * @mingla/location-input field. The shared field owns the suggest→retrieve state
 * machine, debounce, all states, and a11y; this wrapper owns ONLY the consumer
 * look (two variants because the three consumer hosts split across a light glass
 * canvas (Preferences/Onboarding) and a dark canvas (CityPicker)).
 *
 * THE TOKEN RULE (DESIGN §0): business tokens MUST NOT leak here; consumer
 * tokens MUST NOT leak into business — each app injects its own bundle.
 *
 * Contrast fix (DESIGN §5, LOCKED): consumer placeholder = colors.gray[500]
 * (#6b7280, 5.0:1) instead of the failing #9ca3af.
 */

import React, { useMemo } from "react";

import {
  MapboxAddressInput as SharedMapboxAddressInput,
  type LocationInputCopy,
  type LocationInputTokens,
  type PlaceDetails,
} from "@mingla/location-input";
import * as Haptics from "expo-haptics";

import { colors, radius } from "../../constants/designSystem";
import { Icon } from "../ui/Icon";
import { BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { supabase } from "../../services/supabase";

export type { PlaceDetails };

export type LocationInputVariant = "light" | "dark";

interface ConsumerMapboxAddressInputProps {
  value: string;
  onChangeText: (next: string) => void;
  onPick: (details: PlaceDetails) => void;
  onClear: () => void;
  error?: string;
  placeholder?: string;
  accessibilityLabel?: string;
  variant: LocationInputVariant;
  /** Minimum chars before suggest fires. City=2, Preferences=4, Onboarding=3. */
  minQueryLength?: number;
  /** Leading glyph (DESIGN §4): "search" (City) | "location" (Prefs/Onboarding). */
  leadingIcon?: string;
  autoFocus?: boolean;
}

const invoke = (fn: string, options: { body: Record<string, unknown> }) =>
  supabase.functions.invoke(fn, options);

// DESIGN §6 — Mingla-voice consumer copy.
const CONSUMER_COPY: LocationInputCopy = {
  minLengthHint: "Type a couple letters to search.",
  searching: "Searching…",
  noResults: "No matches — try a broader search.",
  offline: "Couldn't reach search. Tap to try again.",
  pickError: "Couldn't fetch that place. Tap to try again.",
};

// DESIGN §1.1 — light variant (Preferences + Onboarding).
const LIGHT_TOKENS: LocationInputTokens = {
  field: {
    bg: "#ffffff",
    bgFocused: "#ffffff",
    border: colors.gray[200],
    borderFocused: colors.accent,
    borderError: colors.error[500],
    radius: radius.lg,
    hasBorder: true,
    paddingHorizontal: 16,
    paddingVertical: 14,
    focusBorderWidth: 1.5,
  },
  text: {
    input: colors.text.primary,
    placeholder: colors.gray[500], // LOCKED contrast fix (5.0:1)
  },
  icon: {
    leading: colors.gray[500],
    clear: colors.gray[500],
  },
  spinner: colors.accent,
  dropdown: {
    mode: "card",
    bg: "#ffffff",
    border: colors.gray[200],
    radius: radius.md,
    maxHeight: 280,
    hasShadow: true,
  },
  row: {
    pressBg: colors.primary[50],
    textPrimary: colors.text.primary,
    textSecondary: colors.text.tertiary,
    divider: colors.gray[100],
    style: "flat",
    primaryFontSize: 16,
    primaryLineHeight: 24,
    primaryWeight: "600",
    secondaryFontSize: 14,
    secondaryLineHeight: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  status: {
    text: colors.text.tertiary,
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    text: colors.error[600],
    fontSize: 14,
    lineHeight: 20,
  },
};

// DESIGN §1.2 — dark variant (CityPickerSheet).
const DARK_TOKENS: LocationInputTokens = {
  field: {
    bg: "rgba(255,255,255,0.08)",
    bgFocused: "rgba(255,255,255,0.12)",
    border: "transparent",
    borderFocused: colors.accent,
    borderError: "#ff6b6b",
    radius: 12,
    hasBorder: false,
    paddingHorizontal: 14,
    paddingVertical: 14,
    focusBorderWidth: 1.5,
  },
  text: {
    input: "rgba(255,255,255,0.95)",
    placeholder: "rgba(255,255,255,0.4)",
  },
  icon: {
    leading: "rgba(255,255,255,0.5)",
    clear: "rgba(255,255,255,0.55)",
  },
  spinner: "#eb7825", // glass.chrome.active.glowColor (warm)
  dropdown: {
    mode: "inline",
    bg: "transparent",
    border: "transparent",
    radius: 0,
    maxHeight: 9999,
    hasShadow: false,
  },
  row: {
    pressBg: "rgba(255,255,255,0.06)",
    textPrimary: "rgba(255,255,255,0.95)",
    textSecondary: "rgba(255,255,255,0.5)",
    divider: "rgba(255,255,255,0.08)",
    style: "flat",
    primaryFontSize: 15,
    primaryLineHeight: 20,
    primaryWeight: "500",
    secondaryFontSize: 12,
    secondaryLineHeight: 16,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  status: {
    text: "rgba(255,255,255,0.55)",
    fontSize: 14,
    lineHeight: 20,
  },
  error: {
    text: "#ff8a8a",
    fontSize: 14,
    lineHeight: 20,
  },
};

export const MapboxAddressInput: React.FC<ConsumerMapboxAddressInputProps> = ({
  value,
  onChangeText,
  onPick,
  onClear,
  error,
  placeholder = "Search for a place",
  accessibilityLabel = "Search location",
  variant,
  minQueryLength = 3,
  leadingIcon,
  autoFocus = false,
}) => {
  const tokens = useMemo(
    () => (variant === "dark" ? DARK_TOKENS : LIGHT_TOKENS),
    [variant],
  );
  const resolvedLeadingIcon =
    leadingIcon ?? (variant === "dark" ? "search" : "location");

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
      IconComponent={Icon}
      invoke={invoke}
      copy={CONSUMER_COPY}
      minQueryLength={minQueryLength}
      leadingIcon={resolvedLeadingIcon}
      TextInputComponent={BottomSheetTextInput}
      haptics={Haptics}
      autoFocus={autoFocus}
    />
  );
};

export default MapboxAddressInput;
