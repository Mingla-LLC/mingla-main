/**
 * #4273 polish — what the campaign screen shows for each method of a blast,
 * and how the campaign list folds a blast's methods into one card.
 * Pure functions only; the screen renders what these return.
 *
 * Preview source, per method:
 *   - "snapshot": the send snapshot, exactly as sent.
 *   - "payload_live": a sent or failed method with no snapshot (sent before
 *     #4273, or the best-effort write failed): rebuilt from the saved message
 *     and today's brand, and labelled so (Seth, 2026-11-07, Q2).
 *   - "draft": nothing sent yet (draft, scheduled, cancelled): the saved
 *     message with today's brand.
 * Per-guest words never show a real guest's value: they read as [labels].
 */

import type { CampaignStatus } from "../../types/marketing";
import type {
  CampaignGroupMember,
  CampaignGroupView,
  EmailSnapshotV1,
  PushReason,
  SmsSnapshotV1,
} from "../../services/marketing/marketingCampaignGroupViewService";

export type MethodChannel = "email" | "sms" | "push";
const METHOD_ORDER: readonly MethodChannel[] = ["email", "sms", "push"];

export const METHOD_LABEL: Record<MethodChannel, string> = {
  email: "Email",
  sms: "SMS",
  push: "Push",
};

/** The status word on a method tab ("Email · Sent"). */
export const METHOD_STATUS_WORD: Record<CampaignStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const SOURCE_LABEL_EXACT = "Exactly as sent";
export const SOURCE_LABEL_REBUILT =
  "Rebuilt from your saved message. Brand details may have changed since.";
export const PER_GUEST_CAPTION = "Words in [brackets] were filled in for each guest.";
export const NUMBERS_LATER = "Numbers appear once it sends.";
export const SMS_COST_MISSING = "Cost not recorded for this send.";

export const GUEST_LABELS = {
  first_name: "[first name]",
  event_name: "[event name]",
  previous_event_name: "[previous event]",
} as const;

const PER_GUEST_TOKEN_RE = /\{(first_name|event_name|previous_event_name)\}/;

export const PUSH_REASON_CAPTION: Record<PushReason, string> = {
  follower: "To followers",
  extended: "To friends of followers",
  book: "To your guest list",
};

export type PreviewSource = "snapshot" | "payload_live" | "draft";

/** Variables the email pane substitutes; null renders as empty (as at send). */
export interface PreviewVariableMap {
  first_name: string;
  event_name: string;
  previous_event_name: string;
  brand_name: string | null;
  event_date: string | null;
  event_date_short: string | null;
  event_url: string | null;
  next_event_name: string | null;
  event_id: string | null;
}

export interface EmailPreviewProps {
  subject: string;
  bodyHtml: string;
  variables: PreviewVariableMap;
  brandName: string;
  brandHeaderImageUrl: string | null;
  embeddedEvents: Array<{
    id: string;
    title: string;
    date_label: string | null;
    ends_at_label: string | null;
    cover_image_url: string | null;
    cover_media_type: "image" | "video" | "gif" | null;
    location_label: string | null;
  }>;
  brandSlug: string | null;
  fromLabel: string;
  /** True when a per-guest word is in the subject or body. */
  hasGuestWords: boolean;
}

export interface SmsPreviewProps {
  body: string;
  brandName: string;
  brandSlug: string | null;
  includeFollowCta: boolean;
  hasMedia: boolean;
  mediaUris: string[];
  /** The text exactly as sent; null rebuilds it from the saved message. */
  wireOverride: string | null;
  countLineOverride: string | null;
}

export interface PushPreviewProps {
  variants: Array<{ reason: PushReason; caption: string; title: string; body: string }> | null;
  /** Rebuild (no snapshot): one follower push from the saved message. */
  fallback: { title: string | null; body: string } | null;
  brandName: string;
}

