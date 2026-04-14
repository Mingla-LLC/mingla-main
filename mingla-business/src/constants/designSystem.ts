/**
 * Shared tokens aligned with app-mobile for consistent Mingla branding.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

export const shadows = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
} as const;

export const fontWeights = {
  regular: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

export const colors = {
  primary: {
    50: "#fff7ed",
    100: "#ffedd5",
    200: "#fed7aa",
    300: "#fdba74",
    500: "#f97316",
    600: "#ea580c",
    700: "#c2410c",
  },
  gray: {
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    800: "#1f2937",
  },
  success: {
    500: "#22c55e",
    700: "#15803d",
  },
  error: {
    500: "#ef4444",
  },
  warning: {
    500: "#f59e0b",
  },
  background: {
    primary: "#ffffff",
    secondary: "#f9fafb",
    tertiary: "#f3f4f6",
  },
  text: {
    primary: "#111827",
    secondary: "#4b5563",
    tertiary: "#6b7280",
    inverse: "#ffffff",
  },
  accent: "#eb7825",
} as const;

/** Business-specific surface and border tokens */
export const surface = {
  card: "#ffffff",
  input: "#f9fafb",
  selected: "#fff7ed",
} as const;

export const border = {
  default: "#e5e7eb",
  focus: "#f97316",
  selected: "#fdba74",
} as const;

/** Welcome / auth gradient endpoint (warm off-white) */
export const backgroundWarmGlow = "#fff9f5" as const;
