// Issue #1540 [paired-liked-cards] SPEC S1-1 — ONE owner for the paired
// saves/visits list presentation (Constitution #2: one owner per truth).
//
// Two consumers render the same 2-column grid of a paired person's cards:
//
//   1. PersonHolidayView's SAVES sheet — a BaseBottomSheet in
//      `scrollMode="flatlist"`, where the gorhom `BottomSheetFlatList` MUST be a
//      DIRECT child of `<BottomSheet>` (see the I-SHEET-SCROLLABLE-DIRECT-CHILD
//      draft invariant). That consumer therefore cannot delegate its list to a
//      child component — it hands `header` + `scrollProps` to BaseBottomSheet and
//      composes the CELLS from here.
//   2. PersonHolidayView's VISITS list — still a full-screen
//      `<Modal presentationStyle="pageSheet">` wrapping `PairedSavesListScreen`,
//      whose own raw RN `FlatList` is correct in a full-screen host and is
//      unchanged by #1540.
//
// Before #1540 the header, the grid geometry, the cell renderer and the
// skeleton/empty/error states lived only inside `PairedSavesListScreen`, so the
// sheet could only reuse them by mounting that whole screen — which is exactly
// what forced the scrollable under an intermediate wrapper `View` and produced a
// viewport equal to its own content (zero scrollable overflow). Extracting the
// presentation here lets the sheet mount the sanctioned shape while both
// consumers keep rendering identical pixels.
//
// #1540 DESIGN PASS: the header gained a `variant` ('screen' | 'sheet'), the
// empty/error states are parameterised and honest, the skeleton matches the real
// grid's geometry, and the grid tokens now say what they actually do. The
// 'screen' default reproduces the full-screen (visits) chrome, so that consumer
// keeps its own layout while the sheet gets sheet chrome.

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  ActivityIndicator,
  AccessibilityInfo,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/Icon';
import { s, vs, SCREEN_WIDTH } from '../../utils/responsive';
import { colors, glass } from '../../constants/designSystem';
import PersonGridCard from '../PersonGridCard';
import VisitBadge from '../VisitBadge';
import { PriceTierSlug } from '../../constants/priceTiers';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PairedSavesListItem {
  id: string;
  title: string;
  category: string;
  imageUrl: string;
  priceTier?: PriceTierSlug | null;
  rating?: number;
  timestamp?: string;
  timestampLabel?: string;
  isVisited?: boolean;
}

const VALID_PRICE_TIERS: Set<string> = new Set([
  'chill',
  'comfy',
  'bougie',
  'lavish',
]);

/** Narrow a free-form price-tier string to the typed slug, or null. */
export function asPairedSavePriceTier(
  val: string | null | undefined,
): PriceTierSlug | null {
  return val && VALID_PRICE_TIERS.has(val) ? (val as PriceTierSlug) : null;
}

// ── Grid geometry (shared by both consumers) ───────────────────────────────

// #1540 §3.3: the edge inset and the inter-column gutter are now NAMED, and the
// card width is derived from them rather than from a bare s(48). The arithmetic
// is unchanged — (SCREEN_WIDTH - s(48)) / 2 — so there is ZERO horizontal visual
// change; the tokens simply stop lying about where the 48 comes from.
export const PAIRED_SAVES_EDGE = s(16);
export const PAIRED_SAVES_GUTTER = s(16);
export const PAIRED_SAVES_CARD_WIDTH =
  (SCREEN_WIDTH - PAIRED_SAVES_EDGE * 2 - PAIRED_SAVES_GUTTER) / 2;
export const PAIRED_SAVES_NUM_COLUMNS = 2;

export const pairedSavesGridStyles = StyleSheet.create({
  gridContent: {
    paddingHorizontal: PAIRED_SAVES_EDGE,
    paddingTop: s(12),
    paddingBottom: vs(32),
    // #1540 §2.3: LOAD-BEARING for the empty and error states. A
    // ListEmptyComponent's `flex:1` does nothing unless the content container can
    // grow, so without this the empty state hugged the top of a ~768pt sheet
    // instead of centring. Harmless when data is present (content already
    // exceeds the viewport).
    flexGrow: 1,
  },
  columnWrapper: {
    // #1540 §3.3: `justifyContent: 'space-between'` was REMOVED. With exactly two
    // fixed-width cards it distributed the s(16) of leftover space itself, so the
    // real gutter was s(16) while the declared `gap: s(12)` never applied — a
    // token that lied to the next person to touch CARD_WIDTH. `gap` is now the
    // actual gutter and matches the derivation above.
    gap: PAIRED_SAVES_GUTTER,
    // s() not vs(): a gutter between two equal-width cards must scale on the
    // same axis as the cards, or the grid goes non-square on tall devices.
    marginBottom: s(16),
  },
  cardWrapper: {
    width: PAIRED_SAVES_CARD_WIDTH,
    overflow: 'hidden',
  },
  cardContainer: {
    position: 'relative',
    borderRadius: s(16),
    overflow: 'hidden',
  },
});

