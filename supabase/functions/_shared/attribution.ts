// deno-lint-ignore-file no-explicit-any
// #3872 R2 — the single referral-attribution decision owner.
//
// Invariant I-3872-ONE-PAYEE (declared in its test suite): resolveReferrer returns at
// most one member/payee candidate; callers persist that immutable result and
// never compose a second referral rail beside it.

export type ReferralRail = "stripe" | "paystack";
export type ReferralOrderKind = "ticket" | "venue_order";
export type ReferralListingKind = "event" | "venue";
export type ReferralSource =
  | "code"
  | "member_link"
  | "tracking_link"
  | "none";
export type ReferralRejectedReason =
  | "self_referral"
  | "member_removed"
  | "offer_ended"
  | "budget_reached"
  | "cross_rail";

export interface ReferralBuyerIdentity {
  userId: string | null;
  emailNorm: string | null;
  phoneE164?: string | null;
  cardFingerprint?: string | null;
}

export interface ReferralMemberCandidate {
  id: string;
  offerId: string;
  brandId: string;
  userId: string | null;
  emailNorm: string | null;
  status: "invited" | "active" | "removed" | "declined";
  touchId: string | null;
}

export interface ReferralOfferCandidate {
  id: string;
  brandId: string;
  status: "draft" | "active" | "paused" | "ended";
  startsAt: string;
  endsAt: string | null;
  rewardKind: "cash" | "voucher" | "perk";
  shareBps: number | null;
  voucherTemplate: Record<string, unknown> | null;
  budgetMinor: number | null;
  currency: string;
  coversListing: boolean;
}

export interface ReferralTrackingCandidate {
  trackingId: string;
  touchId: string;
}

export interface ReferralPayeeRails {
  stripe: boolean;
  paystack: boolean;
}

export interface ReferralAttributionStore {
  referralsEnabled(brandId: string): Promise<boolean>;
  memberByCode(
    brandId: string,
    code: string,
  ): Promise<ReferralMemberCandidate | null>;
  latestMemberTouch(input: {
    brandId: string;
    userId: string | null;
    visitorKey: string | null;
    nowIso: string;
  }): Promise<ReferralMemberCandidate | null>;
  latestTrackingTouch(input: {
    brandId: string;
    userId: string | null;
    visitorKey: string | null;
    nowIso: string;
  }): Promise<ReferralTrackingCandidate | null>;
  offerForMember(input: {
    member: ReferralMemberCandidate;
    listingKind: ReferralListingKind;
    listingId: string;
  }): Promise<ReferralOfferCandidate | null>;
  tierShareBps(offerId: string, completedSales: number): Promise<number | null>;
  completedSales(offerId: string, memberId: string): Promise<number>;
  committedGrossMinor(offerId: string): Promise<number>;
  payeeRails(userId: string): Promise<ReferralPayeeRails>;
}

export interface ResolveReferrerInput {
  brandId: string;
  listingKind: ReferralListingKind;
  listingId: string;
  orderKind: ReferralOrderKind;
  buyer: ReferralBuyerIdentity;
  typedCode: string | null;
  visitorKey: string | null;
  eligibleMinor: number;
  brandRail: ReferralRail;
  currency: string;
  nowIso: string;
}

export interface ReferrerResolution {
  version: 1;
  source: ReferralSource;
  touchId: string | null;
  memberId: string | null;
  trackingId: string | null;
  offerId: string | null;
  rejectedReason: ReferralRejectedReason | null;
  eligibleMinor: number;
  shareBps: number | null;
  shareMinor: number;
  rewardKind: "cash" | "voucher" | "perk" | null;
  voucherTemplate: Record<string, unknown> | null;
  payeeUserId: string | null;
  payeeEmailNorm: string | null;
  rail: ReferralRail;
  currency: string;
  listingKind: ReferralListingKind;
  listingId: string;
  orderKind: ReferralOrderKind;
}

