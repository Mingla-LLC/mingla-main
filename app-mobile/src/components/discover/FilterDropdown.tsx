import React, { useEffect, useMemo, useState } from "react";
import { BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Icon } from "../ui/Icon";
import type { DiscoverFacetGroup, DiscoverFiltersV2, DiscoverPriceBands } from "../../types/discoverFeed";
import { formatPriceBandLabel } from "../../utils/discoverPriceBandLabel";
import { setDiscoverGuests, updateDiscoverFilter } from "./discoverFilterState";

interface Props {
  visible: boolean;
  anchorTop: number;
  groups: DiscoverFacetGroup[];
  filters: DiscoverFiltersV2;
  resultCount: number;
  priceBands: DiscoverPriceBands | null;
  onDraftChange: (filters: DiscoverFiltersV2) => void;
  onApply: (filters: DiscoverFiltersV2) => void;
  onClose: () => void;
  t: (key: string, values?: Record<string, unknown>) => string;
}

export function FilterDropdown({ visible, anchorTop, groups, filters, resultCount, priceBands, onDraftChange, onApply, onClose, t }: Props): React.ReactElement | null {
  const [draft, setDraft] = useState(filters);
  useEffect(() => { if (visible) setDraft(filters); }, [visible, filters]);
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => subscription.remove();
  }, [visible, onClose]);
  const guests = draft.kind === "stays" ? draft.f.guests ?? 2 : 2;
  const content = useMemo(() => groups.filter((group) => group.id !== "price" || priceBands), [groups, priceBands]);
  if (!visible) return null;
  const set = (next: DiscoverFiltersV2): void => { setDraft(next); onDraftChange(next); };
  const groupKey = (id: DiscoverFacetGroup["id"]): string => ({
    when: "when", price: "price", partyType: "party_type", vibe: "vibe", music: "music",
    goodFor: "good_for", destination: "destination", leavingFrom: "leaving_from",
    checkIn: "check_in", propertyKind: "property_kind", guests: "guests",
  })[id];
  const optionKey = (group: DiscoverFacetGroup, id: string): string | null => {
    if (group.id === "when") return `when.${id}`;
    if (group.id === "price") return `price.${id}`;
    if (group.id === "partyType") return `taxonomy.party.${id}`;
    if (group.id === "vibe") return `taxonomy.vibe.${id}`;
    if (group.id === "music") return `taxonomy.music.${id}`;
    if (group.id === "goodFor") return `good_for.${id.replaceAll("-", "_")}`;
    if (group.id === "checkIn") return id === "tonight" ? "checkin.tonight" : `when.${id}`;
    if (group.id === "propertyKind") return `property.${id}`;
    return null;
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.dim} onPress={onClose} accessibilityLabel={t("filters.close")} />
        <View style={[styles.menu, { top: anchorTop }]}>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            {content.map((group, groupIndex) => (
              <View key={group.id}>
                {groupIndex > 0 ? <View style={styles.divider} /> : null}
                <Text style={styles.heading}>{t(`group.${groupKey(group.id)}`).toUpperCase()}</Text>
                {group.id === "guests" ? (
                  <View style={styles.guests}>
                    <Text style={styles.guestLabel}>{t("filters.guests")}</Text>
                    <View style={styles.stepper}>
                      <Pressable onPress={() => set(setDiscoverGuests(draft, guests - 1))} disabled={guests <= 1} style={styles.step}><Icon name="remove" size={16} color="#fff" /></Pressable>
                      <Text style={styles.guestCount}>{guests}</Text>
                      <Pressable onPress={() => set(setDiscoverGuests(draft, guests + 1))} disabled={guests >= 8} style={styles.step}><Icon name="add" size={16} color="#fff" /></Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={group.multi ? styles.chips : styles.segment}>
                    {group.options.map((option, index) => {
                      const field = ({ when: "when", price: "price", partyType: "partyTypes", vibe: "vibeTags", music: "musicGenres", goodFor: "goodFor", destination: "destination", leavingFrom: "leavingFrom", checkIn: "checkIn", propertyKind: "propertyKinds" } as Record<string, string>)[group.id];
                      const value = (draft.f as Record<string, unknown>)[field];
                      const selected = value === option.id || (Array.isArray(value) && value.includes(option.id));
                      const disabled = option.count === 0 && !selected;
                      const key = optionKey(group, option.id);
                      let label = option.label ?? (key ? t(key) : option.id);
                      if (group.id === "price" && option.id.startsWith("band_") && priceBands) {
                        label = formatPriceBandLabel(Number(option.id.slice(-1)) - 1, priceBands, (key, values) => t(key, values));
                      }
                      return (
                        <Pressable
                          key={option.id}
                          disabled={disabled}
                          accessibilityRole={group.multi ? "checkbox" : "radio"}
                          accessibilityState={{ checked: selected, disabled }}
                          onPress={() => set(updateDiscoverFilter(draft, group, option.id))}
                          style={[group.multi ? styles.chip : styles.segmentOption, !group.multi && index === 0 && styles.segmentFirst, selected && styles.selected, disabled && styles.disabled]}
                        >
                          <Text style={[styles.optionText, selected && styles.selectedText]}>{label}</Text>
                          {group.multi ? <Text style={styles.count}>{option.count}</Text> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
          <View style={styles.footer}>
            <Pressable onPress={() => set({ kind: draft.kind, f: draft.kind === "stays" ? { guests: 2 } : {} } as DiscoverFiltersV2)}><Text style={styles.clear}>{t("filters.clear")}</Text></Pressable>
            <Pressable onPress={() => onApply(draft)} style={styles.show}><Text style={styles.showText}>{t("filters.show", { count: resultCount, defaultValue: `Show ${resultCount}` })}</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, dim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,.45)" },
  menu: { position: "absolute", left: 12, width: "78%", maxWidth: 316, maxHeight: "66%", borderRadius: 18, borderWidth: 1, borderColor: "rgba(255,255,255,.12)", backgroundColor: "#1c1f25", overflow: "hidden", shadowColor: "#000", shadowOpacity: .55, shadowRadius: 40, shadowOffset: { width: 0, height: 18 } },
  scroll: { flexGrow: 0 }, scrollContent: { paddingHorizontal: 4, paddingVertical: 6 },
  heading: { marginHorizontal: 12, marginTop: 8, marginBottom: 4, color: "rgba(255,255,255,.45)", fontSize: 11, fontWeight: "700", letterSpacing: .6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 10, paddingBottom: 6 },
  chip: { height: 32, borderRadius: 16, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,.06)" },
  segment: { minHeight: 36, borderRadius: 12, padding: 3, marginHorizontal: 10, marginBottom: 6, backgroundColor: "rgba(255,255,255,.06)", flexDirection: "row" },
  segmentOption: { flex: 1, minHeight: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 }, segmentFirst: {},
  selected: { backgroundColor: "#eb7825" }, disabled: { opacity: .35 }, optionText: { color: "rgba(255,255,255,.85)", fontSize: 13, fontWeight: "500" }, selectedText: { color: "#fff" }, count: { color: "rgba(255,255,255,.45)", fontSize: 11 },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,.1)", marginHorizontal: 8, marginVertical: 6 },
  guests: { height: 44, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, guestLabel: { color: "#fff", fontSize: 14 }, stepper: { flexDirection: "row", gap: 10, alignItems: "center" }, step: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: "rgba(255,255,255,.25)", alignItems: "center", justifyContent: "center" }, guestCount: { color: "#fff", fontSize: 14, fontWeight: "700", minWidth: 20, textAlign: "center" },
  footer: { height: 52, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,.1)", paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, clear: { color: "rgba(255,255,255,.6)", fontSize: 14, textDecorationLine: "underline" }, show: { height: 36, borderRadius: 18, paddingHorizontal: 16, backgroundColor: "#eb7825", alignItems: "center", justifyContent: "center" }, showText: { color: "#fff", fontSize: 14, fontWeight: "600" },
});
