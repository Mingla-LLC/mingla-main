import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";

import { MINGLA_BUSINESS_WEB_URL } from "../constants/platformUrl";
import {
  type BrandStripeTaxAccountSessionResult,
  fetchBrandStripeTaxAccountSession,
} from "../services/brandStripeTaxAccountSessionService";

/**
 * Builds the URL to the embedded `/connect-tax-registrations` page.
 *
 * That page is served ONLY by the mingla-business web export (the SPA
 * catch-all rewrite in `mingla-business/vercel.json`) at
 * `business.usemingla.com`. It does NOT exist on the marketing app at
 * `usemingla.com`, which renders a 404 for it. So the base MUST resolve to the
 * canonical Mingla Business web URL — never the marketing apex. (ORCH-1279)
 *
 * Sourced from `MINGLA_BUSINESS_WEB_URL` (constants/platformUrl.ts), the single
 * source of truth for that domain — do NOT reintroduce bespoke env-var reads or
 * a hardcoded fallback here.
 */
export const taxToolsUrl = (
  result: BrandStripeTaxAccountSessionResult,
): string => {
  const base = MINGLA_BUSINESS_WEB_URL.replace(/\/$/, "");
  const params = new URLSearchParams({
    clientSecret: result.clientSecret,
    brandStripeAccountId: result.brandStripeAccountId,
  });
  return `${base}/connect-tax-registrations?${params.toString()}`;
};

export const useBrandStripeTaxAccountSession = (): UseMutationResult<
  BrandStripeTaxAccountSessionResult,
  Error,
  string
> => {
  return useMutation<BrandStripeTaxAccountSessionResult, Error, string>({
    mutationFn: async (brandId: string) =>
      fetchBrandStripeTaxAccountSession(brandId),
    onSuccess: async (result) => {
      await WebBrowser.openAuthSessionAsync(taxToolsUrl(result));
    },
  });
};
