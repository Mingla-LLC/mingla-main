/**
 * BaseBottomSheet — Mingla's single shared bottom-sheet primitive.
 *
 * META-ORCH-0991 [Consumer-app modals → slide-down bottom sheets] — Wave A.
 * SPEC:   Mingla_Artifacts/specs/SPEC_META-ORCH-0991_WAVE_A_BASE_BOTTOM_SHEET.md
 * DESIGN: Mingla_Artifacts/specs/DESIGN_META-ORCH-0991_WAVE_A_BASE_BOTTOM_SHEET.md
 *
 * ── Architecture invariants (load-bearing — do NOT re-litigate) ──────────────
 *   • ORCH-0828 (I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS): built on the
 *     VANILLA inline `<BottomSheet>` (default export of @gorhom/bottom-sheet).
 *     NO `BottomSheetModalProvider`, NO `@gorhom/portal`. Do not add one to
 *     "solve" z-stacking — that reverses the locked invariant.
 *   • ORCH-0908: z-stacking over the custom in-tree tab bar / chat input is done
 *     by wrapping the sheet in an RN `<Modal transparent animationType="none"
 *     statusBarTranslucent>` — exposed here as the opt-in `wrapInRNModal` prop.
 *   • ORCH-0696 / ORCH-0975: all sheet chrome derives from `glass.bottomSheet`
 *     (dark) / `glass.notificationsSheet` (light). No invented inline hex beyond
 *     a consumer's explicit per-surface parity override.
 *
 * This primitive is the SOLE permitted importer of `@gorhom/bottom-sheet` under
 * `app-mobile/src/` (enforced by the strict-grep gate
 * `meta-orch-0991-base-bottom-sheet-sole-consumer.mjs`,
 * I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER). Every other sheet surface
 * consumes this component.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Modal as RNModal,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetScrollView,
  BottomSheetSectionList,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// META-ORCH-0991 Wave B — keyboard-aware text input re-export. Form sheets
// (ReportUserModal, CustomHolidayModal, …) need gorhom's BottomSheetTextInput
// so a focused field coordinates with the sheet position instead of being
// hidden by the keyboard. Because the strict-grep gate
// (I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER) forbids any other
// app-mobile/src file from importing @gorhom/bottom-sheet directly, the
// primitive re-exports it. Consumers: `import { BaseBottomSheet,
// BottomSheetTextInput } from '.../ui/BaseBottomSheet'`.
export { BottomSheetTextInput };

// META-ORCH-0991 Wave B Batch 3 — re-export the gorhom scroll container for
// consumers that own their body tree (scrollMode="view") but still need a
// gorhom-aware bounded inner scroll region (PendingCollabChatSheet's people
// list). A raw RN <ScrollView> nested in a gorhom sheet fights the sheet's pan
// gesture; BottomSheetScrollView coordinates with it. Same gate rationale as
// BottomSheetTextInput above (consumers may not import @gorhom/bottom-sheet).
export { BottomSheetScrollView };

import { glass } from '../../constants/designSystem';

// ── Snap/settle motion: STOCK gorhom default ────────────────────────────────
// META-ORCH-0991 Wave A REWORK (operator decision 2026-05-29): the custom
// `SHEET_SPRING` (damping 50 / stiffness 320 / overshootClamping) is REMOVED.
// This primitive now passes NO `animationConfigs` to <BottomSheet>, so gorhom
// uses its DEFAULT spring — the exact open/close/settle feel of
// `ExpandedBusinessEventSheet` (the gold-standard sheet, itself one of the 5
// Wave-A consumers). gorhom's default already honors the OS reduce-motion
// setting internally, so no Reanimated `ReduceMotion` wiring is needed here.
// The custom spring + the DESIGN §3 handle-active micro-interaction were
// REJECTED; see DESIGN_META-ORCH-0991_WAVE_A_BASE_BOTTOM_SHEET.md §3/§2.

export type BaseBottomSheetTheme = 'dark' | 'light';
export type BaseBottomSheetVariant = 'sheet' | 'center-dialog';
export type BaseBottomSheetScrollMode =
  | 'view'
  | 'scroll'
  | 'flatlist'
  | 'sectionlist';

/**
 * `scrollProps` accepts the union of the four gorhom body-container prop shapes.
 *
 * DEVIATION D-2 (SPEC §3.1): the SPEC asked for a discriminated union keyed on
 * `scrollMode` so a consumer cannot pass `sections` to a `scroll` body. That
 * makes a *dynamically-computed* `scrollMode` (e.g. TicketCartSheet picks
 * 'scroll' vs 'view' by render-state) impossible to type — TS cannot collapse a
 * union scrollMode to one member. Several Wave-A migrations need a dynamic
 * scrollMode, so `scrollProps` is the looser union here. The body `switch`
 * (which container actually renders) still guarantees "no raw RN list inside a
 * sheet" (SC-10) at runtime; the discriminated *type* guard is the only thing
 * relaxed. Documented in the implementation report.
 */
