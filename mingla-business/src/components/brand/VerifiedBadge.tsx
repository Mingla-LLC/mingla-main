/**
 * Ve4 — subtle verified-venue badge for public physical venue pages.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  color,
  radius as radiusTokens,
  space,
  type,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

export const VerifiedBadge: React.FC = () => (
  <View style={styles.host} accessibilityRole="text">
    <Icon name="check" size={14} color={color.text1} />
    <Text style={styles.label}>Verified</Text>
    <Text style={styles.sub}>Claimed by venue</Text>
  </View>
);

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[1],
    alignSelf: "center",
    paddingVertical: space[1],
    paddingHorizontal: space[2],
    borderRadius: radiusTokens.full,
    backgroundColor: color.infoTint,
    borderWidth: 1,
    borderColor: color.line,
    marginTop: space[1],
  },
  label: {
    fontSize: type.caption.fontSize,
    fontWeight: "700",
    color: color.text1,
  },
  sub: {
    fontSize: type.caption.fontSize,
    color: color.text2,
  },
});

export default VerifiedBadge;
