/**
 * Issue #4114 QA run 2: a group phone invite said "Text message sent" when no
 * SMS went out. When send-phone-invite reports the text did not go out, the
 * person is told "Invite not texted" and offered Share with the invite link
 * (the same message as Add a friend's "Share an invite").
 */
import { Alert, Share } from "react-native";
import type { TFunction } from "i18next";

import { copyAddressText } from "./copyAddressText";

/** The Explorer OneLink, used when the server did not return one. */
export const DEFAULT_FRIEND_INVITE_LINK = "https://go.usemingla.com/w36m";

export function showInviteNotTextedAlert(
  t: TFunction,
  phoneE164: string,
  inviteLink: string | null,
  /** #4508 2.2 — a session invite carries its own wording. Absent ⇒ the friend wording. */
  sessionName?: string,
): void {
  const link = inviteLink ?? DEFAULT_FRIEND_INVITE_LINK;
  const message = sessionInviteMessage(t, link, sessionName);
  Alert.alert(
    t("connections:fs_sent_invite_not_texted"),
    t("board:boardSettingsDropdown.inviteNotTextedBody", { phone: phoneE164 }),
    [
      { text: t("common:cancel"), style: "cancel" },
      {
        text: t("connections:af_share"),
        onPress: () => {
          // SHARE-NON-CONTENT:invite
          Share.share({ message }).catch((error: unknown) => {
            console.warn("[inviteNotTextedAlert] share failed:", error);
          });
        },
      },
    ],
  );
}

/** #4508 2.2 — a session (board) invite's own wording; the friend wording otherwise. */
export function sessionInviteMessage(t: TFunction, link: string, sessionName?: string): string {
  return sessionName && sessionName.trim().length > 0
    ? t("board:boardSettingsDropdown.sessionShareMessage", { name: sessionName.trim(), link })
    : t("connections:af_share_message", { link });
}

/**
 * Issue #4508 2.2 — the text went out: say so, and offer the same "Send it
 * yourself too" as the RSVP success screen (Copy message / Share) with the
 * invite's own link and wording. Nothing else is sent by the system.
 */
export function showInviteTextedAlert(
  t: TFunction,
  phoneE164: string,
  inviteLink: string | null,
  sessionName?: string,
): void {
  const title = t("board:boardSettingsDropdown.invited");
  const body = t("board:boardSettingsDropdown.invitedTextSent", { phone: phoneE164 });
  if (!inviteLink) {
    Alert.alert(title, body);
    return;
  }
  const message = sessionInviteMessage(t, inviteLink, sessionName);
  Alert.alert(title, `${body}\n\n${t("connections:af_send_yourself_body")}`, [
    { text: t("connections:af_done"), style: "cancel" },
    {
      text: t("connections:af_copy_message"),
      onPress: () => {
        copyAddressText(message).catch((error: unknown) => {
          // Copy failed: the share sheet carries the same message instead.
          console.warn("[inviteTextedAlert] copy failed, opening share:", error);
          // SHARE-NON-CONTENT:invite
          Share.share({ message }).catch((shareError: unknown) => {
            console.warn("[inviteTextedAlert] share failed:", shareError);
          });
        });
      },
    },
    {
      text: t("connections:af_share"),
      onPress: () => {
        // SHARE-NON-CONTENT:invite
        Share.share({ message }).catch((error: unknown) => {
          console.warn("[inviteTextedAlert] share failed:", error);
        });
      },
    },
  ]);
}
