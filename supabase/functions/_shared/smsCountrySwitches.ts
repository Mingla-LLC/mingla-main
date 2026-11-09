// #4273 — which countries Mingla may send MARKETING texts to, and through
// which sender. Read from the database, never from env.
//
// Each country's switch and sender live in public.sms_country_switches, and
// the "Mingla Marketing" Messaging Service SID in
// public.sms_marketing_sender_config (migration 20280523004273). The owner and
// admins change them on Mingla Admin's "SMS countries" page; every change is
// audited. The edge reads ONE snapshot per request or send pass
// (public.sms_marketing_switches_v1) and decides every marketing route with
// ONE rule, smsMarketingRouteFromSwitches below.
//
// FAIL CLOSED. An unreadable snapshot is null, and null texts no one: the
// quote reads "SMS pricing unavailable" and the send texts nobody. There is no
// env fallback, so Admin and the edge can never disagree.
//
// US and NG also keep their bundle switch (sms_live_enabled.us / .ng) as a
// MASTER KILL: those two switches still stop transactional texts too, so the
// one emergency switch stops marketing as well. It is an AND, not a fallback.
//
// Transactional SMS (verification, tickets, RSVP) never reads this module.
//
// Invariant I-4273-MARKETING-ROUTE-ONE-RULE is declared beside its proof,
// supabase/functions/_shared/__tests__/issue_4273_sms_country_switches.implementor.test.ts.
//
// No env is read at import time: the master switches are read only when
// loadSmsCountrySwitches runs.

import { MAPPED_COUNTRIES } from "./e164Country.ts";
import { resolveDeliveryFlagValue } from "./secretBundle.ts";
import { smsCountryProfile } from "./smsCountries.ts";

export type SmsSwitchSender =
  | "toll_free"
  | "marketing_service"
  | "termii"
  | "needs_local_number";

export interface SmsCountrySwitch {
  marketingEnabled: boolean;
  sender: SmsSwitchSender;
  registrationRequired: boolean;
  registrationDone: boolean;
}

export interface SmsCountrySwitchesSnapshot {
  /** The marketing Messaging Service SID, or null when unset or invalid. */
  marketingServiceSid: string | null;
  countries: ReadonlyMap<string, SmsCountrySwitch>;
  /** The US / NG bundle master switches (AND with the DB switch). */
  masterOn: { US: boolean; NG: boolean };
}

export type SmsMarketingRoute = "toll_free" | "marketing" | "termii";

const SID_RE = /^MG[0-9a-f]{32}$/;
/** The transactional "Mingla Verification" service: never a marketing sender. */
const TRANSACTIONAL_SERVICE_SID = "MG1942fbb549187fcf77c0e860405abf58";
const SENDERS: ReadonlySet<string> = new Set([
  "toll_free",
  "marketing_service",
  "termii",
  "needs_local_number",
]);

/**
 * Strict parse of the sms_marketing_switches_v1() payload. A malformed row is
 * dropped (that country reads as not textable); a non-object or a missing
 * countries array is null (nothing textable).
 */
export function parseSmsCountrySwitches(
  raw: unknown,
  master: { US: boolean; NG: boolean },
): SmsCountrySwitchesSnapshot | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.countries)) return null;
  const sid = record.marketingServiceSid;
  const marketingServiceSid = typeof sid === "string" && SID_RE.test(sid) &&
      sid !== TRANSACTIONAL_SERVICE_SID
    ? sid
    : null;
  const countries = new Map<string, SmsCountrySwitch>();
  for (const entry of record.countries) {
    if (entry === null || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (
      typeof row.country !== "string" ||
      !MAPPED_COUNTRIES.includes(row.country) ||
      countries.has(row.country) ||
      typeof row.marketingEnabled !== "boolean" ||
      typeof row.sender !== "string" || !SENDERS.has(row.sender) ||
      typeof row.registrationRequired !== "boolean" ||
      typeof row.registrationDone !== "boolean"
    ) continue;
    countries.set(row.country, {
      marketingEnabled: row.marketingEnabled,
      sender: row.sender as SmsSwitchSender,
      registrationRequired: row.registrationRequired,
      registrationDone: row.registrationDone,
    });
  }
  return {
    marketingServiceSid,
    countries,
    masterOn: { US: master.US === true, NG: master.NG === true },
  };
}

