// ORCH-1006 [Universal all-in pricing engine] — server-side money engine.
//
// One owner of the all-in math (Constitution #2). Turns
//   (base tiers, 3 switches, region/currency, venue tax basis, take-rate bps)
// into ONE buyer total + the money split, with ZERO buyer-entered address.
//
// Mental model (take-rate amendment §2.4):
//   Take-rate     = Mingla's profit (set by Seth, collected via application_fee_amount).
//   Service fee   = Stripe's processing-cost recovery (set by the brand's switch).
//   Stripe fee    = paid by the connected account (controller fees responsibility).
//   Three levers, three owners, never netted.
//
// Stripe docs cited where load-bearing:
//   - direct-charge application_fee_amount: https://docs.stripe.com/connect/direct-charges#collect-fees
//   - PaymentIntent application_fee_amount: https://docs.stripe.com/api/payment_intents/create#create_payment_intent-application_fee_amount
//   - tax.calculations.create line_items.tax_behavior (inclusive|exclusive):
//       https://docs.stripe.com/api/tax/calculations/create#create_tax_calculation-line_items-tax_behavior
//   - amounts in smallest currency unit (zero-decimal currencies carry NO minor
//     unit — JPY/KRW etc.): https://docs.stripe.com/currencies
//   - charge in the connected account's settlement currency to avoid Stripe FX
//     (presentment == settlement ⇒ no conversion fee): https://docs.stripe.com/currencies
//       and on_behalf_of settlement: https://docs.stripe.com/connect/charges
//
// ORCH-1034 [de-GBP-ify the currency layer — charge in seller currency]:
//   `currency` is the brand's SETTLEMENT currency (brands.pricing_currency, now
//   aligned to default_currency = the Stripe-synced settlement currency). The
//   engine math is currency-agnostic integer minor-unit (cents); zero-decimal
//   currencies treat the "cents" as whole units (none of the live currencies
//   USD/GBP/EUR/CHF are zero-decimal, so this is a forward-safety note).

// Launch default for the disclosed, uniform service fee (T-2 operator-locked:
// flat % of order, uniform across ALL card types — never card-conditional, which
// would re-classify it as a regulated surcharge: https://docs.stripe.com/payments/surcharging).
// Exact % is operator-tunable at/near launch; 300 bps (3.00%) is the documented
// launch default (matches the amendment's worked example).
export const MINGLA_SERVICE_FEE_BPS = 300 as const;

// ORCH-1034 [de-GBP-ify the currency layer] — region union widened from the
// GB-only literal to the enabled-region allowlist matching the brands.pricing_region
// CHECK (GB/US/EU/CH). `tax_behavior` is a thin per-region DISPLAY flag, NOT a tax
// calculator — Stripe Tax (venue-sourced, ORCH-0955) owns the charged AMOUNT; the
// engine only relays inclusive|exclusive to Stripe and re-derives the display split.
// Investigation: Mingla_Artifacts/reports/INVESTIGATION_ORCH-1034_TAX_TIE_IN.md.
// META-ORCH-1076 [Paystack Africa] — NG joins the region union. NG VAT is
// EXCLUSIVE (added on top, Nigerian invoicing convention) and is computed
// in-engine from country_vat_config (Paystack has no Tax API), NOT via a Stripe
// round-trip. The GB/US/EU/CH paths are untouched — the NG branch is reached
// only when region==="NG", which only a Paystack brand can have.
export type PricingRegion = "GB" | "US" | "EU" | "CH" | "NG";
export type TaxBehavior = "inclusive" | "exclusive";
export type TaxBasis =
  | "venue_resolved"
  | "unresolved_flat_absorb"
  | "country_unsupported_flat_absorb"
  | "calc_failed_flat_absorb"
  // META-ORCH-1076 — NG VAT computed in-engine from country_vat_config (no
  // Stripe Tax round-trip). Self-describing receipt basis for the Paystack arm.
  | "config_vat";

// ORCH-1034 — per-region inclusive-VAT divisor (1 + VAT rate) used ONLY to
// re-derive the display tax portion from Stripe's amount_total for INCLUSIVE
// markets. This is a presentation split of a Stripe-owned number, NOT a tax
// calculation (the engine never computes tax — see investigation §3 PROVE-1/2).
// Generalizes ORCH-1006's hardcoded `/1.2` (GB-20%) to the seller's market.
// Standard headline rates: GB 20%, EU baseline 20% (member-state rates vary but
// the venue-sourced Stripe amount is authoritative; this divisor only partitions
// the inclusive total for the receipt), CH 8.1%. US is exclusive (no divisor).
// Doc (tax_behavior inclusive|exclusive presentation semantics):
//   https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior
export const INCLUSIVE_VAT_DIVISOR: Record<PricingRegion, number> = {
  GB: 1.2, // 20% VAT
  EU: 1.2, // 20% baseline (venue-sourced Stripe amount is authoritative)
  CH: 1.081, // 8.1% VAT
  US: 1.0, // exclusive — divisor unused (kept for exhaustiveness)
  NG: 1.0, // META-ORCH-1076 — EXCLUSIVE (VAT added on top); divisor unused.
};

