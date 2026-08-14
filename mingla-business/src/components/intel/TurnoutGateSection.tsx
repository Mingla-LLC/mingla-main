import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  accent,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import { postHogService } from "../../services/postHogService";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { IntelCard } from "./IntelCard";
import { IntelProgress } from "./IntelProgress";
import { useTurnoutIntel } from "./TurnoutIntelContext";

type Focus = "name" | "date" | "city" | "price" | "capacity";
const targetFor = (
  copy: string,
  wizard: "event" | "rsvp" | "experience",
): { step: number; focus: Focus; label: string } | null => {
  const value = copy.toLowerCase();
  if (/date|day|week|time|lead|runway|schedul/.test(value))
    return {
      step: wizard === "experience" ? 2 : 1,
      focus: "date",
      label: "Review when",
    };
  if (/price|ticket|fee|cost|charg/.test(value))
    return wizard === "rsvp"
      ? null
      : {
          step: wizard === "experience" ? 3 : 4,
          focus: "price",
          label: "Review pricing",
        };
  if (/capacity|seat|spot|room\b/.test(value))
    return {
      step: wizard === "experience" ? 3 : 4,
      focus: "capacity",
      label: "Review capacity",
    };
  if (/title|name|listing|copy|descri|tagline/.test(value))
    return { step: 0, focus: "name", label: "Review basics" };
  if (/venue|location|city|area|neighborhood/.test(value))
    return {
      step: wizard === "experience" ? 1 : 2,
      focus: "city",
      label: "Review location",
    };
  return null;
};
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
    if (intel?.report == null) return [];
    const rows: { copy: string; target: ReturnType<typeof targetFor> }[] = [];
    const fix = intel.report.fixes?.[0];
    if (fix?.title)
      rows.push({
        copy: fix.title,
        target: targetFor(
          `${fix.title} ${fix.why ?? ""} ${fix.change ?? ""}`,
          intel.wizard,
        ),
      });
    const hurt = intel.report.factors?.find((item) => item.status === "hurt");
    if (hurt?.label)
      rows.push({
        copy: hurt.label,
        target: targetFor(`${hurt.label} ${hurt.detail ?? ""}`, intel.wizard),
      });
    if ((intel.report.competitors?.length ?? 0) > 0)
      rows.push({
        copy: `${intel.report.competitors?.length ?? 0} competing events found`,
        target: null,
      });
    if ((intel.input?.ticket_price ?? 0) > 0 && intel.report.plan?.read)
      rows.push({
        copy: intel.report.plan.read,
        target: targetFor(intel.report.plan.read, intel.wizard),
      });
    return rows.slice(0, 4);
  }, [intel]);
  useEffect(() => {
    if (intel !== null && shownKey.current !== intel.inputKey) {
      shownKey.current = intel.inputKey;
      postHogService.capture("intel_gate_shown", {
        wizard: intel.wizard,
        gate_state: intel.fresh ? "fresh" : intel.state,
        estimate_used: false,
      });
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
    typeof forecast.total_high === "number";
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
          <Text style={styles.band}>
            {forecast?.total_low}–{forecast?.total_high} expected
          </Text>
          {recommendations.map((row, index) => (
            <View key={`${row.copy}-${index}`} style={styles.reco}>
              <Text style={styles.body}>{row.copy}</Text>
              {row.target !== null && intel.navigateTo !== undefined ? (
                <Button
                  label={row.target.label}
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    postHogService.capture("intel_reco_followed", {
                      wizard: intel.wizard,
                      door: "gate",
                      target_step: row.target?.step,
                      gate_state: intel.state,
                      estimate_used: false,
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
  body: { ...typography.bodySm, color: text.primary },
  band: { ...typography.h2, color: text.primary },
  note: { ...typography.caption, color: text.tertiary },
});
export default TurnoutGateSection;
