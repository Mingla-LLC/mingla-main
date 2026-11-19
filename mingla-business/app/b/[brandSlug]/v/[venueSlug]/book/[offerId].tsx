// orch-strict-grep-allow safearea-on-fullscreen-routes — route applies insets directly
/**
 * /b/{brandSlug}/v/{venueSlug}/book/{offerId} — #4490 P2 entry checkout,
 * (P3, `?k=group…`) the group package checkout, and (P4, `?k=hire…`) the
 * private hire request, and (P6, `?k=plan`) joining a monthly plan (the id is
 * the plan's).
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

import { parsePackageCheckoutParams } from "@mingla/brand-rendering/venueOffers/packageModel";
import { parseHireRequestParams } from "@mingla/brand-rendering/venueOffers/hireModel";
import { HireRequest } from "../../../../../../src/components/venue/offers/HireRequest";
import { OfferCheckout } from "../../../../../../src/components/venue/offers/OfferCheckout";
import { PackageCheckout } from "../../../../../../src/components/venue/offers/PackageCheckout";
import { HourCheckout } from "../../../../../../src/components/venue/offers/HourCheckout";
import { PlanJoin } from "../../../../../../src/components/venue/offers/PlanJoin";
import { parseHourCheckoutParams } from "../../../../../../src/components/venue/offers/hourGuestModel";
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
    // #4490 P3 — a group package choice (`k=group&d=&w=&g=&x=&a=&pay=`).
    k?: string | string[];
    d?: string | string[];
    w?: string | string[];
    g?: string | string[];
    x?: string | string[];
    a?: string | string[];
    pay?: string | string[];
    // #4490 P4 — a private hire choice (`k=hire&d=&w=&g=&o=`).
    o?: string | string[];
    // #4490 P5 — a by-the-hour choice (`k=hour&d=&s=&m=&g=`).
    s?: string | string[];
    m?: string | string[];
  }>();
  const hourChoice = parseHourCheckoutParams(params);
  const hireChoice = parseHireRequestParams(params);
  const packageChoice = parsePackageCheckoutParams(params);
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
      {one(params.k) === "plan" ? (
        <PlanJoin
          brandSlug={brandSlug}
          venueSlug={venueSlug}
          planId={offerId.toLowerCase()}
          safeTop={insets.top}
          safeBottom={insets.bottom}
        />
      ) : hourChoice !== null ? (
        <HourCheckout
          brandSlug={brandSlug}
          venueSlug={venueSlug}
          offerId={offerId.toLowerCase()}
          choice={hourChoice}
          safeTop={insets.top}
          safeBottom={insets.bottom}
        />
      ) : hireChoice !== null ? (
        <HireRequest
          brandSlug={brandSlug}
          venueSlug={venueSlug}
          offerId={offerId.toLowerCase()}
          choice={hireChoice}
          safeTop={insets.top}
          safeBottom={insets.bottom}
        />
      ) : packageChoice !== null ? (
        <PackageCheckout
          brandSlug={brandSlug}
          venueSlug={venueSlug}
          offerId={offerId.toLowerCase()}
          choice={packageChoice}
          safeTop={insets.top}
          safeBottom={insets.bottom}
        />
      ) : (
      <OfferCheckout
        brandSlug={brandSlug}
        venueSlug={venueSlug}
        offerId={offerId.toLowerCase()}
        initialDate={date}
        initialCounts={counts}
        safeTop={insets.top}
        safeBottom={insets.bottom}
      />
      )}
    </>
  );
}
