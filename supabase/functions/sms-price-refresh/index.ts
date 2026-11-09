// #4273 item 10 — refresh SMS prices from Twilio's Pricing API, daily.
//
// Called by the pg_cron job issue_4273_sms_price_refresh (06:17 UTC) with the
// service role key, checked in code (verify_jwt false, like refresh-fx-rates).
// For every Twilio-routed country it reads
//   GET https://pricing.twilio.com/v1/Messaging/Countries/{ISO}
// with TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN, takes the HIGHEST outbound
// current_price (parseTwilioMessagingPrice), runs the sanity guard against
// the last good price (smsPriceRejection) and writes accepted prices to
// public.sms_country_prices. A refused or failed fetch keeps the last good
// price and is alerted to the api_health ops recipients. Termii (NG) is a
// fixed price and is never fetched. It never logs credentials or prices.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { constantTimeEqual } from "../_shared/fxRates.ts";
import { resolveAlertRecipientValue } from "../_shared/secretBundle.ts";
import { sendOpsAlertEmail } from "../_shared/stripeOpsAlertEmail.ts";
import {
  parseTwilioMessagingPrice,
  SMS_PRICE_ANCHOR_WINDOW,
  SMS_PRICE_HISTORY_RETENTION_MS,
  SMS_PRICE_STABLE_DAYS,
  SMS_PRICE_TABLE,
  type SmsCountryPriceRow,
  smsPriceAnchor,
  smsPriceRejection,
  smsPriceStableStep,
  twilioPricedCountries,
} from "../_shared/smsPriceTable.ts";

const PRICING_URL = "https://pricing.twilio.com/v1/Messaging/Countries";

export interface RefreshDeps {
  fetch: typeof fetch;
  // deno-lint-ignore no-explicit-any
  db: any;
  accountSid: string;
  authToken: string;
  now: () => Date;
  alert: (subject: string, paragraphs: string[]) => Promise<void>;
}

export interface RefreshOutcome {
  updated: string[];
  refused: Array<{ country: string; reason: string }>;
  failed: Array<{ country: string; reason: string }>;
  /** Prices accepted as a stable step change above 50% (3 same days). */
  stepChanges: string[];
}

type HistoryRow = {
  currency: string;
  minor_numerator: number;
  minor_denominator: number;
  recorded_at: string;
};

