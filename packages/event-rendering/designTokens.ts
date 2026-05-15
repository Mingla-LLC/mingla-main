// Design tokens duplicated from mingla-business/src/constants/designSystem.ts
// for the subset that PublicEventPage rendering uses.
//
// Inline-defined; the package does NOT import from either app per the
// I-MOR-0827-PACKAGE-ISOLATION rule. Tokens are stable and worth
// duplicating for the package boundary.
//
// If mingla-business design tokens change in a way that affects rendering,
// update both this file AND the source. A future @mingla/design-tokens
// package could consolidate, but not in scope for Pass 2.

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
} as const;

export const text = {
  primary: "#ffffff",
  secondary: "rgba(255, 255, 255, 0.72)",
  tertiary: "rgba(255, 255, 255, 0.48)",
  quaternary: "rgba(255, 255, 255, 0.32)",
  inverse: "#0c0e12",
} as const;

export const accent = {
  warm: "#ff8a3b",
  tint: "rgba(255, 138, 59, 0.16)",
  border: "rgba(255, 138, 59, 0.32)",
} as const;

export const glass = {
  tint: {
    profileBase: "rgba(255, 255, 255, 0.06)",
  },
  border: {
    profileBase: "rgba(255, 255, 255, 0.10)",
  },
} as const;

export const semantic = {
  error: "#ef4444",
  errorTint: "rgba(239, 68, 68, 0.16)",
  warningTint: "rgba(245, 158, 11, 0.16)",
  infoTint: "rgba(59, 130, 246, 0.16)",
} as const;

export const typography = {
  caption: {
    fontSize: 11,
    lineHeight: 14,
  },
  bodySm: {
    fontSize: 13,
    lineHeight: 18,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
} as const;

export const backgroundColor = "#0c0e12";
