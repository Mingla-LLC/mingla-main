/**
 * Wizard Step 1 — Basics.
 *
 * Designer source: screens-creator.jsx lines 82-104 (CreatorStep1) +
 * operator Figma 2026-05-13 for Party Type / Vibes / Music Genre pills.
 * PRD U.5.1 required fields surfaced here: name, description, party type.
 * Format chip (in_person / online / hybrid) is also captured here so
 * Step 3 (Where) can branch its render without re-asking.
 *
 * Per ORCH-0824 (2026-05-13):
 *   - The legacy single-select Category sheet was REMOVED. The new
 *     taxonomy is three multi-select pill groups: Party Type (required,
 *     ≥1), Vibe Tags (optional), Music Genre (optional). Canonical
 *     slug lists live in `src/constants/eventTaxonomy.ts` (parity-locked
 *     with the consumer + edge function copies).
 *   - Render order on Step 1: Name → Format → Party Type → Vibe Tags →
 *     Music Genre → Description.
 *
 * ORCH-0823 (preserved 2026-05-13 by ORCH-0824 implementor): the
 * Description TextInput keeps `autoCorrect={false}` + `autoCapitalize="none"`
 * to eliminate iOS hardware-capslock + sentences-mode space-erasure
 * (Path A) and autocorrect near-miss substitutions (Path B). See
 * Mingla_Artifacts/reports/QA_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH_REPORT.md.
 */

import React, { useCallback } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { DraftEventFormat } from "../../store/draftEventStore";
import {
  PARTY_TYPES,
  VIBE_TAGS,
  MUSIC_GENRES,
} from "../../constants/eventTaxonomy";

import { GlassCard } from "../ui/GlassCard";
import { Input } from "../ui/Input";

import { errorForKey, type StepBodyProps } from "./types";

const FORMAT_OPTIONS: ReadonlyArray<{ id: DraftEventFormat; label: string }> = [
  { id: "in_person", label: "In person" },
  { id: "online", label: "Online" },
  { id: "hybrid", label: "Hybrid" },
];

interface FormatPillProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

const FormatPill: React.FC<FormatPillProps> = ({ label, active, onPress }) => (
  <Pressable
    onPress={onPress}
    accessibilityRole="button"
    accessibilityState={{ selected: active }}
    accessibilityLabel={label}
    style={[styles.formatPill, active && styles.formatPillActive]}
  >
    <Text style={[styles.formatPillLabel, active && styles.formatPillLabelActive]}>
      {label}
    </Text>
  </Pressable>
);

/**
 * Multi-select pill used for Party Type, Vibe Tag, and Music Genre grids.
 * `emoji` is optional; when provided it renders inline before the label
 * (used by Vibe Tags per operator Figma 2026-05-13).
 */
interface TaxonomyPillProps {
  slug: string;
  label: string;
  emoji?: string;
  selected: boolean;
  onToggle: (slug: string) => void;
}

const TaxonomyPill: React.FC<TaxonomyPillProps> = ({
  slug,
  label,
  emoji,
  selected,
  onToggle,
}) => (
  <Pressable
    onPress={() => onToggle(slug)}
    accessibilityRole="button"
    accessibilityState={{ selected }}
    accessibilityLabel={label}
    style={[styles.taxonomyPill, selected && styles.taxonomyPillActive]}
  >
    {emoji !== undefined ? (
      <Text style={styles.taxonomyPillEmoji}>{emoji}</Text>
    ) : null}
    <Text
      style={[
        styles.taxonomyPillLabel,
        selected && styles.taxonomyPillLabelActive,
      ]}
    >
      {label}
    </Text>
  </Pressable>
);

const toggleInArray = (arr: string[], slug: string): string[] =>
  arr.includes(slug) ? arr.filter((s) => s !== slug) : [...arr, slug];

