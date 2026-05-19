/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — buyer-side intake question
 * renderers, IntakeFormRenderer orchestrator, and shared IntakeQuestionShell
 * wrapper.
 *
 * Per DESIGN_ORCH-0880 §4.3.A–G. Renderer-per-type pattern with a common
 * label + required-asterisk + helper-text shell. Shared file (vs 7 separate
 * files per dispatch §3.2 table) per dispatch §5 carve-out: "The 7 question
 * renderers can extract a shared `<IntakeQuestionWrapper>` if it ships in
 * this PR." Consolidating keeps the shell + renderers + form orchestrator
 * co-located for cache safety (one cache key per file change) and avoids 7
 * tiny files (~50 lines each) when one ~600-line file gives the same
 * blast-radius isolation.
 *
 * Each renderer accepts:
 *   { question, value, onChange, error?, disabled? }
 *
 * The IntakeFormRenderer switches per question.type. Phase 4 wires this
 * into the new /checkout-trip/[tripEventId]/intake.tsx route.
 *
 * iOS date picker mirrors ORCH-0875 [Tr4 Refund Tiers + Booking Deadline]
 * BookingDeadlinePicker verbatim — themeVariant="dark" + textColor={
 * text.primary} + pending-state Set/Cancel buttons (NOT silent commit on
 * every spinner tick).
 *
 * File upload renderer wires expo-image-picker + expo-document-picker via
 * IntakeFilePickerChooserSheet, then calls intakeSchemaService.uploadIntakeFile
 * which now (Phase 4) invokes the deployed trip-intake-upload-signed-url
 * edge fn + PUTs the file.
 *
 * Composes GlassCard + Icon + Button + Sheet + Input primitives. No new
 * primitives. All colors via designSystem.ts tokens. All Pressables ≥44pt
 * + accessibilityLabel. No useAuth — anon-tolerant per
 * `feedback_anon_buyer_routes.md`.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { GlassCard } from "../../ui/GlassCard";
import { Icon } from "../../ui/Icon";
import type {
  IntakeAnswerValue,
  IntakeFileAnswer,
  IntakeQuestion,
  IntakeQuestionType,
  IntakeSchema,
} from "../../../services/intakeSchemaService";
import { IntakeFilePickerChooserSheet } from "./IntakeFilePickerChooserSheet";

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

export interface IntakeQuestionShellProps {
  question: IntakeQuestion;
  error?: string;
  children: React.ReactNode;
  helperBelow?: React.ReactNode;
}