// ── Header ─────────────────────────────────────────────────────────────────

/**
 * 'screen' — the full-screen (visits pageSheet Modal) chrome: status-bar offset,
 *   centred title, back chevron. UNCHANGED from before the design pass.
 * 'sheet'  — bottom-sheet chrome: no status-bar offset (there is no status bar
 *   above a sheet), left-aligned title, dismiss ✕ on the right, hairline rule.
 */
export type PairedSavesListHeaderVariant = 'screen' | 'sheet';

export interface PairedSavesListHeaderProps {
  title: string;
  onBack: () => void;
  variant?: PairedSavesListHeaderVariant;
}

/**
 * Intrinsic height — safe as a BaseBottomSheet `header` sibling.
 *
 * #1540 DESIGN: the control's `accessibilityLabel` used to be the TITLE, so
 * VoiceOver announced the dismiss button as "Ada's saves, button" — a blind user
 * had no way to know it closed anything. It is now the action.
 *
 * In the 'sheet' variant the glyph is `close`, not `arrow-back`: `onBack` there
 * DISMISSES the sheet, it does not navigate back, and there is no previous screen
 * inside the sheet to go back to. Every other sheet passing `header` to
 * BaseBottomSheet uses `close`; this surface was the outlier.
 */
export const PairedSavesListHeader: React.FC<PairedSavesListHeaderProps> = ({
  title,
  onBack,
  variant = 'screen',
}) => {
  const { t } = useTranslation(['social', 'common']);

  if (variant === 'sheet') {
    return (
      <View style={styles.sheetHeader}>
        <Text
          style={styles.sheetHeaderTitle}
          numberOfLines={1}
          ellipsizeMode="tail"
          accessibilityRole="header"
        >
          {title}
        </Text>
        <TouchableOpacity
          onPress={onBack}
          style={styles.sheetHeaderClose}
          accessibilityRole="button"
          accessibilityLabel={t('common:close')}
        >
          <Icon name="close" size={s(22)} color={colors.gray[700]} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.header}>
      <TouchableOpacity
        onPress={onBack}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={t('common:back')}
      >
        <Icon name="arrow-back" size={24} color={colors.gray[900]} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
};

// ── Cell renderer ──────────────────────────────────────────────────────────

/**
 * The one cell renderer for a paired save/visit: `PersonGridCard` + the visited
 * badge. Consumers wrap it in their own `useCallback` so FlatList keeps a stable
 * `renderItem` identity:
 *
 *   const renderItem = useCallback(
 *     (info) => renderPairedSaveItem(info, onCardPress),
 *     [onCardPress],
 *   );
 */
export function renderPairedSaveItem(
  { item }: { item: PairedSavesListItem },
  onCardPress: (id: string) => void,
): React.ReactElement {
  return (
    <View style={pairedSavesGridStyles.cardWrapper}>
      <View style={pairedSavesGridStyles.cardContainer}>
        <PersonGridCard
          id={item.id}
          title={item.title}
          category={item.category}
          imageUrl={item.imageUrl}
          priceTier={asPairedSavePriceTier(item.priceTier)}
          priceLevel={null}
          onPress={() => onCardPress(item.id)}
          width={PAIRED_SAVES_CARD_WIDTH}
        />
        {item.isVisited && <VisitBadge />}
      </View>
    </View>
  );
}

// ── Skeleton / empty / error states ────────────────────────────────────────

/**
 * #1540 §2.5 reduce-motion gate. A perpetually pulsing 6-card grid is exactly
 * what the OS "reduce motion" setting exists to stop, and honouring it was a live
 * accessibility gap.
 */
function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReduceMotion(enabled);
      })
      .catch(() => {
        // Non-fatal and non-silent by design: the setting is unreadable on this
        // platform, so we keep the default (motion on) rather than guess.
        if (!cancelled) setReduceMotion(false);
      });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled: boolean) => setReduceMotion(enabled),
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}

/**
 * One shimmering placeholder card. The opacity driver is OWNED BY THE GRID and
 * passed in — six independent `Animated.loop`s (the previous shape) meant six
 * timers driving one visual effect.
 */
const SkeletonCard: React.FC<{ opacity: Animated.Value }> = ({ opacity }) => (
  <Animated.View style={[styles.skeletonCard, { opacity }]}>
    <View style={styles.skeletonImage} />
    <View style={styles.skeletonContent}>
      <View style={styles.skeletonTitleOne} />
      <View style={styles.skeletonTitleTwo} />
      <View style={styles.skeletonCategory} />
      <View style={styles.skeletonArrow} />
    </View>
  </Animated.View>
);

