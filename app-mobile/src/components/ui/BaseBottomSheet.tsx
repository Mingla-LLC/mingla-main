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
  useWindowDimensions,
  type StyleProp,
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
// META-ORCH-0991 (sheet rework — Bug 1): GestureHandlerRootView must wrap the
// sheet INSIDE the RN <Modal> window so gorhom's pan-down-to-dismiss
// PanGestureHandler registers there. RN <Modal> mounts its children in a
// separate native window that the host-tree GestureHandlerRootView (in
// app/_layout.tsx) does NOT extend into — without a GHRV inside the modal,
// swipe-down-to-close is dead on Android and fragile on iOS.
// react-native-gesture-handler is already a dependency (v2.x).
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// META-ORCH-0991 (sheet rework — Bug 4): the floating-nav footprint is owned by
// useAppLayout. The primitive reads the SAME constant so a sheet rendered below
// the visible GlassBottomNav can clear it (single source of truth — no copy).
import { BOTTOM_NAV_CONTENT_HEIGHT } from '../../hooks/useAppLayout';
import {
  pushHideBottomNav,
  popHideBottomNav,
} from '../../store/bottomNavStore';

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

// META-ORCH-0991 Wave B Batch 5 — re-export the gorhom FlatList for consumers
// that own their body tree (scrollMode="view") AND need a VERTICAL list inside
// the sheet (PersonHolidayView's 2-column saves grid). A raw RN <FlatList>
// nested in a gorhom sheet fights the sheet's pan gesture; BottomSheetFlatList
// coordinates with it. Same gate rationale as the two re-exports above.
export { BottomSheetFlatList };

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
  /**
   * META-ORCH-0991 (sheet rework — Bug 4): when true, the primitive adds the
   * floating GlassBottomNav content height to the body's bottom padding so the
   * last button/content clears Mingla's floating tab bar (not just the OS home
   * indicator). Use for sheets rendered BELOW the visible nav. `wrapInRNModal`
   * sheets z-stack ABOVE the nav (nav hidden behind the backdrop), so they leave
   * this false and only get the OS-inset clearance. Default false.
   */
  tabBarAware?: boolean;
  /**
   * ORCH-1016 — when true, the floating GlassBottomNav is HIDDEN while this sheet
   * is visible (ref-counted via bottomNavStore). Use for FULL detail/checkout
   * sheets (trip detail, ticket/reserve, cart, place/event detail) whose content
   * would otherwise sit behind the nav. Brings the sheet "forward" without an RN
   * Modal — so the Buy/Reserve CTA is fully visible with nothing painted over it.
   * Default false.
   */
  hidesBottomNav?: boolean;
  /**
   * Optional inline-container clearance for sheets rendered below an absolute
   * sibling such as GlassBottomNav. Inner padding/spacers affect scrollable
   * content; this keeps gorhom's measured inline host at the real window height
   * while accounting for the overlay's bottom footprint.
   */
  bottomSheetInset?: number;
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
  const { height: windowHeight } = useWindowDimensions();
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
    tabBarAware = false,
    hidesBottomNav = false,
    bottomSheetInset = 0,
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

  // ORCH-1016 — hide the floating GlassBottomNav while a full detail/checkout sheet
  // is open, so its bottom content/CTA isn't painted over by the nav. Ref-counted
  // so overlapping sheets each hold it hidden until the last closes.
  useEffect(() => {
    if (!visible || !hidesBottomNav) return undefined;
    pushHideBottomNav();
    return () => popHideBottomNav();
  }, [visible, hidesBottomNav]);

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
  // META-ORCH-0991 (sheet rework — Bug 4b): the bottom-inset model the primitive
  // now OWNS. Previously `safeBottom` was computed and then `void`-discarded, so
  // every consumer had to hand-roll its own bottom padding and any sheet that
  // forgot clipped its buttons under the OS home indicator / Android nav bar.
  //   • `safeBottom`  = max(OS bottom inset, 16) — clears the home indicator.
  //   • `+ tab bar`   = when `tabBarAware`, add the floating GlassBottomNav
  //                     content height so the last button clears Mingla's menu
  //                     too (only for sheets rendered BELOW the visible nav —
  //                     wrapInRNModal sheets z-stack above it and leave it off).
  // The computed value is applied as `paddingBottom` on the scroll/list content
  // container and the sticky-footer container, MERGED with any consumer-supplied
  // paddingBottom via Math.max so a sheet that already hand-rolls more padding
  // (e.g. PreferencesSheet) is never REDUCED (zero-regression for the 34 sheets).
  // Plain (non-hook) derivations: this code path runs only in the `sheet`
  // variant, AFTER the `center-dialog` early return above. Computing these as
  // plain consts/functions (NOT useMemo/useCallback) keeps the primitive's hook
  // order identical to the pre-rework file (the existing hooks all sit above the
  // early return) and avoids adding conditionally-called hooks. `bottomInset` is
  // a cheap scalar; `withBottomInset` is referenced only by the `body` useMemo
  // (which already lists `insets.bottom` + `tabBarAware` transitively via its
  // own deps), so memoizing it buys nothing.
  const safeBottomInset = Math.max(insets.bottom, 16);
  // The floating-nav clearance is ADDITIVE on top of the OS inset, and is applied
  // ONLY when `tabBarAware` (a non-wrapInRNModal sheet rendered below the visible
  // GlassBottomNav). For the bottommost body element (a non-sticky scroll/list)
  // the full `bottomInset` is the right padding; for the sticky-footer pattern
  // the tab-bar clearance belongs to the FOOTER (the true bottommost element) and
  // the scroll body above it only needs footer clearance — see the sticky branch.
  const tabBarExtra = tabBarAware ? BOTTOM_NAV_CONTENT_HEIGHT : 0;
  const bottomInset = safeBottomInset + tabBarExtra;
  const inlineContainerHeight = windowHeight + Math.max(0, bottomSheetInset);

  // Merge `bottomInset` into a consumer's contentContainerStyle as paddingBottom,
  // taking the MAX with any value the consumer already set (never reduce).
  const withBottomInset = (cc: StyleProp<ViewStyle>): StyleProp<ViewStyle> => {
    const flat = StyleSheet.flatten(cc) as ViewStyle | undefined;
    const existing =
      typeof flat?.paddingBottom === 'number' ? flat.paddingBottom : 0;
    const paddingBottom = Math.max(existing, bottomInset);
    return cc === undefined || cc === null
      ? { paddingBottom }
      : [cc, { paddingBottom }];
  };

  // Sticky-footer variant of the merge: the scroll body that sits ABOVE a sticky
  // footer must NOT carry the tab-bar height (that would open a tall empty gap
  // above the pinned footer). It only needs the OS-inset footer clearance.
  const withFooterClearance = (cc: StyleProp<ViewStyle>): StyleProp<ViewStyle> => {
    const flat = StyleSheet.flatten(cc) as ViewStyle | undefined;
    const existing =
      typeof flat?.paddingBottom === 'number' ? flat.paddingBottom : 0;
    const paddingBottom = Math.max(existing, safeBottomInset);
    return cc === undefined || cc === null
      ? { paddingBottom }
      : [cc, { paddingBottom }];
  };

  // Body composition. `view` mode renders children directly as <BottomSheet>
  // children (consumer owns the container tree — the zero-regression path for
  // the keystone sheets). scroll/flatlist/sectionlist let the primitive own the
  // gorhom scrollable so no raw RN list ever lands inside a sheet (SC-10).
  const body = useMemo(() => {
    if (stickyFooter !== undefined && stickyFooter !== null) {
      // Single flexed container: header (fixed) + scroll/view body claims flex:1
      // + footer pinned at the bottom (TicketCart pattern, SPEC §3.1). The body
      // scrolls when scrollMode='scroll' (gorhom BottomSheetScrollView) so the
      // cart list pans without fighting the sheet.
      //
      // META-ORCH-0991 Bug 4a fix: the scroll body MUST own flex:1 AND a
      // bounded height so a tall body still scrolls when a header/footer is
      // present. `styles.stickyBody` (flex:1) + the outer flexed container give
      // gorhom's BottomSheetScrollView a bounded viewport; without flex:1 the
      // inner scroll would size to content and never scroll. The scroll content
      // gets only the OS-inset footer clearance (`withFooterClearance`) — NOT the
      // tab-bar height — because the footer below it is the true bottommost
      // element; padding the scroll with the nav height would open a gap above
      // the pinned footer.
      const stickyBody =
        scrollMode === 'scroll' ? (
          <BottomSheetScrollView
            style={styles.stickyBody}
            {...(scrollProps as Partial<
              React.ComponentProps<typeof BottomSheetScrollView>
            >)}
            contentContainerStyle={withFooterClearance(
              (
                scrollProps as Partial<
                  React.ComponentProps<typeof BottomSheetScrollView>
                >
              )?.contentContainerStyle,
            )}
          >
            {children}
          </BottomSheetScrollView>
        ) : (
          <View style={styles.stickyBody}>{children}</View>
        );
      // META-ORCH-0991 Bug 4 (tab-bar awareness): when `tabBarAware`, the sticky
      // footer is the bottommost element and must clear BOTH the OS home indicator
      // AND Mingla's floating GlassBottomNav. Wrap it with `bottomInset`
      // (safeBottom + nav height) padding. This wrapper is added ONLY when
      // tabBarAware, so non-tabBarAware sticky-footer sheets (e.g. TicketCartSheet,
      // which already hand-rolls `insets.bottom+16` on its own footer) are
      // untouched and never double-padded.
      const footerNode = tabBarAware ? (
        <View style={{ paddingBottom: bottomInset }}>{stickyFooter}</View>
      ) : (
        stickyFooter
      );
      return (
        <BottomSheetView style={[styles.stickyContainer, bodyContainerStyle]}>
          {header}
          {stickyBody}
          {footerNode}
        </BottomSheetView>
      );
    }

    const hasHeader = header !== undefined && header !== null;

    switch (scrollMode) {
      case 'view':
        // Children render directly as <BottomSheet> children by default
        // (consumer-composed). When a consumer supplies a body container, honor it
        // with the same flexed BottomSheetView wrapper used by header-bearing view
        // sheets so an owned BottomSheetScrollView receives a bounded viewport.
        if (hasHeader || bodyContainerStyle !== undefined) {
          return (
            <BottomSheetView style={[styles.flexContainer, bodyContainerStyle]}>
              {header}
              {children}
            </BottomSheetView>
          );
        }
        return children;
      case 'scroll': {
        const scrollPropsTyped = scrollProps as
          | Partial<React.ComponentProps<typeof BottomSheetScrollView>>
          | undefined;
        const scroll = (
          <BottomSheetScrollView
            {...scrollPropsTyped}
            // META-ORCH-0991 Bug 4a: when a header is present the scroll must
            // claim flex:1 so it gets a bounded viewport BELOW the fixed header
            // and a tall (overflowing) body still scrolls. Previously the
            // scroll sized to content inside the flexed wrapper and a body
            // taller than the snap height could not scroll.
            style={
              hasHeader
                ? [styles.flexContainer, scrollPropsTyped?.style]
                : scrollPropsTyped?.style
            }
            contentContainerStyle={withBottomInset(
              scrollPropsTyped?.contentContainerStyle,
            )}
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
      case 'flatlist': {
        const flatProps = scrollProps as React.ComponentProps<
          typeof BottomSheetFlatList
        >;
        return (
          <BottomSheetFlatList
            {...flatProps}
            contentContainerStyle={withBottomInset(
              flatProps?.contentContainerStyle,
            )}
            ListHeaderComponent={
              (header ?? children) as React.ComponentProps<
                typeof BottomSheetFlatList
              >['ListHeaderComponent']
            }
          />
        );
      }
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
                contentContainerStyle={withBottomInset(
                  sectionProps?.contentContainerStyle,
                )}
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
    // `withBottomInset` is a plain closure over `bottomInset`; depend on the
    // scalar so the body re-memoizes when the inset changes (rotation / nav).
    bottomInset,
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
      bottomInset={bottomSheetInset}
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
    //
    // META-ORCH-0991 (sheet rework — Bug 1): the modal window is a SEPARATE
    // native window/ViewRootImpl that the host-tree GestureHandlerRootView
    // (app/_layout.tsx) does NOT extend into. Without a GestureHandlerRootView
    // INSIDE this window, gorhom's pan-down-to-dismiss PanGestureHandler never
    // receives touches → swipe-down-to-close is dead on Android and fragile on
    // iOS. Wrapping {sheet} in its own GHRV re-activates the drag-to-dismiss
    // engine in the modal window. (RNGH docs: "If you want to use gestures in
    // Modals, you need to wrap Modal's content with GestureHandlerRootView";
    // iOS evaluates GHRV as a plain View, Android requires it for touch
    // registration — exactly the observed iOS-fragile / Android-dead asymmetry.)
    return (
      <RNModal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={onClose}
        statusBarTranslucent
      >
        <GestureHandlerRootView style={styles.flexContainer}>
          {sheet}
        </GestureHandlerRootView>
      </RNModal>
    );
  }

  // Non-wrapped: announce a modal boundary for VoiceOver so focus does not leak
  // to content behind the sheet (SPEC §5 a11y / §9 blast #5). The sheet floats
  // absolutely; this View provides the modal semantics RN <Modal> gives wrapped
  // sheets for free. pointerEvents=box-none keeps the backdrop/sheet interactive.
  // ORCH-1016 REWORK-10: do not rely on `StyleSheet.absoluteFill` here. Live
  // iPhone evidence showed Discover's ancestor could hand gorhom an inline
  // parent taller than the physical window, making BottomSheetScrollView report
  // a 1057pt viewport on an 852pt-tall phone. Bound the inline host to the real
  // window height; add `bottomSheetInset` back because gorhom's HostingContainer
  // applies that inset as `bottom`, so the measured container remains exactly
  // the real window while the nav-overlay clearance still feeds snap math.
  if (!visible) return sheet;
  return (
    <View
      style={[styles.inlineContainer, { height: inlineContainerHeight }]}
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
  inlineContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
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
