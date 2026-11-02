/**
 * #4238 wave 2 — "Reach people you know": the brand's own audiences in the
 * Host ad builder's "Who should see it?" step.
 *
 * Hosts see names and rough sizes only, never people. A lookalike shows only
 * when its country is one the Host picked. Up to three can be chosen. A card
 * that isn't ready on any picked app stays visible with its reason (never
 * hidden) and can't be added. The server re-checks ownership and readiness.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import type { HostAdAudience } from "../../../services/hostAdPlanService";
import {
  HOST_AD_AUDIENCE_COPY,
  HOST_AD_LOOKALIKE_PLATFORMS,
  hostAdAudienceName,
  hostAdAudienceSize,
  hostAdAudienceStatusLine,
  hostAdLookalikeCountryReason,
} from "./hostAdCopy";

export const HOST_AD_AUDIENCE_MAX = 3;

export interface HostAdAudiencePickerProps {
  audiences: readonly HostAdAudience[];
  selected: readonly string[];
  countries: readonly string[];
  connections: readonly { platform: string }[];
  onChange: (keys: string[]) => void;
  /** true when host_setup said the audiences are unavailable. */
  unavailable?: boolean;
}

/** The audiences a Host may see for these countries (lookalikes filtered). */
export function visibleHostAdAudiences(
  audiences: readonly HostAdAudience[],
  countries: readonly string[],
): HostAdAudience[] {
  const picked = new Set(countries.map((code) => code.toUpperCase()));
  return audiences.filter(
    (audience) =>
      audience.kind !== "lookalike" ||
      (audience.lookalikeCountry !== null && picked.has(audience.lookalikeCountry)),
  );
}

/** Ready on at least one selected app. */
export function hostAdAudienceSelectable(
  audience: HostAdAudience,
  connections: readonly { platform: string }[],
): boolean {
  return connections.some((connection) =>
    audience.platforms.some(
      (state) => state.platform === connection.platform && state.state === "ready",
    ),
  );
}

export function HostAdAudiencePicker({
  audiences,
  selected,
  countries,
  connections,
  onChange,
  unavailable = false,
}: HostAdAudiencePickerProps): React.ReactElement {
  const visible = visibleHostAdAudiences(audiences, countries);
  const full = selected.length >= HOST_AD_AUDIENCE_MAX;
  return (
    <View style={styles.section} testID="host-ad-audience-picker">
      <Text style={styles.title} accessibilityRole="header">
        {HOST_AD_AUDIENCE_COPY.title}
      </Text>
      <Text style={styles.helper}>{HOST_AD_AUDIENCE_COPY.helper}</Text>
      {unavailable ? (
        <Text style={styles.note} testID="host-ad-audience-error">
          {HOST_AD_AUDIENCE_COPY.error}
        </Text>
      ) : visible.length === 0 ? (
        <Text style={styles.note} testID="host-ad-audience-empty">
          {HOST_AD_AUDIENCE_COPY.empty}
        </Text>
      ) : (
        <>
          {visible.map((audience) => {
            const isSelected = selected.includes(audience.audienceKey);
            const countryReason = hostAdLookalikeCountryReason(audience, countries);
            const selectable =
              countryReason === null && hostAdAudienceSelectable(audience, connections);
            // A chosen card stays pressable so the Host can take it off.
            const disabled = !isSelected && (!selectable || full);
            const name = hostAdAudienceName(audience);
            const size = hostAdAudienceSize(audience);
            const lines = connections
              .filter(
                (connection) =>
                  audience.kind !== "lookalike" ||
                  HOST_AD_LOOKALIKE_PLATFORMS.includes(connection.platform),
              )
              .map((connection) => {
              const state = audience.platforms.find(
                (item) => item.platform === connection.platform,
              );
              return hostAdAudienceStatusLine(
                connection.platform,
                state?.state ?? null,
                state?.neededCount ?? null,
              );
            });
            const reason = countryReason
              ? countryReason
              : !selectable
              ? HOST_AD_AUDIENCE_COPY.notReadyAnywhere
              : full && !isSelected
                ? HOST_AD_AUDIENCE_COPY.limit
                : null;
            return (
              <Pressable
                key={audience.audienceKey}
                style={[
                  styles.card,
                  isSelected && styles.cardSelected,
                  disabled && styles.cardDisabled,
                ]}
                onPress={() => {
                  if (disabled) return;
                  onChange(
                    isSelected
                      ? selected.filter((key) => key !== audience.audienceKey)
                      : [...selected, audience.audienceKey],
                  );
                }}
                disabled={disabled}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected, disabled }}
                aria-checked={isSelected}
                accessibilityLabel={`${name}.${size ? ` ${size}.` : ""}${reason ? ` ${reason}` : ""}`}
                testID={`host-ad-audience-${audience.audienceKey}`}
              >
                <View style={styles.cardText}>
                  <Text style={styles.cardTitle}>{name}</Text>
                  {size ? <Text style={styles.cardSubtitle}>{size}</Text> : null}
                  {lines.map((line) => (
                    <Text key={line} style={styles.statusLine}>
                      {line}
                    </Text>
                  ))}
                  {reason ? (
                    <Text
                      style={styles.reason}
                      testID={`host-ad-audience-reason-${audience.audienceKey}`}
                    >
                      {reason}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.box, isSelected && styles.boxSelected]} />
              </Pressable>
            );
          })}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, marginTop: spacing.md },
  title: {
    ...typography.bodyLg,
    color: textTokens.primary,
    fontWeight: "700",
  },
  helper: { ...typography.bodySm, color: textTokens.secondary },
  note: { ...typography.bodySm, color: textTokens.tertiary },
  card: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
  },
  cardSelected: { borderColor: accent.border, backgroundColor: accent.tint },
  cardDisabled: { opacity: 0.6 },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { ...typography.body, color: textTokens.primary, fontWeight: "600" },
  cardSubtitle: { ...typography.bodySm, color: textTokens.secondary },
  statusLine: { ...typography.caption, color: textTokens.tertiary },
  reason: { ...typography.caption, color: textTokens.secondary },
  box: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: textTokens.tertiary,
  },
  boxSelected: { borderColor: accent.warm, backgroundColor: accent.warm },
});
