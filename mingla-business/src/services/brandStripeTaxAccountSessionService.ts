import { supabase } from "./supabase";

export interface BrandStripeTaxAccountSessionResult {
  clientSecret: string;
  expiresAt: number | null;
  brandStripeAccountId: string;
}

interface RawResponse {
  clientSecret?: string;
  expiresAt?: number | null;
  brandStripeAccountId?: string;
}

export async function fetchBrandStripeTaxAccountSession(
  brandId: string,
): Promise<BrandStripeTaxAccountSessionResult> {
  const { data, error } = await supabase.functions.invoke<RawResponse>(
    "brand-stripe-tax-account-session",
    { body: { brand_id: brandId } },
  );
  if (error) throw error;
  if (data === null) {
    throw new Error("fetchBrandStripeTaxAccountSession: edge fn returned null");
  }
  if (typeof data.clientSecret !== "string" || data.clientSecret.length === 0) {
    throw new Error("fetchBrandStripeTaxAccountSession: missing clientSecret");
  }
  if (
    typeof data.brandStripeAccountId !== "string" ||
    data.brandStripeAccountId.length === 0
  ) {
    throw new Error(
      "fetchBrandStripeTaxAccountSession: missing brandStripeAccountId",
    );
  }
  return {
    clientSecret: data.clientSecret,
    expiresAt: data.expiresAt ?? null,
    brandStripeAccountId: data.brandStripeAccountId,
  };
}
