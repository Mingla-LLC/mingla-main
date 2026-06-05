/**
 * @mingla/location-input · token + injection types
 *
 * The shared MapboxAddressInput is theme-driven via an injected `tokens` bundle
 * + `IconComponent` + `invoke` (each app's supabase.functions.invoke). No
 * business OR consumer design-system import inside the package — every value is
 * injected. Per META-ORCH-1060 DESIGN §0/§1 (THE TOKEN RULE).
 */

import type React from "react";

/** Icon glyph names the field uses. Host maps these to its own Icon set. */
export type LocationInputIconName =
  | "search"
  | "location"
  | "location-outline"
  | "close"
  | "cloud-offline-outline";

/** Host-provided icon renderer (e.g. app-mobile/business <Icon name size color/>). */
export type LocationInputIcon = React.ComponentType<{
  name: string;
  size: number;
  color: string;
}>;

/**
 * Flat token bundle — every color/value the field renders. Zero magic numbers
 * in the component; the host injects a fully-resolved bundle. DESIGN §1.
 */
export interface LocationInputTokens {
  field: {
    bg: string;
    bgFocused: string;
    border: string;
    borderFocused: string;
    borderError: string;
    radius: number;
    /** Whether the field shows a 1px border by default (light) or none (dark). */
    hasBorder: boolean;
    paddingHorizontal: number;
    paddingVertical: number;
    /** Focus border width (DESIGN §5 — 1.5 for the warm focus ring). */
    focusBorderWidth: number;
  };
  text: {
    input: string;
    placeholder: string;
  };
  icon: {
    leading: string;
    clear: string;
  };
  spinner: string;
  dropdown: {
    /** "card" (light, white card below field) | "inline" (dark, rows on canvas). */
    mode: "card" | "inline";
    bg: string;
    border: string;
    radius: number;
    /** maxHeight for the card mode list; ignored for inline. */
    maxHeight: number;
    hasShadow: boolean;
  };
  row: {
    pressBg: string;
    textPrimary: string;
    textSecondary: string;
    divider: string;
    /** "flat" (City/Prefs) | "chip" (Onboarding richer row with icon chip). */
    style: "flat" | "chip";
    primaryFontSize: number;
    primaryLineHeight: number;
    primaryWeight: "400" | "500" | "600" | "700";
    secondaryFontSize: number;
    secondaryLineHeight: number;
    paddingVertical: number;
    paddingHorizontal: number;
  };
  status: {
    text: string;
    fontSize: number;
    lineHeight: number;
  };
  error: {
    text: string;
    fontSize: number;
    lineHeight: number;
  };
}

/** Field-state copy — host injects so consumer/business voice can differ. */
export interface LocationInputCopy {
  /** Hint shown when query is below minQueryLength (e.g. "Type a couple letters to search."). */
  minLengthHint: string;
  /** Shown while suggest is in flight (e.g. "Searching…"). */
  searching: string;
  /** Suggest returned 0 results (e.g. "No matches — try a broader search."). */
  noResults: string;
  /** Network error reaching suggest (e.g. "Couldn't reach search. Tap to try again."). */
  offline: string;
  /** retrieve threw (e.g. "Couldn't fetch that place. Tap to try again."). */
  pickError: string;
}