// GB/EU/CH → inclusive VAT (market convention); US → exclusive sales tax.
// Region drives behavior, NEVER a hardcoded literal at the call site
// (invariant I-PROPOSED-ALLIN-REGION-TAX-BEHAVIOR). ORCH-1034: degrade-not-throw
// — the call site must degrade to flat-absorb BEFORE passing an unmapped region,
// so this never throws on a real checkout. The exhaustive `never` guard is kept
// as a loud programming-error catch (adding a region literal without mapping it).
export function taxBehaviorForRegion(region: PricingRegion): TaxBehavior {
  switch (region) {
    case "GB":
    case "EU":
    case "CH":
      return "inclusive";
    case "US":
    // META-ORCH-1076 — NG VAT is EXCLUSIVE (added on top of the price before
    // Paystack initialize, matching Nigerian invoicing; avoids the inclusive
    // divisor re-derivation entirely). Doc basis: Paystack charges `amount`
    // exactly as given (PAYSTACK_INTEGRATION_REFERENCE.md §2.4 / §1.5;
    // https://paystack.com/docs/api/transaction/) — VAT is Mingla-computed
    // and added pre-initialize.
    case "NG":
      return "exclusive";
    default: {
      // Exhaustive guard: any unmapped region literal is a programming error.
      const _never: never = region;
      throw new Error(`unsupported_pricing_region:${String(_never)}`);
    }
  }
}

// ORCH-1034 — the inclusive-VAT divisor for the seller's region, used by the
// call site to extract the display tax portion from Stripe's inclusive total.
// Returns 1.0 for exclusive/unknown regions (no divide-out).
export function inclusiveVatDivisorForRegion(region: PricingRegion): number {
  return INCLUSIVE_VAT_DIVISOR[region] ?? 1.0;
}

export interface PricingSwitches {
  pass_tax: boolean;
  pass_mingla_fee: boolean;
  pass_service_fee: boolean;
}

export interface PricingBreakdown {
  region: PricingRegion;
  currency: string;
  tax_behavior: TaxBehavior;
  tax_basis: TaxBasis;
  switches: PricingSwitches;
  base_cents: number;
  buyer_subtotal_cents: number;
  buyer_total_cents: number;
  components: {
    mingla_fee_cents: number;
    service_fee_cents: number;
    tax_cents: number;
  };
  passed: {
    mingla_fee_cents: number;
    service_fee_cents: number;
    tax_cents: number;
  };
  absorbed: {
    mingla_fee_cents: number;
    service_fee_cents: number;
    tax_cents: number;
  };
  application_fee_amount_cents: number;
  connected_account_payout_cents: number;
  stripe_tax_calculation_id: string | null;
  // Take-rate amendment §E.1 — the rate this order was charged at (auditable,
  // frozen point-in-time; historical orders keep their sold rate).
  effective_take_rate_bps: number;
  take_rate_source: "brand_override" | "platform_default";
}

export interface ComputeAllInInput {
  baseCents: number; // sum of tier prices (pre-tax, pre-fee) from the RPC
  switches: PricingSwitches;
  region: PricingRegion;
  currency: string;
  effectiveTakeRateBps: number;
  takeRateSource: "brand_override" | "platform_default";
  serviceFeeBps?: number; // defaults to MINGLA_SERVICE_FEE_BPS
}

// Integer basis-point money math (no float on the fee path; invariant
// I-PROPOSED-TAKE-RATE-BPS-INTEGER): round(base × bps / 10000).
export function feeFromBps(baseCents: number, bps: number): number {
  return Math.round((baseCents * bps) / 10000);
}

// The grossed-up buyer subtotal BEFORE tax. Tax is applied by the caller via
// Stripe's tax.calculations.create on this subtotal. This function computes
// everything that does NOT need a Stripe round-trip, so the view + the preview
// + the create path share one deterministic result.
export function computeBuyerSubtotal(input: ComputeAllInInput): {
  miglaFeeCents: number;
  serviceFeeCents: number;
  buyerSubtotalCents: number;
} {
  const serviceFeeBps = input.serviceFeeBps ?? MINGLA_SERVICE_FEE_BPS;
  const miglaFeeCents = feeFromBps(input.baseCents, input.effectiveTakeRateBps);
  const serviceFeeCents = feeFromBps(input.baseCents, serviceFeeBps);

  let buyerSubtotal = input.baseCents;
  if (input.switches.pass_mingla_fee) buyerSubtotal += miglaFeeCents;
  if (input.switches.pass_service_fee) buyerSubtotal += serviceFeeCents;

  return {
    miglaFeeCents,
    serviceFeeCents,
    buyerSubtotalCents: buyerSubtotal,
  };
}

