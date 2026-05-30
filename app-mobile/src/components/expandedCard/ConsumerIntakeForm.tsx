/**
 * ConsumerIntakeForm — buyer-side trip intake renderer for the consumer cart
 * sheet (ORCH-1016 REWORK, tester finding D2). Faithful mirror of mingla-
 * business `IntakeQuestionRenderers.tsx` (ORCH-0880) renderer-per-type pattern
 * + required-asterisk shell + per-question inline error, restyled for the
 * dark `#15181f` consumer cart sheet (accent `#eb7825`).
 *
 * Supports the 6 keyable question types: short_text, long_text, single_choice,
 * multi_choice, date, number. `file_upload` is NOT keyable on the consumer
 * surface (no signed-URL upload wiring in the consumer app); a file_upload
 * question renders an explanatory note. A REQUIRED file_upload question would
 * be a planner mis-configuration for the consumer surface — the edge fn still
 * gates it server-side (fail-closed), and `isTierBlocked` reports it so the
 * CTA stays disabled with a clear message rather than a silent 400.
 *
 * Android glass: this component uses opaque solid fills (no translucent blur),
 * consistent with ANDROID_GLASS_USES_OPAQUE_FALLBACK — it renders inside the
 * already-opaque dark cart sheet, no new glass surface introduced.
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

import { Icon } from "../ui/Icon";
import {
  type IntakeAnswerValue,
  type IntakeQuestion,
  type IntakeQuestionType,
  type IntakeSchema,
  validateAnswerAgainstSchema,
} from "../../services/tripIntakeSchemaService";

// Dark-sheet palette (mirrors TicketCartSheet tokens).
const ACCENT = "#eb7825";
const TEXT_PRIMARY = "rgba(255, 255, 255, 0.96)";
const TEXT_SECONDARY = "rgba(255, 255, 255, 0.72)";
const TEXT_TERTIARY = "rgba(255, 255, 255, 0.52)";
const TEXT_QUATERNARY = "rgba(255, 255, 255, 0.32)";
const FIELD_BG = "rgba(255, 255, 255, 0.06)";
const FIELD_BORDER = "rgba(255, 255, 255, 0.12)";
const ERROR = "#ef4444";

const SHORT_TEXT_MAX = 200;
const LONG_TEXT_MAX = 2000;

// ---------------------------------------------------------------------------
// Blocking check — does a tier's schema have a required question this surface
// cannot satisfy (a required file_upload), so the CTA must stay disabled?
// ---------------------------------------------------------------------------

export function tierHasUnsupportedRequired(schema: IntakeSchema): boolean {
  return schema.questions.some(
    (q) => q.required && q.type === "file_upload",
  );
}

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

interface ShellProps {
  question: IntakeQuestion;
  error?: string;
  children: React.ReactNode;
  helperBelow?: React.ReactNode;
}

const IntakeQuestionShell: React.FC<ShellProps> = ({
  question,
  error,
  children,
  helperBelow,
}) => (
  <View style={styles.shellWrap}>
    <View style={styles.labelRow}>
      <Text style={styles.label}>
        {question.label.length > 0 ? question.label : "Untitled question"}
        {question.required ? (
          <Text style={styles.requiredAsterisk}> *</Text>
        ) : null}
      </Text>
      {!question.required ? (
        <Text style={styles.optionalNote}>(optional)</Text>
      ) : null}
    </View>
    {question.helper !== undefined && question.helper.length > 0 ? (
      <Text style={styles.helperAbove}>{question.helper}</Text>
    ) : null}
    {children}
    {helperBelow !== undefined && helperBelow !== null ? (
      <View style={styles.helperBelowWrap}>{helperBelow}</View>
    ) : null}
    {error !== undefined && error.length > 0 ? (
      <View style={styles.errorRow} accessibilityLiveRegion="polite">
        <Icon name="alert-circle" size={14} color={ERROR} strokeWidth={2} />
        <Text style={styles.errorText}>{error}</Text>
      </View>
    ) : null}
  </View>
);

// ---------------------------------------------------------------------------
// Per-type renderers
// ---------------------------------------------------------------------------

interface RendererProps {
  question: IntakeQuestion;
  value: IntakeAnswerValue | undefined;
  onChange: (next: IntakeAnswerValue) => void;
  error?: string;
  disabled: boolean;
}

const TextRenderer: React.FC<RendererProps & { multiline: boolean }> = ({
  question,
  value,
  onChange,
  error,
  disabled,
  multiline,
}) => {
  const v = typeof value === "string" ? value : "";
  const max = multiline ? LONG_TEXT_MAX : SHORT_TEXT_MAX;
  return (
    <IntakeQuestionShell
      question={question}
      error={error}
      helperBelow={
        <Text style={styles.counterText}>
          {v.length} / {max}
        </Text>
      }
    >
      <TextInput
        value={v}
        onChangeText={(t) => onChange(t.slice(0, max))}
        placeholder={question.placeholder ?? "Type your answer…"}
        placeholderTextColor={TEXT_QUATERNARY}
        editable={!disabled}
        maxLength={max}
        multiline={multiline}
        numberOfLines={multiline ? 4 : undefined}
        textAlignVertical={multiline ? "top" : "center"}
        autoCapitalize="sentences"
        style={[
          styles.textInput,
          multiline && styles.textInputMulti,
          error !== undefined && error.length > 0 && styles.textInputError,
          disabled && styles.inputDisabled,
        ]}
        accessibilityLabel={question.label}
      />
    </IntakeQuestionShell>
  );
};

const NumberRenderer: React.FC<RendererProps> = ({
  question,
  value,
  onChange,
  error,
  disabled,
}) => {
  const v = typeof value === "string" ? value : "";
  const hint =
    question.min !== undefined || question.max !== undefined
      ? `${question.min !== undefined ? `Min ${question.min}` : ""}${
          question.min !== undefined && question.max !== undefined ? " · " : ""
        }${question.max !== undefined ? `Max ${question.max}` : ""}`
      : null;
  const handleChange = useCallback(
    (raw: string): void => {
      const allowed = question.integer_only === true ? /[^0-9-]/g : /[^0-9.-]/g;
      onChange(raw.replace(allowed, ""));
    },
    [question.integer_only, onChange],
  );
  return (
    <IntakeQuestionShell
      question={question}
      error={error}
      helperBelow={
        hint !== null ? <Text style={styles.counterText}>{hint}</Text> : null
      }
    >
      <TextInput
        value={v}
        onChangeText={handleChange}
        placeholder={question.placeholder ?? "Enter a number"}
        placeholderTextColor={TEXT_QUATERNARY}
        editable={!disabled}
        keyboardType={question.integer_only === true ? "number-pad" : "numeric"}
        style={[
          styles.textInput,
          error !== undefined && error.length > 0 && styles.textInputError,
          disabled && styles.inputDisabled,
        ]}
        accessibilityLabel={question.label}
      />
    </IntakeQuestionShell>
  );
};

const SingleChoiceRenderer: React.FC<RendererProps> = ({
  question,
  value,
  onChange,
  error,
  disabled,
}) => {
  const selectedValue = typeof value === "string" ? value : "";
  const options = question.options ?? [];
  return (
    <IntakeQuestionShell question={question} error={error}>
      <View
        style={styles.choicesWrap}
        accessibilityRole="radiogroup"
        accessibilityLabel={question.label}
      >
        {options.map((opt, idx) => {
          const selected = opt === selectedValue;
          return (
            <Pressable
              key={`opt-${idx}`}
              onPress={() => !disabled && onChange(opt)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityLabel={opt}
              accessibilityState={{ selected, disabled }}
              hitSlop={4}
              style={({ pressed }) => [
                styles.choiceRow,
                selected && styles.choiceRowSelected,
                pressed && !disabled && styles.rowPressed,
                disabled && styles.inputDisabled,
              ]}
            >
              <View
                style={[styles.radioOuter, selected && styles.radioOuterSel]}
              >
                {selected ? <View style={styles.radioDot} /> : null}
              </View>
              <Text style={styles.choiceLabel}>{opt}</Text>
            </Pressable>
          );
        })}
      </View>
    </IntakeQuestionShell>
  );
};

const MultiChoiceRenderer: React.FC<RendererProps> = ({
  question,
  value,
  onChange,
  error,
  disabled,
}) => {
  const selected = Array.isArray(value)
    ? (value.filter((x) => typeof x === "string") as string[])
    : [];
  const options = question.options ?? [];
  const toggle = (opt: string): void => {
    if (disabled) return;
    if (selected.includes(opt)) onChange(selected.filter((v) => v !== opt));
    else onChange([...selected, opt]);
  };
  return (
    <IntakeQuestionShell question={question} error={error}>
      <View style={styles.choicesWrap} accessibilityLabel={question.label}>
        {options.map((opt, idx) => {
          const checked = selected.includes(opt);
          return (
            <Pressable
              key={`opt-${idx}`}
              onPress={() => toggle(opt)}
              disabled={disabled}
              accessibilityRole="checkbox"
              accessibilityLabel={opt}
              accessibilityState={{ checked, disabled }}
              hitSlop={4}
              style={({ pressed }) => [
                styles.choiceRow,
                checked && styles.choiceRowSelected,
                pressed && !disabled && styles.rowPressed,
                disabled && styles.inputDisabled,
              ]}
            >
              <View
                style={[styles.checkboxOuter, checked && styles.checkboxOuterSel]}
              >
                {checked ? (
                  <Icon name="check" size={12} color={TEXT_PRIMARY} strokeWidth={3} />
                ) : null}
              </View>
              <Text style={styles.choiceLabel}>{opt}</Text>
            </Pressable>
          );
        })}
      </View>
    </IntakeQuestionShell>
  );
};

function formatDateForDisplay(iso: string): string {
  if (iso.length === 0) return "";
  try {
    const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      return iso;
    }
    const date = new Date(Date.UTC(y, m - 1, d));
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  } catch {
    return iso;
  }
}

function dateToIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const DateRenderer: React.FC<RendererProps> = ({
  question,
  value,
  onChange,
  error,
  disabled,
}) => {
  const iso = typeof value === "string" ? value : "";
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [pendingDate, setPendingDate] = useState<Date | null>(null);

  const openPicker = useCallback(() => {
    if (disabled) return;
    const seed =
      iso.length > 0
        ? (() => {
            const [y, m, d] = iso.split("-").map((p) => parseInt(p, 10));
            return new Date(y, m - 1, d);
          })()
        : new Date();
    setPendingDate(seed);
    setPickerOpen(true);
  }, [iso, disabled]);

  const handlePickerChange = useCallback(
    (_event: DateTimePickerEvent, selected?: Date) => {
      if (Platform.OS === "android") {
        setPickerOpen(false);
        if (selected !== undefined) onChange(dateToIso(selected));
        return;
      }
      if (selected !== undefined) setPendingDate(selected);
    },
    [onChange],
  );

  const handleSetIos = useCallback(() => {
    if (pendingDate !== null) onChange(dateToIso(pendingDate));
    setPickerOpen(false);
  }, [pendingDate, onChange]);

  const handleCancelIos = useCallback(() => {
    setPickerOpen(false);
    setPendingDate(null);
  }, []);

  const display = formatDateForDisplay(iso);

  return (
    <IntakeQuestionShell question={question} error={error}>
      <Pressable
        onPress={openPicker}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${question.label}, ${display.length > 0 ? `currently ${display}` : "tap to choose a date"}`}
        hitSlop={4}
        style={({ pressed }) => [
          styles.dateInput,
          error !== undefined && error.length > 0 && styles.textInputError,
          disabled && styles.inputDisabled,
          pressed && !disabled && styles.rowPressed,
        ]}
      >
        <Text
          style={[
            styles.dateInputText,
            display.length === 0 && styles.placeholderText,
          ]}
        >
          {display.length > 0 ? display : "Tap to choose date"}
        </Text>
        <Icon name="calendar" size={18} color={TEXT_SECONDARY} strokeWidth={2} />
      </Pressable>
      {pickerOpen && Platform.OS === "ios" ? (
        <View style={styles.iosPickerWrap}>
          <DateTimePicker
            value={pendingDate ?? new Date()}
            mode="date"
            display="spinner"
            onChange={handlePickerChange}
            themeVariant="dark"
            textColor={TEXT_PRIMARY}
            style={styles.iosPicker}
          />
          <View style={styles.iosPickerActions}>
            <Pressable
              onPress={handleCancelIos}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Cancel date selection"
              style={({ pressed }) => [
                styles.iosPickerCancel,
                pressed && styles.rowPressed,
              ]}
            >
              <Text style={styles.iosPickerCancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={handleSetIos}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Set date"
              style={({ pressed }) => [
                styles.iosPickerSet,
                pressed && styles.rowPressed,
              ]}
            >
              <Text style={styles.iosPickerSetLabel}>Set date</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {pickerOpen && Platform.OS === "android" ? (
        <DateTimePicker
          value={pendingDate ?? new Date()}
          mode="date"
          display="default"
          onChange={handlePickerChange}
        />
      ) : null}
    </IntakeQuestionShell>
  );
};

const FileUploadUnsupported: React.FC<{ question: IntakeQuestion }> = ({
  question,
}) => (
  <IntakeQuestionShell question={question}>
    <View style={styles.unsupportedBox}>
      <Icon name="alert-circle" size={16} color={TEXT_TERTIARY} strokeWidth={2} />
      <Text style={styles.unsupportedText}>
        File uploads aren’t supported in the app yet. Reserve on the web to
        attach files.
      </Text>
    </View>
  </IntakeQuestionShell>
);

// ---------------------------------------------------------------------------
// Form orchestrator
// ---------------------------------------------------------------------------

export interface ConsumerIntakeFormProps {
  schema: IntakeSchema;
  tierName: string;
  answers: Record<string, IntakeAnswerValue>;
  onAnswersChange: (next: Record<string, IntakeAnswerValue>) => void;
  /** Per-question errors, e.g. from a Continue-tap validation pass. */
  validationErrors?: Record<string, string>;
  disabled?: boolean;
}

