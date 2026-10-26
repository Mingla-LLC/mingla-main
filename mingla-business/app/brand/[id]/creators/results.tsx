/**
 * #3872 — Creator results. Round 2 (approved M-results): one strip — sold
 * (with tickets), spent in the normal colour, and return, which shows "—"
 * until a creator's link makes a sale — then one row per creator with Book
 * again on the row. A 7 days / 30 days / All segment passes p_since.
 */
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";

import { Button } from "../../../../src/components/ui/Button";
import {
  FieldError,
  Initials,
  ListGroup,
  ListRow,
  ProgramEmpty,
  ProgramLoading,
  ProgramScreen,
  Segmented,
  StatStrip,
} from "../../../../src/components/programs/ProgramKit";
import { useProgramParams } from "../../../../src/components/programs/useProgramParams";
import { summarizeResults } from "../../../../src/components/programs/resultsSummary";
import { blastHubHref } from "../../../../src/components/marketing/marketingSubNavTabs";
import {
  creatorGigsService,
  type GigResult,
} from "../../../../src/services/creatorGigsService";
import {
  programErrorMessage,
  programMoney,
  programMoneyShort,
  resultsSince,
  type ResultsPeriod,
} from "../../../../src/utils/creatorProgramFormat";
import { text as textTokens } from "../../../../src/constants/designSystem";

export default function CreatorResults(): React.ReactElement {
  const router = useRouter();
  const { brandId, params, currency } = useProgramParams("gigId");
  const [rows, setRows] = useState<GigResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<ResultsPeriod>("30d");

  const load = useCallback(async () => {
    if (!brandId) return;
    setError(null);
    try {
      setRows(
        await creatorGigsService.results(
          brandId,
          params.gigId ?? null,
          resultsSince(period),
        ),
      );
    } catch (loadError) {
      setRows((current) => current ?? []);
      setError(
        programErrorMessage(
          loadError,
          "We couldn't load results. Pull to try again.",
        ),
      );
    }
  }, [brandId, params.gigId, period]);
  useEffect(() => {
    void load();
  }, [load]);

  const summary = summarizeResults(rows ?? []);
  const code = summary.currency ?? currency;

  return (
    <ProgramScreen
      title="Results"
      fallback={blastHubHref("creators")}
      refreshing={false}
      onRefresh={() => void load()}
    >
      <Segmented
        options={
          [
            ["7d", "7 days"],
            ["30d", "30 days"],
            ["all", "All"],
          ] as const
        }
        value={period}
        onChange={setPeriod}
      />
      {rows === null ? <ProgramLoading /> : null}
      <FieldError message={error} />
      {rows !== null && rows.length === 0 && !error ? (
        <ProgramEmpty
          icon="chart"
          title="No results yet"
          body="Sales and link clicks show here once a creator's posts are live."
        />
      ) : null}
      {rows !== null && rows.length > 0 ? (
        <>
          <StatStrip
            items={[
              {
                value: programMoneyShort(summary.soldMinor, code),
                label: `Sold · ${summary.tickets} ticket${summary.tickets === 1 ? "" : "s"}`,
              },
              { value: programMoneyShort(summary.spentMinor, code), label: "Spent" },
              {
                value:
                  summary.returnOnSpend === null
                    ? "—"
                    : `${summary.returnOnSpend.toFixed(1)}×`,
                label: "Return",
              },
            ]}
          />
          <ListGroup>
            {summary.creators.map((creator) => (
              <ListRow
                key={creator.id}
                compact
                leading={<Initials name={creator.name} size={32} />}
                title={creator.name}
                subtitle={`${creator.clicks} clicks · ${creator.tickets} sold · ${programMoney(creator.spentMinor, code)}`}
                chevron={false}
                right={
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Book again"
                    accessibilityLabel={`Book ${creator.name} again`}
                    onPress={() =>
                      router.push(
                        `/brand/${brandId}/creators/brief?fromGigId=${creator.lastGigId}` as never,
                      )
                    }
                  />
                }
              />
            ))}
          </ListGroup>
          {summary.returnOnSpend === null ? (
            <Text style={styles.tiny}>
              Return shows once a creator's link makes a sale.
            </Text>
          ) : null}
        </>
      ) : null}
    </ProgramScreen>
  );
}

const styles = StyleSheet.create({
  tiny: { color: textTokens.tertiary, fontSize: 12, lineHeight: 16 },
});
