/**
 * Issue #4114 QA run 2: a group phone invite said "Text message sent" when no
 * SMS went out. When send-phone-invite reports the text did not go out, the
 * person is told "Invite not texted" and offered Share with the invite link
 * (the same message as Add a friend's "Share an invite").
 */
import { Alert, Share } from "react-native";
import type { TFunction } from "i18next";

/** The Explorer OneLink, used when the server did not return one. */
export const DEFAULT_FRIEND_INVITE_LINK = "https://go.usemingla.com/w36m";

export function showInviteNotTextedAlert(t: TFunction, phoneE164: string, inviteLink: string | null): void {
  const link = inviteLink ?? DEFAULT_FRIEND_INVITE_LINK;
  Alert.alert(
    t("connections:fs_sent_invite_not_texted"),
    t("board:boardSettingsDropdown.inviteNotTextedBody", { phone: phoneE164 }),
    [
      { text: t("common:cancel"), style: "cancel" },
      {
        text: t("connections:af_share"),
        onPress: () => {
          // SHARE-NON-CONTENT:invite
          Share.share({ message: t("connections:af_share_message", { link }) }).catch((error: unknown) => {
            console.warn("[inviteNotTextedAlert] share failed:", error);
          });
        },
      },
    ],
  );
}
