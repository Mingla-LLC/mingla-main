/**
 * Mingla Design System - Color Tokens
 * Central color palette for the entire application
 */

export const colors = {
  // Mingla Brand Colors
  brand: {
    primary: '#eb7825',
    secondary: '#d6691f',
    white: '#ffffff',
    black: '#000000',
  },

  // Semantic Colors
  background: {
    primary: '#ffffff',
    secondary: '#f9fafb',
    tertiary: '#f3f4f6',
    muted: '#e5e7eb',
  },

  text: {
    primary: '#111827',
    secondary: '#6b7280',
    tertiary: '#9ca3af',
    inverse: '#ffffff',
  },

  // Gradient Backgrounds
  gradients: {
    orangeLight: 'linear-gradient(to bottom right, #fef3c7, #ffffff, #fed7aa)',
    orangeWarm: 'linear-gradient(to right, #eb7825, #d6691f)',
    subtle: 'linear-gradient(135deg, #fef3c7 0%, #ffffff 50%, #fed7aa 100%)',
  },

  // UI States
  success: {
    light: '#d1fae5',
    main: '#10b981',
    dark: '#059669',
  },

  error: {
    light: '#fee2e2',
    main: '#ef4444',
    dark: '#dc2626',
  },

  warning: {
    light: '#fef3c7',
    main: '#f59e0b',
    dark: '#d97706',
  },

  info: {
    light: '#dbeafe',
    main: '#3b82f6',
    dark: '#2563eb',
  },

  // Border & Dividers
  border: {
    light: '#f3f4f6',
    main: '#e5e7eb',
    dark: '#d1d5db',
  },

  // Overlay & Shadow
  overlay: {
    light: 'rgba(0, 0, 0, 0.1)',
    medium: 'rgba(0, 0, 0, 0.3)',
    dark: 'rgba(0, 0, 0, 0.5)',
  },

  // Category Colors (matching app categories)
  category: {
    stroll: '#10b981',
    sipChill: '#8b5cf6',
    casualEats: '#f59e0b',
    screenRelax: '#3b82f6',
    creative: '#ec4899',
    picnics: '#14b8a6',
    playMove: '#ef4444',
    dining: '#f97316',
    wellness: '#06b6d4',
    freestyle: '#6366f1',
  },

  // Experience Type Colors
  experienceType: {
    solo: '#6366f1',
    firstDate: '#ec4899',
    romantic: '#f43f5e',
    friendly: '#10b981',
    group: '#f59e0b',
    business: '#3b82f6',
  },

  // Travel Mode Colors
  travelMode: {
    walking: '#10b981',
    biking: '#3b82f6',
    driving: '#f59e0b',
    transit: '#8b5cf6',
  },
} as const;

export type ColorToken = typeof colors;
