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
      | "unavailable",
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
