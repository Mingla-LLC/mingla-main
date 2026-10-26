/**
 * #3872 — brand-level Creators home. What needs the host comes first, then
 * gigs and contracts. Hiring starts from a listing (its Promote hub).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { useRouter } from "expo-router";

import { Button } from "../../../../src/components/ui/Button";
import { Sheet } from "../../../../src/components/ui/Sheet";
import {
  Card,
  ListGroup,
  ListRow,
  Muted,
  ProgramLoading,
  ProgramScreen,
  SectionLabel,
  SheetBody,
  StatusTag,
  programStyles,
} from "../../../../src/components/programs/ProgramKit";
import { useProgramParams } from "../../../../src/components/programs/useProgramParams";
import {
  creatorGigsService,
  type HostHome,
} from "../../../../src/services/creatorGigsService";
import {
  fetchReferralListingOptions,
  type ReferralListingOption,
} from "../../../../src/services/referralService";
import {
  contractNeedsHost,
  dateRangeLabel,
  gigStatusLabel,
  hostContractRowStatus,
  needsYouCopy,
  programErrorMessage,
} from "../../../../src/utils/creatorProgramFormat";

export default function BrandCreatorsHome(): React.ReactElement {
  const router = useRouter();
  const { brandId } = useProgramParams();
  const [home, setHome] = useState<HostHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [listings, setListings] = useState<ReferralListingOption[] | null>(
    null,
  );

  const load = useCallback(async () => {
    if (!brandId) return;
    setLoading(true);
    setError(null);
    try {
      setHome(await creatorGigsService.hostHome(brandId));
    } catch (loadError) {
      setError(
        programErrorMessage(
          loadError,
          "We couldn't load your creators. Pull to try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [brandId]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!picking || listings !== null) return;
    void fetchReferralListingOptions(brandId)
      .then(setListings)
      .catch(() => setListings([]));
  }, [picking, listings, brandId]);

  const needs = (home?.contracts ?? []).filter(contractNeedsHost);
  const others = (home?.contracts ?? []).filter(
    (contract) => !contractNeedsHost(contract),
  );
  const gigs = home?.gigs ?? [];
  const openContract = (id: string) =>
    router.push(`/brand/${brandId}/creators/contract/${id}` as never);

  return (
    <ProgramScreen
      title="Creators"
      fallback={`/brand/${brandId}`}
      refreshing={loading && home !== null}
      onRefresh={() => void load()}
      footer={
        <Button
          fullWidth
          label="Hire a creator"
          leadingIcon="plus"
          onPress={() => setPicking(true)}
        />
      }
      overlay={
        <Sheet
          visible={picking}
          onClose={() => setPicking(false)}
          snapPoint="half"
        >
          <SheetBody title="What should creators promote?">
            {listings === null ? (
              <ProgramLoading />
            ) : listings.length === 0 ? (
              <Muted>
                Publish an event or venue first. Creators promote a specific
                listing.
              </Muted>
            ) : (
              <ListGroup>
                {listings.map((item) => (
                  <ListRow
                    key={`${item.listingKind}:${item.listingId}`}
                    title={item.label}
                    subtitle={item.listingKind === "venue" ? "Venue" : "Event"}
                    onPress={() => {
                      setPicking(false);
                      router.push(
                        `/brand/${brandId}/promote?kind=${item.listingKind}&listingId=${item.listingId}` as never,
                      );
                    }}
                  />
                ))}
              </ListGroup>
            )}
          </SheetBody>
        </Sheet>
      }
    >
      {loading && !home ? <ProgramLoading /> : null}
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

      {needs.length > 0 ? <SectionLabel>Needs you</SectionLabel> : null}
      {needs.map((contract) => {
        const copy = needsYouCopy(
          contract.state,
          contract.creator,
          contract.due_at,
        );
        return (
          <Card key={contract.id}>
            <Text style={programStyles.title}>{copy.title}</Text>
            <Muted>
              {[contract.title, copy.body].filter(Boolean).join(" · ")}
            </Muted>
            <Button
              label={copy.cta}
              size="sm"
              onPress={() => openContract(contract.id)}
            />
          </Card>
        );
      })}

      {home ? (
        <>
          <SectionLabel>Gigs</SectionLabel>
          {gigs.length === 0 ? (
            <Card>
              <Text style={programStyles.title}>No gigs yet</Text>
              <Muted>
                Post a brief for an event or venue. Matching creators in your
                city see it and tell you they're interested.
              </Muted>
            </Card>
          ) : (
            <ListGroup>
              {gigs.map((gig) => (
                <ListRow
                  key={gig.id}
                  title={gig.title_public}
                  subtitle={[
                    dateRangeLabel(
                      gig.shoot_window_start,
                      gig.shoot_window_end,
                    ),
                    `${gig.interest_count} interested`,
                    `${gig.hired_count} of ${gig.slots} hired`,
                  ].join(" · ")}
                  right={
                    <StatusTag
                      label={gigStatusLabel(gig.status)}
                      tone={gig.status === "open" ? "live" : "ended"}
                    />
                  }
                  onPress={() =>
                    router.push(
                      `/brand/${brandId}/creators/${gig.id}/interest` as never,
                    )
                  }
                />
              ))}
            </ListGroup>
          )}

          {others.length > 0 ? (
            <SectionLabel>Hired creators</SectionLabel>
          ) : null}
          {others.length > 0 ? (
            <ListGroup>
              {others.map((contract) => {
                const status = hostContractRowStatus(contract);
                return (
                  <ListRow
                    key={contract.id}
                    title={contract.creator}
                    subtitle={
                      contract.payment_pending
                        ? `${contract.title} · Retry payment`
                        : contract.title
                    }
                    right={
                      <StatusTag label={status.label} tone={status.tone} />
                    }
                    onPress={() =>
                      contract.payment_pending
                        ? router.push(
                            `/brand/${brandId}/creators/${contract.gig_id}/interest` as never,
                          )
                        : openContract(contract.id)
                    }
                  />
                );
              })}
            </ListGroup>
          ) : null}

          <ListGroup>
            <ListRow
              icon="star"
              title="My creators"
              subtitle="People you already work with"
              onPress={() =>
                router.push(`/brand/${brandId}/creators/roster` as never)
              }
            />
            <ListRow
              icon="chart"
              title="Results"
              subtitle="Sales, clicks and spend per creator"
              onPress={() =>
                router.push(`/brand/${brandId}/creators/results` as never)
              }
            />
          </ListGroup>
        </>
      ) : null}
    </ProgramScreen>
  );
}
