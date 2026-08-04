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

// [ORCH-1540-DIAG] 10 synthetic saves — a REALISTIC saved-list size: taller than
// the visible 90% sheet (so the user must scroll) but SHORTER than the degenerate
// content-sized viewport variant A produces (so there is no overflow to scroll).
const ITEMS = Array.from({ length: 10 }, (_, i) => ({
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
  const [variant, setVariant] = useState<null | 'A' | 'A2' | 'A3' | 'B'>(null);

  const close = useCallback(() => setVariant(null), []);

  // [ORCH-1540-DIAG] Variant A3 mirrors the REAL sheet: it opens while the paired
  // saves query is still in flight (PairedSavesListScreen renders its skeleton
  // branch, NOT the list), and the BottomSheetFlatList only mounts ~800ms later.
  const [a3Loading, setA3Loading] = useState(true);
  const openA3 = useCallback(() => {
    console.log(`${TAG} open variant=A3 (view mode, list mounts AFTER sheet opens)`);
    setA3Loading(true);
    setVariant('A3');
    setTimeout(() => {
      console.log(`${TAG} A3 loading -> false (list mounts now)`);
      setA3Loading(false);
    }, 800);
  }, []);

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
        10 items. Open a variant, then try to drag the grid upward.
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
        style={[styles.btn, styles.btnA2]}
        onPress={() => {
          console.log(`${TAG} open variant=A2 (view mode + explicit flex:1 on list)`);
          setVariant('A2');
        }}
      >
        <Text style={styles.btnText}>A′ — view mode + flex:1 on list</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.btn, styles.btnA3]} onPress={openA3}>
        <Text style={styles.btnText}>A″ — view mode, loading → loaded</Text>
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
          diagLabel="A"
          items={ITEMS}
          onBack={close}
          onCardPress={(id) => console.log(`${TAG} A card press ${id}`)}
        />
      </BaseBottomSheet>

      {/* ── Variant A′: identical to A, plus an explicit flex:1 on the list ── */}
      <BaseBottomSheet
        visible={variant === 'A2'}
        onClose={close}
        snapPoints={SNAP}
        wrapInRNModal
        scrollMode="view"
        accessibilityLabel="diag A prime"
      >
        <PairedSavesListScreen
          title="Variant A′ — view mode + flex:1"
          inBottomSheet
          diagLabel="A2"
          diagListFlex
          items={ITEMS}
          onBack={close}
          onCardPress={(id) => console.log(`${TAG} A2 card press ${id}`)}
        />
      </BaseBottomSheet>

      {/* ── Variant A″: faithful to the real sheet — opens in the skeleton
          (isLoading) branch, list mounts only after the query resolves. ── */}
      <BaseBottomSheet
        visible={variant === 'A3'}
        onClose={close}
        snapPoints={SNAP}
        wrapInRNModal
        scrollMode="view"
        accessibilityLabel="diag A3"
      >
        <PairedSavesListScreen
          title="Variant A - loading first"
          inBottomSheet
          diagLabel="A3"
          isLoading={a3Loading}
          items={ITEMS}
          onBack={close}
          onCardPress={(id) => console.log(`${TAG} A3 card press ${id}`)}
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
  btnA2: { backgroundColor: '#0f766e' },
  btnA3: { backgroundColor: '#7c2d12' },
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
