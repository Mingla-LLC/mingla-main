/**
 * Issue #3645 — secure pay / approve links for Paystack trip instalments, and
 * the buyer + host notification senders the instalment owners share.
 *
 * A link token is 32 random bytes (base64url, 43 chars). Only its SHA-256 is
 * stored (issue_3645_issue_pay_link). The raw token exists in memory and in
 * the outgoing email / push only; it is never logged, stored or returned to a
 * caller other than the email and push senders.
 */
// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../businessWebOrigin.ts";
import { notifyBrandRoles } from "../businessNotifyTriggers.ts";

export type PayLinkPurpose = "pay" | "approve";

/** Buyer email via ticket-confirmation-dispatch (kinds routed there). */
export type DispatchBuyerEmail = (
  kind: string,
  payload: Record<string, unknown>,
) => Promise<boolean>;

/**
 * Buyer push (only for a signed-in buyer). Pay-link pushes deliberately skip
 * Mingla's durable notification row because that would persist the raw token.
 */
export type SendBuyerPush = (input: {
  userId: string;
  brandId: string | null;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  relatedId: string;
  idempotencyKey: string;
  deepLink?: string | null;
}) => Promise<boolean>;

/** Host push + in-app to the brand's owner and finance roles. */
export type NotifyHost = (input: {
  brandId: string;
  type: "business.installment_failed" | "business.installment_at_risk";
  title: string;
  body: string;
  data: Record<string, unknown>;
  relatedId: string;
  idempotencyKey: string;
  deepLink: string;
}) => Promise<void>;

export interface InstallmentNotifyDeps {
  dispatchBuyerEmail: DispatchBuyerEmail;
  sendBuyerPush: SendBuyerPush;
  notifyHost: NotifyHost;
  /** Test seam for the token bytes. */
  randomBytes?: (n: number) => Uint8Array;
}

function serviceEnv(): { url: string; key: string } | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && key ? { url, key } : null;
}

