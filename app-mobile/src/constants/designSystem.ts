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

  // ORCH-0566 — Premium glassmorphism for discovery-card labels.
  // Sub-namespace to avoid collision with the onboarding-scoped glass.*
  // tokens above. Consumed exclusively by components/ui/GlassBadge.tsx.
  // Values locked by SPEC_ORCH-0566_GLASS_CARD_LABELS.md §12.
  badge: {
    blur: {
      intensity: 24,
      tint: 'dark' as const,
    },
    tint: {
      floor: 'rgba(12, 14, 18, 0.42)',
      pressed: 'rgba(12, 14, 18, 0.52)',
    },
    border: {
      hairline: 'rgba(255, 255, 255, 0.14)',
      topHighlight: 'rgba(255, 255, 255, 0.22)',
    },
    shadow: {
      color: '#000000',
      offset: { width: 0, height: 2 },
      opacity: 0.25,
      radius: 8,
      elevation: 4,
    },
    fallback: {
      solid: 'rgba(20, 22, 26, 0.92)',
    },
    padding: {
      horizontal: 11,
      vertical: 7,
    },
    radius: {
      default: 9999,
      circular: 13,
    },
    size: {
      circular: 26,
    },
    text: {
      color: '#FFFFFF',
      opacity: 1.0,
    },
    icon: {
      color: '#FFFFFF',
      opacity: 0.92,
      size: 13,
    },
    gap: 5,
    hitSlop: { top: 12, bottom: 12, left: 8, right: 8 } as const,
    motion: {
      entryDurationMs: 220,
      staggerMs: 40,
      entryTranslateY: 8,
      pressDurationMs: 120,
      pressScale: 0.96,
    },
  },

  // ORCH-0589 v4 — Card-level tokens (separate namespace from chrome, because the
  // swipe card is NOT a glass surface — it's a solid photo card that sits inside the
  // phone bezel). Consumed by SwipeableCards.tsx for bezel-matched corner radii + lift.
  card: {
    bezelRadius: 40,
  },

  // ORCH-0589 — Floating glass chrome (top bar + session switcher + bottom nav).
  // Sibling to glass.badge. Consumed by GlassIconButton, GlassSessionSwitcher,
  // GlassBottomNav, GlassTopBar. Values locked by SPEC_ORCH-0589 §13.
  chrome: {
    blur: {
      intensity: 28,
      tint: 'dark' as const,
    },
    tint: {
      floor: 'rgba(12, 14, 18, 0.48)',
      pressed: 'rgba(12, 14, 18, 0.58)',
    },
    border: {
      hairline: 'rgba(255, 255, 255, 0.12)',
      topHighlight: 'rgba(255, 255, 255, 0.24)',
    },
    shadow: {
      color: '#000000',
      offset: { width: 0, height: 4 },
      opacity: 0.28,
      radius: 12,
      elevation: 6,
    },
    fallback: {
      solid: 'rgba(22, 24, 28, 0.94)',
    },
    active: {
      tint: 'rgba(235, 120, 37, 0.28)',
      border: 'rgba(235, 120, 37, 0.55)',
      glowColor: '#eb7825',
      glowOpacity: 0.35,
      glowRadius: 14,
      glowElevation: 8,
      // ORCH-0589 v5 (T4): active-content on orange glass is WHITE everywhere —
      // labels (session pills) + icons (Preferences/Notifications/nav tabs) all white.
      // Orange is the selection signal; content stays white for contrast + unity.
      iconColor: '#FFFFFF',
      labelColor: '#FFFFFF',
    },
    inactive: {
      iconColor: 'rgba(255, 255, 255, 0.65)',
      iconColorStrong: 'rgba(255, 255, 255, 0.88)',
      labelColor: 'rgba(255, 255, 255, 0.55)',
    },
    // ORCH-0661 — Pending session pill states (sender + receiver). Both share the
    // dim-pill base (opacity, dashed hairline border) so they read as visually
    // identical "pending" states; badge color/icon is the only differentiator.
    // Sender's outgoing invite (sent) gets a dim white badge for "passive, awaiting";
    // recipient's incoming invite (received) gets an orange-glow badge for "incoming,
    // take action." Border style is `dashed` for visual distinction from inactive
    // (no border) and active (solid orange). If `dashed` renders poorly on a target
    // platform, fallback is `solid` with `borderColor` at slightly higher alpha.
    // Pixel-matches legacy CollaborationSessions.inviteBadge geometry (size 14,
    // radius 7, offset -3, 1.5px border, 7px icon) for behavioral continuity with
    // the pre-ORCH-0589 pill-bar design.
    pending: {
      // Both states share these base values:
      dimOpacity: 0.6,
      borderWidth: 1,
      borderStyle: 'dashed' as const,
      borderColor: 'rgba(255, 255, 255, 0.28)',
      labelColor: 'rgba(255, 255, 255, 0.55)',
      // Badge geometry:
      badge: {
        size: 14,
        radius: 7,
        offsetTop: -3,
        offsetRight: -3,
        borderWidth: 1.5,
        borderColor: 'rgba(12, 14, 18, 1)',
        iconSize: 7,
        iconColor: '#FFFFFF',
      },
      // State-specific badge fill:
      sent: {
        badgeBgColor: 'rgba(255, 255, 255, 0.65)',
        iconName: 'time-outline' as const,
      },
      received: {
        badgeBgColor: '#eb7825',
        iconName: 'mail' as const,
      },
    },
    badge: {
      bgColor: '#eb7825',
      borderColor: 'rgba(18, 20, 26, 1)',
      borderWidth: 1.5,
      textColor: '#FFFFFF',
    },
    button: {
      size: 44,
      radius: 22,
      hitSlop: { top: 8, bottom: 8, left: 8, right: 8 } as const,
      iconSize: 22,
    },
    switcher: {
      height: 44,
      radius: 22,
      paddingHorizontal: 6,
      paddingVertical: 4,
      pillGap: 8,
      createPillGap: 10,
      innerEdgeGap: 6,
      // ORCH-0589 v2 (G6): widened 12 → 20 so LinearGradient fades smoothly.
      fadeEdgeWidth: 20,
    },
    pill: {
      height: 36,
      radius: 18,
      paddingHorizontal: 12,
      paddingHorizontalActive: 14,
      gap: 6,
      avatarSize: 18,
      maxLabelWidth: 120,
      createSize: 32,
      createRadius: 16,
    },
    // ORCH-0589 v3 (R6 + R7) + v4 (V2, V3):
    //   R6: spotlightInset 4 → 2 (wider coverage), verticalPadding 6 → 4 (taller).
    //   R7: Active fill/border/glow/label all consume shared `glass.chrome.active.*`.
    //   V2: activeIconColor reintroduced as a nav-specific override — user wants the
    //       active-tab icon WHITE even though the spotlight fill is translucent orange.
    //       Session pills have no icon; icon buttons keep orange; only nav overrides.
    //   V3: capsuleHeight 64 → 72 + labelGap 3 → 5 for icon/label breathing room.
    //       verticalPadding stays 4 so the spotlight remains tall (R6b preserved).
    // ORCH-0589 v5 (T1b) + v6 (U2) + v6.3 tune: nav capsule is fully-rounded pill.
    // v6.3: labelGap 5 → 3 — icon + label sit closer so they read as one unit under
    // the active spotlight. Combined with the fontSize 11→10 in GlassBottomNav.tsx,
    // the active tab feels tighter + more intentional.
    nav: {
      capsuleHeight: 72,
      radius: 36,
      horizontalPadding: 8,
      verticalPadding: 4,
      iconSize: 22,
      labelGap: 3,
      spotlightRadius: 32,
      spotlightInset: 0,
      activeIconColor: '#FFFFFF',
    },
    motion: {
      showDurationMs: 260,
      hideDurationMs: 180,
      showTranslateY: 16,
      pressDurationMs: 120,
      pressScale: 0.94,
      selectPulseScale: 1.06,
      scrollToSelectedMs: 240,
      tooltipFadeInMs: 200,
      tooltipFadeOutMs: 120,
      springDamping: 18,
      springStiffness: 260,
      springMass: 0.9,
      badgePulseDamping: 12,
      badgePulseStiffness: 280,
    },
    // ORCH-0589 v3 (R2, R5): topInset 8 → 2 (chrome snug against status bar);
    // bottomInset 12 → 6 (nav lower, more card space).
    row: {
      topInset: 2,
      bottomInset: 6,
      horizontalInsetTop: 16,
      horizontalInsetBottom: 20,
      buttonSwitcherGap: 12,
    },
    // ORCH-0589 v3 (R3): blurred backdrop canvas behind the status bar + top-bar row
    // so the phone's system icons (time / wifi / battery) + Mingla chrome pills stay
    // readable over any card photo. Lighter blur intensity than the primary chrome
    // (28) so it reads as a "continuation" of the glass language, not an opaque shelf.
    backdrop: {
      intensity: 22,
      tint: 'rgba(12, 14, 18, 0.34)',
      fadeHeight: 20,
      extraBottomPad: 6,
    },
  },

  // ORCH-0590 Phase 3 — Discover screen tokens. Sibling to glass.chrome (home)
  // and glass.card (swipe deck). Values from DESIGN_ORCH-0590_PHASE2_DISCOVER_
  // TINDER_EXPLORE_SPEC.md §7. Active states reuse glass.chrome.active.* directly.
  discover: {
    screenBg: 'rgba(12, 14, 18, 1)',

    title: {
      fontSize: 32,
      fontWeight: '700' as const,
      lineHeight: 38,
      color: '#FFFFFF',
      topInset: 4,
      bottomPadding: 8,
      horizontalPadding: 16,
      collapseThreshold: 44,
    },

    stickyHeader: {
      height: 44,
      blurIntensity: 28,
      tint: 'rgba(12, 14, 18, 0.48)',
      bottomHairline: 'rgba(255, 255, 255, 0.12)',
      titleFontSize: 17,
      titleFontWeight: '600' as const,
      titleColor: '#FFFFFF',
      fadeMs: 180,
      fallbackSolid: 'rgba(22, 24, 28, 0.94)',
    },

    filterBar: {
      height: 52,
      paddingVertical: 8,
      paddingHorizontal: 16,
      chipGap: 8,
      fadeEdgeWidth: 20,
      backdropBlurIntensity: 22,
      backdropTint: 'rgba(12, 14, 18, 0.34)',
      bottomHairline: 'rgba(255, 255, 255, 0.12)',
      fallbackSolid: 'rgba(22, 24, 28, 0.94)',
    },

    chip: {
      height: 36,
      radius: 18,
      paddingHorizontal: 14,
      iconLabelGap: 6,
      labelFontSize: 14,
      labelFontWeight: '500' as const,
      pressScale: 0.96,
      pressDurationMs: 120,
      inactive: {
        bg: 'rgba(255, 255, 255, 0.08)',
        border: 'rgba(255, 255, 255, 0.14)',
        labelColor: 'rgba(255, 255, 255, 0.85)',
        fallbackSolid: 'rgba(28, 30, 34, 1)',
      },
      active: {
        // Reuses glass.chrome.active.tint / .border / .labelColor / .glowColor at call sites.
        glowOpacity: 0.25,
        glowRadius: 10,
        fallbackSolid: 'rgba(235, 120, 37, 0.85)',
      },
      countBadge: {
        size: 16,
        top: -4,
        right: -4,
        bg: 'rgba(235, 120, 37, 0.9)',
        borderWidth: 1.5,
        borderColor: 'rgba(18, 20, 26, 1)',
        fontSize: 10,
        fontWeight: '700' as const,
        color: '#FFFFFF',
      },
    },

    grid: {
      horizontalPadding: 16,
      columnGap: 12,
      rowGap: 12,
      bottomClearance: 120,
    },

    card: {
      aspectRatio: 0.72,
      radius: 24,
      shadow: {
        color: '#000',
        offset: { width: 0, height: 4 },
        opacity: 0.25,
        radius: 12,
        elevation: 6,
      },
      pressScale: 0.97,
      pressDurationMs: 100,
      gradient: {
        from: 'rgba(0, 0, 0, 0)',
        to: 'rgba(0, 0, 0, 0.7)',
        startY: 0.35,
        endY: 1,
      },
      topBadge: {
        height: 20,
        paddingHorizontal: 8,
        paddingVertical: 4,
        radius: 10,
        topInset: 8,
        leftInset: 8,
        blurIntensity: 22,
        tint: 'rgba(12, 14, 18, 0.45)',
        border: 'rgba(255, 255, 255, 0.14)',
        fallbackSolid: 'rgba(28, 30, 34, 0.92)',
        soldOutBorder: 'rgba(239, 68, 68, 0.5)',
        labelFontSize: 10,
        labelFontWeight: '600' as const,
        labelLetterSpacing: 0.3,
        labelColor: '#FFFFFF',
      },
      saveButton: {
        size: 36,
        radius: 18,
        topInset: 8,
        rightInset: 8,
        iconSize: 18,
        hitSlop: { top: 4, bottom: 4, left: 4, right: 4 },
        blurIntensity: 22,
        inactive: {
          tint: 'rgba(12, 14, 18, 0.45)',
          border: 'rgba(255, 255, 255, 0.18)',
          iconColor: '#FFFFFF',
          fallbackSolid: 'rgba(28, 30, 34, 0.92)',
        },
        active: {
          // Reuses glass.chrome.active.tint / .border / .glowColor at call sites.
          iconColor: '#eb7825',
          fallbackSolid: 'rgba(235, 120, 37, 0.85)',
          fallbackIconColor: '#FFFFFF',
        },
      },
      bottomChip: {
        radius: 14,
        bottomInset: 10,
        leftInset: 10,
        rightInset: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        blurIntensity: 24,
        tint: 'rgba(12, 14, 18, 0.58)',
        border: 'rgba(255, 255, 255, 0.14)',
        fallbackSolid: 'rgba(16, 18, 22, 0.88)',
        titleFontSize: 14,
        titleFontWeight: '600' as const,
        titleLineHeight: 18,
        titleColor: '#FFFFFF',
        titleNumberOfLines: 2,
        metaFontSize: 11,
        metaFontWeight: '500' as const,
        metaLineHeight: 14,
        metaColor: 'rgba(255, 255, 255, 0.72)',
        metaRowGap: 6,
        priceColor: '#FFFFFF',
      },
    },

    offlineBanner: {
      height: 36,
      bg: 'rgba(235, 120, 37, 0.12)',
      topHairline: 'rgba(235, 120, 37, 0.3)',
      iconColor: '#eb7825',
      labelColor: '#FFFFFF',
      labelFontSize: 13,
      labelFontWeight: '500' as const,
    },

    emptyState: {
      iconSize: 48,
      titleFontSize: 17,
      titleFontWeight: '600' as const,
      titleColor: '#FFFFFF',
      subtitleFontSize: 15,
      subtitleFontWeight: '400' as const,
      subtitleColor: 'rgba(255, 255, 255, 0.65)',
      actionHeight: 44,
      actionRadius: 22,
      actionPaddingHorizontal: 20,
    },

    motion: {
      stickyHeaderFadeMs: 180,
      chipPressDurationMs: 120,
      cardPressDurationMs: 100,
      saveBounce: {
        damping: 12,
        stiffness: 280,
        maxScale: 1.15,
      },
      skeletonPulseMs: 1500,
    },
  },

  // ORCH-0627 Phase 1 — Profile screen tokens. Sibling to glass.discover.
  // Differs intentionally from discover: warmer canvas (R≥B — plum-charcoal, not
  // blue-gray), orange hero glow, softer card treatment, larger radii. Values from
  // DESIGN_ORCH-0627_PROFILE_GLASS_REFRESH_SPEC.md §2.
  profile: {
    // Canvas
    screenBg: 'rgba(20, 17, 19, 1)',
    screenBgFallback: 'rgba(20, 17, 19, 1)',

    heroGradient: {
      colors: ['rgba(235, 120, 37, 0.10)', 'rgba(20, 17, 19, 0)'] as [string, string],
      locations: [0, 1] as [number, number],
      heightRatio: 0.42,
    },

    heroGlow: {
      centerColor: 'rgba(235, 120, 37, 0.28)',
      midColor: 'rgba(235, 120, 37, 0.12)',
      edgeColor: 'rgba(235, 120, 37, 0)',
      radius: 180,
      offsetY: -10,
      breathingRangeMs: 8000,
      breathingOpacityRange: [0.85, 1.0] as [number, number],
    },

    card: {
      bg: 'rgba(255, 255, 255, 0.04)',
      bgFallback: 'rgba(28, 25, 28, 0.94)',
      blurIntensity: 30,
      border: 'rgba(255, 255, 255, 0.08)',
      borderWidth: 1,
      topHighlight: 'rgba(255, 255, 255, 0.10)',
      radius: 20,
      paddingHorizontal: 20,
      paddingVertical: 20,
      marginHorizontal: 16,
      marginBottom: 14,
      shadow: {
        color: '#000',
        offset: { width: 0, height: 4 },
        opacity: 0.30,
        radius: 16,
        elevation: 6,
      },
    },

    cardElevated: {
      bg: 'rgba(255, 255, 255, 0.06)',
      bgFallback: 'rgba(32, 28, 32, 0.96)',
      blurIntensity: 34,
      border: 'rgba(255, 255, 255, 0.12)',
      borderWidth: 1,
      topHighlight: 'rgba(255, 255, 255, 0.14)',
      radius: 24,
      paddingHorizontal: 24,
      paddingVertical: 28,
      marginHorizontal: 16,
      marginBottom: 14,
      shadow: {
        color: '#000',
        offset: { width: 0, height: 8 },
        opacity: 0.42,
        radius: 24,
        elevation: 10,
      },
    },

    divider: 'rgba(255, 255, 255, 0.06)',
    dividerStrong: 'rgba(255, 255, 255, 0.10)',

    // Text
    text: {
      heroName: {
        color: '#FFFFFF',
        fontSize: 26,
        fontWeight: '700' as const,
        lineHeight: 32,
        letterSpacing: -0.2,
      },
      username: {
        color: 'rgba(255, 255, 255, 0.55)',
        fontSize: 14,
        fontWeight: '500' as const,
        lineHeight: 18,
      },
      bio: {
        color: 'rgba(255, 255, 255, 0.82)',
        fontSize: 15,
        fontWeight: '400' as const,
        lineHeight: 22,
      },
      bioPlaceholder: {
        color: 'rgba(255, 255, 255, 0.40)',
        fontSize: 15,
        fontWeight: '400' as const,
        lineHeight: 22,
        fontStyle: 'italic' as const,
      },
      location: {
        color: 'rgba(255, 255, 255, 0.55)',
        fontSize: 13,
        fontWeight: '500' as const,
        lineHeight: 17,
      },
      cardTitle: {
        color: 'rgba(255, 255, 255, 0.55)',
        fontSize: 12,
        fontWeight: '600' as const,
        lineHeight: 16,
        letterSpacing: 1.4,
        textTransform: 'uppercase' as const,
      },
      statValue: {
        color: '#FFFFFF',
        fontSize: 26,
        fontWeight: '700' as const,
        lineHeight: 32,
        letterSpacing: -0.4,
      },
      statValueZero: {
        color: 'rgba(255, 255, 255, 0.28)',
        fontSize: 26,
        fontWeight: '700' as const,
        lineHeight: 32,
      },
      statLabel: {
        color: 'rgba(255, 255, 255, 0.55)',
        fontSize: 11,
        fontWeight: '600' as const,
        lineHeight: 14,
        letterSpacing: 0.6,
        textTransform: 'uppercase' as const,
      },
      settingsLabel: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '600' as const,
        lineHeight: 20,
      },
      settingsDescription: {
        color: 'rgba(255, 255, 255, 0.55)',
        fontSize: 13,
        fontWeight: '400' as const,
        lineHeight: 17,
      },
      legalLink: {
        color: 'rgba(255, 255, 255, 0.55)',
        fontSize: 13,
        fontWeight: '500' as const,
        lineHeight: 17,
      },
      signOut: {
        color: '#ef4444',
        fontSize: 15,
        fontWeight: '600' as const,
        lineHeight: 20,
      },
      brandAccent: {
        color: '#eb7825',
        fontSize: 13,
        fontWeight: '600' as const,
      },
      error: {
        color: '#f87171',
        fontSize: 12,
        fontWeight: '500' as const,
      },
    },

    avatar: {
      size: 112,
      radius: 56,
      ring: {
        innerColor: 'rgba(255, 255, 255, 0.14)',
        innerWidth: 1,
        outerColor: 'rgba(20, 17, 19, 1)',
        outerWidth: 3,
      },
      cameraBadge: {
        size: 30,
        radius: 15,
        bg: '#eb7825',
        borderColor: 'rgba(20, 17, 19, 1)',
        borderWidth: 2.5,
        iconColor: '#FFFFFF',
        iconSize: 14,
      },
      initialsGradient: {
        colors: ['#eb7825', '#f5a623'] as [string, string],
      },
      initialsColor: '#FFFFFF',
      initialsFontSize: 36,
      initialsFontWeight: '700' as const,
    },

    chip: {
      intent: {
        bg: 'rgba(235, 120, 37, 0.18)',
        border: 'rgba(235, 120, 37, 0.32)',
        borderWidth: 1,
        textColor: '#FFFFFF',
        iconColor: '#FFFFFF',
        shadowColor: '#eb7825',
        shadowOpacity: 0.22,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      category: {
        bg: 'rgba(255, 255, 255, 0.06)',
        border: 'rgba(255, 255, 255, 0.12)',
        borderWidth: 1,
        textColor: 'rgba(255, 255, 255, 0.90)',
        iconColor: 'rgba(255, 255, 255, 0.70)',
      },
      height: 32,
      radius: 16,
      paddingHorizontal: 14,
      paddingVertical: 6,
      iconSize: 14,
      iconLabelGap: 6,
      labelFontSize: 13,
      labelFontWeight: '600' as const,
      rowGap: 8,
      columnGap: 8,
    },

    statTile: {
      bg: 'rgba(255, 255, 255, 0.04)',
      bgFallback: 'rgba(28, 25, 28, 0.92)',
      border: 'rgba(255, 255, 255, 0.08)',
      borderWidth: 1,
      radius: 16,
      paddingVertical: 18,
      paddingHorizontal: 14,
      minHeight: 96,
      iconSize: 20,
      iconBg: 'rgba(255, 255, 255, 0.08)',
      iconBgRadius: 16,
      iconBgSize: 32,
      iconColorSaved: '#eb7825',
      iconColorScheduled: '#fbbf24',
      iconColorFriends: '#fb923c',
      iconColorStreak: '#f97316',
      pressScale: 0.97,
      pressDurationMs: 100,
    },

    levelRing: {
      size: 96,
      strokeWidth: 6,
      trackColor: 'rgba(255, 255, 255, 0.10)',
      fillColor: '#eb7825',
      glowColor: 'rgba(235, 120, 37, 0.55)',
      glowRadius: 10,
      animationMs: 800,
      innerNumberFontSize: 32,
      innerNumberFontWeight: '800' as const,
      innerNumberColor: '#FFFFFF',
      innerNumberLetterSpacing: -0.5,
    },

    tierBadge: {
      bg: 'rgba(235, 120, 37, 0.14)',
      border: 'rgba(235, 120, 37, 0.36)',
      borderWidth: 1,
      radius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
      iconSize: 12,
      iconColor: '#eb7825',
      iconLabelGap: 4,
      labelFontSize: 11,
      labelFontWeight: '700' as const,
      labelLetterSpacing: 0.5,
      labelColor: '#fdba74',
      labelTextTransform: 'uppercase' as const,
    },

    settingsRow: {
      iconCircleSize: 36,
      iconCircleRadius: 10,
      iconCircleBg: 'rgba(255, 255, 255, 0.06)',
      iconCircleBorder: 'rgba(255, 255, 255, 0.10)',
      iconColor: 'rgba(255, 255, 255, 0.82)',
      iconSize: 18,
      verticalPadding: 16,
      chevronColor: 'rgba(255, 255, 255, 0.40)',
      chevronSize: 18,
      rowDivider: 'rgba(255, 255, 255, 0.06)',
      pressBg: 'rgba(255, 255, 255, 0.04)',
      pressDurationMs: 120,
    },

    signOut: {
      bg: 'rgba(239, 68, 68, 0.10)',
      border: 'rgba(239, 68, 68, 0.32)',
      borderWidth: 1,
      radius: 14,
      paddingVertical: 13,
      paddingHorizontal: 20,
      textColor: '#ef4444',
      pressScale: 0.98,
      pressDurationMs: 120,
    },

    sheet: {
      overlayTint: 'rgba(8, 6, 8, 0.72)',
      bg: 'rgba(28, 25, 28, 0.96)',
      blurIntensity: 38,
      border: 'rgba(255, 255, 255, 0.10)',
      borderWidth: 1,
      topRadius: 24,
      handleColor: 'rgba(255, 255, 255, 0.22)',
      handleWidth: 40,
      handleHeight: 4,
    },

    motion: {
      cardStaggerMs: 60,
      cardEntryDurationMs: 280,
      cardEntryTranslateY: 14,
      tapScaleDurationMs: 100,
      sheetOpenDurationMs: 320,
      heroGlowBreathingMs: 8000,
      levelRingFillMs: 800,
      countUpMs: 600,
    },
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
