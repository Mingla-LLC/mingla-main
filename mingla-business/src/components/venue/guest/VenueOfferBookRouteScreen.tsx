/**
 * #4490 — the guest checkout and booking screen behind
 * /b/{brandSlug}/v/{venueSlug}/book/{offerId} (the route is a thin shell; see
 * that file for the address contract). Inside the Guest venue owner, so the
 * guest offer models it parses with never reach the eager web `__common` chunk.
 * ANON: never useAuth.
 */
import React from "react";
import Head from "expo-router/head";

import { parsePackageCheckoutParams } from "@mingla/brand-rendering/venueOffers/packageModel";
import { parseHireRequestParams } from "@mingla/brand-rendering/venueOffers/hireModel";
import { HireRequest } from "../offers/HireRequest";
import { OfferCheckout } from "../offers/OfferCheckout";
import { PackageCheckout } from "../offers/PackageCheckout";
import { HourCheckout } from "../offers/HourCheckout";
import { PlanJoin } from "../offers/PlanJoin";
import { parseHourCheckoutParams } from "../offers/hourGuestModel";
import { parseEntryCheckoutParams } from "../offers/entryCheckoutPath";
import { PublicVenueNotFound } from "../PublicVenueNotFound";

/** The route's params, raw (opaque ids and short codes only). */
export type VenueOfferBookParams = {
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
    // #4490 fix 2 (N85) — the entry session picked (`t=<windowId>`).
    t?: string | string[];
  };

export interface VenueOfferBookRouteScreenProps {
  params: VenueOfferBookParams;
  safeTop: number;
  safeBottom: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : typeof value === "string" ? value : null;

export function VenueOfferBookRouteScreen({
  params,
  safeTop,
  safeBottom,
}: VenueOfferBookRouteScreenProps): React.ReactElement {
  const insets = { top: safeTop, bottom: safeBottom };
  const hourChoice = parseHourCheckoutParams(params);
  const hireChoice = parseHireRequestParams(params);
  const packageChoice = parsePackageCheckoutParams(params);
  const brandSlug = one(params.brandSlug);
  const venueSlug = one(params.venueSlug);
  const offerId = one(params.offerId);
  const { date, counts, windowId } = parseEntryCheckoutParams({ date: params.date, q: params.q, t: params.t });

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
        initialWindowId={windowId}
        initialCounts={counts}
        safeTop={insets.top}
        safeBottom={insets.bottom}
      />
      )}
    </>
  );
}
