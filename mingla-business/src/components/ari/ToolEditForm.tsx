/**
 * ORCH-0821 — ToolEditForm
 * Inline form expansion for ToolProposalCard. Edits a subset of fields
 * for create_brand / create_event / update_event. MVP-light: only the
 * fields most users will commonly want to fix (name, title, location).
 */

import React from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  ariThread,
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

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

export function isToolProposalEditable(
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  return toolName === "create_brand" ||
    toolName === "update_brand" ||
    toolName === "create_event" ||
    toolName === "update_event" ||
    toolName === "manage_brand_hours" ||
    (toolName === "manage_brand_discovery_currency" &&
      args.action === "set_provisional_currency");
}

export const ToolEditForm: React.FC<ToolEditFormProps> = ({ toolName, args, onChange }) => {
  const setField = (key: string, value: string): void => {
    onChange({ ...args, [key]: value });
  };

  const setHourField = (
    weekday: number,
    key: "open_time" | "close_time" | "is_closed",
    value: string | boolean | null,
  ): void => {
    if (!Array.isArray(args.hours)) return;
    const hours = args.hours.map((raw) => {
      if (typeof raw !== "object" || raw === null) return raw;
      const row = raw as Record<string, unknown>;
      if (row.weekday !== weekday) return row;
      if (key === "is_closed") {
        const isClosed = value === true;
        return {
          ...row,
          is_closed: isClosed,
          open_time: isClosed
            ? row.open_time ?? null
            : typeof row.open_time === "string" ? row.open_time : "",
          close_time: isClosed
            ? row.close_time ?? null
            : typeof row.close_time === "string" ? row.close_time : "",
        };
      }
      return { ...row, [key]: value };
    });
    onChange({ ...args, hours });
  };

  if (toolName === "create_brand" || toolName === "update_brand") {
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
        <Field
          label="Contact email"
          value={String(args.contact_email ?? "")}
          onChangeText={(v) => setField("contact_email", v)}
          accessibilityLabel="Edit brand contact email"
        />
      </View>
    );
  }

  if (toolName === "manage_brand_hours") {
    const hours = Array.isArray(args.hours)
      ? args.hours.filter((raw): raw is Record<string, unknown> =>
        typeof raw === "object" && raw !== null && Number.isInteger(raw.weekday)
      )
      : [];
    if (hours.length !== 7) {
      return (
        <Text style={styles.note} accessibilityRole="alert">
          This schedule is incomplete. Cancel it and ask Ari to prepare all seven days again.
        </Text>
      );
    }
    return (
      <View style={styles.form}>
        {hours
          .slice()
          .sort((a, b) => Number(a.weekday) - Number(b.weekday))
          .map((row) => {
            const weekday = Number(row.weekday);
            const isClosed = row.is_closed === true;
            return (
              <View key={weekday} style={styles.hourRow}>
                <View style={styles.hourHeader}>
                  <Text style={styles.hourDay}>{WEEKDAYS[weekday] ?? `Day ${weekday}`}</Text>
                  <Pressable
                    onPress={() => setHourField(weekday, "is_closed", !isClosed)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: isClosed }}
                    accessibilityLabel={`${WEEKDAYS[weekday] ?? `Day ${weekday}`} closed`}
                    style={({ pressed }) => [styles.closedToggle, pressed && styles.closedTogglePressed]}
                  >
                    <Text style={styles.closedToggleText}>{isClosed ? "Closed" : "Open"}</Text>
                  </Pressable>
                </View>
                {!isClosed ? (
                  <View style={styles.hourTimes}>
                    <View style={styles.hourTimeField}>
                      <Field
                        label="Opens"
                        value={typeof row.open_time === "string" ? row.open_time : ""}
                        onChangeText={(value) => setHourField(weekday, "open_time", value)}
                        placeholder="09:00"
                        accessibilityLabel={`${WEEKDAYS[weekday] ?? `Day ${weekday}`} opening time`}
                      />
                    </View>
                    <View style={styles.hourTimeField}>
                      <Field
                        label="Closes"
                        value={typeof row.close_time === "string" ? row.close_time : ""}
                        onChangeText={(value) => setHourField(weekday, "close_time", value)}
                        placeholder="17:00"
                        accessibilityLabel={`${WEEKDAYS[weekday] ?? `Day ${weekday}`} closing time`}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
      </View>
    );
  }

  if (
    toolName === "manage_brand_discovery_currency" &&
    args.action === "set_provisional_currency"
  ) {
    return (
      <View style={styles.form}>
        <Field
          label="Currency code"
          value={String(args.currency_code ?? "")}
          onChangeText={(value) => setField("currency_code", value.toUpperCase())}
          placeholder="USD"
          accessibilityLabel="Edit discovery currency code"
        />
        <Text style={styles.note}>
          Ari will keep the state version shown in this proposal so a stale change cannot overwrite newer settings.
        </Text>
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
    // ORCH-1101: 13pt density (was body 16) to match the proposal-card field
    // values; hairline underline + a11y labels preserved verbatim.
    fontSize: 13,
    lineHeight: 17,
    color: textTokens.primary,
    paddingVertical: ariThread.inputPadV, // 6 (was 8)
    borderBottomWidth: 1,
    borderBottomColor: glass.border.pending,
  },
  inputMulti: {
    minHeight: 60,
    textAlignVertical: "top",
  },
  hourRow: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.pending,
  },
  hourHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  hourDay: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  hourTimes: {
    flexDirection: "row",
    gap: spacing.md,
  },
  hourTimeField: {
    flex: 1,
  },
  closedToggle: {
    minHeight: 44,
    minWidth: 64,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: glass.border.pending,
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
  },
  closedTogglePressed: {
    opacity: 0.72,
  },
  closedToggleText: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
  },
  note: {
    marginTop: spacing.md,
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
  },
});

export default ToolEditForm;
