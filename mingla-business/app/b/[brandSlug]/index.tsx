/**
 * /b/{brandSlug} — public brand page route.
 *
 * Resolves a Brand by slug. Renders PublicBrandPage or PublicBrandNotFound.
 *
 * Per Cycle 7 spec §2.1.
 */

import React from "react";
import { useLocalSearchParams } from "expo-router";

import { useBrandList } from "../../../src/store/currentBrandStore";
import { PublicBrandPage } from "../../../src/components/brand/PublicBrandPage";
import { PublicBrandNotFound } from "../../../src/components/brand/PublicBrandNotFound";

export default function PublicBrandRoute(): React.ReactElement {
  const params = useLocalSearchParams<{ brandSlug: string | string[] }>();
  const brandSlug = Array.isArray(params.brandSlug)
    ? params.brandSlug[0]
    : params.brandSlug;

  const brands = useBrandList();
  const brand =
    typeof brandSlug === "string" && brandSlug.length > 0
      ? (brands.find((b) => b.slug === brandSlug) ?? null)
      : null;

  if (brand === null) {
    return <PublicBrandNotFound />;
  }

  return <PublicBrandPage brand={brand} />;
}