export const ConsumerIntakeForm: React.FC<ConsumerIntakeFormProps> = ({
  schema,
  tierName,
  answers,
  onAnswersChange,
  validationErrors,
  disabled = false,
}) => {
  const setAnswer = useCallback(
    (questionId: string, value: IntakeAnswerValue): void => {
      onAnswersChange({ ...answers, [questionId]: value });
    },
    [answers, onAnswersChange],
  );

  const sorted = useMemo(
    () => [...schema.questions].sort((a, b) => a.position - b.position),
    [schema.questions],
  );

  return (
    <View style={styles.formWrap}>
      <Text style={styles.tierHeading}>{tierName} — a few questions</Text>
      {sorted.map((q) => {
        const error = validationErrors?.[q.id];
        const value = answers[q.id];
        const onChange = (next: IntakeAnswerValue): void =>
          setAnswer(q.id, next);
        switch (q.type) {
          case "short_text":
            return (
              <TextRenderer
                key={q.id}
                question={q}
                value={value}
                onChange={onChange}
                error={error}
                disabled={disabled}
                multiline={false}
              />
            );
          case "long_text":
            return (
              <TextRenderer
                key={q.id}
                question={q}
                value={value}
                onChange={onChange}
                error={error}
                disabled={disabled}
                multiline
              />
            );
          case "number":
            return (
              <NumberRenderer
                key={q.id}
                question={q}
                value={value}
                onChange={onChange}
                error={error}
                disabled={disabled}
              />
            );
          case "single_choice":
            return (
              <SingleChoiceRenderer
                key={q.id}
                question={q}
                value={value}
                onChange={onChange}
                error={error}
                disabled={disabled}
              />
            );
          case "multi_choice":
            return (
              <MultiChoiceRenderer
                key={q.id}
                question={q}
                value={value}
                onChange={onChange}
                error={error}
                disabled={disabled}
              />
            );
          case "date":
            return (
              <DateRenderer
                key={q.id}
                question={q}
                value={value}
                onChange={onChange}
                error={error}
                disabled={disabled}
              />
            );
          case "file_upload":
            return <FileUploadUnsupported key={q.id} question={q} />;
          default: {
            const _never: IntakeQuestionType = q.type;
            void _never;
            return null;
          }
        }
      })}
    </View>
  );
};