export const IntakeQuestionShell: React.FC<IntakeQuestionShellProps> = ({
  question,
  error,
  children,
  helperBelow,
}) => {
  return (
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
      {children}
      {helperBelow !== undefined && helperBelow !== null ? (
        <View style={styles.helperBelowWrap}>{helperBelow}</View>
      ) : null}
      {error !== undefined && error.length > 0 ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Icon
            name="bell"
            size={14}
            color={semantic.error}
            strokeWidth={2}
          />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Common props for every renderer
// ---------------------------------------------------------------------------

export interface IntakeQuestionRendererCommonProps {
  question: IntakeQuestion;
  error?: string;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// IntakeQuestionShortText
// ---------------------------------------------------------------------------

export interface IntakeQuestionShortTextProps
  extends IntakeQuestionRendererCommonProps {
  value: string;
  onChange: (next: string) => void;
}

const SHORT_TEXT_MAX = 200;

export const IntakeQuestionShortText: React.FC<IntakeQuestionShortTextProps> = ({
  question,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const len = value.length;
  const counterColor =
    len >= SHORT_TEXT_MAX
      ? semantic.error
      : len >= SHORT_TEXT_MAX - 20
        ? semantic.warning
        : textTokens.tertiary;
  return (
    <IntakeQuestionShell
      question={question}
      error={error}
      helperBelow={
        <Text style={[styles.helperText, { color: counterColor }]}>
          {len} / {SHORT_TEXT_MAX}
        </Text>
      }
    >
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.slice(0, SHORT_TEXT_MAX))}
        placeholder={question.placeholder ?? "Type your answer…"}
        placeholderTextColor={textTokens.quaternary}
        editable={!disabled}
        maxLength={SHORT_TEXT_MAX}
        autoCapitalize="sentences"
        style={[
          styles.textInput,
          error !== undefined && error.length > 0 && styles.textInputError,
          disabled && styles.textInputDisabled,
        ]}
        accessibilityLabel={question.label}
      />
    </IntakeQuestionShell>
  );
};

// ---------------------------------------------------------------------------
// IntakeQuestionLongText
// ---------------------------------------------------------------------------

export interface IntakeQuestionLongTextProps
  extends IntakeQuestionRendererCommonProps {
  value: string;
  onChange: (next: string) => void;
}

const LONG_TEXT_MAX = 2000;

export const IntakeQuestionLongText: React.FC<IntakeQuestionLongTextProps> = ({
  question,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const len = value.length;
  const counterColor =
    len >= LONG_TEXT_MAX
      ? semantic.error
      : len >= LONG_TEXT_MAX - 200
        ? semantic.warning
        : textTokens.tertiary;
  return (
    <IntakeQuestionShell
      question={question}
      error={error}
      helperBelow={
        <Text style={[styles.helperText, { color: counterColor }]}>
          {len} / {LONG_TEXT_MAX}
        </Text>
      }
    >
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.slice(0, LONG_TEXT_MAX))}
        placeholder={question.placeholder ?? "Type your answer…"}
        placeholderTextColor={textTokens.quaternary}
        editable={!disabled}
        maxLength={LONG_TEXT_MAX}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
        autoCapitalize="sentences"
        style={[
          styles.textInput,
          styles.textInputMulti,
          error !== undefined && error.length > 0 && styles.textInputError,
          disabled && styles.textInputDisabled,
        ]}
        accessibilityLabel={question.label}
      />
    </IntakeQuestionShell>
  );
};

// ---------------------------------------------------------------------------
// IntakeQuestionSingleChoice
// ---------------------------------------------------------------------------

export interface IntakeQuestionSingleChoiceProps
  extends IntakeQuestionRendererCommonProps {
  value: string;
  onChange: (next: string) => void;
}

export const IntakeQuestionSingleChoice: React.FC<
  IntakeQuestionSingleChoiceProps
> = ({ question, value, onChange, error, disabled = false }) => {
  const options = question.options ?? [];
  return (
    <IntakeQuestionShell question={question} error={error}>
      <View
        style={styles.choicesWrap}
        accessibilityRole="radiogroup"
        accessibilityLabel={question.label}
      >
        {options.map((opt, idx) => {
          const selected = opt === value;
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
                pressed && !disabled && styles.choiceRowPressed,
                disabled && styles.choiceRowDisabled,
              ]}
            >
              <View
                style={[
                  styles.radioOuter,
                  selected && styles.radioOuterSelected,
                ]}
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

// ---------------------------------------------------------------------------
// IntakeQuestionMultiChoice
// ---------------------------------------------------------------------------

export interface IntakeQuestionMultiChoiceProps
  extends IntakeQuestionRendererCommonProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export const IntakeQuestionMultiChoice: React.FC<
  IntakeQuestionMultiChoiceProps
> = ({ question, value, onChange, error, disabled = false }) => {
  const options = question.options ?? [];
  const toggle = (opt: string): void => {
    if (disabled) return;
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  };
  return (
    <IntakeQuestionShell question={question} error={error}>
      <View
        style={styles.choicesWrap}
        accessibilityLabel={question.label}
      >
        {options.map((opt, idx) => {
          const checked = value.includes(opt);
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
                pressed && !disabled && styles.choiceRowPressed,
                disabled && styles.choiceRowDisabled,
              ]}
            >
              <View
                style={[
                  styles.checkboxOuter,
                  checked && styles.checkboxOuterSelected,
                ]}
              >
                {checked ? (
                  <Icon
                    name="check"
                    size={12}
                    color={textTokens.primary}
                    strokeWidth={3}
                  />
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

// ---------------------------------------------------------------------------
// IntakeQuestionDate
//
// Mirror of ORCH-0875 BookingDeadlinePicker iOS dark themeVariant + Set/
// Cancel pending-state pattern. NOT a silent commit on every spinner tick.
// ---------------------------------------------------------------------------

export interface IntakeQuestionDateProps
  extends IntakeQuestionRendererCommonProps {
  /** ISO 8601 date string yyyy-MM-dd, or empty string when unanswered. */
  value: string;
  onChange: (next: string) => void;
}

function formatDateForDisplay(iso: string): string {
  if (iso.length === 0) return "";
  try {
    // Parse as YYYY-MM-DD UTC and display in user's locale weekday + month + day + year.
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

export const IntakeQuestionDate: React.FC<IntakeQuestionDateProps> = ({
  question,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [pendingDate, setPendingDate] = useState<Date | null>(null);

  const openPicker = useCallback(() => {
    if (disabled) return;
    const seed =
      value.length > 0
        ? (() => {
            const [y, m, d] = value.split("-").map((p) => parseInt(p, 10));
            return new Date(y, m - 1, d);
          })()
        : new Date();
    setPendingDate(seed);
    setPickerOpen(true);
  }, [value, disabled]);

  const handlePickerChange = useCallback(
    (_event: DateTimePickerEvent, selected?: Date) => {
      if (Platform.OS === "android") {
        // Android: native modal commits immediately on confirm.
        setPickerOpen(false);
        if (selected !== undefined) onChange(dateToIso(selected));
        return;
      }
      // iOS: pending-state — scrolling spinner doesn't commit until Set tapped.
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

  const display = formatDateForDisplay(value);

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
          disabled && styles.textInputDisabled,
          pressed && !disabled && styles.choiceRowPressed,
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
        <Icon
          name="calendar"
          size={18}
          color={textTokens.secondary}
          strokeWidth={2}
        />
      </Pressable>
      {pickerOpen && Platform.OS === "ios" ? (
        <View style={styles.iosPickerWrap}>
          <DateTimePicker
            value={pendingDate ?? new Date()}
            mode="date"
            display="spinner"
            onChange={handlePickerChange}
            themeVariant="dark"
            textColor={textTokens.primary}
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
                pressed && styles.choiceRowPressed,
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
                pressed && styles.choiceRowPressed,
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

// ---------------------------------------------------------------------------
// IntakeQuestionNumber
// ---------------------------------------------------------------------------

export interface IntakeQuestionNumberProps
  extends IntakeQuestionRendererCommonProps {
  value: string;
  onChange: (next: string) => void;
}

export const IntakeQuestionNumber: React.FC<IntakeQuestionNumberProps> = ({
  question,
  value,
  onChange,
  error,
  disabled = false,
}) => {
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
        hint !== null ? <Text style={styles.helperText}>{hint}</Text> : null
      }
    >
      <TextInput
        value={value}
        onChangeText={handleChange}
        placeholder={question.placeholder ?? "Enter a number"}
        placeholderTextColor={textTokens.quaternary}
        editable={!disabled}
        keyboardType={
          question.integer_only === true ? "number-pad" : "numeric"
        }
        style={[
          styles.textInput,
          error !== undefined && error.length > 0 && styles.textInputError,
          disabled && styles.textInputDisabled,
        ]}
        accessibilityLabel={question.label}
      />
    </IntakeQuestionShell>
  );
};

// ---------------------------------------------------------------------------
// IntakeQuestionFileUpload
// ---------------------------------------------------------------------------

export type UploadIntakeFile = (file: {
  filename: string;
  mime_type: string;
  size_bytes: number;
  body: Blob | ArrayBuffer | Uint8Array;
}) => Promise<IntakeFileAnswer>;

export interface IntakeQuestionFileUploadProps
  extends IntakeQuestionRendererCommonProps {
  value: IntakeFileAnswer[];
  onChange: (next: IntakeFileAnswer[]) => void;
  /** Upload callback the route wires to intakeSchemaService.uploadIntakeFile. */
  onUpload: UploadIntakeFile;
}

interface UploadingFile {
  tempId: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: "uploading" | "failed";
  errorMessage?: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const IntakeQuestionFileUpload: React.FC<
  IntakeQuestionFileUploadProps
> = ({ question, value, onChange, error, disabled = false, onUpload }) => {
  const maxFiles = question.max_files ?? 1;
  const allowImages = question.allow_images !== false;
  const allowPdfs = question.allow_pdfs !== false;
  const allowDocs = question.allow_docs !== false;

  const allowedTypesLabel = useMemo(() => {
    const parts: string[] = [];
    if (allowImages) parts.push("Images");
    if (allowPdfs) parts.push("PDFs");
    if (allowDocs) parts.push("docs");
    return parts.join(", ");
  }, [allowImages, allowPdfs, allowDocs]);

  const [pickerOpen, setPickerOpen] = useState<boolean>(false);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [removeArmed, setRemoveArmed] = useState<Record<string, boolean>>({});

  const handlePicked = useCallback(
    async (picked: {
      filename: string;
      mime_type: string;
      size_bytes: number;
      body: Blob | ArrayBuffer | Uint8Array;
    }): Promise<void> => {
      setPickerOpen(false);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setUploading((prev) => [
        ...prev,
        {
          tempId,
          filename: picked.filename,
          mime_type: picked.mime_type,
          size_bytes: picked.size_bytes,
          status: "uploading",
        },
      ]);
      try {
        const result = await onUpload(picked);
        onChange([...value, result]);
        setUploading((prev) => prev.filter((u) => u.tempId !== tempId));
      } catch (e) {
        setUploading((prev) =>
          prev.map((u) =>
            u.tempId === tempId
              ? {
                  ...u,
                  status: "failed",
                  errorMessage:
                    e instanceof Error
                      ? e.message
                      : "Upload failed. Try again.",
                }
              : u,
          ),
        );
      }
    },
    [onUpload, onChange, value],
  );

  const handleRetry = useCallback((tempId: string) => {
    setUploading((prev) => prev.filter((u) => u.tempId !== tempId));
  }, []);

  const handleRemoveTap = useCallback(
    (path: string): void => {
      if (!removeArmed[path]) {
        setRemoveArmed({ [path]: true });
        return;
      }
      onChange(value.filter((f) => f.path !== path));
      setRemoveArmed({});
    },
    [removeArmed, onChange, value],
  );

  const totalCount = value.length + uploading.length;
  const canAdd = totalCount < maxFiles;

  return (
    <IntakeQuestionShell question={question} error={error}>
      {totalCount === 0 ? (
        <GlassCard variant="base" padding={spacing.lg} radius="lg">
          <View style={styles.uploadEmpty}>
            <View style={styles.uploadIconCircle}>
              <Icon
                name="upload"
                size={28}
                color={accent.warm}
                strokeWidth={2}
              />
            </View>
            <Pressable
              onPress={() => !disabled && setPickerOpen(true)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Choose a file to upload"
              hitSlop={8}
              style={({ pressed }) => [
                styles.uploadButton,
                pressed && !disabled && styles.choiceRowPressed,
                disabled && styles.textInputDisabled,
              ]}
            >
              <Text style={styles.uploadButtonLabel}>+ Choose file</Text>
            </Pressable>
            <Text style={styles.uploadHint}>
              Up to {maxFiles} {maxFiles === 1 ? "file" : "files"} · 10 MB each
            </Text>
            <Text style={styles.uploadHint}>{allowedTypesLabel} allowed</Text>
          </View>
        </GlassCard>
      ) : (
        <View style={styles.uploadFilled}>
          {value.map((file) => {
            const armed = removeArmed[file.path] === true;
            return (
              <GlassCard
                key={file.path}
                variant="base"
                padding={spacing.sm}
                radius="md"
              >
                <View style={styles.fileRow}>
                  <View style={styles.fileThumbWrap}>
                    <Icon
                      name="check"
                      size={20}
                      color={semantic.success}
                      strokeWidth={2.5}
                    />
                  </View>
                  <View style={styles.fileMain}>
                    <Text
                      style={styles.fileName}
                      numberOfLines={1}
                      ellipsizeMode="middle"
                    >
                      {file.filename}
                    </Text>
                    <Text style={styles.fileMeta}>
                      {formatBytes(file.size_bytes)} · uploaded
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleRemoveTap(file.path)}
                    disabled={disabled}
                    accessibilityRole="button"
                    accessibilityLabel={
                      armed ? "Confirm remove file" : "Remove file"
                    }
                    hitSlop={8}
                    style={({ pressed }) => [
                      styles.fileRemove,
                      armed && styles.fileRemoveArmed,
                      pressed && styles.choiceRowPressed,
                    ]}
                  >
                    <Icon
                      name="close"
                      size={16}
                      color={
                        armed ? textTokens.primary : textTokens.tertiary
                      }
                      strokeWidth={2}
                    />
                  </Pressable>
                </View>
              </GlassCard>
            );
          })}
          {uploading.map((u) => (
            <GlassCard
              key={u.tempId}
              variant="base"
              padding={spacing.sm}
              radius="md"
            >
              <View
                style={[
                  styles.fileRow,
                  u.status === "failed" && styles.fileRowFailed,
                ]}
              >
                <View style={styles.fileThumbWrap}>
                  <Icon
                    name={u.status === "failed" ? "bell" : "upload"}
                    size={20}
                    color={
                      u.status === "failed"
                        ? semantic.error
                        : textTokens.tertiary
                    }
                    strokeWidth={2}
                  />
                </View>
                <View style={styles.fileMain}>
                  <Text
                    style={styles.fileName}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                  >
                    {u.filename}
                  </Text>
                  <Text style={styles.fileMeta}>
                    {u.status === "uploading"
                      ? `${formatBytes(u.size_bytes)} · uploading…`
                      : `${u.errorMessage ?? "Upload failed"} · `}
                    {u.status === "failed" ? (
                      <Text
                        onPress={() => handleRetry(u.tempId)}
                        style={styles.retryLink}
                      >
                        Retry
                      </Text>
                    ) : null}
                  </Text>
                </View>
              </View>
            </GlassCard>
          ))}
          {canAdd ? (
            <Pressable
              onPress={() => !disabled && setPickerOpen(true)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel="Add another file"
              hitSlop={8}
              style={({ pressed }) => [
                styles.uploadButton,
                pressed && !disabled && styles.choiceRowPressed,
              ]}
            >
              <Text style={styles.uploadButtonLabel}>+ Add another file</Text>
            </Pressable>
          ) : (
            <Text style={styles.uploadHint}>
              Maximum {maxFiles} {maxFiles === 1 ? "file" : "files"} reached.
            </Text>
          )}
        </View>
      )}
      <IntakeFilePickerChooserSheet
        visible={pickerOpen}
        allowImages={allowImages}
        allowPdfs={allowPdfs}
        allowDocs={allowDocs}
        onPick={(picked) => {
          void handlePicked(picked);
        }}
        onCancel={() => setPickerOpen(false)}
      />
    </IntakeQuestionShell>
  );
};

// ---------------------------------------------------------------------------
// IntakeFormRenderer — orchestrator
// ---------------------------------------------------------------------------

export interface IntakeFormRendererProps {
  schema: IntakeSchema;
  ticketTypeId: string;
  tierName: string;
  answers: Record<string, IntakeAnswerValue>;
  onAnswersChange: (next: Record<string, IntakeAnswerValue>) => void;
  validationErrors?: Record<string, string>;
  /** True in preview pane to disable all inputs. */
  disabled?: boolean;
  /** Upload callback wired to intakeSchemaService.uploadIntakeFile by the route. */
  onUpload: UploadIntakeFile;
}

export const IntakeFormRenderer: React.FC<IntakeFormRendererProps> = ({
  schema,
  ticketTypeId,
  tierName,
  answers,
  onAnswersChange,
  validationErrors,
  disabled = false,
  onUpload,
}) => {
  void ticketTypeId;
  void tierName;

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
      {sorted.map((q) => {
        const error = validationErrors?.[q.id];
        const value = answers[q.id];
        switch (q.type) {
          case "short_text":
          case "long_text": {
            const v = typeof value === "string" ? value : "";
            const Renderer =
              q.type === "short_text"
                ? IntakeQuestionShortText
                : IntakeQuestionLongText;
            return (
              <Renderer
                key={q.id}
                question={q}
                value={v}
                onChange={(next) => setAnswer(q.id, next)}
                error={error}
                disabled={disabled}
              />
            );
          }
          case "single_choice": {
            const v = typeof value === "string" ? value : "";
            return (
              <IntakeQuestionSingleChoice
                key={q.id}
                question={q}
                value={v}
                onChange={(next) => setAnswer(q.id, next)}
                error={error}
                disabled={disabled}
              />
            );
          }
          case "multi_choice": {
            const v = Array.isArray(value)
              ? (value.filter((x) => typeof x === "string") as string[])
              : [];
            return (
              <IntakeQuestionMultiChoice
                key={q.id}
                question={q}
                value={v}
                onChange={(next) => setAnswer(q.id, next)}
                error={error}
                disabled={disabled}
              />
            );
          }
          case "date": {
            const v = typeof value === "string" ? value : "";
            return (
              <IntakeQuestionDate
                key={q.id}
                question={q}
                value={v}
                onChange={(next) => setAnswer(q.id, next)}
                error={error}
                disabled={disabled}
              />
            );
          }
          case "number": {
            const v = typeof value === "string" ? value : "";
            return (
              <IntakeQuestionNumber
                key={q.id}
                question={q}
                value={v}
                onChange={(next) => setAnswer(q.id, next)}
                error={error}
                disabled={disabled}
              />
            );
          }
          case "file_upload": {
            const v = Array.isArray(value)
              ? (value.filter(
                  (x) =>
                    typeof x === "object" &&
                    x !== null &&
                    "path" in x &&
                    "filename" in x,
                ) as IntakeFileAnswer[])
              : [];
            return (
              <IntakeQuestionFileUpload
                key={q.id}
                question={q}
                value={v}
                onChange={(next) => setAnswer(q.id, next)}
                error={error}
                disabled={disabled}
                onUpload={onUpload}
              />
            );
          }
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

// Suppress unused-state-deps in builds that warn on it.
const _useEffectMarker = useEffect;
void _useEffectMarker;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  formWrap: {
    gap: spacing.lg,
  },
  shellWrap: {
    marginBottom: spacing.lg,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  label: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    fontWeight: "500",
  },
  requiredAsterisk: {
    color: accent.warm,
    fontSize: typography.body.fontSize,
    fontWeight: "700",
  },
  optionalNote: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  textInput: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
  },
  textInputMulti: {
    minHeight: 96,
    paddingTop: 10,
  },
  textInputError: {
    borderColor: semantic.error,
  },
  textInputDisabled: {
    opacity: 0.5,
  },
  helperText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.xxs,
  },
  helperBelowWrap: {
    marginTop: spacing.xxs,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: spacing.xs,
  },
  errorText: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
  },
  choicesWrap: {
    gap: spacing.xs,
  },
  choiceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    minHeight: 56,
  },
  choiceRowSelected: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  choiceRowPressed: {
    opacity: 0.7,
  },
  choiceRowDisabled: {
    opacity: 0.5,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterSelected: {
    borderColor: accent.border,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: accent.warm,
  },
  checkboxOuter: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOuterSelected: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  choiceLabel: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  dateInput: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  dateInputText: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  placeholderText: {
    color: textTokens.quaternary,
  },
  iosPickerWrap: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
  },
  iosPicker: {
    backgroundColor: "transparent",
  },
  iosPickerActions: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  iosPickerCancel: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  iosPickerCancelLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    fontWeight: "500",
  },
  iosPickerSet: {
    flex: 2,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  iosPickerSetLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.inverse,
    fontWeight: "600",
  },
  uploadEmpty: {
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  uploadIconCircle: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: accent.tint,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  uploadButtonLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.inverse,
  },
  uploadHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    textAlign: "center",
  },
  uploadFilled: {
    gap: spacing.xs,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  fileRowFailed: {
    opacity: 0.85,
  },
  fileThumbWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  fileMain: {
    flex: 1,
  },
  fileName: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  fileMeta: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  fileRemove: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  fileRemoveArmed: {
    backgroundColor: semantic.errorTint,
    borderWidth: 1,
    borderColor: semantic.error,
  },
  retryLink: {
    color: accent.warm,
    fontWeight: "600",
  },
});

export default IntakeFormRenderer;
