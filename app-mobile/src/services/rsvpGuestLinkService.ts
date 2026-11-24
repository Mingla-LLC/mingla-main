/**
 * issue #4508 1.16-1.20 — the RSVP guest link calls (claim-link ops, wave A
 * CONTRACTS §2). The code identifies the guest for display only; claiming
 * needs an account that has proved the invited number.
 */
import { supabase } from "./supabase";
import {
  normalizeRsvpGuestCode,
  parseRsvpGuestClaim,
  parseRsvpGuestResolve,
  type RsvpGuestClaimResult,
  type RsvpGuestResolved,
} from "../utils/rsvpGuestClaim";

/** A non-2xx invoke error carries the Response in `context`. */
async function errorPayload(
  error: unknown,
): Promise<{ status: number | null; body: Record<string, unknown> }> {
  const response = (error as { context?: Response } | null)?.context;
  if (!response || typeof response.clone !== "function") {
    return { status: null, body: {} };
  }
  try {
    const payload: unknown = await response.clone().json();
    return {
      status: typeof response.status === "number" ? response.status : null,
      body:
        payload !== null && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {},
    };
  } catch {
    return { status: typeof response.status === "number" ? response.status : null, body: {} };
  }
}

/** Throws Error("unavailable" | "rate_limited") so the screen can offer a retry. */
export async function resolveRsvpGuestLink(rawCode: string): Promise<RsvpGuestResolved> {
  const code = normalizeRsvpGuestCode(rawCode);
  if (code === null) return parseRsvpGuestResolve({ status: "not_found" });
  const { data, error } = await supabase.functions.invoke("claim-link", {
    body: { op: "rsvp_guest_resolve", code },
  });
  if (error) {
    const { status } = await errorPayload(error);
    throw new Error(status === 429 ? "rate_limited" : "unavailable");
  }
  return parseRsvpGuestResolve(data);
}

/** "This isn't me". Resolves the outcome string; throws on network failure. */
export async function releaseRsvpGuestLink(rawCode: string): Promise<string> {
  const code = normalizeRsvpGuestCode(rawCode);
  if (code === null) return "not_found";
  const { data, error } = await supabase.functions.invoke("claim-link", {
    body: { op: "rsvp_guest_release", code },
  });
  if (error) {
    const { status, body } = await errorPayload(error);
    if (typeof body.outcome === "string") return body.outcome;
    throw new Error(status === 429 ? "rate_limited" : "unavailable");
  }
  const row = (data ?? {}) as Record<string, unknown>;
  return typeof row.outcome === "string" ? row.outcome : "not_found";
}

/** Claim for the signed-in account. Never throws: failures are outcomes. */
export async function claimRsvpGuestLink(
  rawCode: string,
  name: string | null,
): Promise<RsvpGuestClaimResult> {
  const code = normalizeRsvpGuestCode(rawCode);
  if (code === null) return parseRsvpGuestClaim({ outcome: "not_found" });
  const trimmed = name?.trim() ?? "";
  try {
    const { data, error } = await supabase.functions.invoke("claim-link", {
      body: {
        op: "rsvp_guest_claim",
        code,
        ...(trimmed.length > 0 ? { name: trimmed.slice(0, 120) } : {}),
      },
    });
    if (error) {
      const { status, body } = await errorPayload(error);
      return parseRsvpGuestClaim(body, status);
    }
    return parseRsvpGuestClaim(data);
  } catch {
    return parseRsvpGuestClaim({}, null);
  }
}
