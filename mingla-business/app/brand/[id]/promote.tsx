/**
 * #3872 — Promote hub for one listing (approved H-promote / P-find-on-event).
 * Results first, then what needs the host, then the ways to promote.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Button } from "../../../src/components/ui/Button";
import {
  Card,
  ListGroup,
  ListRow,
  Muted,
  ProgramLoading,
  ProgramScreen,
  SectionLabel,
  StatTile,
  TileGrid,
  programStyles,
} from "../../../src/components/programs/ProgramKit";
import { useProgramParams } from "../../../src/components/programs/useProgramParams";
import {
  creatorGigsService,
  type GigResult,
  type HostHome,
} from "../../../src/services/creatorGigsService";
import { creatorRosterService } from "../../../src/services/creatorRosterService";
import {
  fetchPromoteListing,
  type PromoteListing,
} from "../../../src/services/promoteListingService";
import {
  fetchReferralOffers,
  fetchTrackingLinks,
  type ReferralOffer,
  type ReferralTrackingLink,
} from "../../../src/services/referralService";
import {
  contractNeedsHost,
  needsYouCopy,
  programErrorMessage,
  programMoneyShort,
  shortDate,
} from "../../../src/utils/creatorProgramFormat";

const LIVE_VIDEO_STATES = new Set([
  "posts_verified",
  "released",
  "day30",
  "completed",
]);
const HIRED_STATES_EXCLUDED = new Set([
  "offered",
  "declined",
  "expired",
  "cancelled",
  "resolved_refund",
]);

export default function PromoteHub(): React.ReactElement {
  const router = useRouter();
  const { brandId, params, currency } = useProgramParams("kind", "listingId");
  const kind = params.kind === "venue" ? "venue" : "event";
  const listingId = params.listingId ?? "";
  const [listing, setListing] = useState<PromoteListing | null>(null);
  const [home, setHome] = useState<HostHome>({ gigs: [], contracts: [] });
  const [results, setResults] = useState<GigResult[]>([]);
  const [offers, setOffers] = useState<ReferralOffer[]>([]);
  const [links, setLinks] = useState<ReferralTrackingLink[]>([]);
  const [rosterCount, setRosterCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!brandId || !listingId) return;
    setLoading(true);
    setError(null);
    try {
      const [nextListing, nextHome] = await Promise.all([
        fetchPromoteListing(kind, listingId),
        creatorGigsService.hostHome(brandId),
      ]);
      setListing(nextListing);
      setHome(nextHome);
      // Secondary panels must not blank the hub when one of them fails.
      const [nextResults, nextOffers, nextLinks, roster] = await Promise.all([
        creatorGigsService.results(brandId).catch(() => [] as GigResult[]),
        fetchReferralOffers(brandId).catch(() => [] as ReferralOffer[]),
        fetchTrackingLinks(brandId).catch(() => [] as ReferralTrackingLink[]),
        creatorRosterService.list(brandId).catch(() => []),
      ]);
      setResults(nextResults);
      setOffers(nextOffers);
      setLinks(nextLinks);
      setRosterCount(roster.length);
    } catch (loadError) {
      setError(
        programErrorMessage(
          loadError,
          "We couldn't load promotion for this listing. Pull to try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [brandId, kind, listingId]);
  useEffect(() => {
    void load();
  }, [load]);

  const gigs = useMemo(
    () => home.gigs.filter((gig) => gig.listing_id === listingId),
    [home.gigs, listingId],
  );
  const gigIds = useMemo(() => new Set(gigs.map((gig) => gig.id)), [gigs]);
  const contracts = useMemo(
    () => home.contracts.filter((contract) => gigIds.has(contract.gig_id)),
    [home.contracts, gigIds],
  );
  const needs = contracts.filter(contractNeedsHost);
  const listingLinks = links.filter(
    (link) => link.listingId === listingId && !link.archivedAt,
  );
  const listingOffers = offers.filter(
    (offer) =>
      offer.status === "active" &&
      (offer.scopeKind === "brand" ||
        offer.listings.some((item) => item.listingId === listingId)),
  );
  const soldMinor =
    results
      .filter((row) => gigIds.has(row.gig_id))
      .reduce((sum, row) => sum + row.sold_minor, 0) +
    listingLinks.reduce((sum, link) => sum + link.revenueMinor, 0);
  const videosLive = contracts.filter((contract) =>
    LIVE_VIDEO_STATES.has(contract.state),
  ).length;
  const openGigs = gigs.filter((gig) => gig.status === "open");
  const interested = gigs.reduce((sum, gig) => sum + gig.interest_count, 0);
  const hired =
    gigs.reduce((sum, gig) => sum + gig.hired_count, 0) ||
    contracts.filter((contract) => !contract.payment_pending && !HIRED_STATES_EXCLUDED.has(contract.state))
      .length;
  const newInterest = openGigs.filter(
    (gig) => gig.interest_count > 0 && gig.hired_count < gig.slots,
  );

  const briefHref = `/brand/${brandId}/creators/brief?listingKind=${kind}&listingId=${listingId}`;
  const creatorsSubtitle =
    gigs.length === 0
      ? "Hire creators to make videos"
      : [
          `${openGigs.length} gig${openGigs.length === 1 ? "" : "s"} open`,
          `${interested} interested`,
          `${hired} hired`,
        ].join(" · ");
  const referralSubtitle =
    listingOffers.length === 0
      ? "Pay people per ticket they sell"
      : `${listingOffers.length} offer${listingOffers.length === 1 ? "" : "s"} live · ${listingOffers.reduce((sum, offer) => sum + offer.memberCount, 0)} promoters`;
  const linksSubtitle =
    listingLinks.length === 0
      ? "Your own links per channel"
      : `${listingLinks.length} link${listingLinks.length === 1 ? "" : "s"} · ${listingLinks.reduce((sum, link) => sum + link.touchCount, 0)} clicks`;

  const openCreators = () => {
    const latest = openGigs[0] ?? gigs[0];
    router.push(
      (latest
        ? `/brand/${brandId}/creators/${latest.id}/interest`
        : briefHref) as never,
    );
  };

  return (
    <ProgramScreen
      title="Promote"
      fallback={`/brand/${brandId}`}
      refreshing={loading && listing !== null}
      onRefresh={() => void load()}
      footer={
        <Button
          fullWidth
          label="Hire a creator"
          leadingIcon="plus"
          onPress={() => router.push(briefHref as never)}
        />
      }
    >
      {listing ? (
        <Muted>
          {[
            listing.title,
            listing.startDay ? shortDate(listing.startDay) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Muted>
      ) : null}
      {loading && !listing ? <ProgramLoading /> : null}
      {error ? (
        <Card>
          <Text style={programStyles.body}>{error}</Text>
          <Button
            variant="secondary"
            label="Try again"
            onPress={() => void load()}
          />
        </Card>
      ) : null}

      {listing ? (
        <>
          <TileGrid>
            <StatTile
              icon="cash"
              value={programMoneyShort(soldMinor, currency)}
              label="Sold through promotion"
            />
            <StatTile
              icon="play"
              value={String(videosLive)}
              label="Videos live"
            />
          </TileGrid>

          {needs.length > 0 || newInterest.length > 0 ? (
            <SectionLabel>Needs you</SectionLabel>
          ) : null}
          {needs.map((contract) => {
            const copy = needsYouCopy(
              contract.state,
              contract.creator,
              contract.due_at,
            );
            return (
              <Card key={contract.id}>
                <Text style={programStyles.title}>{copy.title}</Text>
                {copy.body ? <Muted>{copy.body}</Muted> : null}
                <Button
                  label={copy.cta}
                  size="sm"
                  onPress={() =>
                    router.push(
                      `/brand/${brandId}/creators/contract/${contract.id}` as never,
                    )
                  }
                />
              </Card>
            );
          })}
          {newInterest.map((gig) => (
            <Card key={gig.id}>
              <Text style={programStyles.title}>
                {gig.interest_count} creator
                {gig.interest_count === 1 ? "" : "s"} interested
              </Text>
              <Muted>{gig.title_public}</Muted>
              <Button
                label="See who's interested"
                size="sm"
                onPress={() =>
                  router.push(
                    `/brand/${brandId}/creators/${gig.id}/interest` as never,
                  )
                }
              />
            </Card>
          ))}

          <SectionLabel>Ways to promote</SectionLabel>
          <ListGroup>
            <ListRow
              icon="play"
              title="Creators"
              subtitle={creatorsSubtitle}
              onPress={openCreators}
            />
            <ListRow
              icon="users"
              title="Referrals"
              subtitle={referralSubtitle}
              onPress={() =>
                router.push(`/brand/${brandId}/referrals` as never)
              }
            />
            <ListRow
              icon="link"
              title="Tracking links"
              subtitle={linksSubtitle}
              onPress={() =>
                router.push(`/brand/${brandId}/referrals?tab=links` as never)
              }
            />
            <ListRow
              icon="star"
              title="My creators"
              subtitle="People you already work with"
              right={rosterCount > 0 ? String(rosterCount) : undefined}
              onPress={() =>
                router.push(`/brand/${brandId}/creators/roster` as never)
              }
            />
          </ListGroup>
          {gigs.length > 0 ? (
            <View style={programStyles.actions}>
              <Button
                variant="ghost"
                size="sm"
                label="Creator results"
                onPress={() =>
                  router.push(`/brand/${brandId}/creators/results` as never)
                }
              />
            </View>
          ) : null}
        </>
      ) : null}
    </ProgramScreen>
  );
}
