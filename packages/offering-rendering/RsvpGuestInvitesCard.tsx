/**
 * RsvpGuestInvitesCard — issue #4508 1.14 / 1.15.
 *
 * On the RSVP success screen: "Invites sent" (one row per person brought,
 * with what happened to their invite) and "Send it yourself too" (the
 * ready-made message with Copy message and Share, using the same link the
 * text carries). A number we could not text says so and points to the
 * message; the spot is still held.
 *
 * Package-isolated (I-MOR-0827): React Native core `Share` only on native; the
 * host may inject its own copy / share. Web uses navigator.share with a
 * clipboard fallback.
 */

import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { type ThemePalette } from "./themePalette";
import { themeFontFace } from "./themeAccentStyle";
import { resolveCopyText, shareInviteText } from "./inviteShare";
import {
  buildGuestInviteMessage,
  submittedGuestLabel,
  submittedGuestStatus,
} from "./rsvpGuestParty";
import type {
  GuestInviteMessageInput,
  RsvpSubmittedGuest,
} from "./rsvpGuestPartyModel";

export interface RsvpGuestInvitesCardProps {
  palette: ThemePalette;
  boldFamily: string;
  invites: ReadonlyArray<RsvpSubmittedGuest>;
  rsvpStatus: "going" | "waitlisted" | "pending";
  message: Omit<GuestInviteMessageInput, "link">;
  onCopyText?: (text: string) => void | Promise<void>;
  onShareText?: (text: string) => void | Promise<void>;
}

export const RsvpGuestInvitesCard: React.FC<RsvpGuestInvitesCardProps> = ({
  palette,
  boldFamily,
  invites,
  rsvpStatus,
  message,
  onCopyText,
  onShareText,
}) => {
  const boldFace = themeFontFace(boldFamily);
  const copy = resolveCopyText(onCopyText);
  const [feedback, setFeedback] = useState<{ key: string; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  const flash = (key: string, text: string): void => {
    setFeedback({ key, text });
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback(null), 2500);
  };
  if (invites.length === 0) return null;
  const linked = invites.filter((g) => g.inviteUrl !== null && !g.claimed);

  return (
    <View style={styles.wrap} testID="issue-4508-rsvp-invites">
      <Text style={[styles.heading, { color: palette.primaryText, ...boldFace }]}>
        Invites sent
      </Text>
      {invites.map((guest, index) => {
        const status = submittedGuestStatus(guest, rsvpStatus);
        const failed = !guest.claimed && rsvpStatus === "going" && !guest.willText;
        return (
          <View
            key={guest.guestId ?? `guest-${index}`}
            style={[styles.row, { borderColor: palette.panelBorder }]}
            testID={`issue-4508-rsvp-invite-${index}`}
          >
            <Text style={[styles.name, { color: palette.primaryText, ...boldFace }]} numberOfLines={1}>
              {submittedGuestLabel(guest)}
            </Text>
            <Text style={[styles.status, { color: failed ? "#d14343" : palette.secondaryText }]}>
              {status}
            </Text>
          </View>
        );
      })}

      {linked.length > 0 ? (
        <View style={styles.selfSend} testID="issue-4508-rsvp-send-yourself">
          <Text style={[styles.heading, { color: palette.primaryText, ...boldFace }]}>
            Send it yourself too
          </Text>
          <Text style={[styles.hint, { color: palette.secondaryText }]}>
            A message from you lands best. Same link as our text.
          </Text>
          {linked.map((guest, index) => {
            const key = guest.guestId ?? `linked-${index}`;
            const text = buildGuestInviteMessage({ ...message, link: guest.inviteUrl as string });
            const who = submittedGuestLabel(guest);
            return (
              <View key={key} style={styles.actionsBlock}>
                {linked.length > 1 ? (
                  <Text style={[styles.forWho, { color: palette.tertiaryText }]}>{`For ${who}`}</Text>
                ) : null}
                <View style={styles.actions}>
                  {copy !== null ? (
                    <Pressable
                      onPress={() => {
                        copy(text).then(
                          () => flash(key, "Message copied"),
                          () => flash(key, "Couldn't copy. Try Share instead."),
                        );
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Copy message for ${who}`}
                      style={[styles.action, { borderColor: palette.panelBorder }]}
                      testID={`issue-4508-rsvp-copy-${index}`}
                    >
                      <Text style={[styles.actionText, { color: palette.primaryText, ...boldFace }]}>
                        Copy message
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => {
                      shareInviteText(text, onShareText).then(
                        (outcome) => {
                          if (outcome === "copied") flash(key, "Message copied");
                        },
                        () => flash(key, "Couldn't open sharing. Copy the message instead."),
                      );
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Share message for ${who}`}
                    style={[styles.action, { borderColor: palette.panelBorder }]}
                    testID={`issue-4508-rsvp-share-${index}`}
                  >
                    <Text style={[styles.actionText, { color: palette.primaryText, ...boldFace }]}>
                      Share
                    </Text>
                  </Pressable>
                </View>
                {feedback?.key === key ? (
                  <Text
                    style={[styles.feedback, { color: palette.secondaryText }]}
                    accessibilityLiveRegion="polite"
                  >
                    {feedback.text}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 18, gap: 6 },
  heading: { fontSize: 15, fontWeight: "800" },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 8, gap: 2 },
  name: { fontSize: 14, fontWeight: "800" },
  status: { fontSize: 13 },
  selfSend: { marginTop: 12, gap: 6 },
  hint: { fontSize: 13, lineHeight: 18 },
  actionsBlock: { marginTop: 4 },
  forWho: { fontSize: 12, fontWeight: "700", marginBottom: 4 },
  actions: { flexDirection: "row", gap: 8 },
  action: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  actionText: { fontSize: 14, fontWeight: "800" },
  feedback: { fontSize: 12, marginTop: 4 },
});

export default RsvpGuestInvitesCard;
