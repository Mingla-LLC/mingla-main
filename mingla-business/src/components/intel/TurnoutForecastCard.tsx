import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import type { TurnoutSurface } from "../../hooks/useTurnoutForecast";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { IntelBandStat } from "./IntelBandStat";
import { IntelCard } from "./IntelCard";
import { IntelDriverChip } from "./IntelDriverChip";
import { IntelProgress, INTEL_RESULT_MIN_HEIGHT } from "./IntelProgress";
import { useTurnoutIntel } from "./TurnoutIntelProvider";
import { buildTurnoutDrivers, type TurnoutDriver } from "./turnoutDrivers";

export interface TurnoutForecastCardProps {
  surface: TurnoutSurface;
}

export const TurnoutForecastCard: React.FC<TurnoutForecastCardProps> = () => {
  const intel = useTurnoutIntel();
  const [expandedDriver, setExpandedDriver] = useState<string | null>(null);
  const entry = useRef(new Animated.Value(0)).current;
  const resultFade = useRef(new Animated.Value(0)).current;
  const report = intel?.report ?? null;
  const drivers = useMemo<TurnoutDriver[]>(
    () => buildTurnoutDrivers(report),
    [report],
  );

  useEffect(() => {
    Animated.timing(entry, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entry]);

  useEffect(() => {
    if (intel?.state !== "result" && intel?.state !== "stale") return;
    resultFade.setValue(0);
    Animated.timing(resultFade, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [intel?.result?.runId, intel?.state, resultFade]);

  if (intel === null || intel.state === "idle") return null;
  if (intel.state === "error-hidden" && intel.updateFailureCount !== 1)
    return null;

  const forecast = report?.forecast;
  const hasBand =
    typeof forecast?.total_low === "number" &&
    typeof forecast.total_high === "number" &&
    typeof forecast.capacity === "number";
  const benchmark = report?.meta?.research_source === "fallback";
  const stale = intel.state === "stale";
  const accessibilityLabel = hasBand
    ? `Turnout forecast: ${forecast.total_low} to ${forecast.total_high} of ${forecast.capacity} expected, ${benchmark ? "benchmark" : "modeled"}.`
    : "Turnout forecast";

  return (
    <Animated.View
      style={{
        opacity: entry,
        transform: [
          {
            translateY: entry.interpolate({
              inputRange: [0, 1],
              outputRange: [8, 0],
            }),
          },
        ],
      }}
    >
      <IntelCard
        style={styles.card}
        testID="turnout-forecast-card"
        accessibilityLabel={accessibilityLabel}
      >
        <View style={styles.header}>
          <Icon name="sparkle" size={20} color={accent.warm} />
          <Text style={styles.title}>TURNOUT FORECAST</Text>
          <View style={styles.headerPill}>
            <Text style={styles.headerPillText}>
              {intel.state === "running"
                ? "CHECKING"
                : stale
                  ? "STALE"
                  : "INTELLIGENCE"}
            </Text>
          </View>
        </View>

        {intel.state === "running" || intel.state === "eligible" ? (
          <IntelProgress />
        ) : intel.state === "offline" ? (
          <View style={styles.stateBody}>
            <Text style={styles.stateTitle}>{"You're offline"}</Text>
            <Text style={styles.stateCopy}>
              Checks need a connection. Your event is untouched.
            </Text>
          </View>
        ) : intel.state === "rate_limited" ? (
          <View style={styles.stateBody}>
            <Text style={styles.stateTitle}>
              {"You've used today's checks."}
            </Text>
            <Text style={styles.stateCopy}>They refresh tomorrow.</Text>
          </View>
        ) : intel.state === "error-hidden" ? (
          <View style={styles.stateBody}>
            <Text style={styles.stateTitle}>
              {"That check didn't finish — nothing lost."}
            </Text>
            <Button
              label="Try again"
              variant="secondary"
              size="md"
              onPress={() => intel.run("update")}
            />
          </View>
        ) : hasBand ? (
          <Animated.View
            style={[styles.resultBody, { opacity: resultFade }]}
            testID="turnout-result-body"
          >
            <Pressable
              onPress={intel.openReport}
              accessibilityRole="button"
              accessibilityLabel="Open full turnout forecast"
              style={[styles.bandPressable, stale ? styles.stale : null]}
            >
              <IntelBandStat
                low={forecast.total_low as number}
                high={forecast.total_high as number}
                capacity={forecast.capacity as number}
                benchmark={benchmark}
              />
            </Pressable>
            <View style={[styles.driverWrap, stale ? styles.stale : null]}>
              {drivers.map((driver) => (
                <IntelDriverChip
                  key={driver.id}
                  label={driver.label}
                  tone={driver.tone}
                  expanded={expandedDriver === driver.id}
                  onPress={() =>
                    setExpandedDriver((current) =>
                      current === driver.id ? null : driver.id,
                    )
                  }
                />
              ))}
            </View>
            {expandedDriver !== null ? (
              <Text style={styles.expandedCopy}>
                {drivers.find((driver) => driver.id === expandedDriver)
                  ?.detail ?? ""}
              </Text>
            ) : null}
            {report?.fixes?.[0]?.title !== undefined ? (
              <Text style={[styles.reco, stale ? styles.stale : null]}>
                {report.fixes[0].title}
                {report.fixes[0].lift_note !== undefined
                  ? ` · ${report.fixes[0].lift_note}`
                  : ""}
              </Text>
            ) : null}
            {stale ? (
              <View style={styles.updateRow}>
                <Text style={styles.changed}>Inputs changed</Text>
                <Button
                  label="Update forecast"
                  variant="secondary"
                  size="md"
                  onPress={() => intel.run("update")}
                />
              </View>
            ) : (
              <Button
                label="See full forecast"
                variant="ghost"
                size="sm"
                onPress={intel.openReport}
              />
            )}
            <Text style={styles.footer}>
              Modeled band — not a promise. Drivers above.
              {benchmark
                ? " Live event research was unavailable — this band uses benchmarks."
                : ""}
            </Text>
          </Animated.View>
        ) : null}
      </IntelCard>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: { marginTop: spacing.md },
  header: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: { ...typography.labelCap, color: text.secondary, flex: 1 },
  headerPill: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.badge,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  headerPillText: { ...typography.micro, color: text.tertiary },
  resultBody: { minHeight: INTEL_RESULT_MIN_HEIGHT, gap: spacing.sm },
  bandPressable: { minHeight: 56, justifyContent: "center" },
  driverWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  expandedCopy: { ...typography.bodySm, color: text.secondary },
  reco: { ...typography.bodySm, color: text.primary, fontWeight: "600" },
  footer: { ...typography.caption, color: text.tertiary },
  stale: { opacity: 0.5 },
  updateRow: { gap: spacing.sm },
  changed: { ...typography.caption, color: text.secondary },
  stateBody: {
    minHeight: INTEL_RESULT_MIN_HEIGHT,
    gap: spacing.sm,
    justifyContent: "center",
  },
  stateTitle: { ...typography.body, color: text.primary, fontWeight: "700" },
  stateCopy: { ...typography.caption, color: text.tertiary },
});
