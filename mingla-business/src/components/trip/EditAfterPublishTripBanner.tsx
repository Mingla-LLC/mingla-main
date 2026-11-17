/**
 * EditAfterPublishTripBanner — informational banner shown above editable
 * sections on the EditPublishedTripScreen (ORCH-0876).
 *
 * Orange-tinted card with warning icon + headline + body copy.
 * Communicates: changes go live immediately + some destructive changes
 * require refunding existing buyers first. issue #3827 — travellers are NOT
 * emailed about edits yet, and the banner says so.
 *
 * Mirror of `EditAfterPublishBanner.tsx` (events side) with trip-specific
 * copy substitution (spot / reservation in place of ticket).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
} from "../../constants/designSystem";

import { Icon } from "../ui/Icon";

export const EditAfterPublishTripBanner: React.FC = () => (
  <View style={styles.host}>
    <View style={styles.iconBadge}>
      <Icon name="flag" size={18} color={color.accent} />
    </View>
    <View style={styles.textCol}>
      <Text style={styles.heading}>You're editing a live trip</Text>
      <Text style={styles.body}>
        Changes save immediately. Existing travelers stay protected — their
        spots and prices won't change. Edits are logged in the edit history
        of this trip; travelers are not emailed about edits yet. Some
        destructive changes require refunding existing travelers first.
      </Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[2] + 4,
    padding: space[4],
    borderRadius: radiusTokens.lg,
    overflow: "hidden",
    backgroundColor: color.accentLine,
    borderWidth: 1,
    borderColor: color.accentLine,
    marginBottom: space[6],
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.accentTint,
    borderWidth: 1,
    borderColor: color.accentLine,
    flexShrink: 0,
  },
  textCol: {
    flex: 1,
    gap: 4,
  },
  heading: {
    fontSize: 14,
    fontWeight: "700",
    color: color.text1,
    letterSpacing: -0.1,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    color: color.text2,
  },
});

export default EditAfterPublishTripBanner;
