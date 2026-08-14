import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  accent,
  glass,
  radius,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { IntelProgress } from "./IntelProgress";
import { useTurnoutIntel } from "./TurnoutIntelContext";

export interface PrePublishGateSheetProps {
  visible: boolean;
  onClose: () => void;
  onPublish: () => void;
  onEstimate: (value: number | null) => void;
  estimate: number | null;
}

export const PrePublishGateSheet: React.FC<PrePublishGateSheetProps> = ({
  visible,
  onClose,
  onPublish,
  onEstimate,
  estimate,
}) => {
  const intel = useTurnoutIntel();
  const [custom, setCustom] = useState("");
  if (intel === null) return null;
  const forecast = intel.report?.forecast;
  const hasBand =
    typeof forecast?.total_low === "number" &&
    typeof forecast.total_high === "number";
  const unlimited = intel.blockReason === "unlimited_capacity";
  const blockedTarget =
    intel.blockReason === "missing_title" ||
    intel.blockReason === "missing_category"
      ? {
          step: 0,
          focus: "name" as const,
          label: "Review identity",
          copy: "Add a title and vibe to check turnout.",
        }
      : intel.blockReason === "missing_city"
        ? {
            step: 1,
            focus: "city" as const,
            label: "Review stops",
            copy: "Add a city to check turnout.",
          }
        : intel.blockReason === "missing_date" ||
            intel.blockReason === "invalid_date"
          ? {
              step: 2,
              focus: "date" as const,
              label: "Review when",
              copy: "Add a future date to check turnout.",
            }
          : intel.blockReason === "missing_capacity"
            ? {
                step: 3,
                focus: "capacity" as const,
                label: "Review pricing",
                copy: "Add a capacity to check turnout.",
              }
            : null;
  const failure = intel.state === "error-hidden";
  const context =
    estimate === null
      ? undefined
      : `Modeled on your estimate of ~${estimate} spots`;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      snapPoint="full"
      testID="experience-prepublish-intelligence"
    >
      <View style={styles.root}>
        <Text style={styles.eyebrow}>MINGLA INTELLIGENCE</Text>
        <Text style={styles.title}>A quick turnout read</Text>
        {unlimited ? (
          <View style={styles.stack}>
            <Text style={styles.body}>About how many people could join?</Text>
            <View style={styles.chips}>
              {[10, 25, 50, 100].map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`Estimate ${value} spots`}
                  onPress={() => onEstimate(value)}
                  style={[
                    styles.chip,
                    estimate === value ? styles.chipActive : null,
                  ]}
                >
                  <Text style={styles.chipText}>{value}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={custom}
              onChangeText={setCustom}
              keyboardType="number-pad"
              placeholder="Custom headcount"
              placeholderTextColor={text.quaternary}
              accessibilityLabel="Custom estimated headcount"
              style={styles.input}
            />
            <Button
              label="Use custom estimate"
              variant="secondary"
              size="md"
              disabled={!Number.isInteger(Number(custom)) || Number(custom) < 1}
              onPress={() => onEstimate(Number(custom))}
            />
            <Button
              label="Skip estimate"
              variant="ghost"
              size="sm"
              onPress={() => onEstimate(null)}
            />
            <Text style={styles.note}>
              Turnout modeling needs a rough headcount — skipped.
            </Text>
          </View>
        ) : blockedTarget !== null ? (
          <View style={styles.stack}>
            <Text style={styles.body}>{blockedTarget.copy}</Text>
            <Button
              label={blockedTarget.label}
              variant="secondary"
              size="md"
              onPress={() => {
                onClose();
                intel.navigateTo?.(blockedTarget.step, blockedTarget.focus);
              }}
            />
          </View>
        ) : intel.state === "running" || intel.state === "eligible" ? (
          <View style={styles.stack}>
            <IntelProgress />
            <Text style={styles.body}>
              {"It'll keep working — publish whenever you're ready"}
            </Text>
          </View>
        ) : intel.state === "offline" ? (
          <Text style={styles.body}>
            {"You're offline — publish works; checks need a connection."}
          </Text>
        ) : intel.state === "rate_limited" ? (
          <Text style={styles.body}>
            {
              "You've used today's checks — they refresh tomorrow. You can publish anyway."
            }
          </Text>
        ) : failure ? (
          <View style={styles.stack}>
            <Text style={styles.body}>
              {"That check didn't finish — you can publish anyway."}
            </Text>
            {intel.gateFailureCount < 2 ? (
              <Button
                label="Try again"
                variant="secondary"
                size="md"
                onPress={() => intel.run("gate")}
              />
            ) : null}
          </View>
        ) : hasBand ? (
          <View style={styles.stack}>
            <Text style={styles.band}>
              ~{forecast?.total_low}–{forecast?.total_high} people expected
            </Text>
            {context !== undefined ? (
              <Text style={styles.note}>{context}</Text>
            ) : null}
            <Button
              label="See full forecast"
              variant="ghost"
              size="sm"
              onPress={() => {
                onClose();
                requestAnimationFrame(() => intel.openReport(context, "gate"));
              }}
            />
          </View>
        ) : (
          <Text style={styles.body}>Check first (~30s), or publish now.</Text>
        )}
        <View style={styles.actions}>
          {blockedTarget === null ? (
            <Button
              label="Check first (~30s)"
              variant="secondary"
              size="lg"
              onPress={() => intel.run("gate")}
              disabled={unlimited && estimate === null}
              style={styles.action}
            />
          ) : null}
          <Button
            label="Publish now"
            variant="primary"
            size="lg"
            onPress={onPublish}
            style={styles.action}
          />
        </View>
      </View>
    </Sheet>
  );
};
const styles = StyleSheet.create({
  root: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  eyebrow: { ...typography.labelCap, color: text.tertiary },
  title: { ...typography.h2, color: text.primary },
  body: { ...typography.body, color: text.primary },
  note: { ...typography.caption, color: text.tertiary },
  band: { ...typography.h2, color: text.primary },
  stack: { gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    minWidth: 52,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
  },
  chipActive: { borderColor: accent.warm, backgroundColor: accent.tint },
  chipText: { ...typography.bodySm, color: text.primary },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    color: text.primary,
    paddingHorizontal: spacing.md,
  },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
});
export default PrePublishGateSheet;