export function emptyReferrerResolution(
  input: ResolveReferrerInput,
  tracking: ReferralTrackingCandidate | null = null,
): ReferrerResolution {
  return {
    version: 1,
    source: tracking ? "tracking_link" : "none",
    touchId: tracking?.touchId ?? null,
    memberId: null,
    trackingId: tracking?.trackingId ?? null,
    offerId: null,
    rejectedReason: null,
    eligibleMinor: Math.max(0, Math.trunc(input.eligibleMinor)),
    shareBps: null,
    shareMinor: 0,
    rewardKind: null,
    voucherTemplate: null,
    payeeUserId: null,
    payeeEmailNorm: null,
    rail: input.brandRail,
    currency: input.currency.toUpperCase(),
    listingKind: input.listingKind,
    listingId: input.listingId,
    orderKind: input.orderKind,
  };
}

export function roundHalfUpBasisPoints(
  eligibleMinor: number,
  bps: number,
): number {
  const eligible = BigInt(Math.max(0, Math.trunc(eligibleMinor)));
  const rate = BigInt(Math.max(0, Math.trunc(bps)));
  const rounded = (eligible * rate + 5_000n) / 10_000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("referral_share_overflow");
  }
  return Number(rounded);
}

export function applicationFeeWithReferralShare(
  minglaApplicationFeeMinor: number,
  resolution: Pick<ReferrerResolution, "shareMinor">,
): number {
  const base = Math.max(0, Math.trunc(minglaApplicationFeeMinor));
  const share = Math.max(0, Math.trunc(resolution.shareMinor));
  const total = base + share;
  if (!Number.isSafeInteger(total)) throw new Error("application_fee_overflow");
  return total;
}

/**
 * Allocate a frozen whole-order share to one payment without changing what the
 * buyer pays. Cumulative half-up allocation makes every slice deterministic,
 * and the final slice absorbs the exact remainder so installments neither
 * over- nor under-collect the referral obligation.
 */
export function referralShareForPayment(
  resolution: Pick<ReferrerResolution, "eligibleMinor" | "shareMinor">,
  priorEligibleMinor: number,
  paymentEligibleMinor: number,
): number {
  const eligible = Math.trunc(resolution.eligibleMinor);
  const share = Math.trunc(resolution.shareMinor);
  const prior = Math.trunc(priorEligibleMinor);
  const payment = Math.trunc(paymentEligibleMinor);
  if (
    !Number.isSafeInteger(eligible) || !Number.isSafeInteger(share) ||
    !Number.isSafeInteger(prior) || !Number.isSafeInteger(payment) ||
    eligible < 0 || share < 0 || share > eligible || prior < 0 ||
    payment < 0 || prior + payment > eligible
  ) {
    throw new Error("referral_payment_slice_invalid");
  }
  if (share === 0 || payment === 0) return 0;
  if (eligible === 0) throw new Error("referral_payment_slice_invalid");

  const denominator = BigInt(eligible);
  const totalShare = BigInt(share);
  const cumulative = (minor: number): bigint =>
    (2n * BigInt(minor) * totalShare + denominator) / (2n * denominator);
  const allocated = cumulative(prior + payment) - cumulative(prior);
  if (allocated < 0n || allocated > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("referral_payment_slice_overflow");
  }
  return Number(allocated);
}

function normalizedEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function sameIdentity(
  member: ReferralMemberCandidate,
  buyer: ReferralBuyerIdentity,
): boolean {
  if (buyer.userId !== null && member.userId === buyer.userId) return true;
  const buyerEmail = normalizedEmail(buyer.emailNorm);
  const memberEmail = normalizedEmail(member.emailNorm);
  return buyerEmail !== null && memberEmail === buyerEmail;
}

