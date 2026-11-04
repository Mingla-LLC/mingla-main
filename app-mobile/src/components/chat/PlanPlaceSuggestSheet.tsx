/**
 * Issue #4261 amendment 1 (6.5 #7) — "Suggest a place" for a plan. The same
 * picker as the plan form; Add sends `plan_add_place` (the button spins), then
 * closes. A place already on the vote adds your vote and says so; a seventh
 * place is refused with "This vote already has 6 places." (the hook toasts).
 *
 * Opened from the chat card (its own RN Modal window) and from Matches, where
 * it renders inside the Matches window (`nested`), like PlanTimePickerSheet.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { chatTokens } from "../../constants/chatTokens";
import { createClientMessageId } from "../../utils/mergeMessages";
import { useAddPlanPlace } from "../../hooks/useChatPlans";
import { planAddPlaceInput, placeLinkInvalid, type PlanFormPlace } from "./planModel";
import { PlanPlacePicker } from "./PlanPlacePicker";
import type { ChatPlan } from "../../types/chatPlans";

const SNAP_POINTS = ["80%"];

interface PlanPlaceSuggestSheetProps {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  plan: ChatPlan | null;
  viewerId: string | null;
  /** Inside another RN Modal (Matches): render in that window instead of a new one. */
  nested?: boolean;
}

export function PlanPlaceSuggestSheet({
  visible,
  onClose,
  conversationId,
  plan,
  viewerId,
  nested = false,
}: PlanPlaceSuggestSheetProps): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const addPlace = useAddPlanPlace(conversationId);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<PlanFormPlace | null>(null);
  const [placeLink, setPlaceLink] = useState("");
  const [sessionToken, setSessionToken] = useState<string>(() => createClientMessageId());

  useEffect(() => {
    if (!visible) return;
    setQuery("");
    setPicked(null);
    setPlaceLink("");
    setSessionToken(createClientMessageId());
  }, [visible]);

  const busy = addPlace.isPending;
  const canAdd = picked !== null && !placeLinkInvalid(placeLink) && !busy;
  const lockerName = !plan
    ? ""
    : plan.canLock || plan.createdBy === viewerId
      ? t("chat:plan_voter_you")
      : (plan.createdByName ?? "").trim().split(/\s+/)[0] || t("chat:planSetBySomeone");

  const add = () => {
    if (!plan || !picked || busy) return;
    if (placeLinkInvalid(placeLink)) return;
    addPlace.mutate(
      { plan, input: planAddPlaceInput(plan.id, picked, placeLink) },
      { onSuccess: () => onClose() },
    );
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.headerSide}
        onPress={onClose}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t("chat:plan_form_cancel")}
        testID="plan-suggest-cancel"
      >
        <Text style={styles.cancelText}>{t("chat:plan_form_cancel")}</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle} accessibilityRole="header">{t("chat:plan_suggest_place_title")}</Text>
      <View style={[styles.headerSide, styles.headerRight]}>
        <TouchableOpacity
          style={[styles.add, canAdd || busy ? styles.addOn : styles.addOff]}
          onPress={add}
          disabled={!canAdd}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          accessibilityRole="button"
          accessibilityLabel={t("chat:plan_suggest_place_cta")}
          accessibilityState={{ disabled: !canAdd, busy }}
          testID="plan-suggest-add"
        >
          {busy ? (
            <ActivityIndicator size="small" color={chatTokens.textPrimary} />
          ) : (
            <Text style={[styles.addText, !canAdd && styles.addTextOff]}>{t("chat:plan_suggest_place_cta")}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <BaseBottomSheet
      visible={visible && plan !== null}
      onClose={busy ? () => undefined : onClose}
      theme="dark"
      snapPoints={SNAP_POINTS}
      scrollMode="scroll"
      wrapInRNModal={!nested}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={styles.sheetBackground}
      header={header}
      scrollProps={{ keyboardShouldPersistTaps: "handled", contentContainerStyle: styles.body }}
      accessibilityLabel={t("chat:plan_suggest_place_title")}
    >
      <View testID="plan-suggest-place-sheet" style={styles.inner}>
        <PlanPlacePicker
          query={query}
          onQuery={setQuery}
          picked={picked}
          onPick={(place) => {
            setPicked(place);
            setPlaceLink("");
          }}
          onClear={() => {
            setPicked(null);
            setPlaceLink("");
          }}
          placeLink={placeLink}
          onPlaceLink={setPlaceLink}
          sessionToken={sessionToken}
          visible={visible}
          testIDPrefix="plan-suggest"
        />
        <Text style={styles.helper}>{t("chat:plan_suggest_place_helper", { name: lockerName })}</Text>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetBackground: { backgroundColor: chatTokens.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  header: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: chatTokens.hairline,
  },
  headerSide: { width: 88, minHeight: 44, justifyContent: "center" },
  headerRight: { alignItems: "flex-end" },
  headerTitle: { flex: 1, textAlign: "center", color: chatTokens.textPrimary, fontSize: 17, fontWeight: "700" },
  cancelText: { color: chatTokens.textSecondary, fontSize: 15 },
  add: { minWidth: 64, height: 36, borderRadius: 18, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  addOn: { backgroundColor: chatTokens.accent },
  addOff: { backgroundColor: chatTokens.strip },
  addText: { color: chatTokens.textPrimary, fontSize: 15, fontWeight: "700" },
  addTextOff: { color: chatTokens.textMuted },
  body: { padding: 16, gap: 12, paddingBottom: 32 },
  inner: { gap: 12 },
  helper: { color: chatTokens.textSoft, fontSize: 12, lineHeight: 17 },
});
