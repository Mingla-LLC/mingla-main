/**
 * useBrandStripeBankVerification — derives the bank-verification surface state
 * for the brand's connected Stripe account.
 *
 * Per B2a Path C V3 SPEC §6 + DEC-V3-12 (bank verification UI).
 *
 * Reads from `useBrandStripeStatus` (the canonical source) and `stripe_external_accounts`
 * (V3 Sub-A migration `20260511000002`) to produce a UI-ready summary:
 *
 *  - `state` — "verified" | "pending" | "errored" | "missing"
 *  - `lastFour` — last 4 digits of the bank account (when known)
 *  - `bankAccountLabel` — country-specific label (e.g., "IBAN", "Sort code + account")
 *  - `errorReason` — Stripe-reported reason if state === "errored"
 *
 * Const #5: server state via React Query, NOT Zustand.
 * Const #4: query key from factory.
 * I-PROPOSED-W: stripe_external_accounts is keyed by brand_id, not type — exempt.
 */

import { useEffect } from "react";
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import { getStripeSupportedCountry } from "../constants/stripeSupportedCountries";

export type BankVerificationState =
  | "verified"
  | "pending"
  | "errored"
  | "missing";

export interface BrandStripeBankVerification {
  state: BankVerificationState;
  lastFour: string | null;
  bankAccountLabel: string;
  errorReason: string | null;
}

interface ExternalAccountRow {
  last_four: string | null;
  status: string | null;
  failure_reason: string | null;
  country: string | null;
}

const STALE_TIME_MS = 60 * 1000;

export const brandStripeBankVerificationKeys = {
  all: ["brand-stripe-bank-verification"] as const,
  detail: (
    brandId: string,
  ): readonly ["brand-stripe-bank-verification", string] =>
    [...brandStripeBankVerificationKeys.all, brandId] as const,
};

const DISABLED_KEY = ["brand-stripe-bank-verification-disabled"] as const;

function mapRow(row: ExternalAccountRow | null): BrandStripeBankVerification {
  if (row === null) {
    return {
      state: "missing",
      lastFour: null,
      bankAccountLabel: "Bank account",
      errorReason: null,
    };
  }
  const country = row.country !== null ? getStripeSupportedCountry(row.country) : null;
  const bankAccountLabel = country?.bankAccountLabel ?? "Bank account";

  let state: BankVerificationState;
  if (row.status === "verified") state = "verified";
  else if (row.status === "errored" || row.status === "verification_failed") {
    state = "errored";
  } else if (row.status === null || row.status === "pending") state = "pending";
  else state = "pending";

  return {
    state,
    lastFour: row.last_four,
    bankAccountLabel,
    errorReason: row.failure_reason,
  };
}

export function useBrandStripeBankVerification(
  brandId: string | null,
): UseQueryResult<BrandStripeBankVerification> {
  const queryClient = useQueryClient();
  const enabled = brandId !== null;

  useEffect(() => {
    if (!enabled || brandId === null) return;
    const channel = supabase
      .channel(`stripe-external-${brandId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "stripe_external_accounts",
          filter: `brand_id=eq.${brandId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: brandStripeBankVerificationKeys.detail(brandId),
          });
        },
      )
      .subscribe();

    return (): void => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, brandId, queryClient]);

  return useQuery<BrandStripeBankVerification>({
    queryKey: enabled
      ? brandStripeBankVerificationKeys.detail(brandId)
      : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<BrandStripeBankVerification> => {
      if (brandId === null) {
        throw new Error("useBrandStripeBankVerification: brandId null but enabled");
      }
      const { data, error } = await supabase
        .from("stripe_external_accounts")
        .select("last_four, status, failure_reason, country")
        .eq("brand_id", brandId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<ExternalAccountRow>();

      if (error) throw error;
      return mapRow(data);
    },
  });
}