// META-ORCH-1076 [Paystack Africa] — config-driven NG VAT (the Paystack arm has
// NO Stripe Tax round-trip). EXCLUSIVE: VAT is added ON TOP of the grossed-up
// buyer subtotal, so the buyer's all-in NGN total = subtotal + VAT (when the
// brand passes tax) or = subtotal (when the brand absorbs it — the brand still
// owes the VAT, recorded in pricing_breakdown.absorbed.tax_cents). Integer
// basis-point math via the existing feeFromBps helper (no float on the money
// path). This is the ENTIRE tax computation for NG — deterministic, WYSIWYP.
// vatRateBps comes from country_vat_config (NG=750=7.5%).
//   Paystack amount semantics: https://paystack.com/docs/api/transaction/
//   (amount in subunits, charged exactly as given).
export function computeConfigVat(
  subtotalCents: number,
  vatRateBps: number,
  passTax: boolean,
): { taxCents: number; buyerTotalCents: number } {
  // The VAT the brand owes on this sale, regardless of pass/absorb — used for
  // the breakdown's passed/absorbed partition (mirrors the GB absorbed-tax
  // reporting). When passTax is false, the buyer total excludes it.
  const taxCents = feeFromBps(subtotalCents, vatRateBps);
  const buyerTotalCents = passTax ? subtotalCents + taxCents : subtotalCents;
  return { taxCents, buyerTotalCents };
}

// Assemble the canonical pricing_breakdown once tax is known.
//   amountTotalCents = the Stripe tax.calculations.create amount_total.
//     - GB inclusive: amount_total == buyer_subtotal (VAT extracted inside).
//     - flat-absorb / no tax: amount_total == buyer_subtotal.
//   taxCents = the tax portion (inclusive VAT extracted, or 0 for flat-absorb).
export function buildPricingBreakdown(args: {
  input: ComputeAllInInput;
  amountTotalCents: number;
  taxCents: number;
  taxBasis: TaxBasis;
  stripeTaxCalculationId: string | null;
}): PricingBreakdown {
  const { input, amountTotalCents, taxCents, taxBasis, stripeTaxCalculationId } =
    args;
  const { miglaFeeCents, serviceFeeCents, buyerSubtotalCents } =
    computeBuyerSubtotal(input);
  const taxBehavior = taxBehaviorForRegion(input.region);

  // application_fee_amount is ALWAYS the Mingla fee (the take-rate skim),
  // regardless of pass/absorb — pass/absorb only changes the buyer-facing
  // gross-up (take-rate amendment §2.3). Direct-charge collection:
  // https://docs.stripe.com/connect/direct-charges#collect-fees
  const applicationFeeAmountCents = miglaFeeCents;

  // absorbed VAT under GB inclusive: the buyer pays the same headline number
  // whether passed or absorbed (T-1). We attribute the VAT to "passed" when the
  // brand chose to pass it, else to "absorbed" — both are the same buyer number,
  // the partition is for the brand's "you covered £X" reporting (decision #6).
  const passTaxEffective = input.switches.pass_tax;

  return {
    region: input.region,
    currency: input.currency,
    tax_behavior: taxBehavior,
    tax_basis: taxBasis,
    switches: input.switches,
    base_cents: input.baseCents,
    buyer_subtotal_cents: buyerSubtotalCents,
    buyer_total_cents: amountTotalCents,
    components: {
      mingla_fee_cents: miglaFeeCents,
      service_fee_cents: serviceFeeCents,
      tax_cents: taxCents,
    },
    passed: {
      mingla_fee_cents: input.switches.pass_mingla_fee ? miglaFeeCents : 0,
      service_fee_cents: input.switches.pass_service_fee ? serviceFeeCents : 0,
      tax_cents: passTaxEffective ? taxCents : 0,
    },
    absorbed: {
      mingla_fee_cents: input.switches.pass_mingla_fee ? 0 : miglaFeeCents,
      service_fee_cents: input.switches.pass_service_fee ? 0 : serviceFeeCents,
      tax_cents: passTaxEffective ? 0 : taxCents,
    },
    application_fee_amount_cents: applicationFeeAmountCents,
    // payout = buyer_total − Mingla fee − tax-set-aside; Stripe's processing fee
    // is additionally deducted from the connected account by Stripe (not modeled
    // here — it's borne by the brand per the controller config). The brand remits
    // VAT if registered (it's inside the inclusive total).
    connected_account_payout_cents:
      amountTotalCents - applicationFeeAmountCents - taxCents,
    stripe_tax_calculation_id: stripeTaxCalculationId,
    effective_take_rate_bps: input.effectiveTakeRateBps,
    take_rate_source: input.takeRateSource,
  };
}
