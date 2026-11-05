/**
 * Issue #4261 — a plan card's long-press menu and its "Edit title and note"
 * dialog (spec 5.5 #3). The menu offers Reply; Edit title and note (creator);
 * Cancel plan (creator, or an admin once the creator left) behind the
 * destructive confirm "Cancel {title}? Everyone sees it's off." No Copy,
 * Delete or React on a plan.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BaseBottomSheet } from "../ui/BaseBottomSheet";
import { Icon } from "../ui/Icon";
import { chatTokens } from "../../constants/chatTokens";
import { PLAN_NOTE_MAX, PLAN_TITLE_MAX } from "./planModel";
import type { ChatPlan } from "../../types/chatPlans";

export function PlanActionsMenu({
  plan,
  onClose,
  onReply,
  onEdit,
  onCancelPlan,
}: {
  plan: ChatPlan | null;
  onClose: () => void;
  onReply: (plan: ChatPlan) => void;
  onEdit: (plan: ChatPlan) => void;
  onCancelPlan: (plan: ChatPlan) => void;
}): React.ReactElement {
  const { t } = useTranslation(["chat"]);
  const confirmCancel = (target: ChatPlan) => {
    onClose();
    Alert.alert(t("chat:plan_cancel_confirm", { title: target.title }), undefined, [
      { text: t("chat:plan_form_cancel"), style: "cancel" },
      { text: t("chat:plan_cancel_action"), style: "destructive", onPress: () => onCancelPlan(target) },
    ]);
  };
  const rows = plan
    ? [
        { key: "reply", icon: "chatbubble-outline", label: t("chat:plan_reply"), danger: false, onPress: () => { onClose(); onReply(plan); } },
        ...(plan.canEdit && plan.status !== "cancelled"
          ? [{ key: "edit", icon: "create-outline", label: t("chat:plan_edit"), danger: false, onPress: () => { onClose(); onEdit(plan); } }]
          : []),
        ...(plan.canCancel && plan.status !== "cancelled"
          ? [{ key: "cancel", icon: "trash-outline", label: t("chat:plan_cancel_action"), danger: true, onPress: () => confirmCancel(plan) }]
          : []),
      ]
    : [];
  return (
    <BaseBottomSheet variant="center-dialog" theme="dark" visible={plan !== null} onClose={onClose} accessibilityLabel={plan?.title}>
      <View testID="plan-actions-menu">
        <Text style={styles.menuTitle} numberOfLines={2}>{plan?.title}</Text>
        {rows.map((row) => (
          <TouchableOpacity
            key={row.key}
            style={styles.menuRow}
            onPress={row.onPress}
            accessibilityRole="button"
            accessibilityLabel={row.label}
            testID={`plan-menu-${row.key}`}
          >
            <Icon name={row.icon} size={20} color={row.danger ? chatTokens.danger : chatTokens.textSecondary} />
            <Text style={[styles.menuText, row.danger && styles.menuDanger]}>{row.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </BaseBottomSheet>
  );
}

export function PlanEditSheet({
  plan,
  busy,
  onClose,
  onSave,
}: {
  plan: ChatPlan | null;
  busy: boolean;
  onClose: () => void;
  onSave: (plan: ChatPlan, title: string, note: string | null) => void;
}): React.ReactElement {
  const { t } = useTranslation(["chat", "common"]);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => {
    setTitle(plan?.title ?? "");
    setNote(plan?.note ?? "");
  }, [plan]);
  const canSave = title.trim().length > 0 && !busy;
  return (
    <BaseBottomSheet
      variant="center-dialog"
      theme="dark"
      visible={plan !== null}
      onClose={busy ? () => undefined : onClose}
      accessibilityLabel={t("chat:plan_edit")}
    >
      <View style={styles.form} testID="plan-edit-sheet">
        <Text style={styles.menuTitle}>{t("chat:plan_edit")}</Text>
        <Text style={styles.label}>{t("chat:plan_what_label")}</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          maxLength={PLAN_TITLE_MAX}
          placeholder={t("chat:plan_what_placeholder")}
          placeholderTextColor={chatTokens.textMuted}
          style={styles.input}
          accessibilityLabel={t("chat:plan_what_label")}
        />
        <Text style={styles.label}>{t("chat:plan_note_label")}</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          maxLength={PLAN_NOTE_MAX}
          multiline
          placeholderTextColor={chatTokens.textMuted}
          style={[styles.input, styles.noteInput]}
          accessibilityLabel={t("chat:plan_note_label")}
        />
        <View style={styles.actions}>
          <TouchableOpacity style={[styles.action, styles.ghost]} onPress={onClose} disabled={busy} accessibilityRole="button" accessibilityLabel={t("chat:plan_form_cancel")}>
            <Text style={styles.ghostText}>{t("chat:plan_form_cancel")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.action, styles.primary, !canSave && styles.disabled]}
            onPress={() => {
              if (plan && canSave) onSave(plan, title.trim(), note.trim() ? note.trim() : null);
            }}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel={t("common:done")}
            accessibilityState={{ disabled: !canSave, busy }}
            testID="plan-edit-save"
          >
            {busy ? <ActivityIndicator size="small" color={chatTokens.textPrimary} /> : <Text style={styles.primaryText}>{t("common:done")}</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </BaseBottomSheet>
  );
}

const styles = StyleSheet.create({
  menuTitle: { color: chatTokens.textPrimary, fontSize: 17, fontWeight: "700", marginBottom: 8 },
  menuRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 14 },
  menuText: { color: chatTokens.textPrimary, fontSize: 16, fontWeight: "500" },
  menuDanger: { color: chatTokens.danger },
  form: { gap: 8 },
  label: { color: chatTokens.textSecondary, fontSize: 13, fontWeight: "600" },
  input: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: chatTokens.inputBg,
    color: chatTokens.textPrimary,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  noteInput: { minHeight: 88, paddingTop: 12, textAlignVertical: "top" },
  actions: { flexDirection: "row", gap: 8, marginTop: 8 },
  action: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  ghost: { borderWidth: 1, borderColor: "rgba(255, 255, 255, 0.14)" },
  ghostText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "600" },
  primary: { backgroundColor: chatTokens.accent },
  primaryText: { color: chatTokens.textPrimary, fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.5 },
});
