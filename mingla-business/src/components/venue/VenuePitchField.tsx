/**
 * VenuePitchField — META-ORCH-1290 Leg B (D-3 + D-4).
 *
 * THE single home of "AI drafts your pitch, you edit it, you can redo it
 * anytime." One controlled component, three mount points: the folded create
 * wizard (s6), the claim wizard (c5 — via ClaimStepPitch), and the listing /
 * management page (§4.1). Replaces the two-field VenueStep6Description
 * (tagline + description → GONE) and the read-only listing pitch.
 *
 * DESIGN §3 states (fully honest — NO fabricated text ever shows):
 *   1 Empty     → "Draft with AI" (when AI is available) or a plain textarea.
 *   2 Drafting  → shimmer skeleton + rotating status; NEVER fake text.
 *   3 Drafted   → real draft + `AI DRAFT` chip + Regenerate + Clear.
 *   4 Edited    → chip drops on the first keystroke; Regenerate confirms first.
 *   5 Error     → non-blocking "write your own or try again".
 *   6 Disabled  → non-editable while saving/submitting.
 *
 * AI availability: generation runs a bio-DRAFT pipeline action that writes ONLY
 * the pitch draft (NO ai_signal_scores — D-2). In the WIZARD the venue row does
 * not exist yet, so `onGenerate` is omitted there (honest — no dead "Draft"
 * button pre-submit); the pitch is typed or left empty and AI-drafted later on
 * the listing page where the venue exists.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import {
  accent,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { ProvenanceChip } from "../ui/ProvenanceChip";
import { Skeleton } from "../ui/Skeleton";

// DESIGN §3.2 state 2 — rotating status while the AI drafts (cadence mirrors
// the deck-readiness loader). Real progress framing, never fake output.
const DRAFT_STAGES: readonly string[] = [
  "Reading your details…",
  "Finding your angle…",
  "Writing your pitch…",
];

export interface VenuePitchFieldProps {
  value: string;
  onChangeText: (t: string) => void;
  disabled?: boolean;
  /** Wizard/claim render the "Your pitch" title; the listing carries its own. */
  showTitle?: boolean;
  /** Step-validation error (wizard). */
  errorText?: string | null;
  placeholder?: string;
  a11yLabel?: string;
  helperOverride?: string;
  /** Claim provenance chip ("adopted"/"edited"); omitted on create + listing. */
  provenanceChip?: "adopted" | "edited" | null;
  /** Claim seeded-summary note + a "Start fresh" affordance. */
  seededNote?: boolean;
  onStartFresh?: () => void;
  /**
   * AI bio-draft. Returns the generated pitch text (writes NO scores). When
   * absent the AI affordance is HIDDEN (wizard pre-submit — no venue yet).
   */
  onGenerate?: () => Promise<string>;
  /** Listing Save. When present a Save button renders under the field. */
  onSave?: () => Promise<void>;
  saveDisabled?: boolean;
  savingLabel?: string;
  /** Listing live-venue re-score warning under Save (DESIGN §4.1 / OQ-6). */
  reScoreCaption?: string | null;
  testIDPrefix?: string;
}