/**
 * Six placeholder cards in the GRID'S OWN geometry.
 *
 * #1540 §2.5: this is mounted as `ListEmptyComponent`, i.e. INSIDE
 * `gridContent`'s `paddingHorizontal: s(16)` — and it used to apply
 * `paddingHorizontal: s(16)` again. Total inset s(32)/side left `SW - s(64)`
 * available while two cards need `SW - s(48)`, overflowing by exactly s(16); with
 * `flexWrap` the second card dropped to its own row. The loading state was a
 * one-wide column that snapped to a two-wide grid when data landed. Its own
 * padding is now REMOVED and inherited from the content container, and the box
 * metrics (width/height/radius/gutters) match the real card exactly, so there is
 * nothing left to jump.
 */
export const PairedSavesSkeletonGrid: React.FC = () => {
  const reduceMotion = useReduceMotion();
  const opacity = React.useRef(new Animated.Value(0.35)).current;

  React.useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(0.55);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.75,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity, reduceMotion]);

  return (
    <View style={styles.skeletonGrid}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <SkeletonCard key={i} opacity={opacity} />
      ))}
    </View>
  );
};

export interface PairedSavesEmptyStateProps {
  /** Defaults to `albums-outline` — the visits list's existing glyph. */
  icon?: IconName;
  /** Defaults to `social:nothingHereYet` — the visits list's existing copy. */
  title?: string;
  /** Omitted by default; the saves sheet supplies one. */
  subtitle?: string;
}

/**
 * Honest empty state (Constitution #9 — nothing is fabricated to fill it).
 * Parameterised so the saves sheet can name the person while the full-screen
 * visits consumer keeps its existing glyph and copy by passing nothing.
 */
