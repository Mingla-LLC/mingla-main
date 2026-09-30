/**
 * ORCH-1186-C — venue MENU builder module (DISPLAY-ONLY).
 *
 * The always-visible command-band "Menu" module: CRUD for menu categories +
 * priced items (add / edit / delete / reorder, currency-aware price, per-item
 * availability), manager-plus gated (RLS enforces server-side). Renders inside
 * the shell's ScrollView (moduleSelfScrolls("menu") === false), like Settings.
 *
 * Structural twin of VenueSettingsModule (GlassCard section spine + designSystem
 * tokens + manager-plus gate + the sheet add/edit pattern). Reorder is up/down
 * text controls (no drag dependency — Android-safe; OQ-2 resolved).
 *
 * HARD (AMENDED at #1767 Phase 1 / issue #1789 — SPEC #1788 P-61 SET-B, P-64):
 * the DEC-C display-only clause is deliberately RETIRED for this module. What
 * survives, and is now the whole rule, is that this surface NEVER DOES MONEY
 * ITSELF: no payment-provider SDK import, no payment sheet, no client-side fee,
 * take-rate or tax arithmetic. Every money number it renders is a server value
 * (SPEC #1788 P-20). Enforced by the re-scoped strict-grep gate
 * `orch-1186c-menu-display-only.mjs` (SET-B) and by the amended
 * I-PROPOSED-1186-MENU-DISPLAY-ONLY. The builder SHEETS (MenuItemSheet /
 * MenuCategorySheet) and the marketing venue-preview skin stay display-only
 * FOREVER (SET-A).
 *
 * NEVER touches experience_stops / the snap-menu parser
 * (I-PROPOSED-1186C-MENU-NOT-EXPERIENCE-STOPS).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import {
  accent,
  androidOpaque,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Button } from "../ui/Button";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import {
  formatCurrency,
  normalizeCurrency,
  currencyCodeOrNull,
} from "../../utils/currency";
import {
  useBrandMenus,
  useDeleteMenu,
  useDeleteMenuItem,
  useReorderMenuItems,
  useReorderMenus,
  useUpsertMenu,
  useUpsertMenuItem,
} from "../../hooks/useMenus";
import {
  createAdjacentMenuItemReorderIntent,
  menuItemRelationshipIsApplied,
  rebuildMenuItemReorderIntent,
  type MenuItemReorderError,
  type MenuItemReorderIntent,
} from "../../hooks/menuItemReorder";
import { useNetInfoSafe } from "../../lib/netinfoSafe";
import type { Menu, MenuItem } from "../../services/menusService";
import { randomId } from "../../utils/randomId";
import { MenuCategorySheet } from "./MenuCategorySheet";
import type { MenuCategorySheetSaveInput } from "./MenuCategorySheet";
import { MenuItemSheet } from "./MenuItemSheet";
import type { MenuItemSheetSaveInput } from "./MenuItemSheet";
import { serviceWindowSummary } from "./menuDepth";
import {
  classifyMenuTextSaveFailure,
  type MenuTextSaveFailure,
} from "./menuTextValidation";
import { VenueHubEmptyState } from "./VenueHubEmptyState";

const MANAGER_PLUS_RANK = BRAND_ROLE_RANK.event_manager; // 40
const STACKED_ITEM_ROW_WIDTH = 720;
const STACKED_ITEM_ROW_FONT_SCALE = 1.3;
const REORDER_SUCCESS_MS = 2_500;

interface MenuItemReorderFeedback {
  operationId: string;
  itemId: string;
  itemName: string;
  status: "pending" | "success" | "error";
  message: string;
  intent: MenuItemReorderIntent;
  retryable: boolean;
}

type ItemReorderArrowDirection = "up" | "down";
type FocusablePressable = React.ElementRef<typeof Pressable> & {
  focus?: () => void;
};

/**
 * Issue #1789 — both #1767 children load behind a LAZY boundary, the
 * `LazyVenueInsightsModule` precedent (VenueSuiteShell.tsx:86) and the #1735
 * rule it codifies: the HOST owns code-splitting.
 *
 * This is not a bundle-size nicety, it is a correctness constraint. Both
 * children reach `useAuth` -> `AuthContext` -> `expo-constants` ->
 * `expo-modules-core`, which THROWS AT MODULE SCOPE under the venue web
 * render-proof configs (`Cannot read properties of undefined (reading
 * 'EventEmitter')`). A static import here would evaluate that chain the moment
 * anything imports this module — which is exactly how #1486's dormant render
 * suites went red. The factories run only when the branch first RENDERS, and
 * each render site is additionally gated on the sheet actually being open, so
 * the chain stays out of the eager path on web and in every render proof.
 */
const LazyMenuItemOptionsSection = React.lazy(async () => {
  const mod = await import("./MenuItemOptionsSection");
  return { default: mod.MenuItemOptionsSection };
});
const LazyVenueSpotsSheet = React.lazy(async () => {
  const mod = await import("./VenueSpotsSheet");
  return { default: mod.VenueSpotsSheet };
});

export interface VenueMenuModuleProps {
  brandId: string | null;
  venueId?: string | null;
  /**
   * #1532 §5.6 — whether a guest can ACTUALLY see this menu on the public page.
   *
   * `"public"` (default, restaurants): the shipped promise is true.
   * `"not_yet"` (a Stay): it is NOT. `PublicVenuePage.tsx:179` hard-codes
   * `hasMenu = !isStay && …`, so a hotelier was told "Guests see your menu on
   * your public page" by a module whose output no guest could ever reach — a
   * write-only hole, and the single largest category leak in the Stay manager.
   *
   * Seth's decision was NOT to remove the module: "Stays get its own menu."
   * Building that menu — what a hotel menu contains, where it renders for a
   * guest, how it diverges from the restaurant tables — is #1536. What #1532
   * owes an operator in the meantime is the truth, so this flag replaces the
   * false promise with an honest interim state and leaves the authoring alone.
   */
  publicVisibility?: "public" | "not_yet";
  testID?: string;
}

/**
 * #1532 §5.6 — the promise, told honestly. One table so the empty state and
 * the populated intro can never claim different things about the same menu.
 */
const MENU_VISIBILITY_COPY = {
  public: {
    emptyBody:
      "Add categories and priced items. Guests see your menu on your public page.",
    intro: "Your menu shows on your public venue page. Build it by category.",
  },
  not_yet: {
    emptyBody:
      "Add categories and priced items here. Guests can’t see a Stay menu on your public page yet — we’re building one made for hotels, and everything you add now will be waiting for it.",
    intro:
      "Guests can’t see a Stay menu on your public page yet — we’re building one made for hotels. Anything you add here is saved and will be waiting for it.",
  },
} as const;

