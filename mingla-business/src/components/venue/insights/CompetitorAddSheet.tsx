/**
 * Issue #1735 G-10 — the "+ Watch a competitor" add flow (house sheet chrome).
 *
 * Search-first typeahead on the P-46 app-lane `search` action (≤5 place_pool
 * rows, city-biased to the venue) — a result tap prefills
 * name/city/website/placePoolId; manual fallback ("Can't find them? Enter
 * their website") takes name + city + URL, the engine's exact requireds.
 * A result or manual entry WITHOUT a website cannot be submitted — the sheet
 * says so honestly ("We can only grade sites we can reach…") instead of
 * accepting a dead row.
 *
 * 409s map to the two DISTINCT copies: `duplicate_competitor` → "You're
 * already watching this site." · `watch_limit` → the cap copy. Success →
 * list invalidated (mutation hook) + sheet closes. Failures on this
 * explicit-tap surface always SPEAK.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQuery } from "@tanstack/react-query";

import {
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";
import { captureIntelCompetitorAdded } from "../../../analytics/businessAnalyticsEvents";
import { useAuth } from "../../../context/AuthContext";
import { growthToolsKeys } from "../../../hooks/growthToolsKeys";
import { useAddCompetitor } from "../../../hooks/useGrowthTools";
import {
  searchPlaces,
  type PlaceSearchResult,
} from "../../../services/growthToolsService";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";
import { Sheet } from "../../ui/Sheet";
import {
  graderInputsValid,
  websiteLooksValid,
} from "./insightsInstruments";

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_CHARS = 2;

export interface CompetitorAddSheetProps {
  visible: boolean;
  onClose: () => void;
  brandId: string | null;
  venueListingId: string | null;
  /** City bias for the typeahead (venue.city; null → unbiased). */
  venueCity: string | null;
  testID?: string;
}

