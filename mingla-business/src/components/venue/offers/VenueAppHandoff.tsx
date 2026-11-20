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
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";

import { radius, space, type } from "../../../constants/designSystem";
import { mintClaimLinkHandoff } from "../../../services/claimLinkService";
import { BuyerClaimCard } from "../../offering/LazyPublicParts";
import { Icon } from "../../ui/Icon";
import { entryStyles } from "./EntryUi";

export interface VenueHandoff {
  shortUrl: string | null;
  code: string | null;
  passInApp: boolean;
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
      style={[entryStyles.card, styles.block, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
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

export function VenueClaimCard({
  handoff,
  kind,
  email,
  phone,
  analyticsSurface,
  brandSlug,
  venueSlug,
}: {
  handoff: VenueHandoff;
  kind: "pass" | "booking";
  email: string | null;
  phone: string | null;
  analyticsSurface: string;
  brandSlug: string | null;
  venueSlug: string | null;
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
        textSent={last4 !== null}
        analyticsSurface={analyticsSurface}
        fallbackEntity={{ entityType: "event", brandSlug: brandSlug ?? "", entitySlug: venueSlug ?? "" }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  icon: { width: 40, height: 40, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: space[1] },
  title: { ...type.row },
  body: { ...type.body },
});
