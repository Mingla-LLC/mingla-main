/**
 * #4453 (contract section I) — the brand switcher's menu.
 *
 *   Web >= 1024: a popover in the sheet material, anchored under the brand
 *   chip, kept inside the viewport.
 *   Phone, narrow web and native: the TopSheet, dropping from the top like
 *   the app's full brand sheet (BrandSwitcherSheet), in a full-screen layer
 *   of its own (the chip sits in a small bar, which the sheet must not be
 *   confined to).
 *
 * Both list every brand with its mark, tick the brand you are in, show a
 * search field above 8 brands and end with "Create a new brand". Picking a
 * brand goes through `useWorkspaceBrandSwitch` (same screen for that brand).
 *
 * Keyboard (web): Up / Down / Home / End move through the rows, Enter picks,
 * Escape closes and focus returns to the chip. Typing in the search field
 * keeps focus there; Down steps into the results. The sheet closes on Escape
 * or a tap outside it too, and tells its host once it is gone (`onClosed`),
 * so focus goes back to the chip after the layer has left the page.
 *
 * Loaded on demand by WorkspaceBrandSwitcher, so none of this is on the boot
 * path.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal as RNModal, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { TextInput } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useRouter } from "expo-router";

import { color, radius, shadow, space, type } from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { useBrandListState } from "../../hooks/useBrandListShim";
import { useBrandSetupStates } from "../../hooks/useBrandSetupStates";
import { useWorkspaceBrandSwitch } from "../../hooks/useWorkspaceBrandSwitch";
import type { Brand } from "../../store/currentBrandStore";
import { canDeleteBrand } from "../../utils/brandDeletePermission";
import { filterBrandsByQuery, showsBrandSearch } from "../../utils/brandSearch";
import { ScrollView } from "../../wrappers/SmartScrollView";
import { Icon } from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { Material } from "../ui/Material";
import { TopSheet } from "../ui/TopSheet";
import { useWebEscapeClose } from "../ui/useWebEscapeClose";
import { BrandMark } from "./BrandMark";
import { BrandSearchField } from "./BrandSearchField";
import { BRAND_SWITCHER_COPY } from "./brandSwitcherCopy";

export interface BrandMenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkspaceBrandMenuProps {
  visible: boolean;
  onClose: () => void;
  /** The brand the screen is in (ticked). */
  activeBrandId: string | null;
  /** Wide desktop: where the chip is; null presents the top sheet. */
  anchor: BrandMenuAnchor | null;
  /** The host's full switcher (continue setup, discard a draft, delete). */
  onManageBrands?: () => void;
  /** Discard a true draft (the host's own confirm flow). Without it a draft row has no discard. */
  onDiscardDraft?: (brand: Brand) => void;
  /** The sheet's layer has left the page (focus can go back to the chip). */
  onClosed?: () => void;
  testID?: string;
}

export const BRAND_MENU_WIDTH = 320;
export const BRAND_MENU_ROW_HEIGHT = 56;
const POPOVER_MAX_HEIGHT = 520;
/** The sheet's layer stays until the TopSheet has slid away (its exit runs 240 to 280ms). */
const SHEET_EXIT_MS = 300;
/** The web TopSheet's drag band lies over the last 28px of the panel: nothing tappable sits under it. */
const SHEET_DRAG_BAND = 28;

/** Under the chip, left-aligned to it, inside the viewport. */
export const brandMenuPosition = (
  anchor: BrandMenuAnchor,
  viewport: { width: number; height: number },
): { left: number; top: number; maxHeight: number } => {
  const edge = space[2];
  const left = Math.max(edge, Math.min(anchor.x, viewport.width - BRAND_MENU_WIDTH - edge));
  const top = anchor.y + anchor.height + space[1];
  const maxHeight = Math.max(
    BRAND_MENU_ROW_HEIGHT * 3,
    Math.min(POPOVER_MAX_HEIGHT, viewport.height - top - edge),
  );
  return { left, top, maxHeight };
};

type KeyEvent = {
  key: string;
  target?: { tagName?: string } | null;
  preventDefault?: () => void;
};

