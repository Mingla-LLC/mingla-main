import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import { postHogService } from "../../services/postHogService";
import { formatRelativeTime } from "../../utils/relativeTime";
import { buildTurnoutGateRecommendations } from "../../utils/turnoutInput";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { IntelProgress } from "./IntelProgress";
import { useTurnoutIntel } from "./TurnoutIntelContext";

export interface PrePublishGateSheetProps {
  visible: boolean;
  onClose: () => void;
  onPublish: () => void;
  /** Legacy test-only shape; provider session remains the production owner. */
  estimate?: number | null;
  onEstimate?: (value: number | null) => void;
}

export const PrePublishGateSheet: React.FC<PrePublishGateSheetProps> = ({
  visible,
  onClose,
  onPublish,
}) => {
  const intel = useTurnoutIntel();
  const [custom, setCustom] = useState("");
  if (intel === null) return null;
  const estimateState = intel.estimate ?? { kind: "unanswered" as const };
  const forecast = intel.report?.forecast;
  const hasBand =
    typeof forecast?.total_low === "number" &&
    typeof forecast.total_high === "number" &&
    typeof forecast.capacity === "number";
  const demandRead =
    intel.estimateApplied === true && estimateState.kind === "answered";
  const unlimited =
    intel.blockReason === "unlimited_capacity" && !demandRead;
  const recommendations = buildTurnoutGateRecommendations(
    intel.report,
    intel.input,
    intel.wizard,
  );
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
  const context = demandRead
    ? `Modeled on your estimate of ~${estimateState.value} spots`
    : undefined;
  const benchmark = intel.report?.meta?.research_source === "fallback";
  const generatedAt = intel.report?.meta?.generated_at;
  const finiteBand = hasBand
    ? `${forecast.total_low}–${forecast.total_high} of ${forecast.capacity}`
    : "";
  const demandBand = hasBand
    ? `~${forecast.total_low}–${forecast.total_high} people expected`
    : "";
  const showCheckFirst =
    intel.state === "eligible" &&
    intel.gateFailureCount === 0 &&
    !unlimited &&
    blockedTarget === null;
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
        {unlimited && estimateState.kind === "unanswered" ? (
          <View style={styles.stack}>
            <Text style={styles.body}>About how many people could join?</Text>
            <View style={styles.chips}>
              {[10, 25, 50, 100].map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`Estimate ${value} spots`}
                  onPress={() => intel.setEstimate(value)}
                  style={[
                    styles.chip,
                    false,
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
              onPress={() => intel.setEstimate(Number(custom))}
            />
            <Button
              label="Skip estimate"
              variant="ghost"
              size="sm"
              onPress={intel.skipEstimate}
            />
          </View>
        ) : unlimited && estimateState.kind === "skipped" ? (
          <Text style={styles.body}>
            Turnout modeling needs a rough headcount — skipped.
          </Text>
        ) : demandRead && intel.blockReason === "unlimited_capacity" ? (
          <View style={styles.stack}>
            <IntelProgress />
            <Text style={styles.body}>Checking your estimated headcount…</Text>
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
        ) : intel.state === "running" ? (
          <View style={styles.stack}>
            <IntelProgress />
            <Text style={styles.body}>
              {"It'll keep working — publish whenever you're ready"}
            </Text>
          </View>
        ) : intel.state === "eligible" ? (
          <Text style={styles.body}>
            Check turnout now, or publish without waiting.
          </Text>
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
            {demandRead ? (
              <View style={styles.bandRow}>
                <Text style={styles.band}>{demandBand}</Text>
                <Text
                  style={styles.modePill}
                  testID="experience-demand-model-pill"
                >
                  MODELED · your estimate of ~{estimateState.value}
                </Text>
              </View>
            ) : (
              <View style={styles.bandRow}>
                <Text style={styles.band} testID="experience-gate-band">
                  {finiteBand}
                </Text>
                <Text style={styles.modePill}>
                  {benchmark ? "BENCHMARK" : "MODELED"}
                </Text>
              </View>
            )}
            {context !== undefined ? (
              <Text style={styles.note}>{context}</Text>
            ) : null}
            <View style={styles.truthRow}>
              {forecast.confidence !== undefined ? (
                <Text style={styles.note}>{forecast.confidence} confidence</Text>
              ) : null}
              {generatedAt !== undefined ? (
                <Text style={styles.note}>
                  Checked {formatRelativeTime(generatedAt)}
                </Text>
              ) : null}
            </View>
            {intel.sessionHonesty != null ? (
              <Text style={styles.note}>{intel.sessionHonesty}</Text>
            ) : null}
            {demandRead && intel.report?.demand_read !== undefined ? (
              <Text style={styles.body}>{intel.report.demand_read}</Text>
            ) : null}
            {recommendations.map((row) => (
              <View
                key={row.id}
                style={styles.reco}
                testID={`experience-gate-reco-${row.id}`}
              >
                <View
                  accessible
                  accessibilityLabel={`${row.severityWord}: ${row.copy}`}
                  testID={`experience-gate-reco-${row.id}-copy`}
                >
                  <Text
                    style={[
                      styles.severity,
                      row.severity === "warning"
                        ? styles.warning
                        : styles.info,
                    ]}
                  >
                    {row.severity === "warning" ? "⚠" : "ⓘ"}{" "}
                    {row.severityWord}
                  </Text>
                  <Text style={styles.body} numberOfLines={2}>
                    {row.copy}
                  </Text>
                </View>
                {row.target !== null && intel.navigateTo !== undefined ? (
                  <Button
                    label={row.target.label}
                    variant="ghost"
                    size="sm"
                    onPress={() => {
                      postHogService.capture("intel_reco_followed", {
                        ...(intel.gateAnalyticsProps?.(demandRead) ?? {
                          wizard: intel.wizard,
                          gate_state: demandRead ? "demand_read" : "ran",
                          estimate_used: demandRead,
                        }),
                        door: "gate",
                        target_step: row.target?.step,
                      });
                      onClose();
                      intel.navigateTo?.(row.target!.step, row.target!.focus);
                    }}
                  />
                ) : null}
              </View>
            ))}
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
        ) : showCheckFirst ? (
          <Text style={styles.body}>Check first (~30s), or publish now.</Text>
        ) : null}
        <View style={styles.actions}>
          {showCheckFirst ? (
            <Button
              label="Check first (~30s)"
              variant="secondary"
              size="lg"
              onPress={() => intel.run("gate")}
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
  reco: { gap: spacing.xs },
  truthRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  bandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  modePill: { ...typography.micro, color: text.secondary },
  severity: { ...typography.caption, fontWeight: "700" },
  warning: { color: semantic.warning },
  info: { color: semantic.info },
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