function flagOn(value: boolean | string | undefined): boolean {
  return value === true || value === "true" || value === "1";
}

/** The US / NG bundle master switches, read at call time (never at import). */
export function defaultSmsMasterSwitches(): { US: boolean; NG: boolean } {
  return {
    US: flagOn(
      resolveDeliveryFlagValue("sms_live_enabled.us", "SMS_LIVE_ENABLED_US"),
    ),
    NG: flagOn(
      resolveDeliveryFlagValue("sms_live_enabled.ng", "SMS_LIVE_ENABLED_NG"),
    ),
  };
}

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * One snapshot of the switches and the marketing sender. Null when the read
 * fails for any reason: callers treat null exactly like unreadable SMS prices.
 */
export async function loadSmsCountrySwitches(
  db: Db,
  getMaster: () => { US: boolean; NG: boolean } = defaultSmsMasterSwitches,
): Promise<SmsCountrySwitchesSnapshot | null> {
  try {
    const { data, error } = await db.rpc("sms_marketing_switches_v1");
    if (error) throw new Error("rpc_error");
    const parsed = parseSmsCountrySwitches(data, getMaster());
    if (parsed === null) throw new Error("malformed");
    return parsed;
  } catch (error) {
    console.error(JSON.stringify({
      event: "sms_country_switches_unreadable",
      reason: error instanceof Error ? error.message : "unknown",
    }));
    return null;
  }
}

/**
 * #4273 — THE one marketing route rule (I-4273-MARKETING-ROUTE-ONE-RULE).
 * "toll_free" (the transactional toll-free service, US/CA), "marketing" (the
 * DB marketing service, alphanumeric sender), "termii" (NG), or null = not
 * textable ("can't text their country yet"). Null whenever the snapshot is
 * unreadable, the country is unknown or switched off, its registration is
 * unfinished, its US/NG master switch is off, or the DB sender disagrees with
 * the country's sender class in smsCountries.ts.
 */
export function smsMarketingRouteFromSwitches(
  country: string | null | undefined,
  snap: SmsCountrySwitchesSnapshot | null,
): SmsMarketingRoute | null {
  if (snap === null || typeof country !== "string") return null;
  const cc = country.toUpperCase();
  const profile = smsCountryProfile(cc);
  if (profile === null) return null;
  const row = snap.countries.get(cc);
  if (row === undefined || !row.marketingEnabled) return null;
  if (row.registrationRequired && !row.registrationDone) return null;
  if (cc === "US" && !snap.masterOn.US) return null;
  if (cc === "NG" && !snap.masterOn.NG) return null;
  switch (profile.sender) {
    case "toll_free":
      return row.sender === "toll_free" ? "toll_free" : null;
    case "termii":
      return row.sender === "termii" ? "termii" : null;
    case "alphanumeric":
    case "needs_number":
      return row.sender === "marketing_service" &&
          snap.marketingServiceSid !== null
        ? "marketing"
        : null;
  }
}

/** Can this country be texted for marketing under this snapshot? */
export function smsCountryTextableFrom(
  snap: SmsCountrySwitchesSnapshot | null,
): (country: string) => boolean {
  return (country: string) =>
    smsMarketingRouteFromSwitches(country, snap) !== null;
}

/** The marketing Messaging Service SID iff this country routes through it. */
export function marketingServiceSidFor(
  country: string | null | undefined,
  snap: SmsCountrySwitchesSnapshot | null,
): string | null {
  return smsMarketingRouteFromSwitches(country, snap) === "marketing"
    ? snap?.marketingServiceSid ?? null
    : null;
}