export async function refreshSmsPrices(
  deps: RefreshDeps,
): Promise<RefreshOutcome> {
  const outcome: RefreshOutcome = {
    updated: [],
    refused: [],
    failed: [],
    stepChanges: [],
  };
  const { data: existing, error: readError } = await deps.db
    .from(SMS_PRICE_TABLE)
    .select("country, currency, minor_numerator, minor_denominator");
  if (readError) throw new Error("sms_price_table_unreadable");
  const last = new Map<
    string,
    Pick<
      SmsCountryPriceRow,
      "currency" | "minor_numerator" | "minor_denominator"
    >
  >(
    ((existing ?? []) as SmsCountryPriceRow[]).map((row) => [row.country, row]),
  );
  const auth = `Basic ${btoa(`${deps.accountSid}:${deps.authToken}`)}`;
  for (const country of twilioPricedCountries()) {
    let parsed;
    try {
      const response = await deps.fetch(`${PRICING_URL}/${country}`, {
        headers: { Authorization: auth, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        outcome.failed.push({ country, reason: `http_${response.status}` });
        continue;
      }
      parsed = parseTwilioMessagingPrice(await response.json(), country);
    } catch (error) {
      outcome.failed.push({
        country,
        reason: error instanceof Error
          ? error.message.slice(0, 60)
          : "fetch_failed",
      });
      continue;
    }
    const nowIso = deps.now().toISOString();
    // #4273 tester retest 3 — the anchor reads this country's own latest 7
    // accepted prices, and the refused fetches since the last accepted one.
    const { data: acceptedRows, error: acceptedError } = await deps.db
      .from("sms_country_price_history")
      .select("currency, minor_numerator, minor_denominator, recorded_at")
      .eq("country", country)
      .eq("outcome", "accepted")
      .order("recorded_at", { ascending: false })
      .limit(SMS_PRICE_ANCHOR_WINDOW);
    if (acceptedError) {
      outcome.failed.push({ country, reason: "history_unreadable" });
      continue;
    }
    const accepted = (acceptedRows ?? []) as HistoryRow[];
    const lastAcceptedAt = accepted[0]?.recorded_at ?? "1970-01-01T00:00:00Z";
    const anchor = smsPriceAnchor(accepted);
    let rejection = smsPriceRejection(parsed, last.get(country) ?? null) ??
      (smsPriceRejection(parsed, anchor) === null
        ? null
        : "drifted_over_50_percent_from_7_price_median");
    let stableStep = false;
    if (rejection !== null && parsed.currency === "USD") {
      const { data: refusedRows, error: refusedError } = await deps.db
        .from("sms_country_price_history")
        .select("currency, minor_numerator, minor_denominator, recorded_at")
        .eq("country", country)
        .eq("outcome", "refused")
        .gt("recorded_at", lastAcceptedAt)
        .order("recorded_at", { ascending: false })
        .limit(SMS_PRICE_STABLE_DAYS * 4);
      if (
        !refusedError &&
        smsPriceStableStep(
          parsed,
          (refusedRows ?? []) as HistoryRow[],
          deps.now(),
        )
      ) {
        stableStep = true;
        rejection = null;
      }
    }
    if (rejection !== null) {
      outcome.refused.push({ country, reason: rejection });
      await deps.db.from("sms_country_price_history").insert({
        country,
        currency: parsed.currency,
        minor_numerator: parsed.numerator,
        minor_denominator: parsed.denominator,
        source: "twilio_pricing_api",
        outcome: "refused",
        recorded_at: nowIso,
      });
      continue;
    }
    const { error: writeError } = await deps.db.from("sms_country_prices")
      .upsert({
        country,
        provider: "twilio",
        currency: parsed.currency,
        minor_numerator: parsed.numerator,
        minor_denominator: parsed.denominator,
        source: "twilio_pricing_api",
        source_reference:
          `${PRICING_URL}/${country} current_price ${parsed.price} (highest outbound)`,
        fetched_at: nowIso,
      }, { onConflict: "country" });
    if (writeError) {
      outcome.failed.push({ country, reason: "write_failed" });
      continue;
    }
    const { error: historyWriteError } = await deps.db
      .from("sms_country_price_history")
      .insert({
        country,
        currency: parsed.currency,
        minor_numerator: parsed.numerator,
        minor_denominator: parsed.denominator,
        source: "twilio_pricing_api",
        outcome: "accepted",
        recorded_at: nowIso,
      });
    if (historyWriteError) {
      // The price is live; only the anchor missed a point. Say so.
      outcome.failed.push({ country, reason: "history_write_failed" });
    }
    if (stableStep) outcome.stepChanges.push(`${country} ${parsed.price}`);
    outcome.updated.push(country);
  }
  // #4273 tester retest 3 P3 — prune history older than 180 days, keeping
  // each country's latest 7 accepted prices whatever their age.
  const cutoff = new Date(
    deps.now().getTime() - SMS_PRICE_HISTORY_RETENTION_MS,
  ).toISOString();
  for (const country of twilioPricedCountries()) {
    const { data: keepRows, error: keepError } = await deps.db
      .from("sms_country_price_history")
      .select("id")
      .eq("country", country)
      .eq("outcome", "accepted")
      .order("recorded_at", { ascending: false })
      .limit(SMS_PRICE_ANCHOR_WINDOW);
    if (keepError) continue;
    const keep = ((keepRows ?? []) as Array<{ id: number }>).map((row) =>
      row.id
    );
    let prune = deps.db.from("sms_country_price_history").delete()
      .eq("country", country)
      .lt("recorded_at", cutoff);
    if (keep.length > 0) prune = prune.not("id", "in", `(${keep.join(",")})`);
    await prune;
  }
  if (outcome.stepChanges.length > 0) {
    await deps.alert(
      `[SMS] Accepted a price change above 50% for ${outcome.stepChanges.length} countr${
        outcome.stepChanges.length === 1 ? "y" : "ies"
      }`,
      [
        "Twilio returned the same new price on 3 consecutive days, so it is now the price quotes use:",
        outcome.stepChanges.join("; "),
      ],
    );
  }
  if (outcome.refused.length > 0 || outcome.failed.length > 0) {
    const lines = [
      ...outcome.refused.map((row) =>
        `${row.country}: refused (${row.reason})`
      ),
      ...outcome.failed.map((row) =>
        `${row.country}: not fetched (${row.reason})`
      ),
    ];
    await deps.alert(
      `[SMS] Price refresh kept the last good price for ${lines.length} countr${
        lines.length === 1 ? "y" : "ies"
      }`,
      [
        "Quotes keep using the last good price for these countries:",
        lines.join("; "),
        `Updated: ${outcome.updated.length}.`,
      ],
    );
  }
  return outcome;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token =
    (req.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ??
      "";
  if (!url || !serviceKey || !(await constantTimeEqual(token, serviceKey))) {
    return json(401, { error: "unauthorized" });
  }
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
  const recipients = (() => {
    const value = resolveAlertRecipientValue(
      "api_health",
      "API_HEALTH_ALERT_EMAILS",
    );
    return Array.isArray(value)
      ? value
      : (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  })();
  const alert = async (subject: string, paragraphs: string[]) => {
    await sendOpsAlertEmail({ subject, paragraphs, recipients });
  };
  if (!accountSid || !authToken) {
    await alert("[SMS] Price refresh can't reach Twilio", [
      "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is missing. Quotes keep the last good prices.",
    ]);
    return json(503, { error: "twilio_credentials_missing" });
  }
  const db = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  try {
    const outcome = await refreshSmsPrices({
      fetch,
      db,
      accountSid,
      authToken,
      now: () => new Date(),
      alert,
    });
    console.info(JSON.stringify({
      event: "sms_price_refresh",
      updated: outcome.updated.length,
      refused: outcome.refused.length,
      failed: outcome.failed.length,
    }));
    return json(200, {
      updated: outcome.updated.length,
      refused: outcome.refused,
      failed: outcome.failed,
    });
  } catch (error) {
    await alert("[SMS] Price refresh failed", [
      error instanceof Error ? error.message.slice(0, 80) : "unknown error",
      "Quotes keep the last good prices.",
    ]);
    return json(500, { error: "sms_price_refresh_failed" });
  }
}

if (import.meta.main) Deno.serve(handler);
