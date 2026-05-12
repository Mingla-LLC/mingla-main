/**
 * useBrandStripeTaxDashboardLink — React Query mutation that fetches a
 * short-lived Stripe Express Dashboard login link for a brand admin and
 * opens it via `Linking.openURL` (ORCH-0804).
 *
 * Stripe's Tax Settings UI is web-only GA today (per
 * https://docs.stripe.com/connect/supported-embedded-components). No RN
 * component exists yet, so the brand-side flow is: tap "Tax & registrations"
 * → call this hook → Stripe Dashboard opens in the device browser → brand
 * registers in their jurisdictions there → registrations propagate to
 * Stripe Tax, which automatically taxes future Checkout Sessions (per
 * I-PROPOSED-BF). When Stripe ships RN `<TaxSettings />`, retire this hook.
 *
 * Per ORCH-0804 SPEC §6.2.
 */

import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { Linking } from "react-native";

import {
  fetchBrandStripeTaxDashboardLink,
  type BrandStripeTaxDashboardLinkResult,
} from "../services/brandStripeTaxDashboardLinkService";

export const useBrandStripeTaxDashboardLink = (): UseMutationResult<
  BrandStripeTaxDashboardLinkResult,
  Error,
  string
> => {
  return useMutation<BrandStripeTaxDashboardLinkResult, Error, string>({
    mutationFn: async (brandId: string) =>
      fetchBrandStripeTaxDashboardLink(brandId),
    onSuccess: async (result) => {
      // Best-effort open; if Linking fails, the caller's onError catches.
      // We intentionally don't await user navigation here — Stripe Dashboard
      // opens in the device browser and the brand acts there.
      const supported = await Linking.canOpenURL(result.url);
      if (!supported) {
        throw new Error("Couldn't open Stripe Dashboard on this device.");
      }
      await Linking.openURL(result.url);
    },
  });
};
