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

function pricingSwitches<T extends boolean | null>(
  passTax: T,
  passMinglaFee: T,
  passServiceFee: T,
): { passTax: T; passMinglaFee: T; passServiceFee: T } {
  return { passTax, passMinglaFee, passServiceFee };
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
 * Refresh the short-lived server attestation consumed by the canonical
 * SECURITY DEFINER pricing commands. The Edge function is the only provider
 * reader; an authenticated client can request a probe but cannot mint the
 * database attestation itself.
 */
export async function refreshBrandTaxRegistrationAttestation(
  brandId: string,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{
    hasActiveRegistration?: boolean;
  }>("brand-tax-registrations-list", {
    body: { brand_id: brandId },
  });
  if (error || data?.hasActiveRegistration !== true) {
    throw new Error("tax_registration_required");
  }
}

/**
 * Persist an explicit per-offering switch override. Throws on RPC error;
 * callers should surface `pricing_switches_locked` as the Surface-3 locked
 * message and `not_brand_owner`/`event_not_found` as a generic save error.
 */
export async function setEventPricingSwitches(
  eventId: string,
  switches: Partial<PricingSwitchOverrides>,
): Promise<{ overrides: PricingSwitchOverrides; resolved: PricingSwitches; updatedAt: string }> {
  if (switches.passTax === true) {
    // orch-strict-grep-allow events-type-filter — this canonical pricing command supports the exact event+experience set.
    const { data: event, error: eventError } = await supabase.from("events")
      .select("brand_id")
      .eq("id", eventId)
      .in("event_type", ["event", "experience"])
      .maybeSingle();
    if (eventError || typeof event?.brand_id !== "string") {
      throw new Error("event_not_found");
    }
    await refreshBrandTaxRegistrationAttestation(event.brand_id);
  }
  const patch: Record<string, boolean | null> = {};
  const has = (key: keyof PricingSwitchOverrides): boolean =>
    Object.prototype.hasOwnProperty.call(switches, key);
  if (has("passTax")) patch.pass_tax = switches.passTax ?? null;
  if (has("passMinglaFee")) patch.pass_mingla_fee = switches.passMinglaFee ?? null;
  if (has("passServiceFee")) patch.pass_service_fee = switches.passServiceFee ?? null;
  const { data, error } = await supabase.rpc("business_patch_pricing_switches", {
    p_event_id: eventId,
    p_patch: patch,
  });
  if (error) throw error;
  const value = data as { overrides?: Record<string, boolean | null>; resolved?: Record<string, boolean>; updated_at?: unknown } | null;
  if (!value?.overrides || !value.resolved || typeof value.updated_at !== "string") {
    throw new Error("pricing_switch_readback_missing");
  }
  return {
    overrides: pricingSwitches(
      value.overrides.pass_tax ?? null,
      value.overrides.pass_mingla_fee ?? null,
      value.overrides.pass_service_fee ?? null,
    ),
    resolved: pricingSwitches(
      value.resolved.pass_tax === true,
      value.resolved.pass_mingla_fee === true,
      value.resolved.pass_service_fee === true,
    ),
    updatedAt: value.updated_at,
  };
}

/** Persist brand-level defaults (Surface 2). Throws on RPC error. */
export async function setBrandPricingDefaults(
  brandId: string,
  defaults: Partial<BrandPricingDefaults>,
): Promise<BrandPricingDefaults> {
  if (defaults.passTax === true) {
    await refreshBrandTaxRegistrationAttestation(brandId);
  }
  const patch: Record<string, boolean> = {};
  if (defaults.passTax !== undefined) patch.default_pass_tax = defaults.passTax;
  if (defaults.passMinglaFee !== undefined) patch.default_pass_mingla_fee = defaults.passMinglaFee;
  if (defaults.passServiceFee !== undefined) patch.default_pass_service_fee = defaults.passServiceFee;
  const { data, error } = await supabase.rpc("business_patch_brand_pricing_defaults", {
    p_brand_id: brandId,
    p_patch: patch,
  });
  if (error) throw error;
  const value = data as { defaults?: Record<string, boolean> } | null;
  if (!value?.defaults) throw new Error("brand_pricing_defaults_readback_missing");
  return pricingSwitches(
    value.defaults.pass_tax === true,
    value.defaults.pass_mingla_fee === true,
    value.defaults.pass_service_fee === true,
  );
}

/** True when the RPC error is the post-sale lock (drives Surface 3 messaging). */
export function isPricingLockedError(error: unknown): boolean {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  return message.includes("pricing_switches_locked");
}
