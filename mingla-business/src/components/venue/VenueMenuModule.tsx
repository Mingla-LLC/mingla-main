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
 * HARD: NO order/cart/quantity/checkout/payment control anywhere (DEC-C,
 * I-PROPOSED-1186-MENU-DISPLAY-ONLY, strict-grep gate). NEVER touches
 * experience_stops / the snap-menu parser (I-PROPOSED-1186C-MENU-NOT-EXPERIENCE-STOPS).
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

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
import { formatCurrency, normalizeCurrency } from "../../utils/currency";
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
import { MenuItemSheet } from "./MenuItemSheet";

const MANAGER_PLUS_RANK = BRAND_ROLE_RANK.event_manager; // 40

export interface VenueMenuModuleProps {
  brandId: string | null;
  testID?: string;
}

export function VenueMenuModule({
  brandId,
  testID,
}: VenueMenuModuleProps): React.ReactElement {
  const brand = useCurrentBrand();
  const { rank } = useCurrentBrandRole(brandId);
  const canMutate = rank >= MANAGER_PLUS_RANK;
  const currency = normalizeCurrency(brand?.defaultCurrency);

  const menusQuery = useBrandMenus(brandId);
  const menus = menusQuery.data ?? [];

  const upsertMenu = useUpsertMenu(brandId);
  const deleteMenu = useDeleteMenu(brandId);
  const reorderMenus = useReorderMenus(brandId);
  const upsertItem = useUpsertMenuItem(brandId);
  const deleteItem = useDeleteMenuItem(brandId);
  const reorderItems = useReorderMenuItems(brandId);

  // ---- sheet state ----
  const [categorySheetOpen, setCategorySheetOpen] = useState<boolean>(false);
  const [editingCategory, setEditingCategory] = useState<Menu | null>(null);
  const [itemSheetOpen, setItemSheetOpen] = useState<boolean>(false);
  const [itemSheetMenuId, setItemSheetMenuId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [saveError, setSaveError] = useState<boolean>(false);

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
    (input: { name: string; description: string | null }): void => {
      setSaveError(false);
      const nextSort =
        editingCategory !== null
          ? editingCategory.sortOrder
          : menus.length;
      upsertMenu.mutate(
        {
          id: editingCategory?.id,
          name: input.name,
          description: input.description,
          sortOrder: nextSort,
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
    (input: {
      name: string;
      description: string | null;
      priceCents: number | null;
      isAvailable: boolean;
    }): void => {
      if (itemSheetMenuId === null) return;
      setSaveError(false);
      const parentMenu = menus.find((m) => m.id === itemSheetMenuId) ?? null;
      const nextSort =
        editingItem !== null
          ? editingItem.sortOrder
          : parentMenu?.items.length ?? 0;
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
        <Text
          style={styles.intro}
          accessibilityLiveRegion="polite"
        >
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
          Couldn't load your menu. Pull to refresh or try again.
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
            <Text style={styles.emptyEmoji} accessibilityElementsHidden>
              🍽️
            </Text>
            <Text style={styles.emptyTitle}>Build your menu</Text>
            <Text style={styles.emptyBody}>
              {canMutate
                ? "Add categories and priced items. Guests see your menu on your public page."
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
      <Text style={styles.intro}>
        Your menu shows on your public venue page. Build it by category.
      </Text>

      {saveError ? (
        <Text style={styles.errorNote} testID="venue-menu-error">
          Couldn't save. Check your connection and try again.
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
                  : formatCurrency(item.priceCents, item.currency, true)
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
                ) : (
                  <Text style={styles.itemPrice}>
                    {formatCurrency(item.priceCents, item.currency, true)}
                  </Text>
                )}
                <View
                  style={[
                    styles.availabilityDot,
                    item.isAvailable
                      ? styles.dotAvailable
                      : styles.dotUnavailable,
                  ]}
                />
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
      <MenuItemSheet
        visible={itemSheetOpen}
        onClose={() => setItemSheetOpen(false)}
        item={editingItem}
        currency={currency}
        onSave={handleSaveItem}
        saving={upsertItem.isPending}
        onDelete={canMutate ? handleDeleteItem : undefined}
        deleting={deleteItem.isPending}
        canDelete={canMutate}
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
      style={({ pressed }) => [
        styles.textControl,
        pressed && styles.pressed,
      ]}
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
    fontSize: 34,
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
