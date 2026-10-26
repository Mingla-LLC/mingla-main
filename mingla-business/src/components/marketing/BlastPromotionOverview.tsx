/**
 * #3872 round 2 — Blast › Overview (approved M-blastover): a listing picker
 * (All listings, or one listing), one strip of results, then every way the
 * listing is being promoted — campaigns, ads, creators, referrals — each
 * opening its own Blast tab. Reads `brand_promotion_overview`.
 */
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import {
  ListGroup,
  ListRow,
  ProgramLoading,
  SectionLabel,
  SheetBody,
  StatStrip,
} from "../programs/ProgramKit";
import {
  promotionListingLabel,
  promotionRowWords,
  promotionStrip,
  type PromotionListingKind,
} from "../../services/promotionOverview";
import { fetchPromotionOverview } from "../../services/promotionOverviewService";
import {
  accent,
  radius,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

export type OverviewListingParam = {
  kind: PromotionListingKind;
  id: string;
} | null;

export function BlastPromotionOverview({
  brandId,
  initialListing,
  onNewCampaign,
}: {
  brandId: string;
  initialListing: OverviewListingParam;
  onNewCampaign: () => void;
}): React.ReactElement {
  const router = useRouter();
  const [listing, setListing] = useState<OverviewListingParam>(initialListing);
  const [picking, setPicking] = useState(false);
  // A new deep link (Get it seen, the Promote tile) re-picks the listing.
  useEffect(() => {
    setListing(initialListing);
  }, [initialListing?.kind, initialListing?.id, brandId]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useQuery({
    queryKey: ["blast-promotion-overview", brandId, listing?.kind, listing?.id],
    queryFn: () => fetchPromotionOverview(brandId, listing),
    retry: false,
  });
  // A listing that no longer exists (or is unpublished) falls back to the
  // whole brand instead of an error screen.
  const failedCode =
    query.error && typeof (query.error as { code?: unknown }).code === "string"
      ? ((query.error as { code: string }).code)
      : null;
  useEffect(() => {
    if (
      listing !== null &&
      (failedCode === "listing_not_found" || failedCode === "listing_required")
    ) {
      setListing(null);
    }
  }, [failedCode, listing]);

  const data = query.data;
  const words = data ? promotionRowWords(data) : null;
  const go = (path: string) => router.replace(path as never);
  const chipLabel =
    data?.listing
      ? promotionListingLabel(data.listing)
      : listing === null
        ? "All listings"
        : "Loading…";

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setPicking(true)}
        accessibilityRole="button"
        accessibilityLabel={`Showing ${chipLabel}. Change listing`}
        style={({ pressed }) => [styles.picker, pressed && styles.pressed]}
        testID="blast-overview-listing-picker"
      >
        <Text style={styles.pickerText} numberOfLines={1}>
          {chipLabel}
        </Text>
        <Icon name="chevD" size={14} color={textTokens.primary} />
      </Pressable>

      {query.isLoading ? <ProgramLoading /> : null}
      {query.isError && failedCode === null ? (
        <Text style={styles.error}>
          Promotion results couldn't load. Pull down to try again.
        </Text>
      ) : null}

      {data && words ? (
        <>
          <StatStrip items={promotionStrip(data)} />
          <SectionLabel>
            {data.listing ? "Promoting this listing" : "All promotion"}
          </SectionLabel>
          <ListGroup>
            <ListRow
              compact
              icon="send"
              title="Campaigns"
              subtitle={words.campaigns}
              chevron={false}
              onPress={() => go("/(tabs)/marketing/campaigns")}
              right={
                <Pressable
                  onPress={onNewCampaign}
                  accessibilityRole="button"
                  accessibilityLabel="Send a campaign"
                  hitSlop={8}
                >
                  <Text style={styles.action}>Send</Text>
                </Pressable>
              }
            />
            <ListRow
              compact
              icon="sparkle"
              title="Ads"
              subtitle={words.ads}
              onPress={() => go("/(tabs)/marketing/ads")}
            />
            <ListRow
              compact
              icon="video"
              title="Creators"
              subtitle={words.creators}
              onPress={() => go("/(tabs)/marketing/creators")}
            />
            <ListRow
              compact
              icon="gift"
              title="Referrals"
              subtitle={words.referrals}
              onPress={() => go("/(tabs)/marketing/referrals")}
            />
          </ListGroup>
          {data.listing ? (
            <Text style={styles.note}>
              Pick "All listings" to see the whole brand.
            </Text>
          ) : null}
        </>
      ) : null}

      <Sheet
        visible={picking}
        onClose={() => setPicking(false)}
        snapPoint="half"
      >
        <SheetBody title="Show promotion for">
          <ListGroup>
            <ListRow
              compact
              title="All listings"
              subtitle="Everything this brand is promoting"
              chevron={false}
              right={listing === null ? <Text style={styles.action}>Showing</Text> : undefined}
              onPress={() => {
                setListing(null);
                setPicking(false);
              }}
            />
            {(data?.listings ?? []).map((item) => (
              <ListRow
                compact
                key={`${item.kind}:${item.id}`}
                title={promotionListingLabel(item)}
                subtitle={item.kind === "venue" ? "Venue" : "Event"}
                chevron={false}
                right={
                  listing?.id === item.id ? (
                    <Text style={styles.action}>Showing</Text>
                  ) : undefined
                }
                onPress={() => {
                  setListing({ kind: item.kind, id: item.id });
                  setPicking(false);
                }}
              />
            ))}
          </ListGroup>
        </SheetBody>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  picker: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  pressed: { opacity: 0.85 },
  pickerText: {
    color: textTokens.primary,
    fontSize: 14,
    fontWeight: "700",
    flexShrink: 1,
  },
  action: { color: accent.warm, fontSize: 14, fontWeight: "700" },
  note: { color: textTokens.tertiary, fontSize: 12, lineHeight: 16 },
  error: { color: textTokens.secondary, fontSize: 14, marginTop: spacing.xs },
});
