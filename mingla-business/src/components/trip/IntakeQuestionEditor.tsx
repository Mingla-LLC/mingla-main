/**
 * ORCH-0880 [Tr5 Traveler Intake Forms] — <IntakeQuestionEditor />.
 *
 * Per DESIGN_ORCH-0880 §3.4. Bottom-up Sheet for editing a single intake
 * question. Header eyebrow + Label input with char counter + Type chip row
 * (with type-switch confirm) + Required toggle + type-specific config + Save/
 * Cancel sticky footer.
 *
 * Type-specific sub-sections (A-G per DESIGN §3.4) are inline subcomponents
 * below to keep file length manageable.
 *
 * Composes Sheet + Icon + Button + ConfirmDialog + IntakeQuestionTypePill +
 * IntakeRequiredToggle + NestableScrollContainer + NestableDraggableFlatList.
 * No new primitives.
 *
 * Sheet snap: numeric content-fit (~720pt) so the editor body has room to
 * grow as type-specific config sections expand. Sheet clamps to 95% screen
 * height on small devices.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  type KeyboardEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0884 follow-up #2: swapped Nestable* primitives for standalone
// DraggableFlatList + plain ScrollView. Nestable* triggers a ref.measureLayout
// crash on iOS inside a Sheet-presented Modal (operator-reproduced 2026-05-19
// on iPhone 17 Pro dev build). Standalone DraggableFlatList works inside a
// regular ScrollView without the Provider chain. ChoiceConfig list is
// bounded at MAX_OPTIONS=10, so virtualization overhead is negligible.
import DraggableFlatList, {
  type RenderItemParams,
} from "react-native-draggable-flatlist";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import {
  createBlankQuestion,
  type IntakeQuestion,
  type IntakeQuestionType,
} from "../../services/intakeSchemaService";
import { IntakeQuestionTypePill } from "./IntakeQuestionTypePill";
import { IntakeRequiredToggle } from "./IntakeRequiredToggle";

export interface IntakeQuestionEditorProps {
  /** Existing question to edit; null = new question with initialType. */
  question: IntakeQuestion | null;
  /** When question === null, seed the editor with this type. */
  initialType?: IntakeQuestionType;
  visible: boolean;
  onSave: (question: IntakeQuestion) => void;
  onCancel: () => void;
  testID?: string;
}

const QUESTION_EDITOR_SHEET_HEIGHT = 720;
const LABEL_MAX = 200;
const LABEL_WARN_AT = 180;
const PLACEHOLDER_MAX = 80;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

const TYPE_LABELS: Record<IntakeQuestionType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  single_choice: "Choice",
  multi_choice: "Multi",
  date: "Date",
  number: "Number",
  file_upload: "File",
};

const TYPE_ORDER: IntakeQuestionType[] = [
  "short_text",
  "long_text",
  "single_choice",
  "multi_choice",
  "date",
  "number",
  "file_upload",
];

