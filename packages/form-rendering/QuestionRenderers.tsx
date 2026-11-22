/**
 * #4514 — the one question model's renderers (moved from mingla-business
 * `src/components/checkout/intake/IntakeQuestionRenderers.tsx`, ORCH-0880).
 *
 * Renderer-per-type with a common label + required-asterisk + helper shell,
 * and the IntakeFormRenderer orchestrator. Props-only (C11): the host app
 * injects its design tokens, its Icon and its web date input through
 * `primitives`, and renders file upload itself through `renderFileUpload`
 * (the file picker stays in the host app until brand-form file upload ships).
 *
 * Each renderer accepts { question, value, onChange, error?, disabled?, primitives }.
 *
 * Date questions render the host's injected date input on every platform: the
 * host app's Mingla calendar field (#4523), so no OS spinner, OS dialog or
 * browser date box is drawn here. No useAuth: anon-tolerant.
 *
 * MINGLA-INVARIANT: I-4514-ONE-QUESTION-MODEL | issue #4514 | question renderers live only in packages/form-rendering (strict-grep gate i-4514-one-question-model.mjs).
 */

import React, { useCallback, useMemo } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { resolveFormCopy } from "./formCopy";
import type {
  FormAnswerValue,
  FormFileAnswer,
  FormQuestion,
  FormQuestionType,
  FormRenderingPrimitives,
  FormRenderingTokens,
  FormSchema,
  RenderFormFileUpload,
} from "./types";

// ---------------------------------------------------------------------------
// Styles (built once per injected token set)
// ---------------------------------------------------------------------------

const makeStyles = (t: FormRenderingTokens) => {
  const { color, radius, space, type } = t;
  return StyleSheet.create({
    formWrap: { gap: space[6] },
    shellWrap: { marginBottom: space[6] },
    labelRow: {
      flexDirection: "row",
      alignItems: "baseline",
      flexWrap: "wrap",
      gap: space[1],
      marginBottom: space[1],
    },
    label: {
      fontSize: type.body.fontSize,
      lineHeight: type.body.lineHeight,
      color: color.text1,
      fontWeight: "500",
    },
    requiredAsterisk: {
      // #4541 R2.7: an injected mark colour (the Explorer app's white), else the accent.
      color: color.requiredMark ?? color.accent,
      fontSize: type.body.fontSize,
      fontWeight: "700",
    },
    optionalNote: {
      fontSize: type.caption.fontSize,
      lineHeight: type.caption.lineHeight,
      color: color.text3,
    },
    textInput: {
      minHeight: 48,
      paddingHorizontal: space[4],
      paddingVertical: 10,
      borderRadius: radius.sm,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.fill.inset,
      color: color.text1,
      fontSize: type.body.fontSize,
      lineHeight: type.body.lineHeight,
    },
    textInputMulti: { minHeight: 96, paddingTop: 10 },
    textInputError: { borderColor: color.danger },
    textInputDisabled: { opacity: 0.5 },
    helperText: {
      fontSize: type.caption.fontSize,
      lineHeight: type.caption.lineHeight,
      color: color.text3,
      marginTop: 2,
    },
    helperTextWarning: { color: color.warning },
    helperTextDanger: { color: color.danger },
    helperBelowWrap: { marginTop: 2 },
    // #4541 R6.3: `helper` lines under the label, before the field.
    helperAboveWrap: { marginBottom: space[2], gap: 2 },
    helperLine: {
      fontSize: type.caption.fontSize,
      lineHeight: type.caption.lineHeight,
      color: color.text3,
    },
    doorLineRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    doorLineIcon: { width: 12, height: 12, alignItems: "center", justifyContent: "center" },
    errorRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: space[1],
    },
    errorText: {
      flex: 1,
      fontSize: type.caption.fontSize,
      lineHeight: type.caption.lineHeight,
      color: color.danger,
    },
    choicesWrap: { gap: space[1] },
    choiceRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: space[2],
      paddingVertical: space[2],
      paddingHorizontal: space[4],
      borderRadius: radius.md,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: color.line,
      backgroundColor: color.fill.inset,
      minHeight: 56,
    },
    choiceRowSelected: {
      borderColor: color.accentLine,
      backgroundColor: color.accentLine,
    },
    choiceRowPressed: { opacity: 0.7 },
    choiceRowDisabled: { opacity: 0.5 },
    radioOuter: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: color.text3,
      alignItems: "center",
      justifyContent: "center",
    },
    radioOuterSelected: { borderColor: color.accentLine },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: color.accent,
    },
    checkboxOuter: {
      width: 20,
      height: 20,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: color.text3,
      alignItems: "center",
      justifyContent: "center",
    },
    checkboxOuterSelected: {
      borderColor: color.accentLine,
      backgroundColor: color.accentLine,
    },
    choiceLabel: {
      flex: 1,
      fontSize: type.body.fontSize,
      lineHeight: type.body.lineHeight,
      color: color.text1,
    },
  });
};

