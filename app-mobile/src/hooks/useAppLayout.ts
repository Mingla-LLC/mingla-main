import { useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SCREEN_WIDTH, SCREEN_HEIGHT, vs } from '../utils/responsive';

// ─── Fixed Layout Constants ──────────────────────────────────────────
// These are the "skeleton" of the app — stable across all screens.

/** Header content height (logo + buttons), excluding safe area */
const HEADER_CONTENT_HEIGHT = vs(52);

/** Bottom nav content height (icons + labels), excluding safe area */
const BOTTOM_NAV_CONTENT_HEIGHT = vs(56);

/** Minimum bottom padding when no system inset exists (Android w/o gesture nav) */
const MIN_BOTTOM_PADDING = 8;

export interface AppLayout {
  /** Device screen width */
  screenWidth: number;
  /** Device screen height */
  screenHeight: number;

  /** Safe area insets from the device */
  insets: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };

  /** Total header height including status bar / notch area */
  headerTotalHeight: number;
  /** Just the content portion of the header (no insets) */
  headerContentHeight: number;

  /** Total bottom nav height including home indicator / gesture bar area */
  bottomNavTotalHeight: number;
  /** Just the content portion of the bottom nav (no insets) */
  bottomNavContentHeight: number;
  /** Bottom padding for the nav (safe area or minimum) */
  bottomNavPadding: number;

  /** Available height for page content between header and bottom nav */
  contentAreaHeight: number;

  /** Whether the device has a notch / dynamic island (top inset > 20) */
  hasNotch: boolean;
  /** Whether the device uses gesture navigation (bottom inset > 0) */
  hasGestureNav: boolean;
}

export function useAppLayout(): AppLayout {
  const insets = useSafeAreaInsets();

  return useMemo(() => {
    const bottomNavPadding = Math.max(insets.bottom, MIN_BOTTOM_PADDING);
    const headerTotalHeight = insets.top + HEADER_CONTENT_HEIGHT;
    const bottomNavTotalHeight = BOTTOM_NAV_CONTENT_HEIGHT + bottomNavPadding;
    const contentAreaHeight = SCREEN_HEIGHT - headerTotalHeight - bottomNavTotalHeight;

    return {
      screenWidth: SCREEN_WIDTH,
      screenHeight: SCREEN_HEIGHT,
      insets: {
        top: insets.top,
        bottom: insets.bottom,
        left: insets.left,
        right: insets.right,
      },
      headerTotalHeight,
      headerContentHeight: HEADER_CONTENT_HEIGHT,
      bottomNavTotalHeight,
      bottomNavContentHeight: BOTTOM_NAV_CONTENT_HEIGHT,
      bottomNavPadding,
      contentAreaHeight,
      hasNotch: insets.top > 20,
      hasGestureNav: insets.bottom > 0,
    };
  }, [insets.top, insets.bottom, insets.left, insets.right]);
}
