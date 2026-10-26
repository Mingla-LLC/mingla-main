/**
 * #3872 — Creator results (approved P-results): sales, return on spend and
 * link clicks across creators, one row per creator, and Book again.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { useRouter } from "expo-router";

import { Button } from "../../../../src/components/ui/Button";
import {
  Card,
  FieldError,
  Initials,
  ListGroup,
  ListRow,
  Muted,
  ProgramLoading,
  ProgramScreen,
  StatTile,
  TileGrid,
  programStyles,
} from "../../../../src/components/programs/ProgramKit";
import { useProgramParams } from "../../../../src/components/programs/useProgramParams";
import { summarizeResults } from "../../../../src/components/programs/resultsSummary";
import { creatorGigsService, type GigResult } from "../../../../src/services/creatorGigsService";
import { programErrorMessage, programMoney, programMoneyShort } from "../../../../src/utils/creatorProgramFormat";

export default function CreatorResults(): React.ReactElement {
  const router = useRouter();
  const { brandId, params, currency } = useProgramParams("gigId");
  const [rows, setRows] = useState<GigResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!brandId) return;
    setError(null);
    try {
      setRows(await creatorGigsService.results(brandId, params.gigId ?? null));
    } catch (loadError) {
      setRows((current) => current ?? []);
      setError(programErrorMessage(loadError, "We couldn't load results. Pull to try again."));
    }
  }, [brandId, params.gigId]);
  useEffect(() => { void load(); }, [load]);

  const summary = summarizeResults(rows ?? []);
  const code = summary.currency ?? currency;
  const top = summary.creators[0] ?? null;

  return (
    <ProgramScreen
      title="Results"
      fallback={`/brand/${brandId}/creators`}
      refreshing={false}
      onRefresh={() => void load()}
      footer={top ? <Button fullWidth label={`Book ${top.name} again`} onPress={() => router.push(`/brand/${brandId}/creators/brief?fromGigId=${top.lastGigId}` as never)} /> : undefined}
    >
      {rows === null ? <ProgramLoading /> : null}
      <FieldError message={error} />
      {rows !== null && rows.length === 0 && !error ? (
        <Card>
          <Text style={programStyles.title}>No results yet</Text>
          <Muted>Sales and link clicks show here once a creator's posts are live.</Muted>
        </Card>
      ) : null}
      {rows !== null && rows.length > 0 ? (
        <>
          <TileGrid>
            <StatTile icon="cash" value={programMoneyShort(summary.soldMinor, code)} label="Sold via creators" hint={`${summary.tickets} ticket${summary.tickets === 1 ? "" : "s"}`} />
            <StatTile icon="trending" value={summary.returnOnSpend === null ? "—" : `${summary.returnOnSpend.toFixed(1)}×`} label="Return on spend" hint={`${programMoneyShort(summary.spentMinor, code)} spent`} />
            <StatTile icon="link" value={String(summary.clicks)} label="Link clicks" hint={summary.conversion === null ? null : `${summary.conversion.toFixed(1)}% bought`} />
            <StatTile icon="users" value={String(summary.creators.length)} label="Creators hired" />
          </TileGrid>
          <ListGroup>
            {summary.creators.map((creator) => (
              <ListRow
                key={creator.id}
                leading={<Initials name={creator.name} />}
                title={creator.name}
                subtitle={`${creator.clicks} clicks · ${creator.tickets} sold`}
                right={programMoney(creator.soldMinor, code)}
                onPress={() => router.push(`/brand/${brandId}/creators/brief?fromGigId=${creator.lastGigId}` as never)}
                accessibilityLabel={`Book ${creator.name} again`}
              />
            ))}
          </ListGroup>
          <Muted>Tap a creator to book them again with the same brief.</Muted>
        </>
      ) : null}
    </ProgramScreen>
  );
}
