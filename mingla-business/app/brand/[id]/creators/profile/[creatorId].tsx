/**
 * #3872 — creator profile before hire (approved P-creator): who they are,
 * showcase videos, rate for this gig, track record, audience, packages, and a
 * sticky Not now / Hire bar when opened from a gig.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Button } from "../../../../../src/components/ui/Button";
import { HireSheet, type HireSheetMode } from "../../../../../src/components/gigs/HireSheet";
import {
  Card,
  FieldError,
  Initials,
  ListGroup,
  ListRow,
  Muted,
  ProgramLoading,
  ProgramScreen,
  SectionLabel,
  StatTile,
  SummaryLine,
  TileGrid,
  programStyles,
} from "../../../../../src/components/programs/ProgramKit";
import { ShowcaseStrip } from "../../../../../src/components/programs/ShowcaseStrip";
import { useProgramParams } from "../../../../../src/components/programs/useProgramParams";
import {
  creatorGigsService,
  type GigApplicant,
  type HostGig,
  type PrehireProfile,
} from "../../../../../src/services/creatorGigsService";
import {
  followerBandLabel,
  formatName,
  nicheLabel,
  platformLabel,
  programErrorMessage,
  programMoney,
} from "../../../../../src/utils/creatorProgramFormat";

export default function PrehireCreatorProfile(): React.ReactElement {
  const router = useRouter();
  const { brandId, params } = useProgramParams("creatorId", "gigId", "interestId");
  const creatorId = params.creatorId ?? "";
  const [profile, setProfile] = useState<PrehireProfile | null | undefined>(undefined);
  const [applicant, setApplicant] = useState<GigApplicant | null>(null);
  const [gig, setGig] = useState<HostGig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hireMode, setHireMode] = useState<HireSheetMode | null>(null);
  const [passing, setPassing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextProfile, applicants, home] = await Promise.all([
        creatorGigsService.prehireProfile(creatorId),
        params.gigId ? creatorGigsService.applicants(params.gigId).catch(() => [] as GigApplicant[]) : Promise.resolve([] as GigApplicant[]),
        params.gigId ? creatorGigsService.hostHome(brandId).catch(() => null) : Promise.resolve(null),
      ]);
      setProfile(nextProfile ?? null);
      setApplicant(applicants.find((row) => row.interest_id === params.interestId || row.creator_id === creatorId) ?? null);
      setGig(home?.gigs.find((row) => row.id === params.gigId) ?? null);
    } catch (loadError) {
      setProfile(null);
      setError(programErrorMessage(loadError, "We couldn't load this creator. Pull to try again."));
    }
  }, [brandId, creatorId, params.gigId, params.interestId]);
  useEffect(() => { void load(); }, [load]);

  const name = profile?.display_name ?? applicant?.display_name ?? "Creator";
  const canHire = applicant !== null && applicant.status !== "passed" && applicant.status !== "hired";
  const notNow = async () => {
    if (!applicant) return router.back();
    setPassing(true);
    setActionError(null);
    try {
      const result = await creatorGigsService.decideInterest(applicant.interest_id, "passed");
      if (!result.ok) throw new Error(result.error ?? "update_failed");
      router.back();
    } catch (passError) {
      setActionError(programErrorMessage(passError, "We couldn't update this creator. Try again."));
    } finally {
      setPassing(false);
    }
  };

  return (
    <ProgramScreen
      title={name}
      fallback={params.gigId ? `/brand/${brandId}/creators/${params.gigId}/interest` : `/brand/${brandId}/creators`}
      refreshing={false}
      onRefresh={() => void load()}
      footer={canHire && applicant ? (
        <>
          <FieldError message={actionError} />
          <View style={programStyles.footerRow}>
            <Button variant="secondary" label="Not now" loading={passing} style={programStyles.grow} onPress={() => void notNow()} />
            <Button label="Hire" style={programStyles.grow} onPress={() => setHireMode({ kind: "hire", interestId: applicant.interest_id, quoteMinor: applicant.quote_minor, allowCounter: true })} />
          </View>
        </>
      ) : undefined}
      overlay={hireMode && applicant ? (
        <HireSheet
          visible
          onClose={() => setHireMode(null)}
          mode={hireMode}
          creatorName={name}
          currency={applicant.currency}
          salesShareBps={gig?.sales_share_bps ?? null}
          usageDays={gig?.usage_days ?? null}
          onPaid={(contractId) => {
            setHireMode(null);
            router.replace(`/brand/${brandId}/creators/contract/${contractId}` as never);
          }}
        />
      ) : undefined}
    >
      {profile === undefined ? <ProgramLoading /> : null}
      {error ? <FieldError message={error} /> : null}
      {profile === null && !error ? (
        <Card><Text style={programStyles.title}>This profile isn't available</Text><Muted>The creator may have paused their profile.</Muted></Card>
      ) : null}
      {profile ? (
        <>
          <Card>
            <ListRow
              leading={<Initials name={name} size={48} />}
              title={name}
              subtitle={[profile.niches.map(nicheLabel).join(", "), profile.languages.join(", ")].filter(Boolean).join(" · ")}
              chevron={false}
            />
            <Muted>Handles and contact details are shared when you hire.</Muted>
          </Card>

          {profile.showcase.length > 0 ? (
            <>
              <SectionLabel>Showcase</SectionLabel>
              <ShowcaseStrip items={profile.showcase} creatorName={name} size="large" />
            </>
          ) : null}

          {applicant ? (
            <Card>
              <SummaryLine label="Rate for this gig" value={programMoney(applicant.quote_minor, applicant.currency)} strong />
              {applicant.note ? <Muted>{`"${applicant.note}"`}</Muted> : null}
            </Card>
          ) : null}

          <TileGrid>
            <StatTile value={String(profile.completed ?? 0)} label="Completed gigs" />
            <StatTile value={profile.rating !== null ? `★ ${Number(profile.rating).toFixed(1)}` : "New"} label={profile.rating_count > 0 ? `${profile.rating_count} ratings` : "Rating"} />
            <StatTile value={profile.reliability === null ? "Building" : `${Math.round(profile.reliability / 100)}%`} label="On time" />
          </TileGrid>

          {profile.follower_bands.length > 0 ? (
            <>
              <SectionLabel>Verified audience</SectionLabel>
              <ListGroup>
                {profile.follower_bands.map((band) => (
                  <ListRow key={band.platform} title={platformLabel(band.platform)} right={followerBandLabel(band.band) || "Verified"} chevron={false} />
                ))}
              </ListGroup>
            </>
          ) : null}

          {profile.packages.length > 0 ? (
            <>
              <SectionLabel>Packages</SectionLabel>
              <ListGroup>
                {profile.packages.map((item) => (
                  <ListRow
                    key={item.id}
                    title={formatName(item.format_key)}
                    subtitle={`${item.turnaround_days} day${item.turnaround_days === 1 ? "" : "s"} to deliver · reuse for ${item.includes_usage_days} days`}
                    right={programMoney(item.price_minor, item.currency)}
                    chevron={false}
                  />
                ))}
              </ListGroup>
            </>
          ) : null}
        </>
      ) : null}
    </ProgramScreen>
  );
}
