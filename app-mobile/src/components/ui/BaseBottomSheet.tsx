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
  Dimensions,
  Modal as RNModal,
  Platform,
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
  useBottomSheetTimingConfigs,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { Easing } from 'react-native-reanimated';
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
  /**
   * ORCH-1138 [content-sized cart] — upper bound (px) for gorhom's dynamic
   * content snap. Only meaningful when `enableDynamicSizing` is true: the sheet
   * sizes to its content height but is CLAMPED to this value, so a short body
   * yields a short sheet (no tall empty gap) while a long body caps here and the
   * inner scrollable takes over. Forwarded verbatim to <BottomSheet>; ignored by
   * gorhom when dynamic sizing is off. Pair with a `snapPoints` max (e.g.
   * ["92%"]) so the clamp and the explicit detent agree.
   */
  maxDynamicContentSize?: number;
  /** Default true — swipe-down-to-dismiss is the core contract. */
  enablePanDownToClose?: boolean;
  theme?: BaseBottomSheetTheme;
  /** Picks the gorhom body container. Default 'scroll'. */
  scrollMode?: BaseBottomSheetScrollMode;
  /** Forwarded to the chosen scrollable (sections/renderItem/contentContainerStyle…). */
  scrollProps?: BaseBottomSheetScrollProps;
  /**
   * Fixed (non-scrolling) content rendered ABOVE the scroll/list body as an
   * intrinsic-height SIBLING direct child of <BottomSheet> (ORCH-1043 — NOT
   * wrapped in a BottomSheetView). The classic header pattern (title + close +
   * action row) for scroll/sectionlist sheets. The scroll/list body below it
   * claims flex:1 and scrolls.
   */
  header?: ReactNode;
  /**
   * ORCH-1043: the body branches no longer wrap their content in a flexed
   * BottomSheetView, so this prop no longer styles a wrapper node. It is retained
   * for API compatibility (consumers may still pass it) but has no layout effect;
   * a consumer needing body padding/sizing should apply it inside
   * `header`/`children`/`contentContainerStyle` instead.
   */
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
    maxDynamicContentSize,
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

  // ORCH-1064: DETERMINISTIC timing open/close, replacing gorhom's default SPRING.
  // Replay 6a970e63 + 1d7caee1 (release, on-device) proved the sheet STALLED
  // mid-animation — stuck half-open, or "didn't close fully" — leaving its dimmed
  // backdrop capturing every touch (app frozen, no crash/hang/error). A reanimated
  // SPRING can settle/stall partway when interrupted on a fast release build; a
  // TIMING animation always interpolates fully to the target snap index, so the
  // sheet can never stall partway and a CLOSE always reaches index -1 (which fires
  // onClose → the wrapInRNModal RN <Modal> actually unmounts instead of lingering
  // half-drawn). This supersedes the META-ORCH-0991 "stock default spring" choice
  // for correctness (the freeze outranks the spring feel).
  const sheetAnimationConfigs = useBottomSheetTimingConfigs({
    duration: 280,
    easing: Easing.out(Easing.cubic),
  });

  // ORCH-1064 (replay-confirmed "half-open stall" freeze, release-only): the
  // declarative `index={visible ? initialIndex : -1}` prop on <BottomSheet>
  // ALREADY drives open/close — gorhom reacts to an index-prop change internally
  // (BottomSheet.tsx ~L1773 `handleSnapToIndex(_providedIndex)` on _providedIndex
  // change). The previous imperative snapToIndex/close effect here was a SECOND,
  // redundant drive that raced gorhom's own animation on the same `visible` tick.
  // On a fast release build the default spring got interrupted mid-flight and
  // STALLED the sheet half-open, leaving its dimmed full-screen backdrop
  // capturing every touch — "app frozen, no crash, no hang" (Sentry replay
  // 6a970e63: "Tapped repeatedly on Modal view" 00:15→03:06 on a half-drawn
  // sheet). Removed: the single declarative drive opens/closes cleanly, no race.
  // DO NOT re-add an imperative snapToIndex/close keyed on `visible`.

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
  //
  // ── ORCH-1043 (I-PROPOSED-BASE-BOTTOM-SHEET-SCROLLABLE-IS-DIRECT-CHILD) ──────
  // 🔒 LOAD-BEARING — do NOT wrap a scrollable in `BottomSheetView`.
  //
  // gorhom's `BottomSheetView` ALWAYS appends its own `styles.container`
  // (`{ position:'absolute', left:0, top:0, right:0 }`) LAST in its style array
  // (see node_modules/@gorhom/bottom-sheet bottomSheetView/styles.ts +
  // BottomSheetView.tsx + hooks/useBottomSheetContentContainerStyle.ts). That
  // absolutely-positioned, content-sized node makes any `flex:1` we hand it inert
  // and sizes itself to its CONTENT. A `BottomSheetScrollView` placed INSIDE such
  // a wrapper therefore gets an UNBOUNDED parent → viewport == content height →
  // `maxScrollY = 0` → the body FREEZES and the bottom control is unreachable.
  // This bit ~26 wrapped sheets (notifications, pickers, report-user, billing,
  // propose-time, …) and is the exact collapse ORCH-1040 measured on a Pixel 8
  // Pro (0px bounds-delta) for AccountSettings — INSIDE a `wrapInRNModal` window,
  // proving the RN-Modal "bounded parent" exemption was empirically FALSE.
  //
  // THE RULE (enforced by `.github/scripts/strict-grep/i-bottomsheet-inline-scroll-binding.mjs`
  // + `app-mobile/scripts/ci/orch-1043-sheet-scroll-viewport-check.mjs`):
  // every body-composition branch returns a React Fragment of DIRECT children of
  // `<BottomSheet>` — i.e. of gorhom's height-bounded `BottomSheetContent`
  // `DraggableView` (`height = sheetHeight − handleHeight`, see
  // bottomSheet/BottomSheetContent.tsx). The gorhom scrollable carries its own
  // `styles.container = { flex:1, overflow:'visible' }`, so as a direct child it
  // fills the remaining bounded height beside an intrinsic-height header/footer
  // sibling → BOUNDED viewport → it scrolls. This is exactly the proven ORCH-1016
  // bare EBES/TicketCart mechanism, now guaranteed for ALL sheets.
  //   • header  → intrinsic-height SIBLING direct child, FIRST (stays pinned top).
  //   • body    → the scrollable (or, in `view` mode, consumer `children`), with
  //               `flex:1` so it claims the slack below the header. The `flex:1`
  //               is LOAD-BEARING now that it is a direct child — do NOT remove it.
  //   • footer  → intrinsic-height SIBLING direct child, LAST (pinned bottom; the
  //               `flex:1` body above absorbs all slack).
  // NEVER re-introduce a `BottomSheetView` (or any `View`/`Animated.View`) wrapper
  // around a scrollable "for layout" — it re-collapses the viewport. Direct
  // children only. (ORCH-1043; investigation INVESTIGATION_ORCH-1043_SHEET_EXPAND_SWIPE_FREEZE.md.)
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
      // ORCH-1043: header + flex:1 scroll body + footer are DIRECT children of
      // <BottomSheet> (Fragment, no BottomSheetView wrapper). `stickyBody` keeps
      // `styles.stickyBody` (flex:1) so it claims the bounded space between the
      // intrinsic-height header and the footer; `footerNode` renders LAST → pinned
      // at the bottom of gorhom's bounded host. See the §body comment above.
      return (
        <>
          {header}
          {stickyBody}
          {footerNode}
        </>
      );
    }

    const hasHeader = header !== undefined && header !== null;

    switch (scrollMode) {
      case 'view':
        // Children render directly as <BottomSheet> children by default
        // (consumer-composed). When a consumer supplies a header (or a
        // bodyContainerStyle), ORCH-1043 renders {header}{children} as DIRECT
        // children of <BottomSheet> (Fragment, no BottomSheetView wrapper) so any
        // consumer-owned BottomSheetScrollView inside `children` becomes a direct
        // child / receives gorhom's bounded host and scrolls. A `view`-mode
        // consumer that relied on `bodyContainerStyle` to size/pad its owned tree
        // must apply that style inside its own `children` root. See §body comment.
        if (hasHeader || bodyContainerStyle !== undefined) {
          return (
            <>
              {header}
              {children}
            </>
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
          // ORCH-1043: header (intrinsic height) + scroll (flex:1) are DIRECT
          // children of <BottomSheet> (Fragment, no BottomSheetView wrapper). The
          // scroll keeps `styles.flexContainer` (flex:1) so it claims the bounded
          // space below the header → bounded viewport → scrolls. See §body comment.
          return (
            <>
              {header}
              {scroll}
            </>
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
        // ORCH-1043: header + children (intrinsic-height siblings) + the
        // BottomSheetSectionList are DIRECT children of <BottomSheet> (Fragment,
        // no BottomSheetView wrapper). The list keeps `styles.sectionList`
        // (flex:1) so it claims the bounded space below header/children → bounded
        // viewport → scrolls. When sections are omitted (consumer-owned
        // loading/empty/error state in children), only header + children render —
        // no list. (NotificationsSheet pattern.) The former `bodyContainerStyle`
        // wrapper is removed; a sectionlist consumer that needs that padding must
        // reproduce it in header/children/contentContainerStyle. See §body comment.
        return (
          <>
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
          </>
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
      animationConfigs={sheetAnimationConfigs}
      snapPoints={snapPoints}
      enableDynamicSizing={enableDynamicSizing}
      maxDynamicContentSize={maxDynamicContentSize}
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

  // ORCH-1157 Round-8/Round-9 [android-sheet-gap] — Android see-through nav-bar
  // gap filler, SHARED by BOTH host paths (inline AND wrapInRNModal).
  //
  // ROOT CAUSE: the sheet's `backgroundComponent` paints the rounded body only
  // down to its measured host bottom. On Android edge-to-edge the OS navigation-
  // bar strip (`insets.bottom`) sits BELOW that — unpainted by the sheet — so the
  // deck/Discover content behind the sheet shows THROUGH it: an ugly see-through
  // band between the sheet and the nav bar.
  //   • Inline host (non-wrapInRNModal): the host is bounded to `windowHeight`
  //     (ORCH-1016 viewport invariant), so the nav-bar inset region below it is
  //     unpainted.
  //   • RN <Modal statusBarTranslucent> host (wrapInRNModal): the modal window
  //     spans the full screen INCLUDING the nav-bar region, and the gorhom sheet
  //     inside it still measures to the safe-area, so the same nav-bar band is
  //     unpainted. Round-8 only added the filler to the inline branch, so the
  //     deck/Discover DETAIL sheets — RSVP / event / trip / experience, all of
  //     which open via ExpandedCardModal with `wrapInRNModal={true}` — still
  //     gapped (Round-9: render the SAME filler in the modal window's bottom).
  //
  // FIX: paint a thin opaque filler of the SHEET'S OWN background colour across
  // exactly the nav-bar inset region, anchored to the bottom of the window. It is
  // a SIBLING of `{sheet}` (NOT a child of the gorhom-measured container) so it
  // never perturbs gorhom's snap/viewport math (ORCH-1016 invariant preserved).
  // The colour is read from the resolved background style (per-consumer override
  // or theme default) so all four detail-sheet types — which share THIS host —
  // get the right fill from one definition. pointerEvents=none so it never
  // intercepts a tap meant for the backdrop. Skipped when the inset is 0
  // (gesture-nav / no nav bar) — nothing to fill. iOS is untouched (the home-
  // indicator region is already painted by the sheet reaching the safe-area).
  const resolvedBgColor =
    (StyleSheet.flatten(resolvedBackgroundStyle) as ViewStyle | undefined)
      ?.backgroundColor;
  const androidNavFiller =
    Platform.OS === 'android' &&
    insets.bottom > 0 &&
    typeof resolvedBgColor === 'string' ? (
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.androidNavFiller,
          { height: insets.bottom, backgroundColor: resolvedBgColor },
        ]}
      />
    ) : null;

  // ORCH-1157 Round-11 [android-sheet-gap] — DATA-BACKED inline-path nav-bar fill.
  //
  // ON-DEVICE GEOMETRY (Samsung A72, runtime logcat, dp): scrH=853.33,
  // winH=774.76, insTop=30.58, insBot=48; scrH−winH ≈ insTop+insBot. The OPEN
  // consumer detail sheet logged `wrapInRNModal:false` — it is the INLINE
  // BaseBottomSheet that ConsumerEventDetailScreen mounts (ExpandedCardModal
  // returns <ConsumerEventDetailScreen> EARLY, before its own wrapInRNModal=true
  // sheet), so the gapping host is THIS inline path, NOT the wrapInRNModal branch
  // Rounds 9/10 patched. The gorhom inline host is bounded to `inlineContainerHeight`
  // (= windowHeight = 774.76, ORCH-1016) so the sheet bottom lands at the nav-bar
  // TOP; the 48dp Android nav-bar band BELOW winH is unpainted and the edge-to-edge
  // Discover deck shows through it.
  //
  // WHY ROUND-8's SIBLING FILLER STILL GAPPED: `styles.androidNavFiller`
  // (position:absolute; bottom:0) resolves its `bottom:0` against its CONTAINING
  // BLOCK — the inline overlay's positioned ancestor, which is bounded to the
  // WINDOW height (winH), not the physical SCREEN (scrH). So `bottom:0` landed at
  // winH = the nav-bar TOP, painting nothing over the 48dp band below it.
  //
  // FIX: in the inline return path, render the filler inside an Android-only
  // screen-height layer (`styles.androidNavFillerScreenLayer`: position:absolute;
  // top:0; height = Dimensions.get('screen').height) that anchors at the overlay's
  // top (= physical screen top, the same origin the working inline host uses) and
  // EXPLICITLY spans scrH. An absolute child with `height` escapes the parent's
  // winH height constraint, so the filler's `bottom:0` now reaches the TRUE
  // physical screen bottom and paints the sheet's own bg over the nav-bar band.
  // This uses NO RN <Modal> and NO `navigationBarTranslucent` on the inline path
  // (Round-10 invariant preserved — that prop is wrapInRNModal-only). pointerEvents
  // none; behind the sheet but above the deck; only when visible; skipped when
  // insets.bottom===0. iOS untouched (filler is null off-Android). The
  // wrapInRNModal branch keeps rendering the bare `androidNavFiller` (its window is
  // already full-screen via navigationBarTranslucent, so no screen layer needed).

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
    //
    // ORCH-1157 Round-10 [android-sheet-gap] — THE GEOMETRY ROOT CAUSE + FIX.
    //
    // Rounds 8/9 wrongly assumed the RN <Modal statusBarTranslucent> window spans
    // the FULL screen on Android. It does NOT. `statusBarTranslucent` makes the
    // Android Modal (a Dialog window) draw under the STATUS bar only — it stays
    // INSET above the NAVIGATION bar. So the GestureHandlerRootView (flex:1) and
    // the gorhom hosting container (absoluteFill) inside it measure a height of
    // `screenHeight − navBarInset` (often LESS, depending on the device's window
    // insets). gorhom computes `snapPoints=['50%','90%']` as a fraction of THAT
    // measured container height and anchors the sheet body to the container bottom
    // (BottomSheetHostingContainer onLayout → rawContainerHeight; column-reverse
    // DraggableView). So at the 90% snap the sheet body bottom lands at the TOP of
    // the nav bar — and the deck/Discover root window (drawn edge-to-edge under the
    // nav bar) shows THROUGH the whole region from there down: a see-through band
    // that is the nav bar PLUS any extra short-window remainder — i.e. TALLER than
    // `insets.bottom`. That is exactly why the Round-8/9 fillers (height =
    // insets.bottom, anchored to the GHRV bottom = the nav-bar TOP) painted the
    // wrong strip and left the band showing on the Samsung A72.
    //
    // FIX: add `navigationBarTranslucent` (RN 0.76+, supported on 0.81.5; it
    // REQUIRES `statusBarTranslucent`, already set). This makes the Android Modal
    // window draw under the NAVIGATION bar too, so the GHRV + gorhom container now
    // measure the TRUE full physical screen height. The 90% sheet body therefore
    // reaches the real screen bottom — there is NO band, on any device, regardless
    // of how big the nav-bar inset is (the fix is geometry-correct, not a sized
    // filler). The body's own `withBottomInset` paddingBottom (= max(insets.bottom,
    // 16)) already keeps the CTA clear of the now-overlapped nav bar — no content
    // hides. iOS evaluates the prop as a no-op (the iOS Modal already spans the
    // home-indicator region), so iOS is UNCHANGED. This is the SINGLE shared host
    // for all four deck/Discover detail-sheet types (RSVP / event / trip /
    // experience via ExpandedCardModal wrapInRNModal={true}) — one fix covers all.
    //
    // The `androidNavFiller` sibling (Rounds 8/9) is RETAINED as harmless
    // belt-and-braces: with the window now full-screen it paints the sheet's own
    // bg over the (now sheet-occupied) nav-bar region — same colour, zero visual
    // effect — and it preserves the Round-8/9 regression suites. It never touches
    // the gorhom-measured container, so the ORCH-1016 viewport invariant + snap/
    // scroll stay untouched.
    //
    // ORCH-1157 Round-11 NOTE: the consumer deck/Discover DETAIL sheets do NOT
    // actually take this branch — ExpandedCardModal returns
    // <ConsumerEventDetailScreen> (which mounts an INLINE wrapInRNModal=false
    // BaseBottomSheet) EARLY, before its own wrapInRNModal=true sheet, so the
    // gapping detail sheet is the INLINE path below (proven by the runtime
    // `wrapInRNModal:false` log on the A72). This branch + its
    // navigationBarTranslucent geometry fix is still correct for any sheet that
    // genuinely sets wrapInRNModal (z-stacking over the in-tree tab bar / chat
    // input); it is just not the detail-sheet host. Round-11 fixes the inline path.
    return (
      <RNModal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={onClose}
        statusBarTranslucent
        navigationBarTranslucent
      >
        <GestureHandlerRootView style={styles.flexContainer}>
          {sheet}
          {androidNavFiller}
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
  // ORCH-1157 Round-8 + Round-11 [android-sheet-gap] — the inline
  // (non-wrapInRNModal) host renders the bounded gorhom host (exactly
  // `inlineContainerHeight` = windowHeight + nav-overlay clearance — ORCH-1016
  // viewport invariant) and, as a SIBLING, the `androidNavFiller` wrapped in the
  // Round-11 `androidNavFillerScreenLayer`. Round-8 anchored the filler `bottom:0`
  // against a winH-bounded ancestor, so it stopped at the nav-bar TOP and never
  // painted the 48dp band below winH (A72 runtime geometry). The Round-11 screen
  // layer (position:absolute; top:0; height = Dimensions.get('screen').height)
  // spans the TRUE physical screen so the filler's `bottom:0` reaches the screen
  // bottom and covers the nav-bar inset region with the sheet's own bg → the deck
  // behind never shows through. iOS / gesture-nav (insets.bottom===0) get
  // `androidNavFiller === null` → `androidNavFillerScreenLayer === null` → no-op.
  return (
    <>
      <View
        style={[styles.inlineContainer, { height: inlineContainerHeight }]}
        pointerEvents="box-none"
        accessibilityViewIsModal
      >
        {sheet}
      </View>
      {/* ORCH-1157 Round-11: the nav-bar filler must paint at the PHYSICAL screen
          bottom, not the winH-bounded ancestor its own bottom:0 would otherwise
          resolve against. Wrap it in a screen-height absolute layer (top:0,
          height = screen height) so it spans scrH and its bottom reaches the real
          screen bottom. Off-Android / gesture-nav → androidNavFiller is null. */}
      {androidNavFiller !== null ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.androidNavFillerScreenLayer,
            { height: Dimensions.get('screen').height },
          ]}
        >
          {androidNavFiller}
        </View>
      ) : null}
    </>
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
  // ORCH-1138 [detail-sheet-behind-discover-header] — z-LAYER FIX.
  // A non-`wrapInRNModal` BaseBottomSheet renders this absolutely-positioned
  // inline host as a SIBLING of the host screen's other absolute chrome (e.g.
  // DiscoverScreen `headerPanel` at zIndex:50 + the floating GlassBottomNav at
  // zIndex:50). RN scopes zIndex to siblings: an unset zIndex here resolves to
  // auto(0), so the zIndex:50 Discover header PAINTED OVER the top of every
  // full-screen detail sheet (cover media + the X/Share/Mute OfferingChrome) —
  // occluding and un-tapping that chrome (the consumer trip + event detail bug).
  // Lift the whole inline host above all in-tree screen chrome (header + nav are
  // 50) while staying BELOW the global Toast layer (zIndex:9999), which must keep
  // floating over an open sheet. `elevation` mirrors it so Android's stacking
  // agrees with iOS's zIndex ordering. wrapInRNModal sheets already z-stack in a
  // separate native window and are unaffected. This does NOT change the inline
  // host's HEIGHT (ORCH-1016/1043 viewport invariant untouched) — layering only.
  inlineContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
  },
  // ORCH-1157 Round-8 [android-sheet-gap] — opaque filler that paints the sheet's
  // own background colour across the Android nav-bar inset region, anchored to the
  // bottom of the screen, so a non-wrapInRNModal detail sheet has NO see-through
  // band between its painted body and the OS navigation bar. Same z-layer/elevation
  // as the inline host so it sits above the deck behind but below the global Toast.
  androidNavFiller: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
  },
  // ORCH-1157 Round-11 [android-sheet-gap] — screen-height layer that hosts the
  // inline-path `androidNavFiller`. top:0 anchors it at the inline overlay's top
  // (= physical screen top, the same origin the working inline host uses) and an
  // explicit `height` (set at render time to Dimensions.get('screen').height)
  // makes it span the TRUE physical screen (scrH), escaping the winH-bounded
  // ancestor the bare filler's bottom:0 would otherwise resolve against. So the
  // child filler (bottom:0) reaches the real screen bottom and paints the nav-bar
  // band. pointerEvents none; same z-layer as the inline host (above the deck,
  // below the global Toast). The wrapInRNModal branch does NOT use this — its
  // window is already full-screen via navigationBarTranslucent (Round-10).
  androidNavFillerScreenLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    elevation: 100,
  },
  // ORCH-1043: `stickyContainer` + `sectionListContainer` removed — they styled
  // the BottomSheetView wrappers the sticky/sectionlist branches no longer use
  // (the scrollable is now a direct child of <BottomSheet>). `stickyBody` and
  // `sectionList` (flex:1) stay — they are on the SCROLLABLES themselves.
  stickyBody: { flex: 1 },
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