interface FooterAction {
  key: string;
  label: string;
  icon: IconName;
  onPress: () => void;
}

type Focusable = { focus?: () => void } | null;

export const WorkspaceBrandMenu: React.FC<WorkspaceBrandMenuProps> = ({
  visible,
  onClose,
  activeBrandId,
  anchor,
  onManageBrands,
  onDiscardDraft,
  onClosed,
  testID = "workspace-brand-menu",
}) => {
  const router = useRouter();
  const { user } = useAuth();
  const viewport = useWindowDimensions();
  const brandList = useBrandListState();
  const brands = brandList.brands;
  const setupStates = useBrandSetupStates(brands);
  const switchTo = useWorkspaceBrandSwitch({ fromBrandId: activeBrandId });
  const [query, setQuery] = useState("");
  const searchable = showsBrandSearch(brands.length);
  const shown = useMemo(
    () => (searchable ? filterBrandsByQuery(brands, query) : brands),
    [brands, query, searchable],
  );
  const popover = anchor !== null;
  useWebEscapeClose(visible && popover, onClose);
  // The sheet's full-screen layer outlives `visible` by the slide-away.
  const [sheetLayer, setSheetLayer] = useState(visible);
  useEffect(() => {
    if (visible) {
      setSheetLayer(true);
      return undefined;
    }
    const timer = setTimeout(() => setSheetLayer(false), SHEET_EXIT_MS);
    return (): void => clearTimeout(timer);
  }, [visible]);

  const draftBrand = brands.find((brand) => brand.id === setupStates.draftId) ?? null;
  const openCreate = useCallback((): void => {
    onClose();
    // One draft at a time (#4389 N1): with a draft, the create route opens
    // "You have a brand in progress".
    router.push(
      (draftBrand !== null
        ? `/brand/new?draft=${encodeURIComponent(draftBrand.id)}&draft_name=${encodeURIComponent(draftBrand.displayName)}`
        : "/brand/new") as never,
    );
  }, [draftBrand, onClose, router]);

  const footer = useMemo<FooterAction[]>(() => {
    const actions: FooterAction[] = [
      { key: "create", label: "Create a new brand", icon: "plus", onPress: openCreate },
    ];
    if (onManageBrands !== undefined) {
      actions.push({
        key: "manage",
        label: "Manage brands",
        icon: "settings",
        onPress: () => {
          onClose();
          onManageBrands();
        },
      });
    }
    return actions;
  }, [onClose, onManageBrands, openCreate]);

  const [discardMenuFor, setDiscardMenuFor] = useState<string | null>(null);
  const openSetup = useCallback(
    (brand: Brand): void => {
      onClose();
      router.push(`/brand/${encodeURIComponent(brand.id)}/setup` as never);
    },
    [onClose, router],
  );
  const discard = useCallback(
    (brand: Brand): void => {
      setDiscardMenuFor(null);
      onClose();
      onDiscardDraft?.(brand);
    },
    [onClose, onDiscardDraft],
  );

  const pick = useCallback(
    (brand: Brand): void => {
      onClose();
      void switchTo(brand);
    },
    [onClose, switchTo],
  );

  // Rows first, then the footer actions: one list for the arrow keys.
  const itemCount = shown.length + footer.length;
  const currentIndex = shown.findIndex((brand) => brand.id === activeBrandId);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const itemRefs = useRef<Focusable[]>([]);
  const searchRef = useRef<TextInput | null>(null);

  // Opening: start on the search field, or on the brand you are in.
  useEffect(() => {
    if (!visible) {
      setQuery("");
      setActiveIndex(-1);
      setDiscardMenuFor(null);
      return undefined;
    }
    const start = searchable ? -1 : Math.max(0, currentIndex);
    setActiveIndex(start);
    // The popover takes keyboard focus. The phone sheet does not: focusing
    // the search field there would raise the keyboard over the list.
    if (!popover) return undefined;
    const timer = setTimeout(() => {
      if (searchable) (searchRef.current as Focusable)?.focus?.();
      else itemRefs.current[start]?.focus?.();
    }, 0);
    return (): void => clearTimeout(timer);
    // Only when it opens: the list may refresh while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const moveTo = useCallback(
    (index: number): void => {
      if (itemCount === 0) return;
      const next = ((index % itemCount) + itemCount) % itemCount;
      setActiveIndex(next);
      itemRefs.current[next]?.focus?.();
    },
    [itemCount],
  );

  const activate = useCallback(
    (index: number): void => {
      const brand = shown[index];
      if (brand !== undefined) {
        pick(brand);
        return;
      }
      footer[index - shown.length]?.onPress();
    },
    [footer, pick, shown],
  );

  const onKeyDown = useCallback(
    (event: KeyEvent): void => {
      const inSearch = event.target?.tagName === "INPUT";
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault?.();
          moveTo(activeIndex + 1);
          return;
        case "ArrowUp":
          event.preventDefault?.();
          moveTo(activeIndex <= 0 ? itemCount - 1 : activeIndex - 1);
          return;
        case "Home":
          if (inSearch) return;
          event.preventDefault?.();
          moveTo(0);
          return;
        case "End":
          if (inSearch) return;
          event.preventDefault?.();
          moveTo(itemCount - 1);
          return;
        case "Enter":
          // A focused row presses itself; Enter in the search field picks the
          // highlighted result, or the only / first match.
          if (!inSearch) return;
          event.preventDefault?.();
          if (shown.length > 0) activate(activeIndex >= 0 && activeIndex < shown.length ? activeIndex : 0);
          return;
        default:
      }
    },
    [activate, activeIndex, itemCount, moveTo, shown.length],
  );

  const onSearch = useCallback((next: string): void => {
    setQuery(next);
    setActiveIndex(-1);
  }, []);

  const renderRow = (brand: Brand, index: number): React.ReactElement => {
    const isCurrent = brand.id === activeBrandId;
    const setup = setupStates.byId[brand.id] ?? { kind: "none" };
    const subline =
      setup.kind === "none"
        ? null
        : setup.kind === "free_only"
          ? BRAND_SWITCHER_COPY.n3.freeOnlyTag
          : `${setup.kind === "draft" ? `${BRAND_SWITCHER_COPY.n3.draftLabel} · ` : ""}${BRAND_SWITCHER_COPY.n3.progress(setup.doneCount)}`;
    const unfinished = setup.kind !== "none";
    const canDiscard =
      setup.kind === "draft" && onDiscardDraft !== undefined && canDeleteBrand(brand, user?.id ?? null);
    return (
      <View key={brand.id}>
        {/* The row is a plain box: the switch target, the Continue pill and the
            "more" button are SIBLINGS, never nested (a tap on the row switches,
            a tap on the pill opens setup). */}
        <View
          style={[
            styles.row,
            isCurrent ? styles.rowCurrent : null,
            activeIndex === index ? styles.rowActive : null,
          ]}
          testID={`workspace-brand-rowbox-${brand.id}`}
        >
          <Pressable
            ref={(node) => {
              itemRefs.current[index] = node as Focusable;
            }}
            onPress={() => pick(brand)}
            onFocus={() => setActiveIndex(index)}
            onHoverIn={() => setActiveIndex(index)}
            accessibilityRole="menuitem"
            accessibilityLabel={
              isCurrent ? `${brand.displayName}, the brand you are in` : `Switch to ${brand.displayName}`
            }
            accessibilityState={{ selected: isCurrent }}
            style={styles.rowPick}
            testID={`workspace-brand-row-${brand.id}`}
          >
            <BrandMark brand={brand} size={32} testID={`workspace-brand-mark-${brand.id}`} />
            <View style={styles.rowText}>
              <Text style={styles.rowName} numberOfLines={2}>
                {brand.displayName}
              </Text>
              {subline !== null ? (
                <Text style={styles.rowSub} numberOfLines={1}>
                  {subline}
                </Text>
              ) : null}
            </View>
          </Pressable>
          {unfinished ? (
            <Pressable
              onPress={() => openSetup(brand)}
              accessibilityRole="button"
              accessibilityLabel={`${BRAND_SWITCHER_COPY.n3.continue} ${brand.displayName}`}
              hitSlop={6}
              style={styles.continueBtn}
              testID={`workspace-brand-continue-${brand.id}`}
            >
              <Text style={styles.continueLabel}>{BRAND_SWITCHER_COPY.n3.continue}</Text>
            </Pressable>
          ) : null}
          {canDiscard ? (
            <Pressable
              onPress={() => setDiscardMenuFor((open) => (open === brand.id ? null : brand.id))}
              accessibilityRole="button"
              accessibilityLabel={`More for ${brand.displayName}`}
              accessibilityState={{ expanded: discardMenuFor === brand.id }}
              style={styles.moreBtn}
              testID={`workspace-brand-more-${brand.id}`}
            >
              <Icon name="moreH" size={16} color={color.text3} />
            </Pressable>
          ) : null}
          {isCurrent ? (
            <View style={styles.tick} testID={`workspace-brand-tick-${brand.id}`}>
              <Icon name="check" size={14} color={color.ink} />
            </View>
          ) : null}
        </View>
        {canDiscard && discardMenuFor === brand.id ? (
          <View style={styles.rowMenu} testID={`workspace-brand-more-menu-${brand.id}`}>
            <Pressable
              onPress={() => discard(brand)}
              accessibilityRole="button"
              accessibilityLabel={`${BRAND_SWITCHER_COPY.n3.discard} ${brand.displayName}`}
              style={styles.rowMenuItem}
              testID={`workspace-brand-discard-${brand.id}`}
            >
              <Text style={styles.rowMenuLabel}>{BRAND_SWITCHER_COPY.n3.discard}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  const list =
    brandList.status === "error" && brands.length === 0 ? (
      <View style={styles.state}>
        <Text style={styles.stateText}>{"Couldn't load your brands."}</Text>
        <Pressable
          onPress={() => void brandList.refetch()}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={styles.retry}
          testID="workspace-brand-retry"
        >
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
      </View>
    ) : brands.length === 0 && brandList.isLoading ? (
      <View style={styles.state}>
        <Text style={styles.stateText}>Loading your brands…</Text>
      </View>
    ) : shown.length === 0 ? (
      <View style={styles.state} testID="workspace-brand-no-match">
        <Text style={styles.stateText}>{`No brand matches "${query.trim()}".`}</Text>
      </View>
    ) : (
      shown.map(renderRow)
    );

  const body = (
    <View
      style={popover ? styles.body : styles.bodySheet}
      accessibilityRole="menu"
      accessibilityLabel="Switch brand"
      testID={testID}
      {...({ onKeyDown } as object)}
    >
      {searchable ? (
        <View style={styles.search}>
          <BrandSearchField
            value={query}
            onChangeText={onSearch}
            inputRef={searchRef}
            testID="workspace-brand-search"
          />
        </View>
      ) : null}
      <ScrollView
        style={popover ? styles.scroll : styles.scrollSheet}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        {list}
      </ScrollView>
      <View style={popover ? styles.footer : [styles.footer, styles.footerSheet]}>
        <View style={styles.footerButtons} testID="workspace-brand-footer-buttons">
          {footer.map((action, offset) => {
            const index = shown.length + offset;
            const filled = action.key === "create";
            return (
              <Pressable
                key={action.key}
                ref={(node) => {
                  itemRefs.current[index] = node as Focusable;
                }}
                onPress={action.onPress}
                onFocus={() => setActiveIndex(index)}
                onHoverIn={() => setActiveIndex(index)}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={[
                  styles.footerBtn,
                  filled ? styles.footerBtnFilled : styles.footerBtnOutlined,
                  activeIndex === index ? styles.footerBtnActive : null,
                ]}
                testID={`workspace-brand-${action.key}`}
              >
                <Icon name={action.icon} size={16} color={filled ? color.ink : color.text1} />
                <Text style={[styles.footerLabel, filled ? styles.footerLabelFilled : null]}>
                  {action.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );

  if (popover) {
    if (!visible) return null;
    const pos = brandMenuPosition(anchor, viewport);
    return (
      <RNModal visible transparent animationType="none" onRequestClose={onClose}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Close the brand menu"
          accessibilityRole="button"
          testID="workspace-brand-backdrop"
        />
        <View
          style={[styles.popover, shadow.menu, { left: pos.left, top: pos.top, maxHeight: pos.maxHeight }]}
          testID="workspace-brand-popover"
        >
          <Material kind="sheet" radius={radius.md} style={styles.popoverSurface}>
            {body}
          </Material>
        </View>
      </RNModal>
    );
  }

  // A layer of its own: the chip sits in a small bar, and the TopSheet fills whatever it is in.
  return (
    <RNModal
      visible={visible || sheetLayer}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={onClose}
      onDismiss={onClosed}
    >
      <GestureHandlerRootView style={styles.sheetLayer}>
        <TopSheet visible={visible} onClose={onClose} testID="workspace-brand-sheet">
          <View style={styles.sheetBody}>
            <Text style={styles.sheetTitle} accessibilityRole="header">
              Switch brand
            </Text>
            {body}
          </View>
        </TopSheet>
      </GestureHandlerRootView>
    </RNModal>
  );
};

const styles = StyleSheet.create({
  popover: { position: "absolute", width: BRAND_MENU_WIDTH, borderRadius: radius.md },
  popoverSurface: { flexShrink: 1, paddingVertical: space[2] },
  sheetLayer: { flex: 1 },
  // Breathing room inside the panel: the title and the rows start 20 from its edge, as in the full brand sheet.
  sheetBody: { flex: 1, paddingTop: space[5], paddingHorizontal: space[3] },
  sheetTitle: { ...type.h2, color: color.text1, minHeight: 44, paddingHorizontal: space[2] },
  body: { flexShrink: 1, minHeight: 0 },
  // In the sheet the list takes the room there is and scrolls; the actions stay pinned under it.
  bodySheet: { flex: 1, minHeight: 0 },
  scrollSheet: { flex: 1 },
  footerSheet: { paddingBottom: SHEET_DRAG_BAND + space[2] },
  search: { paddingHorizontal: space[2], paddingBottom: space[2] },
  scroll: { flexShrink: 1 },
  scrollContent: { paddingHorizontal: space[2], gap: space[1] },
  row: {
    minHeight: BRAND_MENU_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
  },
  rowCurrent: { backgroundColor: color.card3 },
  // Hover, keyboard focus and the arrow keys share one highlight.
  rowActive: { backgroundColor: color.fill.pressed },
  rowPick: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
  },
  rowText: { flex: 1, minWidth: 0 },
  // 32pt pill; hitSlop 6 makes the target 44pt.
  continueBtn: {
    height: 32,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  continueLabel: { ...type.caption, color: color.text1, fontWeight: "600" },
  moreBtn: { width: 44, height: 44, marginHorizontal: -space[2], alignItems: "center", justifyContent: "center" },
  rowMenu: {
    alignSelf: "flex-end",
    marginRight: space[3],
    marginTop: space[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.lineStrong,
    backgroundColor: color.card3,
  },
  rowMenuItem: { minHeight: 44, paddingHorizontal: space[4], justifyContent: "center" },
  rowMenuLabel: { ...type.small, color: color.text1, fontWeight: "600" },
  rowName: { ...type.row, color: color.text1, fontWeight: "600" },
  rowSub: { ...type.caption, color: color.text3 },
  tick: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: color.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  state: { paddingHorizontal: space[4], paddingVertical: space[5], alignItems: "center", gap: space[3] },
  stateText: { ...type.small, color: color.text2, textAlign: "center" },
  retry: {
    minHeight: 44,
    paddingHorizontal: space[4],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  retryLabel: { ...type.small, color: color.text1, fontWeight: "600" },
  footer: {
    marginTop: space[2],
    paddingTop: space[2],
    paddingHorizontal: space[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  footerButtons: { flexDirection: "column", gap: 10 },
  footerBtn: {
    alignSelf: "stretch",
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.full,
  },
  footerBtnFilled: { backgroundColor: color.text1 },
  footerBtnOutlined: { borderWidth: 1, borderColor: color.lineStrong },
  footerBtnActive: { opacity: 0.85 },
  footerLabel: { ...type.small, color: color.text1, fontWeight: "600" },
  footerLabelFilled: { color: color.ink },
});

export default WorkspaceBrandMenu;