export type BaseBottomSheetScrollProps =
  | Partial<React.ComponentProps<typeof BottomSheetScrollView>>
  | Partial<React.ComponentProps<typeof BottomSheetFlatList>>
  | Partial<React.ComponentProps<typeof BottomSheetSectionList>>
  | Partial<React.ComponentProps<typeof BottomSheetView>>;

interface BaseBottomSheetCommonProps {
  /** Declarative open/close. Drives `index={visible ? initialIndex : -1}`. */
  visible: boolean;
  /**
   * Called on `onChange(-1)` (pan-down + backdrop-press) AND on the visible→false
   * close path. Wire ALL dismiss analytics here, never on a button handler, so
   * pan-down and explicit close fire identically (SPEC §3.1 / §9 blast #4).
   */
  onClose: () => void;
  /** Optional passthrough — fires AFTER the internal onClose handling. */
  onChange?: (index: number) => void;
  /** Sheet body. For `view` mode, render your own gorhom container(s) here. */
  children?: ReactNode;
  /** Sheet-level a11y label. */
  accessibilityLabel?: string;
}

interface BaseBottomSheetSheetProps extends BaseBottomSheetCommonProps {
  variant?: 'sheet';
  /** Exact snapPoints for this surface (string = percentage). */
  snapPoints?: (string | number)[];
  /** Snap index used when `visible` flips true. Default 0. */
  initialIndex?: number;
  /** gorhom v5 default is true; primitive overrides to false (SPEC §3.1). */
  enableDynamicSizing?: boolean;
  /** Default true — swipe-down-to-dismiss is the core contract. */
  enablePanDownToClose?: boolean;
  theme?: BaseBottomSheetTheme;
  /** Picks the gorhom body container. Default 'scroll'. */
  scrollMode?: BaseBottomSheetScrollMode;
  /** Forwarded to the chosen scrollable (sections/renderItem/contentContainerStyle…). */
  scrollProps?: BaseBottomSheetScrollProps;
  /**
   * Fixed (non-scrolling) content rendered ABOVE the scroll/list body, inside a
   * single flexed BottomSheetView. The classic header pattern (title + close +
   * action row) for scroll/sectionlist sheets. When set with scrollMode scroll/
   * sectionlist, the body claims flex:1 below it.
   */
  header?: ReactNode;
  /** Style for the outer flexed BottomSheetView when `header` is set. */
  bodyContainerStyle?: ViewStyle;
  /** Pins a footer at the bottom of a single flexed container (TicketCart pattern). */
  stickyFooter?: ReactNode;
  /** ORCH-0908 z-stacking-over-tab-bar escape hatch. Default false. */
  wrapInRNModal?: boolean;
  keyboardBehavior?: 'interactive' | 'extend' | 'fillParent';
  keyboardBlurBehavior?: 'none' | 'restore';
  android_keyboardInputMode?: 'adjustPan' | 'adjustResize';
  showHandle?: boolean;
  /** Full per-consumer override of the handle indicator (parity floor, SPEC §6). */
  handleStyle?: ViewStyle;
  /** Full per-consumer override of the sheet background (parity floor, SPEC §6/§7). */
  backgroundStyle?: ViewStyle;
  /** Theme-derived default if omitted (light 0.32 / dark 0.55). */
  backdropOpacity?: number;
}