export function CompetitorAddSheet({
  visible,
  onClose,
  brandId,
  venueListingId,
  venueCity,
  testID = "competitor-add-sheet",
}: CompetitorAddSheetProps): React.ReactElement {
  const { loading, session } = useAuth();
  const addMutation = useAddCompetitor(brandId, venueListingId);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [website, setWebsite] = useState("");
  const [placePoolId, setPlacePoolId] = useState<string | null>(null);
  const [prefilledNoWebsite, setPrefilledNoWebsite] = useState(false);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedQuery(query.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [query]);

  // Reset per open so a previous add never leaks into the next one.
  useEffect(() => {
    if (visible) {
      setQuery("");
      setDebouncedQuery("");
      setManualMode(false);
      setName("");
      setCity("");
      setWebsite("");
      setPlacePoolId(null);
      setPrefilledNoWebsite(false);
      addMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [visible]);

  const searchEnabled = visible &&
    !manualMode &&
    !loading &&
    session !== null &&
    brandId !== null &&
    debouncedQuery.length >= SEARCH_MIN_CHARS;
  const searchQuery = useQuery<PlaceSearchResult[]>({
    queryKey: searchEnabled && brandId !== null
      ? growthToolsKeys.search(brandId, debouncedQuery, venueCity ?? "")
      : (["growth-tools-disabled", "search"] as const),
    enabled: searchEnabled,
    staleTime: 60_000,
    queryFn: async () => {
      if (brandId === null) throw new Error("search disabled");
      return searchPlaces(brandId, debouncedQuery, venueCity ?? undefined);
    },
  });

  const pickResult = useCallback((result: PlaceSearchResult): void => {
    setName(result.name);
    setCity(result.city ?? "");
    setWebsite(result.website ?? "");
    setPlacePoolId(result.id);
    setPrefilledNoWebsite(result.website === null || result.website.length === 0);
    setManualMode(true);
  }, []);

  const websiteValid = websiteLooksValid(website);
  const canSubmit = graderInputsValid(name, city) &&
    websiteValid &&
    !addMutation.isPending;

  const errorCopy = useMemo((): string | null => {
    if (addMutation.error === null) return null;
    if (addMutation.error.code === "duplicate_competitor") {
      return "You're already watching this site.";
    }
    if (addMutation.error.code === "watch_limit") {
      return "Watching 5 of 5 — remove one to add another.";
    }
    if (addMutation.error.code === "validation") {
      return "Check the name, city and website — one of them isn't valid.";
    }
    return "Couldn't add them — try again.";
  }, [addMutation.error]);

  const submit = useCallback((): void => {
    if (!canSubmit) return;
    addMutation.mutate(
      { name, city, website, placePoolId },
      {
        onSuccess: () => {
          captureIntelCompetitorAdded();
          onClose();
        },
        onError: (error) => {
          // Spoken via `errorCopy` above — logged with context, never silent.
          console.error("[CompetitorAddSheet] add failed", error.code);
        },
      },
    );
  }, [canSubmit, addMutation, name, city, website, placePoolId, onClose]);

  return (
    <Sheet visible={visible} onClose={onClose} testID={testID}>
      <View style={styles.body}>
        <Text style={styles.title}>Watch a competitor</Text>

        {!manualMode ? (
          <>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Search venues near you"
              leadingIcon="search"
              clearable
              accessibilityLabel="Search for a competitor"
              testID={`${testID}-search-input`}
            />
            {searchQuery.isFetching ? (
              <ActivityIndicator size="small" color={textTokens.tertiary} />
            ) : null}
            {searchQuery.isError ? (
              <View style={styles.errorRow}>
                <Text style={styles.errorLine}>
                  Search didn&apos;t finish — try again.
                </Text>
                <Button
                  label="Retry"
                  variant="ghost"
                  size="sm"
                  onPress={() => {
                    void searchQuery.refetch();
                  }}
                />
              </View>
            ) : null}
            {(searchQuery.data ?? []).map((result) => (
              <Pressable
                key={result.id}
                style={styles.resultRow}
                onPress={() => pickResult(result)}
                accessibilityRole="button"
                accessibilityLabel={`Watch ${result.name}${
                  result.city !== null ? `, ${result.city}` : ""
                }`}
                testID={`${testID}-result-${result.id}`}
              >
                <View style={styles.resultTextWrap}>
                  <Text style={styles.resultName} numberOfLines={1}>
                    {result.name}
                  </Text>
                  <Text style={styles.resultMeta} numberOfLines={1}>
                    {[result.city, result.website].filter(
                      (v): v is string => typeof v === "string" && v.length > 0,
                    ).join(" · ")}
                  </Text>
                </View>
              </Pressable>
            ))}
            {searchEnabled &&
                searchQuery.isFetched &&
                !searchQuery.isError &&
                (searchQuery.data ?? []).length === 0
              ? (
                <Text style={styles.quiet}>
                  Nothing in our directory for that.
                </Text>
              )
              : null}
            <Button
              label="Can't find them? Enter their website"
              variant="ghost"
              size="sm"
              onPress={() => setManualMode(true)}
              testID={`${testID}-manual-toggle`}
            />
          </>
        ) : (
          <>
            <Input
              value={name}
              onChangeText={setName}
              placeholder="Their name"
              accessibilityLabel="Competitor name"
              testID={`${testID}-name-input`}
            />
            <Input
              value={city}
              onChangeText={setCity}
              placeholder="City"
              accessibilityLabel="Competitor city"
              testID={`${testID}-city-input`}
            />
            <Input
              value={website}
              onChangeText={(next) => {
                setWebsite(next);
                setPrefilledNoWebsite(false);
              }}
              placeholder="Their website (https://…)"
              accessibilityLabel="Competitor website"
              testID={`${testID}-website-input`}
            />
            {prefilledNoWebsite || (website.trim().length > 0 && !websiteValid)
              ? (
                <Text style={styles.quiet} testID={`${testID}-no-website`}>
                  We can only grade sites we can reach — no website found for
                  them.
                </Text>
              )
              : null}
            {errorCopy !== null ? (
              <Text style={styles.errorLine} testID={`${testID}-error`}>
                {errorCopy}
              </Text>
            ) : null}
            <Button
              label="Watch them"
              variant="primary"
              size="md"
              fullWidth
              disabled={!canSubmit}
              loading={addMutation.isPending}
              onPress={submit}
              accessibilityLabel="Watch this competitor"
              testID={`${testID}-submit`}
            />
            <Button
              label="Back to search"
              variant="ghost"
              size="sm"
              onPress={() => setManualMode(false)}
              testID={`${testID}-back-to-search`}
            />
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: {
    ...typography.h3,
    color: textTokens.primary,
  },
  resultRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  resultTextWrap: {
    flex: 1,
    gap: 2,
  },
  resultName: {
    ...typography.bodySm,
    fontWeight: "600",
    color: textTokens.primary,
  },
  resultMeta: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  quiet: {
    ...typography.caption,
    color: textTokens.tertiary,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  errorLine: {
    ...typography.bodySm,
    color: semantic.error,
    flexShrink: 1,
  },
});

export default CompetitorAddSheet;
