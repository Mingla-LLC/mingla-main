/**
 * TripGuideEditor — Issue #2829 W4 "Before you go".
 *
 * Lets a host add the trip guide travellers see on the Mingla trip page on
 * every surface: highlights, what to prepare, good to know, questions and
 * answers, the group minimum and how active the trip is. Every part is
 * optional; a part left empty simply does not appear on the trip page.
 *
 * Self-contained: it loads the stored guide for `eventId` (team read), keeps
 * a local draft, and saves through `biz_upsert_trip_guide` (event manager or
 * above; Mingla re-checks). States: loading, load error (with retry), empty,
 * editing, saving (button disabled, no double save), save error (plain
 * message), saved. Limits mirror the database so a save is never refused for
 * something the form allowed.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  EMPTY_TRIP_GUIDE_DRAFT,
  TRIP_GUIDE_ACTIVITY_LABEL,
  TRIP_GUIDE_ACTIVITY_LEVELS,
  TRIP_GUIDE_LIMITS,
  tripGuideDraftFrom,
  tripGuideDraftProblems,
  tripGuidePayload,
  type TripGuideDraft,
} from "@mingla/offering-rendering/tripGuide";

import {
  accent,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import {
  tripGuideSaveErrorMessage,
  useSaveTripGuide,
  useTripGuideForEditor,
} from "../../hooks/useTripGuide";
import { Icon } from "../ui/Icon";

export interface TripGuideEditorProps {
  eventId: string;
  disabled?: boolean;
  /** Optional: also announce the save result through the parent's toast. */
  onShowToast?: (message: string) => void;
  testID?: string;
}

const INPUT_BORDER = "rgba(255, 255, 255, 0.12)";
const INPUT_BG = "rgba(255, 255, 255, 0.04)";

const sameDraft = (a: TripGuideDraft, b: TripGuideDraft): boolean =>
  JSON.stringify(tripGuidePayload(a)) === JSON.stringify(tripGuidePayload(b));

