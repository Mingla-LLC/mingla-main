/**
 * #4490 P3-2 — pick a dish or drink from the venue's own menu for a group
 * package's "What's included" (B §4 MenuItemPicker). A modal on wide web, a
 * sheet on phones; search by name; every row is one tap. Loading, error and
 * "no menu yet" states each have a way forward.
 */
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { color, radius, space, type } from "../../../../constants/designSystem";
import { useBrandMenus } from "../../../../hooks/useMenus";
import { useResponsiveLayout } from "../../../../hooks/useResponsiveLayout";
import { ScrollView } from "../../../../wrappers/SmartScrollView";
import { Button } from "../../../ui/Button";
import { Input } from "../../../ui/Input";
import { PickerSheetHead } from "../../../ui/PickerSheetHead";
import { Sheet } from "../../../ui/Sheet";
import { Skeleton } from "../../../ui/Skeleton";
import { money } from "./offersModel";

export interface PickedMenuItem {
  id: string;
  name: string;
}

export interface MenuItemPickerProps {
  visible: boolean;
  brandId: string | null;
  venueId: string | null;
  currency: string | null;
  onPick: (item: PickedMenuItem) => void;
  onClose: () => void;
  /** Open the venue's Menu (shown when there is nothing to pick). */
  onOpenMenu?: () => void;
}

export function MenuItemPicker({
  visible,
  brandId,
  venueId,
  currency,
  onPick,
  onClose,
  onOpenMenu,
}: MenuItemPickerProps): React.ReactElement {
  const { isWideDesktop } = useResponsiveLayout();
  const menusQuery = useBrandMenus(visible ? brandId : null, venueId);
  const [search, setSearch] = useState("");

  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (menusQuery.data ?? [])
      .filter((m) => m.isActive)
      .map((m) => ({
        id: m.id,
        name: m.name,
        items: m.items.filter((i) => needle.length === 0 || i.name.toLowerCase().includes(needle)),
      }))
      .filter((m) => m.items.length > 0);
  }, [menusQuery.data, search]);
  const total = (menusQuery.data ?? []).reduce((n, m) => n + m.items.length, 0);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint={0.8}
      presentation={isWideDesktop ? "modal" : undefined}
      testID="package-menu-picker"
    >
      <View style={styles.body}>
        <PickerSheetHead title="From your menu" onClose={onClose} testID="package-menu-picker-head" />
        {total > 6 ? (
          <Input
            value={search}
            onChangeText={setSearch}
            variant="search"
            placeholder="Search your menu"
            accessibilityLabel="Search your menu"
            clearable
            testID="package-menu-picker-search"
          />
        ) : null}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {menusQuery.isLoading ? (
            <View style={styles.list} accessibilityLabel="Loading your menu">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={52} radius="md" />
              ))}
            </View>
          ) : menusQuery.isError ? (
            <View style={styles.state}>
              <Text style={styles.stateTitle}>Couldn&apos;t load your menu</Text>
              <Text style={styles.hint}>Check your connection and try again.</Text>
              <Button label="Try again" variant="secondary" size="md" onPress={() => void menusQuery.refetch()} />
            </View>
          ) : total === 0 ? (
            <View style={styles.state} testID="package-menu-picker-empty">
              <Text style={styles.stateTitle}>No menu items yet</Text>
              <Text style={styles.hint}>Add dishes and drinks in Menu, then pick them here. You can also add a perk in words.</Text>
              {onOpenMenu !== undefined ? (
                <Button label="Open Menu" variant="secondary" size="md" onPress={onOpenMenu} testID="package-menu-picker-open-menu" />
              ) : null}
            </View>
          ) : groups.length === 0 ? (
            <Text style={styles.hint}>Nothing on your menu matches &ldquo;{search.trim()}&rdquo;.</Text>
          ) : (
            groups.map((menu) => (
              <View key={menu.id} style={styles.group}>
                <Text style={styles.groupLabel}>{menu.name}</Text>
                {menu.items.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => onPick({ id: item.id, name: item.name })}
                    accessibilityRole="button"
                    accessibilityLabel={`Include ${item.name}`}
                    style={({ pressed }) => [styles.row, pressed ? styles.pressed : null, !item.isAvailable ? styles.dim : null]}
                    testID={`package-menu-item-${item.id}`}
                  >
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{item.name}</Text>
                      {!item.isAvailable ? <Text style={styles.hint}>Marked unavailable on your menu</Text> : null}
                    </View>
                    {item.priceCents !== null ? <Text style={styles.price}>{money(item.priceCents, currency)}</Text> : null}
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: space[4], paddingTop: space[2], gap: space[2] },
  scroll: { flex: 1 },
  list: { gap: space[2], paddingBottom: space[8] },
  state: { gap: space[2], paddingVertical: space[4] },
  stateTitle: { ...type.row, color: color.text1 },
  hint: { ...type.caption, color: color.text3 },
  group: { gap: space[1] },
  groupLabel: { ...type.label, color: color.text3, marginTop: space[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[3],
    minHeight: 48,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
  },
  pressed: { backgroundColor: color.fill.pressed },
  dim: { opacity: 0.6 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { ...type.row, color: color.text1 },
  price: { ...type.small, color: color.text2 },
});
