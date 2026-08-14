import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  accent,
  semantic,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import { postHogService } from "../../services/postHogService";
import { formatRelativeTime } from "../../utils/relativeTime";
import { buildTurnoutGateRecommendations } from "../../utils/turnoutInput";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { IntelCard } from "./IntelCard";
import { IntelProgress } from "./IntelProgress";
import { useTurnoutIntel } from "./TurnoutIntelContext";

const blockCopy = (wizard: string, reason: string | null): string | null => {
  if (reason === "online_event") return null;
  if (reason === "unlimited_capacity")
    return wizard === "rsvp"
      ? "Turnout modeling needs a capacity — this RSVP is open-ended."
      : "Turnout modeling needs a capacity — this event has unlimited tickets.";
  const map: Record<string, string> = {
    missing_title: "Add a title to check turnout.",
    missing_category: "Add a category to check turnout.",
    missing_city: "Add a city to check turnout.",
    missing_date: "Add a date to check turnout.",
    invalid_date: "Choose a future date to check turnout.",
    missing_capacity: "Add a capacity to check turnout.",
  };
  return reason === null ? null : (map[reason] ?? null);
};

export const TurnoutGateSection: React.FC = () => {
  const intel = useTurnoutIntel();
  const shownKey = useRef<string | null | undefined>(undefined);
  const recommendations = useMemo(() => {
    if (intel === null) return [];
    return buildTurnoutGateRecommendations(
      intel.report,
      intel.input,
      intel.wizard,
    );
  }, [intel]);
  useEffect(() => {
    if (
      intel !== null &&
      intel.report !== null &&
      shownKey.current !== intel.inputKey
    ) {
      shownKey.current = intel.inputKey;
      postHogService.capture(
        "intel_gate_shown",
        intel.gateAnalyticsProps?.() ?? {
          wizard: intel.wizard,
          gate_state: intel.fresh ? "fresh" : "ran",
          estimate_used: false,
        },
      );
    }
  }, [intel]);
  if (intel === null || intel.blockReason === "online_event") return null;
  const blocked = blockCopy(intel.wizard, intel.blockReason);
  const blockedTarget =
    intel.blockReason === "missing_title" ||
    intel.blockReason === "missing_category"
      ? { step: 0, focus: "name" as const, label: "Review basics" }
      : intel.blockReason === "missing_city"
        ? { step: 2, focus: "city" as const, label: "Review location" }
        : intel.blockReason === "missing_date" ||
            intel.blockReason === "invalid_date"
          ? { step: 1, focus: "date" as const, label: "Review when" }
          : intel.blockReason === "missing_capacity" ||
              intel.blockReason === "unlimited_capacity"
            ? { step: 4, focus: "capacity" as const, label: "Review capacity" }
            : null;
  const forecast = intel.report?.forecast;
  const hasBand =
    typeof forecast?.total_low === "number" &&
    typeof forecast.total_high === "number" &&
    typeof forecast.capacity === "number";
  const benchmark = intel.report?.meta?.research_source === "fallback";
  const generatedAt = intel.report?.meta?.generated_at;
  const finiteBand = hasBand
    ? `${forecast.total_low}–${forecast.total_high} of ${forecast.capacity}`
    : "";
  return (
    <IntelCard
      testID="turnout-gate-section"
      accessibilityLabel="Pre-publish intelligence"
      style={styles.card}
    >
      <View style={styles.header}>
        <Icon name="sparkle" size={20} color={accent.warm} />
        <Text style={styles.eyebrow}>BEFORE YOU PUBLISH</Text>
      </View>
      {blocked !== null ? (
        <View style={styles.stack}>
          <Text style={styles.body}>{blocked}</Text>
          {blockedTarget !== null && intel.navigateTo !== undefined ? (
            <Button
              label={blockedTarget.label}
              variant="ghost"
              size="sm"
              onPress={() =>
                intel.navigateTo?.(blockedTarget.step, blockedTarget.focus)
              }
            />
          ) : null}
        </View>
      ) : intel.state === "running" || intel.state === "eligible" ? (
        <>
          <IntelProgress />
          <Text style={styles.note}>You can publish while this runs.</Text>
        </>
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
      ) : intel.state === "error-hidden" ? (
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
          <View style={styles.bandRow}>
            <Text style={styles.band} testID="turnout-gate-band">
              {finiteBand}
            </Text>
            <Text style={styles.modePill}>
              {benchmark ? "BENCHMARK" : "MODELED"}
            </Text>
          </View>
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
          {recommendations.map((row) => (
            <View
              key={row.id}
              style={styles.reco}
              accessible
              accessibilityLabel={`${row.severityWord}: ${row.copy}`}
            >
              <Text
                style={[
                  styles.severity,
                  row.severity === "warning"
                    ? styles.warning
                    : styles.info,
                ]}
              >
                {row.severity === "warning" ? "⚠" : "ⓘ"} {row.severityWord}
              </Text>
              <Text style={styles.body} numberOfLines={2}>
                {row.copy}
              </Text>
              {row.target !== null && intel.navigateTo !== undefined ? (
                <Button
                  label={row.target.label}
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    postHogService.capture("intel_reco_followed", {
                      ...(intel.gateAnalyticsProps?.() ?? {
                        wizard: intel.wizard,
                        gate_state: intel.fresh ? "fresh" : "ran",
                        estimate_used: false,
                      }),
                      door: "gate",
                      target_step: row.target?.step,
                    });
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
            onPress={() => intel.openReport(undefined, "gate")}
          />
          <Text style={styles.note}>Modeled range — not a promise.</Text>
        </View>
      ) : null}
    </IntelCard>
  );
};
const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  eyebrow: { ...typography.labelCap, color: text.secondary },
  stack: { gap: spacing.sm },
  reco: { gap: spacing.xs },
  truthRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  bandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  band: { ...typography.h2, color: text.primary, flex: 1 },
  modePill: { ...typography.micro, color: text.secondary },
  severity: { ...typography.caption, fontWeight: "700" },
  warning: { color: semantic.warning },
  info: { color: semantic.info },
  body: { ...typography.bodySm, color: text.primary },
  note: { ...typography.caption, color: text.tertiary },
});
export default TurnoutGateSection;
