export const FX_PROVIDER = "exchange_rate_api_open_v6";
export const FX_PROVIDER_URL = "https://open.er-api.com/v6/latest/USD";
export const FX_PROVIDER_ATTRIBUTION_URL = "https://www.exchangerate-api.com/";

export interface SupportedCurrency {
  code: string;
  minorUnitExponent: number;
}

export interface ValidatedFxPayload {
  providerUpdatedAt: string;
  providerNextUpdateAt: string;
  providerEolAt: string;
  rates: Record<string, number>;
  canonicalPayload: string;
}

type OpenV6Payload = {
  result?: unknown;
  base_code?: unknown;
  time_last_update_unix?: unknown;
  time_next_update_unix?: unknown;
  time_eol_unix?: unknown;
  rates?: unknown;
};

function unixSecondsToIso(value: unknown, field: string): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`invalid_${field}`);
  }
  const date = new Date(value * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error(`invalid_${field}`);
  return date.toISOString();
}

function canonicalJson(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

export function validateFxProviderPayload(
  payload: unknown,
  supportedCurrencies: readonly SupportedCurrency[],
  now: Date,
): ValidatedFxPayload {
  if (!payload || typeof payload !== "object") throw new Error("malformed_payload");
  const raw = payload as OpenV6Payload;
  if (raw.result !== "success") throw new Error("provider_result_not_success");
  if (raw.base_code !== "USD") throw new Error("provider_base_not_usd");
  if (!raw.rates || typeof raw.rates !== "object" || Array.isArray(raw.rates)) {
    throw new Error("provider_rates_missing");
  }

  const providerUpdatedAt = unixSecondsToIso(
    raw.time_last_update_unix,
    "provider_updated_at",
  );
  const providerNextUpdateAt = unixSecondsToIso(
    raw.time_next_update_unix,
    "provider_next_update_at",
  );
  const providerEolAt = unixSecondsToIso(raw.time_eol_unix, "provider_eol_at");
  if (new Date(providerEolAt).getTime() <= now.getTime()) {
    throw new Error("provider_data_expired");
  }
  if (
    new Date(providerUpdatedAt).getTime() >=
      new Date(providerNextUpdateAt).getTime()
  ) {
    throw new Error("provider_timestamp_order");
  }

  const providerRates = raw.rates as Record<string, unknown>;
  const rates: Record<string, number> = {};
  for (const currency of supportedCurrencies) {
    const rate = providerRates[currency.code];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`missing_or_invalid_rate:${currency.code}`);
    }
    rates[currency.code] = rate;
  }
  if (rates.USD !== 1) throw new Error("usd_identity_rate_missing");

  const canonicalPayload = canonicalJson({
    base: "USD",
    providerUpdatedAt,
    providerNextUpdateAt,
    providerEolAt,
    rates: canonicalJson(rates),
  });
  return {
    providerUpdatedAt,
    providerNextUpdateAt,
    providerEolAt,
    rates,
    canonicalPayload,
  };
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function constantTimeEqual(
  provided: string,
  expected: string,
): Promise<boolean> {
  if (provided.length === 0 || expected.length === 0) return false;
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}
