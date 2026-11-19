/**
 * issue #4508 P3 — on the event page, a guest who has claimed a pass from a
 * friend sees that state and a button to open the pass (the pass sheet),
 * instead of being asked Going / Maybe / Can't go as if not on the list.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { ThemePalette } from "@mingla/offering-rendering";
import { GUEST_PASS_OPEN_LABEL, guestPassHeadline } from "../../utils/rsvpGuestPassState";

interface RsvpGuestPassCardProps {
  invitedBy: string | null;
  palette: ThemePalette;
  onOpenPass: () => void;
}

export const RsvpGuestPassCard: React.FC<RsvpGuestPassCardProps> = ({
  invitedBy,
  palette,
  onOpenPass,
}) => {
  const headline = guestPassHeadline(invitedBy);
  return (
    <View
      style={[styles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
      testID="issue-4508-guest-pass-state"
    >
      <Text style={[styles.headline, { color: palette.primaryText }]} accessibilityRole="header">
        {headline}
      </Text>
      <Text style={[styles.body, { color: palette.secondaryText }]}>
        Your pass is in the Mingla app.
      </Text>
      <Pressable
        onPress={onOpenPass}
        accessibilityRole="button"
        accessibilityLabel={GUEST_PASS_OPEN_LABEL}
        style={[styles.button, { backgroundColor: palette.primaryText }]}
        testID="issue-4508-guest-pass-open"
      >
        <Text style={[styles.buttonText, { color: palette.page }]}>{GUEST_PASS_OPEN_LABEL}</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 18, marginBottom: 14, gap: 6 },
  headline: { fontSize: 17, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 20 },
  button: {
    alignSelf: "flex-start",
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 22,
    justifyContent: "center",
    marginTop: 6,
  },
  buttonText: { fontSize: 15, fontWeight: "800" },
});
