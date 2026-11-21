/**
 * #4522 — the traveler-question library. One tap adds a common question
 * (passport name, date of birth, nationality, dietary needs ...) to the
 * existing intake schema; the full form is still edited below through
 * IntakeSchemaBuilder / IntakeQuestionEditor. Nothing here renders a form to
 * buyers: checkout reads the same schema it always has (#4514 owns that).
 *
 * "Apply to all packages" writes the same question to every package's schema in
 * the same save (intake is per package: `step6Draft` is keyed by ticket type).
 * A package that is not saved yet has no ticket type id and appears once the
 * first save lands; the section says so rather than hiding the package.
 */

import React, { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../constants/designSystem";
import {
  bumpSchemaVersion,
  createBlankQuestion,
  createEmptyIntakeSchema,
  type IntakeSchema,
} from "../../services/intakeSchemaService";
import type { TripPricingTier } from "../../services/tripsService";
import { Switch } from "../ui/Switch";
import { TripBuilderChip } from "./TripBuilderChip";
import {
  MAX_INTAKE_QUESTIONS,
  TRAVELER_QUESTION_LIBRARY,
  addLibraryQuestion,
  libraryQuestionOn,
  removeLibraryQuestion,
} from "./tripBuilderV2Model";

export interface TripQuestionLibraryProps {
  /** The saved packages (each has a ticket type id). */
  tiers: ReadonlyArray<Pick<TripPricingTier, "ticketTypeId" | "tierName">>;
  /** Packages on screen that are not saved yet (shown as a note, not hidden). */
  unsavedPackageCount: number;
  schemasByTier: ReadonlyMap<string, IntakeSchema | null>;
  /** One schema write per package; null clears that package's form. */
  onSchemaChange: (ticketTypeId: string, next: IntakeSchema | null) => void;
  /** Tells the host why a tap did nothing (form full). */
  onNotice: (message: string) => void;
  disabled?: boolean;
}

export const QUESTION_LIBRARY_FULL_COPY = `A form holds up to ${MAX_INTAKE_QUESTIONS} questions. Remove one to add another.`;

export const TripQuestionLibrary: React.FC<TripQuestionLibraryProps> = ({
  tiers,
  unsavedPackageCount,
  schemasByTier,
  onSchemaChange,
  onNotice,
  disabled = false,
}) => {
  const multiple = tiers.length > 1;
  const [applyAll, setApplyAll] = useState<boolean>(true);
  const [targetId, setTargetId] = useState<string | null>(null);
  const targets = useMemo(() => {
    if (!multiple || applyAll) return tiers.map((t) => t.ticketTypeId);
    const chosen = tiers.find((t) => t.ticketTypeId === targetId) ?? tiers[0];
    return chosen === undefined ? [] : [chosen.ticketTypeId];
  }, [tiers, multiple, applyAll, targetId]);

  if (tiers.length === 0) {
    return (
      <Text style={styles.note} testID="trip-question-library-empty">
        Questions can be added once your first package is saved. It saves as you type.
      </Text>
    );
  }

  const isOn = (label: string): boolean =>
    targets.length > 0 &&
    targets.every((id) => libraryQuestionOn(schemasByTier.get(id) ?? null, label));

  const tap = (q: (typeof TRAVELER_QUESTION_LIBRARY)[number]): void => {
    if (isOn(q.label)) {
      for (const id of targets) {
        onSchemaChange(id, removeLibraryQuestion(schemasByTier.get(id) ?? null, q.label, bumpSchemaVersion));
      }
      return;
    }
    let full = false;
    for (const id of targets) {
      const next = addLibraryQuestion(schemasByTier.get(id) ?? null, q, {
        emptySchema: createEmptyIntakeSchema,
        makeId: () => createBlankQuestion(q.type, 0).id,
        bump: bumpSchemaVersion,
      });
      if (next === null) {
        // Already there on this package is fine; a full form is said out loud.
        if (!libraryQuestionOn(schemasByTier.get(id) ?? null, q.label)) full = true;
        continue;
      }
      onSchemaChange(id, next);
    }
    if (full) onNotice(QUESTION_LIBRARY_FULL_COPY);
  };

  return (
    <View style={styles.host} testID="trip-question-library">
      <Text style={styles.sub}>Tap a question to ask every traveler. Edit or add your own below.</Text>
      <View style={styles.row}>
        {TRAVELER_QUESTION_LIBRARY.map((q) => (
          <TripBuilderChip
            key={q.key}
            label={q.label}
            selected={isOn(q.label)}
            disabled={disabled}
            onPress={() => tap(q)}
            testID={`trip-question-chip-${q.key}`}
          />
        ))}
      </View>
      {multiple ? (
        <View style={styles.applyRow}>
          <View style={styles.applyText}>
            <Text style={styles.applyLabel}>Apply to all packages</Text>
            <Text style={styles.sub}>
              {applyAll ? "Each question goes on every package." : "Questions go on the package you pick."}
            </Text>
          </View>
          <Switch
            value={applyAll}
            onValueChange={setApplyAll}
            disabled={disabled}
            accessibilityLabel="Apply to all packages"
            testID="trip-question-apply-all"
          />
        </View>
      ) : null}
      {multiple && !applyAll ? (
        <View style={styles.row}>
          {tiers.map((t) => (
            <TripBuilderChip
              key={t.ticketTypeId}
              label={t.tierName}
              selected={targets[0] === t.ticketTypeId}
              disabled={disabled}
              onPress={() => setTargetId(t.ticketTypeId)}
              testID={`trip-question-target-${t.ticketTypeId}`}
            />
          ))}
        </View>
      ) : null}
      {unsavedPackageCount > 0 ? (
        <Text style={styles.note} testID="trip-question-unsaved-note">
          {unsavedPackageCount === 1
            ? "One package is still saving. It will show here once it has."
            : `${unsavedPackageCount} packages are still saving. They will show here once they have.`}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { gap: space[3] },
  row: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  sub: { fontSize: type.small.fontSize, lineHeight: type.small.lineHeight, color: color.text2 },
  note: { fontSize: type.small.fontSize, lineHeight: type.small.lineHeight, color: color.text2 },
  applyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
    minHeight: 56,
  },
  applyText: { flex: 1, gap: 2 },
  applyLabel: { fontSize: type.body.fontSize, lineHeight: type.body.lineHeight, color: color.text1 },
});