type FormStyles = ReturnType<typeof makeStyles>;
const styleCache = new WeakMap<FormRenderingTokens, FormStyles>();

/** The renderer styles for one injected token set (cached per token object). */
export function formStylesFor(tokens: FormRenderingTokens): FormStyles {
  const cached = styleCache.get(tokens);
  if (cached !== undefined) return cached;
  const built = makeStyles(tokens);
  styleCache.set(tokens, built);
  return built;
}

// ---------------------------------------------------------------------------
// Shared shell
// ---------------------------------------------------------------------------

export interface IntakeQuestionShellProps {
  question: FormQuestion;
  primitives: FormRenderingPrimitives;
  error?: string;
  children: React.ReactNode;
  helperBelow?: React.ReactNode;
}

/**
 * #4541 R6.3: the question's `helper` (help text, then the door line), one
 * line per `\n`. Help lines use the muted caption style. The line equal to
 * `copy.shownToDoorStaff` is drawn as a row: the eye as its own element,
 * hidden from screen readers, and the words beside it.
 */
export const IntakeQuestionHelper: React.FC<{
  helper: string | undefined;
  primitives: FormRenderingPrimitives;
  testID?: string;
}> = ({ helper, primitives, testID = "intake-question-helper" }) => {
  if (helper === undefined) return null;
  const lines = helper
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;
  const styles = formStylesFor(primitives.tokens);
  const copy = resolveFormCopy(primitives.copy);
  const { Icon } = primitives;
  return (
    <View style={styles.helperAboveWrap} testID={testID}>
      {lines.map((line, idx) =>
        line === copy.shownToDoorStaff ? (
          <View
            key={`door-${idx}`}
            style={styles.doorLineRow}
            accessible
            accessibilityLabel={copy.shownToDoorStaff}
            testID={`${testID}-door`}
          >
            <View
              style={styles.doorLineIcon}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              aria-hidden
              testID={`${testID}-door-eye`}
            >
              <Icon name="eye" size={12} color={primitives.tokens.color.text3} strokeWidth={2} />
            </View>
            <Text style={styles.helperLine}>{line}</Text>
          </View>
        ) : (
          <Text key={`help-${idx}`} style={styles.helperLine}>
            {line}
          </Text>
        ),
      )}
    </View>
  );
};