function offerInactiveReason(
  offer: ReferralOfferCandidate,
  nowMs: number,
): ReferralRejectedReason | null {
  if (offer.status === "paused" || offer.status === "ended") {
    return "offer_ended";
  }
  if (offer.status !== "active") return "offer_ended";
  const starts = Date.parse(offer.startsAt);
  const ends = offer.endsAt === null
    ? Number.POSITIVE_INFINITY
    : Date.parse(offer.endsAt);
  if (!Number.isFinite(starts) || nowMs < starts || nowMs >= ends) {
    return "offer_ended";
  }
  return null;
}

function payeeIsExplicitlyCrossRail(
  member: ReferralMemberCandidate,
  brandRail: ReferralRail,
  rails: ReferralPayeeRails,
): boolean {
  // A guest/unclaimed member has not selected a rail yet. The obligation stays
  // cash and is held until they claim + onboard; it must not be silently
  // downgraded merely because no payout account exists yet (D36).
  if (member.userId === null) return false;
  if (rails[brandRail]) return false;
  const other: ReferralRail = brandRail === "stripe" ? "paystack" : "stripe";
  return rails[other];
}

/**
 * D8 resolver. Code beats link; otherwise the store supplies the latest
 * unexpired touch. Tracking is independent and can coexist with member credit.
 */
export async function resolveReferrer(
  store: ReferralAttributionStore,
  input: ResolveReferrerInput,
): Promise<ReferrerResolution> {
  if (!Number.isSafeInteger(input.eligibleMinor) || input.eligibleMinor < 0) {
    throw new Error("referral_eligible_minor_invalid");
  }
  if (!(await store.referralsEnabled(input.brandId))) {
    return emptyReferrerResolution(input);
  }

  const tracking = await store.latestTrackingTouch({
    brandId: input.brandId,
    userId: input.buyer.userId,
    visitorKey: input.visitorKey,
    nowIso: input.nowIso,
  });
  const normalizedCode = input.typedCode?.trim().toUpperCase() ?? "";
  const codeMember = normalizedCode.length > 0
    ? await store.memberByCode(input.brandId, normalizedCode)
    : null;
  const linkMember = codeMember === null
    ? await store.latestMemberTouch({
      brandId: input.brandId,
      userId: input.buyer.userId,
      visitorKey: input.visitorKey,
      nowIso: input.nowIso,
    })
    : null;
  const member = codeMember ?? linkMember;
  if (member === null) return emptyReferrerResolution(input, tracking);

  const source: ReferralSource = codeMember !== null ? "code" : "member_link";
  const offer = await store.offerForMember({
    member,
    listingKind: input.listingKind,
    listingId: input.listingId,
  });
  const base: ReferrerResolution = {
    ...emptyReferrerResolution(input, tracking),
    source,
    touchId: source === "member_link" ? member.touchId : null,
    memberId: member.id,
    offerId: member.offerId,
    payeeUserId: member.userId,
    payeeEmailNorm: normalizedEmail(member.emailNorm),
  };

  if (member.status !== "active") {
    return { ...base, rejectedReason: "member_removed" };
  }
  if (
    offer === null || offer.brandId !== input.brandId || !offer.coversListing
  ) {
    return { ...base, rejectedReason: "offer_ended" };
  }
  const inactive = offerInactiveReason(offer, Date.parse(input.nowIso));
  if (inactive !== null) return { ...base, rejectedReason: inactive };
  if (sameIdentity(member, input.buyer)) {
    return { ...base, rejectedReason: "self_referral" };
  }

  if (offer.rewardKind === "perk") {
    return {
      ...base,
      rewardKind: "perk",
      voucherTemplate: null,
    };
  }
  if (offer.rewardKind === "voucher") {
    return {
      ...base,
      rewardKind: "voucher",
      voucherTemplate: offer.voucherTemplate,
    };
  }

  const completedSales = await store.completedSales(offer.id, member.id);
  const tier = await store.tierShareBps(offer.id, completedSales);
  const shareBps = tier ?? offer.shareBps;
  if (shareBps === null) throw new Error("referral_cash_rate_missing");
  const gross = roundHalfUpBasisPoints(input.eligibleMinor, shareBps);

  const rails = member.userId === null
    ? { stripe: false, paystack: false }
    : await store.payeeRails(member.userId);
  if (payeeIsExplicitlyCrossRail(member, input.brandRail, rails)) {
    return offer.voucherTemplate === null
      ? {
        ...base,
        rejectedReason: "cross_rail",
        shareBps,
      }
      : {
        ...base,
        rejectedReason: "cross_rail",
        rewardKind: "voucher",
        voucherTemplate: offer.voucherTemplate,
        shareBps,
      };
  }

  if (offer.budgetMinor !== null) {
    const committed = await store.committedGrossMinor(offer.id);
    if (committed + gross > offer.budgetMinor) {
      return {
        ...base,
        rejectedReason: "budget_reached",
        shareBps,
      };
    }
  }

  return {
    ...base,
    rewardKind: "cash",
    shareBps,
    shareMinor: gross,
  };
}

