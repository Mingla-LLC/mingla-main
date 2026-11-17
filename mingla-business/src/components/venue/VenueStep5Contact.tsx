/**
 * Ve1 wizard — Step 5: Contact.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  color,
  space,
  type,
} from "../../constants/designSystem";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { Input } from "../ui/Input";

export interface VenueStep5ContactProps {
  showErrors: boolean;
}

export const VenueStep5Contact: React.FC<VenueStep5ContactProps> = ({
  showErrors,
}) => {
  const contactEmail = useDraftVenueStore((s) => s.contactEmail);
  const contactPhone = useDraftVenueStore((s) => s.contactPhone);
  const patch = useDraftVenueStore((s) => s.patch);

  const err =
    showErrors &&
    contactEmail.trim().length === 0 &&
    contactPhone.trim().length === 0
      ? "Add an email or phone number."
      : undefined;

  return (
    <View style={styles.host}>
      <Text style={styles.title}>Guest contact</Text>
      <Text style={styles.helper}>
        How should attendees reach the venue? At least one field is required.
      </Text>
      <Input
        variant="email"
        value={contactEmail}
        onChangeText={(t) => patch({ contactEmail: t })}
        placeholder="Email"
        accessibilityLabel="Contact email"
      />
      <Input
        variant="phone"
        value={contactPhone}
        onChangeText={(t) => patch({ contactPhone: t })}
        placeholder="Phone"
        accessibilityLabel="Contact phone"
      />
      {err !== undefined ? <Text style={styles.err}>{err}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: space[2],
    paddingHorizontal: space[6],
  },
  title: {
    fontSize: type.h1.fontSize,
    fontWeight: type.h1.fontWeight,
    color: color.text1,
  },
  helper: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
  err: {
    fontSize: type.caption.fontSize,
    color: color.errorText,
  },
});

export default VenueStep5Contact;
