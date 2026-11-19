/**
 * #4514 — the brand form additions to the ONE question editor, shared by the
 * native and the web editor so a change is made once:
 *   - IntakeHelpTextField: "Help text (optional)", 300 characters.
 *   - IntakeBrandFormFields: "Show at the door" (cap of 3, first-use warning,
 *     optional 16-character door label) and "Show only if".
 *
 * The trip editor never renders these (its features are off).
 */

import React, { useCallback } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { color, radius, space, type as typeToken } from "../../constants/designSystem";
import type { IntakeQuestion } from "../../services/intakeSchemaService";
import {
  BRAND_FORM_DOOR_LABEL_MAX,
  BRAND_FORM_HELP_MAX,
  doorToggleState,
  type ConditionSource,
} from "../../utils/brandFormDefinition";
import { FORMS_COPY } from "../forms/brandFormsCopy";
import type { IntakeBuilderFeatures } from "./intakeBuilderFeatures";

type SetDraft = React.Dispatch<React.SetStateAction<IntakeQuestion>>;

export interface IntakeHelpTextFieldProps {
  draft: IntakeQuestion;
  setDraft: SetDraft;
}

export const IntakeHelpTextField: React.FC<IntakeHelpTextFieldProps> = ({ draft, setDraft }) => {
  const value = draft.helper ?? "";
  return (
    <View style={styles.block}>
      <Text style={styles.fieldLabel}>{FORMS_COPY.helpLabel}</Text>
      <TextInput
        value={value}
        onChangeText={(t) => setDraft((prev) => ({ ...prev, helper: t.slice(0, BRAND_FORM_HELP_MAX) }))}
        placeholder={FORMS_COPY.helpPlaceholder}
        placeholderTextColor={color.text4}
        maxLength={BRAND_FORM_HELP_MAX}
        style={styles.input}
        accessibilityLabel="Help text, optional"
        testID="intake-editor-help-input"
      />
      <Text style={styles.counter}>
        {value.length} / {BRAND_FORM_HELP_MAX}
      </Text>
    </View>
  );
};

export interface IntakeBrandFormFieldsProps {
  draft: IntakeQuestion;
  setDraft: SetDraft;
  features: IntakeBuilderFeatures;
  /** Door questions on the form besides this one. */
  otherDoorCount: number;
  /** Earlier single-choice questions this one may depend on. */
  conditionSources: ConditionSource[];
  /** "Q3" numbers of questions that depend on this one. */
  dependents: number[];
  /** 1-based number of this question, or null for a new one. */
  number: number | null;
  typeLabel: string;
  /** The first-use door warning has been dismissed on this form. */
  doorNoticeAcked: boolean;
  onDoorNoticeAck: () => void;
}

const SwitchRow: React.FC<{
  title: string;
  line: string;
  subline?: string;
  value: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  onValueChange: (next: boolean) => void;
  testID?: string;
}> = ({ title, line, subline, value, disabled = false, accessibilityLabel, onValueChange, testID }) => (
  <View style={styles.switchRow}>
    <View style={styles.switchText}>
      <Text style={styles.switchTitle}>{title}</Text>
      <Text style={styles.switchLine}>{line}</Text>
      {subline !== undefined ? <Text style={styles.switchSub}>{subline}</Text> : null}
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={{ false: color.line, true: color.accentLine }}
      thumbColor={value ? color.accent : color.text3}
      ios_backgroundColor={color.line}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      testID={testID}
    />
  </View>
);

