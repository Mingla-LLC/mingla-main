/**
 * [ORCH-1540-DIAG] TEMPORARY diagnostic route — issue #1540.
 *
 * Reproduces the paired-profile "liked cards" saves sheet in isolation (no auth,
 * no pairing, no network) so the non-scrolling defect can be instrumented.
 *
 * Variant A = EXACTLY what PersonHolidayView.tsx:1063-1099 mounts today:
 *   BaseBottomSheet snapPoints={['90%']} wrapInRNModal scrollMode="view"
 *     └─ PairedSavesListScreen (its own <View flex:1> wrapper)
 *          └─ BottomSheetFlatList        ← NOT a direct child of <BottomSheet>
 *
 * Variant B = the FriendPickerSheet-sanctioned shape:
 *   BaseBottomSheet snapPoints={['90%']} wrapInRNModal scrollMode="flatlist"
 *     └─ BottomSheetFlatList             ← DIRECT child of <BottomSheet>
 *
 * Everything else is held constant. Delete this file before the fix PR.
 */
import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { BaseBottomSheet } from '../src/components/ui/BaseBottomSheet';
import PairedSavesListScreen from '../src/components/PairedSavesListScreen';
import PersonGridCard from '../src/components/PersonGridCard';
import { s, vs, SCREEN_WIDTH } from '../src/utils/responsive';

const TAG = '[ORCH-1540-DIAG]';
const SNAP = ['90%'];
const CARD_WIDTH = (SCREEN_WIDTH - s(48)) / 2;

// 30 synthetic saves — well past what a 90% sheet can show, so a working list
// MUST have overflow to scroll.
const ITEMS = Array.from({ length: 30 }, (_, i) => ({
  id: `diag-${i}`,
  title: `Saved place ${i + 1}`,
  category: 'Drink',
  imageUrl: '',
  priceTier: 'comfy' as const,
  rating: 4.5,
  timestamp: '2026-08-04T00:00:00.000Z',
  timestampLabel: 'Saved',
}));

export default function Diag1540() {
  const [variant, setVariant] = useState<null | 'A' | 'B'>(null);

  const close = useCallback(() => setVariant(null), []);

  const renderItemB = useCallback(
    ({ item }: { item: (typeof ITEMS)[number] }) => (
      <View style={{ width: CARD_WIDTH }}>
        <PersonGridCard
          id={item.id}
          title={item.title}
          category={item.category}
          imageUrl={item.imageUrl}
          priceTier={item.priceTier}
          priceLevel={null}
          onPress={() => {}}
          width={CARD_WIDTH}
        />
      </View>
    ),
    [],
  );

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.h1}>#1540 saves-sheet probe</Text>
      <Text style={styles.p}>
        30 items. Open a variant, then try to drag the grid upward.
      </Text>

      <TouchableOpacity
        style={styles.btn}
        onPress={() => {
          console.log(`${TAG} open variant=A (scrollMode="view", current prod shape)`);
          setVariant('A');
        }}
      >
        <Text style={styles.btnText}>A — current: scrollMode="view"</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.btn, styles.btnAlt]}
        onPress={() => {
          console.log(`${TAG} open variant=B (scrollMode="flatlist", candidate fix)`);
          setVariant('B');
        }}
      >
        <Text style={styles.btnText}>B — candidate: scrollMode="flatlist"</Text>
      </TouchableOpacity>

      {/* ── Variant A: byte-faithful to PersonHolidayView's current mount ── */}
      <BaseBottomSheet
        visible={variant === 'A'}
        onClose={close}
        snapPoints={SNAP}
        wrapInRNModal
        scrollMode="view"
        accessibilityLabel="diag A"
      >
        <PairedSavesListScreen
          title="Variant A — view mode"
          inBottomSheet
          items={ITEMS}
          onBack={close}
          onCardPress={(id) => console.log(`${TAG} A card press ${id}`)}
        />
      </BaseBottomSheet>

      {/* ── Variant B: scrollable as DIRECT child of <BottomSheet> ── */}
      <BaseBottomSheet
        visible={variant === 'B'}
        onClose={close}
        snapPoints={SNAP}
        wrapInRNModal
        scrollMode="flatlist"
        accessibilityLabel="diag B"
        header={
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Variant B — flatlist mode</Text>
            <TouchableOpacity onPress={close}>
              <Text style={styles.sheetClose}>Close</Text>
            </TouchableOpacity>
          </View>
        }
        scrollProps={{
          data: ITEMS,
          keyExtractor: (item: (typeof ITEMS)[number]) => item.id,
          renderItem: renderItemB,
          numColumns: 2,
          columnWrapperStyle: { justifyContent: 'space-between', marginBottom: vs(12), gap: s(12) },
          contentContainerStyle: { paddingHorizontal: s(16), paddingTop: vs(8), paddingBottom: vs(32) },
          showsVerticalScrollIndicator: false,
          onLayout: (e: any) =>
            console.log(`${TAG} B list.onLayout h=${e.nativeEvent.layout.height}`),
          onContentSizeChange: (_w: number, h: number) =>
            console.log(`${TAG} B list.contentSize h=${h}`),
          onScroll: (e: any) =>
            console.log(`${TAG} B scroll y=${e.nativeEvent.contentOffset.y}`),
          scrollEventThrottle: 16,
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff', padding: s(20), gap: vs(12) },
  h1: { fontSize: s(22), fontWeight: '800', color: '#111827', marginTop: vs(24) },
  p: { fontSize: s(14), color: '#6b7280' },
  btn: {
    backgroundColor: '#eb7825',
    borderRadius: s(14),
    paddingVertical: vs(16),
    alignItems: 'center',
  },
  btnAlt: { backgroundColor: '#111827' },
  btnText: { color: '#ffffff', fontWeight: '700', fontSize: s(15) },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(20),
    paddingTop: vs(12),
    paddingBottom: vs(12),
  },
  sheetTitle: { fontSize: s(17), fontWeight: '700', color: '#111827' },
  sheetClose: { fontSize: s(15), fontWeight: '600', color: '#eb7825' },
});
