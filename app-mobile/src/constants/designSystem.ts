// Design System Constants for Mingla App
// Phase 1: Foundation & Core Polish

import { vs, ms } from '../utils/responsive';

export const spacing = {
  xxs: 2,   // 2px — ultra-compact message grouping
  xs: 4,    // 4px
  sm: 8,    // 8px
  md: 16,   // 16px
  lg: 24,   // 24px
  xl: 32,   // 32px
  xxl: 48,  // 48px
} as const;

export const radius = {
  sm: 8,    // 8px
  md: 12,   // 12px
  lg: 16,   // 16px
  xl: 24,   // 24px
  full: 999, // Full rounded
} as const;

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: 8,
  },
  xl: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.1,
    shadowRadius: 25,
    elevation: 12,
  },
} as const;

export const typography = {
  xs: {
    fontSize: 12,
    lineHeight: 16,
  },
  sm: {
    fontSize: 14,
    lineHeight: 20,
  },
  md: {
    fontSize: 16,
    lineHeight: 24,
  },
  lg: {
    fontSize: 18,
    lineHeight: 28,
  },
  xl: {
    fontSize: 20,
    lineHeight: 32,
  },
  xxl: {
    fontSize: 24,
    lineHeight: 36,
  },
  xxxl: {
    fontSize: 32,
    lineHeight: 48,
  },
} as const;

export const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
} as const;

export const colors = {
  // Primary Brand Colors - Orange Theme
  primary: {
    50: '#fff7ed',
    100: '#ffedd5',
    200: '#fed7aa',
    300: '#fdba74',
    400: '#fb923c',
    500: '#f97316',
    600: '#ea580c',
    700: '#c2410c',
    800: '#9a3412',
    900: '#7c2d12',
  },
  
  // Orange Accent Colors
  orange: {
    50: '#fff7ed',
    100: '#ffedd5',
    200: '#fed7aa',
    300: '#fdba74',
    400: '#fb923c',
    500: '#f97316',
    600: '#ea580c',
    700: '#c2410c',
    800: '#9a3412',
    900: '#7c2d12',
  },
  
  // Semantic Colors
  success: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d',
  },
  
  warning: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
  },
  
  error: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
    900: '#7f1d1d',
  },
  
  // Neutral Colors
  gray: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },
  
  // Background Colors
  background: {
    primary: '#ffffff',
    secondary: '#f9fafb',
    tertiary: '#f3f4f6',
  },
  
  // Text Colors
  text: {
    primary: '#111827',
    secondary: '#4b5563',
    tertiary: '#6b7280',
    inverse: '#ffffff',
  },

  // Accent — the warm orange used for selected pills, CTAs, and active states.
  // Intentionally different from primary[500] (#f97316).
  accent: '#eb7825',

  // Chat semantic aliases (no new color values — references to existing tokens)
  chat: {
    bubbleSent: '#f97316',     // primary[500]
    bubbleReceived: '#f3f4f6', // gray[100]
    timestampPill: '#f9fafb',  // gray[50]
  },
} as const;

export const animations = {
  // Duration in milliseconds
  duration: {
    fast: 150,
    normal: 300,
    slow: 500,
  },
  
  // Easing curves
  easing: {
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
  },
} as const;

// Touch target minimum size for accessibility
export const touchTargets = {
  minimum: 44, // 44px minimum touch target
  comfortable: 48, // 48px comfortable touch target
  large: 56, // 56px large touch target
} as const;

// Welcome screen background warm glow (subtle warm gradient endpoint)
export const backgroundWarmGlow = '#fff9f5' as const;

// Tagline typography (between md and lg — for secondary headlines)
export const taglineTypography = {
  fontSize: 17,
  lineHeight: 26,
} as const;

// Responsive spacing — same scale, proportionally adapted
export const responsiveSpacing = {
  xxs: vs(2),
  xs: vs(4),
  sm: vs(8),
  md: vs(16),
  lg: vs(24),
  xl: vs(32),
  xxl: vs(48),
} as const;

// Responsive typography — font sizes scale gently
export const responsiveTypography = {
  xs: { fontSize: ms(12), lineHeight: ms(16) },
  sm: { fontSize: ms(14), lineHeight: ms(20) },
  md: { fontSize: ms(16), lineHeight: ms(24) },
  lg: { fontSize: ms(18), lineHeight: ms(28) },
  xl: { fontSize: ms(20), lineHeight: ms(32) },
  xxl: { fontSize: ms(24), lineHeight: ms(36) },
  xxxl: { fontSize: ms(32), lineHeight: ms(48) },
} as const;

// Glassmorphism tokens (scoped to onboarding)
export const glass = {
  surface: {
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
    borderColor: 'rgba(255, 255, 255, 0.35)',
    borderWidth: 1,
    borderRadius: radius.xl,
  },
  surfaceElevated: {
    backgroundColor: 'rgba(255, 255, 255, 0.70)',
    borderColor: 'rgba(255, 255, 255, 0.45)',
    borderWidth: 1,
    borderTopWidth: 0.5,
  },
  buttonPrimary: {
    backgroundColor: colors.primary[500],
    borderRadius: radius.lg,
    height: 56,
  },
  buttonSecondary: {
    backgroundColor: 'rgba(255, 255, 255, 0.40)',
    borderColor: 'rgba(255, 255, 255, 0.50)',
    borderWidth: 1.5,
    borderRadius: radius.lg,
  },
  blurIntensity: 40,
  blurTint: 'light' as const,
  shadow: {
    shadowColor: 'rgba(0, 0, 0, 0.08)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 6,
  },

  blur: {
    card: 30,
    header: 40,
    banner: 50,
    match: 60,
    dropdown: 35,
  },

  shadowLight: {
    shadowColor: 'rgba(0, 0, 0, 0.06)',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 4,
  },
} as const;

// Export commonly used combinations
export const commonStyles = {
  // Card styles
  card: {
    backgroundColor: colors.background.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.md,
  },
  
  // Button styles
  button: {
    minHeight: touchTargets.comfortable,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  
  // Input styles
  input: {
    minHeight: touchTargets.comfortable,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gray[300],
    backgroundColor: colors.background.primary,
  },
  
  // Text styles
  heading: {
    ...typography.xl,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  
  subheading: {
    ...typography.lg,
    fontWeight: fontWeights.medium,
    color: colors.text.primary,
  },
  
  body: {
    ...typography.md,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
  },
  
  caption: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
  },
} as const;
