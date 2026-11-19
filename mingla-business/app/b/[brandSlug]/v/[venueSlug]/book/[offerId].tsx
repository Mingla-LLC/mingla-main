// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * /b/{brandSlug}/v/{venueSlug}/book/{offerId} — #4490 P2 entry checkout.
 *
 * ANON ROUTE under the `/b/` public prefix: buying never needs an account and
 * this chain never calls useAuth. The address carries the day and the counts
 * only (`?date=YYYY-MM-DD&q=<optionId>:<n>,…`), never a token or anything
 * personal. The screen itself is `OfferCheckout`.
 */
import React from "react";
import { useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfferCheckout } from "../../../../../../src/components/venue/offers/OfferCheckout";
import { parseEntryCheckoutParams } from "../../../../../../src/components/venue/offers/entryCheckoutPath";
import { PublicVenueNotFound } from "../../../../../../src/components/venue/PublicVenueNotFound";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : typeof value === "string" ? value : null;

export default function VenueOfferCheckoutRoute(): React.ReactElement {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    brandSlug?: string | string[];
    venueSlug?: string | string[];
    offerId?: string | string[];
    date?: string | string[];
    q?: string | string[];
  }>();
  const brandSlug = one(params.brandSlug);
  const venueSlug = one(params.venueSlug);
  const offerId = one(params.offerId);
  const { date, counts } = parseEntryCheckoutParams({ date: params.date, q: params.q });

  if (brandSlug === null || venueSlug === null || offerId === null || !UUID.test(offerId)) {
    return <PublicVenueNotFound brandSlug={brandSlug} brandDisplayName={null} />;
  }
  return (
    <>
      <Head>
        <title>Checkout · Mingla</title>
        <meta name="robots" content="noindex" />
      </Head>
      <OfferCheckout
        brandSlug={brandSlug}
        venueSlug={venueSlug}
        offerId={offerId.toLowerCase()}
        initialDate={date}
        initialCounts={counts}
        safeTop={insets.top}
        safeBottom={insets.bottom}
      />
    </>
  );
}
