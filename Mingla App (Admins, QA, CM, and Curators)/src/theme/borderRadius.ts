/**
 * Mingla Design System - Border Radius Tokens
 * Rounded corners for UI elements
 */

export const borderRadius = {
  none: '0',
  sm: '0.375rem',    // 6px
  base: '0.5rem',    // 8px
  md: '0.625rem',    // 10px
  lg: '0.75rem',     // 12px
  xl: '1rem',        // 16px
  '2xl': '1.25rem',  // 20px
  '3xl': '1.5rem',   // 24px
  full: '9999px',

  // Component specific
  card: '1rem',        // 16px
  button: '0.75rem',   // 12px
  input: '0.75rem',    // 12px
  modal: '1.25rem',    // 20px
  pill: '9999px',
} as const;

export type BorderRadiusToken = typeof borderRadius;
