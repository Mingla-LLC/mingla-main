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
  neutralControl,
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
  /** The Stay's name ("The Glasshouse"), when the server named it. */
  stayName?: string | null;
  /** The booking reference the host needs to find it. */
  reference?: string | null;
  /** "Email me the booking link again" (absent: nothing to resend). */
  onResend?: (() => void) | null;
  /** The resend is in flight. */
  resending?: boolean;
  /** "Ask {Stay} to change the email" (absent: the host takes no messages). */
  onAskHost?: (() => void) | null;
}

export const StayOtherContactNotice: React.FC<StayOtherContactNoticeProps> = ({
  palette,
  maskedEmail,
  currentEmail,
  onSignInOther,
  stayName = null,
  reference = null,
  onResend = null,
  resending = false,
  onAskHost = null,
}: StayOtherContactNoticeProps) => {
  const warning = statusOn(palette).warning;
  const stay = stayName !== null && stayName.trim().length > 0 ? stayName.trim() : "The property";
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
        {`${stay} booked this Stay for `}
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
      {onResend !== null ? (
        <Pressable
          onPress={onResend}
          disabled={resending}
          accessibilityRole="button"
          accessibilityState={{ disabled: resending, busy: resending }}
          accessibilityLabel={`Email the booking link again to ${maskedEmail}`}
          testID="issue-4420-stay-other-contact-resend"
          style={({ pressed }) => [
            styles.secondary,
            { backgroundColor: palette.accentWash },
            (pressed || resending) && styles.pressed,
          ]}
        >
          <Text style={[styles.secondaryLabel, { color: palette.primaryText }]} numberOfLines={1}>
            {resending ? "Sending…" : "Email me the booking link again"}
          </Text>
        </Pressable>
      ) : null}
      {onAskHost !== null ? (
        <Pressable
          onPress={onAskHost}
          accessibilityRole="button"
          accessibilityLabel={`Ask ${stay} to change the email`}
          testID="issue-4420-stay-other-contact-ask-host"
          style={({ pressed }) => [
            styles.secondary,
            styles.ghost,
            { borderColor: neutralControl(palette) },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.secondaryLabel, { color: palette.primaryText }]} numberOfLines={1}>
            {`Ask ${stay} to change the email`}
          </Text>
        </Pressable>
      ) : null}
      {onAskHost !== null && reference !== null ? (
        <Text style={[styles.foot, { color: palette.tertiaryText }]} testID="issue-4420-stay-other-contact-reference">
          {`Mention booking reference ${reference} so they can find it.`}
        </Text>
      ) : null}
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
  secondary: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  ghost: { borderWidth: 1.5 },
  secondaryLabel: { fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.86 },
  foot: { fontSize: 12.5, lineHeight: 17, textAlign: "center" },
});

export default StayOtherContactNotice;
