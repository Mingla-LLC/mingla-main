/**
 * #3872 — one gig (approved P-find-on-event / P-applicants / M-applicants):
 * Interested · Hired · Results. Applicants show money and audience in words,
 * showcase thumbnails and one row of Pass / Counter / Hire for $X. A gig with
 * no interest shows "Your gig is live", never a phantom applicant.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Button } from "../../../../../src/components/ui/Button";
import { SimpleConfirmDialog } from "../../../../../src/components/ui/SimpleConfirmDialog";
import {
  HireSheet,
  type HireSheetMode,
} from "../../../../../src/components/gigs/HireSheet";
import {
  Card,
  Chip,
  FieldError,
  Initials,
  ListGroup,
  ListRow,
  Muted,
  ProgramLoading,
  ProgramScreen,
  Segmented,
  StatusTag,
  programStyles,
} from "../../../../../src/components/programs/ProgramKit";
import { ShowcaseStrip } from "../../../../../src/components/programs/ShowcaseStrip";
import { useProgramParams } from "../../../../../src/components/programs/useProgramParams";
import {
  briefFromGig,
  gigPayload,
} from "../../../../../src/components/programs/gigBrief";
import {
  sortApplicants,
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
  bandsForCurrency,
  budgetDisplay,
  hostContractRowStatus,
  nicheLabel,
  programErrorMessage,
  programMoney,
  shortDate,
  type BudgetBandRange,
} from "../../../../../src/utils/creatorProgramFormat";
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
  const [bands, setBands] = useState<BudgetBandRange[]>([]);
  const [showcases, setShowcases] = useState<
    Record<string, Array<{ media_id: string }>>
  >({});
  const [tab, setTab] = useState<Tab>("interested");
  const [filter, setFilter] = useState<Filter>("best");
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hire, setHire] = useState<{
    applicant: GigApplicant;
    mode: HireSheetMode;
  } | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);

  const load = useCallback(async () => {
    if (!brandId || !gigId) return;
    setError(null);
    try {
      const [home, applicants, nextBands] = await Promise.all([
        creatorGigsService.hostHome(brandId),
        creatorGigsService.applicants(gigId),
        creatorGigsService.budgetBands(),
      ]);
      setGig(home.gigs.find((row) => row.id === gigId) ?? null);
      setContracts(home.contracts.filter((row) => row.gig_id === gigId));
      setItems(applicants);
      setBands(nextBands);
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

  // Showcase thumbnails come from each creator's pre-hire profile.
  useEffect(() => {
    if (!items) return;
    const missing = items
      .filter((item) => showcases[item.creator_id] === undefined)
      .slice(0, 10);
    if (missing.length === 0) return;
    void Promise.all(
      missing.map((item) =>
        creatorGigsService
          .prehireProfile(item.creator_id)
          .then(
            (profile) => [item.creator_id, profile?.showcase ?? []] as const,
          )
          .catch(() => [item.creator_id, []] as const),
      ),
    ).then((pairs) =>
      setShowcases((current) => ({ ...current, ...Object.fromEntries(pairs) })),
    );
  }, [items, showcases]);

  const currency = gig?.currency ?? items?.[0]?.currency ?? "USD";
  const bandRow = useMemo(
    () =>
      bandsForCurrency(bands, currency).find(
        (row) => row.band === gig?.budget_band,
      ) ?? null,
    [bands, currency, gig?.budget_band],
  );
  const budget = budgetDisplay({
    budget_min_minor: bandRow?.min_minor,
    budget_max_minor: bandRow?.max_minor,
    budget_currency: bandRow ? currency : null,
    budget_band: gig?.budget_band,
  });
  const sorted = sortApplicants(
    items ?? [],
    filter,
    bandRow?.max_minor ?? null,
  );
  const hiredIds = new Set(
    contracts.filter((row) => !row.payment_pending).map((row) => row.creator),
  );

  const pass = async (item: GigApplicant) => {
    setBusyId(item.interest_id);
    setActionError(null);
    try {
      const result = await creatorGigsService.decideInterest(
        item.interest_id,
        "passed",
      );
      if (!result.ok) throw new Error(result.error ?? "update_failed");
      await load();
    } catch (passError) {
      setActionError(
        programErrorMessage(
          passError,
          `We couldn't pass on ${item.display_name}. Try again.`,
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  const closeGig = async () => {
    if (!gig) return;
    setCloseBusy(true);
    try {
      const form = briefFromGig(gig, currency);
      const payload = {
        ...gigPayload({
          form,
          ctx: { currency, today: "", bands: [] },
          payMinor: null,
          brandId,
          listingKind: gig.listing_kind,
          listingId: gig.listing_id,
          gigId: gig.id,
        }),
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

  const hiring = gig
    ? `Hiring ${gig.slots} · ${budget.kind === "range" ? `${budget.label} each` : budget.label}`
    : "";
  return (
    <ProgramScreen
      title={gig ? gig.title_public : "Gig"}
      fallback={`/brand/${brandId}/creators`}
      right={
        gig && (gig.status === "open" || gig.status === "draft") ? (
          <Button
            size="sm"
            variant="ghost"
            label="Edit"
            onPress={() =>
              router.push(
                `/brand/${brandId}/creators/brief?gigId=${gig.id}` as never,
              )
            }
          />
        ) : undefined
      }
      refreshing={false}
      onRefresh={() => void load()}
      overlay={
        <>
          {hire ? (
            <HireSheet
              visible
              onClose={() => setHire(null)}
              mode={hire.mode}
              creatorName={hire.applicant.display_name}
              currency={hire.applicant.currency}
              salesShareBps={gig?.sales_share_bps ?? null}
              usageDays={gig?.usage_days ?? null}
              onPaid={(contractId) => {
                setHire(null);
                router.push(
                  `/brand/${brandId}/creators/contract/${contractId}` as never,
                );
              }}
            />
          ) : null}
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
          <Segmented
            options={
              [
                ["interested", `Interested · ${sorted.length}`],
                ["hired", "Hired"],
                ["results", "Results"],
              ] as const
            }
            value={tab}
            onChange={setTab}
          />
          <FieldError message={actionError} />

          {tab === "interested" ? (
            <>
              {hiring ? <Muted>{hiring}</Muted> : null}
              {sorted.length > 0 || filter !== "best" ? (
                <View style={styles.chips}>
                  <Chip
                    label="Best match"
                    selected={filter === "best"}
                    onPress={() => setFilter("best")}
                  />
                  {bandRow ? (
                    <Chip
                      label="Within budget"
                      selected={filter === "budget"}
                      onPress={() => setFilter("budget")}
                    />
                  ) : null}
                  <Chip
                    label="Top rated"
                    selected={filter === "rated"}
                    onPress={() => setFilter("rated")}
                  />
                </View>
              ) : null}
              {sorted.length === 0 ? (
                <Card>
                  <Text style={programStyles.title}>
                    {filter === "best"
                      ? "Your gig is live"
                      : "No one matches this filter"}
                  </Text>
                  <Muted>
                    {filter === "best"
                      ? "Matching creators near you can see it now. We'll let you know as they show interest."
                      : "Try another filter."}
                  </Muted>
                  {gig ? (
                    <Text
                      style={programStyles.small}
                    >{`Brand hidden until you hire · Post by ${shortDate(gig.post_by)}`}</Text>
                  ) : null}
                </Card>
              ) : (
                sorted.map((item) => {
                  const quote = programMoney(item.quote_minor, item.currency);
                  const record =
                    item.rating !== null
                      ? `★ ${item.rating.toFixed(1)} · ${item.completed} gig${item.completed === 1 ? "" : "s"}`
                      : item.completed > 0
                        ? `${item.completed} gigs`
                        : "New creator · verified";
                  const profileHref = `/brand/${brandId}/creators/profile/${item.creator_id}?gigId=${gigId}&interestId=${item.interest_id}`;
                  return (
                    <Card key={item.interest_id}>
                      <ListRow
                        leading={<Initials name={item.display_name} />}
                        title={item.display_name}
                        subtitle={[
                          item.niches.slice(0, 2).map(nicheLabel).join(", "),
                          audienceLabel(item.follower_bands),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        right={
                          <View style={styles.quote}>
                            <Text style={styles.quoteValue}>{quote}</Text>
                            <Text style={programStyles.small}>{record}</Text>
                          </View>
                        }
                        chevron={false}
                        onPress={() => router.push(profileHref as never)}
                        accessibilityLabel={`View ${item.display_name}'s profile`}
                      />
                      {item.note ? (
                        <Text style={styles.note}>{`"${item.note}"`}</Text>
                      ) : null}
                      <ShowcaseStrip
                        items={showcases[item.creator_id] ?? []}
                        creatorName={item.display_name}
                      />
                      {hiredIds.has(item.display_name) ||
                      item.status === "hired" ? (
                        <StatusTag label="Hired" tone="done" />
                      ) : (
                        <View style={programStyles.footerRow}>
                          <Button
                            size="sm"
                            variant="secondary"
                            label="Pass"
                            loading={busyId === item.interest_id}
                            onPress={() => void pass(item)}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            label="Counter"
                            onPress={() =>
                              setHire({
                                applicant: item,
                                mode: {
                                  kind: "hire",
                                  interestId: item.interest_id,
                                  quoteMinor: item.quote_minor,
                                  allowCounter: true,
                                },
                              })
                            }
                          />
                          <Button
                            size="sm"
                            style={programStyles.grow}
                            label={`Hire for ${quote}`}
                            onPress={() =>
                              setHire({
                                applicant: item,
                                mode: {
                                  kind: "hire",
                                  interestId: item.interest_id,
                                  quoteMinor: item.quote_minor,
                                },
                              })
                            }
                          />
                        </View>
                      )}
                    </Card>
                  );
                })
              )}
              <Muted>
                Handles and contact details are shared after a creator accepts
                your paid offer.
              </Muted>
            </>
          ) : null}

          {tab === "hired" ? (
            contracts.length === 0 ? (
              <Card>
                <Text style={programStyles.title}>No one hired yet</Text>
                <Muted>
                  When you hire a creator, their work shows here step by step.
                </Muted>
              </Card>
            ) : (
              <ListGroup>
                {contracts.map((contract) => {
                  const status = hostContractRowStatus(contract);
                  return (
                    <ListRow
                      key={contract.id}
                      leading={<Initials name={contract.creator} />}
                      title={contract.creator}
                      subtitle={
                        contract.payment_pending
                          ? "Retry payment from Interested"
                          : null
                      }
                      right={
                        <StatusTag label={status.label} tone={status.tone} />
                      }
                      onPress={() =>
                        contract.payment_pending
                          ? setTab("interested")
                          : router.push(
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
              <Card>
                <Text style={programStyles.title}>No results yet</Text>
                <Muted>
                  Sales and clicks show here once a creator's posts are live.
                </Muted>
              </Card>
            ) : (
              <ListGroup>
                {results.map((row) => (
                  <ListRow
                    key={row.contract_id}
                    leading={<Initials name={row.creator_display_name} />}
                    title={row.creator_display_name}
                    subtitle={`${row.clicks} clicks · ${row.tickets} sold`}
                    right={programMoney(row.sold_minor, row.currency)}
                    chevron={false}
                  />
                ))}
              </ListGroup>
            )
          ) : null}

          {gig && gig.status === "open" ? (
            <Button
              variant="secondary"
              label="Close gig"
              onPress={() => setClosing(true)}
            />
          ) : null}
        </>
      ) : null}
    </ProgramScreen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  quote: { alignItems: "flex-end", gap: 2 },
  quoteValue: { color: textTokens.primary, fontSize: 17, fontWeight: "800" },
  note: {
    color: textTokens.secondary,
    fontStyle: "italic",
    fontSize: 14,
    lineHeight: 20,
  },
});
