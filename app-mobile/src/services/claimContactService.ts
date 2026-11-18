import { COUNTRIES } from "../constants/countries";
import { supabase } from "./supabase";
import {
  parseClaimedEntries,
  type ClaimedEntry,
} from "./attendanceClaimService";

export type ClaimIdentifier = {
  kind: "email" | "phone";
  value: string;
  source: "account" | "added";
  display: string;
};

export type ClaimContactChannel = "email" | "phone";

export class ClaimContactError extends Error {
  constructor(
    readonly code:
      | "invalid_value"
      | "already_other_account"
      | "limit_reached"
      | "rate_limited"
      | "bad_code"
      | "expired"
      | "locked"
      | "unavailable"
      // #4473 — the "Is this your ticket?" link rail (claim-link).
      | "no_contact"
      | "link_expired"
      | "unsupported_phone"
      | "send_failed",
  ) {
    super(code);
  }
}

export function displayClaimIdentifier(
  kind: "email" | "phone",
  value: string,
): string {
  if (kind === "email") return value;
  const normalized = value.replace(/[^+\d]/g, "");
  const country = [...COUNTRIES]
    .sort((a, b) => b.dialCode.length - a.dialCode.length)
    .find((candidate) => normalized.startsWith(candidate.dialCode));
  const last4 = normalized.replace(/\D/g, "").slice(-4);
  return `${country?.dialCode ?? "+"} •••• ${last4}`;
}

export async function fetchMyClaimIdentifiers(): Promise<ClaimIdentifier[]> {
  const { data, error } = await supabase.rpc("pg_my_claim_identifiers");
  if (error) throw error;
  return (Array.isArray(data) ? data : []).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    if (
      (row.kind !== "email" && row.kind !== "phone") ||
      typeof row.value !== "string" ||
      (row.source !== "account" && row.source !== "added")
    ) return [];
    return [{
      kind: row.kind,
      value: row.value,
      source: row.source,
      display: displayClaimIdentifier(row.kind, row.value),
    }];
  });
}

async function claimContactInvoke(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("claim-contact", { body });
  if (!error && typeof data === "object" && data !== null) {
    return data as Record<string, unknown>;
  }
  let code: ClaimContactError["code"] = "unavailable";
  const context = error?.context as Response | undefined;
  if (context && typeof context.json === "function") {
    try {
      const payload = await context.json() as { error?: unknown };
      if (
        payload.error === "invalid_value" || payload.error === "already_other_account" ||
        payload.error === "limit_reached" || payload.error === "rate_limited" ||
        payload.error === "bad_code" || payload.error === "expired" ||
        payload.error === "locked"
      ) code = payload.error;
    } catch {
      // The stable unavailable fallback is intentionally non-sensitive.
    }
  }
  throw new ClaimContactError(code);
}

export async function sendClaimContactCode(input: {
  channel: ClaimContactChannel;
  value: string;
}): Promise<{
  challengeId: string | null;
  sentTo: string | null;
  alreadyConfirmed: boolean;
}> {
  const payload = await claimContactInvoke({ op: "send", ...input });
  if (payload.ok !== true) throw new ClaimContactError("unavailable");
  return {
    challengeId: typeof payload.challengeId === "string" ? payload.challengeId : null,
    sentTo: typeof payload.sentTo === "string" ? payload.sentTo : null,
    alreadyConfirmed: payload.alreadyConfirmed === true,
  };
}

export async function verifyClaimContactCode(input: {
  challengeId: string;
  code: string;
}): Promise<{ foundCount: number; claimed: ClaimedEntry[] }> {
  const payload = await claimContactInvoke({ op: "verify", ...input });
  if (payload.ok !== true) throw new ClaimContactError("bad_code");
  const claimed = typeof payload.claimed === "object" && payload.claimed !== null
    ? payload.claimed as Record<string, unknown>
    : null;
  const claimedEntries = parseClaimedEntries(claimed?.claimed);
  return {
    foundCount: typeof claimed?.count === "number" ? claimed.count : claimedEntries.length,
    claimed: claimedEntries,
  };
}

function claimedSummary(payload: Record<string, unknown>): {
  foundCount: number;
  claimed: ClaimedEntry[];
} {
  const claimed = typeof payload.claimed === "object" && payload.claimed !== null
    ? payload.claimed as Record<string, unknown>
    : null;
  const entries = parseClaimedEntries(claimed?.claimed);
  return {
    foundCount: typeof claimed?.count === "number" ? claimed.count : entries.length,
    claimed: entries,
  };
}

async function claimLinkInvoke(
  body: Record<string, unknown>,
  phase: "send" | "verify",
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("claim-link", { body });
  let payload: Record<string, unknown> | null =
    !error && typeof data === "object" && data !== null
      ? data as Record<string, unknown>
      : null;
  if (error) {
    const context = error.context as Response | undefined;
    if (context && typeof context.json === "function") {
      try {
        const parsed = await context.json();
        payload = typeof parsed === "object" && parsed !== null
          ? parsed as Record<string, unknown>
          : null;
      } catch {
        payload = null;
      }
    }
  }
  if (payload?.ok === true && !error) return payload;
  const reason = payload?.error;
  let code: ClaimContactError["code"] = "unavailable";
  if (reason === "no_email" || reason === "no_phone") code = "no_contact";
  else if (reason === "expired") code = phase === "send" ? "link_expired" : "expired";
  else if (reason === "invalid") code = phase === "send" ? "invalid_value" : "bad_code";
  else if (
    reason === "rate_limited" || reason === "limit_reached" ||
    reason === "unsupported_phone" || reason === "send_failed" ||
    reason === "bad_code" || reason === "locked"
  ) code = reason;
  throw new ClaimContactError(code);
}

/**
 * #4473 "Is this your ticket?" — a signed-in account asks claim-link to send a
 * code to the email or number stored on the purchase behind a /c link. The
 * contact is looked up on the server and only ever comes back masked.
 */
export async function sendClaimLinkContactCode(input: {
  code: string;
  channel: ClaimContactChannel;
}): Promise<{
  challengeId: string | null;
  sentTo: string | null;
  alreadyConfirmed: boolean;
  foundCount: number;
  claimed: ClaimedEntry[];
}> {
  const payload = await claimLinkInvoke(
    { op: "contact_code_send", code: input.code.trim().toUpperCase(), channel: input.channel },
    "send",
  );
  const summary = claimedSummary(payload);
  return {
    challengeId: typeof payload.challengeId === "string" ? payload.challengeId : null,
    sentTo: typeof payload.sentTo === "string" ? payload.sentTo : null,
    alreadyConfirmed: payload.alreadyConfirmed === true,
    ...summary,
  };
}

export async function verifyClaimLinkContactCode(input: {
  challengeId: string;
  code: string;
}): Promise<{ foundCount: number; claimed: ClaimedEntry[] }> {
  const payload = await claimLinkInvoke(
    { op: "contact_code_verify", challengeId: input.challengeId, otp: input.code },
    "verify",
  );
  return claimedSummary(payload);
}
