/**
 * Issue #4261 amendment 1 (6.5 #1) — the place picker shared by the plan form
 * and "Suggest a place": search (Mingla places first, then Google, then
 * `Use "{q}"`), the picked row with Change, the Google retrieve, and "Some
 * results couldn't load.".
 *
 * New: after a pick that is not on Mingla (Google or typed), "Add a link
 * (optional)" reveals a URL field for the place's own website, menu or
 * tickets. A Mingla place shows no link field (its card has the venue's
 * links). Changing the place clears the link (the parent owns that rule).
 */
import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { toastManager } from "../ui/Toast";
import { chatTokens } from "../../constants/chatTokens";
import { usePlanPlaceSearch } from "../../hooks/usePlanPlaceSearch";
import { retrievePlaceForPlan } from "../../services/planPlaceSearchService";
import { placeLinkInvalid, type PlaceResultRow, type PlanFormPlace } from "./planModel";

interface PlanPlacePickerProps {
  query: string;
  onQuery: (query: string) => void;
  picked: PlanFormPlace | null;
  onPick: (place: PlanFormPlace) => void;
  onClear: () => void;
  placeLink: string;
  onPlaceLink: (link: string) => void;
  sessionToken: string;
  visible: boolean;
  testIDPrefix?: string;
}

export function PlanPlacePicker({
  query,
  onQuery,
  picked,
  onPick,
  onClear,
  placeLink,
  onPlaceLink,
  sessionToken,
  visible,
  testIDPrefix = "plan-form",
}: PlanPlacePickerProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const [retrievingKey, setRetrievingKey] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const search = usePlanPlaceSearch(query, sessionToken, visible && picked === null);

  const pick = (place: PlanFormPlace) => {
    setLinkOpen(false);
    onPick(place);
    onQuery("");
  };

  const pickResult = async (row: PlaceResultRow) => {
    if (row.kind === "pool") {
      pick({ source: "pool", name: row.name, area: row.area, poolId: row.poolId, lat: row.lat, lng: row.lng });
      return;
    }
    if (row.kind === "typed") {
      pick({ source: "typed", name: row.name.slice(0, 120), area: null });
      return;
    }
    if (retrievingKey) return;
    setRetrievingKey(row.key);
    try {
      const details = await retrievePlaceForPlan(row.providerPlaceId, sessionToken, row.name);
      pick({
        source: "google",
        name: details.name,
        area: details.address ?? row.area,
        providerPlaceId: details.providerPlaceId,
        lat: details.lat,
        lng: details.lng,
      });
    } catch (error) {
      console.warn("[PlanPlacePicker] Google retrieve failed", error);
      toastManager.error(t("chat:plan_place_load_failed"));
    } finally {
      setRetrievingKey(null);
    }
  };

  if (picked) {
    const offMingla = picked.source !== "pool";
    const invalid = placeLinkInvalid(placeLink);
    return (
      <View style={styles.block}>
        <View style={styles.picked} testID={`${testIDPrefix}-picked`}>
          <Icon name="location" size={18} color={chatTokens.accent} />
          <View style={styles.rowText}>
            <Text style={styles.rowName} numberOfLines={1}>{picked.name}</Text>
            {picked.area ? <Text style={styles.rowArea} numberOfLines={1}>{picked.area}</Text> : null}
          </View>
          <TouchableOpacity
            onPress={() => {
              setLinkOpen(false);
              onClear();
            }}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t("chat:plan_change")}
            testID={`${testIDPrefix}-change-place`}
          >
            <Text style={styles.change}>{t("chat:plan_change")}</Text>
          </TouchableOpacity>
        </View>
        {offMingla && !linkOpen && placeLink.trim() === "" ? (
          <TouchableOpacity
            style={styles.linkAdd}
            onPress={() => setLinkOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={t("chat:plan_place_link_add")}
            testID={`${testIDPrefix}-place-link-add`}
          >
            <Icon name="link" size={15} color={chatTokens.tagChat} />
            <Text style={styles.linkAddText}>{t("chat:plan_place_link_add")}</Text>
          </TouchableOpacity>
        ) : null}
        {offMingla && (linkOpen || placeLink.trim() !== "") ? (
          <View style={styles.block}>
            <BottomSheetTextInput
              value={placeLink}
              onChangeText={onPlaceLink}
              placeholder={t("chat:plan_place_link_placeholder")}
              placeholderTextColor={chatTokens.textMuted}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel={t("chat:plan_place_link_placeholder")}
              testID={`${testIDPrefix}-place-link`}
            />
            <Text style={[styles.subLabel, invalid && styles.invalid]}>
              {invalid ? t("chat:plan_place_link_invalid") : t("chat:plan_place_link_helper")}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <View style={styles.searchField}>
        <Icon name="search" size={16} color={chatTokens.textMuted} />
        <BottomSheetTextInput
          value={query}
          onChangeText={onQuery}
          placeholder={t("chat:plan_search_placeholder")}
          placeholderTextColor={chatTokens.textMuted}
          style={styles.searchInput}
          autoCorrect={false}
          accessibilityLabel={t("chat:plan_search_placeholder")}
          testID={`${testIDPrefix}-search`}
        />
        {search.isSearching ? <ActivityIndicator size="small" color={chatTokens.textSoft} /> : null}
      </View>
      <Text style={styles.subLabel}>
        {query.trim().length < 2 ? t("chat:plan_search_empty_label") : t("chat:plan_search_results")}
      </Text>
      {search.rows.map((row) => (
        <TouchableOpacity
          key={row.key}
          style={styles.resultRow}
          onPress={() => void pickResult(row)}
          disabled={retrievingKey !== null}
          accessibilityRole="button"
          accessibilityLabel={row.kind === "typed" ? t("chat:plan_search_use_typed", { query: row.name }) : [row.name, row.area].filter(Boolean).join(", ")}
          testID={`plan-place-${row.kind}`}
        >
          <View style={styles.rowText}>
            <Text style={styles.rowName} numberOfLines={1}>
              {row.kind === "typed" ? t("chat:plan_search_use_typed", { query: row.name }) : row.name}
            </Text>
            <Text style={styles.rowArea} numberOfLines={1}>
              {row.kind === "typed" ? t("chat:plan_search_use_typed_sub") : row.area ?? ""}
            </Text>
          </View>
          {retrievingKey === row.key ? <ActivityIndicator size="small" color={chatTokens.textSoft} /> : null}
          {row.onMingla ? (
            <View style={styles.onMingla}>
              <Text style={styles.onMinglaText}>{t("chat:plan_search_on_mingla")}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      ))}
      {search.partialFailure ? <Text style={styles.subLabel}>{t("chat:plan_search_partial_failure")}</Text> : null}
      {search.hasQuery ? <Text style={styles.attribution}>{t("chat:plan_search_attribution")}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  subLabel: { color: chatTokens.textSoft, fontSize: 12 },
  invalid: { color: chatTokens.warning },
  input: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: chatTokens.inputBg,
    color: chatTokens.textPrimary,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  searchField: {
    height: 46,
    borderRadius: 14,
    backgroundColor: chatTokens.inputBg,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: { flex: 1, color: chatTokens.textPrimary, fontSize: 15, height: 46 },
  resultRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  rowText: { flex: 1, minWidth: 0 },
  rowName: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  rowArea: { color: chatTokens.textSecondary, fontSize: 12 },
  onMingla: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: chatTokens.accentSoft },
  onMinglaText: { color: chatTokens.tagDeck, fontSize: 11, fontWeight: "700" },
  attribution: { color: chatTokens.textMuted, fontSize: 11 },
  picked: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: chatTokens.inputBg,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
  },
  change: { color: chatTokens.accent, fontSize: 14, fontWeight: "700" },
  linkAdd: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  linkAddText: { color: chatTokens.tagChat, fontSize: 14, fontWeight: "600" },
});
