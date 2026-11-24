/**
 * issue #4508 1.24 / 2.5 — on an RSVP pass:
 *   - RsvpPartyInvites (the inviter): each person brought, "Claimed" or "Not
 *     claimed yet", what happened to their invite text, and "Nudge", which
 *     opens the ready-made message for that person (no system text is sent).
 *   - RsvpBringSomeone (a claimed guest, when the host allows it): bring one
 *     more person by number (op guest_bring), then send them the link.
 */
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { resolveUserPhoneE164 } from "@mingla/card-identity/phone.mjs";
import type { PhoneInputTheme } from "@mingla/phone-input";
import { buildGuestInviteMessage, rsvpGuestRowLabel } from "@mingla/offering-rendering/rsvpGuestParty";
import { shareInviteText } from "@mingla/offering-rendering/inviteShare";

import { BottomSheetTextInput } from "../ui/BaseBottomSheet";
import { PhoneInput } from "../onboarding/PhoneInput";
import { toastManager } from "../ui/Toast";
import { copyAddressText } from "../../utils/copyAddressText";
import {
  bringRsvpGuest,
  rsvpGuestBringMessage,
  type RsvpPartyGuestStatus,
} from "../../services/rsvpDeckService";

export interface InviteMessageParts {
  eventName: string;
  dateLine: string;
  area: string | null;
  online: boolean;
}

export const inviteStatusLine = (status: RsvpPartyGuestStatus["inviteStatus"]): string | null => {
  switch (status) {
    case "sent":
      return "Text sent";
    case "sending":
      return "Sending their text…";
    case "failed":
      return "We couldn't text this number. Nudge them yourself.";
    case "not_texted":
      return "Not texted yet";
    default:
      return null;
  }
};

const ACCENT = "#eb7825";

async function shareMessage(text: string): Promise<void> {
  try {
    await shareInviteText(text);
  } catch {
    toastManager.show("Couldn't open sharing. Try again.", "warning");
  }
}