interface BaseBottomSheetCenterDialogProps extends BaseBottomSheetCommonProps {
  variant: 'center-dialog';
  theme?: BaseBottomSheetTheme;
}

export type BaseBottomSheetProps =
  | BaseBottomSheetSheetProps
  | BaseBottomSheetCenterDialogProps;

/** Theme-derived default backdrop opacity (SPEC §3.1 / §6). */
function defaultBackdropOpacity(theme: BaseBottomSheetTheme): number {
  return theme === 'dark' ? 0.55 : 0.32;
}

/** Theme-derived default background chrome (SPEC §6.1 / §6.2). */
function defaultBackgroundStyle(theme: BaseBottomSheetTheme): ViewStyle {
  if (theme === 'dark') {
    return {
      backgroundColor: '#0c0e12',
      borderTopLeftRadius: glass.bottomSheet.topRadius,
      borderTopRightRadius: glass.bottomSheet.topRadius,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: glass.bottomSheet.hairline,
    };
  }
  return {
    backgroundColor: glass.notificationsSheet.canvas,
    borderTopLeftRadius: glass.notificationsSheet.topRadius,
    borderTopRightRadius: glass.notificationsSheet.topRadius,
  };
}

/** Theme-derived default handle indicator (SPEC §6.1 / §6.2). */
function defaultHandleStyle(theme: BaseBottomSheetTheme): ViewStyle {
  const h = theme === 'dark' ? glass.bottomSheet.handle : glass.notificationsSheet.handle;
  return { backgroundColor: h.color, width: h.width, height: h.height };
}

/**
 * Resolve the effective backdrop opacity, flooring it UP when OS
 * reduce-transparency is on (DESIGN §6.2 — flat, never blur).
 */
function useEffectiveBackdropOpacity(
  theme: BaseBottomSheetTheme,
  requested: number | undefined,
): number {
  const base = requested ?? defaultBackdropOpacity(theme);
  const [reduceTransparency, setReduceTransparency] = React.useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled?.().then((v) => {
      if (mounted) setReduceTransparency(!!v);
    });
    const sub = AccessibilityInfo.addEventListener?.(
      'reduceTransparencyChanged',
      (v: boolean) => setReduceTransparency(!!v),
    );
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  if (!reduceTransparency) return base;
  // Floor UP to the a11y tint's alpha; never reduce opacity.
  const floor = theme === 'dark' ? 0.62 : 0.45;
  return Math.max(base, floor);
}

