/**
 * Minimal design tokens for @mingla/phone-input.
 *
 * Values mirror the corresponding entries in
 * `app-mobile/src/constants/designSystem.ts` exactly so the consumer
 * onboarding UX is visually unchanged after Phase A extraction.
 *
 * Per ORCH-0847 Phase A — tokens inlined to keep the package
 * self-contained (no cross-package design-system dependency).
 */

import type { TextStyle, ViewStyle } from "react-native";

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
} as const;

export const radius = {
  sm: 8,
  md: 12,
} as const;

export const typography = {
  sm: { fontSize: 14, lineHeight: 20 } as TextStyle,
  md: { fontSize: 16, lineHeight: 24 } as TextStyle,
  lg: { fontSize: 18, lineHeight: 28 } as TextStyle,
} as const;

export const fontWeights = {
  regular: "400" as TextStyle["fontWeight"],
  medium: "500" as TextStyle["fontWeight"],
  semibold: "600" as TextStyle["fontWeight"],
} as const;

export const colors = {
  primary500: "#f97316",
  error500: "#ef4444",
  gray100: "#f3f4f6",
  gray200: "#e5e7eb",
  gray300: "#d1d5db",
  gray400: "#9ca3af",
  backgroundPrimary: "#ffffff",
  textPrimary: "#111827",
  textTertiary: "#6b7280",
} as const;

export const shadowSm: ViewStyle = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.1,
  shadowRadius: 3,
  elevation: 2,
};

export const touchTargets = {
  minimum: 44,
  comfortable: 48,
} as const;

/**
 * Resolved theme used internally. ORCH-0847 Phase B — defaults match the
 * pre-Phase-B app-mobile onboarding visual (LIGHT mode, primary orange).
 * Hosts can override via the `theme` prop on `<PhoneInput>` and
 * `<CountryPickerModal>`. Mingla-business buyer.tsx ships a DARK-mode
 * theme to keep the public buyer form readable on the dark canvas.
 */
import type { PhoneInputTheme } from "./types";

export const DEFAULT_PHONE_INPUT_THEME: Required<PhoneInputTheme> = {
  backgroundPrimary: colors.backgroundPrimary,
  textPrimary: colors.textPrimary,
  textTertiary: colors.textTertiary,
  borderDefault: colors.gray300,
  borderFocused: colors.primary500,
  borderError: colors.error500,
  searchBackground: colors.gray100,
  rowPressedBackground: colors.gray100,
  divider: colors.gray200,
  accessoryBackground: colors.gray100,
  accessoryBorder: colors.gray300,
  accent: colors.primary500,
  errorText: colors.error500,
};