export function RsvpPartyInvites({
  guests,
  message,
}: {
  guests: RsvpPartyGuestStatus[];
  message: InviteMessageParts;
}): React.ReactElement | null {
  if (guests.length === 0) return null;
  return (
    <View style={styles.block} testID="issue-4508-pass-party">
      <Text style={styles.heading}>People you're bringing</Text>
      {guests.map((guest) => {
        const status = inviteStatusLine(guest.inviteStatus);
        // #4508 round 8: a number guest always shows its last four.
        const label = rsvpGuestRowLabel(guest.displayName, guest.phoneLast4);
        const link = guest.inviteLink;
        return (
          <View key={guest.guestId} style={styles.row} testID={`issue-4508-pass-guest-${guest.guestId}`}>
            <View style={styles.rowText}>
              <Text style={styles.name} numberOfLines={1}>{label}</Text>
              <Text style={[styles.claim, guest.claimed ? styles.claimed : null]}>
                {guest.claimed === true ? "Claimed" : guest.claimed === false ? "Not claimed yet" : "Checking…"}
              </Text>
              {status !== null && guest.claimed !== true ? (
                <Text style={[styles.meta, guest.inviteStatus === "failed" ? styles.failed : null]}>{status}</Text>
              ) : null}
            </View>
            {guest.claimed !== true && link !== null ? (
              <Pressable
                onPress={() => void shareMessage(buildGuestInviteMessage({ ...message, link }))}
                accessibilityRole="button"
                accessibilityLabel={`Nudge ${label}. Opens a message you can send`}
                hitSlop={6}
                style={styles.nudge}
                testID={`issue-4508-pass-nudge-${guest.guestId}`}
              >
                <Text style={styles.nudgeText}>Nudge</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const PHONE_THEME: PhoneInputTheme = {
  backgroundPrimary: "#15181f",
  fieldBackground: "rgba(255,255,255,0.05)",
  textPrimary: "#ffffff",
  textTertiary: "rgba(255,255,255,0.45)",
  borderDefault: "rgba(255,255,255,0.12)",
  borderFocused: ACCENT,
  borderError: "#ff8878",
  searchBackground: "rgba(255,255,255,0.06)",
  rowPressedBackground: "rgba(235,120,37,0.16)",
  divider: "rgba(255,255,255,0.12)",
  accessoryBackground: "#15181f",
  accessoryBorder: "rgba(255,255,255,0.12)",
  accent: ACCENT,
  errorText: "#ff8878",
};

export function RsvpBringSomeone({
  guestId,
  message,
  onAdded,
  onFieldFocus,
}: {
  guestId: string;
  message: InviteMessageParts;
  onAdded: () => void;
  /** #4508 round 9 — the sheet scrolls the form (field, Cancel / Add) into view. */
  onFieldFocus?: () => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const submit = useCallback(async (): Promise<void> => {
    if (busy) return;
    const phone = resolveUserPhoneE164(raw, country);
    if (phone === null) {
      setError("Enter a valid phone number.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await bringRsvpGuest(guestId, phone, country);
    setBusy(false);
    if (!result.ok) {
      setError(rsvpGuestBringMessage(result.code));
      return;
    }
    setAdded(true);
    setInviteUrl(result.inviteUrl);
    onAdded();
  }, [busy, raw, country, guestId, onAdded]);

  if (added) {
    const text = inviteUrl !== null ? buildGuestInviteMessage({ ...message, link: inviteUrl }) : null;
    return (
      <View style={styles.block} testID="issue-4508-pass-bring-done">
        <Text style={styles.heading}>They're on the list</Text>
        <Text style={styles.meta}>We'll text them their pass. A message from you lands best too.</Text>
        {text !== null ? (
          <View style={styles.actions}>
            <Pressable
              onPress={() => {
                copyAddressText(text).then(
                  () => toastManager.show("Message copied", "success"),
                  () => toastManager.show("Couldn't copy. Try Share instead.", "warning"),
                );
              }}
              accessibilityRole="button"
              accessibilityLabel="Copy message"
              style={styles.action}
            >
              <Text style={styles.actionText}>Copy message</Text>
            </Pressable>
            <Pressable
              onPress={() => void shareMessage(text)}
              accessibilityRole="button"
              accessibilityLabel="Share message"
              style={styles.action}
            >
              <Text style={styles.actionText}>Share</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Bring someone too"
        style={[styles.action, styles.bringButton]}
        testID="issue-4508-pass-bring"
      >
        <Text style={styles.actionText}>Bring someone too</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.block} testID="issue-4508-pass-bring-form">
      <Text style={styles.heading}>Bring someone too</Text>
      <Text style={styles.meta}>Just their number. We'll text them a pass.</Text>
      <PhoneInput
        value={raw}
        countryCode={country}
        onChangePhone={(v: string) => { setRaw(v); setError(null); }}
        onChangeCountry={(iso: string) => setCountry(iso)}
        error={error}
        disabled={busy}
        theme={PHONE_THEME}
        inputComponent={BottomSheetTextInput}
        disableAutofill
        onSubmitEditing={() => void submit()}
        phoneInputAccessibilityLabel="Their phone number"
        testID="issue-4508-pass-bring-phone"
        onFocus={onFieldFocus}
        // #4508 round 8: the pass sheet has no shared Done bar on iOS
        // (keyboardToolbar PURCHASE_SHEET_KEYBOARD_TOOLBAR), so this field's own
        // bar is the only one, and being part of the keyboard it never covers
        // the field.
        showDoneAccessory
      />
      <View style={styles.actions}>
        <Pressable
          onPress={() => { setOpen(false); setError(null); }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={styles.action}
        >
          <Text style={styles.actionText}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => void submit()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Add this person"
          accessibilityState={{ disabled: busy, busy }}
          style={[styles.action, styles.primary]}
        >
          {busy ? <ActivityIndicator size="small" color="#171411" /> : <Text style={[styles.actionText, styles.primaryText]}>Add</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: 18,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.04)",
    gap: 6,
  },
  heading: { color: "#fff", fontSize: 15, fontWeight: "800" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
    paddingTop: 8,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: "#fff", fontSize: 14, fontWeight: "700" },
  claim: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "700" },
  claimed: { color: "#55c889" },
  meta: { color: "rgba(255,255,255,0.55)", fontSize: 12, lineHeight: 17 },
  failed: { color: "#ff8878" },
  nudge: {
    minHeight: 44,
    minWidth: 72,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(235,120,37,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  nudgeText: { color: ACCENT, fontSize: 13, fontWeight: "800" },
  actions: { flexDirection: "row", gap: 10, marginTop: 8 },
  action: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  actionText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  bringButton: { marginTop: 14, flex: 0 },
  primary: { backgroundColor: ACCENT, borderColor: ACCENT },
  primaryText: { color: "#171411" },
});
