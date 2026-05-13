/**
 * ORCH-0821 — ToolEditForm
 * Inline form expansion for ToolProposalCard. Edits a subset of fields
 * for create_brand / create_event / update_event. MVP-light: only the
 * fields most users will commonly want to fix (name, title, location).
 */

import React from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import {
  glass,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface ToolEditFormProps {
  toolName: string;
  args: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export const ToolEditForm: React.FC<ToolEditFormProps> = ({ toolName, args, onChange }) => {
  const setField = (key: string, value: string): void => {
    onChange({ ...args, [key]: value });
  };

  if (toolName === "create_brand") {
    return (
      <View style={styles.form}>
        <Field
          label="Name"
          value={String(args.name ?? "")}
          onChangeText={(v) => setField("name", v)}
          accessibilityLabel="Edit brand name"
        />
        <Field
          label="Description"
          value={String(args.description ?? "")}
          onChangeText={(v) => setField("description", v)}
          multiline
          accessibilityLabel="Edit brand description"
        />
      </View>
    );
  }

  if (toolName === "create_event" || toolName === "update_event") {
    return (
      <View style={styles.form}>
        <Field
          label="Title"
          value={String(args.title ?? "")}
          onChangeText={(v) => setField("title", v)}
          accessibilityLabel="Edit event title"
        />
        <Field
          label="When (ISO)"
          value={String(args.start_at ?? "")}
          onChangeText={(v) => setField("start_at", v)}
          placeholder="2026-05-17T21:00:00Z"
          accessibilityLabel="Edit event start time as ISO datetime"
        />
        <Field
          label="Where"
          value={String(args.location_text ?? "")}
          onChangeText={(v) => setField("location_text", v)}
          accessibilityLabel="Edit event location"
        />
        <Field
          label="Description"
          value={String(args.description ?? "")}
          onChangeText={(v) => setField("description", v)}
          multiline
          accessibilityLabel="Edit event description"
        />
      </View>
    );
  }

  return (
    <Text style={styles.note}>
      No editable fields for this action.
    </Text>
  );
};

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  accessibilityLabel: string;
}

const Field: React.FC<FieldProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  accessibilityLabel,
}) => (
  <View style={styles.fieldRow}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={textTokens.tertiary}
      multiline={multiline}
      style={[styles.input, multiline && styles.inputMulti]}
      accessibilityLabel={accessibilityLabel}
    />
  </View>
);

const styles = StyleSheet.create({
  form: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  fieldRow: {
    gap: 4,
  },
  label: {
    fontSize: typography.caption.fontSize,
    fontWeight: typography.caption.fontWeight,
    color: textTokens.tertiary,
    letterSpacing: typography.caption.letterSpacing,
  },
  input: {
    fontSize: typography.body.fontSize,
    color: textTokens.primary,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: glass.border.pending,
  },
  inputMulti: {
    minHeight: 60,
    textAlignVertical: "top",
  },
  note: {
    marginTop: spacing.md,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
  },
});

export default ToolEditForm;
