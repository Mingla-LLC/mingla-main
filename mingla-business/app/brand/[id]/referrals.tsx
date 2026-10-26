import React, { Suspense } from "react";
import { useLocalSearchParams } from "expo-router";

import { ProgramLoading } from "../../../src/components/programs/ProgramKit";
import { useBrand } from "../../../src/hooks/useBrands";
import { useCurrentBrandRole } from "../../../src/hooks/useCurrentBrandRole";
import { currencyCodeOrNull } from "../../../src/utils/currency";

const LazyReferralHome = React.lazy(async () => {
  const mod =
    await import("../../../src/components/referrals/ReferralHomeView");
  return { default: mod.ReferralHomeView };
});

const TABS = new Set(["offers", "promoters", "links", "results"]);

// #3872 — the workspace renders its own title bar and scrolls as one page, so
// nothing stays pinned over the content on a phone.
export default function ReferralsRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ id: string | string[]; tab?: string | string[] }>();
  const brandId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const { rank } = useCurrentBrandRole(brandId ?? null);
  const { data: brand } = useBrand(brandId ?? null);
  const currency =
    currencyCodeOrNull(brand?.pricingCurrency) ??
    currencyCodeOrNull(brand?.defaultCurrency) ??
    "USD";
  if (!brandId) return <ProgramLoading />;
  return (
    <Suspense fallback={<ProgramLoading />}>
      <LazyReferralHome
        brandId={brandId}
        rank={rank}
        currency={currency}
        fallback={`/brand/${brandId}`}
        initialTab={rawTab && TABS.has(rawTab) ? (rawTab as "offers" | "promoters" | "links" | "results") : "offers"}
      />
    </Suspense>
  );
}
