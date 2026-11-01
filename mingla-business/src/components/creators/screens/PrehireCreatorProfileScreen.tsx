/**
 * #3872 — creator profile before hire. Round 2 (approved M-prehire): name,
 * niches and Verified in one row, a three-number strip, three showcase
 * thumbnails, packages, and Offer at the bottom (Not now in the title bar).
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Button } from "../../../components/ui/Button";
import {
  HireSheet,
  type HireSheetMode,
} from "../../../components/gigs/HireSheet";
import {
  FieldError,
  Initials,
  ListGroup,
  ListRow,
  Muted,
  ProgramEmpty,
  ProgramLoading,
  ProgramScreen,
  SectionLabel,
  StatStrip,
  StatusTag,
} from "../../../components/programs/ProgramKit";
import { blastHubHref } from "../../../components/marketing/marketingSubNavTabs";
import {
  accent,
  spacing,
  text as textTokens,
} from "../../../constants/designSystem";
import { ShowcaseStrip } from "../../../components/programs/ShowcaseStrip";
import { useProgramParams } from "../../../components/programs/useProgramParams";
import {
  creatorGigsService,
  type GigApplicant,
  type HostGig,
  type PrehireProfile,
} from "../../../services/creatorGigsService";
import {
  followerBandLabel,
  formatName,
  nicheLabel,
  platformLabel,
  programErrorMessage,
  programMoney,
} from "../../../utils/creatorProgramFormat";

export default function PrehireCreatorProfile(): React.ReactElement {
  const router = useRouter();
  const { brandId, params } = useProgramParams(
    "creatorId",
    "gigId",
    "interestId",
  );
  const creatorId = params.creatorId ?? "";
  const [profile, setProfile] = useState<PrehireProfile | null | undefined>(
    undefined,
  );
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
        params.gigId
          ? creatorGigsService
              .applicants(params.gigId)
              .catch(() => [] as GigApplicant[])
          : Promise.resolve([] as GigApplicant[]),
        params.gigId
          ? creatorGigsService.hostHome(brandId).catch(() => null)
          : Promise.resolve(null),
      ]);
      setProfile(nextProfile ?? null);
      setApplicant(
        applicants.find(
          (row) =>
            row.interest_id === params.interestId ||
            row.creator_id === creatorId,
        ) ?? null,
      );
      setGig(home?.gigs.find((row) => row.id === params.gigId) ?? null);
    } catch (loadError) {
      setProfile(null);
      setError(
        programErrorMessage(
          loadError,
          "We couldn't load this creator. Pull to try again.",
        ),
      );
    }
  }, [brandId, creatorId, params.gigId, params.interestId]);
  useEffect(() => {
    void load();
  }, [load]);

  const name = profile?.display_name ?? applicant?.display_name ?? "Creator";
  const canHire =
    applicant !== null &&
    applicant.status !== "passed" &&
    applicant.status !== "hired";
  const notNow = async () => {
    if (!applicant) return router.back();
    setPassing(true);
    setActionError(null);
    try {
      const result = await creatorGigsService.decideInterest(
        applicant.interest_id,
        "passed",
      );
      if (!result.ok) throw new Error(result.error ?? "update_failed");
      router.back();
    } catch (passError) {
      setActionError(
        programErrorMessage(
          passError,
          "We couldn't update this creator. Try again.",
        ),
      );
    } finally {
      setPassing(false);
    }
  };

  const offerLabel = applicant
    ? `Offer ${programMoney(applicant.quote_minor, applicant.currency)}`
    : "Offer";
  return (
    <ProgramScreen
      title="Creator"
      fallback={
        params.gigId
          ? `/brand/${brandId}/creators/${params.gigId}/interest`
          : blastHubHref("creators")
      }
      right={
        canHire ? (
          <Pressable
            onPress={() => void notNow()}
            accessibilityRole="button"
            accessibilityLabel={`Not now: pass on ${name}`}
            hitSlop={8}
            disabled={passing}
          >
            <Text style={styles.pass}>{passing ? "…" : "Not now"}</Text>
          </Pressable>
        ) : undefined
      }
      refreshing={false}
      onRefresh={() => void load()}
      footer={
        canHire && applicant ? (
          <>
            <FieldError message={actionError} />
            <Button
              fullWidth
              size="lg"
              label={offerLabel}
              onPress={() =>
                setHireMode({
                  kind: "hire",
                  interestId: applicant.interest_id,
                  quoteMinor: applicant.quote_minor,
                  allowCounter: true,
                })
              }
            />
          </>
        ) : undefined
      }
      overlay={
        hireMode && applicant ? (
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
              router.replace(
                `/brand/${brandId}/creators/contract/${contractId}` as never,
              );
            }}
          />
        ) : undefined
      }
    >
      {profile === undefined ? <ProgramLoading /> : null}
      {error ? <FieldError message={error} /> : null}
      {profile === null && !error ? (
        <ProgramEmpty
          icon="user"
          title="This profile isn't available"
          body="The creator may have paused their profile."
        />
      ) : null}
      {profile ? (
        <>
          <View style={styles.who}>
            <Initials name={name} size={52} />
            <View style={styles.whoText}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              <Text style={styles.sub} numberOfLines={2}>
                {[
                  profile.niches.map(nicheLabel).join(", "),
                  profile.languages.join(", "),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>
            <StatusTag label="Verified" tone="live" />
          </View>

          <StatStrip
            items={[
              { value: String(profile.completed ?? 0), label: "Gigs done" },
              {
                value:
                  profile.rating !== null
                    ? `★ ${Number(profile.rating).toFixed(1)}`
                    : "New",
                label: "Rating",
              },
              {
                value:
                  profile.reliability === null
                    ? "—"
                    : `${Math.round(profile.reliability / 100)}%`,
                label: "On time",
              },
            ]}
          />

          {profile.showcase.length > 0 ? (
            <ShowcaseStrip
              items={profile.showcase.slice(0, 3)}
              creatorName={name}
            />
          ) : null}

          {applicant?.note ? <Muted>{`"${applicant.note}"`}</Muted> : null}

          {profile.packages.length > 0 ? (
            <>
              <SectionLabel>Packages</SectionLabel>
              <ListGroup>
                {profile.packages.map((item) => (
                  <ListRow
                    key={item.id}
                    compact
                    title={formatName(item.format_key)}
                    subtitle={`${item.turnaround_days} day${item.turnaround_days === 1 ? "" : "s"} · perpetual marketing rights after full fee release`}
                    right={programMoney(item.price_minor, item.currency)}
                    chevron={false}
                  />
                ))}
              </ListGroup>
            </>
          ) : null}

          {profile.follower_bands.length > 0 ? (
            <>
              <SectionLabel>Verified audience</SectionLabel>
              <ListGroup>
                {profile.follower_bands.map((band) => (
                  <ListRow
                    key={band.platform}
                    compact
                    title={platformLabel(band.platform)}
                    right={followerBandLabel(band.band) || "Verified"}
                    chevron={false}
                  />
                ))}
              </ListGroup>
            </>
          ) : null}
          <Text style={styles.tiny}>Handles are shared when you hire.</Text>
        </>
      ) : null}
    </ProgramScreen>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  whoText: { flex: 1, minWidth: 0, gap: 2 },
  name: { color: textTokens.primary, fontSize: 18, fontWeight: "800" },
  sub: { color: textTokens.secondary, fontSize: 13, lineHeight: 18 },
  pass: { color: accent.warm, fontSize: 15, fontWeight: "700" },
  tiny: { color: textTokens.tertiary, fontSize: 12, lineHeight: 16 },
});