export function VenueMenuModule({
  brandId,
  venueId = null,
  publicVisibility = "public",
  testID,
}: VenueMenuModuleProps): React.ReactElement {
  const visibilityCopy = MENU_VISIBILITY_COPY[publicVisibility];
  const network = useNetInfoSafe();
  const { width, fontScale } = useWindowDimensions();
  const stackItemRows =
    width <= 0 ||
    width < STACKED_ITEM_ROW_WIDTH ||
    fontScale >= STACKED_ITEM_ROW_FONT_SCALE;
  const brand = useCurrentBrand();
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;
  // KEEP — `menu_items.currency` is text NOT NULL (migration 20261118000000);
  // the stored value cannot be null without a migration (#962 §7 D-5 follow-up,
  // tracked in #1305). This feeds the WRITE + the MenuItemSheet math prop.
  const currency = normalizeCurrency(brand?.defaultCurrency);
  // #962 VM1 — DISPLAY gate only: suppress the menu-price DISPLAY when the brand
  // has no established currency so a pre-bank brand never SEES a fabricated £.
  // The stored value is untouched.
  const brandHasCurrency = currencyCodeOrNull(brand?.defaultCurrency) !== null;

  const menusQuery = useBrandMenus(brandId, venueId);
  const refetchMenus = menusQuery.refetch;
  const menus = useMemo(() => menusQuery.data ?? [], [menusQuery.data]);

  const upsertMenu = useUpsertMenu(brandId, venueId);
  const deleteMenu = useDeleteMenu(brandId, venueId);
  const reorderMenus = useReorderMenus(brandId, venueId);
  const upsertItem = useUpsertMenuItem(brandId, venueId);
  const deleteItem = useDeleteMenuItem(brandId, venueId);
  const reorderItems = useReorderMenuItems(brandId, venueId);

  // ---- sheet state ----
  const [categorySheetOpen, setCategorySheetOpen] = useState<boolean>(false);
  const [editingCategory, setEditingCategory] = useState<Menu | null>(null);
  const [categorySaveFailure, setCategorySaveFailure] =
    useState<MenuTextSaveFailure | null>(null);
  const [itemSheetOpen, setItemSheetOpen] = useState<boolean>(false);
  const [itemSheetMenuId, setItemSheetMenuId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [itemSaveFailure, setItemSaveFailure] =
    useState<MenuTextSaveFailure | null>(null);
  const [optionsSaving, setOptionsSaving] = useState<boolean>(false);
  /*
   * #3572 — an UNSAVED options draft holds the item sheet exactly the way an
   * in-flight options save does (#3563). The draft lives in the editor panel's
   * own state, four components below this one, so this is where the two halves
   * of the lock meet.
   */
  const [optionsDirty, setOptionsDirty] = useState<boolean>(false);
  /*
   * #3572 — ONE lock for the item sheet. The shared Sheet primitive has exactly
   * one dismissal gate (`dismissDisabled`), and it has to be engaged for BOTH
   * reasons, because on native a committed drag-to-close calls `onClose` and
   * leaves the panel sitting at its drag offset: the only thing that ever
   * restores it is an effect keyed on `visible`, so a guard that merely swallows
   * `onClose` would strand the panel mid-screen on iOS and Android. Disabling
   * the pan gesture cannot strand it, which is why the two halves are composed
   * into the one signal the sheet already forwards to that gate.
   */
  const optionsHoldsItemSheet = optionsSaving || optionsDirty;
  const [saveError, setSaveError] = useState<boolean>(false);
  // #1789 — the row currently being 86'd, so one tap cannot fire twice.
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);
  const [spotsSheetOpen, setSpotsSheetOpen] = useState<boolean>(false);
  const [itemReorderFeedback, setItemReorderFeedback] =
    useState<MenuItemReorderFeedback | null>(null);
  const activeItemReorderRef = useRef<string | null>(null);
  const reorderSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reorderFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const itemReorderArrowRefs = useRef(
    new Map<
      string,
      Partial<Record<ItemReorderArrowDirection, FocusablePressable>>
    >(),
  );
  const appStateRef = useRef(AppState.currentState);
  const deferredItemReorderSuccessRef = useRef<{
    intent: MenuItemReorderIntent;
    itemName: string;
  } | null>(null);
  const lastItemReorderSuccessRef = useRef<MenuItemReorderIntent | null>(null);
  const observedSuccessOperationRef = useRef<string | null>(null);
  const announcedReconciliationRef = useRef(new Set<string>());
  const itemReorderAffirmedOffline =
    network?.isConnected === false || network?.isInternetReachable === false;
  const itemReorderAffirmedOfflineRef = useRef(itemReorderAffirmedOffline);
  itemReorderAffirmedOfflineRef.current = itemReorderAffirmedOffline;

  const clearReorderSuccessTimer = useCallback((): void => {
    if (reorderSuccessTimerRef.current !== null) {
      clearTimeout(reorderSuccessTimerRef.current);
      reorderSuccessTimerRef.current = null;
    }
  }, []);

  const clearReorderFocusTimer = useCallback((): void => {
    if (reorderFocusTimerRef.current !== null) {
      clearTimeout(reorderFocusTimerRef.current);
      reorderFocusTimerRef.current = null;
    }
  }, []);

  const rememberItemReorderArrow = useCallback(
    (
      itemId: string,
      direction: ItemReorderArrowDirection,
      control: FocusablePressable | null,
    ): void => {
      const remembered = itemReorderArrowRefs.current.get(itemId) ?? {};
      if (control === null) {
        delete remembered[direction];
        if (remembered.up === undefined && remembered.down === undefined) {
          itemReorderArrowRefs.current.delete(itemId);
        }
        return;
      }
      remembered[direction] = control;
      itemReorderArrowRefs.current.set(itemId, remembered);
    },
    [],
  );

  const focusItemReorderArrow = useCallback(
    (itemId: string, direction: ItemReorderArrowDirection): void => {
      if (Platform.OS !== "web") return;
      clearReorderFocusTimer();
      reorderFocusTimerRef.current = setTimeout(() => {
        itemReorderArrowRefs.current.get(itemId)?.[direction]?.focus?.();
        reorderFocusTimerRef.current = null;
      }, 0);
    },
    [clearReorderFocusTimer],
  );

  useEffect(() => {
    const arrowRefs = itemReorderArrowRefs.current;
    activeItemReorderRef.current = null;
    deferredItemReorderSuccessRef.current = null;
    lastItemReorderSuccessRef.current = null;
    observedSuccessOperationRef.current = null;
    announcedReconciliationRef.current.clear();
    clearReorderSuccessTimer();
    clearReorderFocusTimer();
    setItemReorderFeedback(null);
    return () => {
      activeItemReorderRef.current = null;
      deferredItemReorderSuccessRef.current = null;
      lastItemReorderSuccessRef.current = null;
      observedSuccessOperationRef.current = null;
      clearReorderSuccessTimer();
      clearReorderFocusTimer();
      arrowRefs.clear();
    };
  }, [
    brandId,
    clearReorderFocusTimer,
    clearReorderSuccessTimer,
    venueId,
  ]);

  // ---- category handlers ----
  const openAddCategory = useCallback((): void => {
    setSaveError(false);
    setCategorySaveFailure(null);
    setEditingCategory(null);
    setCategorySheetOpen(true);
  }, []);
  const openEditCategory = useCallback((menu: Menu): void => {
    setSaveError(false);
    setCategorySaveFailure(null);
    setEditingCategory(menu);
    setCategorySheetOpen(true);
  }, []);
  const closeCategorySheet = useCallback((): void => {
    setCategorySheetOpen(false);
    setEditingCategory(null);
    setCategorySaveFailure(null);
  }, []);

  const handleSaveCategory = useCallback(
    (input: MenuCategorySheetSaveInput): void => {
      setSaveError(false);
      setCategorySaveFailure(null);
      const nextSort =
        editingCategory !== null ? editingCategory.sortOrder : menus.length;
      upsertMenu.mutate(
        {
          id: input.id,
          name: input.name,
          description: input.description,
          sortOrder: nextSort,
          // #1789 (P-12) — service windows. Both null = always available.
          serviceWindowStart: input.serviceWindowStart,
          serviceWindowEnd: input.serviceWindowEnd,
          serviceDays: input.serviceDays,
        },
        {
          onSuccess: () => {
            closeCategorySheet();
          },
          onError: (error) =>
            setCategorySaveFailure(
              classifyMenuTextSaveFailure(error, "category"),
            ),
        },
      );
    },
    [closeCategorySheet, editingCategory, menus.length, upsertMenu],
  );

  const handleDeleteCategory = useCallback(
    (id: string): void => {
      setCategorySaveFailure(null);
      setSaveError(false);
      deleteMenu.mutate(id, {
        onSuccess: () => {
          setCategorySheetOpen(false);
          setEditingCategory(null);
        },
        onError: () => setSaveError(true),
      });
    },
    [deleteMenu],
  );

  // ---- item handlers ----
  const openAddItem = useCallback((menuId: string): void => {
    setSaveError(false);
    setItemSaveFailure(null);
    setItemSheetMenuId(menuId);
    setEditingItem(null);
    setItemSheetOpen(true);
  }, []);
  const openEditItem = useCallback((menuId: string, item: MenuItem): void => {
    setSaveError(false);
    setItemSaveFailure(null);
    setItemSheetMenuId(menuId);
    setEditingItem(item);
    setItemSheetOpen(true);
  }, []);

  const closeItemSheet = useCallback((): void => {
    // #3572 — closing here destroys the options subtree, and with it any
    // unsaved draft inside it. The sheet refuses the dismissal first; this is
    // the second lock, for anything that reaches the module directly.
    if (optionsSaving || optionsDirty) return;
    setItemSheetOpen(false);
    setItemSheetMenuId(null);
    setEditingItem(null);
    setItemSaveFailure(null);
  }, [optionsSaving, optionsDirty]);

  const handleSaveItem = useCallback(
    (input: MenuItemSheetSaveInput): void => {
      if (itemSheetMenuId === null) return;
      setSaveError(false);
      setItemSaveFailure(null);
      const parentMenu = menus.find((m) => m.id === itemSheetMenuId) ?? null;
      const nextSort =
        editingItem !== null
          ? editingItem.sortOrder
          : (parentMenu?.items.length ?? 0);
      upsertItem.mutate(
        {
          id: editingItem?.id,
          menuId: itemSheetMenuId,
          name: input.name,
          description: input.description,
          priceCents: input.priceCents,
          currency,
          isAvailable: input.isAvailable,
          sortOrder: nextSort,
          // #1789 (P-12) — menu depth. Facts, never client-side money math.
          allowsNotes: input.allowsNotes,
          prepStation: input.prepStation,
          costCents: input.costCents,
        },
        {
          onSuccess: () => {
            setItemSheetOpen(false);
            setEditingItem(null);
            setItemSheetMenuId(null);
            setItemSaveFailure(null);
          },
          onError: (error) =>
            setItemSaveFailure(classifyMenuTextSaveFailure(error, "item")),
        },
      );
    },
    [itemSheetMenuId, editingItem, menus, currency, upsertItem],
  );

  /**
   * #1789 (SPEC #1788 P-15) — flip ONE bit. The shipped upsert carries every
   * column, so the row's current values are passed through untouched and only
   * `isAvailable` changes. No new write path, no new RLS surface: the existing
   * manager-plus policy is the gate.
   */
  const toggle86 = useCallback(
    (menu: Menu, item: MenuItem): void => {
      setSaveError(false);
      setTogglingItemId(item.id);
      upsertItem.mutate(
        {
          id: item.id,
          menuId: menu.id,
          name: item.name,
          description: item.description,
          priceCents: item.priceCents,
          currency: item.currency,
          isAvailable: !item.isAvailable,
          sortOrder: item.sortOrder,
        },
        {
          onSuccess: () => setTogglingItemId(null),
          onError: () => {
            setTogglingItemId(null);
            setSaveError(true);
          },
        },
      );
    },
    [upsertItem],
  );

  const handleDeleteItem = useCallback(
    (id: string): void => {
      setItemSaveFailure(null);
      setSaveError(false);
      deleteItem.mutate(id, {
        onSuccess: () => {
          setItemSheetOpen(false);
          setEditingItem(null);
          setItemSheetMenuId(null);
          setItemSaveFailure(null);
        },
        onError: () => setSaveError(true),
      });
    },
    [deleteItem],
  );

  // ---- reorder ----
  const moveCategory = useCallback(
    (index: number, dir: -1 | 1): void => {
      const target = index + dir;
      if (target < 0 || target >= menus.length) return;
      const a = menus[index];
      const b = menus[target];
      if (a === undefined || b === undefined) return;
      setSaveError(false);
      reorderMenus.mutate(
        [
          { id: a.id, sortOrder: b.sortOrder },
          { id: b.id, sortOrder: a.sortOrder },
        ],
        { onError: () => setSaveError(true) },
      );
    },
    [menus, reorderMenus],
  );

  const completeItemReorderSuccess = useCallback(
    (
      intent: MenuItemReorderIntent,
      itemName: string,
      authoritativeMenus?: readonly Menu[],
    ): void => {
      if (activeItemReorderRef.current !== intent.operationId) return;
      if (appStateRef.current !== "active") {
        deferredItemReorderSuccessRef.current = { intent, itemName };
        return;
      }

      const authoritativeMenu = authoritativeMenus?.find(
        (menu) => menu.id === intent.menuId,
      );
      const authoritativePosition = authoritativeMenu?.items.findIndex(
        (item) => item.id === intent.movedItemId,
      );
      const desiredPosition = intent.orderedItemIds.indexOf(intent.movedItemId);
      const position =
        authoritativePosition !== undefined && authoritativePosition >= 0
          ? authoritativePosition + 1
          : desiredPosition + 1;
      const total = authoritativeMenu?.items.length ?? intent.orderedItemIds.length;
      const announcement = `${itemName} moved to position ${position} of ${total}. Order saved.`;

      activeItemReorderRef.current = null;
      deferredItemReorderSuccessRef.current = null;
      lastItemReorderSuccessRef.current = intent;
      clearReorderSuccessTimer();
      setItemReorderFeedback({
        operationId: intent.operationId,
        itemId: intent.movedItemId,
        itemName,
        status: "success",
        message: "Order saved.",
        intent,
        retryable: false,
      });
      AccessibilityInfo.announceForAccessibility(announcement);
      reorderSuccessTimerRef.current = setTimeout(() => {
        setItemReorderFeedback((current) =>
          current?.operationId === intent.operationId &&
          current.status === "success"
            ? null
            : current,
        );
        reorderSuccessTimerRef.current = null;
      }, REORDER_SUCCESS_MS);
    },
    [clearReorderSuccessTimer],
  );

  const runItemReorder = useCallback(
    (
      intent: MenuItemReorderIntent,
      itemName: string,
      operationAlreadyClaimed = false,
    ): boolean => {
      if (
        (operationAlreadyClaimed &&
          activeItemReorderRef.current !== intent.operationId) ||
        (!operationAlreadyClaimed && activeItemReorderRef.current !== null)
      ) {
        return false;
      }
      clearReorderSuccessTimer();
      lastItemReorderSuccessRef.current = null;
      observedSuccessOperationRef.current = null;
      activeItemReorderRef.current = intent.operationId;
      setItemReorderFeedback({
        operationId: intent.operationId,
        itemId: intent.movedItemId,
        itemName,
        status: "pending",
        message: "Saving new position…",
        intent,
        retryable: false,
      });
      reorderItems.mutate(intent, {
        onSuccess: () => completeItemReorderSuccess(intent, itemName),
        onError: (error: MenuItemReorderError) => {
          if (activeItemReorderRef.current !== intent.operationId) return;
          if (error.resolvedAsSuccess) {
            completeItemReorderSuccess(
              intent,
              itemName,
              error.authoritativeMenus,
            );
            return;
          }

          let message =
            "Couldn’t save the new order. The previous order is back.";
          if (error.category === "permission") {
            message =
              "You can’t reorder this menu with this account. The previous order is back.";
          } else if (error.category === "conflict") {
            message = error.retryable
              ? "This menu changed elsewhere. We loaded the latest order. Try your move again."
              : "This menu changed elsewhere. We loaded the latest order. Review the list and choose a new move.";
          } else if (error.category === "uncertain") {
            message = itemReorderAffirmedOfflineRef.current
              ? "You’re offline. The previous order is back. Reconnect, then try again."
              : "We couldn’t confirm the new order. The previous order is back.";
          }
          activeItemReorderRef.current = null;
          deferredItemReorderSuccessRef.current = null;
          setItemReorderFeedback({
            operationId: intent.operationId,
            itemId: intent.movedItemId,
            itemName,
            status: "error",
            message,
            intent,
            retryable: error.retryable,
          });
          AccessibilityInfo.announceForAccessibility(message);
          focusItemReorderArrow(intent.movedItemId, intent.direction);
        },
      });
      return true;
    },
    [
      clearReorderSuccessTimer,
      completeItemReorderSuccess,
      focusItemReorderArrow,
      reorderItems,
    ],
  );

  const moveItem = useCallback(
    (menu: Menu, index: number, dir: -1 | 1): void => {
      if (
        brandId === null ||
        venueId === null ||
        activeItemReorderRef.current !== null
      ) {
        return;
      }
      const moved = menu.items[index];
      if (moved === undefined) return;
      const intent = createAdjacentMenuItemReorderIntent({
        operationId: randomId(),
        brandId,
        venueId,
        menu,
        movedIndex: index,
        direction: dir === -1 ? "up" : "down",
      });
      if (intent === null) return;
      setSaveError(false);
      if (!runItemReorder(intent, moved.name)) return;
      const desiredIndex = index + dir;
      if (desiredIndex === 0 && dir === -1) {
        focusItemReorderArrow(moved.id, "down");
      } else if (desiredIndex === menu.items.length - 1 && dir === 1) {
        focusItemReorderArrow(moved.id, "up");
      }
    },
    [brandId, focusItemReorderArrow, runItemReorder, venueId],
  );

  const retryItemReorder = useCallback(async (): Promise<void> => {
    const feedback = itemReorderFeedback;
    if (
      feedback?.status !== "error" ||
      itemReorderAffirmedOffline ||
      activeItemReorderRef.current !== null
    ) {
      return;
    }

    const operationId = randomId();
    const confirmingIntent = { ...feedback.intent, operationId };
    activeItemReorderRef.current = operationId;
    setItemReorderFeedback({
      ...feedback,
      operationId,
      status: "pending",
      message: "Saving new position…",
      intent: confirmingIntent,
      retryable: false,
    });

    let latestMenus: readonly Menu[] | undefined;
    try {
      const result = await refetchMenus();
      if (result.isError) throw result.error;
      latestMenus = result.data;
    } catch {
      if (activeItemReorderRef.current !== operationId) return;
      const message =
        "We couldn’t confirm the new order. The previous order is back.";
      activeItemReorderRef.current = null;
      setItemReorderFeedback({
        ...feedback,
        operationId,
        status: "error",
        message,
        intent: confirmingIntent,
        retryable: true,
      });
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    if (activeItemReorderRef.current !== operationId) return;

    if (menuItemRelationshipIsApplied(latestMenus, feedback.intent)) {
      completeItemReorderSuccess(
        confirmingIntent,
        feedback.itemName,
        latestMenus,
      );
      return;
    }

    const retryIntent = rebuildMenuItemReorderIntent(
      latestMenus,
      feedback.intent,
      operationId,
    );
    if (retryIntent === null) {
      const message =
        "This menu changed elsewhere. We loaded the latest order. Review the list and choose a new move.";
      activeItemReorderRef.current = null;
      setItemReorderFeedback({
        ...feedback,
        operationId,
        message,
        intent: confirmingIntent,
        retryable: false,
      });
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    runItemReorder(retryIntent, feedback.itemName, true);
  }, [
    completeItemReorderSuccess,
    itemReorderAffirmedOffline,
    itemReorderFeedback,
    refetchMenus,
    runItemReorder,
  ]);

  const reconcileDeferredItemReorderSuccess = useCallback(async (): Promise<void> => {
    const deferred = deferredItemReorderSuccessRef.current;
    if (deferred === null) return;
    let latestMenus: readonly Menu[] | undefined;
    try {
      const result = await refetchMenus();
      if (result.isError) throw result.error;
      latestMenus = result.data;
    } catch {
      if (activeItemReorderRef.current !== deferred.intent.operationId) return;
      const message =
        "We couldn’t confirm the new order. The previous order is back.";
      activeItemReorderRef.current = null;
      deferredItemReorderSuccessRef.current = null;
      setItemReorderFeedback({
        operationId: deferred.intent.operationId,
        itemId: deferred.intent.movedItemId,
        itemName: deferred.itemName,
        status: "error",
        message,
        intent: deferred.intent,
        retryable: true,
      });
      AccessibilityInfo.announceForAccessibility(message);
      return;
    }
    if (activeItemReorderRef.current !== deferred.intent.operationId) return;
    if (menuItemRelationshipIsApplied(latestMenus, deferred.intent)) {
      completeItemReorderSuccess(
        deferred.intent,
        deferred.itemName,
        latestMenus,
      );
      return;
    }
    activeItemReorderRef.current = null;
    deferredItemReorderSuccessRef.current = null;
    setItemReorderFeedback(null);
    AccessibilityInfo.announceForAccessibility(
      "Menu order changed elsewhere. Showing the latest order.",
    );
  }, [completeItemReorderSuccess, refetchMenus]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appStateRef.current = nextState;
      if (nextState === "active") {
        void reconcileDeferredItemReorderSuccess();
      }
    });
    return () => subscription.remove();
  }, [reconcileDeferredItemReorderSuccess]);

  useEffect(() => {
    const settled = lastItemReorderSuccessRef.current;
    if (
      settled === null ||
      announcedReconciliationRef.current.has(settled.operationId)
    ) {
      return;
    }
    const menu = menus.find(
      (candidate) =>
        candidate.id === settled.menuId &&
        candidate.brandId === settled.brandId &&
        candidate.venueId === settled.venueId,
    );
    if (
      menu !== undefined &&
      menu.items.map((item) => item.id).join(",") ===
        settled.orderedItemIds.join(",")
    ) {
      observedSuccessOperationRef.current = settled.operationId;
      return;
    }
    if (observedSuccessOperationRef.current !== settled.operationId) return;
    announcedReconciliationRef.current.add(settled.operationId);
    AccessibilityInfo.announceForAccessibility(
      "Menu order changed elsewhere. Showing the latest order.",
    );
  }, [itemReorderFeedback?.operationId, itemReorderFeedback?.status, menus]);

  const itemReorderPending = itemReorderFeedback?.status === "pending";
  const itemReorderUnavailable = (menu: Menu): boolean =>
    venueId === null || venueId === undefined || menu.venueId !== venueId;
  const renderItemReorderFeedback = (ownerId: string): React.ReactElement | null => {
    if (itemReorderFeedback === null) return null;
    return (
      <View
        key={`${itemReorderFeedback.operationId}:${itemReorderFeedback.message}`}
        style={[
          styles.reorderFeedback,
          itemReorderFeedback.status === "error" &&
            styles.reorderFeedbackError,
          itemReorderFeedback.status === "error" &&
            stackItemRows &&
            styles.reorderFeedbackStacked,
          itemReorderFeedback.status === "error" &&
            Platform.OS === "android" &&
            styles.reorderFeedbackErrorAndroid,
        ]}
        accessibilityLiveRegion={
          itemReorderFeedback.status === "pending" ? "polite" : "none"
        }
        testID={`venue-menu-item-reorder-feedback-${ownerId}`}
      >
        <Text
          style={[
            styles.reorderFeedbackText,
            itemReorderFeedback.status === "pending" &&
              styles.reorderFeedbackPendingText,
            itemReorderFeedback.status === "success" &&
              styles.reorderFeedbackSuccessText,
            itemReorderFeedback.status === "error" &&
              styles.reorderFeedbackErrorText,
          ]}
        >
          {itemReorderFeedback.message}
        </Text>
        {itemReorderFeedback.status === "error" &&
        itemReorderFeedback.retryable ? (
          <Pressable
            onPress={() => void retryItemReorder()}
            disabled={itemReorderAffirmedOffline}
            accessibilityRole="button"
            accessibilityState={{ disabled: itemReorderAffirmedOffline }}
            accessibilityLabel={`Try moving ${itemReorderFeedback.itemName} ${itemReorderFeedback.intent.direction} again`}
            style={({ pressed }) => [
              styles.reorderRetry,
              itemReorderAffirmedOffline && styles.iconDisabled,
              pressed && !itemReorderAffirmedOffline && styles.pressed,
            ]}
            testID={`venue-menu-item-reorder-retry-${ownerId}`}
          >
            <Text style={styles.reorderRetryText}>Try again</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  // ---- render: loading ----
  if (menusQuery.isLoading) {
    return (
      <View style={styles.host} testID={testID ?? "venue-menu-module"}>
        <Text style={styles.intro} accessibilityLiveRegion="polite">
          Loading your menu…
        </Text>
        <View style={styles.skeletonWrap} testID="venue-menu-skeleton-wrap">
          <GlassCard variant="base" style={styles.skeletonCard}>
            <View style={[styles.skelBar, styles.skelHead]} />
            <View style={[styles.skelBar, styles.skelLine]} />
            <View style={[styles.skelBar, styles.skelLine]} />
          </GlassCard>
        </View>
        <View style={styles.skeletonWrap}>
          <GlassCard variant="base" style={styles.skeletonCard}>
            <View style={[styles.skelBar, styles.skelHead]} />
            <View style={[styles.skelBar, styles.skelLine]} />
          </GlassCard>
        </View>
      </View>
    );
  }

  // ---- render: error (read failure) ----
  if (menusQuery.isError) {
    return (
      <View style={styles.host} testID={testID ?? "venue-menu-module"}>
        <Text style={styles.errorNote}>
          Couldn&apos;t load your menu. Pull to refresh or try again.
        </Text>
      </View>
    );
  }

  // ---- render: empty ----
  if (menus.length === 0) {
    return (
      <View style={styles.host} testID={testID ?? "venue-menu-module"}>
        <VenueHubEmptyState
          icon="menu"
          title="Build your menu"
          body={
            canMutate
              ? visibilityCopy.emptyBody
              : "No menu yet. Ask a manager or owner to add one."
          }
          actionLabel={canMutate ? "Add a category" : undefined}
          onAction={canMutate ? openAddCategory : undefined}
          testID="venue-menu-empty"
          wrapTestID="venue-menu-empty-wrap"
          bodyTestID="venue-menu-empty-body"
          actionTestID="venue-menu-add-category"
        />

        <MenuCategorySheet
          visible={categorySheetOpen}
          onClose={closeCategorySheet}
          category={editingCategory}
          onSave={handleSaveCategory}
          saving={upsertMenu.isPending}
          saveFailure={categorySaveFailure}
          onClearSaveFailure={() => setCategorySaveFailure(null)}
          onDelete={canMutate ? handleDeleteCategory : undefined}
          deleting={deleteMenu.isPending}
          canDelete={canMutate}
        />
      </View>
    );
  }

  // ---- render: populated ----
  return (
    <View style={styles.host} testID={testID ?? "venue-menu-module"}>
      <Text style={styles.intro} testID="venue-menu-intro">
        {visibilityCopy.intro}
      </Text>

      {/*
        #1789 (#1767 Phase 1) — the way into the Spots inventory. It lives here
        because the Menu module is the one command-band module every venue has,
        including a Stay, so a hotelier and a restaurateur reach the SAME
        brand-scoped list. Rooms and tables side by side, one print button
        covering both (D-3b).
      */}
      {canMutate ? (
        <Button
          label="QR spots & printing"
          onPress={() => setSpotsSheetOpen(true)}
          variant="secondary"
          size="sm"
          leadingIcon="qr"
          style={styles.spotsEntry}
          testID="venue-menu-spots-entry"
        />
      ) : null}

      {saveError && !categorySheetOpen && !itemSheetOpen ? (
        <Text style={styles.errorNote} testID="venue-menu-error">
          That menu change wasn&apos;t saved. Try again.
        </Text>
      ) : null}

      {menus.map((menu, menuIndex) => (
        <GlassCard
          key={menu.id}
          variant="base"
          style={styles.categoryCard}
          testID={`venue-menu-category-${menu.id}`}
        >
          <View style={styles.categoryHeader}>
            <View style={styles.categoryHeaderText}>
              <Text style={styles.categoryName}>{menu.name}</Text>
              {menu.description !== null ? (
                <Text style={styles.categoryDesc} numberOfLines={2}>
                  {menu.description}
                </Text>
              ) : null}
              <Text
                style={styles.categorySchedule}
                accessibilityLabel={`Schedule: ${serviceWindowSummary({
                  start: menu.serviceWindowStart,
                  end: menu.serviceWindowEnd,
                  days: menu.serviceDays,
                })}`}
                testID={`venue-menu-category-schedule-${menu.id}`}
              >
                {serviceWindowSummary({
                  start: menu.serviceWindowStart,
                  end: menu.serviceWindowEnd,
                  days: menu.serviceDays,
                })}
              </Text>
            </View>
            {canMutate ? (
              <View style={styles.actionCluster}>
                <ArrowControl
                  label={`Move ${menu.name} up`}
                  glyph="▲"
                  disabled={menuIndex === 0}
                  onPress={() => moveCategory(menuIndex, -1)}
                  testID={`venue-menu-category-up-${menu.id}`}
                />
                <ArrowControl
                  label={`Move ${menu.name} down`}
                  glyph="▼"
                  disabled={menuIndex === menus.length - 1}
                  onPress={() => moveCategory(menuIndex, 1)}
                  testID={`venue-menu-category-down-${menu.id}`}
                />
                <TextControl
                  label={`Edit ${menu.name}`}
                  glyph="Edit"
                  onPress={() => openEditCategory(menu)}
                  testID={`venue-menu-category-edit-${menu.id}`}
                />
              </View>
            ) : null}
          </View>

          <View style={styles.divider} />

          <View
            accessibilityState={{
              busy:
                itemReorderPending &&
                itemReorderFeedback.intent.menuId === menu.id,
            }}
            testID={`venue-menu-item-list-${menu.id}`}
          >
            {menu.items.map((item, itemIndex) => (
              <React.Fragment key={item.id}>
                <View
              style={[
                styles.itemRow,
                stackItemRows && styles.itemRowStacked,
                !item.isAvailable && styles.itemHidden,
              ]}
              accessibilityLabel={`${item.name}, ${
                item.priceCents === null
                  ? "price on request"
                  : brandHasCurrency
                    ? formatCurrency(item.priceCents, item.currency, true)
                    : "—"
              }, ${item.isAvailable ? "available" : "hidden"}`}
              testID={`venue-menu-item-${item.id}`}
            >
              <View
                style={[
                  styles.itemLeft,
                  stackItemRows && styles.itemLeftStacked,
                ]}
                testID={`venue-menu-item-identity-${item.id}`}
              >
                <Text style={styles.itemName}>{item.name}</Text>
                {item.description !== null ? (
                  <Text
                    style={styles.itemDesc}
                    numberOfLines={3}
                    ellipsizeMode="tail"
                  >
                    {item.description}
                  </Text>
                ) : null}
              </View>
              <View
                style={[
                  styles.itemRight,
                  stackItemRows && styles.itemRightStacked,
                ]}
                testID={`venue-menu-item-controls-${item.id}`}
              >
                <View style={styles.itemStatusGroup}>
                  {item.priceCents === null ? (
                    <Text style={styles.priceOnRequest}>Price on request</Text>
                  ) : brandHasCurrency ? (
                    <Text style={styles.itemPrice}>
                      {formatCurrency(item.priceCents, item.currency, true)}
                    </Text>
                  ) : (
                    <Text style={styles.itemPrice}>—</Text>
                  )}
                  {/*
                    #1789 (SPEC #1788 P-15) — ONE-TAP 86, on the row.
                    The flag always existed; reaching it took ~5 taps behind the
                    edit form, which is five taps too many when the kitchen just
                    ran out mid-service. One tap now, and because
                    public_menus_view filters is_available the dish leaves the
                    guest menu on the very next read. Manager-plus, deliberately
                    (OQ-4 ruling: 86 changes what guests can buy, so it holds the
                    event_manager floor that RLS already enforces server-side).
                    A SIBLING Pressable, never nested inside another — a nested
                    Pressable flattens the a11y subtree.
                  */}
                  {canMutate ? (
                    <Pressable
                      onPress={() => toggle86(menu, item)}
                      disabled={togglingItemId === item.id}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: item.isAvailable }}
                      accessibilityLabel={
                        item.isAvailable
                          ? `${item.name} is on the menu. Tap to take it off.`
                          : `${item.name} is off the menu. Tap to put it back.`
                      }
                      hitSlop={12}
                      style={({ pressed }) => [
                        styles.availabilityToggle,
                        pressed && styles.pressed,
                      ]}
                      testID={`venue-menu-item-86-${item.id}`}
                    >
                      <View
                        style={[
                          styles.availabilityDot,
                          item.isAvailable
                            ? styles.dotAvailable
                            : styles.dotUnavailable,
                        ]}
                      />
                      <Text style={styles.availabilityLabel}>
                        {item.isAvailable ? "On" : "86'd"}
                      </Text>
                    </Pressable>
                  ) : (
                    <View
                      style={[
                        styles.availabilityDot,
                        item.isAvailable
                          ? styles.dotAvailable
                          : styles.dotUnavailable,
                      ]}
                    />
                  )}
                </View>
                {canMutate ? (
                  <View style={styles.actionCluster}>
                    <ArrowControl
                      label={`Move ${item.name} up, position ${itemIndex + 1} of ${menu.items.length}`}
                      glyph="▲"
                      position={`Position ${itemIndex + 1} of ${menu.items.length}`}
                      hint={
                        itemReorderUnavailable(menu)
                          ? "Save this category to this venue before changing item order."
                          : itemIndex > 0
                            ? `Moves before ${menu.items[itemIndex - 1]?.name}`
                            : "This item is already first in the menu."
                      }
                      busy={itemReorderPending}
                      disabled={
                        itemReorderUnavailable(menu) ||
                        itemIndex === 0 ||
                        itemReorderPending
                      }
                      onPress={() => moveItem(menu, itemIndex, -1)}
                      controlRef={(control) =>
                        rememberItemReorderArrow(item.id, "up", control)
                      }
                      testID={`venue-menu-item-up-${item.id}`}
                    />
                    <ArrowControl
                      label={`Move ${item.name} down, position ${itemIndex + 1} of ${menu.items.length}`}
                      glyph="▼"
                      position={`Position ${itemIndex + 1} of ${menu.items.length}`}
                      hint={
                        itemReorderUnavailable(menu)
                          ? "Save this category to this venue before changing item order."
                          : itemIndex < menu.items.length - 1
                            ? `Moves after ${menu.items[itemIndex + 1]?.name}`
                            : "This item is already last in the menu."
                      }
                      busy={itemReorderPending}
                      disabled={
                        itemReorderUnavailable(menu) ||
                        itemIndex === menu.items.length - 1 ||
                        itemReorderPending
                      }
                      onPress={() => moveItem(menu, itemIndex, 1)}
                      controlRef={(control) =>
                        rememberItemReorderArrow(item.id, "down", control)
                      }
                      testID={`venue-menu-item-down-${item.id}`}
                    />
                    <TextControl
                      label={`Edit ${item.name}`}
                      glyph="Edit"
                      onPress={() => openEditItem(menu.id, item)}
                      testID={`venue-menu-item-edit-${item.id}`}
                    />
                  </View>
                ) : null}
              </View>
                </View>
                {itemReorderFeedback?.itemId === item.id
                  ? renderItemReorderFeedback(item.id)
                  : null}
              </React.Fragment>
            ))}
          </View>

          {itemReorderUnavailable(menu) && canMutate ? (
            <Text
              style={styles.unassignedReorderNotice}
              testID={`venue-menu-item-reorder-unassigned-${menu.id}`}
            >
              Save this category to this venue before changing item order.
            </Text>
          ) : null}

          {itemReorderFeedback?.intent.menuId === menu.id &&
          !menu.items.some((item) => item.id === itemReorderFeedback.itemId)
            ? renderItemReorderFeedback(`menu-${menu.id}`)
            : null}

          {canMutate ? (
            <Pressable
              onPress={() => openAddItem(menu.id)}
              accessibilityRole="button"
              accessibilityLabel={`Add item to ${menu.name}`}
              style={({ pressed }) => [
                styles.addItemRow,
                pressed && styles.pressed,
              ]}
              testID={`venue-menu-add-item-${menu.id}`}
            >
              <Text style={styles.addItemLabel}>+ Add item</Text>
            </Pressable>
          ) : null}
        </GlassCard>
      ))}

      {canMutate ? (
        <Button
          label="Add a category"
          onPress={openAddCategory}
          variant="secondary"
          size="md"
          fullWidth
          style={styles.addCategoryBtn}
          testID="venue-menu-add-category"
        />
      ) : (
        <Text style={styles.readOnlyNote}>
          You can view this menu. Ask a manager or owner to make changes.
        </Text>
      )}

      <MenuCategorySheet
        visible={categorySheetOpen}
        onClose={closeCategorySheet}
        category={editingCategory}
        onSave={handleSaveCategory}
        saving={upsertMenu.isPending}
        saveFailure={categorySaveFailure}
        onClearSaveFailure={() => setCategorySaveFailure(null)}
        onDelete={canMutate ? handleDeleteCategory : undefined}
        deleting={deleteMenu.isPending}
        canDelete={canMutate}
      />
      {spotsSheetOpen ? (
        <React.Suspense fallback={null}>
          <LazyVenueSpotsSheet
            visible
            onClose={() => setSpotsSheetOpen(false)}
            brandId={brandId}
            canMutate={canMutate}
          />
        </React.Suspense>
      ) : null}

      <MenuItemSheet
        visible={itemSheetOpen}
        onClose={closeItemSheet}
        item={editingItem}
        currency={currency}
        brandHasCurrency={brandHasCurrency}
        onSave={handleSaveItem}
        saving={upsertItem.isPending}
        saveFailure={itemSaveFailure}
        onClearSaveFailure={() => setItemSaveFailure(null)}
        optionsSaving={optionsHoldsItemSheet}
        optionsDirty={optionsDirty}
        onDelete={canMutate ? handleDeleteItem : undefined}
        deleting={deleteItem.isPending}
        canDelete={canMutate}
        optionsSection={
          itemSheetOpen ? (
            <React.Suspense fallback={null}>
              <LazyMenuItemOptionsSection
                brandId={brandId}
                menuItemId={editingItem?.id ?? null}
                itemCurrency={editingItem?.currency ?? currency}
                canMutate={canMutate}
                onSavingChange={setOptionsSaving}
                onDirtyChange={setOptionsDirty}
              />
            </React.Suspense>
          ) : undefined
        }
      />
    </View>
  );
}

interface ControlProps {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
  position?: string;
  controlRef?: (control: FocusablePressable | null) => void;
  testID: string;
}

function ArrowControl({
  label,
  glyph,
  onPress,
  disabled = false,
  busy = false,
  hint,
  position,
  controlRef,
  testID,
}: ControlProps): React.ReactElement {
  return (
    <Pressable
      ref={controlRef}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityValue={position === undefined ? undefined : { text: position }}
      accessibilityState={{ disabled, busy }}
      style={({ pressed }) => [
        styles.iconControl,
        disabled && styles.iconDisabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}
    >
      <Text style={styles.iconGlyph}>{glyph}</Text>
    </Pressable>
  );
}

function TextControl({
  label,
  glyph,
  onPress,
  testID,
}: ControlProps): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.textControl, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={styles.textControlLabel}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  intro: {
    ...typography.bodySm,
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  // ---- category card ----
  categoryCard: {
    // ORCH-1190 R2 — full-width category card on WEB (see emptyCard).
    width: "100%",
    gap: spacing.sm,
  },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  categoryHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  categoryName: {
    ...typography.bodyLg,
    color: textTokens.primary,
  },
  categoryDesc: {
    ...typography.bodySm,
    color: textTokens.secondary,
  },
  categorySchedule: {
    ...typography.bodySm,
    color: textTokens.tertiary,
    marginTop: spacing.xxs,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: glass.border.profileBase,
    marginVertical: spacing.xs,
  },
  // ---- item row ----
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  itemRowStacked: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  itemHidden: {
    opacity: 0.5,
  },
  itemLeft: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  itemLeftStacked: {
    width: "100%",
  },
  itemName: {
    ...typography.body,
    color: textTokens.primary,
  },
  itemDesc: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  itemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  itemRightStacked: {
    width: "100%",
    alignSelf: "stretch",
    justifyContent: "space-between",
    flexWrap: "wrap",
    rowGap: spacing.xs,
  },
  itemStatusGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  itemPrice: {
    ...typography.body,
    fontWeight: "600",
    color: textTokens.primary,
  },
  priceOnRequest: {
    ...typography.bodySm,
    color: textTokens.tertiary,
  },
  spotsEntry: {
    alignSelf: "flex-start",
  },
  availabilityToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  availabilityLabel: {
    ...typography.micro,
    color: textTokens.tertiary,
  },
  availabilityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotAvailable: {
    backgroundColor: semantic.success,
  },
  dotUnavailable: {
    backgroundColor: textTokens.quaternary,
  },
  reorderFeedback: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    gap: spacing.sm,
  },
  reorderFeedbackError: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.md,
    borderWidth: 1,
    borderColor: semantic.error,
    borderRadius: radius.md,
    backgroundColor: semantic.errorTint,
  },
  reorderFeedbackErrorAndroid: {
    backgroundColor: androidOpaque.errorFill,
    overflow: "hidden",
    elevation: 0,
  },
  reorderFeedbackStacked: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  reorderFeedbackText: {
    flexShrink: 1,
  },
  reorderFeedbackPendingText: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  reorderFeedbackSuccessText: {
    ...typography.bodySm,
    color: semantic.success,
  },
  reorderFeedbackErrorText: {
    ...typography.bodySm,
    color: semantic.errorText,
    fontWeight: "600",
  },
  reorderRetry: {
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  reorderRetryText: {
    ...typography.buttonMd,
    color: accent.warm,
  },
  unassignedReorderNotice: {
    ...typography.caption,
    color: textTokens.tertiary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  // ---- controls ----
  actionCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  iconControl: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlyph: {
    ...typography.body,
    color: textTokens.secondary,
  },
  iconDisabled: {
    opacity: 0.3,
  },
  textControl: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: spacing.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  textControlLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  pressed: {
    opacity: 0.6,
  },
  // ---- add item ----
  addItemRow: {
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: "rgba(235,120,37,0.55)",
    borderStyle: "dashed",
    borderRadius: radius.md,
    alignItems: "center",
    marginTop: spacing.xs,
  },
  addItemLabel: {
    ...typography.bodySm,
    fontWeight: "600",
    color: "#eb7825",
  },
  addCategoryBtn: {
    alignSelf: "stretch",
  },
  // ---- read-only ----
  readOnlyNote: {
    ...typography.caption,
    color: textTokens.tertiary,
    textAlign: "center",
    paddingBottom: spacing.md,
  },
  // ---- error ----
  errorNote: {
    ...typography.bodySm,
    color: semantic.error,
  },
  // ---- skeleton ----
  // ORCH-1190 R4 — full-width loading skeleton on WEB, matching the proven
  // VenueTablesModule.tableCard pattern (BOTH width:"100%" AND alignSelf:"stretch").
  skeletonWrap: {
    width: "100%",
    alignSelf: "stretch",
  },
  skeletonCard: {
    width: "100%",
    alignSelf: "stretch",
    gap: spacing.sm,
  },
  skelBar: {
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.sm,
  },
  skelHead: {
    height: 16,
    width: "50%",
  },
  skelLine: {
    height: 12,
    width: "80%",
  },
});

export default VenueMenuModule;
