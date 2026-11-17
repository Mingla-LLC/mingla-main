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

import { color, radius, space, type } from "../../../constants/designSystem";
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
  section: { gap: space[2], marginTop: space[4] },
  title: {
    ...type.row,
    color: color.text1,
    fontWeight: "700",
  },
  helper: { ...type.small, color: color.text2 },
  note: { ...type.small, color: color.text3 },
  card: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: space[4],
    padding: space[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  cardSelected: { borderColor: color.paper, backgroundColor: color.fill.tabOn },
  cardDisabled: { opacity: 0.6 },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { ...type.body, color: color.text1, fontWeight: "600" },
  cardSubtitle: { ...type.small, color: color.text2 },
  statusLine: { ...type.caption, color: color.text3 },
  reason: { ...type.caption, color: color.text2 },
  box: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: color.text3,
  },
  boxSelected: { borderColor: color.paper, backgroundColor: color.paper },
});
