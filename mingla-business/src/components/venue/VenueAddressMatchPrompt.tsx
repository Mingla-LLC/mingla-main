/**
 * Issue #1648 — the s0 recognition moment.
 *
 * The name gate already asks "is this you?" when a brand's NAME matches our
 * directory. It misses whenever the name doesn't: a trading name, a rename, a
 * chain branch, or simply a brand who pressed "Continue without a match". Those
 * brands then type the exact street address of a place we already hold — the
 * strongest identity signal there is — and until now we ignored it, and let them
 * build a duplicate.
 *
 * This mounts under the s0 address field and asks the same question the gate
 * asks, with the same card, at the moment the stronger signal arrives.
 *
 * WHY THIS IS ITS OWN FILE. Accepting a match runs `prefillDraftFromAdoption`,
 * which legitimately writes `googlePlaceId` (the pool row's own Google id — the
 * dedup key `biz_create_venue_brand_authoring` checks). ORCH-1079's pinned guard
 * asserts that NO `patch({...})` inside `VenueStep1Address.tsx` ever mentions
 * `googlePlaceId`, and that guard is load-bearing: it is what stops a Mapbox
 * `mapbox_id` being written into that column. Putting the conversion here keeps
 * both true — the address handlers stay dumb about identity, and the claim
 * prefill stays the only thing that sets it.
 *
 * Nothing here can block the wizard. A miss, a dismissal, a Google outage and a
 * rate limit all leave the brand exactly where they were: an address is picked,
 * Continue is live, s1 is next.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { spacing, text as textTokens, typography } from "../../constants/designSystem";
import { ClaimMatchCard } from "../brand/ClaimMatchCard";
import { useVenueAddressPoolMatch } from "../../hooks/useVenueAddressPoolMatch";
import {
  fetchPlaceAdoptionDetail,
  PlaceNotAvailableError,
} from "../../services/poolSearchService";
import {
  prefillDraftFromAdoption,
  prefillDraftFromPoolMatch,
} from "../../utils/prefillDraftFromPoolMatch";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import type { PoolMatch } from "../../types/poolMatch";

export const VenueAddressMatchPrompt: React.FC = () => {
  const router = useRouter();
  const patch = useDraftVenueStore((s) => s.patch);
  const { match, loading, error, dismiss } = useVenueAddressPoolMatch();

  const [yesLoading, setYesLoading] = React.useState(false);
  const [fetchError, setFetchError] = React.useState(false);
  const [unavailable, setUnavailable] = React.useState(false);

  // A different place arriving resets the per-match states — otherwise a failed
  // fetch on place A would leave place B's card showing "Continue anyway".
  const matchId = match?.id ?? null;
  React.useEffect(() => {
    setYesLoading(false);
    setFetchError(false);
    setUnavailable(false);
  }, [matchId]);

  // "Yes, this is me" — identical to the gate's §B3 handler: the ONLY effect is
  // a client draft fill (D-B copy-on-start, zero server writes). Patching the
  // claim block flips the wizard's step map to the 10-step claim arm, and the
  // prefill's `step: 0` lands them on c0, exactly where the gate's YES lands.
  const handleYes = React.useCallback(
    async (m: PoolMatch): Promise<void> => {
      setYesLoading(true);
      try {
        const detail = await fetchPlaceAdoptionDetail(m.id);
        const { photoUris: _legacy, ...prefill } = prefillDraftFromAdoption(
          m,
          detail,
        );
        patch(prefill);
      } catch (e) {
        if (e instanceof PlaceNotAvailableError) {
          // Race backstop: the place stopped being claimable between the lookup
          // and the tap — swap the card to the blocked state rather than fail.
          setUnavailable(true);
        } else {
          // Explicit fallback, never silent — the primary relabels to
          // "Continue anyway" and takes the lean whitelist prefill.
          setFetchError(true);
        }
      } finally {
        setYesLoading(false);
      }
    },
    [patch],
  );

  const handleContinueAnyway = React.useCallback(
    (m: PoolMatch): void => {
      const { photoUris: _legacy, ...prefill } = prefillDraftFromPoolMatch(m);
      patch(prefill);
    },
    [patch],
  );

  if (loading) {
    return <Text style={styles.hint}>Checking our directory…</Text>;
  }
  if (error !== null) {
    return <Text style={styles.warn}>{error}</Text>;
  }
  if (match === null) return null;

  // A mid-race unavailability overrides a now-stale "available" claim state.
  const shown: PoolMatch =
    unavailable && match.claimState === "available"
      ? { ...match, claimState: "pending" }
      : match;

  return (
    <View style={styles.host} testID="venue-address-match">
      <ClaimMatchCard
        match={shown}
        loading={yesLoading}
        fetchError={fetchError}
        eyebrow="That address is already in our directory"
        onYes={() => void handleYes(shown)}
        onContinueAnyway={() => handleContinueAnyway(shown)}
        // No/Skip at s0 mean the same thing and neither navigates: the brand
        // keeps the address they just picked and carries on creating a new
        // listing. We only remember the answer so we don't ask again.
        onNo={dismiss}
        onSkip={dismiss}
        onMessageSupport={() => router.push("/support/inbox" as never)}
        testID={`venue-address-match-card-${shown.id}`}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    marginTop: spacing.md,
  },
  hint: {
    marginTop: spacing.sm,
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  warn: {
    marginTop: spacing.sm,
    fontSize: typography.caption.fontSize,
    color: "#F59E0B",
  },
});

export default VenueAddressMatchPrompt;
