/**
 * Mingla Design System - Shadow Tokens
 * Box shadows for depth and elevation
 */

export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  base: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  '2xl': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.06)',

  // Brand specific shadows
  brand: {
    sm: '0 2px 8px rgba(235, 120, 37, 0.15)',
    md: '0 4px 16px rgba(235, 120, 37, 0.2)',
    lg: '0 8px 32px rgba(235, 120, 37, 0.25)',
  },

  // Card shadows
  card: {
    rest: '0 2px 8px rgba(0, 0, 0, 0.08)',
    hover: '0 8px 24px rgba(0, 0, 0, 0.12)',
    active: '0 4px 12px rgba(0, 0, 0, 0.1)',
  },

  // Modal shadows
  modal: '0 20px 60px rgba(0, 0, 0, 0.3)',

  // Navigation shadows
  navigation: '0 -2px 10px rgba(0, 0, 0, 0.05)',
} as const;

export type ShadowToken = typeof shadows;