export type PreviewResolution =
  | { channel: "email"; source: PreviewSource; label: string | null; props: EmailPreviewProps }
  | { channel: "sms"; source: PreviewSource; label: string | null; props: SmsPreviewProps }
  | { channel: "push"; source: PreviewSource; label: string | null; props: PushPreviewProps };

const NOT_SENT: ReadonlySet<CampaignStatus> = new Set<CampaignStatus>(["draft", "scheduled", "cancelled"]);

/**
 * Has this method started sending? Sending, sent and failed have; so has a
 * send held back to "scheduled" for quiet hours after its first texts went
 * out (it carries a snapshot). Drafts, untouched schedules and cancelled sends
 * have not.
 */
export function sendStarted(member: Pick<CampaignGroupMember, "status" | "snapshot">): boolean {
  return !NOT_SENT.has(member.status) || member.snapshot !== null;
}

function sourceFor(member: CampaignGroupMember): PreviewSource {
  if (member.snapshot !== null && member.snapshot.kind === member.channel) return "snapshot";
  return sendStarted(member) ? "payload_live" : "draft";
}

function labelFor(source: PreviewSource): string | null {
  if (source === "snapshot") return SOURCE_LABEL_EXACT;
  if (source === "payload_live") return SOURCE_LABEL_REBUILT;
  return null;
}

function guestVariables(base: Omit<PreviewVariableMap, keyof typeof GUEST_LABELS>, nextEventName: string | null): PreviewVariableMap {
  return {
    ...base,
    first_name: GUEST_LABELS.first_name,
    // At send a guest's own last event fills this, falling back to the
    // campaign's first event; the preview shows the fallback or the label.
    event_name: nextEventName ?? GUEST_LABELS.event_name,
    previous_event_name: GUEST_LABELS.previous_event_name,
  };
}

/** The email pane's props for one member. */
function emailProps(member: CampaignGroupMember, brand: CampaignGroupView["brand"], source: PreviewSource): EmailPreviewProps {
  if (source === "snapshot") {
    const snap = member.snapshot as EmailSnapshotV1;
    const vars = snap.campaign_variables;
    const variables = guestVariables(
      {
        brand_name: vars.brand_name,
        event_date: vars.event_date,
        event_date_short: vars.event_date_short,
        event_url: vars.event_url,
        next_event_name: vars.next_event_name,
        event_id: vars.event_id,
      },
      vars.next_event_name,
    );
    return {
      subject: snap.subject,
      bodyHtml: snap.body_html,
      variables,
      brandName: snap.brand.name,
      brandHeaderImageUrl: snap.header_image_url,
      embeddedEvents: snap.embedded_events.map((event) => ({
        id: event.id,
        title: event.title,
        date_label: event.date_label ?? null,
        ends_at_label: event.ends_at_label ?? null,
        cover_image_url: event.cover_image_url ?? null,
        cover_media_type: event.cover_media_type ?? null,
        location_label: event.location_label ?? null,
      })),
      brandSlug: snap.follow_url !== null ? snap.brand.slug : null,
      fromLabel: snap.from_display,
      hasGuestWords: PER_GUEST_TOKEN_RE.test(snap.subject) || PER_GUEST_TOKEN_RE.test(snap.body_html),
    };
  }
  const payload = member.payload.kind === "email" ? member.payload : null;
  const subject = payload?.subject ?? "";
  const bodyHtml = payload?.body_html ?? "";
  return {
    subject,
    bodyHtml,
    variables: guestVariables(
      {
        brand_name: brand.name,
        event_date: null,
        event_date_short: null,
        event_url: null,
        next_event_name: null,
        event_id: null,
      },
      null,
    ),
    brandName: brand.name,
    brandHeaderImageUrl: brand.coverUrl,
    // Cards render as the pane's placeholder: today's event may have changed.
    embeddedEvents: [],
    brandSlug: brand.slug,
    fromLabel: brand.name,
    hasGuestWords: PER_GUEST_TOKEN_RE.test(subject) || PER_GUEST_TOKEN_RE.test(bodyHtml),
  };
}