export const TripGuideEditor: React.FC<TripGuideEditorProps> = ({
  eventId,
  disabled = false,
  onShowToast,
  testID = "trip-guide-editor",
}) => {
  const guideQuery = useTripGuideForEditor(eventId);
  const saveMutation = useSaveTripGuide();
  const [saved, setSaved] = useState<TripGuideDraft>(EMPTY_TRIP_GUIDE_DRAFT);
  const [draft, setDraft] = useState<TripGuideDraft>(EMPTY_TRIP_GUIDE_DRAFT);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [highlightDraft, setHighlightDraft] = useState<string>("");
  const [status, setStatus] = useState<{ kind: "saved" | "error"; message: string } | null>(null);

  // Seed the draft once per trip, when the stored guide arrives.
  useEffect(() => {
    if (guideQuery.isSuccess && seededFor !== eventId) {
      const stored = tripGuideDraftFrom(guideQuery.data);
      setSaved(stored);
      setDraft(stored);
      setSeededFor(eventId);
    }
  }, [eventId, guideQuery.data, guideQuery.isSuccess, seededFor]);

  const problems = useMemo(() => tripGuideDraftProblems(draft), [draft]);
  const dirty = !sameDraft(draft, saved);
  const saving = saveMutation.isPending;
  const locked = disabled || saving;
  const canSave = dirty && problems.length === 0 && !locked;

  const update = (patch: Partial<TripGuideDraft>): void => {
    setStatus(null);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const addHighlight = (): void => {
    const value = highlightDraft.trim();
    if (value.length === 0 || draft.highlights.length >= TRIP_GUIDE_LIMITS.highlights) return;
    update({ highlights: [...draft.highlights, value.slice(0, TRIP_GUIDE_LIMITS.highlightLength)] });
    setHighlightDraft("");
  };

  const moveFaq = (index: number, by: -1 | 1): void => {
    const target = index + by;
    if (target < 0 || target >= draft.faqs.length) return;
    const faqs = [...draft.faqs];
    const [moved] = faqs.splice(index, 1);
    if (moved === undefined) return;
    faqs.splice(target, 0, moved);
    update({ faqs });
  };

  const save = (): void => {
    if (!canSave) return;
    saveMutation.mutate(
      { eventId, draft },
      {
        onSuccess: (stored) => {
          const next = tripGuideDraftFrom(stored);
          setSaved(next);
          setDraft(next);
          setStatus({ kind: "saved", message: "Trip guide saved." });
          onShowToast?.("Trip guide saved.");
        },
        onError: (error) => {
          const message = tripGuideSaveErrorMessage(error);
          setStatus({ kind: "error", message });
          onShowToast?.(message);
        },
      },
    );
  };

  if (guideQuery.isLoading) {
    return (
      <View style={styles.host} testID={testID}>
        <Text style={styles.title}>Before you go</Text>
        <View style={styles.loadingRow} testID={`${testID}-loading`}>
          <ActivityIndicator color={accent.warm} />
          <Text style={styles.helper}>Loading the trip guide…</Text>
        </View>
      </View>
    );
  }

  if (guideQuery.isError) {
    return (
      <View style={styles.host} testID={testID}>
        <Text style={styles.title}>Before you go</Text>
        <Text style={styles.errorText} testID={`${testID}-load-error`}>
          The trip guide could not be loaded. Check your connection and try again.
        </Text>
        <Pressable
          onPress={() => {
            void guideQuery.refetch();
          }}
          accessibilityRole="button"
          accessibilityLabel="Try loading the trip guide again"
          style={styles.secondaryBtn}
          testID={`${testID}-retry`}
        >
          <Text style={styles.secondaryBtnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.host} testID={testID}>
      <Text style={styles.title}>Before you go</Text>
      <Text style={styles.helper}>
        Optional. Each part shows on your trip page only once you fill it in.
      </Text>

      {/* Highlights */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>
          Highlights ({draft.highlights.length}/{TRIP_GUIDE_LIMITS.highlights})
        </Text>
        {draft.highlights.length === 0 ? (
          <Text style={styles.emptyText}>None added yet.</Text>
        ) : (
          draft.highlights.map((highlight, index) => (
            <View key={`highlight-${index}`} style={styles.itemRow}>
              <Icon name="sparkle" size={14} color={accent.warm} />
              <Text style={styles.itemText}>{highlight}</Text>
              <Pressable
                onPress={() => update({ highlights: draft.highlights.filter((_, i) => i !== index) })}
                disabled={locked}
                accessibilityRole="button"
                accessibilityLabel={`Remove highlight ${highlight}`}
                hitSlop={8}
                style={styles.iconBtn}
              >
                <Icon name="trash" size={14} color={textTokens.tertiary} />
              </Pressable>
            </View>
          ))
        )}
        <View style={styles.addRow}>
          <TextInput
            value={highlightDraft}
            onChangeText={setHighlightDraft}
            onSubmitEditing={addHighlight}
            placeholder="e.g. Sunrise hike to the crater rim"
            placeholderTextColor={textTokens.tertiary}
            maxLength={TRIP_GUIDE_LIMITS.highlightLength}
            editable={!locked && draft.highlights.length < TRIP_GUIDE_LIMITS.highlights}
            accessibilityLabel="Add a highlight"
            style={styles.input}
            returnKeyType="done"
            testID={`${testID}-highlight-input`}
          />
          <Pressable
            onPress={addHighlight}
            disabled={locked || highlightDraft.trim().length === 0 || draft.highlights.length >= TRIP_GUIDE_LIMITS.highlights}
            accessibilityRole="button"
            accessibilityLabel="Add highlight"
            style={[styles.addBtn, highlightDraft.trim().length === 0 ? styles.disabled : null]}
            testID={`${testID}-highlight-add`}
          >
            <Icon name="plus" size={16} color={accent.warm} />
          </Pressable>
        </View>
      </View>

      {/* What to prepare / Good to know */}
      {(
        [
          ["whatToPrepare", "What to prepare", "e.g. Pack reef-safe sunscreen and water shoes."],
          ["goodToKnow", "Good to know", "e.g. Cash is useful at the night market."],
        ] as const
      ).map(([key, label, placeholder]) => (
        <View key={key} style={styles.section}>
          <Text style={styles.sectionLabel}>{label}</Text>
          <TextInput
            value={draft[key]}
            onChangeText={(value) => update({ [key]: value } as Partial<TripGuideDraft>)}
            placeholder={placeholder}
            placeholderTextColor={textTokens.tertiary}
            maxLength={TRIP_GUIDE_LIMITS.textLength}
            editable={!locked}
            multiline
            accessibilityLabel={label}
            style={[styles.input, styles.multiline]}
            testID={`${testID}-${key}`}
          />
        </View>
      ))}

      {/* Questions */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>
          Questions ({draft.faqs.length}/{TRIP_GUIDE_LIMITS.faqs})
        </Text>
        {draft.faqs.length === 0 ? <Text style={styles.emptyText}>None added yet.</Text> : null}
        {draft.faqs.map((faq, index) => (
          <View key={`faq-${index}`} style={styles.faqCard} testID={`${testID}-faq-${index}`}>
            <TextInput
              value={faq.question}
              onChangeText={(question) =>
                update({ faqs: draft.faqs.map((row, i) => (i === index ? { ...row, question } : row)) })}
              placeholder="Question"
              placeholderTextColor={textTokens.tertiary}
              maxLength={TRIP_GUIDE_LIMITS.questionLength}
              editable={!locked}
              accessibilityLabel={`Question ${index + 1}`}
              style={styles.input}
            />
            <TextInput
              value={faq.answer}
              onChangeText={(answer) =>
                update({ faqs: draft.faqs.map((row, i) => (i === index ? { ...row, answer } : row)) })}
              placeholder="Answer"
              placeholderTextColor={textTokens.tertiary}
              maxLength={TRIP_GUIDE_LIMITS.answerLength}
              editable={!locked}
              multiline
              accessibilityLabel={`Answer ${index + 1}`}
              style={[styles.input, styles.multiline]}
            />
            <View style={styles.faqActions}>
              <Pressable
                onPress={() => moveFaq(index, -1)}
                disabled={locked || index === 0}
                accessibilityRole="button"
                accessibilityLabel={`Move question ${index + 1} up`}
                style={[styles.iconBtn, index === 0 ? styles.disabled : null]}
              >
                <Icon name="chevU" size={16} color={textTokens.secondary} />
              </Pressable>
              <Pressable
                onPress={() => moveFaq(index, 1)}
                disabled={locked || index === draft.faqs.length - 1}
                accessibilityRole="button"
                accessibilityLabel={`Move question ${index + 1} down`}
                style={[styles.iconBtn, index === draft.faqs.length - 1 ? styles.disabled : null]}
              >
                <Icon name="chevD" size={16} color={textTokens.secondary} />
              </Pressable>
              <Pressable
                onPress={() => update({ faqs: draft.faqs.filter((_, i) => i !== index) })}
                disabled={locked}
                accessibilityRole="button"
                accessibilityLabel={`Remove question ${index + 1}`}
                style={styles.iconBtn}
              >
                <Icon name="trash" size={16} color={textTokens.tertiary} />
              </Pressable>
            </View>
          </View>
        ))}
        <Pressable
          onPress={() => update({ faqs: [...draft.faqs, { question: "", answer: "" }] })}
          disabled={locked || draft.faqs.length >= TRIP_GUIDE_LIMITS.faqs}
          accessibilityRole="button"
          accessibilityLabel="Add a question"
          style={[styles.secondaryBtn, draft.faqs.length >= TRIP_GUIDE_LIMITS.faqs ? styles.disabled : null]}
          testID={`${testID}-faq-add`}
        >
          <Text style={styles.secondaryBtnText}>Add a question</Text>
        </Pressable>
      </View>

      {/* Group minimum + activity level */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Smallest group you run with</Text>
        <TextInput
          value={draft.groupMinimum}
          onChangeText={(groupMinimum) => update({ groupMinimum: groupMinimum.replace(/[^0-9]/g, "") })}
          placeholder="e.g. 6"
          placeholderTextColor={textTokens.tertiary}
          keyboardType="number-pad"
          maxLength={4}
          editable={!locked}
          accessibilityLabel="Group minimum"
          style={[styles.input, styles.shortInput]}
          testID={`${testID}-group-minimum`}
        />
      </View>
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>How active is it?</Text>
        <View style={styles.chipRow}>
          {TRIP_GUIDE_ACTIVITY_LEVELS.map((level) => {
            const selected = draft.activityLevel === level;
            return (
              <Pressable
                key={level}
                onPress={() => update({ activityLevel: selected ? null : level })}
                disabled={locked}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`${TRIP_GUIDE_ACTIVITY_LABEL[level]}${selected ? ", selected; tap to clear" : ""}`}
                style={[styles.chip, selected ? styles.chipSelected : null]}
                testID={`${testID}-activity-${level}`}
              >
                <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>
                  {TRIP_GUIDE_ACTIVITY_LABEL[level]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {problems.length > 0 ? (
        <View testID={`${testID}-problems`}>
          {problems.map((problem) => (
            <Text key={problem} style={styles.errorText}>{problem}</Text>
          ))}
        </View>
      ) : null}
      {status !== null ? (
        <Text
          style={status.kind === "error" ? styles.errorText : styles.savedText}
          accessibilityLiveRegion="polite"
          testID={`${testID}-status`}
        >
          {status.message}
        </Text>
      ) : null}
      <Pressable
        onPress={save}
        disabled={!canSave}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSave, busy: saving }}
        accessibilityLabel={saving ? "Saving the trip guide" : "Save the trip guide"}
        style={[styles.saveBtn, !canSave ? styles.disabled : null]}
        testID={`${testID}-save`}
      >
        {saving ? <ActivityIndicator color={textTokens.primary} /> : null}
        <Text style={styles.saveBtnText}>{saving ? "Saving…" : dirty ? "Save trip guide" : "Saved"}</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  host: { paddingTop: spacing.lg, paddingBottom: spacing.lg, gap: spacing.lg },
  title: {
    fontSize: typography.body.fontSize,
    fontWeight: "800",
    color: textTokens.primary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  section: { gap: spacing.sm },
  sectionLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: textTokens.secondary,
    textTransform: "uppercase",
  },
  emptyText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.tertiary,
    fontStyle: "italic",
  },
  itemRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingVertical: spacing.xs },
  itemText: { flex: 1, fontSize: typography.body.fontSize, color: textTokens.primary },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  addRow: { flexDirection: "row", gap: spacing.xs },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radiusTokens.md,
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  shortInput: { flex: 0, width: 120 },
  addBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(235, 120, 37, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.4)",
  },
  faqCard: {
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
  },
  faqActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.xs },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: INPUT_BORDER,
  },
  chipSelected: { borderColor: accent.warm, backgroundColor: "rgba(235, 120, 37, 0.12)" },
  chipText: { fontSize: typography.bodySm.fontSize, color: textTokens.secondary, fontWeight: "600" },
  chipTextSelected: { color: textTokens.primary },
  secondaryBtn: {
    alignSelf: "flex-start",
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.4)",
  },
  secondaryBtnText: { fontSize: typography.bodySm.fontSize, fontWeight: "700", color: accent.warm },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    minHeight: 48,
    borderRadius: radiusTokens.md,
    backgroundColor: accent.warm,
  },
  saveBtnText: { fontSize: typography.body.fontSize, fontWeight: "800", color: textTokens.primary },
  disabled: { opacity: 0.4 },
  errorText: { fontSize: typography.bodySm.fontSize, color: semantic.errorText },
  savedText: { fontSize: typography.bodySm.fontSize, color: textTokens.secondary },
});

export default TripGuideEditor;
