// Issue #3355 P7 — the payout countries a Host can choose, as a leaf module.
//
// Every card-rail country plus Nigeria, and each one's default time zone.
// agentAri10xTools re-exports these for
// Ari's tools; the flow engine's money gate imports this file directly so it
// does not pull Ari's research tools into every function that runs a flow.

import { STRIPE_SUPPORTED_COUNTRIES } from "./stripeSupportedCountries.ts";

/** #3355 P7 — one payout country the Host chooser offers. */
export interface PayoutRail {
  country: string;
  name: string;
  currency: string;
  provider: "stripe" | "paystack";
}

function regionName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch (_error) {
    return code;
  }
}

// orch-strict-grep-allow stripe-country-out-of-scope — Nigeria uses the canonical Paystack branch, never Stripe Connect.
const NIGERIA_PAYOUT_RAIL: PayoutRail = {
  country: "NG",
  name: "Nigeria",
  currency: "NGN",
  provider: "paystack",
};

/**
 * #3355 P7 — the Host payout-country chooser's list (BrandPayoutCountryField):
 * every card-rail country plus Nigeria, by name. Same source as
 * get_market_rules, so Ari never offers a country the Host can't save.
 */
export const PAYOUT_COUNTRIES: readonly PayoutRail[] = Object.freeze(
  [
    ...STRIPE_SUPPORTED_COUNTRIES.map((entry): PayoutRail => ({
      country: entry.country,
      name: regionName(entry.country),
      currency: entry.defaultCurrency,
      provider: "stripe",
    })),
    NIGERIA_PAYOUT_RAIL,
  ].sort((a, b) => a.name.localeCompare(b.name)),
);

const PAYOUT_COUNTRY_ALIASES: Readonly<Record<string, string>> = Object.freeze(
  {
    uk: "GB",
    "great britain": "GB",
    britain: "GB",
    england: "GB",
    scotland: "GB",
    wales: "GB",
    "northern ireland": "GB",
    us: "US",
    usa: "US",
    america: "US",
    "united states of america": "US",
  },
);

/** A payout country from a code, a name, or a card label ("United Kingdom (GBP)"). */
export function payoutRailFor(input: unknown): PayoutRail | null {
  if (typeof input !== "string") return null;
  const words = input.replace(/\([^)]*\)/g, " ").replace(/[.!]+$/, "")
    .replace(/\s+/g, " ").trim().toLowerCase()
    .replace(/^(?:in|it'?s in|the)\s+/, "").replace(/^the\s+/, "");
  if (!words) return null;
  const code = PAYOUT_COUNTRY_ALIASES[words] ??
    (/^[a-z]{2}$/.test(words) ? words.toUpperCase() : null);
  return PAYOUT_COUNTRIES.find((rail) =>
    rail.country === code || rail.name.toLowerCase() === words
  ) ?? null;
}

// #3355 P6 (D-27): the default IANA time zone for each payout country that
// has exactly one. Countries spanning several zones (US, CA; ES with the
// Canaries; PT with the Azores) return null so Ari asks the owner.
export const MARKET_DEFAULT_TIMEZONES: Readonly<Record<string, string | null>> =
  Object.freeze({
    AT: "Europe/Vienna",
    BE: "Europe/Brussels",
    BG: "Europe/Sofia",
    CA: null,
    CH: "Europe/Zurich",
    CY: "Asia/Nicosia",
    CZ: "Europe/Prague",
    DE: "Europe/Berlin",
    DK: "Europe/Copenhagen",
    EE: "Europe/Tallinn",
    ES: null,
    FI: "Europe/Helsinki",
    FR: "Europe/Paris",
    GB: "Europe/London",
    GR: "Europe/Athens",
    HR: "Europe/Zagreb",
    HU: "Europe/Budapest",
    IE: "Europe/Dublin",
    IS: "Atlantic/Reykjavik",
    IT: "Europe/Rome",
    LI: "Europe/Vaduz",
    LT: "Europe/Vilnius",
    LU: "Europe/Luxembourg",
    LV: "Europe/Riga",
    MT: "Europe/Malta",
    NG: "Africa/Lagos",
    NL: "Europe/Amsterdam",
    NO: "Europe/Oslo",
    PL: "Europe/Warsaw",
    PT: null,
    RO: "Europe/Bucharest",
    SE: "Europe/Stockholm",
    SI: "Europe/Ljubljana",
    SK: "Europe/Bratislava",
    US: null,
  });

/** The single default zone for a country, or null (several zones / unknown). */
export function marketDefaultTimezone(country: unknown): string | null {
  if (typeof country !== "string") return null;
  const code = country.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(MARKET_DEFAULT_TIMEZONES, code)
    ? MARKET_DEFAULT_TIMEZONES[code]
    : null;
}