// Re-export the validator so callers (cart sheet) import from one place.
export { validateAnswerAgainstSchema };

const styles = StyleSheet.create({
  formWrap: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: FIELD_BORDER,
  },
  tierHeading: {
    fontSize: 13,
    fontWeight: "600",
    color: TEXT_SECONDARY,
    marginBottom: 12,
    letterSpacing: 0.2,
  },
  shellWrap: {
    marginBottom: 18,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: 6,
    marginBottom: 6,
  },
  label: {
    fontSize: 15,
    lineHeight: 20,
    color: TEXT_PRIMARY,
    fontWeight: "500",
  },
  requiredAsterisk: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: "700",
  },
  optionalNote: {
    fontSize: 12,
    lineHeight: 16,
    color: TEXT_TERTIARY,
  },
  helperAbove: {
    fontSize: 12,
    lineHeight: 16,
    color: TEXT_TERTIARY,
    marginBottom: 6,
  },
  textInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: FIELD_BORDER,
    backgroundColor: FIELD_BG,
    color: TEXT_PRIMARY,
    fontSize: 15,
    lineHeight: 20,
  },
  textInputMulti: {
    minHeight: 96,
    paddingTop: 10,
  },
  textInputError: {
    borderColor: ERROR,
  },
  inputDisabled: {
    opacity: 0.5,
  },
  counterText: {
    fontSize: 12,
    lineHeight: 16,
    color: TEXT_TERTIARY,
    marginTop: 4,
  },
  helperBelowWrap: {
    marginTop: 4,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 6,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    color: ERROR,
  },
  choicesWrap: {
    gap: 8,
  },
  choiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: FIELD_BORDER,
    backgroundColor: FIELD_BG,
    minHeight: 56,
  },
  choiceRowSelected: {
    borderColor: ACCENT,
    backgroundColor: "rgba(235, 120, 37, 0.14)",
  },
  rowPressed: {
    opacity: 0.7,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: TEXT_TERTIARY,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterSel: {
    borderColor: ACCENT,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: ACCENT,
  },
  checkboxOuter: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: TEXT_TERTIARY,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOuterSel: {
    borderColor: ACCENT,
    backgroundColor: "rgba(235, 120, 37, 0.14)",
  },
  choiceLabel: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    color: TEXT_PRIMARY,
  },
  dateInput: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: FIELD_BORDER,
    backgroundColor: FIELD_BG,
  },
  dateInputText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    color: TEXT_PRIMARY,
  },
  placeholderText: {
    color: TEXT_QUATERNARY,
  },
  iosPickerWrap: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: FIELD_BORDER,
    backgroundColor: FIELD_BG,
    overflow: "hidden",
  },
  iosPicker: {
    backgroundColor: "transparent",
  },
  iosPickerActions: {
    flexDirection: "row",
    gap: 8,
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: FIELD_BORDER,
  },
  iosPickerCancel: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: FIELD_BORDER,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  iosPickerCancelLabel: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    fontWeight: "500",
  },
  iosPickerSet: {
    flex: 2,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  iosPickerSetLabel: {
    fontSize: 14,
    color: "#ffffff",
    fontWeight: "600",
  },
  unsupportedBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: FIELD_BORDER,
    backgroundColor: FIELD_BG,
  },
  unsupportedText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: TEXT_TERTIARY,
  },
});

export default ConsumerIntakeForm;
