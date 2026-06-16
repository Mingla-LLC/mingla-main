/**
 * META-ORCH-1148 sub-ORCH 2.0 — honest "set up next" interstitial.
 *
 * The booking modules (Tables / Availability / Reservations / Waitlist) are
 * SCHEMA-only in 2.0 (real CRUD is 2.1). Rather than a dead tap or a fake UI,
 * each renders this honest interstitial: the module's one-line job + an explicit
 * "Coming in the next update" line + (where useful) a REAL CTA into a live 2.0
 * surface (Tables / Availability point the operator to "Set your reservation fee
 * & rules" → Settings). Copy must NOT claim the booking module works yet.
 *
 * No dead taps (hard guard §6).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";
import { Icon, type IconName } from "../ui/Icon";
import { VENUE_MODULES } from "./venueModules";
import type { VenueBookingModule } from "../../types/venueReservation";

const MODULE_ICON: Record<VenueBookingModule, IconName> = {
  tables: "grid",
  availability: "calendar",
  reservations: "list",
  waitlist: "clock",
};

/** Modules whose 2.0 starter step routes to the real Settings fee/rules surface. */
const ROUTES_TO_SETTINGS: ReadonlySet<VenueBookingModule> = new Set([
  "tables",
  "availability",
]);

export interface VenueModuleComingSoonProps {
  module: VenueBookingModule;
  /** Jump to the live Settings module (the real 2.0 action). */
  onGoToSettings: () => void;
  testID?: string;
}

export function VenueModuleComingSoon({
  module,
  onGoToSettings,
  testID,
}: VenueModuleComingSoonProps): React.ReactElement {
  const meta = VENUE_MODULES[module];
  const routesToSettings = ROUTES_TO_SETTINGS.has(module);

  return (
    <View style={styles.host} testID={testID ?? `venue-coming-soon-${module}`}>
      <GlassCard variant="elevated" style={styles.card}>
        <View style={styles.iconWrap}>
          <Icon name={MODULE_ICON[module]} size={28} color={textTokens.primary} />
        </View>
        <Text style={styles.title}>{meta.label}</Text>
        <Text style={styles.summary}>{meta.summary}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>Coming in the next update</Text>
        </View>
        {routesToSettings ? (
          <View style={styles.ctaWrap}>
            <Text style={styles.ctaHint}>
              You can set your reservation fee, cancellation, and no-show rules
              right now.
            </Text>
            <Button
              label="Set your fee & rules"
              onPress={onGoToSettings}
              variant="primary"
              size="md"
              trailingIcon="chevR"
              fullWidth
              testID={`venue-coming-soon-${module}-to-settings`}
            />
          </View>
        ) : null}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  card: {
    alignItems: "center",
    gap: spacing.sm,
  },
  iconWrap: {
    paddingBottom: spacing.xs,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
    textAlign: "center",
  },
  summary: {
    ...typography.body,
    color: textTokens.secondary,
    textAlign: "center",
  },
  badge: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    backgroundColor: semantic.infoTint,
  },
  badgeLabel: {
    ...typography.caption,
    color: textTokens.primary,
  },
  ctaWrap: {
    marginTop: spacing.md,
    gap: spacing.sm,
    alignSelf: "stretch",
  },
  ctaHint: {
    ...typography.bodySm,
    color: textTokens.secondary,
    textAlign: "center",
  },
});

export default VenueModuleComingSoon;