export const IntakeQuestionEditor: React.FC<IntakeQuestionEditorProps> = ({
  question,
  initialType,
  visible,
  onSave,
  onCancel,
  testID,
}) => {
  // Local draft state. Seeded from `question` on mount / when sheet opens.
  const [draft, setDraft] = useState<IntakeQuestion>(() =>
    question !== null
      ? { ...question }
      : createBlankQuestion(initialType ?? "short_text", 0),
  );

  // Re-seed when the sheet opens with a fresh question (new question flow
  // re-opens the same Editor instance with different `question` prop).
  useEffect(() => {
    if (visible) {
      setDraft(
        question !== null
          ? { ...question }
          : createBlankQuestion(initialType ?? "short_text", 0),
      );
    }
  }, [visible, question, initialType]);

  // ORCH-0884 follow-up #2 — Cycle 3 wizard root keyboard pattern, applied
  // inside the editor's Sheet body. The Sheet primitive has no keyboard
  // awareness (it renders a native Modal at the OS root layer); without
  // this, the keyboard covers Placeholder hint + Options + Save button on
  // any input below the fold. Per `feedback_keyboard_never_blocks_input.md`.
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return;
    }
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e: KeyboardEvent): void => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, (): void => {
      setKeyboardHeight(0);
    });
    return (): void => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  // Confirm dialog state for type-switch (only when type change would clear
  // type-specific config like options or limits).
  const [pendingTypeSwitch, setPendingTypeSwitch] =
    useState<IntakeQuestionType | null>(null);

  const isNewQuestion = question === null;

  const setField = useCallback(
    <K extends keyof IntakeQuestion>(key: K, value: IntakeQuestion[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // Type switch handler — opens confirm if the new type would clear
  // type-specific config the user has filled in (options for choice questions,
  // limits for number, max_files for file_upload).
  const handleTypeTap = useCallback(
    (nextType: IntakeQuestionType) => {
      if (nextType === draft.type) return;
      const hasTypeSpecificContent =
        ((draft.type === "single_choice" || draft.type === "multi_choice") &&
          (draft.options?.some((o) => o.length > 0) ?? false)) ||
        (draft.type === "number" &&
          (draft.min !== undefined || draft.max !== undefined)) ||
        (draft.type === "file_upload" && draft.max_files !== undefined);
      if (hasTypeSpecificContent) {
        setPendingTypeSwitch(nextType);
      } else {
        applyTypeSwitch(nextType);
      }
    },
    [draft],
  );

  const applyTypeSwitch = useCallback(
    (nextType: IntakeQuestionType) => {
      setDraft((prev) => {
        // Build a fresh question of the new type but preserve id, label,
        // required, position, helper, placeholder. createBlankQuestion seeds
        // type-defaults (options=["",""] for choice, max_files=1 for upload).
        const reseed = createBlankQuestion(nextType, prev.position);
        return {
          ...reseed,
          id: prev.id,
          label: prev.label,
          required: prev.required,
          helper: prev.helper,
          placeholder: prev.placeholder,
        };
      });
      setPendingTypeSwitch(null);
    },
    [],
  );

  const cancelTypeSwitch = useCallback(() => {
    setPendingTypeSwitch(null);
  }, []);

  const confirmTypeSwitch = useCallback(() => {
    if (pendingTypeSwitch !== null) applyTypeSwitch(pendingTypeSwitch);
  }, [pendingTypeSwitch, applyTypeSwitch]);

  // Save validation
  const saveError = useMemo<string | null>(() => {
    const labelLen = draft.label.trim().length;
    if (labelLen === 0) return "Question label is required.";
    if (labelLen > LABEL_MAX)
      return `Label must be ${LABEL_MAX} characters or fewer.`;
    if (draft.type === "single_choice" || draft.type === "multi_choice") {
      const opts = draft.options ?? [];
      const nonEmpty = opts.filter((o) => o.trim().length > 0);
      if (nonEmpty.length < MIN_OPTIONS)
        return `Add at least ${MIN_OPTIONS} options.`;
    }
    if (draft.type === "number") {
      if (
        draft.min !== undefined &&
        draft.max !== undefined &&
        draft.min > draft.max
      ) {
        return "Min must be less than or equal to Max.";
      }
    }
    if (draft.type === "file_upload") {
      const allowedCount =
        (draft.allow_images === true ? 1 : 0) +
        (draft.allow_pdfs === true ? 1 : 0) +
        (draft.allow_docs === true ? 1 : 0);
      if (allowedCount === 0) return "Pick at least one allowed file type.";
    }
    return null;
  }, [draft]);

  const handleSave = useCallback(() => {
    if (saveError !== null) return;
    // Trim label + drop empty option strings for choice types.
    const cleaned: IntakeQuestion = { ...draft, label: draft.label.trim() };
    if (
      cleaned.type === "single_choice" ||
      cleaned.type === "multi_choice"
    ) {
      cleaned.options = (cleaned.options ?? [])
        .map((o) => o.trim())
        .filter((o) => o.length > 0);
    }
    if (cleaned.placeholder !== undefined) {
      const p = cleaned.placeholder.trim();
      cleaned.placeholder = p.length === 0 ? undefined : p;
    }
    onSave(cleaned);
  }, [draft, saveError, onSave]);

  const labelLen = draft.label.length;
  const labelCounterColor =
    labelLen >= LABEL_MAX
      ? semantic.error
      : labelLen >= LABEL_WARN_AT
        ? semantic.warning
        : textTokens.tertiary;

  return (
    <Sheet
      visible={visible}
      onClose={onCancel}
      snapPoint={QUESTION_EDITOR_SHEET_HEIGHT}
      testID={testID ?? "intake-question-editor-sheet"}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scrollContent,
          keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : null,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        // ORCH-0884 follow-up #3 — auto-scroll focused TextInput above
        // keyboard so Placeholder hint / Number-config fields below the
        // fold are not hidden by the keyboard. iOS 14+. Combined with the
        // paddingBottom above, this gives the full Cycle 3 wizard root
        // keyboard pattern inside a Sheet body.
        automaticallyAdjustKeyboardInsets
      >
        <Text style={styles.eyebrow} accessibilityRole="header">
          {isNewQuestion ? "NEW QUESTION" : "EDIT QUESTION"}
        </Text>

        {/* Label */}
        <Text style={styles.fieldLabel}>Question label *</Text>
        <TextInput
          value={draft.label}
          onChangeText={(t) => setField("label", t.slice(0, LABEL_MAX))}
          placeholder="e.g., What's your passport number?"
          placeholderTextColor={textTokens.quaternary}
          maxLength={LABEL_MAX}
          multiline={draft.type === "long_text" ? false : false}
          style={styles.labelInput}
          accessibilityLabel="Question label"
          autoCorrect
          autoCapitalize="sentences"
          testID="intake-editor-label-input"
        />
        <Text style={[styles.charCounter, { color: labelCounterColor }]}>
          {labelLen} / {LABEL_MAX}
        </Text>

        {/* Type chip row */}
        <Text style={styles.fieldLabel}>Type</Text>
        <View
          style={styles.typeChipRow}
          accessibilityRole="radiogroup"
          accessibilityLabel="Question type"
        >
          {TYPE_ORDER.map((t) => (
            <IntakeQuestionTypePill
              key={t}
              label={TYPE_LABELS[t]}
              active={draft.type === t}
              onPress={() => handleTypeTap(t)}
              accessibilityLabel={`Type: ${TYPE_LABELS[t]}`}
              testID={`intake-editor-type-${t}`}
            />
          ))}
        </View>

        {/* Required toggle */}
        <View style={styles.requiredWrap}>
          <IntakeRequiredToggle
            value={draft.required}
            onValueChange={(next) => setField("required", next)}
            testID="intake-editor-required-toggle"
          />
        </View>

        {/* Type-specific config */}
        <View style={styles.typeConfigWrap}>
          {(draft.type === "short_text" || draft.type === "long_text") && (
            <TextConfig draft={draft} setField={setField} />
          )}
          {(draft.type === "single_choice" || draft.type === "multi_choice") && (
            <ChoiceConfig draft={draft} setDraft={setDraft} />
          )}
          {draft.type === "date" && <DateConfig />}
          {draft.type === "number" && (
            <NumberConfig draft={draft} setField={setField} />
          )}
          {draft.type === "file_upload" && (
            <FileUploadConfig draft={draft} setField={setField} />
          )}
        </View>

        {/* Inline save error */}
        {saveError !== null && (
          <Text
            style={styles.saveError}
            accessibilityLiveRegion="polite"
            testID="intake-editor-save-error"
          >
            {saveError}
          </Text>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerCancelCell}>
            <Button
              label="Cancel"
              variant="ghost"
              size="md"
              onPress={onCancel}
              fullWidth
              testID="intake-editor-cancel"
            />
          </View>
          <View style={styles.footerSaveCell}>
            <Button
              label="Save question"
              variant="primary"
              size="md"
              onPress={handleSave}
              disabled={saveError !== null}
              fullWidth
              testID="intake-editor-save"
            />
          </View>
        </View>
      </ScrollView>

      {/* Type-switch confirm dialog */}
      <ConfirmDialog
        visible={pendingTypeSwitch !== null}
        onClose={cancelTypeSwitch}
        onConfirm={confirmTypeSwitch}
        title="Switch question type?"
        description="Switching type will clear this question's options or limits. Label and required stay."
        confirmLabel="Switch type"
        cancelLabel="Keep editing"
        destructive
        testID="intake-editor-type-switch-dialog"
      />
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Type-specific config sub-components
// ---------------------------------------------------------------------------

interface TextConfigProps {
  draft: IntakeQuestion;
  setField: <K extends keyof IntakeQuestion>(
    key: K,
    value: IntakeQuestion[K],
  ) => void;
}

/** §3.4.A + §3.4.B — short_text + long_text: optional placeholder hint. */
const TextConfig: React.FC<TextConfigProps> = ({ draft, setField }) => {
  return (
    <View>
      <Text style={styles.fieldLabel}>Placeholder hint (optional)</Text>
      <TextInput
        value={draft.placeholder ?? ""}
        onChangeText={(t) => setField("placeholder", t.slice(0, PLACEHOLDER_MAX))}
        placeholder="e.g., AB1234567"
        placeholderTextColor={textTokens.quaternary}
        maxLength={PLACEHOLDER_MAX}
        style={styles.textInputSm}
        accessibilityLabel="Optional placeholder hint"
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
};

interface ChoiceConfigProps {
  draft: IntakeQuestion;
  setDraft: React.Dispatch<React.SetStateAction<IntakeQuestion>>;
}

/** §3.4.C — single_choice + multi_choice: 2-10 options, drag-drop reorder. */
const ChoiceConfig: React.FC<ChoiceConfigProps> = ({ draft, setDraft }) => {
  const options = draft.options ?? [];

  // Map options to {id, value} so DraggableFlatList has stable keys across
  // reorder. Otherwise empty strings collide.
  const optionItems = useMemo(
    () =>
      options.map((value, idx) => ({
        id: `opt-${idx}`, // stable per current position; reseeded after reorder
        value,
        index: idx,
      })),
    [options],
  );

  const updateOption = useCallback(
    (index: number, value: string) => {
      setDraft((prev) => {
        const next = [...(prev.options ?? [])];
        next[index] = value;
        return { ...prev, options: next };
      });
    },
    [setDraft],
  );

  const removeOption = useCallback(
    (index: number) => {
      setDraft((prev) => {
        const cur = prev.options ?? [];
        if (cur.length <= MIN_OPTIONS) return prev;
        return { ...prev, options: cur.filter((_, i) => i !== index) };
      });
    },
    [setDraft],
  );

  const addOption = useCallback(() => {
    setDraft((prev) => {
      const cur = prev.options ?? [];
      if (cur.length >= MAX_OPTIONS) return prev;
      return { ...prev, options: [...cur, ""] };
    });
  }, [setDraft]);

  const handleDragEnd = useCallback(
    (params: { data: typeof optionItems; from: number; to: number }) => {
      setDraft((prev) => ({
        ...prev,
        options: params.data.map((d) => d.value),
      }));
    },
    [setDraft],
  );

  const canAdd = options.length < MAX_OPTIONS;

  return (
    <View>
      <Text style={styles.fieldLabel}>
        Options ({options.length}/{MAX_OPTIONS})
      </Text>
      <DraggableFlatList
        data={optionItems}
        keyExtractor={(item) => item.id}
        onDragEnd={handleDragEnd}
        activationDistance={8}
        scrollEnabled={false}
        renderItem={({
          item,
          drag,
          isActive,
        }: RenderItemParams<{ id: string; value: string; index: number }>) => (
          <View
            style={[
              styles.optionRow,
              isActive && styles.optionRowActive,
            ]}
          >
            <Pressable
              onLongPress={drag}
              delayLongPress={150}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Drag to reorder option"
              style={styles.dragHandle}
            >
              <Text style={styles.dragHandleGlyph}>⋮⋮</Text>
            </Pressable>
            <TextInput
              value={item.value}
              onChangeText={(t) => updateOption(item.index, t.slice(0, 100))}
              placeholder={`Option ${item.index + 1}`}
              placeholderTextColor={textTokens.quaternary}
              maxLength={100}
              style={styles.optionInput}
              accessibilityLabel={`Option ${item.index + 1}`}
              autoCapitalize="sentences"
            />
            <Pressable
              onPress={() => removeOption(item.index)}
              disabled={options.length <= MIN_OPTIONS}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove option ${item.index + 1}`}
              accessibilityState={{ disabled: options.length <= MIN_OPTIONS }}
              style={({ pressed }) => [
                styles.optionRemove,
                options.length <= MIN_OPTIONS && styles.optionRemoveDisabled,
                pressed && styles.optionRemovePressed,
              ]}
            >
              <Icon
                name="close"
                size={16}
                color={textTokens.secondary}
                strokeWidth={2}
              />
            </Pressable>
          </View>
        )}
      />
      <Pressable
        onPress={addOption}
        disabled={!canAdd}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Add option"
        accessibilityState={{ disabled: !canAdd }}
        style={({ pressed }) => [
          styles.addOptionBtn,
          !canAdd && styles.addOptionBtnDisabled,
          pressed && canAdd && styles.addOptionBtnPressed,
        ]}
      >
        <Text style={styles.addOptionLabel}>
          {canAdd ? "+ Add option" : `Maximum ${MAX_OPTIONS} options`}
        </Text>
      </Pressable>
    </View>
  );
};

/** §3.4.D — date: no extra fields in v1. */
const DateConfig: React.FC = () => {
  return (
    <View>
      <Text style={styles.helperText}>
        Travelers will pick a date from a calendar. No extra setup needed.
      </Text>
    </View>
  );
};

interface NumberConfigProps {
  draft: IntakeQuestion;
  setField: <K extends keyof IntakeQuestion>(
    key: K,
    value: IntakeQuestion[K],
  ) => void;
}

/** §3.4.E — number: optional min/max + integer_only toggle. */
const NumberConfig: React.FC<NumberConfigProps> = ({ draft, setField }) => {
  const minStr = draft.min !== undefined ? String(draft.min) : "";
  const maxStr = draft.max !== undefined ? String(draft.max) : "";

  const handleMin = useCallback(
    (raw: string) => {
      const sanitised = raw.replace(/[^0-9-]/g, "");
      if (sanitised === "" || sanitised === "-") {
        setField("min", undefined);
        return;
      }
      const parsed = parseInt(sanitised, 10);
      if (!Number.isFinite(parsed)) {
        setField("min", undefined);
        return;
      }
      setField("min", parsed);
    },
    [setField],
  );

  const handleMax = useCallback(
    (raw: string) => {
      const sanitised = raw.replace(/[^0-9-]/g, "");
      if (sanitised === "" || sanitised === "-") {
        setField("max", undefined);
        return;
      }
      const parsed = parseInt(sanitised, 10);
      if (!Number.isFinite(parsed)) {
        setField("max", undefined);
        return;
      }
      setField("max", parsed);
    },
    [setField],
  );

  return (
    <View>
      <Text style={styles.fieldLabel}>Optional limits</Text>
      <View style={styles.numberRow}>
        <View style={styles.numberCell}>
          <Text style={styles.subFieldLabel}>Min</Text>
          <TextInput
            value={minStr}
            onChangeText={handleMin}
            placeholder="—"
            placeholderTextColor={textTokens.quaternary}
            keyboardType="number-pad"
            style={styles.textInputSm}
            accessibilityLabel="Minimum number"
          />
        </View>
        <View style={styles.numberCell}>
          <Text style={styles.subFieldLabel}>Max</Text>
          <TextInput
            value={maxStr}
            onChangeText={handleMax}
            placeholder="—"
            placeholderTextColor={textTokens.quaternary}
            keyboardType="number-pad"
            style={styles.textInputSm}
            accessibilityLabel="Maximum number"
          />
        </View>
      </View>
      <View style={styles.requiredWrap}>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Integer only (no decimals)</Text>
          <Pressable
            onPress={() => setField("integer_only", !(draft.integer_only ?? false))}
            hitSlop={8}
            accessibilityRole="switch"
            accessibilityLabel="Integer only"
            accessibilityState={{ checked: draft.integer_only === true }}
            style={({ pressed }) => [
              styles.toggleCheckbox,
              draft.integer_only === true && styles.toggleCheckboxOn,
              pressed && styles.toggleCheckboxPressed,
            ]}
          >
            {draft.integer_only === true ? (
              <Icon
                name="check"
                size={14}
                color={textTokens.primary}
                strokeWidth={3}
              />
            ) : null}
          </Pressable>
        </View>
      </View>
    </View>
  );
};

interface FileUploadConfigProps {
  draft: IntakeQuestion;
  setField: <K extends keyof IntakeQuestion>(
    key: K,
    value: IntakeQuestion[K],
  ) => void;
}

/** §3.4.F — file_upload: max_files chip picker + 3 type checkboxes. */
const FileUploadConfig: React.FC<FileUploadConfigProps> = ({
  draft,
  setField,
}) => {
  const maxFiles = draft.max_files ?? 1;
  const allowImages = draft.allow_images !== false;
  const allowPdfs = draft.allow_pdfs !== false;
  const allowDocs = draft.allow_docs !== false;

  return (
    <View>
      <Text style={styles.fieldLabel}>Maximum files per upload</Text>
      <View style={styles.maxFilesRow}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = n === maxFiles;
          return (
            <Pressable
              key={`max-${n}`}
              onPress={() => setField("max_files", n)}
              hitSlop={8}
              accessibilityRole="radio"
              accessibilityLabel={`Maximum ${n} ${n === 1 ? "file" : "files"}`}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [
                styles.maxFilesChip,
                active && styles.maxFilesChipActive,
                pressed && styles.maxFilesChipPressed,
              ]}
            >
              <Text
                style={[
                  styles.maxFilesLabel,
                  active && styles.maxFilesLabelActive,
                ]}
              >
                {n}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.fieldLabel, styles.allowedTypesHeader]}>
        Allowed file types
      </Text>
      <FileTypeCheckbox
        label="Images (JPG, PNG, HEIC, WebP)"
        checked={allowImages}
        onToggle={() => setField("allow_images", !allowImages)}
        testID="intake-editor-allow-images"
      />
      <FileTypeCheckbox
        label="PDFs"
        checked={allowPdfs}
        onToggle={() => setField("allow_pdfs", !allowPdfs)}
        testID="intake-editor-allow-pdfs"
      />
      <FileTypeCheckbox
        label="Documents (DOCX, DOC)"
        checked={allowDocs}
        onToggle={() => setField("allow_docs", !allowDocs)}
        testID="intake-editor-allow-docs"
      />
      <Text style={styles.helperText}>
        Files capped at 10 MB each. Operators see all answers in the trip
        dashboard.
      </Text>
    </View>
  );
};

interface FileTypeCheckboxProps {
  label: string;
  checked: boolean;
  onToggle: () => void;
  testID?: string;
}

const FileTypeCheckbox: React.FC<FileTypeCheckboxProps> = ({
  label,
  checked,
  onToggle,
  testID,
}) => {
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={4}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      style={({ pressed }) => [
        styles.toggleRow,
        pressed && styles.toggleRowPressed,
      ]}
      testID={testID}
    >
      <View
        style={[
          styles.toggleCheckbox,
          checked && styles.toggleCheckboxOn,
        ]}
      >
        {checked ? (
          <Icon
            name="check"
            size={14}
            color={textTokens.primary}
            strokeWidth={3}
          />
        ) : null}
      </View>
      <Text style={styles.toggleLabel}>{label}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
  },
  eyebrow: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: accent.warm,
    textTransform: "uppercase",
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  subFieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginBottom: spacing.xxs,
  },
  labelInput: {
    minHeight: 44,
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
  charCounter: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    textAlign: "right",
    marginTop: spacing.xxs,
  },
  typeChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  requiredWrap: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  typeConfigWrap: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  textInputSm: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  helperText: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginTop: spacing.sm,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  optionRowActive: {
    opacity: 0.85,
    backgroundColor: glass.tint.profileBase,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xs,
  },
  dragHandle: {
    width: 28,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  dragHandleGlyph: {
    fontSize: 16,
    color: textTokens.tertiary,
    letterSpacing: -1,
    fontWeight: "700",
  },
  optionInput: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  optionRemove: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  optionRemoveDisabled: {
    opacity: 0.3,
  },
  optionRemovePressed: {
    opacity: 0.7,
  },
  addOptionBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: "transparent",
    alignSelf: "flex-start",
    minHeight: 36,
    justifyContent: "center",
  },
  addOptionBtnDisabled: {
    opacity: 0.4,
    borderColor: glass.border.profileBase,
  },
  addOptionBtnPressed: {
    opacity: 0.7,
  },
  addOptionLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: accent.warm,
    fontWeight: "500",
  },
  numberRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  numberCell: {
    flex: 1,
  },
  maxFilesRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  maxFilesChip: {
    minWidth: 40,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  maxFilesChipActive: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  maxFilesChipPressed: {
    opacity: 0.8,
  },
  maxFilesLabel: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
  },
  maxFilesLabelActive: {
    color: textTokens.primary,
    fontWeight: "600",
  },
  allowedTypesHeader: {
    marginTop: spacing.md,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 36,
  },
  toggleRowPressed: {
    opacity: 0.7,
  },
  toggleCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: glass.border.profileElevated,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleCheckboxOn: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  toggleCheckboxPressed: {
    opacity: 0.7,
  },
  toggleLabel: {
    flex: 1,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
  },
  saveError: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: semantic.error,
    backgroundColor: semantic.errorTint,
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: glass.border.profileBase,
  },
  footerCancelCell: {
    flex: 1,
  },
  footerSaveCell: {
    flex: 2,
  },
});

export default IntakeQuestionEditor;