function rowObject(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

/** Service-role adapter used only by checkout edges; clients never import it. */
export function supabaseReferralStore(client: any): ReferralAttributionStore {
  const member = async (
    memberId: string,
    touchId: string | null,
  ): Promise<ReferralMemberCandidate | null> => {
    const { data, error } = await client.from("referral_members")
      .select("id,offer_id,brand_id,user_id,email_norm,status")
      .eq("id", memberId).maybeSingle();
    if (error) {
      throw new Error(`referral_member_lookup_failed:${error.message}`);
    }
    const row = rowObject(data);
    if (!row) return null;
    return {
      id: String(row.id),
      offerId: String(row.offer_id),
      brandId: String(row.brand_id),
      userId: typeof row.user_id === "string" ? row.user_id : null,
      emailNorm: typeof row.email_norm === "string" ? row.email_norm : null,
      status: row.status,
      touchId,
    };
  };

  const latestTouch = async (
    tableKind: "member" | "tracking",
    input: {
      brandId: string;
      userId: string | null;
      visitorKey: string | null;
      nowIso: string;
    },
  ): Promise<Record<string, any> | null> => {
    if (input.userId === null && input.visitorKey === null) return null;
    let query = client.from("attribution_touches")
      .select("id,member_id,tracking_id")
      .eq("kind", tableKind)
      .eq("brand_id", input.brandId)
      .gt("expires_at", input.nowIso)
      .order("touched_at", { ascending: false })
      .limit(1);
    query = input.userId !== null
      ? query.eq("user_id", input.userId)
      : query.eq("visitor_key", input.visitorKey);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(`referral_touch_lookup_failed:${error.message}`);
    return rowObject(data);
  };

  return {
    async referralsEnabled(brandId) {
      const { data, error } = await client.rpc("issue_3872_referrals_on", {
        p_brand_id: brandId,
      });
      if (error) {
        throw new Error(`referrals_flag_lookup_failed:${error.message}`);
      }
      return data === true;
    },
    async memberByCode(brandId, code) {
      const { data, error } = await client.from("referral_members")
        .select("id")
        .eq("brand_id", brandId)
        .eq("code", code)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (error) {
        throw new Error(`referral_code_lookup_failed:${error.message}`);
      }
      const row = rowObject(data);
      return row ? await member(String(row.id), null) : null;
    },
    async latestMemberTouch(input) {
      const touch = await latestTouch("member", input);
      return touch && typeof touch.member_id === "string"
        ? await member(touch.member_id, String(touch.id))
        : null;
    },
    async latestTrackingTouch(input) {
      const touch = await latestTouch("tracking", input);
      return touch && typeof touch.tracking_id === "string"
        ? { trackingId: touch.tracking_id, touchId: String(touch.id) }
        : null;
    },
    async offerForMember({ member: memberRow, listingKind, listingId }) {
      const { data, error } = await client.from("referral_offers")
        .select(
          "id,brand_id,status,starts_at,ends_at,reward_kind,share_bps,voucher_template,budget_minor,currency,scope_kind",
        )
        .eq("id", memberRow.offerId).maybeSingle();
      if (error) {
        throw new Error(`referral_offer_lookup_failed:${error.message}`);
      }
      const row = rowObject(data);
      if (!row) return null;
      let coversListing = row.scope_kind === "brand";
      if (!coversListing) {
        const { data: listing, error: listingError } = await client
          .from("referral_offer_listings").select("offer_id")
          .eq("offer_id", memberRow.offerId)
          .eq("listing_kind", listingKind)
          .eq("listing_id", listingId).maybeSingle();
        if (listingError) {
          throw new Error(
            `referral_scope_lookup_failed:${listingError.message}`,
          );
        }
        coversListing = listing !== null;
      }
      return {
        id: String(row.id),
        brandId: String(row.brand_id),
        status: row.status,
        startsAt: String(row.starts_at),
        endsAt: typeof row.ends_at === "string" ? row.ends_at : null,
        rewardKind: row.reward_kind,
        shareBps: Number.isInteger(row.share_bps)
          ? Number(row.share_bps)
          : null,
        voucherTemplate: rowObject(row.voucher_template),
        budgetMinor: Number.isSafeInteger(Number(row.budget_minor))
          ? Number(row.budget_minor)
          : null,
        currency: String(row.currency),
        coversListing,
      };
    },
    async tierShareBps(offerId, completedSales) {
      const { data, error } = await client.from("referral_offer_tiers")
        .select("share_bps")
        .eq("offer_id", offerId)
        .lte("min_sales", completedSales)
        .order("min_sales", { ascending: false })
        .limit(1).maybeSingle();
      if (error) {
        throw new Error(`referral_tier_lookup_failed:${error.message}`);
      }
      const row = rowObject(data);
      return row && Number.isInteger(row.share_bps)
        ? Number(row.share_bps)
        : null;
    },
    async completedSales(offerId, memberId) {
      const { data, error } = await client.from("payee_shares")
        .select("gross_minor,reversed_minor,order_attributions!inner(offer_id)")
        .eq("member_id", memberId)
        .eq("order_attributions.offer_id", offerId)
        .in("status", [
          "pending",
          "held_until_event",
          "releasable",
          "accumulating",
          "paid",
        ]);
      if (error) {
        throw new Error(`referral_sales_lookup_failed:${error.message}`);
      }
      return (Array.isArray(data) ? data : []).filter((row) =>
        Number(row.gross_minor ?? 0) > Number(row.reversed_minor ?? 0)
      ).length;
    },
    async committedGrossMinor(offerId) {
      const { data, error } = await client.from("payee_shares")
        .select("gross_minor,reversed_minor,order_attributions!inner(offer_id)")
        .eq("order_attributions.offer_id", offerId)
        .in("status", [
          "pending",
          "held_until_event",
          "releasable",
          "accumulating",
          "paid",
        ]);
      if (error) {
        throw new Error(`referral_budget_lookup_failed:${error.message}`);
      }
      return (Array.isArray(data) ? data : []).reduce(
        (sum: number, row: Record<string, unknown>) =>
          sum +
          Math.max(
            0,
            Number(row.gross_minor ?? 0) - Number(row.reversed_minor ?? 0),
          ),
        0,
      );
    },
    async payeeRails(userId) {
      const { data, error } = await client.from("payee_accounts")
        .select("stripe_status,paystack_status")
        .eq("user_id", userId).maybeSingle();
      if (error) throw new Error(`payee_rail_lookup_failed:${error.message}`);
      const row = rowObject(data);
      return {
        stripe: row?.stripe_status === "active",
        paystack: row?.paystack_status === "verified",
      };
    },
  };
}

export async function resolveReferrerFromSupabase(
  client: any,
  input: ResolveReferrerInput,
): Promise<ReferrerResolution> {
  return await resolveReferrer(supabaseReferralStore(client), input);
}