export const defaultDispatchBuyerEmail: DispatchBuyerEmail = async (
  kind,
  payload,
) => {
  const env = serviceEnv();
  if (env === null) return false;
  try {
    const res = await fetch(
      `${env.url}/functions/v1/ticket-confirmation-dispatch`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind, ...payload }),
      },
    );
    return res.ok;
  } catch (err) {
    console.error("[installment-notify] buyer email dispatch failed", {
      kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
};

export const defaultSendBuyerPush: SendBuyerPush = async (input) => {
  const env = serviceEnv();
  if (env === null) return false;
  try {
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(input.idempotencyKey),
      ),
    );
    const uuidBytes = digest.slice(0, 16);
    uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x50;
    uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;
    const hex = [...uuidBytes].map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const oneSignalIdempotencyKey = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
    const res = await fetch(`${env.url}/functions/v1/notify-dispatch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transientPayLinkPush: true,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data,
        deepLink: input.deepLink,
        oneSignalIdempotencyKey,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("[installment-notify] buyer push failed", {
      type: input.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
};

export function defaultNotifyHost(supabase: SupabaseClient): NotifyHost {
  return async (input) => {
    try {
      await notifyBrandRoles(supabase as never, {
        brandId: input.brandId,
        roles: ["brand_owner", "finance_manager"],
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data,
        relatedId: input.relatedId,
        relatedType: "order_installment",
        idempotencyKey: input.idempotencyKey,
        deepLink: input.deepLink,
      });
    } catch (err) {
      console.error("[installment-notify] host notify failed", {
        type: input.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

export function defaultInstallmentNotifyDeps(
  supabase: SupabaseClient,
): InstallmentNotifyDeps {
  return {
    dispatchBuyerEmail: defaultDispatchBuyerEmail,
    sendBuyerPush: defaultSendBuyerPush,
    notifyHost: defaultNotifyHost(supabase),
  };
}

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** SHA-256 of a link token, as the PostgREST bytea literal the RPCs take. */
export async function payLinkTokenHashHex(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  return "\\x" +
    [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function mintPayLinkToken(
  randomBytes?: (n: number) => Uint8Array,
): string {
  const bytes = randomBytes
    ? randomBytes(32)
    : crypto.getRandomValues(new Uint8Array(32));
  if (bytes.length !== 32) throw new Error("pay_link_token_entropy");
  return base64Url(bytes);
}

export const PAY_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function payLinkUrl(token: string): string {
  return `${PRODUCTION_BUSINESS_WEB_ORIGIN}/pay/${token}`;
}

export type SendPayLinkResult =
  /** url carries the raw token: hand it only to an email / push, never log it. */
  | {
    ok: true;
    linkId: string;
    emailSent: boolean;
    pushSent: boolean;
    url: string;
  }
  | { ok: false; reason: string };

/**
 * Mint a fresh link (replacing any live one), then email it and push it to a
 * signed-in buyer. Returns ok:false with the RPC's reason when the instalment
 * is not open (paid, cancelled, unbound) — callers treat that as a skip.
 */
export async function sendInstallmentPayLink(
  supabase: SupabaseClient,
  input: {
    installmentId: string;
    purpose: PayLinkPurpose;
    deps?: Partial<InstallmentNotifyDeps>;
    /** false: mint only (the caller sends it inside another email, e.g. dunning). */
    notify?: boolean;
  },
): Promise<SendPayLinkResult> {
  const deps = {
    ...defaultInstallmentNotifyDeps(supabase),
    ...(input.deps ?? {}),
  };
  const token = mintPayLinkToken(deps.randomBytes);
  const tokenHash = await payLinkTokenHashHex(token);

  const { data: issued, error: issueError } = await supabase.rpc(
    "issue_3645_issue_pay_link",
    {
      p_installment_id: input.installmentId,
      p_purpose: input.purpose,
      p_token_hash: tokenHash,
    },
  );
  if (issueError !== null) {
    throw new Error(`issue_3645_issue_pay_link failed: ${issueError.message}`);
  }
  const result = (issued ?? {}) as {
    ok?: boolean;
    reason?: string;
    link_id?: string;
  };
  if (result.ok !== true || typeof result.link_id !== "string") {
    return { ok: false, reason: String(result.reason ?? "pay_link_refused") };
  }

  const { data: row, error: rowError } = await supabase
    .from("order_installments")
    .select(
      "id, order_id, ordinal, buyer_total_cents, amount_cents, currency, due_at, orders!inner(id, buyer_user_id, event_id, events!inner(brand_id, title))",
    )
    .eq("id", input.installmentId)
    .maybeSingle();
  if (rowError !== null || row === null) {
    throw new Error(
      `pay link installment load failed: ${rowError?.message ?? "missing"}`,
    );
  }
  const r = row as Record<string, unknown>;
  const order = (Array.isArray(r.orders) ? r.orders[0] : r.orders) as Record<
    string,
    unknown
  >;
  const event =
    (Array.isArray(order.events) ? order.events[0] : order.events) as Record<
      string,
      unknown
    >;
  const url = payLinkUrl(token);
  if (input.notify === false) {
    return {
      ok: true,
      linkId: result.link_id,
      emailSent: false,
      pushSent: false,
      url,
    };
  }
  const amountCents = Number(r.buyer_total_cents ?? r.amount_cents);

  const emailSent = await deps.dispatchBuyerEmail("installment_pay_link", {
    orderId: String(r.order_id),
    installmentId: input.installmentId,
    linkId: result.link_id,
    purpose: input.purpose,
    payUrl: url,
  });

  let pushSent = false;
  const buyerUserId = typeof order.buyer_user_id === "string"
    ? order.buyer_user_id
    : null;
  if (buyerUserId !== null) {
    const approve = input.purpose === "approve";
    pushSent = await deps.sendBuyerPush({
      userId: buyerUserId,
      brandId: typeof event.brand_id === "string" ? event.brand_id : null,
      type: approve ? "installment_approval_required" : "installment_pay_link",
      title: approve ? "Approve your payment" : "Your next payment is due",
      body: approve
        ? `Your bank needs you to approve your payment for ${
          String(event.title)
        }.`
        : `Your payment for ${
          String(event.title)
        } is due soon. Tap to pay securely.`,
      data: {
        orderId: String(r.order_id),
        installmentId: input.installmentId,
        amountCents,
        url,
      },
      relatedId: input.installmentId,
      idempotencyKey:
        `installment_pay_link:${input.installmentId}:${result.link_id}`,
      deepLink: url,
    });
  }
  return { ok: true, linkId: result.link_id, emailSent, pushSent, url };
}
