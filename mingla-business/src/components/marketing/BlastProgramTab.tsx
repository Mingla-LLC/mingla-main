/**
 * #3872 round 2 — Blast › Creators and Blast › Referrals for the current
 * brand. Same gates as the old brand-page rows: rank 20+ and the brand's
 * pilot access. Loading and refusal are plain states, never a crash.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import {
  ProgramEmpty,
  ProgramLoading,
  Segmented,
} from "../programs/ProgramKit";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { currencyCodeOrNull } from "../../utils/currency";
import { CreatorsHomeView } from "../creators/CreatorsHomeView";
import CreatorRosterScreen from "../creators/screens/CreatorRosterScreen";
import CreatorResultsScreen from "../creators/screens/CreatorResultsScreen";
import {
  ReferralHomeView,
  type ReferralTab,
} from "../referrals/ReferralHomeView";
import { fetchCreatorGigsAccess } from "../../services/creatorGigsService";
import { fetchReferralAccess } from "../../services/referralService";
import { spacing } from "../../constants/designSystem";

// The tab itself is reached only through the program's lazy owner
// (programs/creatorProgramOwner.ts), so the homes and services are static
// here: a second import() boundary inside the program would split it into
// two chunks and hoist what they share into the eager web chunk.

const REFERRAL_TABS: ReadonlySet<string> = new Set([
  "offers",
  "promoters",
  "links",
  "results",
]);
type CreatorSection = "gigs" | "roster" | "results";
const CREATOR_SECTIONS: readonly (readonly [CreatorSection, string])[] = [
  ["gigs", "Gigs"],
  ["roster", "My creators"],
  ["results", "Results"],
];

export function BlastProgramTab({
  program,
}: {
  program: "creators" | "referrals";
}): React.ReactElement {
  const brand = useCurrentBrand();
  const router = useRouter();
  const brandId = brand?.id ?? null;
  const role = useCurrentBrandRole(brandId);
  const params = useLocalSearchParams<{
    tab?: string | string[];
    view?: string | string[];
  }>();
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const rawView = Array.isArray(params.view) ? params.view[0] : params.view;
  const creatorSection: CreatorSection =
    rawView === "roster" || rawView === "results" ? rawView : "gigs";
  const access = useQuery({
    queryKey: ["blast-program-access", program, brandId],
    enabled: brandId !== null && role.rank >= 20,
    queryFn: async (): Promise<boolean> =>
      program === "creators"
        ? fetchCreatorGigsAccess(brandId as string)
        : fetchReferralAccess(brandId as string),
  });

  if (brandId === null) {
    return (
      <ProgramEmpty
        icon="megaphone"
        title="Pick a brand"
        body="Choose a brand at the top to see its promotion."
      />
    );
  }
  if (role.isLoading || (role.rank >= 20 && access.isLoading)) {
    return <ProgramLoading />;
  }
  const label = program === "creators" ? "Creators" : "Referrals";
  if (role.rank < 20) {
    return (
      <ProgramEmpty
        icon={program === "creators" ? "video" : "gift"}
        title={`${label} is for brand managers`}
        body="Ask a brand admin for access to promote this brand."
      />
    );
  }
  if (access.isError || access.data !== true) {
    return (
      <ProgramEmpty
        icon={program === "creators" ? "video" : "gift"}
        title={`${label} isn't open for this brand yet`}
        body="We're opening it brand by brand. We'll tell you when it's ready."
      />
    );
  }
  const currency =
    currencyCodeOrNull(brand?.pricingCurrency) ??
    currencyCodeOrNull(brand?.defaultCurrency) ??
    "USD";
  return (
    <>
      {program === "creators" ? (
        <View style={styles.creatorHost}>
          <View style={styles.creatorTabs}>
            <Segmented
              options={CREATOR_SECTIONS}
              value={creatorSection}
              onChange={(next) =>
                router.replace(
                  `/(tabs)/marketing/creators?view=${next}` as never,
                )
              }
            />
          </View>
          {creatorSection === "gigs" ? (
            <CreatorsHomeView key={brandId} brandId={brandId} />
          ) : creatorSection === "roster" ? (
            <CreatorRosterScreen embedded brandIdOverride={brandId} />
          ) : (
            <CreatorResultsScreen
              embedded
              brandIdOverride={brandId}
              currencyOverride={currency}
            />
          )}
        </View>
      ) : (
        <ReferralHomeView
          key={brandId}
          embedded
          brandId={brandId}
          rank={role.rank}
          currency={currency}
          fallback="/(tabs)/marketing"
          initialTab={
            rawTab && REFERRAL_TABS.has(rawTab)
              ? (rawTab as ReferralTab)
              : "offers"
          }
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  creatorHost: { flex: 1, minHeight: 0 },
  creatorTabs: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
});
