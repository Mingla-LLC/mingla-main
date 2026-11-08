// #3682 wave 2 (B) — the push lane of a Blast campaign.
//
// Reuses the shared notify pipeline (dispatchV2 → OneSignal adapter, same
// secrets, same notification ledger); no new provider. Push is free: the quote
// is `not_metered` with no cost and no currency. Recipients are Mingla user
// ids that never leave the server: the public quote carries counts only.
// Types only at module scope: notifyV2 pulls the email adapter, whose sender
// identities read the environment when they load. marketing-send's suites
// import index.ts without env access, so the dispatcher is loaded on first
// send instead (the same pattern as _shared/googleConversionUpload.ts).
import type {
  DispatchV2Input,
  DispatchV2Result,
  MinimalClient,
} from "../_shared/notifyV2.ts";
import {
  BRAND_CAMPAIGN_PUSH_CATEGORY,
  renderBrandReachMessage,
} from "../_shared/brandReachMessages.ts";
import { buildPushSnapshot, writeSentSnapshot } from "./sentSnapshot.ts";

export const PUSH_QUOTE_TTL_MS = 5 * 60 * 1000;

export interface PushCandidate {
  recipientUserId: string;
  reason: "follower" | "extended" | "book";
  allowed: boolean;
  safeReasonCode: string;
  /** #4273 — the one person this account is across groups. Service-only. */
  personKey?: string;
}