export const IntakeQuestionShell: React.FC<IntakeQuestionShellProps> = ({
  question,
  primitives,
  error,
  children,
  helperBelow,
}) => {
  const styles = formStylesFor(primitives.tokens);
  const copy = resolveFormCopy(primitives.copy);
  const { Icon } = primitives;
  return (
    <View style={styles.shellWrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {question.label.length > 0 ? question.label : copy.untitledQuestion}
          {question.required ? (
            <Text style={styles.requiredAsterisk}> *</Text>
          ) : null}
        </Text>
        {!question.required ? (
          <Text style={styles.optionalNote}>{copy.optional}</Text>
        ) : null}
      </View>
      <IntakeQuestionHelper helper={question.helper} primitives={primitives} />
      {children}
      {helperBelow !== undefined && helperBelow !== null ? (
        <View style={styles.helperBelowWrap}>{helperBelow}</View>
      ) : null}
      {error !== undefined && error.length > 0 ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Icon
            name="bell"
            size={14}
            color={primitives.tokens.color.danger}
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
  question: FormQuestion;
  primitives: FormRenderingPrimitives;
  error?: string;
  disabled?: boolean;
}

export interface IntakeQuestionTextProps extends IntakeQuestionRendererCommonProps {
  value: string;
  onChange: (next: string) => void;
}

export const SHORT_TEXT_MAX = 200;
export const LONG_TEXT_MAX = 2000;

function counterStyle(
  styles: FormStyles,
  len: number,
  max: number,
  warnAt: number,
): object[] {
  if (len >= max) return [styles.helperText, styles.helperTextDanger];
  if (len >= warnAt) return [styles.helperText, styles.helperTextWarning];
  return [styles.helperText];
}

// ---------------------------------------------------------------------------
// IntakeQuestionShortText / IntakeQuestionLongText
// ---------------------------------------------------------------------------

export const IntakeQuestionShortText: React.FC<IntakeQuestionTextProps> = ({
  question,
  primitives,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const styles = formStylesFor(primitives.tokens);
  const len = value.length;
  return (
    <IntakeQuestionShell
      question={question}
      primitives={primitives}
      error={error}
      helperBelow={
        <Text style={counterStyle(styles, len, SHORT_TEXT_MAX, SHORT_TEXT_MAX - 20)}>
          {len} / {SHORT_TEXT_MAX}
        </Text>
      }
    >
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.slice(0, SHORT_TEXT_MAX))}
        placeholder={question.placeholder ?? resolveFormCopy(primitives.copy).textPlaceholder}
        placeholderTextColor={primitives.tokens.color.text4}
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

export const IntakeQuestionLongText: React.FC<IntakeQuestionTextProps> = ({
  question,
  primitives,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const styles = formStylesFor(primitives.tokens);
  const len = value.length;
  return (
    <IntakeQuestionShell
      question={question}
      primitives={primitives}
      error={error}
      helperBelow={
        <Text style={counterStyle(styles, len, LONG_TEXT_MAX, LONG_TEXT_MAX - 200)}>
          {len} / {LONG_TEXT_MAX}
        </Text>
      }
    >
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.slice(0, LONG_TEXT_MAX))}
        placeholder={question.placeholder ?? resolveFormCopy(primitives.copy).textPlaceholder}
        placeholderTextColor={primitives.tokens.color.text4}
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
// IntakeQuestionSingleChoice / IntakeQuestionMultiChoice
// ---------------------------------------------------------------------------

export const IntakeQuestionSingleChoice: React.FC<IntakeQuestionTextProps> = ({
  question,
  primitives,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const styles = formStylesFor(primitives.tokens);
  const options = question.options ?? [];
  return (
    <IntakeQuestionShell question={question} primitives={primitives} error={error}>
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
              accessibilityState={{ selected, checked: selected, disabled }}
              hitSlop={4}
              style={({ pressed }) => [
                styles.choiceRow,
                selected && styles.choiceRowSelected,
                pressed && !disabled && styles.choiceRowPressed,
                disabled && styles.choiceRowDisabled,
              ]}
            >
              <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
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

export interface IntakeQuestionMultiChoiceProps extends IntakeQuestionRendererCommonProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export const IntakeQuestionMultiChoice: React.FC<IntakeQuestionMultiChoiceProps> = ({
  question,
  primitives,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const styles = formStylesFor(primitives.tokens);
  const { Icon } = primitives;
  const options = question.options ?? [];
  const toggle = (opt: string): void => {
    if (disabled) return;
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  };
  return (
    <IntakeQuestionShell question={question} primitives={primitives} error={error}>
      <View style={styles.choicesWrap} accessibilityLabel={question.label}>
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
              <View style={[styles.checkboxOuter, checked && styles.checkboxOuterSelected]}>
                {checked ? (
                  <Icon
                    name="check"
                    size={12}
                    color={primitives.tokens.color.text1}
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
// ---------------------------------------------------------------------------

export function formatDateForDisplay(iso: string): string {
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

/**
 * #4523 — the date question renders the host's injected date input on every
 * platform (Host: its Mingla calendar field; Explorer: its inline Mingla
 * calendar). The answer is the picked day as `YYYY-MM-DD` (or "" when
 * cleared), exactly the string the browser date box and the native picker
 * produced before, so stored answers and validation are unchanged.
 */
export const IntakeQuestionDate: React.FC<IntakeQuestionTextProps> = ({
  question,
  primitives,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const { WebDateTimeInput } = primitives;
  return (
    <IntakeQuestionShell question={question} primitives={primitives} error={error}>
      <WebDateTimeInput
        type="date"
        value={value}
        disabled={disabled}
        ariaLabel={question.label}
        hasError={error !== undefined && error.length > 0}
        testID="intake-date"
        tokens={primitives.tokens}
        onChangeValue={(v) => onChange(v)}
      />
    </IntakeQuestionShell>
  );
};

// ---------------------------------------------------------------------------
// IntakeQuestionNumber
// ---------------------------------------------------------------------------

export const IntakeQuestionNumber: React.FC<IntakeQuestionTextProps> = ({
  question,
  primitives,
  value,
  onChange,
  error,
  disabled = false,
}) => {
  const styles = formStylesFor(primitives.tokens);
  const copy = resolveFormCopy(primitives.copy);
  const hint =
    question.min !== undefined || question.max !== undefined
      ? `${question.min !== undefined ? copy.numberMin(String(question.min)) : ""}${
          question.min !== undefined && question.max !== undefined ? " · " : ""
        }${question.max !== undefined ? copy.numberMax(String(question.max)) : ""}`
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
      primitives={primitives}
      error={error}
      helperBelow={hint !== null ? <Text style={styles.helperText}>{hint}</Text> : null}
    >
      <TextInput
        value={value}
        onChangeText={handleChange}
        placeholder={question.placeholder ?? copy.numberPlaceholder}
        placeholderTextColor={primitives.tokens.color.text4}
        editable={!disabled}
        keyboardType={question.integer_only === true ? "number-pad" : "numeric"}
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
// IntakeFormRenderer — orchestrator
// ---------------------------------------------------------------------------

export interface IntakeFormRendererProps {
  schema: FormSchema;
  answers: Record<string, FormAnswerValue>;
  onAnswersChange: (next: Record<string, FormAnswerValue>) => void;
  primitives: FormRenderingPrimitives;
  /** File upload is drawn by the host app (C11); without it the question is skipped. */
  renderFileUpload?: RenderFormFileUpload;
  validationErrors?: Record<string, string>;
  /** True in preview pane to disable all inputs. */
  disabled?: boolean;
}

function isFileAnswer(x: unknown): x is FormFileAnswer {
  return typeof x === "object" && x !== null && "claim_id" in x;
}

export const IntakeFormRenderer: React.FC<IntakeFormRendererProps> = ({
  schema,
  answers,
  onAnswersChange,
  primitives,
  renderFileUpload,
  validationErrors,
  disabled = false,
}) => {
  const styles = formStylesFor(primitives.tokens);
  const setAnswer = useCallback(
    (questionId: string, value: FormAnswerValue): void => {
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
        const common = { question: q, primitives, error, disabled };
        switch (q.type) {
          case "short_text":
          case "long_text": {
            const v = typeof value === "string" ? value : "";
            const Renderer = q.type === "short_text" ? IntakeQuestionShortText : IntakeQuestionLongText;
            return <Renderer key={q.id} {...common} value={v} onChange={(next) => setAnswer(q.id, next)} />;
          }
          case "single_choice": {
            const v = typeof value === "string" ? value : "";
            return <IntakeQuestionSingleChoice key={q.id} {...common} value={v} onChange={(next) => setAnswer(q.id, next)} />;
          }
          case "multi_choice": {
            const v = Array.isArray(value)
              ? value.filter((x): x is string => typeof x === "string")
              : [];
            return <IntakeQuestionMultiChoice key={q.id} {...common} value={v} onChange={(next) => setAnswer(q.id, next)} />;
          }
          case "date": {
            const v = typeof value === "string" ? value : "";
            return <IntakeQuestionDate key={q.id} {...common} value={v} onChange={(next) => setAnswer(q.id, next)} />;
          }
          case "number": {
            const v = typeof value === "string" ? value : "";
            return <IntakeQuestionNumber key={q.id} {...common} value={v} onChange={(next) => setAnswer(q.id, next)} />;
          }
          case "file_upload": {
            if (renderFileUpload === undefined) return null;
            const v = Array.isArray(value) ? (value as unknown[]).filter(isFileAnswer) : [];
            return (
              <React.Fragment key={q.id}>
                {renderFileUpload({
                  question: q,
                  value: v,
                  onChange: (next) => setAnswer(q.id, next),
                  error,
                  disabled,
                })}
              </React.Fragment>
            );
          }
          default: {
            const _never: never = q.type;
            void (_never as FormQuestionType);
            return null;
          }
        }
      })}
    </View>
  );
};

export default IntakeFormRenderer;
