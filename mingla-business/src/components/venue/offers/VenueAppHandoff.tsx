/**
 * #4490 Explorer W1 — the handoff to the Mingla app on the buyer's venue
 * pages (/visit/<id>, /visit/plan/<id>).
 *
 * - `parseVenueHandoff` reads the two server fields the edge adds to a read:
 *   `claim` ({ shortUrl, code }, minted only while VENUE_APP_HANDOFF is on)
 *   and `passInApp` (VENUE_PASS_APP_ONLY). The page never decides the QR: the
 *   server withholds it; the page only says where the pass lives.
 * - `VenuePassInAppBlock` replaces the pass QR when the switch is on and no QR
 *   came back.
 * - `VenueClaimCard` is BuyerClaimCard fed the same way as the table booking
 *   confirmation; hidden while there is no claim link.
 */
import React, { useState } from "react";
import { Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";

import { color, radius, space, type } from "../../../constants/designSystem";
import { mintClaimLinkHandoff } from "../../../services/claimLinkService";
import { BuyerClaimCard } from "../../offering/LazyPublicParts";
import { Icon } from "../../ui/Icon";
import { Button } from "../../ui/Button";
import { VenueOfferGuestError, textClaimLink } from "../../../services/venueOfferGuestInvoke";

export interface VenueHandoff {
  shortUrl: string | null;
  code: string | null;
  passInApp: boolean;
  /** N155: the server saw a text with this link queued for the booking. */
  texted: boolean;
  /** N159: texts still allowed (the cap is 3); null when unknown. */
  textsLeft: number | null;
}

const CLAIM_URL = /^https:\/\/usemingla\.com\/c\/[0-9A-Z]{10}$/;
const CLAIM_CODE = /^[0-9A-Z]{10}$/;

export const VENUE_PASS_IN_APP_COPY = {
  title: "Your pass lives in the Mingla app.",
  body: "Open it there to get in. No app? Give your name at the door.",
} as const;

/** Reads `claim` and `passInApp` off a venue read; anything malformed is "none". */
export function parseVenueHandoff(raw: unknown): VenueHandoff {
  const row = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const claim = row.claim !== null && typeof row.claim === "object" ? (row.claim as Record<string, unknown>) : {};
  const shortUrl = typeof claim.shortUrl === "string" && CLAIM_URL.test(claim.shortUrl) ? claim.shortUrl : null;
  const code = typeof claim.code === "string" && CLAIM_CODE.test(claim.code) ? claim.code : null;
  return {
    shortUrl,
    code: shortUrl !== null ? code : null,
    passInApp: row.passInApp === true,
    texted: shortUrl !== null && claim.texted === true,
    textsLeft:
      shortUrl !== null && typeof claim.textsLeft === "number" && Number.isInteger(claim.textsLeft)
        ? Math.max(0, Math.min(3, claim.textsLeft))
        : null,
  };
}

/** The last four digits of a phone number, or null. */
export function phoneLastFour(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export function VenuePassInAppBlock({
  palette,
  theme,
}: {
  palette: ThemePalette;
  theme: ResolvedTheme;
}): React.ReactElement {
  return (
    <View
      style={[styles.card, styles.block, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
      accessibilityRole="summary"
      testID="issue-4490-pass-in-app"
    >
      <View style={[styles.icon, { backgroundColor: palette.accentWash }]}>
        <Icon name="phone" size={20} color={palette.primaryText} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.title, themeBoldFace(theme), { color: palette.primaryText }]}>
          {VENUE_PASS_IN_APP_COPY.title}
        </Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>{VENUE_PASS_IN_APP_COPY.body}</Text>
      </View>
    </View>
  );
}

export const TEXT_LINK_COPY = {
  button: "Text me the link",
  sending: "Sending…",
  sent: (last4: string | null) => (last4 ? `Sent to •••${last4}.` : "Sent."),
  limit: "We've already texted this link 3 times. Use the link in your email.",
  noPhone: "There's no phone number on this booking. Use the link in your email.",
  notConfirmed: "This booking isn't confirmed yet, so there's no pass to send.",
  failed: "We couldn't send the text. Try again.",
} as const;

export function textLinkErrorCopy(code: string): string {
  if (code === "claim_text_limit") return TEXT_LINK_COPY.limit;
  if (code === "claim_text_no_phone") return TEXT_LINK_COPY.noPhone;
  if (code === "claim_text_not_confirmed") return TEXT_LINK_COPY.notConfirmed;
  return TEXT_LINK_COPY.failed;
}

/** Desktop only (a phone has the Open button): re-send the app link by text. */
function TextMeTheLink({
  groupId,
  token,
  textsLeft,
}: {
  groupId: string;
  token: string | null;
  textsLeft: number | null;
}): React.ReactElement | null {
  const { width } = useWindowDimensions();
  // N159: after a reload the cap is already known, so the page says so up front.
  const [state, setState] = useState<{ phase: "idle" | "sending" | "sent" | "error"; line: string | null }>(
    textsLeft === 0 ? { phase: "error", line: TEXT_LINK_COPY.limit } : { phase: "idle", line: null },
  );
  const capped = textsLeft === 0 || state.line === TEXT_LINK_COPY.limit;
  if (Platform.OS !== "web" || width < 1024) return null;
  const send = async (): Promise<void> => {
    setState({ phase: "sending", line: null });
    try {
      const out = await textClaimLink({ groupId, token });
      setState({ phase: "sent", line: TEXT_LINK_COPY.sent(out.phoneLast4) });
    } catch (caught) {
      const code = caught instanceof VenueOfferGuestError ? caught.code : "offer_request_failed";
      setState({ phase: "error", line: textLinkErrorCopy(code) });
    }
  };
  return (
    <View style={styles.textRow} testID="issue-4490-text-link">
      <Button
        label={state.phase === "sending" ? TEXT_LINK_COPY.sending : TEXT_LINK_COPY.button}
        variant="secondary"
        size="md"
        onPress={() => void send()}
        disabled={state.phase === "sending" || state.phase === "sent" || capped}
        testID="issue-4490-text-link-button"
      />
      {state.line !== null ? (
        <Text
          style={[styles.textLine, state.phase === "error" ? styles.textError : null]}
          accessibilityLiveRegion="polite"
        >
          {state.line}
        </Text>
      ) : null}
    </View>
  );
}

export function VenueClaimCard({
  handoff,
  kind,
  email,
  phone,
  analyticsSurface,
  brandSlug,
  venueSlug,
  textLink,
}: {
  handoff: VenueHandoff;
  kind: "pass" | "booking";
  email: string | null;
  phone: string | null;
  analyticsSurface: string;
  brandSlug: string | null;
  venueSlug: string | null;
  /** Offer bookings only: the "Text me the link" button on a desktop. */
  textLink?: { groupId: string; token: string | null };
}): React.ReactElement | null {
  if (handoff.shortUrl === null) return null;
  const code = handoff.code;
  const last4 = phoneLastFour(phone);
  return (
    <View testID="issue-4490-venue-claim">
      <BuyerClaimCard
        kind={kind}
        email={email}
        phoneLast4={last4}
        shortUrl={handoff.shortUrl}
        handoff={code === null ? null : { mint: () => mintClaimLinkHandoff(code) }}
        textSent={last4 !== null && handoff.texted}
        analyticsSurface={analyticsSurface}
        fallbackEntity={{ entityType: "event", brandSlug: brandSlug ?? "", entitySlug: venueSlug ?? "" }}
      />
      {textLink !== undefined && last4 !== null ? <TextMeTheLink groupId={textLink.groupId} token={textLink.token} textsLeft={handoff.textsLeft} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The Entry card shape (EntryUi entryStyles.card), kept here so the Stay
  // booking page can show this card without loading the Entry UI (#4490).
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: space[5],
    gap: space[3],
  },
  block: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  icon: { width: 40, height: 40, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: space[1] },
  title: { ...type.row },
  body: { ...type.body },
  textRow: { marginTop: space[3], gap: space[2], alignItems: "flex-start" },
  textLine: { ...type.small, color: color.text2 },
  textError: { color: color.errorText },
});