export const PairedSavesEmptyState: React.FC<PairedSavesEmptyStateProps> = ({
  icon = 'albums-outline',
  title,
  subtitle,
}) => {
  const { t } = useTranslation(['social', 'common']);
  return (
    <View style={styles.centered}>
      {/* Decorative: the meaning is carried by the text below, so hiding it
          from assistive tech removes a redundant stop rather than information.
          The flags sit on a wrapper because the shared `Icon` primitive does not
          forward accessibility props, and widening it is out of scope here. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon name={icon} size={s(44)} color={colors.gray[300]} />
      </View>
      <Text style={styles.stateTitle}>{title ?? t('social:nothingHereYet')}</Text>
      {subtitle ? <Text style={styles.stateSubtitle}>{subtitle}</Text> : null}
    </View>
  );
};

export interface PairedSavesErrorStateProps {
  onRetry?: () => void;
  /** Defaults to `social:somethingWentWrongError`. */
  title?: string;
  subtitle?: string;
  /** While true the retry control is disabled and shows a spinner. */
  isRetrying?: boolean;
}

/**
 * #1540 §2.4: this component existed and was exported but was never mounted by
 * either consumer, so a FAILED fetch fell through to "Nothing here yet" — telling
 * the viewer their friend had saved nothing when the truth was the request failed
 * (Constitution #3 and #9). It is now wired, and sharpened.
 */
export const PairedSavesErrorState: React.FC<PairedSavesErrorStateProps> = ({
  onRetry,
  title,
  subtitle,
  isRetrying = false,
}) => {
  const { t } = useTranslation(['social', 'common']);
  return (
    <View style={styles.centered}>
      {/* Deliberately darker than the empty-state glyph: an error indicator
          should be clearly perceivable, not decorative. Still hidden from
          assistive tech — the title below carries the meaning. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon name="alert-circle-outline" size={s(44)} color={colors.gray[500]} />
      </View>
      <Text style={styles.errorTitle}>
        {title ?? t('social:somethingWentWrongError')}
      </Text>
      {subtitle ? <Text style={styles.stateSubtitle}>{subtitle}</Text> : null}
      {onRetry && (
        <Pressable
          onPress={onRetry}
          disabled={isRetrying}
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.retryButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t('social:tryAgain')}
          accessibilityState={{ disabled: isRetrying, busy: isRetrying }}
        >
          {isRetrying ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <Text style={styles.retryText}>{t('social:tryAgain')}</Text>
          )}
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  // ── Header: 'screen' variant (full-screen visits Modal) — UNCHANGED ──────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: vs(48),
    paddingHorizontal: s(24),
    paddingBottom: vs(12),
    backgroundColor: '#ffffff',
  },
  headerTitle: {
    flex: 1,
    fontSize: s(18),
    fontWeight: '700',
    color: colors.gray[900],
    textAlign: 'center',
  },
  headerSpacer: {
    width: 24,
  },
  // ── Header: 'sheet' variant ──────────────────────────────────────────────
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    // minHeight, NOT height — survives OS font scaling by growing rather than
    // clipping.
    minHeight: s(52),
    paddingLeft: s(16),
    // The 44pt ✕ touch target supplies the rest of the optical inset.
    paddingRight: s(6),
    // #1540 §1.2: the old header carried `paddingTop: vs(48)` — a STATUS-BAR
    // offset inherited from the pre-#266 full-screen pageSheet Modal. Inside a
    // bottom sheet there is no status bar above it, so that was 48pt of dead
    // space under the handle. Deleting it pays for the pinned header twice over:
    // pinned chrome is ~32pt SHORTER than the chrome that used to scroll away.
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: glass.notificationsSheet.canvas,
    // Required once the header is pinned: without it cards scroll UNDER the
    // header and visually merge into it. 6% black on white does exactly one job.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.notificationsSheet.cardBorder,
  },
  sheetHeaderTitle: {
    flex: 1,
    fontSize: s(17),
    lineHeight: s(22),
    fontWeight: '600',
    color: colors.gray[900], // #111827 on #FFFFFF → 17.4:1
    marginRight: s(8), // a long name never kisses the ✕
  },
  sheetHeaderClose: {
    width: s(44),
    height: s(44),
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Skeleton ─────────────────────────────────────────────────────────────
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // One token drives BOTH the row and the column gutter, matching the real
    // grid's PAIRED_SAVES_GUTTER / columnWrapper marginBottom.
    gap: PAIRED_SAVES_GUTTER,
    // paddingHorizontal and paddingTop REMOVED — inherited from gridContent.
    // Applying them here too was the double-inset that forced a single column.
  },
  skeletonCard: {
    width: PAIRED_SAVES_CARD_WIDTH,
    height: s(240), // exactly PersonGridCard's height
    borderRadius: s(16), // exactly PersonGridCard's radius
    backgroundColor: colors.gray[100],
    overflow: 'hidden',
    // marginBottom REMOVED — `gap` owns the rhythm now.
  },
  skeletonImage: {
    width: '100%',
    height: s(130), // matches the real image band
    backgroundColor: colors.gray[200],
  },
  skeletonContent: {
    padding: s(12),
  },
  skeletonTitleOne: {
    width: '85%',
    height: s(11),
    borderRadius: s(4),
    backgroundColor: colors.gray[200],
  },
  skeletonTitleTwo: {
    width: '55%',
    height: s(11),
    borderRadius: s(4),
    backgroundColor: colors.gray[200],
    marginTop: s(7),
  },
  skeletonCategory: {
    width: '40%',
    height: s(9),
    borderRadius: s(4),
    backgroundColor: colors.gray[200],
    marginTop: s(10),
  },
  skeletonArrow: {
    width: s(24),
    height: s(24),
    borderRadius: s(12),
    backgroundColor: colors.gray[200],
    alignSelf: 'flex-end',
    marginTop: s(10),
  },
  // ── States ───────────────────────────────────────────────────────────────
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(32),
    paddingVertical: vs(48),
  },
  stateTitle: {
    fontSize: s(16),
    lineHeight: s(22),
    fontWeight: '600',
    color: colors.gray[700], // #374151 → 10.3:1
    marginTop: vs(14),
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: s(16),
    lineHeight: s(22),
    fontWeight: '600',
    color: colors.gray[800], // #1f2937 → 14.7:1
    marginTop: vs(14),
    textAlign: 'center',
  },
  stateSubtitle: {
    fontSize: s(14),
    lineHeight: s(20),
    fontWeight: '400',
    color: colors.gray[500], // #6b7280 → 4.83:1
    marginTop: vs(6),
    textAlign: 'center',
    maxWidth: s(260),
  },
  retryButton: {
    // #1540 §2.4 WCAG: the button was colors.primary[500] (#f97316) with white
    // text — 2.80:1, a FAILING contrast ratio (AA needs 4.5:1, and s(15)/700 does
    // not qualify as large text). primary[700] (#c2410c) with white is 5.18:1 and
    // stays unmistakably in the Mingla orange family.
    backgroundColor: colors.primary[700],
    minHeight: s(48),
    // Reserved so swapping the label for the spinner causes no size jump.
    minWidth: s(140),
    paddingHorizontal: s(28),
    borderRadius: s(24),
    marginTop: vs(20),
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonPressed: {
    // DARKENS (7.31:1) rather than fading. A standard opacity fade over white
    // would LIGHTEN the fill and drop contrast below AA mid-press.
    backgroundColor: colors.primary[800],
  },
  retryText: {
    fontSize: s(16),
    fontWeight: '700',
    color: '#ffffff',
  },
});
