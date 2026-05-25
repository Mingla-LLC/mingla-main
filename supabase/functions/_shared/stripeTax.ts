// ORCH-0953 §3.8: Native paid checkout does not run Stripe Tax yet.
// Operator gates which connected-account regions may take native paid flow.
// Empty allowlist disables native paid entirely.

export const NATIVE_PAID_ALLOWED_REGIONS_ENV = "NATIVE_PAID_ALLOWED_REGIONS";

export function getNativePaidAllowedRegions(): readonly string[] {
  const raw = Deno.env.get(NATIVE_PAID_ALLOWED_REGIONS_ENV) ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export function isNativePaidAllowedForBrand(
  brandCountry: string | null | undefined,
): boolean {
  const allowed = getNativePaidAllowedRegions();
  if (allowed.length === 0) return false;
  return allowed.includes((brandCountry ?? "").toUpperCase());
}
