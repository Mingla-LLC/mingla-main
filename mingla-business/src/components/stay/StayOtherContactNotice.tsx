// issue #4420 wave 2 (D-S7) — "This booking is under another email".
//
// A signed-in guest opened a Stay booking made for a different contact. The
// server named only the MASKED address, so this page shows nothing about the
// booking itself (no dates, rooms or totals) and offers the one way in: sign
// in with that email.

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";
import {
  neutralHair,
  statusOn,
} from "@mingla/offering-rendering/themePalette";

import { Icon } from "../ui/Icon";

export interface StayOtherContactNoticeProps {
  palette: ThemePalette;
  maskedEmail: string;
  /** The email the guest is signed in with, when known. */
  currentEmail: string | null;
  onSignInOther: () => void;
}

export const StayOtherContactNotice: React.FC<StayOtherContactNoticeProps> = ({
  palette,
  maskedEmail,
  currentEmail,
  onSignInOther,
}: StayOtherContactNoticeProps) => {
  const warning = statusOn(palette).warning;
  return (
    <View
      style={[styles.card, { backgroundColor: palette.card, borderColor: neutralHair(palette) }]}
      testID="issue-4420-stay-other-contact"
    >
      <View style={[styles.disc, { backgroundColor: warning.tint }]}>
        <Icon name="mail" size={24} color={warning.text} />
      </View>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.primaryText }]}>
        This booking is under another email
      </Text>
      <Text style={[styles.body, { color: palette.secondaryText }]}>
        {currentEmail !== null ? (
          <>
            {"You're signed in as "}
            <Text style={[styles.strong, { color: palette.primaryText }]}>{currentEmail}</Text>
            {". "}
          </>
        ) : null}
        {"This Stay was booked for "}
        <Text style={[styles.strong, { color: palette.primaryText }]}>{maskedEmail}</Text>
        {". Sign in with that email to see it and pay."}
      </Text>
      <Text style={[styles.privacy, { color: palette.tertiaryText }]}>
        Dates, rooms and the total show once you sign in with the booking's email.
      </Text>
      <Pressable
        onPress={onSignInOther}
        accessibilityRole="button"
        accessibilityLabel={`Sign in as ${maskedEmail}`}
        testID="issue-4420-stay-other-contact-sign-in"
        style={({ pressed }) => [
          styles.primary,
          { backgroundColor: palette.accent },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.primaryLabel, { color: palette.accentText }]} numberOfLines={1}>
          {`Sign in as ${maskedEmail}`}
        </Text>
      </Pressable>
      <Text style={[styles.foot, { color: palette.tertiaryText }]}>
        We only show part of the address to keep the booking private.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, padding: 20, gap: 12 },
  disc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 24, fontWeight: "800" },
  body: { fontSize: 15, lineHeight: 22 },
  strong: { fontWeight: "800" },
  privacy: { fontSize: 13, lineHeight: 18 },
  primary: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    marginTop: 4,
  },
  primaryLabel: { fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.86 },
  foot: { fontSize: 12.5, lineHeight: 17, textAlign: "center" },
});

export default StayOtherContactNotice;