export const IntakeBrandFormFields: React.FC<IntakeBrandFormFieldsProps> = ({
  draft,
  setDraft,
  features,
  otherDoorCount,
  conditionSources,
  dependents,
  number,
  typeLabel,
  doorNoticeAcked,
  onDoorNoticeAck,
}) => {
  const door = doorToggleState(draft, otherDoorCount, typeLabel);
  const doorOn = draft.show_at_door === true && door.canTurnOn;

  const setDoor = useCallback(
    (next: boolean) => {
      setDraft((prev) => {
        if (!next) {
          const { show_at_door: _a, door_label: _b, ...rest } = prev;
          void _a;
          void _b;
          return rest;
        }
        return { ...prev, show_at_door: true };
      });
    },
    [setDraft],
  );

  const setCondition = useCallback(
    (next: boolean) => {
      setDraft((prev) => {
        if (!next) {
          const { show_if: _s, ...rest } = prev;
          void _s;
          return rest;
        }
        const source = conditionSources[0];
        const option = source?.options[0];
        if (source === undefined || option === undefined) return prev;
        return { ...prev, show_if: { question_id: source.id, option_id: option.id } };
      });
    },
    [setDraft, conditionSources],
  );

  const pickSource = useCallback(
    (source: ConditionSource) => {
      const option = source.options[0];
      if (option === undefined) return;
      setDraft((prev) => ({ ...prev, show_if: { question_id: source.id, option_id: option.id } }));
    },
    [setDraft],
  );

  const pickOption = useCallback(
    (optionId: string) => {
      setDraft((prev) =>
        prev.show_if === undefined ? prev : { ...prev, show_if: { ...prev.show_if, option_id: optionId } },
      );
    },
    [setDraft],
  );

  const firstQuestion = number === 1;
  const hasSources = conditionSources.length > 0;
  const showIf = draft.show_if;
  const activeSource = showIf !== undefined ? conditionSources.find((s) => s.id === showIf.question_id) : undefined;
  const conditionLine = firstQuestion
    ? FORMS_COPY.showOnlyIfFirst
    : hasSources
      ? FORMS_COPY.showOnlyIfHint
      : FORMS_COPY.showOnlyIfNoSource;
  const doorLabel = draft.door_label ?? "";

  return (
    <View style={styles.block}>
      {features.door ? (
        <View style={styles.group}>
          <SwitchRow
            title={FORMS_COPY.doorTitle}
            line={door.line}
            subline={door.countLine}
            value={doorOn}
            disabled={!door.canTurnOn}
            accessibilityLabel="Show at the door"
            onValueChange={setDoor}
            testID="intake-editor-door-toggle"
          />
          {doorOn && !doorNoticeAcked ? (
            <View style={styles.notice} accessibilityRole="alert" testID="intake-editor-door-warning">
              <Text style={styles.noticeTitle}>{FORMS_COPY.doorFirstUseTitle}</Text>
              <Text style={styles.noticeBody}>{FORMS_COPY.doorFirstUseBody}</Text>
              <View style={styles.noticeButtons}>
                <Pressable
                  onPress={onDoorNoticeAck}
                  accessibilityRole="button"
                  accessibilityLabel={FORMS_COPY.gotIt}
                  style={styles.noticePrimary}
                  testID="intake-editor-door-got-it"
                >
                  <Text style={styles.noticePrimaryLabel}>{FORMS_COPY.gotIt}</Text>
                </Pressable>
                <Pressable
                  onPress={() => setDoor(false)}
                  accessibilityRole="button"
                  accessibilityLabel={FORMS_COPY.turnOff}
                  style={styles.noticeSecondary}
                  testID="intake-editor-door-turn-off"
                >
                  <Text style={styles.noticeSecondaryLabel}>{FORMS_COPY.turnOff}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {doorOn ? (
            <View style={styles.block}>
              <Text style={styles.fieldLabel}>{FORMS_COPY.doorLabelField}</Text>
              <TextInput
                value={doorLabel}
                onChangeText={(t) =>
                  setDraft((prev) => ({ ...prev, door_label: t.slice(0, BRAND_FORM_DOOR_LABEL_MAX) }))
                }
                placeholder={FORMS_COPY.doorLabelPlaceholder}
                placeholderTextColor={color.text4}
                maxLength={BRAND_FORM_DOOR_LABEL_MAX}
                style={styles.input}
                accessibilityLabel="Label at the door, optional"
                testID="intake-editor-door-label"
              />
              <Text style={styles.counter}>
                {doorLabel.length} / {BRAND_FORM_DOOR_LABEL_MAX}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {features.conditions ? (
        <View style={styles.group}>
          <SwitchRow
            title={FORMS_COPY.showOnlyIfTitle}
            line={conditionLine}
            value={showIf !== undefined && hasSources}
            disabled={!hasSources || firstQuestion}
            accessibilityLabel="Show only if"
            onValueChange={setCondition}
            testID="intake-editor-condition-toggle"
          />
          {showIf !== undefined && activeSource !== undefined ? (
            <View style={styles.block}>
              <Text style={styles.fieldLabel}>{FORMS_COPY.whenThisQuestion}</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {conditionSources.map((source) => {
                  const selected = source.id === showIf.question_id;
                  return (
                    <Pressable
                      key={source.id}
                      onPress={() => pickSource(source)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={`Question ${source.number}: ${source.label || "Untitled question"}`}
                      style={[styles.chip, selected && styles.chipOn]}
                      testID={`intake-editor-condition-source-${source.id}`}
                    >
                      <Text style={[styles.chipLabel, selected && styles.chipLabelOn]} numberOfLines={1}>
                        {`Q${source.number} · ${source.label || "Untitled question"}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.fieldLabel}>{FORMS_COPY.isAnswered}</Text>
              <View style={styles.chips} accessibilityRole="radiogroup">
                {activeSource.options.map((option) => {
                  const selected = option.id === showIf.option_id;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() => pickOption(option.id)}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={option.label || "Untitled option"}
                      style={[styles.chip, selected && styles.chipOn]}
                      testID={`intake-editor-condition-option-${option.id}`}
                    >
                      <Text style={[styles.chipLabel, selected && styles.chipLabelOn]} numberOfLines={1}>
                        {option.label || "Untitled option"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.hint}>{FORMS_COPY.hiddenNote}</Text>
            </View>
          ) : null}
          {dependents.length > 0 ? <Text style={styles.hint}>{FORMS_COPY.dependsOn(dependents)}</Text> : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  block: { gap: space[1] },
  group: { gap: space[2], marginTop: space[2] },
  fieldLabel: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    fontWeight: "600",
    color: color.text2,
    marginTop: space[2],
  },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
    paddingHorizontal: space[4],
    fontSize: typeToken.body.fontSize,
    color: color.text1,
  },
  counter: {
    fontSize: typeToken.caption.fontSize,
    lineHeight: typeToken.caption.lineHeight,
    color: color.text3,
    textAlign: "right",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    minHeight: 44,
  },
  switchText: { flex: 1, minWidth: 0, gap: 2 },
  switchTitle: {
    fontSize: typeToken.body.fontSize,
    lineHeight: typeToken.body.lineHeight,
    fontWeight: "600",
    color: color.text1,
  },
  switchLine: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    color: color.text2,
  },
  switchSub: {
    fontSize: typeToken.caption.fontSize,
    lineHeight: typeToken.caption.lineHeight,
    color: color.text3,
  },
  notice: {
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: color.warning,
    backgroundColor: color.fill.inset,
    padding: space[3],
    gap: space[1],
  },
  noticeTitle: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    fontWeight: "700",
    color: color.text1,
  },
  noticeBody: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    color: color.text2,
  },
  noticeButtons: { flexDirection: "row", gap: space[2], marginTop: space[2] },
  noticePrimary: {
    minHeight: 36,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    backgroundColor: color.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  noticePrimaryLabel: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    fontWeight: "600",
    color: color.textStrong,
  },
  noticeSecondary: {
    minHeight: 36,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: "center",
    justifyContent: "center",
  },
  noticeSecondaryLabel: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    fontWeight: "500",
    color: color.text2,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[1] },
  chip: {
    minHeight: 36,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.line,
    justifyContent: "center",
    maxWidth: "100%",
  },
  chipOn: { borderColor: color.accent, backgroundColor: color.accentLine },
  chipLabel: {
    fontSize: typeToken.small.fontSize,
    lineHeight: typeToken.small.lineHeight,
    color: color.text2,
  },
  chipLabelOn: { color: color.text1, fontWeight: "600" },
  hint: {
    fontSize: typeToken.caption.fontSize,
    lineHeight: typeToken.caption.lineHeight,
    color: color.text3,
  },
});
