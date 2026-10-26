/**
 * #3872 — one gig. Round 2 (approved M-gig): a one-line summary, a segment
 * (Interested n · Hired n · Results), sort chips (Best match, Top rated,
 * Lowest price) and one compact row per creator — photo, niches, audience,
 * rating, price. A creator hired on this gig shows only under Hired. Edit and
 * Close gig live in the ⋯ menu. Hiring starts from the creator's profile.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Button } from "../../../../../src/components/ui/Button";
import { Icon } from "../../../../../src/components/ui/Icon";
import { Sheet } from "../../../../../src/components/ui/Sheet";
import { SimpleConfirmDialog } from "../../../../../src/components/ui/SimpleConfirmDialog";
import {
  Chip,
  FieldError,
  Initials,
  ListGroup,
  ListRow,
  ProgramEmpty,
  ProgramLoading,
  ProgramScreen,
  Segmented,
  SheetBody,
  StatusTag,
} from "../../../../../src/components/programs/ProgramKit";
import { useProgramParams } from "../../../../../src/components/programs/useProgramParams";
import {
  briefFromGig,
  gigPayload,
} from "../../../../../src/components/programs/gigBrief";
import {
  APPLICANT_FILTERS,
  hiredContracts,
  interestedApplicants,
  type ApplicantFilter as Filter,
} from "../../../../../src/components/programs/applicantFilters";
import {
  creatorGigsService,
  type GigApplicant,
  type GigResult,
  type HostContractSummary,
  type HostGig,
} from "../../../../../src/services/creatorGigsService";
import {
  audienceLabel,
  hostContractPill,
  nicheLabel,
  programErrorMessage,
  programMoney,
  programMoneyShort,
  videoDueWords,
} from "../../../../../src/utils/creatorProgramFormat";
import { blastHubHref } from "../../../../../src/components/marketing/marketingSubNavTabs";
import {
  spacing,
  text as textTokens,
} from "../../../../../src/constants/designSystem";

type Tab = "interested" | "hired" | "results";

export default function GigApplicants(): React.ReactElement {
  const router = useRouter();
  const { brandId, params } = useProgramParams("gigId");
  const gigId = params.gigId ?? "";
  const [gig, setGig] = useState<HostGig | null>(null);
  const [contracts, setContracts] = useState<HostContractSummary[]>([]);
  const [items, setItems] = useState<GigApplicant[] | null>(null);
  const [results, setResults] = useState<GigResult[] | null>(null);
  const [tab, setTab] = useState<Tab>("interested");
  const [filter, setFilter] = useState<Filter>("best");
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);

  const load = useCallback(async () => {
    if (!brandId || !gigId) return;
    setError(null);
    try {
      const [home, applicants] = await Promise.all([
        creatorGigsService.hostHome(brandId),
        creatorGigsService.applicants(gigId),
      ]);
      setGig(home.gigs.find((row) => row.id === gigId) ?? null);
      setContracts(home.contracts.filter((row) => row.gig_id === gigId));
      setItems(applicants);
    } catch (loadError) {
      setItems((current) => current ?? []);
      setError(
        programErrorMessage(
          loadError,
          "We couldn't load this gig. Pull to try again.",
        ),
      );
    }
  }, [brandId, gigId]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab !== "results" || results !== null) return;
    void creatorGigsService
      .results(brandId, gigId)
      .then(setResults)
      .catch(() => setResults([]));
  }, [tab, results, brandId, gigId]);

  const currency = gig?.currency ?? items?.[0]?.currency ?? "USD";
  const interested = useMemo(
    () => interestedApplicants(items ?? [], contracts, filter),
    [items, contracts, filter],
  );
  const hired = hiredContracts(contracts);
  const unpaid = contracts.filter((row) => row.payment_pending);
  const hiredRows = [...hired, ...unpaid];

  const closeGig = async () => {
    if (!gig) return;
    setCloseBusy(true);
    try {
      const form = briefFromGig(gig, currency);
      const payload = {
        ...gigPayload({
          form,
          ctx: { currency, today: gig.shoot_window_start, bands: [] },
          payMinor: null,
          brandId,
          listingKind: gig.listing_kind,
          listingId: gig.listing_id,
          gigId: gig.id,
        }),
        // Closing keeps the gig's own dates and level exactly as saved.
        shoot_window_start: gig.shoot_window_start,
        shoot_window_end: gig.shoot_window_end,
        post_by: gig.post_by,
        budget_band: gig.budget_band,
        status: "closed",
      };
      const result = await creatorGigsService.saveGig(payload);
      if (!result.ok) throw new Error(result.error ?? "close_failed");
      setClosing(false);
      await load();
    } catch (closeError) {
      setActionError(
        programErrorMessage(
          closeError,
          "We couldn't close this gig. Try again.",
        ),
      );
      setClosing(false);
    } finally {
      setCloseBusy(false);
    }
  };

  const payUpTo =
    typeof gig?.pay_up_to_minor === "number"
      ? `up to ${programMoneyShort(gig.pay_up_to_minor, currency)}`
      : null;
  const summary = gig
    ? [
        `Hiring ${gig.slots}`,
        payUpTo,
        gig.post_by || gig.video_due_at
          ? `video by ${videoDueWords(gig.video_due_at, gig.post_by)}`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const canEdit = gig !== null && (gig.status === "open" || gig.status === "draft");
  const canClose = gig !== null && gig.status === "open";

  return (
    <ProgramScreen
      title={gig ? gig.title_public : "Gig"}
      fallback={blastHubHref("creators")}
      right={
        canEdit || canClose ? (
          <Pressable
            onPress={() => setMenuOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Gig options"
            hitSlop={8}
            style={styles.more}
          >
            <Icon name="moreH" size={22} color={textTokens.primary} />
          </Pressable>
        ) : undefined
      }
      refreshing={false}
      onRefresh={() => void load()}
      overlay={
        <>
          <Sheet
            visible={menuOpen}
            onClose={() => setMenuOpen(false)}
            snapPoint="half"
          >
            <SheetBody title="Gig options">
              {canEdit ? (
                <Button
                  fullWidth
                  variant="secondary"
                  label="Edit gig"
                  onPress={() => {
                    setMenuOpen(false);
                    if (gig)
                      router.push(
                        `/brand/${brandId}/creators/brief?gigId=${gig.id}` as never,
                      );
                  }}
                />
              ) : null}
              {canClose ? (
                <Button
                  fullWidth
                  variant="destructiveOutline"
                  label="Close gig"
                  onPress={() => {
                    setMenuOpen(false);
                    setClosing(true);
                  }}
                />
              ) : null}
            </SheetBody>
          </Sheet>
          <SimpleConfirmDialog
            visible={closing}
            onClose={() => setClosing(false)}
            onConfirm={() => void closeGig()}
            title="Close this gig?"
            description="Creators stop seeing it. People you've already hired keep working."
            confirmLabel="Close gig"
            destructive
            confirmLoading={closeBusy}
          />
        </>
      }
    >
      {items === null ? <ProgramLoading /> : null}
      {error ? <FieldError message={error} /> : null}
      {items !== null ? (
        <>
          {summary ? <Text style={styles.summary}>{summary}</Text> : null}
          <Segmented
            options={
              [
                ["interested", `Interested ${interested.length}`],
                ["hired", `Hired ${hired.length}`],
                ["results", "Results"],
              ] as const
            }
            value={tab}
            onChange={setTab}
          />
          <FieldError message={actionError} />

          {tab === "interested" ? (
            <>
              {interested.length > 0 || filter !== "best" ? (
                <View style={styles.chips}>
                  {APPLICANT_FILTERS.map(([key, label]) => (
                    <Chip
                      key={key}
                      label={label}
                      selected={filter === key}
                      onPress={() => setFilter(key)}
                    />
                  ))}
                </View>
              ) : null}
              {interested.length === 0 ? (
                <ProgramEmpty
                  icon="video"
                  title="Your gig is live"
                  body="Creators near you can see it now. We'll tell you as they show interest."
                />
              ) : (
                <ListGroup>
                  {interested.map((item) => {
                    const record =
                      item.rating !== null
                        ? `★ ${item.rating.toFixed(1)}`
                        : item.completed > 0
                          ? `${item.completed} gigs`
                          : "New";
                    return (
                      <ListRow
                        key={item.interest_id}
                        compact
                        leading={<Initials name={item.display_name} size={32} />}
                        title={item.display_name}
                        subtitle={[
                          item.niches.slice(0, 1).map(nicheLabel).join(""),
                          audienceLabel(item.follower_bands),
                          record,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        right={programMoney(item.quote_minor, item.currency)}
                        onPress={() =>
                          router.push(
                            `/brand/${brandId}/creators/profile/${item.creator_id}?gigId=${gigId}&interestId=${item.interest_id}` as never,
                          )
                        }
                        accessibilityLabel={`View ${item.display_name}'s profile`}
                      />
                    );
                  })}
                </ListGroup>
              )}
              <Text style={styles.tiny}>
                Handles and contact details are shared after a creator accepts
                your offer.
              </Text>
            </>
          ) : null}

          {tab === "hired" ? (
            hiredRows.length === 0 ? (
              <ProgramEmpty
                icon="user"
                title="No one hired yet"
                body="When you hire a creator, their work shows here step by step."
              />
            ) : (
              <ListGroup>
                {hiredRows.map((contract) => {
                  const pill = hostContractPill(contract);
                  return (
                    <ListRow
                      key={contract.id}
                      compact
                      leading={<Initials name={contract.creator} size={32} />}
                      title={contract.creator}
                      subtitle={
                        contract.payment_pending
                          ? "Payment not completed"
                          : contract.fee_minor !== null
                            ? programMoney(contract.fee_minor, contract.currency ?? currency)
                            : null
                      }
                      right={<StatusTag label={pill.label} tone={pill.tone} />}
                      onPress={() =>
                        router.push(
                          `/brand/${brandId}/creators/contract/${contract.id}` as never,
                        )
                      }
                    />
                  );
                })}
              </ListGroup>
            )
          ) : null}

          {tab === "results" ? (
            results === null ? (
              <ProgramLoading />
            ) : results.length === 0 ? (
              <ProgramEmpty
                icon="chart"
                title="No results yet"
                body="Sales and clicks show here once a creator's posts are live."
              />
            ) : (
              <ListGroup>
                {results.map((row) => (
                  <ListRow
                    key={row.contract_id}
                    compact
                    leading={<Initials name={row.creator_display_name} size={32} />}
                    title={row.creator_display_name}
                    subtitle={`${row.clicks} clicks · ${row.tickets} sold`}
                    right={programMoney(row.sold_minor, row.currency)}
                    chevron={false}
                  />
                ))}
              </ListGroup>
            )
          ) : null}
        </>
      ) : null}
    </ProgramScreen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summary: { color: textTokens.secondary, fontSize: 13 },
  tiny: { color: textTokens.tertiary, fontSize: 12, lineHeight: 16 },
  more: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
