/**
 * Mingla Design System - Theme Index
 * Central export for all design tokens
 */

export { colors } from './colors';
export { typography } from './typography';
export { spacing, screenPadding, componentSpacing } from './spacing';
export { shadows } from './shadows';
export { borderRadius } from './borderRadius';

export const theme = {
  colors: require('./colors').colors,
  typography: require('./typography').typography,
  spacing: require('./spacing').spacing,
  shadows: require('./shadows').shadows,
  borderRadius: require('./borderRadius').borderRadius,
} as const;

export default theme;
