/**
 * ORCH-1006 [Universal all-in pricing engine] — pricing-switch persistence.
 *
 * Thin wrappers over the two shipped SECURITY-DEFINER RPCs (migration
 * 20260802000000_orch_1006_pricing_switches.sql):
 *
 *   business_set_pricing_switches(p_event_id, p_pass_tax, p_pass_mingla_fee,
 *     p_pass_service_fee) → void
 *     - writes events.pass_* (explicit per-offering OVERRIDE)
 *     - owner-direct guard: brands.account_id = auth.uid()
 *     - raises `pricing_switches_locked` if the offering has sold a ticket
 *       (events.pricing_locked_at IS NOT NULL) — Surface 3 locked state
 *
 *   business_set_brand_pricing_defaults(p_brand_id, p_default_pass_tax,
 *     p_default_pass_mingla_fee, p_default_pass_service_fee) → void
 *     - writes brands.default_pass_* (Surface 2); never locks
 *
 * IMPORTANT (inheritance): the RPC params are NON-NULL booleans, so calling it
 * ALWAYS writes an explicit override — it cannot write NULL ("reset to inherit").
 * The authoring UI therefore only calls `setEventPricingSwitches` for switches
 * the brand has explicitly touched; an untouched offering leaves events.pass_*
 * NULL and inherits the brand default via the server view's COALESCE. A future
 * "reset to defaults" affordance needs a separate NULL-writing RPC (not shipped).
 */

import { supabase } from "./supabase";

/** The three resolved (concrete boolean) pass/absorb switches. */
export interface PricingSwitches {
  passTax: boolean;
  passMinglaFee: boolean;
  passServiceFee: boolean;
}

/** Per-offering raw switches: NULL = inherit brand default. */
export interface PricingSwitchOverrides {
  passTax: boolean | null;
  passMinglaFee: boolean | null;
  passServiceFee: boolean | null;
}

export interface BrandPricingDefaults {
  passTax: boolean;
  passMinglaFee: boolean;
  passServiceFee: boolean;
}

/**
 * Resolve the concrete switches a buyer/preview will see, applying brand
 * defaults wherever the offering hasn't overridden (NULL). Mirrors the server
 * view's COALESCE(e.pass_x, b.default_pass_x).
 */
export function resolveSwitches(
  overrides: PricingSwitchOverrides,
  defaults: BrandPricingDefaults,
): PricingSwitches {
  return {
    passTax: overrides.passTax ?? defaults.passTax,
    passMinglaFee: overrides.passMinglaFee ?? defaults.passMinglaFee,
    passServiceFee: overrides.passServiceFee ?? defaults.passServiceFee,
  };
}

/**
 * Persist an explicit per-offering switch override. Throws on RPC error;
 * callers should surface `pricing_switches_locked` as the Surface-3 locked
 * message and `not_brand_owner`/`event_not_found` as a generic save error.
 */
export async function setEventPricingSwitches(
  eventId: string,
  switches: PricingSwitches,
): Promise<void> {
  const { error } = await supabase.rpc("business_set_pricing_switches", {
    p_event_id: eventId,
    p_pass_tax: switches.passTax,
    p_pass_mingla_fee: switches.passMinglaFee,
    p_pass_service_fee: switches.passServiceFee,
  });
  if (error) throw error;
}

/** Persist brand-level defaults (Surface 2). Throws on RPC error. */
export async function setBrandPricingDefaults(
  brandId: string,
  defaults: BrandPricingDefaults,
): Promise<void> {
  const { error } = await supabase.rpc("business_set_brand_pricing_defaults", {
    p_brand_id: brandId,
    p_default_pass_tax: defaults.passTax,
    p_default_pass_mingla_fee: defaults.passMinglaFee,
    p_default_pass_service_fee: defaults.passServiceFee,
  });
  if (error) throw error;
}

/** True when the RPC error is the post-sale lock (drives Surface 3 messaging). */
export function isPricingLockedError(error: unknown): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return message.includes("pricing_switches_locked");
}