function smsCountLine(snap: SmsSnapshotV1): string {
  const unit = snap.encoding === "MMS"
    ? "1 message"
    : `${snap.segments} ${snap.segments === 1 ? "segment" : "segments"}`;
  return `${snap.encoding} · ${snap.wire_text.length} chars · ${unit}`;
}

function smsProps(member: CampaignGroupMember, brand: CampaignGroupView["brand"], source: PreviewSource): SmsPreviewProps {
  if (source === "snapshot") {
    const snap = member.snapshot as SmsSnapshotV1;
    return {
      body: snap.body_as_authored,
      brandName: snap.brand.name,
      brandSlug: snap.brand.slug,
      includeFollowCta: snap.follow_included,
      hasMedia: snap.media_urls.length > 0,
      mediaUris: snap.media_urls,
      wireOverride: snap.wire_text,
      countLineOverride: smsCountLine(snap),
    };
  }
  const payload = member.payload.kind === "sms" ? member.payload : null;
  const media = payload?.media_urls ?? [];
  return {
    body: payload?.body ?? "",
    brandName: brand.name,
    brandSlug: brand.slug,
    includeFollowCta: payload?.include_follow_cta === true,
    hasMedia: media.length > 0,
    mediaUris: media,
    wireOverride: null,
    countLineOverride: null,
  };
}

function pushProps(member: CampaignGroupMember, brand: CampaignGroupView["brand"], source: PreviewSource): PushPreviewProps {
  if (source === "snapshot" && member.snapshot !== null && member.snapshot.kind === "push") {
    return {
      variants: member.snapshot.variants.map((variant) => ({
        reason: variant.reason,
        caption: PUSH_REASON_CAPTION[variant.reason],
        title: variant.title,
        body: variant.body,
      })),
      fallback: null,
      brandName: member.snapshot.brand.name,
    };
  }
  const payload = member.payload.kind === "push" ? member.payload : null;
  return {
    variants: null,
    fallback: { title: payload?.title ?? null, body: payload?.body ?? "" },
    brandName: brand.name,
  };
}

/** Which preview a method shows, with the props for its pane and its label. */
export function previewSourceFor(member: CampaignGroupMember, brand: CampaignGroupView["brand"]): PreviewResolution {
  const source = sourceFor(member);
  const label = labelFor(source);
  switch (member.channel) {
    case "email":
      return { channel: "email", source, label, props: emailProps(member, brand, source) };
    case "sms":
      return { channel: "sms", source, label, props: smsProps(member, brand, source) };
    case "push":
      return { channel: "push", source, label, props: pushProps(member, brand, source) };
    default: {
      const _exhaustive: never = member.channel;
      throw new Error(`unknown method ${String(_exhaustive)}`);
    }
  }
}

/** "Email · Sent". */
export function methodTabLabel(member: Pick<CampaignGroupMember, "channel" | "status">): string {
  return `${METHOD_LABEL[member.channel]} · ${METHOD_STATUS_WORD[member.status]}`;
}

/**
 * One tab per method. A failed or cancelled method can be sent again, so a
 * group may hold two members on one method: the tab shows the one the host
 * tapped, else the newest.
 */
export function tabMembers(members: readonly CampaignGroupMember[], focusId: string): CampaignGroupMember[] {
  const byChannel = new Map<MethodChannel, CampaignGroupMember>();
  const oldestFirst = [...members].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const member of oldestFirst) {
    const current = byChannel.get(member.channel);
    // The tapped member always wins its method; otherwise the newest does.
    if (current === undefined || member.campaignId === focusId || current.campaignId !== focusId) {
      byChannel.set(member.channel, member);
    }
  }
  return METHOD_ORDER.flatMap((channel) => {
    const member = byChannel.get(channel);
    return member === undefined ? [] : [member];
  });
}
