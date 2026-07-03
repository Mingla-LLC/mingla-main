/**
 * ClaimStepContact (c6) — ORCH-1263 DESIGN §6.7: phone / email / website.
 * Phone pre-fills from the listing (51.1%) with a clear-× (validation still
 * requires ≥1 of email/phone). Email is ALWAYS operator-entered — never
 * chipped (no pool source exists). Website moves INTO the wizard for claim
 * mode (90.5% adopted) — it's adopted content and belongs in the walkthrough.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { provenanceFor, useDraftVenueStore } from "../../../store/draftVenueStore";
import { Input } from "../../ui/Input";
import { ProvenanceChip } from "../../ui/ProvenanceChip";
import { venueStepError } from "../venueWizardValidation";

export interface ClaimStepContactProps {
  showErrors: boolean;
}

export const ClaimStepContact: React.FC<ClaimStepContactProps> = ({
  showErrors,
}) => {
  const draft = useDraftVenueStore();
  const patch = useDraftVenueStore((s) => s.patch);
  const phoneChip = provenanceFor("phone", draft);
  const websiteChip = provenanceFor("website", draft);
  const err = showErrors ? venueStepError("c6", draft) : null;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>How people reach you</Text>
      <Text style={styles.helper}>
        People reach you here — check it&apos;s current.
      </Text>

      <View style={styles.labelRow}>
        <Text style={styles.labelCap}>PHONE</Text>
        {phoneChip !== null ? <ProvenanceChip state={phoneChip} /> : null}
      </View>
      <Input
        variant="phone"
        value={draft.contactPhone}
        onChangeText={(t) => patch({ contactPhone: t })}
        placeholder="Phone"
        clearable
        accessibilityLabel={
          phoneChip === "adopted"
            ? "Contact phone, from your existing listing"
            : "Contact phone"
        }
      />

      <View style={styles.labelRow}>
        <Text style={styles.labelCap}>EMAIL</Text>
      </View>
      <Input
        variant="email"
        value={draft.contactEmail}
        onChangeText={(t) => patch({ contactEmail: t })}
        placeholder="Email"
        accessibilityLabel="Contact email"
      />

      <View style={styles.labelRow}>
        <Text style={styles.labelCap}>WEBSITE</Text>
        {websiteChip !== null ? <ProvenanceChip state={websiteChip} /> : null}
      </View>
      <Input
        variant="text"
        value={draft.website}
        onChangeText={(t) => patch({ website: t })}
        placeholder="yourvenue.com"
        clearable
        accessibilityLabel={
          websiteChip === "adopted"
            ? "Website, from your existing listing"
            : "Website"
        }
      />

      {err !== null ? <Text style={styles.err}>{err}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  labelCap: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  err: {
    fontSize: typography.caption.fontSize,
    color: "#EF4444",
  },
});

export default ClaimStepContact;
