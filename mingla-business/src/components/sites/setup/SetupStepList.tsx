import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { radius, websiteRailActive } from "../../../constants/designSystem";
import { setupStepChip, setupStepMark, type SetupStep } from "../../../sites/setupStatus";
import { CheckCircle, ui } from "../website/ui";
import type { PlanPartKey } from "../../../../../packages/site-contracts/src/sitePlan.ts";

/** A tick means nothing required is open; anything else is a ring (design "status"). */
export function SetupMark({ step }: { step: SetupStep }): React.ReactElement {
  const mark = setupStepMark(step.status);
  if (mark === "tick") return <CheckCircle state="on" />;
  return <View style={[markStyles.ring, mark === "ring_now" ? markStyles.ringNow : null]} />;
}

/** The rail (wide), and the list inside "Show all steps" (phone). */
export function SetupStepList({ steps, active, canManage, published, onSelect }: {
  steps: readonly SetupStep[];
  active: PlanPartKey;
  canManage: boolean;
  published: boolean;
  onSelect: (key: PlanPartKey) => void;
}): React.ReactElement {
  return (
    <View role="navigation" accessibilityLabel="Setup steps" aria-label="Setup steps" testID="setup-steps">
      {steps.map((step) => {
        const on = step.key === active;
        const chip = setupStepChip(step.status);
        const needsAdmin = !canManage && step.ownerOnly && step.status.kind !== "done";
        const meta = published ? "Review" : needsAdmin ? "Admin" : step.status.kind === "done" ? null : chip;
        return (
          <Pressable
            key={step.key}
            onPress={() => onSelect(step.key)}
            role="link"
            accessibilityRole="link"
            aria-current={on ? "step" : undefined}
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${step.label}${chip ? `, ${chip}` : ""}${needsAdmin ? ", needs a brand admin" : ""}`}
            testID={`setup-step-${step.key}`}
            style={[styles.row, on ? styles.rowOn : null]}
          >
            <SetupMark step={step} />
            <Text style={[styles.label, on ? styles.labelOn : null]} numberOfLines={2}>{step.label}</Text>
            {meta ? (
              <Text style={[styles.meta, step.status.kind === "failed" ? styles.metaErr : null]} testID={`setup-step-${step.key}-meta`}>{meta}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const markStyles = StyleSheet.create({
  ring: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: "rgba(255, 255, 255, 0.35)" },
  ringNow: { borderColor: ui.accent },
});

const styles = StyleSheet.create({
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8, borderRadius: radius.md, marginBottom: 2 },
  rowOn: { backgroundColor: websiteRailActive },
  label: { flex: 1, fontSize: 13, lineHeight: 18, color: ui.t2 },
  labelOn: { color: ui.t1, fontWeight: "600" },
  meta: { fontSize: 12, color: "#fcd27a" },
  metaErr: { color: ui.err },
});
