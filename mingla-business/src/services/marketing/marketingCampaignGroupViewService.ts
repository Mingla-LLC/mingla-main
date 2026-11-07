/**
 * marketingCampaignGroupViewService — #4273 polish. Every method of one
 * campaign (email, SMS, push) for the campaign screen: status, the saved
 * message, the send snapshot, push counts, SMS segments and the confirmed cost.
 *
 * One RPC, `biz_marketing_campaign_group_view_v1`, gated to the author or a
 * brand member. It returns counts only: never a recipient, contact or user id
 * (MINGLA-INVARIANT: I-4273-SENT-VIEW-NO-CONTACTS).
 *
 * Loaded only by the campaign screen (a lazy route), never by the list.
 * Service-layer error contract (Constitution #3): throws on error.
 */

import { supabase } from "../supabase";
import type {
  CampaignChannelPayload,
  CampaignStatus,
} from "../../types/marketing";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GroupChannel = "email" | "sms" | "push";
export type PushReason = "follower" | "extended" | "book";

/** An event card as the send rendered it (server EmbeddedEvent shape). */
export interface SnapshotEmbeddedEvent {
  id: string;
  title: string;
  date_label: string | null;
  ends_at_label: string | null;
  location_label: string | null;
  cover_image_url: string | null;
  cover_media_type?: "image" | "video" | "gif" | null;
  url: string;
}

interface SnapshotCommon {
  v: 1;
  captured_at: string;
  brand: { name: string; slug: string | null };
}

export interface EmailSnapshotV1 extends SnapshotCommon {
  kind: "email";
  subject: string;
  body_html: string;
  from_display: string;
  from_address: string;
  reply_to_is_brand: boolean;
  header_image_url: string | null;
  follow_url: string | null;
  campaign_variables: {
    brand_name: string;
    event_date: string | null;
    event_date_short: string | null;
    ends_at: string | null;
    event_url: string | null;
    next_event_name: string | null;
    event_id: string | null;
  };
  per_guest_tokens: string[];
  embedded_events: SnapshotEmbeddedEvent[];
}

export interface SmsSnapshotV1 extends SnapshotCommon {
  kind: "sms";
  body_as_authored: string;
  wire_text: string;
  segments: number;
  encoding: "GSM-7" | "UCS-2" | "MMS";
  media_urls: string[];
  follow_included: boolean;
  links_shortened: boolean;
}

export interface PushSnapshotV1 extends SnapshotCommon {
  kind: "push";
  title: string | null;
  body_as_authored: string;
  deep_link: string | null;
  variants: Array<{ reason: PushReason; title: string; body: string }>;
}

export type SentSnapshotV1 = EmailSnapshotV1 | SmsSnapshotV1 | PushSnapshotV1;

export interface CampaignGroupMember {
  campaignId: string;
  channel: GroupChannel;
  status: CampaignStatus;
  name: string;
  isHead: boolean;
  createdAt: string;
  updatedAt: string;
  scheduledFor: string | null;
  sentAt: string | null;
  payload: CampaignChannelPayload;
  /** Parsed snapshot; null for anything not yet sent, legacy sends, or a shape this build does not know. */
  snapshot: SentSnapshotV1 | null;
  push: { queued: number; sent: number; failed: number; skipped: number } | null;
  sms: { segmentsSent: number; messagesAccepted: number; deferred: number } | null;
  cost: {
    costKind: "provider_estimate" | "not_metered";
    estimatedCostMinor: number | null;
    currency: string | null;
    smsSegmentCount: number;
    reachableCount: number;
    selectedCount: number;
  } | null;
}

export interface CampaignGroupView {
  groupId: string;
  focusCampaignId: string;
  brand: { name: string; slug: string | null; coverUrl: string | null };
  members: CampaignGroupMember[];
}

export class CampaignNotFoundError extends Error {
  constructor() {
    super("Campaign not found.");
    this.name = "CampaignNotFoundError";
  }
}

const isString = (value: unknown): value is string => typeof value === "string";
const isStringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A snapshot this build can render, or null. An unknown version or a malformed
 * shape falls back to the saved message; it never throws.
 */
export function parseSentSnapshot(raw: unknown): SentSnapshotV1 | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const brand = raw.brand;
  if (!isRecord(brand) || !isString(brand.name) || !isStringOrNull(brand.slug ?? null)) return null;
  if (!isString(raw.captured_at)) return null;
  if (raw.kind === "email") {
    const vars = raw.campaign_variables;
    if (
      !isString(raw.subject) || !isString(raw.body_html) || !isString(raw.from_display) ||
      !isString(raw.from_address) || !isRecord(vars) || !isString(vars.brand_name) ||
      !Array.isArray(raw.embedded_events) || !Array.isArray(raw.per_guest_tokens) ||
      !isStringOrNull(raw.header_image_url ?? null) || !isStringOrNull(raw.follow_url ?? null)
    ) return null;
    const events = raw.embedded_events.filter(
      (event): event is SnapshotEmbeddedEvent =>
        isRecord(event) && isString(event.id) && isString(event.title) && isString(event.url),
    );
    return { ...(raw as unknown as EmailSnapshotV1), embedded_events: events };
  }
  if (raw.kind === "sms") {
    if (
      !isString(raw.wire_text) || typeof raw.segments !== "number" ||
      !(raw.encoding === "GSM-7" || raw.encoding === "UCS-2" || raw.encoding === "MMS") ||
      !Array.isArray(raw.media_urls)
    ) return null;
    return {
      ...(raw as unknown as SmsSnapshotV1),
      media_urls: raw.media_urls.filter(isString),
    };
  }
  if (raw.kind === "push") {
    if (!Array.isArray(raw.variants) || !isString(raw.body_as_authored)) return null;
    const variants = raw.variants.filter(
      (variant): variant is PushSnapshotV1["variants"][number] =>
        isRecord(variant) && isString(variant.title) && isString(variant.body) &&
        (variant.reason === "follower" || variant.reason === "extended" || variant.reason === "book"),
    );
    if (variants.length === 0) return null;
    return { ...(raw as unknown as PushSnapshotV1), variants };
  }
  return null;
}

interface RawMember extends Omit<CampaignGroupMember, "snapshot"> {
  snapshot: unknown;
}

export async function getCampaignGroupView(
  campaignId: string,
): Promise<CampaignGroupView> {
  if (!UUID_RE.test(campaignId)) {
    throw new Error(`getCampaignGroupView: expected UUID, got ${JSON.stringify(campaignId)}`);
  }
  const { data, error } = await supabase.rpc("biz_marketing_campaign_group_view_v1", {
    p_campaign_id: campaignId,
  });
  if (error) {
    if ((error as { code?: string }).code === "P0002") throw new CampaignNotFoundError();
    throw error;
  }
  const raw = data as {
    groupId: string;
    focusCampaignId: string;
    brand: CampaignGroupView["brand"] | null;
    members: RawMember[] | null;
  } | null;
  if (raw === null) throw new CampaignNotFoundError();
  return {
    groupId: raw.groupId,
    focusCampaignId: raw.focusCampaignId,
    brand: raw.brand ?? { name: "Your brand", slug: null, coverUrl: null },
    members: (raw.members ?? []).map((member) => ({
      ...member,
      snapshot: parseSentSnapshot(member.snapshot),
    })),
  };
}