export const CreatorStep1Basics: React.FC<StepBodyProps> = ({
  draft,
  updateDraft,
  errors,
  showErrors,
}) => {
  const nameError = showErrors ? errorForKey(errors, "name") : undefined;
  const descError = showErrors ? errorForKey(errors, "description") : undefined;
  const partyTypesError = showErrors
    ? errorForKey(errors, "partyTypes")
    : undefined;
  const vibeTagsError = showErrors ? errorForKey(errors, "vibeTags") : undefined;
  const musicGenresError = showErrors
    ? errorForKey(errors, "musicGenres")
    : undefined;

  const handleSelectFormat = useCallback(
    (format: DraftEventFormat): void => {
      updateDraft({ format });
    },
    [updateDraft],
  );

  const handleTogglePartyType = useCallback(
    (slug: string): void => {
      updateDraft({ partyTypes: toggleInArray(draft.partyTypes, slug) });
    },
    [draft.partyTypes, updateDraft],
  );

  const handleToggleVibeTag = useCallback(
    (slug: string): void => {
      updateDraft({ vibeTags: toggleInArray(draft.vibeTags, slug) });
    },
    [draft.vibeTags, updateDraft],
  );

  const handleToggleMusicGenre = useCallback(
    (slug: string): void => {
      updateDraft({ musicGenres: toggleInArray(draft.musicGenres, slug) });
    },
    [draft.musicGenres, updateDraft],
  );

  return (
    <View>
      {/* Event name */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Event name</Text>
        <Input
          value={draft.name}
          onChangeText={(v) => updateDraft({ name: v })}
          placeholder="e.g. Slow Burn vol. 4"
          variant="text"
          accessibilityLabel="Event name"
          style={nameError !== undefined ? styles.inputError : undefined}
        />
        {nameError !== undefined ? (
          <Text style={styles.helperError}>{nameError}</Text>
        ) : null}
      </View>

      {/* Format */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Format</Text>
        <View style={styles.formatRow}>
          {FORMAT_OPTIONS.map((opt) => (
            <FormatPill
              key={opt.id}
              label={opt.label}
              active={draft.format === opt.id}
              onPress={() => handleSelectFormat(opt.id)}
            />
          ))}
        </View>
      </View>

      {/* Party Type — required, multi-select */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Party Type *</Text>
        <View style={styles.taxonomyGrid}>
          {PARTY_TYPES.map((opt) => (
            <TaxonomyPill
              key={opt.slug}
              slug={opt.slug}
              label={opt.label}
              selected={draft.partyTypes.includes(opt.slug)}
              onToggle={handleTogglePartyType}
            />
          ))}
        </View>
        {partyTypesError !== undefined ? (
          <Text style={styles.helperError}>{partyTypesError}</Text>
        ) : null}
      </View>

      {/* Vibe Tags — optional, multi-select */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Vibe Tags (Select all that apply)</Text>
        <View style={styles.taxonomyGrid}>
          {VIBE_TAGS.map((opt) => (
            <TaxonomyPill
              key={opt.slug}
              slug={opt.slug}
              label={opt.label}
              emoji={opt.emoji}
              selected={draft.vibeTags.includes(opt.slug)}
              onToggle={handleToggleVibeTag}
            />
          ))}
        </View>
        {vibeTagsError !== undefined ? (
          <Text style={styles.helperError}>{vibeTagsError}</Text>
        ) : null}
      </View>

      {/* Music Genre — optional, multi-select */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>
          Music Genre (Select all that will be played)
        </Text>
        <View style={styles.taxonomyGrid}>
          {MUSIC_GENRES.map((opt) => (
            <TaxonomyPill
              key={opt.slug}
              slug={opt.slug}
              label={opt.label}
              selected={draft.musicGenres.includes(opt.slug)}
              onToggle={handleToggleMusicGenre}
            />
          ))}
        </View>
        {musicGenresError !== undefined ? (
          <Text style={styles.helperError}>{musicGenresError}</Text>
        ) : null}
      </View>

      {/* Description */}
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Description</Text>
        <View
          style={[
            styles.textareaWrap,
            descError !== undefined && styles.inputError,
          ]}
        >
          <TextInput
            value={draft.description}
            onChangeText={(v) => updateDraft({ description: v })}
            placeholder="What's the vibe? Doors, dress code, sound system, who it's for…"
            placeholderTextColor={textTokens.quaternary}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            // ORCH-0823 v2: explicit autoCorrect={false} eliminates iOS
            // autocorrect near-miss substitutions ("Big P" → "Bigot" — Path B).
            // autoCapitalize="none" eliminates the iOS hardware-capslock +
            // sentences-mode space-erasure (Path A) discovered during patched
            // QA — see Mingla_Artifacts/reports/QA_ORCH-0823_EVENT_WIZARD_SPACE_CAPSLOCK_GLITCH_REPORT.md.
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.textarea}
            accessibilityLabel="Event description"
          />
        </View>
        {descError !== undefined ? (
          <Text style={styles.helperError}>{descError}</Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "500",
    color: textTokens.secondary,
    marginBottom: spacing.xs,
  },
  helperError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xs,
  },
  inputError: {
    borderColor: semantic.error,
    borderWidth: 1,
  },
  formatRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  formatPill: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    alignItems: "center",
  },
  formatPillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  formatPillLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "500",
    color: textTokens.primary,
  },
  formatPillLabelActive: {
    color: textTokens.primary,
  },
  textareaWrap: {
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 110,
  },
  textarea: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    minHeight: 90,
    padding: 0,
  },

  // ORCH-0824 multi-select pill grid (Party Type / Vibe Tags / Music Genre)
  taxonomyGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  taxonomyPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  taxonomyPillActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  taxonomyPillEmoji: {
    fontSize: typography.bodySm.fontSize,
    marginRight: 6,
  },
  taxonomyPillLabel: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "500",
    color: textTokens.primary,
  },
  taxonomyPillLabelActive: {
    color: textTokens.primary,
    fontWeight: "600",
  },
});

// Suppress unused-import warning for GlassCard (not used in v1 but kept
// available for future variants). NB: tsc strict still requires an import
// to be used; remove if linter flags.
void GlassCard;
