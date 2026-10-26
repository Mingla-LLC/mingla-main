/**
 * #3872 — Promoting, for an invited promoter (approved K-mine / M-promoting):
 * Ready / On the way tiles, each link with its sales, Copy and QR, and the
 * payout account status. Money words: On the way · Ready · Paid.
 */
import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useQuery } from "@tanstack/react-query";

import {
  accent,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  fetchMyPayoutAccount,
  fetchPromoterEarnings,
  fetchPromotingOffers,
  type PromotingOffer,
} from "../../services/promoterReferralService";
import { shareBusinessCanonicalFallback } from "../../services/canonicalShareTransport";
import {
  programMoney,
  programMoneyShort,
} from "../../utils/creatorProgramFormat";
import { Button } from "../ui/Button";
import {
  Card,
  ListGroup,
  ListRow,
  Muted,
  ProgramLoading,
  SectionLabel,
  StatTile,
  StatusTag,
  TileGrid,
  programStyles,
} from "../programs/ProgramKit";

const QRCode = React.lazy(() => import("react-native-qrcode-svg"));

const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  NG: "Nigeria",
  GB: "United Kingdom",
  CA: "Canada",
};

export function rewardWords(
  offer: Pick<PromotingOffer, "rewardKind" | "shareBps" | "perkText">,
): string {
  if (offer.rewardKind === "cash")
    return `${(offer.shareBps ?? 0) / 100}% of sales`;
  if (offer.rewardKind === "perk")
    return offer.perkText ?? "A perk from the host";
  return "A voucher for your next order";
}

export const PromoterHomeView: React.FC = () => {
  const offers = useQuery({
    queryKey: ["my-promoting-offers"],
    queryFn: fetchPromotingOffers,
  });
  const earnings = useQuery({
    queryKey: ["my-promoting-earnings"],
    queryFn: fetchPromoterEarnings,
  });
  const payout = useQuery({
    queryKey: ["my-payout-account"],
    queryFn: fetchMyPayoutAccount,
  });
  const [qrSlug, setQrSlug] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const rows = offers.data ?? [];
  const currency = earnings.data?.currency ?? rows[0]?.currency ?? "USD";
  // When the summary is unavailable, everything not yet paid is "On the way":
  // never call money Ready or Paid before the server says so.
  const onTheWay = earnings.data
    ? earnings.data.onTheWayMinor
    : rows.reduce(
        (sum, row) => sum + Math.max(0, row.earnedMinor - row.paidMinor),
        0,
      );
  const ready = earnings.data ? earnings.data.readyMinor : 0;
  const paid = earnings.data
    ? earnings.data.paidMinor
    : rows.reduce((sum, row) => sum + row.paidMinor, 0);

  if (offers.isLoading) return <ProgramLoading />;
  if (offers.isError) {
    return (
      <Card>
        <Text style={programStyles.body}>Your links couldn't load.</Text>
        <Button
          variant="secondary"
          label="Try again"
          onPress={() => void offers.refetch()}
        />
      </Card>
    );
  }
  if (rows.length === 0) {
    return (
      <Card>
        <Text style={programStyles.title}>Nothing to promote yet</Text>
        <Muted>
          When a host invites you, accept with the same email address. Your link
          appears here.
        </Muted>
      </Card>
    );
  }

  const payoutState = payout.data?.state ?? "none";
  return (
    <>
      <TileGrid>
        <StatTile
          icon="cash"
          value={programMoneyShort(ready, currency)}
          label="Ready"
          hint="Released for payout"
        />
        <StatTile
          icon="clock"
          value={programMoneyShort(onTheWay, currency)}
          label="On the way"
          hint="After the event"
        />
      </TileGrid>
      {paid > 0 ? (
        <Muted>{`${programMoney(paid, currency)} paid to you so far.`}</Muted>
      ) : null}

      <SectionLabel>Your links</SectionLabel>
      {rows.map((offer) => {
        const url = `https://usemingla.com/r/${offer.linkSlug}`;
        return (
          <Card key={offer.memberId}>
            <ListRow
              title={offer.brandName}
              subtitle={`${offer.offerName} · ${rewardWords(offer)} · ${offer.salesCount} sale${offer.salesCount === 1 ? "" : "s"} through you`}
              chevron={false}
            />
            <Text
              style={styles.link}
              selectable
            >{`usemingla.com/r/${offer.linkSlug}`}</Text>
            {offer.code ? (
              <Muted>{`Checkout code: ${offer.code}`}</Muted>
            ) : null}
            <View style={programStyles.footerRow}>
              <Button
                size="sm"
                variant="secondary"
                style={programStyles.grow}
                label={copied === offer.memberId ? "Copied" : "Copy link"}
                onPress={() => {
                  void Clipboard.setStringAsync(url);
                  setCopied(offer.memberId);
                }}
              />
              <Button
                size="sm"
                variant="secondary"
                style={programStyles.grow}
                label={qrSlug === offer.linkSlug ? "Hide QR" : "Show QR"}
                onPress={() =>
                  setQrSlug((current) =>
                    current === offer.linkSlug ? null : offer.linkSlug,
                  )
                }
              />
              <Button
                size="sm"
                style={programStyles.grow}
                label="Share"
                onPress={() =>
                  void shareBusinessCanonicalFallback({
                    title: offer.brandName,
                    message: `Take a look at ${offer.brandName}: ${url}`,
                    url,
                  })
                }
              />
            </View>
            {qrSlug === offer.linkSlug ? (
              <View style={styles.qr}>
                <React.Suspense
                  fallback={<ActivityIndicator color={accent.warm} />}
                >
                  <QRCode value={url} size={176} />
                </React.Suspense>
              </View>
            ) : null}
          </Card>
        );
      })}

      <ListGroup>
        <ListRow
          title="Payout account"
          subtitle={
            payoutState === "connected"
              ? `Bank in ${COUNTRY_NAMES[payout.data?.country ?? ""] ?? "your country"}`
              : payoutState === "pending"
                ? "Being checked"
                : "Set it up in your Mingla app wallet so rewards can be paid"
          }
          right={
            <StatusTag
              label={
                payoutState === "connected"
                  ? "Connected"
                  : payoutState === "pending"
                    ? "In review"
                    : "Not set up"
              }
              tone={
                payoutState === "connected"
                  ? "done"
                  : payoutState === "pending"
                    ? "waiting"
                    : "action"
              }
            />
          }
          chevron={false}
        />
      </ListGroup>
      <Muted>
        Mingla's 5% referral service fee comes off each reward when it's
        recorded. Buyers never pay it.
      </Muted>
    </>
  );
};

const styles = StyleSheet.create({
  link: { color: accent.warm, fontWeight: "600" },
  qr: {
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#FFFFFF",
  },
  muted: { color: textTokens.secondary },
});
