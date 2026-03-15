import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { s, vs, SCREEN_WIDTH } from '../utils/responsive';
import { colors, shadows } from '../constants/designSystem';
import PersonGridCard from './PersonGridCard';
import VisitBadge from './VisitBadge';
import { PriceTierSlug } from '../constants/priceTiers';

// ── Types ──────────────────────────────────────────────────────────────────

const VALID_PRICE_TIERS: Set<string> = new Set(['chill', 'comfy', 'bougie', 'lavish']);
function asPriceTier(val: string | null | undefined): PriceTierSlug | null {
  return val && VALID_PRICE_TIERS.has(val) ? (val as PriceTierSlug) : null;
}

interface ListItem {
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

interface PairedSavesListScreenProps {
  title: string;
  items: ListItem[];
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onBack: () => void;
  onCardPress: (id: string) => void;
  showCategoryFilter?: boolean;
  categories?: string[];
  selectedCategory?: string;
  onCategoryChange?: (category: string | undefined) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const CARD_WIDTH = (SCREEN_WIDTH - s(48)) / 2;
const NUM_COLUMNS = 2;

// ── Skeleton Card ──────────────────────────────────────────────────────────

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

// ── Main Component ─────────────────────────────────────────────────────────

const PairedSavesListScreen: React.FC<PairedSavesListScreenProps> = ({
  title,
  items,
  isLoading,
  isError,
  onRetry,
  onBack,
  onCardPress,
  showCategoryFilter,
  categories,
  selectedCategory,
  onCategoryChange,
}) => {
  const renderItem = useCallback(
    ({ item }: { item: ListItem }) => (
      <View style={styles.cardWrapper}>
        <View style={styles.cardContainer}>
          <PersonGridCard
            id={item.id}
            title={item.title}
            category={item.category}
            imageUrl={item.imageUrl}
            priceTier={asPriceTier(item.priceTier)}
            priceLevel={null}
            onPress={() => onCardPress(item.id)}
          />
          {item.isVisited && <VisitBadge />}
        </View>
      </View>
    ),
    [onCardPress],
  );

  const renderCategoryFilter = () => {
    if (!showCategoryFilter || !categories || categories.length === 0) return null;

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterContainer}
        style={styles.filterScroll}
      >
        <TouchableOpacity
          style={[
            styles.filterPill,
            !selectedCategory && styles.filterPillActive,
          ]}
          onPress={() => onCategoryChange?.(undefined)}
        >
          <Text
            style={[
              styles.filterPillText,
              !selectedCategory && styles.filterPillTextActive,
            ]}
          >
            All
          </Text>
        </TouchableOpacity>
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[
              styles.filterPill,
              selectedCategory === cat && styles.filterPillActive,
            ]}
            onPress={() => onCategoryChange?.(cat)}
          >
            <Text
              style={[
                styles.filterPillText,
                selectedCategory === cat && styles.filterPillTextActive,
              ]}
            >
              {cat}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onBack}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={24} color={colors.gray[900]} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.skeletonGrid}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </View>
      </View>
    );
  }

  // Error state
  if (isError) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onBack}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={24} color={colors.gray[900]} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={s(48)} color={colors.gray[400]} />
          <Text style={styles.errorText}>Something went wrong</Text>
          {onRetry && (
            <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
              <Text style={styles.retryText}>Try again</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={24} color={colors.gray[900]} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {renderCategoryFilter()}

      {items.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="albums-outline" size={s(48)} color={colors.gray[300]} />
          <Text style={styles.emptyTitle}>Nothing here yet</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.columnWrapper}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
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
  // Filter
  filterScroll: {
    maxHeight: vs(48),
  },
  filterContainer: {
    paddingHorizontal: s(24),
    gap: s(8),
    paddingBottom: vs(8),
  },
  filterPill: {
    paddingHorizontal: s(16),
    paddingVertical: vs(8),
    borderRadius: s(20),
    backgroundColor: colors.gray[100],
  },
  filterPillActive: {
    backgroundColor: colors.primary[500],
  },
  filterPillText: {
    fontSize: s(13),
    fontWeight: '500',
    color: colors.gray[600],
  },
  filterPillTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  // Grid
  gridContent: {
    paddingHorizontal: s(16),
    paddingBottom: vs(32),
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: vs(16),
  },
  cardWrapper: {
    width: CARD_WIDTH,
  },
  cardContainer: {
    position: 'relative',
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
    width: CARD_WIDTH,
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

export default PairedSavesListScreen;
