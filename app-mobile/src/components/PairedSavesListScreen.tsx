import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { s, vs } from '../utils/responsive';
import { colors } from '../constants/designSystem';
import {
  PairedSavesListHeader,
  PairedSavesSkeletonGrid,
  PairedSavesEmptyState,
  PairedSavesErrorState,
  pairedSavesGridStyles,
  renderPairedSaveItem,
  PAIRED_SAVES_NUM_COLUMNS,
  type PairedSavesListItem,
} from './pairedSaves/PairedSavesListPresentation';

// ── Types ──────────────────────────────────────────────────────────────────

// Issue #1540: the item shape, the grid geometry, the header, the cell renderer
// and the skeleton/empty/error states now live in the shared presentation owner
// (`pairedSaves/PairedSavesListPresentation`) so PersonHolidayView's saves SHEET
// can compose them directly under gorhom's content host. Re-exported here so the
// existing type name keeps resolving for any consumer that imports it.
export type ListItem = PairedSavesListItem;

interface PairedSavesListScreenProps {
  title: string;
  items: PairedSavesListItem[];
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

// ── Main Component ─────────────────────────────────────────────────────────

// Issue #1540: this screen is now the FULL-SCREEN consumer only (the visits
// pageSheet `<Modal>`). Its raw RN `FlatList` is correct inside a full-screen
// host, which bounds it. The previous in-a-sheet opt-in prop — which swapped in
// the gorhom sheet list while leaving it nested under this component's own
// `<View style={{flex:1}}>` wrapper — is DELETED: a gorhom scrollable under an
// intermediate wrapper never receives a bounded viewport (its onLayout height
// equalled its contentSize, i.e. zero scrollable overflow), which is exactly the
// #1540 defect. The saves sheet now mounts the gorhom list as a DIRECT child of
// `<BottomSheet>` via BaseBottomSheet's own `scrollMode="flatlist"` branch.
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
  const { t } = useTranslation(['social', 'common']);
  const renderItem = useCallback(
    (info: { item: PairedSavesListItem }) =>
      renderPairedSaveItem(info, onCardPress),
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
            {t('social:all')}
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
        <PairedSavesListHeader title={title} onBack={onBack} />
        <PairedSavesSkeletonGrid />
      </View>
    );
  }

  // Error state
  if (isError) {
    return (
      <View style={styles.container}>
        <PairedSavesListHeader title={title} onBack={onBack} />
        <PairedSavesErrorState onRetry={onRetry} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PairedSavesListHeader title={title} onBack={onBack} />

      {renderCategoryFilter()}

      {items.length === 0 ? (
        <PairedSavesEmptyState />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item: PairedSavesListItem) => item.id}
          renderItem={renderItem}
          numColumns={PAIRED_SAVES_NUM_COLUMNS}
          contentContainerStyle={pairedSavesGridStyles.gridContent}
          columnWrapperStyle={pairedSavesGridStyles.columnWrapper}
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
});

export default PairedSavesListScreen;