export const VenuePitchField: React.FC<VenuePitchFieldProps> = ({
  value,
  onChangeText,
  disabled = false,
  showTitle = false,
  errorText = null,
  placeholder = "What makes your place worth the trip?",
  a11yLabel = "Venue pitch",
  helperOverride,
  provenanceChip = null,
  seededNote = false,
  onStartFresh,
  onGenerate,
  onSave,
  saveDisabled = false,
  savingLabel = "Saving…",
  reScoreCaption = null,
  testIDPrefix = "venue-pitch",
}) => {
  const [mode, setMode] = useState<"idle" | "drafting" | "error">("idle");
  const [lastDraft, setLastDraft] = useState<string | null>(null);
  const [stageIdx, setStageIdx] = useState(0);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [saving, setSaving] = useState(false);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Rotate the drafting status (state 2). Cleared on unmount / stop.
  useEffect(() => {
    if (mode !== "drafting") {
      if (stageTimer.current !== null) {
        clearInterval(stageTimer.current);
        stageTimer.current = null;
      }
      return;
    }
    setStageIdx(0);
    stageTimer.current = setInterval(() => {
      setStageIdx((i) => Math.min(i + 1, DRAFT_STAGES.length - 1));
    }, 2000);
    return (): void => {
      if (stageTimer.current !== null) {
        clearInterval(stageTimer.current);
        stageTimer.current = null;
      }
    };
  }, [mode]);

  const runDraft = useCallback(async (): Promise<void> => {
    if (onGenerate === undefined) return;
    setConfirmRegen(false);
    setMode("drafting");
    try {
      const drafted = await onGenerate();
      const text = drafted.trim();
      if (text.length === 0) {
        // No fabrication: an empty return is an honest error, not fake text.
        setMode("error");
        return;
      }
      setLastDraft(text);
      onChangeText(text);
      setMode("idle");
    } catch {
      setMode("error");
    }
  }, [onGenerate, onChangeText]);

  // DESIGN §3.4 — regenerate from an unedited draft fires immediately; from an
  // edited / owner-typed pitch it confirms first (protects the owner's words).
  const handleGeneratePress = useCallback((): void => {
    const trimmed = value.trim();
    const isUneditedDraft =
      lastDraft !== null && trimmed === lastDraft.trim();
    if (trimmed.length > 0 && !isUneditedDraft) {
      setConfirmRegen(true);
      return;
    }
    void runDraft();
  }, [value, lastDraft, runDraft]);

  const handleClear = useCallback((): void => {
    onChangeText("");
    setLastDraft(null);
    setMode("idle");
  }, [onChangeText]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (onSave === undefined) return;
    setSaving(true);
    try {
      await onSave();
    } finally {
      setSaving(false);
    }
  }, [onSave]);

  const handleChange = useCallback(
    (t: string): void => {
      if (mode === "error") setMode("idle");
      onChangeText(t);
    },
    [mode, onChangeText],
  );

  const trimmed = value.trim();
  const hasText = trimmed.length > 0;
  const isUneditedAiDraft =
    lastDraft !== null && hasText && trimmed === lastDraft.trim();

  // The label-row chip: claim provenance takes precedence; else the AI DRAFT
  // micro-chip while the text is byte-identical to the last AI draft (state 3).
  const showAiDraftChip =
    mode === "idle" && isUneditedAiDraft && provenanceChip === null;

  const helper =
    helperOverride ??
    (hasText
      ? "This is what people read on your card. Make it yours."
      : onGenerate !== undefined
        ? "Our AI writes a first draft from your details — website, photos, the lot. Edit it freely; honest beats fancy."
        : "Tell people what to expect — at least 20 characters, or leave it for now. Honest beats fancy.");

  const fieldA11y = isUneditedAiDraft
    ? `${a11yLabel}, AI first draft — edit to make it yours`
    : a11yLabel;

  return (
    <View style={styles.host}>
      {showTitle ? <Text style={styles.title}>Your pitch</Text> : null}

      {seededNote ? (
        <View style={styles.noteRow}>
          <Icon name="sparkle" size={14} color={accent.warm} />
          <Text style={styles.noteText}>
            We wrote a starting point from your listing — make it yours.
          </Text>
        </View>
      ) : null}

      <View style={styles.labelRow}>
        <Text style={styles.labelCap}>PITCH</Text>
        {provenanceChip !== null ? (
          <ProvenanceChip state={provenanceChip} />
        ) : showAiDraftChip ? (
          <View
            style={styles.aiChip}
            accessible={false}
            testID={`${testIDPrefix}-ai-chip`}
          >
            <Text style={styles.aiChipText} numberOfLines={1}>
              AI DRAFT
            </Text>
          </View>
        ) : null}
      </View>

      {mode === "drafting" ? (
        <View style={styles.draftingBox} accessibilityLabel="Drafting your pitch">
          <Skeleton width="100%" height={16} radius="sm" />
          <Skeleton width="92%" height={16} radius="sm" />
          <Skeleton width="64%" height={16} radius="sm" />
          <Text style={styles.draftingStatus} accessibilityLiveRegion="polite">
            {DRAFT_STAGES[stageIdx]}
          </Text>
        </View>
      ) : (
        <TextInput
          value={value}
          onChangeText={handleChange}
          placeholder={placeholder}
          placeholderTextColor={textTokens.tertiary}
          multiline
          editable={!disabled && !saving}
          textAlignVertical="top"
          accessibilityLabel={fieldA11y}
          style={[styles.area, (disabled || saving) && styles.areaDisabled]}
          testID={`${testIDPrefix}-input`}
        />
      )}

      {/* Regenerate confirm (state 4 / listing) */}
      {confirmRegen ? (
        <View style={styles.confirmRow}>
          <Text style={styles.confirmText}>
            Replace your pitch with a fresh AI draft?
          </Text>
          <View style={styles.confirmBtns}>
            <Button
              label="Keep mine"
              variant="ghost"
              size="sm"
              onPress={() => setConfirmRegen(false)}
            />
            <Button
              label="Regenerate"
              variant="primary"
              size="sm"
              onPress={() => void runDraft()}
            />
          </View>
        </View>
      ) : onGenerate !== undefined ? (
        <View style={styles.actionRow}>
          {mode === "error" ? (
            <Button
              label="Try again"
              variant="secondary"
              size="sm"
              leadingIcon="sparkle"
              disabled={disabled}
              onPress={() => void runDraft()}
              testID={`${testIDPrefix}-retry`}
            />
          ) : !hasText ? (
            <Button
              label="Draft with AI"
              variant="secondary"
              size="md"
              leadingIcon="sparkle"
              loading={mode === "drafting"}
              disabled={disabled || mode === "drafting"}
              onPress={handleGeneratePress}
              testID={`${testIDPrefix}-draft`}
            />
          ) : (
            <>
              <Button
                label="Regenerate"
                variant="secondary"
                size="sm"
                leadingIcon="sparkle"
                loading={mode === "drafting"}
                disabled={disabled || mode === "drafting"}
                onPress={handleGeneratePress}
                testID={`${testIDPrefix}-regen`}
              />
              <Button
                label="Clear"
                variant="ghost"
                size="sm"
                disabled={disabled || mode === "drafting"}
                onPress={handleClear}
                testID={`${testIDPrefix}-clear`}
              />
            </>
          )}
        </View>
      ) : null}

      {/* Claim "Start fresh" (seeded generative summary) */}
      {onGenerate === undefined && seededNote && hasText && onStartFresh ? (
        <View style={styles.freshRow}>
          <Button
            label="Start fresh"
            variant="ghost"
            size="sm"
            onPress={onStartFresh}
            testID="claim-pitch-start-fresh"
          />
        </View>
      ) : null}

      {mode === "error" ? (
        <Text style={styles.warn}>
          Couldn&apos;t draft that just now — write your own or try again.
        </Text>
      ) : (
        <Text style={styles.helper}>{helper}</Text>
      )}

      {errorText !== null && errorText !== undefined ? (
        <Text style={styles.err}>{errorText}</Text>
      ) : null}

      {/* Listing Save */}
      {onSave !== undefined ? (
        <View style={styles.saveBlock}>
          <Button
            label={saving ? savingLabel : "Save"}
            variant="primary"
            size="sm"
            loading={saving}
            disabled={disabled || saving || saveDisabled || mode === "drafting"}
            onPress={() => void handleSave()}
            testID={`${testIDPrefix}-save`}
          />
          {reScoreCaption !== null ? (
            <Text style={styles.reScore}>{reScoreCaption}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.md,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  noteText: {
    flex: 1,
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  labelCap: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  aiChip: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    backgroundColor: accent.tint,
  },
  aiChipText: {
    fontSize: typography.micro.fontSize,
    lineHeight: typography.micro.lineHeight,
    fontWeight: "600",
    letterSpacing: 0.4,
    color: accent.warm,
  },
  area: {
    minHeight: 150,
    padding: spacing.md,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.18)",
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  areaDisabled: {
    opacity: 0.6,
  },
  draftingBox: {
    minHeight: 150,
    padding: spacing.md,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.18)",
    gap: spacing.sm,
  },
  draftingStatus: {
    marginTop: spacing.xs,
    textAlign: "center",
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    flexWrap: "wrap",
  },
  freshRow: {
    alignItems: "flex-start",
  },
  confirmRow: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  confirmText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.primary,
  },
  confirmBtns: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
  },
  helper: {
    fontSize: typography.caption.fontSize,
    lineHeight: 17,
    color: textTokens.tertiary,
  },
  warn: {
    fontSize: typography.caption.fontSize,
    lineHeight: 17,
    color: semantic.warning,
  },
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
  saveBlock: {
    gap: spacing.xs,
    alignItems: "flex-start",
  },
  reScore: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
});

export default VenuePitchField;
