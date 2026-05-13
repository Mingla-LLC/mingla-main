/**
 * ORCH-0821 — ToolProposalCard
 *
 * The critical UX moment. Renders a proposed write (create_brand / create_event /
 * update_event) as a confirmation card with Cancel / Edit / Confirm actions.
 *
 * Edit mode expands in place (no modal) — ToolEditForm.
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  ariPalette,
  glass,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import { AriOrb } from "./AriOrb";
import { ToolEditForm } from "./ToolEditForm";
import { GlassChrome } from "../ui/GlassChrome";

// Premium proposal-card metrics — tighter than the default kit values.
// The card should read as a glanceable confirmation, not a form.
const CARD_PADDING = 14;
const IDENTITY_FONT = 16;
const IDENTITY_LINE = 22;
const FIELD_LABEL_FONT = 11;
const FIELD_VALUE_FONT = 13;
const VERB_FONT = 10;
const VERB_LETTER_SPACING = 1.1;
const BUTTON_HEIGHT = 36;
const BUTTON_FONT = 13;

export interface ToolProposalCardProps {
  toolName: string;
  args: Record<string, unknown>;
  isExecuting: boolean;
  onConfirm: (editedArgs?: Record<string, unknown>) => void;
  onCancel: () => void;
}

interface Field {
  icon: "calendar" | "location" | "tag" | "cash";
  label: string;
  value: string;
}

function humanizeToolName(toolName: string): string {
  switch (toolName) {
    case "create_brand": return "Create brand";
    case "create_event": return "Create event";
    case "update_event": return "Update event";
    default: return toolName.replace(/_/g, " ");
  }
}

function primaryIdentity(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "create_brand") return (args.name as string) || "New brand";
  if (toolName === "create_event") return (args.title as string) || "New event";
  if (toolName === "update_event") return "Event update";
  return toolName;
}

function fieldsFor(toolName: string, args: Record<string, unknown>): Field[] {
  const out: Field[] = [];
  if (toolName === "create_event" || toolName === "update_event") {
    if (typeof args.start_at === "string") {
      const d = new Date(args.start_at);
      if (!Number.isNaN(d.getTime())) {
        const date = d.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
        out.push({ icon: "calendar", label: "When", value: date });
      }
    }
    if (typeof args.location_text === "string" && args.location_text) {
      out.push({ icon: "location", label: "Where", value: args.location_text });
    }
    if (typeof args.brand_id === "string") {
      out.push({ icon: "tag", label: "Brand", value: String(args.brand_id).slice(0, 8) + "…" });
    }
    if (typeof args.visibility === "string") {
      out.push({ icon: "tag", label: "Visibility", value: args.visibility });
    }
  }
  if (toolName === "create_brand") {
    if (typeof args.default_currency === "string") {
      out.push({ icon: "cash", label: "Currency", value: args.default_currency });
    }
    if (typeof args.slug === "string") {
      out.push({ icon: "tag", label: "Slug", value: args.slug });
    }
  }
  return out;
}

export const ToolProposalCard: React.FC<ToolProposalCardProps> = ({
  toolName,
  args,
  isExecuting,
  onConfirm,
  onCancel,
}) => {
  const [editing, setEditing] = useState(false);
  const [editedArgs, setEditedArgs] = useState<Record<string, unknown>>(args);
  const verb = humanizeToolName(toolName);
  const identity = primaryIdentity(toolName, editing ? editedArgs : args);
  const fields = fieldsFor(toolName, editing ? editedArgs : args);

  return (
    <GlassChrome
      intensity="cardElevated"
      tintColor={glass.tint.profileElevated}
      borderColor={ariPalette.proposalBorder}
      radius="lg"
      style={styles.card}
    >
      <View style={styles.inner} accessibilityRole="summary">
        <View style={styles.headerRow}>
          <AriOrb size="xs" decorative />
          <Text style={styles.verb} numberOfLines={1}>{verb.toUpperCase()}</Text>
        </View>

        <Text style={styles.identity} numberOfLines={2}>{identity}</Text>

        {editing ? (
          <ToolEditForm
            toolName={toolName}
            args={editedArgs}
            onChange={setEditedArgs}
          />
        ) : (
          fields.length > 0 && (
            <View style={styles.fields}>
              {fields.map((f, i) => (
                <View key={i} style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
                  <Text style={styles.fieldValue} numberOfLines={1}>{f.value}</Text>
                </View>
              ))}
            </View>
          )
        )}

        <View style={styles.actions}>
          <Pressable
            onPress={onCancel}
            disabled={isExecuting}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.cancelBtn,
              pressed && styles.btnPressed,
              isExecuting && styles.btnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Cancel proposal"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={() => setEditing((e) => !e)}
            disabled={isExecuting}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.editBtn,
              pressed && styles.btnPressed,
              isExecuting && styles.btnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={editing ? "Stop editing" : "Edit proposal"}
          >
            <Text style={styles.editText}>{editing ? "Done editing" : "Edit"}</Text>
          </Pressable>
          <Pressable
            onPress={() => onConfirm(editing ? editedArgs : undefined)}
            disabled={isExecuting}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.confirmBtn,
              pressed && styles.btnPressed,
              isExecuting && styles.btnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Confirm proposal"
          >
            <Text style={styles.confirmText}>{isExecuting ? "Working…" : "Confirm"}</Text>
          </Pressable>
        </View>
      </View>
    </GlassChrome>
  );
};

const styles = StyleSheet.create({
  card: {
    marginVertical: 6,
  },
  inner: {
    padding: CARD_PADDING,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  verb: {
    fontSize: VERB_FONT,
    lineHeight: 12,
    fontWeight: "600",
    letterSpacing: VERB_LETTER_SPACING,
    color: textTokens.secondary,
  },
  identity: {
    marginTop: 8,
    fontSize: IDENTITY_FONT,
    lineHeight: IDENTITY_LINE,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  fields: {
    marginTop: 8,
    gap: 4,
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  fieldLabel: {
    fontSize: FIELD_LABEL_FONT,
    lineHeight: 14,
    color: textTokens.tertiary,
    letterSpacing: 0.1,
  },
  fieldValue: {
    fontSize: FIELD_VALUE_FONT,
    lineHeight: 17,
    color: textTokens.primary,
    marginLeft: spacing.sm,
    flexShrink: 1,
  },
  actions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 6,
  },
  actionBtn: {
    height: BUTTON_HEIGHT,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: glass.border.chrome,
  },
  editBtn: {
    flex: 1,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  confirmBtn: {
    flex: 1.6,
    backgroundColor: ariPalette.flame,
    shadowColor: ariPalette.flame,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 0,
  },
  cancelText: {
    fontSize: BUTTON_FONT,
    fontWeight: "500",
    color: textTokens.secondary,
    letterSpacing: -0.1,
  },
  editText: {
    fontSize: BUTTON_FONT,
    fontWeight: "500",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  confirmText: {
    fontSize: BUTTON_FONT,
    fontWeight: "600",
    color: textTokens.inverse,
    letterSpacing: -0.1,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnDisabled: {
    opacity: 0.4,
  },
});

export default ToolProposalCard;
