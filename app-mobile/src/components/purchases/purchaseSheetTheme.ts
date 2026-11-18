/**
 * #4473 — the dark sheet the Purchases surfaces share (the add sheet and the
 * Send to a friend sheet), matching the dark "Missing a ticket?" screen.
 *
 * Passed to BaseBottomSheet as `theme="dark"` plus these background and handle
 * overrides; the primitive's own dark default is untouched for every other
 * consumer.
 */
import type { ViewStyle } from "react-native";
import type { PhoneInputTheme } from "@mingla/phone-input";

export const PURCHASE_SHEET_COLORS = {
  sheet: "#15181e",
  screen: "#0b0d11",
  field: "#0b0d11",
  card: "#171a20",
  tabSelected: "#2a2e37",
  border: "rgba(255,255,255,0.10)",
  borderStrong: "rgba(255,255,255,0.16)",
  text: "#ffffff",
  textSecondary: "rgba(255,255,255,0.68)",
  textLabel: "rgba(255,255,255,0.72)",
  textMeta: "rgba(255,255,255,0.56)",
  textTab: "rgba(255,255,255,0.62)",
  placeholder: "rgba(255,255,255,0.40)",
  accent: "#eb7825",
  accentTint: "#2b1d15",
  error: "#f87171",
  success: "#52d78f",
  successTint: "rgba(82,215,143,0.16)",
  infoFill: "rgba(59,130,246,0.12)",
  infoBorder: "rgba(59,130,246,0.28)",
  infoIcon: "#93c5fd",
  infoText: "#dbeafe",
} as const;

export const PURCHASE_SHEET_BACKGROUND: ViewStyle = {
  backgroundColor: PURCHASE_SHEET_COLORS.sheet,
  borderTopLeftRadius: 26,
  borderTopRightRadius: 26,
  borderTopWidth: 1,
  borderTopColor: PURCHASE_SHEET_COLORS.border,
};

export const PURCHASE_SHEET_HANDLE: ViewStyle = {
  backgroundColor: "rgba(255,255,255,0.26)",
  width: 40,
  height: 5,
  borderRadius: 3,
};

export const PURCHASE_SHEET_PHONE_THEME: PhoneInputTheme = {
  backgroundPrimary: PURCHASE_SHEET_COLORS.sheet,
  fieldBackground: PURCHASE_SHEET_COLORS.field,
  textPrimary: PURCHASE_SHEET_COLORS.text,
  textTertiary: PURCHASE_SHEET_COLORS.placeholder,
  borderDefault: PURCHASE_SHEET_COLORS.borderStrong,
  borderFocused: PURCHASE_SHEET_COLORS.accent,
  borderError: PURCHASE_SHEET_COLORS.error,
  searchBackground: "rgba(255,255,255,0.06)",
  rowPressedBackground: "rgba(255,255,255,0.04)",
  divider: "rgba(255,255,255,0.08)",
  accessoryBackground: PURCHASE_SHEET_COLORS.sheet,
  accessoryBorder: "rgba(255,255,255,0.08)",
  accent: PURCHASE_SHEET_COLORS.accent,
  errorText: PURCHASE_SHEET_COLORS.error,
};