function BaseBottomSheetComponent(props: BaseBottomSheetProps): React.ReactElement | null {
  const { visible, onClose, onChange, children, accessibilityLabel } = props;
  const theme: BaseBottomSheetTheme = props.theme ?? 'light';
  const insets = useSafeAreaInsets();
  const sheetRef = useRef<BottomSheet>(null);

  // ── center-dialog: NOT gorhom (SPEC §3.1 / §5.4). Wave A ships the typed
  // prop + a faithful RN-Modal centered card. Visual chrome from
  // glass.centerDialog. First real consumers are Wave-B confirm dialogs.
  if (props.variant === 'center-dialog') {
    return (
      <CenterDialog
        visible={visible}
        onClose={onClose}
        theme={theme}
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </CenterDialog>
    );
  }

  const {
    snapPoints,
    initialIndex = 0,
    enableDynamicSizing = false,
    enablePanDownToClose = true,
    scrollMode = 'scroll',
    scrollProps,
    header,
    bodyContainerStyle,
    stickyFooter,
    wrapInRNModal = false,
    keyboardBehavior = 'interactive',
    keyboardBlurBehavior = 'restore',
    android_keyboardInputMode = 'adjustResize',
    showHandle = true,
    handleStyle,
    backgroundStyle,
    backdropOpacity,
  } = props;

  const effectiveBackdropOpacity = useEffectiveBackdropOpacity(theme, backdropOpacity);

  // Open/close mirror of the proven pattern (SPEC §3.3): snapToIndex on open,
  // close on hide. Declarative `index` covers first mount; this covers
  // mid-life visible toggles.
  useEffect(() => {
    if (visible) {
      sheetRef.current?.snapToIndex(initialIndex);
    } else {
      sheetRef.current?.close();
    }
  }, [visible, initialIndex]);

  // Android hardware-back for NON-wrapped sheets (SPEC §3.3 / §9 blast #6).
  // Wrapped sheets get back via the RN <Modal onRequestClose>.
  useEffect(() => {
    if (wrapInRNModal || !visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [wrapInRNModal, visible, onClose]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
      onChange?.(index);
    },
    [onClose, onChange],
  );

  const renderBackdrop = useCallback(
    (backdropProps: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...backdropProps}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={effectiveBackdropOpacity}
        pressBehavior="close"
      />
    ),
    [effectiveBackdropOpacity],
  );

  const resolvedBackgroundStyle = backgroundStyle ?? defaultBackgroundStyle(theme);
  const resolvedHandleStyle = showHandle
    ? (handleStyle ?? defaultHandleStyle(theme))
    : undefined;

  // Body composition. `view` mode renders children directly as <BottomSheet>
  // children (consumer owns the container tree — the zero-regression path for
  // the keystone sheets). scroll/flatlist/sectionlist let the primitive own the
  // gorhom scrollable so no raw RN list ever lands inside a sheet (SC-10).
  const body = useMemo(() => {
    const safeBottom = Math.max(insets.bottom, 16);
    void safeBottom;
    if (stickyFooter !== undefined && stickyFooter !== null) {
      // Single flexed container: header (fixed) + scroll/view body claims flex:1
      // + footer pinned at the bottom (TicketCart pattern, SPEC §3.1). The body
      // scrolls when scrollMode='scroll' (gorhom BottomSheetScrollView) so the
      // cart list pans without fighting the sheet. The footer node owns its own
      // safe-area bottom padding (parity: TicketCart's insets.bottom+16, SPEC §7.2).
      const stickyBody =
        scrollMode === 'scroll' ? (
          <BottomSheetScrollView
            style={styles.stickyBody}
            {...(scrollProps as Partial<
              React.ComponentProps<typeof BottomSheetScrollView>
            >)}
          >
            {children}
          </BottomSheetScrollView>
        ) : (
          <View style={styles.stickyBody}>{children}</View>
        );
      return (
        <BottomSheetView style={[styles.stickyContainer, bodyContainerStyle]}>
          {header}
          {stickyBody}
          {stickyFooter}
        </BottomSheetView>
      );
    }

    const hasHeader = header !== undefined && header !== null;

    switch (scrollMode) {
      case 'view':
        // Children render directly as <BottomSheet> children (consumer-composed).
        // A header, when present, is wrapped with the children in a flex View.
        if (hasHeader) {
          return (
            <BottomSheetView style={[styles.flexContainer, bodyContainerStyle]}>
              {header}
              {children}
            </BottomSheetView>
          );
        }
        return children;
      case 'scroll': {
        const scroll = (
          <BottomSheetScrollView
            {...(scrollProps as Partial<React.ComponentProps<typeof BottomSheetScrollView>>)}
          >
            {children}
          </BottomSheetScrollView>
        );
        if (hasHeader) {
          return (
            <BottomSheetView style={[styles.flexContainer, bodyContainerStyle]}>
              {header}
              {scroll}
            </BottomSheetView>
          );
        }
        return scroll;
      }
      case 'flatlist':
        return (
          <BottomSheetFlatList
            {...(scrollProps as React.ComponentProps<typeof BottomSheetFlatList>)}
            ListHeaderComponent={
              (header ?? children) as React.ComponentProps<
                typeof BottomSheetFlatList
              >['ListHeaderComponent']
            }
          />
        );
      case 'sectionlist': {
        const sectionProps = scrollProps as
          | Partial<React.ComponentProps<typeof BottomSheetSectionList>>
          | undefined;
        const hasSections =
          sectionProps?.sections !== undefined &&
          sectionProps.sections !== null;
        // header + children render above the list. When sections are omitted
        // (consumer-owned loading/empty/error state in children), only the
        // header + children render — no list. (NotificationsSheet pattern.)
        return (
          <BottomSheetView style={[styles.sectionListContainer, bodyContainerStyle]}>
            {header}
            {children}
            {hasSections ? (
              <BottomSheetSectionList
                {...(sectionProps as React.ComponentProps<typeof BottomSheetSectionList>)}
                style={[styles.sectionList, sectionProps?.style]}
              />
            ) : null}
          </BottomSheetView>
        );
      }
      default: {
        const exhaustive: never = scrollMode;
        return exhaustive;
      }
    }
  }, [
    scrollMode,
    scrollProps,
    header,
    bodyContainerStyle,
    children,
    stickyFooter,
    insets.bottom,
  ]);

  const sheet = (
    <BottomSheet
      ref={sheetRef}
      index={visible ? initialIndex : -1}
      snapPoints={snapPoints}
      enableDynamicSizing={enableDynamicSizing}
      enablePanDownToClose={enablePanDownToClose}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={resolvedBackgroundStyle}
      handleIndicatorStyle={resolvedHandleStyle}
      handleComponent={showHandle ? undefined : null}
      keyboardBehavior={keyboardBehavior}
      keyboardBlurBehavior={keyboardBlurBehavior}
      android_keyboardInputMode={android_keyboardInputMode}
      accessible={false}
      accessibilityLabel={accessibilityLabel}
    >
      {body}
    </BottomSheet>
  );

  if (wrapInRNModal) {
    // ORCH-0908 z-stack: RN <Modal> hosts a separate OS overlay window so the
    // sheet lifts above the custom in-tree tab bar / chat input. RN Modal also
    // provides native accessibilityViewIsModal focus-trap + Android back.
    return (
      <RNModal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        {sheet}
      </RNModal>
    );
  }

  // Non-wrapped: announce a modal boundary for VoiceOver so focus does not leak
  // to content behind the sheet (SPEC §5 a11y / §9 blast #5). The sheet floats
  // absolutely; this View provides the modal semantics RN <Modal> gives wrapped
  // sheets for free. pointerEvents=box-none keeps the backdrop/sheet interactive.
  if (!visible) return sheet;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="box-none"
      accessibilityViewIsModal
    >
      {sheet}
    </View>
  );
}

