/**
 * PersonaPickerCards — 3-card brand-creation persona picker (ORCH-0855 Tr1).
 *
 * Presentation-only. Does NOT own state. Does NOT call services. Caller
 * supplies the persona definitions + onSelect closures.
 *
 * Locked interface per I-PROPOSED-TR1-PERSONA-INTERFACE (DRAFT → ACTIVE on
 * ORCH-0855 CLOSE): PersonaDef.id is the exact union 'place' | 'event' | 'trip'.
 * Widening the union requires a new ORCH + SPEC + invariant amendment.
 * Ve1 (Track 2, different developer) plugs in via the same PersonaDef[] contract.
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md §4.5.1
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Icon, type IconName } from "../ui/Icon";

export interface PersonaDef {
  /** Locked union — do NOT widen without a new ORCH amending I-PROPOSED-TR1-PERSONA-INTERFACE. */
  id: "place" | "event" | "trip";
  title: string;
  description: string;
  icon: IconName;
  onSelect: () => void;
  /** When true the card renders as "Coming soon" (Ve1's 'place' before Ve1 ships). */
  disabled?: boolean;
  testID?: string;
}

export interface PersonaPickerCardsProps {
  /** Expected length: 3 (place, event, trip) in visual order. */
  personas: PersonaDef[];
  testID?: string;
}

export const PersonaPickerCards: React.FC<PersonaPickerCardsProps> = ({
  personas,
  testID,
}) => {
  return (
    <View style={styles.host} testID={testID}>
      {personas.map((persona) => {
        const isDisabled = persona.disabled === true;
        const a11yLabel = `${persona.title} — ${persona.description}`;
        return (
          <Pressable
            key={persona.id}
            onPress={isDisabled ? undefined : persona.onSelect}
            disabled={isDisabled}
            accessibilityRole="button"
            accessibilityLabel={a11yLabel}
            accessibilityState={{ disabled: isDisabled }}
            testID={persona.testID}
            style={({ pressed }) => [
              styles.cardOuter,
              isDisabled && styles.cardOuterDisabled,
              pressed && !isDisabled && styles.cardOuterPressed,
            ]}
          >
            <GlassCard variant={isDisabled ? "base" : "elevated"} padding={spacing.md}>
              <View style={styles.row}>
                <View style={styles.iconWrap}>
                  <Icon
                    name={persona.icon}
                    size={28}
                    color={isDisabled ? textTokens.tertiary : accent.warm}
                  />
                </View>
                <View style={styles.textCol}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {persona.title}
                    {isDisabled ? (
                      <Text style={styles.comingSoon}> · Coming soon</Text>
                    ) : null}
                  </Text>
                  <Text style={styles.cardDescription} numberOfLines={2}>
                    {persona.description}
                  </Text>
                </View>
                {!isDisabled ? (
                  <Icon name="chevR" size={18} color={textTokens.tertiary} />
                ) : null}
              </View>
            </GlassCard>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  cardOuter: {
    borderRadius: radiusTokens.lg,
  },
  cardOuterDisabled: {
    opacity: 0.5,
  },
  cardOuterPressed: {
    opacity: 0.85,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  iconWrap: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.md,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    fontWeight: "600",
    color: textTokens.primary,
  },
  comingSoon: {
    fontSize: typography.caption.fontSize,
    fontWeight: "400",
    color: textTokens.tertiary,
  },
  cardDescription: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.secondary,
    marginTop: 2,
  },
});

export default PersonaPickerCards;
