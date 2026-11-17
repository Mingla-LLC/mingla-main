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
  color,
  space,
  type,
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
        // ORCH-1269 — the picker opens on the ADOPTED place's country (mapped
        // from place_pool.country at prefill), not the component's GB default;
        // undefined (unmappable) keeps the default. Operator picks persist to
        // the draft so the ISO survives step navigation and resume.
        defaultCountryIso={draft.contactPhoneCountryIso ?? undefined}
        onCountryChange={(country) =>
          patch({ contactPhoneCountryIso: country.iso })
        }
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
    gap: space[2],
    paddingHorizontal: space[6],
    paddingBottom: space[7],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  helper: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    marginTop: space[1],
  },
  labelCap: {
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
    color: color.text3,
  },
  err: {
    fontSize: type.caption.fontSize,
    color: color.errorText,
  },
});

export default ClaimStepContact;