// ── center-dialog body (SPEC §5.4 / DESIGN §5) ───────────────────────────────
// Centered confirm card on a flat scrim. NO pan-down. RN Modal + Animated.View
// per the IncomingPairRequestCard pattern. Honors reduce-motion (instant) and
// reduce-transparency (heavier flat scrim). Wave A ships this faithfully so the
// `variant="center-dialog"` prop is real, not a stub.
function CenterDialog({
  visible,
  onClose,
  theme,
  accessibilityLabel,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  theme: BaseBottomSheetTheme;
  accessibilityLabel?: string;
  children?: ReactNode;
}): React.ReactElement {
  const cd = glass.centerDialog;
  const palette = theme === 'dark' ? cd.dark : cd.light;
  const [reduceTransparency, setReduceTransparency] = React.useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled?.().then((v) => {
      if (mounted) setReduceTransparency(!!v);
    });
    const sub = AccessibilityInfo.addEventListener?.(
      'reduceTransparencyChanged',
      (v: boolean) => setReduceTransparency(!!v),
    );
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  const scrimColor = reduceTransparency
    ? theme === 'dark'
      ? cd.a11y.reduceTransparency.darkBackdropTint
      : cd.a11y.reduceTransparency.lightBackdropTint
    : palette.backdropTint;

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={[styles.centerScrim, { backgroundColor: scrimColor }]}>
        <View
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel}
          style={[
            styles.centerCard,
            cd.shadow,
            {
              maxWidth: cd.maxWidth,
              borderRadius: cd.radius,
              paddingVertical: cd.paddingVertical,
              paddingHorizontal: cd.paddingHorizontal,
              backgroundColor: palette.canvas,
              borderColor: palette.hairline,
            },
          ]}
        >
          {children}
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  flexContainer: { flex: 1 },
  stickyContainer: { flex: 1 },
  stickyBody: { flex: 1 },
  sectionListContainer: { flex: 1 },
  sectionList: { flex: 1 },
  centerScrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: glass.centerDialog.horizontalMargin,
  },
  centerCard: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
  },
});

export const BaseBottomSheet = BaseBottomSheetComponent;
export default BaseBottomSheet;
