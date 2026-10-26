import { supabase } from "./supabase";

export type ClaimLinkHandoffResult =
  | { ok: true; handoffUrl: string; expiresAt: string }
  | {
      ok: false;
      reason: "invalid" | "rate_limited" | "network";
      retryAfterSeconds: number | null;
    };

const CODE_PATTERN = /^[0-9A-Za-z]{10}$/;

async function errorPayload(error: unknown): Promise<{
  error?: unknown;
  retryAfterSeconds?: unknown;
}> {
  const response = (error as { context?: Response } | null)?.context;
  if (!response) return {};
  return (await response
    .clone()
    .json()
    .catch(() => ({}))) as {
    error?: unknown;
    retryAfterSeconds?: unknown;
  };
}

function failure(
  code: unknown,
  retryAfterSeconds: unknown,
): Exclude<ClaimLinkHandoffResult, { ok: true }> {
  const reason =
    code === "rate_limited"
      ? "rate_limited"
      : code === "invalid"
        ? "invalid"
        : "network";
  return {
    ok: false,
    reason,
    retryAfterSeconds:
      typeof retryAfterSeconds === "number" ? retryAfterSeconds : null,
  };
}

/**
 * Mints a short-lived desktop-to-phone URL from a public claim code.
 * The claim code is sent once to the edge and is never logged or persisted here.
 */
export async function mintClaimLinkHandoff(
  rawCode: string,
): Promise<ClaimLinkHandoffResult> {
  const code = rawCode.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) return failure("invalid", null);

  try {
    const { data, error } = await supabase.functions.invoke("claim-link", {
      body: { op: "handoff", code },
    });
    if (error) {
      const payload = await errorPayload(error);
      return failure(payload.error, payload.retryAfterSeconds);
    }

    const payload = (data ?? {}) as {
      ok?: unknown;
      handoffUrl?: unknown;
      expiresAt?: unknown;
      error?: unknown;
      retryAfterSeconds?: unknown;
    };
    if (
      payload.ok === true &&
      typeof payload.handoffUrl === "string" &&
      payload.handoffUrl.startsWith("https://") &&
      typeof payload.expiresAt === "string" &&
      Number.isFinite(Date.parse(payload.expiresAt))
    ) {
      return {
        ok: true,
        handoffUrl: payload.handoffUrl,
        expiresAt: payload.expiresAt,
      };
    }
    return failure(payload.error ?? "invalid", payload.retryAfterSeconds);
  } catch {
    return failure("network", null);
  }
}
