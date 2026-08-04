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

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Icon } from '../ui/Icon';
import { s, vs, SCREEN_WIDTH } from '../../utils/responsive';
import { colors } from '../../constants/designSystem';
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

export const PAIRED_SAVES_CARD_WIDTH = (SCREEN_WIDTH - s(48)) / 2;
export const PAIRED_SAVES_NUM_COLUMNS = 2;

export const pairedSavesGridStyles = StyleSheet.create({
  gridContent: {
    paddingHorizontal: s(16),
    paddingTop: vs(8),
    paddingBottom: vs(32),
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: vs(12),
    gap: s(12),
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

export interface PairedSavesListHeaderProps {
  title: string;
  onBack: () => void;
}

/** Back chevron + centred title. Intrinsic height — safe as a sheet header. */
export const PairedSavesListHeader: React.FC<PairedSavesListHeaderProps> = ({
  title,
  onBack,
}) => (
  <View style={styles.header}>
    <TouchableOpacity
      onPress={onBack}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Icon name="arrow-back" size={24} color={colors.gray[900]} />
    </TouchableOpacity>
    <Text style={styles.headerTitle}>{title}</Text>
    <View style={styles.headerSpacer} />
  </View>
);

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

const SkeletonCard: React.FC = () => {
  const opacity = React.useRef(new Animated.Value(0.3)).current;

  React.useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);

  return (
    <Animated.View style={[styles.skeletonCard, { opacity }]}>
      <View style={styles.skeletonImage} />
      <View style={styles.skeletonContent}>
        <View style={styles.skeletonTitle} />
        <View style={styles.skeletonSubtitle} />
      </View>
    </Animated.View>
  );
};

/** Six shimmering placeholder cards in the grid's own geometry. */
export const PairedSavesSkeletonGrid: React.FC = () => (
  <View style={styles.skeletonGrid}>
    {[1, 2, 3, 4, 5, 6].map((i) => (
      <SkeletonCard key={i} />
    ))}
  </View>
);

/** Honest empty state (Constitution #9 — nothing is fabricated to fill it). */
export const PairedSavesEmptyState: React.FC = () => {
  const { t } = useTranslation(['social', 'common']);
  return (
    <View style={styles.centered}>
      <Icon name="albums-outline" size={s(48)} color={colors.gray[300]} />
      <Text style={styles.emptyTitle}>{t('social:nothingHereYet')}</Text>
    </View>
  );
};

export interface PairedSavesErrorStateProps {
  onRetry?: () => void;
}

export const PairedSavesErrorState: React.FC<PairedSavesErrorStateProps> = ({
  onRetry,
}) => {
  const { t } = useTranslation(['social', 'common']);
  return (
    <View style={styles.centered}>
      <Icon name="alert-circle-outline" size={s(48)} color={colors.gray[400]} />
      <Text style={styles.errorText}>{t('social:somethingWentWrongError')}</Text>
      {onRetry && (
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryText}>{t('social:tryAgain')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
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
  // Skeleton
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: s(16),
    paddingTop: vs(16),
  },
  skeletonCard: {
    width: PAIRED_SAVES_CARD_WIDTH,
    height: s(240),
    borderRadius: s(16),
    backgroundColor: colors.gray[100],
    overflow: 'hidden',
    marginBottom: vs(16),
  },
  skeletonImage: {
    width: '100%',
    height: s(130),
    backgroundColor: colors.gray[200],
  },
  skeletonContent: {
    padding: s(12),
    gap: s(8),
  },
  skeletonTitle: {
    width: '80%',
    height: s(14),
    borderRadius: s(4),
    backgroundColor: colors.gray[200],
  },
  skeletonSubtitle: {
    width: '50%',
    height: s(12),
    borderRadius: s(4),
    backgroundColor: colors.gray[200],
  },
  // States
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(32),
  },
  errorText: {
    fontSize: s(16),
    fontWeight: '600',
    color: colors.gray[600],
    marginTop: vs(12),
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.primary[500],
    borderRadius: s(12),
    paddingVertical: vs(12),
    paddingHorizontal: s(32),
    marginTop: vs(16),
  },
  retryText: {
    fontSize: s(15),
    fontWeight: '700',
    color: '#ffffff',
  },
  emptyTitle: {
    fontSize: s(16),
    fontWeight: '600',
    color: colors.gray[500],
    marginTop: vs(12),
  },
});
