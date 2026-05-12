/**
 * brandStripeTaxDashboardLinkService — frontend wrapper for the
 * `brand-stripe-tax-dashboard-link` edge fn (ORCH-0804).
 *
 * Generates a short-lived Stripe Express Dashboard login link so the brand
 * admin can open Stripe in their browser and manage Tax registrations.
 * Stripe's Tax Settings UI is web-only GA today — no React Native preview
 * component, so we link out instead of embedding. When Stripe ships the RN
 * `<TaxSettings />` component, the consumer hook (`useBrandStripeTaxDashboardLink`)
 * can be retired and replaced with the embedded component.
 *
 * Error contract per Const #3: throws on edge-fn error; never returns null.
 */

import { supabase } from "./supabase";

export interface BrandStripeTaxDashboardLinkResult {
  url: string;
}

interface RawResponse {
  url?: string;
}

export async function fetchBrandStripeTaxDashboardLink(
  brandId: string,
): Promise<BrandStripeTaxDashboardLinkResult> {
  const { data, error } = await supabase.functions.invoke<RawResponse>(
    "brand-stripe-tax-dashboard-link",
    { body: { brand_id: brandId } },
  );
  if (error) throw error;
  if (data === null) {
    throw new Error(
      "fetchBrandStripeTaxDashboardLink: edge fn returned null",
    );
  }
  if (typeof data.url !== "string" || data.url.length === 0) {
    throw new Error(
      "fetchBrandStripeTaxDashboardLink: missing url in response",
    );
  }
  return { url: data.url };
}
