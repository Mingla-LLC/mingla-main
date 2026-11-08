// #4273 polish — the send snapshot: what each method of a campaign sent,
// written once before the first recipient so the campaign screen can show it.
//
// Invariants: I-4273-SNAPSHOT-WRITTEN-BEFORE-DELIVERY and
// I-4273-SNAPSHOT-NO-RECIPIENT-DATA (declared in
// issue_4273_sent_snapshot.implementor.test.ts); I-4273-SENT-SNAPSHOT-WRITE-ONCE
// (the database guard, declared in the pg17 sent-snapshot suite).

import { computeSegments } from "../_shared/adapters/smsAdapter.ts";
import type { EmbeddedEvent } from "../_shared/marketingEmailRender.ts";

/** Same shape as generateTrackingId() (a v4 UUID), so segment counts match. */
export const SAMPLE_TRACKING_ID = "00000000-0000-4000-8000-000000000001";

/** Per-guest variables: never stored with a value, shown as [labels]. */
export const PER_GUEST_TOKENS = [
  "first_name",
  "event_name",
  "previous_event_name",
] as const;

export interface CampaignVariablesV1 {
  brand_name: string;
  event_date: string | null;
  event_date_short: string | null;
  ends_at: string | null;
  event_url: string | null;
  next_event_name: string | null;
  event_id: string | null;
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
  campaign_variables: CampaignVariablesV1;
  per_guest_tokens: string[];
  embedded_events: EmbeddedEvent[];
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
  variants: Array<{
    reason: "follower" | "extended" | "book";
    title: string;
    body: string;
  }>;
}

export type SentSnapshotV1 = EmailSnapshotV1 | SmsSnapshotV1 | PushSnapshotV1;

function common(
  brandName: string,
  brandSlug: string | null,
  now: Date,
): SnapshotCommon {
  return {
    v: 1,
    captured_at: now.toISOString(),
    brand: { name: brandName, slug: brandSlug },
  };
}

export function buildEmailSnapshot(args: {
  brandName: string;
  brandSlug: string | null;
  subject: string;
  bodyHtml: string;
  fromDisplay: string;
  fromAddress: string;
  replyToIsBrand: boolean;
  headerImageUrl: string | null;
  followUrl: string | null;
  campaignVariables: CampaignVariablesV1;
  embedded: EmbeddedEvent[];
  now?: Date;
}): EmailSnapshotV1 {
  return {
    ...common(args.brandName, args.brandSlug, args.now ?? new Date()),
    kind: "email",
    subject: args.subject,
    body_html: args.bodyHtml,
    from_display: args.fromDisplay,
    from_address: args.fromAddress,
    reply_to_is_brand: args.replyToIsBrand,
    header_image_url: args.headerImageUrl,
    follow_url: args.followUrl,
    campaign_variables: {
      brand_name: args.campaignVariables.brand_name,
      event_date: args.campaignVariables.event_date,
      event_date_short: args.campaignVariables.event_date_short,
      ends_at: args.campaignVariables.ends_at,
      event_url: args.campaignVariables.event_url,
      next_event_name: args.campaignVariables.next_event_name,
      event_id: args.campaignVariables.event_id,
    },
    per_guest_tokens: [...PER_GUEST_TOKENS],
    embedded_events: args.embedded.map((event) => ({ ...event })),
  };
}

/**
 * The encoding the provider uses for this text. Derived from the send's own
 * computeSegments, so there is still one GSM-7 table: a character is GSM-7
 * when 71 of it fit one segment (basic 71 septets, extended 142, both under
 * 160), and UCS-2 when they do not (71 units over 70).
 */
export function smsEncoding(
  wire: string,
  hasMedia: boolean,
): "GSM-7" | "UCS-2" | "MMS" {
  if (hasMedia) return "MMS";
  for (const ch of new Set(wire)) {
    if (computeSegments(ch.repeat(71)) !== 1) return "UCS-2";
  }
  return "GSM-7";
}

export function buildSmsSnapshot(args: {
  brandName: string;
  brandSlug: string | null;
  bodyAsAuthored: string;
  /** composeSmsBody(segmentBody, true) with SAMPLE_TRACKING_ID links. */
  wireText: string;
  mediaUrls: string[];
  followIncluded: boolean;
  linksShortened: boolean;
  now?: Date;
}): SmsSnapshotV1 {
  return {
    ...common(args.brandName, args.brandSlug, args.now ?? new Date()),
    kind: "sms",
    body_as_authored: args.bodyAsAuthored,
    wire_text: args.wireText,
    segments: computeSegments(args.wireText),
    encoding: smsEncoding(args.wireText, args.mediaUrls.length > 0),
    media_urls: [...args.mediaUrls],
    follow_included: args.followIncluded,
    links_shortened: args.linksShortened,
  };
}

export function buildPushSnapshot(args: {
  brandName: string;
  brandSlug: string | null;
  title: string | null;
  bodyAsAuthored: string;
  deepLink: string | null;
  variants: PushSnapshotV1["variants"];
  now?: Date;
}): PushSnapshotV1 {
  return {
    ...common(args.brandName, args.brandSlug, args.now ?? new Date()),
    kind: "push",
    title: args.title,
    body_as_authored: args.bodyAsAuthored,
    deep_link: args.deepLink,
    variants: args.variants.map((variant) => ({ ...variant })),
  };
}

/**
 * Write-once, best-effort, never blocks a send. The WHERE sent_snapshot IS NULL
 * makes a resume pass a no-op; the database trigger refuses a second write.
 */
export async function writeSentSnapshot(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  campaignId: string,
  snapshot: SentSnapshotV1,
): Promise<void> {
  try {
    const { error } = await supabase
      .from("marketing_campaigns")
      .update({ sent_snapshot: snapshot })
      .eq("id", campaignId)
      .is("sent_snapshot", null);
    if (error) {
      console.error(
        `[#4273] sent_snapshot_write_failed campaign=${campaignId}: ${
          error.message ?? "unknown"
        }`,
      );
    }
  } catch (error) {
    console.error(
      `[#4273] sent_snapshot_write_failed campaign=${campaignId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