export interface PushCandidatesEnvelope {
  brandId: string;
  channel: "push";
  selectedCount: number;
  content: Record<string, unknown>;
  candidates: PushCandidate[];
  audienceId: string;
  audienceKind: string;
  audienceVersion: number;
  audienceName: string;
  campaignGroupId: string;
  /** #4273 — each picked group's name and totals. */
  audienceSources?: Array<{
    key: string;
    name: string;
    count: number;
    alsoInBookCount: number;
  }>;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Canonical JSON (sorted keys) so the hash never depends on key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${
      entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
        .join(",")
    }}`;
  }
  return JSON.stringify(value);
}

/**
 * The sealed push quote. The hash covers the campaign, audience, content and
 * every recipient decision, so any drift between preview and confirm is a
 * stale preview, never a silent re-target.
 */
export async function buildPushQuote(
  campaignId: string,
  envelope: PushCandidatesEnvelope,
  quotedAt: Date,
) {
  const reachable = envelope.candidates.filter((row) => row.allowed).length;
  const contentHash = await sha256Hex(canonical(envelope.content));
  const quoteHash = await sha256Hex(canonical({
    version: 1,
    campaignId,
    audienceId: envelope.audienceId,
    audienceKind: envelope.audienceKind,
    audienceVersion: envelope.audienceVersion,
    contentHash,
    candidates: envelope.candidates,
  }));
  return {
    quoteVersion: 1 as const,
    quoteHash,
    contentHash,
    quotedAt: quotedAt.toISOString(),
    expiresAt: new Date(quotedAt.getTime() + PUSH_QUOTE_TTL_MS).toISOString(),
    brandId: envelope.brandId,
    channel: "push" as const,
    selectedCount: envelope.selectedCount,
    reachableCount: reachable,
    suppressedCount: envelope.selectedCount - reachable,
    unavailableCount: 0,
    smsSegments: 0,
    costKind: "not_metered" as const,
    estimatedCostMinor: null,
    currency: null,
    content: envelope.content,
    audienceId: envelope.audienceId,
    audienceKind: envelope.audienceKind,
    audienceVersion: envelope.audienceVersion,
    ...(envelope.audienceSources === undefined
      ? {}
      : { audienceSources: envelope.audienceSources }),
    candidates: envelope.candidates,
  };
}

/** Counts only — never a recipient id. */
export function publicPushQuote(
  quote: Awaited<ReturnType<typeof buildPushQuote>>,
): Record<string, unknown> {
  const {
    candidates: _candidates,
    brandId: _brandId,
    content: _content,
    contentHash: _contentHash,
    ...safe
  } = quote;
  return safe;
}

export function parsePushQuotedAt(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const age = Date.now() - parsed.getTime();
  return age >= -60_000 && age <= PUSH_QUOTE_TTL_MS ? parsed : null;
}

export type PushDispatch = (
  client: MinimalClient,
  input: DispatchV2Input,
) => Promise<DispatchV2Result>;

interface PushWorklist {
  brandName: string | null;
  brandSlug: string | null;
  eventSlug: string | null;
  body: string | null;
  /** #4273 — the push title (the email subject); absent keeps the brand name. */
  title?: string | null;
  work: Array<{
    messageId: string;
    userId: string;
    reason: "follower" | "extended" | "book";
  }>;
}

function publicOrigin(): string {
  return (Deno.env.get("BUSINESS_WEB_ORIGIN") ??
    Deno.env.get("MINGLA_PUBLIC_APP_ORIGIN") ?? "https://mingla.app")
    .replace(/\/+$/, "");
}

export function campaignPushLink(
  brandSlug: string | null,
  eventSlug: string | null,
  origin = publicOrigin(),
): string | null {
  const slug = /^[a-z0-9][a-z0-9-]{0,119}$/i;
  if (!brandSlug || !slug.test(brandSlug)) return null;
  return eventSlug && slug.test(eventSlug)
    ? `${origin}/e/${encodeURIComponent(brandSlug)}/${
      encodeURIComponent(eventSlug)
    }`
    : `${origin}/b/${encodeURIComponent(brandSlug)}`;
}

/**
 * #4273 — the payload one guest's campaign push is rendered from. One owner,
 * so the send snapshot's variants are exactly what each reason received.
 */
export function campaignPushPayload(
  list: Pick<PushWorklist, "brandName" | "brandSlug" | "eventSlug" | "title">,
  body: string,
  reason: "follower" | "extended" | "book",
  campaignId: string,
): Record<string, unknown> {
  return {
    brand_name: list.brandName ?? "Mingla",
    body,
    ...(typeof list.title === "string" && list.title.trim().length > 0
      ? { title: list.title.trim() }
      : {}),
    reason,
    brand_slug: list.brandSlug,
    event_slug: list.eventSlug,
    campaign_id: campaignId,
  };
}

/**
 * Send a confirmed push campaign. The worklist RPC re-decides every recipient
 * (unfollow, mute, push switch, exits) before anything is handed to the
 * provider; each row is then marked sent / failed / skipped exactly once.
 */
export async function sendPushCampaign(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaign: { id: string; brand_id: string },
  dispatchOverride?: PushDispatch,
): Promise<
  {
    delivered: number;
    deferred: number;
    failed: number;
    preview_skipped: number;
  }
> {
  const dispatch: PushDispatch = dispatchOverride ??
    (await import("../_shared/notifyV2.ts")).dispatchV2;
  const { data, error } = await supabase.rpc(
    "biz_marketing_push_send_worklist_v1",
    { p_campaign_id: campaign.id },
  );
  if (error) throw new Error(`push_worklist:${error.message ?? "failed"}`);
  const list = data as PushWorklist;
  const body = (list.body ?? "").trim();
  if (body.length === 0) throw new Error("push_body_empty");
  const link = campaignPushLink(list.brandSlug, list.eventSlug);
  // #4273 — the send snapshot: write-once, best-effort, never blocks a send.
  // After the empty-body guard, before the first push. One rendered push per
  // reason, from the payload each guest's push is built from; no user id.
  // A resume pass with nothing left to send skips it (the first pass wrote it).
  const reasons = Array.from(new Set((list.work ?? []).map((item) => item.reason)));
  if (reasons.length > 0) {
    await writeSentSnapshot(
      supabase,
      campaign.id,
      buildPushSnapshot({
        brandName: list.brandName ?? "Mingla",
        brandSlug: list.brandSlug,
        title: typeof list.title === "string" && list.title.trim().length > 0
          ? list.title.trim()
          : null,
        bodyAsAuthored: body,
        deepLink: link,
        variants: reasons.map((reason) => ({
          reason,
          ...renderBrandReachMessage(
            BRAND_CAMPAIGN_PUSH_CATEGORY,
            campaignPushPayload(list, body, reason, campaign.id),
          ).push,
        })),
      }),
    );
  }
  let delivered = 0;
  let failed = 0;
  for (const item of list.work ?? []) {
    let status: "sent" | "failed" | "skipped" = "failed";
    let reason: string | null = "provider_failed";
    let notificationId: string | null = null;
    try {
      const result = await dispatch(supabase as MinimalClient, {
        user_id: item.userId,
        category_key: BRAND_CAMPAIGN_PUSH_CATEGORY,
        payload: campaignPushPayload(list, body, item.reason, campaign.id),
        deep_link: link,
        idempotency_key: `campaign-push:${campaign.id}:${item.userId}`,
        requested_channel: "push",
      });
      notificationId = result.notificationId ?? null;
      const push = result.deliveries?.find((row) => row.channel === "push");
      if (
        result.success && push && ["sent", "delivered"].includes(push.status)
      ) {
        status = "sent";
        reason = null;
      } else if (
        result.success && push &&
        ["suppressed", "skipped"].includes(push.status)
      ) {
        status = "skipped";
        reason = push.status === "suppressed" ? "can_send_denied" : "no_device";
      }
    } catch {
      status = "failed";
      reason = "provider_failed";
    }
    const { error: updateError } = await supabase
      .from("marketing_push_messages")
      .update({
        status,
        failure_reason: reason,
        notification_id: notificationId,
        sent_at: status === "sent" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.messageId)
      .eq("status", "queued");
    if (updateError) throw new Error("push_message_update_failed");
    if (status === "sent") delivered += 1;
    else if (status === "failed") failed += 1;
  }
  return { delivered, deferred: 0, failed, preview_skipped: 0 };
}
