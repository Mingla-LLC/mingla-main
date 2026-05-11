// @ts-ignore -- Deno ESM import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const ticketCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...ticketCorsHeaders, "Content-Type": "application/json" },
  });
}

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("supabase_service_env_missing");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function qrTokenPepper(): string {
  const pepper = Deno.env.get("app.qr_token_pepper")?.trim() ?? "";
  if (
    pepper.length < 32 ||
    pepper === "local-ticket-pepper"
  ) {
    throw new Error("qr_token_pepper_missing");
  }
  return pepper;
}

export async function userIdFromAuthHeader(
  req: Request,
): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return null;
  const supabase = serviceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export function normalizePhoneE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (/^\+[1-9][0-9]{1,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function checkoutIdempotencyKey(input: {
  eventId: string;
  buyerEmail: string;
  buyerPhoneE164: string;
  lines: Array<{ ticketTypeId: string; quantity: number }>;
}): string {
  const lineKey = input.lines
    .map((line) => `${line.ticketTypeId}:${line.quantity}`)
    .sort()
    .join("|");
  return [
    "ticket_checkout",
    input.eventId,
    input.buyerEmail.trim().toLowerCase(),
    input.buyerPhoneE164,
    lineKey,
  ].join(":");
}

export function randomBuyerStatusToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function dispatchTicketConfirmation(orderId: string): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    await fetch(`${url}/functions/v1/ticket-confirmation-dispatch`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ orderId }),
    });
  } catch (err) {
    console.error("[ticket-checkout] confirmation dispatch failed", err);
  }
}
