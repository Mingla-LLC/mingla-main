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

import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { UtensilsCrossed } from "lucide-react-native";

import {
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
import type { Menu, MenuItem } from "../../services/menusService";
import { MenuCategorySheet } from "./MenuCategorySheet";
import type { MenuCategorySheetSaveInput } from "./MenuCategorySheet";
import { MenuItemSheet } from "./MenuItemSheet";
import type { MenuItemSheetSaveInput } from "./MenuItemSheet";

const MANAGER_PLUS_RANK = BRAND_ROLE_RANK.event_manager; // 40

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
    emptyBody: "Add categories and priced items. Guests see your menu on your public page.",
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
  const [itemSheetOpen, setItemSheetOpen] = useState<boolean>(false);
  const [itemSheetMenuId, setItemSheetMenuId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [saveError, setSaveError] = useState<boolean>(false);
  // #1789 — the row currently being 86'd, so one tap cannot fire twice.
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);
  const [spotsSheetOpen, setSpotsSheetOpen] = useState<boolean>(false);

  // ---- category handlers ----
  const openAddCategory = useCallback((): void => {
    setEditingCategory(null);
    setCategorySheetOpen(true);
  }, []);
  const openEditCategory = useCallback((menu: Menu): void => {
    setEditingCategory(menu);
    setCategorySheetOpen(true);
  }, []);

  const handleSaveCategory = useCallback(
    (input: MenuCategorySheetSaveInput): void => {
      setSaveError(false);
      const nextSort =
        editingCategory !== null ? editingCategory.sortOrder : menus.length;
      upsertMenu.mutate(
        {
          id: editingCategory?.id,
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
            setCategorySheetOpen(false);
            setEditingCategory(null);
          },
          onError: () => setSaveError(true),
        },
      );
    },
    [editingCategory, menus.length, upsertMenu],
  );

  const handleDeleteCategory = useCallback(
    (id: string): void => {
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
    setItemSheetMenuId(menuId);
    setEditingItem(null);
    setItemSheetOpen(true);
  }, []);
  const openEditItem = useCallback((menuId: string, item: MenuItem): void => {
    setItemSheetMenuId(menuId);
    setEditingItem(item);
    setItemSheetOpen(true);
  }, []);

  const handleSaveItem = useCallback(
    (input: MenuItemSheetSaveInput): void => {
      if (itemSheetMenuId === null) return;
      setSaveError(false);
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
          },
          onError: () => setSaveError(true),
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
      setSaveError(false);
      deleteItem.mutate(id, {
        onSuccess: () => {
          setItemSheetOpen(false);
          setEditingItem(null);
          setItemSheetMenuId(null);
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

  const moveItem = useCallback(
    (menu: Menu, index: number, dir: -1 | 1): void => {
      const target = index + dir;
      if (target < 0 || target >= menu.items.length) return;
      const a = menu.items[index];
      const b = menu.items[target];
      if (a === undefined || b === undefined) return;
      setSaveError(false);
      reorderItems.mutate(
        {
          menuId: menu.id,
          patches: [
            { id: a.id, sortOrder: b.sortOrder },
            { id: b.id, sortOrder: a.sortOrder },
          ],
        },
        { onError: () => setSaveError(true) },
      );
    },
    [reorderItems],
  );

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
        <View style={styles.emptyWrap} testID="venue-menu-empty-wrap">
          <GlassCard variant="base" style={styles.emptyCard}>
            <View style={styles.emptyEmoji} accessibilityElementsHidden>
              <UtensilsCrossed size={34} color={textTokens.primary} />
            </View>
            <Text style={styles.emptyTitle}>Build your menu</Text>
            <Text style={styles.emptyBody} testID="venue-menu-empty-body">
              {canMutate
                ? visibilityCopy.emptyBody
                : "No menu yet. Ask a manager or owner to add one."}
            </Text>
            {canMutate ? (
              <Button
                label="Add a category"
                onPress={openAddCategory}
                variant="primary"
                size="lg"
                fullWidth
                style={styles.emptyCta}
                testID="venue-menu-add-category"
              />
            ) : null}
          </GlassCard>
        </View>

        <MenuCategorySheet
          visible={categorySheetOpen}
          onClose={() => setCategorySheetOpen(false)}
          category={editingCategory}
          onSave={handleSaveCategory}
          saving={upsertMenu.isPending}
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

      {saveError ? (
        <Text style={styles.errorNote} testID="venue-menu-error">
          Couldn&apos;t save. Check your connection and try again.
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

          {menu.items.map((item, itemIndex) => (
            <View
              key={item.id}
              style={[styles.itemRow, !item.isAvailable && styles.itemHidden]}
              accessibilityLabel={`${item.name}, ${
                item.priceCents === null
                  ? "price on request"
                  : brandHasCurrency
                    ? formatCurrency(item.priceCents, item.currency, true)
                    : "—"
              }, ${item.isAvailable ? "available" : "hidden"}`}
            >
              <View style={styles.itemLeft}>
                <Text style={styles.itemName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.description !== null ? (
                  <Text style={styles.itemDesc} numberOfLines={2}>
                    {item.description}
                  </Text>
                ) : null}
              </View>
              <View style={styles.itemRight}>
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
                {canMutate ? (
                  <View style={styles.actionCluster}>
                    <ArrowControl
                      label={`Move ${item.name} up`}
                      glyph="▲"
                      disabled={itemIndex === 0}
                      onPress={() => moveItem(menu, itemIndex, -1)}
                      testID={`venue-menu-item-up-${item.id}`}
                    />
                    <ArrowControl
                      label={`Move ${item.name} down`}
                      glyph="▼"
                      disabled={itemIndex === menu.items.length - 1}
                      onPress={() => moveItem(menu, itemIndex, 1)}
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
          ))}

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
        onClose={() => setCategorySheetOpen(false)}
        category={editingCategory}
        onSave={handleSaveCategory}
        saving={upsertMenu.isPending}
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
        onClose={() => setItemSheetOpen(false)}
        item={editingItem}
        currency={currency}
        brandHasCurrency={brandHasCurrency}
        onSave={handleSaveItem}
        saving={upsertItem.isPending}
        onDelete={canMutate ? handleDeleteItem : undefined}
        deleting={deleteItem.isPending}
        canDelete={canMutate}
        optionsSection={
          itemSheetOpen ? (
            <React.Suspense fallback={null}>
              <LazyMenuItemOptionsSection
                brandId={brandId}
                menuItemId={editingItem?.id ?? null}
                currency={currency}
                canMutate={canMutate}
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
  testID: string;
}

function ArrowControl({
  label,
  glyph,
  onPress,
  disabled = false,
  testID,
}: ControlProps): React.ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
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
  itemHidden: {
    opacity: 0.5,
  },
  itemLeft: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
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
  // ---- empty ----
  // ORCH-1190 R4 — full-width empty "Build your menu" card on WEB, matching the
  // PROVEN-working VenueTablesModule.tableCard pattern (BOTH width:"100%" AND
  // alignSelf:"stretch", together). R3 dropped width:"100%" and regressed to a
  // narrow centered card while the header read full width; the sibling tableCard
  // proves both-together renders edge-to-edge in this exact shell.
  emptyWrap: {
    width: "100%",
    alignSelf: "stretch",
  },
  emptyCard: {
    width: "100%",
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyEmoji: {
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    ...typography.bodyLg,
    color: textTokens.primary,
    textAlign: "center",
  },
  emptyBody: {
    ...typography.bodySm,
    color: textTokens.secondary,
    textAlign: "center",
  },
  emptyCta: {
    marginTop: spacing.sm,
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
