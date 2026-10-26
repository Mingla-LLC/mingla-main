import { supabase } from "./supabase";

export type EarningsShare = {
  id: string;
  orderKind: "ticket" | "venue_order";
  orderId: string;
  listingName: string;
  earnedAt: string;
  releaseAfter: string;
  amountMinor: number;
  grossMinor: number;
  feeMinor: number;
  reversedMinor: number;
  currency: string;
  status: string;
  rail: "stripe" | "paystack";
};
export type EarningsSummary = {
  totals: Record<string, {
    onWayMinor: number;
    readyMinor: number;
    paidMinor: number;
    reversedMinor: number;
  }>;
  shares: EarningsShare[];
  vouchers: {
    id: string;
    brandId: string;
    brandName: string;
    discountId: string;
    status: string;
    expiresAt: string;
    grantedAt: string;
  }[];
  perks: {
    offerId: string;
    offerName: string;
    brandName: string;
    perkText: string;
    threshold: number;
    qualifiedSales: number;
    unlocked: boolean;
  }[];
  links: {
    memberId: string;
    offerId: string;
    offerName: string;
    brandName: string;
    linkSlug: string;
    url: string;
    rewardKind: string;
    shareBps: number | null;
    perkText: string | null;
  }[];
  payoutAccount: {
    stripe: { connected: boolean; status: string; country: string | null };
    paystack: {
      connected: boolean;
      status: string;
      bankName: string | null;
      accountNumberMasked: string | null;
      country: string | null;
      currency: string | null;
    };
  };
};
export type BuyerReferralLink = {
  memberId: string;
  offerId: string;
  offerName: string;
  brandId: string;
  brandName: string;
  linkSlug: string;
  url: string;
  rewardKind: string;
  shareBps: number | null;
  perkText: string | null;
  buyerDiscount: boolean;
};

export async function fetchEarningsSummary(): Promise<EarningsSummary> {
  const { data, error } = await supabase.rpc("issue_3872_my_earnings_summary");
  if (error) throw error;
  return data as EarningsSummary;
}

export async function fetchBuyerReferralLink(input: {
  listingKind: "event" | "venue";
  listingId: string;
}): Promise<BuyerReferralLink | null> {
  const { data, error } = await supabase.functions.invoke("referral-buyer-link", {
    body: input,
  });
  if (error) throw error;
  const response = data as { available?: boolean; link?: BuyerReferralLink };
  return response.available === true && response.link ? response.link : null;
}

export async function fetchPayoutAccountStatus() {
  const [stripe, paystack] = await Promise.all([
    supabase.functions.invoke("payee-account-stripe-link", {
      body: { action: "status" },
    }),
    supabase.functions.invoke("payee-account-paystack-recipient", {
      body: { action: "status" },
    }),
  ]);
  if (stripe.error) throw stripe.error;
  if (paystack.error) throw paystack.error;
  return { stripe: stripe.data, paystack: paystack.data };
}

export async function createStripePayoutAccountLink(country: string) {
  const { data, error } = await supabase.functions.invoke(
    "payee-account-stripe-link",
    {
      body: {
        action: "link",
        country: country.trim().toUpperCase(),
        return_url: "mingla://payout-account/return",
      },
    },
  );
  if (error) throw error;
  return data as { url: string };
}

export async function listPaystackBanks() {
  const { data, error } = await supabase.functions.invoke(
    "payee-account-paystack-recipient",
    { body: { action: "list_banks" } },
  );
  if (error) throw error;
  return (data as { banks?: { name: string; code: string }[] }).banks ?? [];
}

export async function resolvePaystackAccount(input: {
  accountNumber: string;
  bankCode: string;
}) {
  const { data, error } = await supabase.functions.invoke(
    "payee-account-paystack-recipient",
    {
      body: {
        action: "resolve_account",
        account_number: input.accountNumber,
        bank_code: input.bankCode,
      },
    },
  );
  if (error) throw error;
  return data as {
    account_name: string;
    account_number_masked: string;
  };
}

export async function createPaystackPayoutRecipient(input: {
  accountNumber: string;
  bankCode: string;
  bankName: string;
}) {
  const { data, error } = await supabase.functions.invoke(
    "payee-account-paystack-recipient",
    {
      body: {
        action: "create_recipient",
        account_number: input.accountNumber,
        bank_code: input.bankCode,
        bank_name: input.bankName,
      },
    },
  );
  if (error) throw error;
  return data;
}

export async function claimGuestEarnings(token: string) {
  const { data, error } = await supabase.functions.invoke("payee-claim-by-email", {
    body: { token },
  });
  if (error) throw error;
  return (data as {
    claimed: {
      membersClaimed: number;
      sharesClaimed: number;
      vouchersClaimed: number;
    };
  }).claimed;
}
