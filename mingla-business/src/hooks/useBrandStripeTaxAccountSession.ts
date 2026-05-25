import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";

import {
  type BrandStripeTaxAccountSessionResult,
  fetchBrandStripeTaxAccountSession,
} from "../services/brandStripeTaxAccountSessionService";

const taxToolsUrl = (result: BrandStripeTaxAccountSessionResult): string => {
  const base = process.env.EXPO_PUBLIC_MINGLA_PUBLIC_WEB_BASE_URL ??
    process.env.EXPO_PUBLIC_WEB_BASE_URL ??
    "https://usemingla.com";
  const params = new URLSearchParams({
    clientSecret: result.clientSecret,
    brandStripeAccountId: result.brandStripeAccountId,
  });
  return `${
    base.replace(/\/$/, "")
  }/connect-tax-registrations?${params.toString()}`;
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
