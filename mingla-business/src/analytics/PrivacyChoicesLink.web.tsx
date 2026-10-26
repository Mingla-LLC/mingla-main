/**
 * #2331 — the in-page "Your privacy choices" link. A normal link in the page
 * footer (or at the end of content on footer-less pages), never a floating
 * control. It reopens the same privacy bar, already expanded.
 */

import React from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { text as textTokens } from "../constants/designSystem";
import { openPrivacyChoices } from "./privacyChoices";

export interface PrivacyChoicesLinkProps {
  /** Readable text colour on the host page (themed public pages pass theirs). */
  color?: string;
}

export function PrivacyChoicesLink({
  color,
}: PrivacyChoicesLinkProps): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Your privacy choices"
      onPress={openPrivacyChoices}
      style={styles.host}
      testID="privacy-choices-link"
    >
      <Text style={[styles.label, color !== undefined ? { color } : null]}>
        Your privacy choices
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: {
    alignSelf: "center",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    marginTop: 8,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.secondary,
    textDecorationLine: "underline",
  },
});
