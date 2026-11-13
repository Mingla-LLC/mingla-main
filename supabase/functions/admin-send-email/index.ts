import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  createClient,
  type SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertNotResendSandbox,
  formatSenderHeader,
  renderTransactionalEmail,
  type SenderIdentity,
} from "../_shared/email/index.ts";
import { signUnsubscribeToken } from "../_shared/marketingTokens.ts";
import {
  BlogPostBlockError,
  listBlogPostOptions,
  resolveBlogPostBlocks,
  snapshotsFromResolved,
} from "../_shared/email/blogPostBlock.ts";
import {
  assertSupportedPersonalization,
  type AudienceDefinition,
  campaignFailureCode,
  campaignState,
  documentPlainText,
  fallbackPersonalization,
  legacyBodyDocument,
  normalizeAudience,
  normalizedValidEmail,
  personalizeDocument,
  maskEmail,
  personalizeText,
  rebuildFromStoredSnapshots,
  type RecipientProfile,
  SAMPLE_RECIPIENT,
  snapshotAudience,
  storedRenderedDocument,
  subjectSearchPattern,
  validateDocument,
  versionedDocument,
} from "./model.ts";
import type { EmailContentBlock } from "../_shared/email/types.ts";
import {
  applyDirectoryFilters,
  appStatusLabel,
  DIRECTORY_COLUMNS,
  type DirectoryRow,
  directoryRowToRecipient,
  requiresMarketingConsent,
} from "./audience.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";

// #4419 (Seth, 13 Nov): Admin campaigns send from campaigns.usemingla.com,
// the domain whose open tracking already works, so delivered / opened /
// clicked come back for them. Ticket and system email keep usemingla.com
// (_shared/email/senders.ts); no provider setting changes here.
export const ADMIN_SENDER: SenderIdentity = {
  name: "Mingla",
  address: "hello@campaigns.usemingla.com",
};
const ADMIN_REPLY_TO = "noreply@usemingla.com";
const ADMIN_BLAST_BRAND_ID = "00000000-0000-4000-8000-372000000002";
const BRANDED_UNSUBSCRIBE_LINK_ORIGIN = "https://usemingla.com/unsubscribe";
const RECIPIENT_PAGE_SIZE = 1000;
const DELIVERY_BATCH_SIZE = 40;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type ServiceClient = SupabaseClient;
interface CampaignRecord {
  id: string;
  subject: string;
  body: string;
  body_document: unknown;
  /** #4419: set once, when the first batch saved the exact copy. */
  rendered_at?: string | null;
  rendered_document?: unknown;
}

/** Legacy API segment names retained only for compatibility; unknown values fail closed. */
const SUPPORTED_SEGMENT_TYPES = new Set([
  "all",
  "country",
  "onboarding",
  "status",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getUnsubscribeOrigin(): string {
  const override = Deno.env.get("MINGLA_UNSUBSCRIBE_LINK_ORIGIN");
  return override?.trim()
    ? override.replace(/\/+$/, "")
    : BRANDED_UNSUBSCRIBE_LINK_ORIGIN;
}

function assertSupportedSegment(
  segment: { type?: string } | null | undefined,
): string | null {
  const type = segment?.type ?? "all";
  return SUPPORTED_SEGMENT_TYPES.has(type)
    ? null
    : `unsupported_segment:${type}`;
}

function legacySegmentAudience(
  segment: Record<string, unknown> | null | undefined,
): AudienceDefinition {
  const type = typeof segment?.type === "string" ? segment.type : "all";
  if (type === "all") return { mode: "everyone", filters: {} };
  if (type === "country") {
    return {
      mode: "segment",
      filters: { country: String(segment?.country ?? "all") },
    };
  }
  if (type === "onboarding") {
    return {
      mode: "segment",
      filters: {
        onboarding: segment?.onboarding === "completed"
          ? "completed"
          : "incomplete",
      },
    };
  }
  if (type === "status") {
    return {
      mode: "segment",
      filters: {
        accountStatus: segment?.status === "active" ? "active" : "inactive",
      },
    };
  }
  throw new Error(`unsupported_segment:${type}`);
}

/**
 * #4226 — every audience reads the admin-only people list
 * (admin_people_directory), the one the People page uses, so Explorer / Host
 * mean the same thing here as there and ticket buyers and host contacts with
 * no account can be reached. Everyone is the whole list. Filters live in
 * ./audience.ts.
 */
async function loadDirectoryRows(
  supabase: ServiceClient,
  audience: AudienceDefinition | null,
): Promise<DirectoryRow[]> {
  const rows: DirectoryRow[] = [];
  for (let offset = 0;; offset += RECIPIENT_PAGE_SIZE) {
    let query = supabase
      .rpc("admin_people_directory")
      .select(DIRECTORY_COLUMNS)
      .order("person_key", { ascending: true })
      .range(offset, offset + RECIPIENT_PAGE_SIZE - 1);
    if (audience) query = applyDirectoryFilters(query, audience);
    const { data, error } = await query;
    if (error) throw new Error(`audience_query_failed:${error.message}`);
    const page = (data ?? []) as DirectoryRow[];
    rows.push(...page);
    if (page.length < RECIPIENT_PAGE_SIZE) break;
  }
  return rows;
}

async function loadAudienceProfiles(
  supabase: ServiceClient,
  audience: AudienceDefinition,
): Promise<RecipientProfile[]> {
  return (await loadDirectoryRows(supabase, audience)).map(
    directoryRowToRecipient,
  );
}

/** #4226: staff/test out of bulk sends; ticket buyers need marketing consent. */
function snapshotFor(
  recipients: RecipientProfile[],
  suppressed: Set<string>,
  audience: AudienceDefinition,
) {
  return snapshotAudience(recipients, suppressed, {
    excludeInternal: audience.mode !== "person",
    requireConsent: (profile) => requiresMarketingConsent(audience, profile),
  });
}

/** Lowercased emails suppressed for marketing/all email channel. */
async function loadSuppressedEmails(
  supabase: ServiceClient,
): Promise<Set<string>> {
  const suppressed = new Set<string>();
  const { data: channelRows, error: channelError } = await supabase
    .from("channel_suppressions")
    .select("contact")
    .eq("channel", "email")
    .in("scope", ["marketing", "all"])
    .not("contact", "is", null);
  if (channelError) {
    throw new Error(
      `optout_channel_suppressions_failed:${channelError.message}`,
    );
  }
  for (const row of channelRows ?? []) {
    const email = typeof row.contact === "string"
      ? row.contact.toLowerCase().trim()
      : "";
    if (email) suppressed.add(email);
  }

  const { data: legacyRows, error: legacyError } = await supabase
    .from("marketing_unsubscribes")
    .select("contact_email")
    .not("contact_email", "is", null);
  if (legacyError && !/does not exist|relation/i.test(legacyError.message)) {
    throw new Error(
      `optout_marketing_unsubscribes_failed:${legacyError.message}`,
    );
  }
  for (const row of legacyRows ?? []) {
    const email = typeof row.contact_email === "string"
      ? row.contact_email.toLowerCase().trim()
      : "";
    if (email) suppressed.add(email);
  }
  return suppressed;
}

async function buildUnsubscribeHeaders(
  campaignId: string,
  recipientEmail: string,
) {
  const token = await signUnsubscribeToken({
    campaign_id: campaignId,
    recipient_email: recipientEmail.toLowerCase().trim(),
    brand_id: ADMIN_BLAST_BRAND_ID,
  });
  const url = `${getUnsubscribeOrigin()}/${token}?scope=global`;
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * #4419 — the one render of an Admin email for one person. The composer
 * preview, the exact copy saved at send start, every send, the Rebuilt view
 * and a test send all go through here, so they cannot drift.
 */
export function renderCampaignEmail(
  subject: string,
  resolvedDocument: EmailContentBlock[],
  profile: RecipientProfile,
  to?: string,
) {
  const rendered = renderTransactionalEmail({
    variant: "admin_compose",
    recipient: {
      name: profile.first_name ?? null,
      email: to ?? profile.email ?? SAMPLE_RECIPIENT.email ?? "member@example.com",
    },
    body: {
      variant: "admin_compose",
      title: personalizeText(subject, profile),
      paragraphs: [],
      document: personalizeDocument(resolvedDocument, profile),
    },
    sender: ADMIN_SENDER,
  });
  return {
    subject: rendered.subject,
    preheader: rendered.preheader ?? "",
    html: rendered.html,
    text: rendered.text,
    from: rendered.from,
  };
}

async function sendViaResend(input: {
  deliveryId: string;
  campaignId: string;
  to: string;
  subject: string;
  document: EmailContentBlock[];
  profile: RecipientProfile;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    assertNotResendSandbox(ADMIN_SENDER);
    const rendered = renderCampaignEmail(
      input.subject,
      input.document,
      input.profile,
      input.to,
    );
    const marketingHeaders = await buildUnsubscribeHeaders(
      input.campaignId,
      input.to,
    );
    // no-attachment: Admin campaigns embed approved image/GIF URLs in HTML; this composer does not send file attachments.
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `admin-email-${input.deliveryId}`,
      },
      body: JSON.stringify({
        from: formatSenderHeader(rendered.from),
        reply_to: ADMIN_REPLY_TO,
        to: [input.to],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: marketingHeaders,
      }),
    });
    const responseBody = await response.text();
    if (!response.ok) {
      return { ok: false, error: `Resend ${response.status}: ${responseBody}` };
    }
    let id: string | undefined;
    try {
      const parsed = JSON.parse(responseBody);
      if (typeof parsed?.id === "string") id = parsed.id;
    } catch {
      // A successful provider response without JSON still counts as accepted.
    }
    return { ok: true, id };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// The subject and document checks every campaign's words pass, whether new
// (createCampaign) or a scheduled one being edited (#4383
// updateScheduledCampaign): one set of checks, one owner.
export async function prepareCampaignContent(
  supabase: ServiceClient,
  raw: Record<string, unknown>,
) {
  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  if (!subject || subject.length > 998 || /[\r\n]/.test(subject)) {
    throw new Error("email_subject_invalid");
  }
  const document = validateDocument(
    raw.document ?? legacyBodyDocument(String(raw.body ?? "")),
  );
  const resolvedBlog = await resolveBlogPostBlocks(
    supabase,
    document,
    SUPABASE_URL,
  );
  if (resolvedBlog.missing.length) {
    throw new Error(
      `email_block_blog_post_not_published:${resolvedBlog.missing[0]}`,
    );
  }
  const storedDocument = snapshotsFromResolved(document, resolvedBlog.document);
  const assetPrefix = `${
    SUPABASE_URL.replace(/\/+$/, "")
  }/storage/v1/object/public/admin-email-assets/`;
  if (
    document.some((block) =>
      block.type === "image" && !block.url.startsWith(assetPrefix)
    )
  ) {
    throw new Error("email_image_asset_bucket_required");
  }
  assertSupportedPersonalization(subject, document);
  if (!documentPlainText(resolvedBlog.document).replace(/─/g, "").trim()) {
    throw new Error("email_document_empty");
  }
  return {
    subject,
    storedDocument,
    plainBody: documentPlainText(resolvedBlog.document),
  };
}

export async function createCampaign(
  supabase: ServiceClient,
  userId: string,
  raw: Record<string, unknown>,
) {
  if (!RESEND_API_KEY) throw new Error("NO_PROVIDER");
  if (!raw.audience || typeof raw.audience !== "object") {
    throw new Error("audience_required");
  }
  const { subject, storedDocument, plainBody } = await prepareCampaignContent(supabase, raw);
  const audience = normalizeAudience(raw.audience);
  const scheduledFor = typeof raw.scheduledFor === "string" && raw.scheduledFor
    ? new Date(raw.scheduledFor)
    : null;
  if (scheduledFor && Number.isNaN(scheduledFor.getTime())) {
    throw new Error("scheduled_time_invalid");
  }
  const timezone = typeof raw.timezone === "string" && raw.timezone.trim()
    ? raw.timezone.trim()
    : "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error("scheduled_timezone_invalid");
  }

  const recipients = await loadAudienceProfiles(supabase, audience);
  const suppressed = await loadSuppressedEmails(supabase);
  const snapshot = snapshotFor(recipients, suppressed, audience);
  if (snapshot.willReceive < 1) {
    throw new Error("audience_has_no_eligible_recipients");
  }

  const status = scheduledFor && scheduledFor.getTime() > Date.now()
    ? "scheduled"
    : "queued";
  const { data: campaign, error: campaignError } = await supabase
    .from("admin_email_log")
    .insert({
      subject,
      body: plainBody,
      body_document: versionedDocument(storedDocument),
      from_name: ADMIN_SENDER.name,
      from_email: ADMIN_SENDER.address,
      recipient_type: audience.mode === "person" ? "individual" : "bulk",
      recipient_email: audience.mode === "person"
        ? snapshot.deliveries[0]?.recipient_email ?? null
        : null,
      segment_filter: audience.mode === "segment" ? audience.filters : null,
      audience,
      recipient_count: snapshot.deliveries.length,
      matched_count: snapshot.matched,
      skipped_count: snapshot.skippedOptOut,
      no_contact_count: snapshot.noContact,
      duplicate_count: snapshot.duplicate,
      no_consent_count: snapshot.noConsent,
      internal_excluded_count: snapshot.internalExcluded,
      status,
      scheduled_for: scheduledFor?.toISOString() ?? null,
      timezone,
      sent_by: userId,
    })
    .select("id,status,scheduled_for,recipient_count,skipped_count")
    .single();
  if (campaignError || !campaign) {
    throw new Error(
      `campaign_create_failed:${campaignError?.message ?? "unknown"}`,
    );
  }

  for (let offset = 0; offset < snapshot.deliveries.length; offset += 500) {
    const page = snapshot.deliveries.slice(offset, offset + 500).map((row) => ({
      ...row,
      campaign_id: campaign.id,
    }));
    const { error } = await supabase.from("admin_email_recipient_deliveries")
      .insert(page);
    if (error) {
      await supabase.from("admin_email_log").update({
        status: "failed",
        last_error: error.message,
      }).eq("id", campaign.id);
      throw new Error(`campaign_recipient_snapshot_failed:${error.message}`);
    }
  }

  if (status === "queued") {
    scheduleBackground(processCampaignById(supabase, campaign.id));
  }
  return {
    ...campaign,
    matched: snapshot.matched,
    will_receive: snapshot.willReceive,
    skipped_opt_out: snapshot.skippedOptOut,
    no_contact: snapshot.noContact,
    duplicate: snapshot.duplicate,
    no_consent: snapshot.noConsent,
    internal: snapshot.internalExcluded,
  };
}

// #4383 — a scheduled email can change its time or its words until the
// sender starts it. Both writes are conditional on status 'scheduled' and no
// processing_started_at, so a campaign the drain has claimed is never
// changed (campaign_not_reschedulable). Who gets it is fixed: the audience
// was counted when it was scheduled (D8); a new audience is a new email.
const SCHEDULED_GUARD_COLUMNS = "id,status,subject,scheduled_for,timezone";

// #4383 (tester P3-2): who changed a scheduled email, and how, is recorded.
// A failed audit write is logged loudly but never undoes the change it records.
export type CampaignActor = { id: string; email: string | null };

async function auditCampaignChange(
  supabase: ServiceClient,
  actor: CampaignActor | null,
  action:
    | "email_campaign_rescheduled"
    | "email_campaign_edited"
    | "email_campaign_cancelled"
    | "email_campaign_test_sent",
  campaignId: string,
  metadata: Record<string, unknown>,
) {
  if (!actor) return;
  try {
    const { error } = await supabase.from("admin_audit_log").insert({
      admin_email: actor.email ?? actor.id,
      action,
      target_type: "admin_email_log",
      target_id: campaignId,
      metadata: { ...metadata, actor_user_id: actor.id },
    });
    if (error) console.error(`[admin-send-email] audit ${action} failed`, error.message);
  } catch (error) {
    console.error(`[admin-send-email] audit ${action} failed`, error);
  }
}

function campaignIdFrom(raw: Record<string, unknown>): string {
  const campaignId = typeof raw.campaignId === "string" ? raw.campaignId.trim() : "";
  if (!UUID_PATTERN.test(campaignId)) throw new Error("campaign_id_invalid");
  return campaignId;
}

/** The new send time: a real instant at least a minute ahead, in a real zone. */
export function rescheduleInput(raw: Record<string, unknown>, now = Date.now()) {
  const scheduledFor = typeof raw.scheduledFor === "string" && raw.scheduledFor
    ? new Date(raw.scheduledFor)
    : null;
  if (!scheduledFor || Number.isNaN(scheduledFor.getTime())) {
    throw new Error("scheduled_time_invalid");
  }
  if (scheduledFor.getTime() <= now + 60_000) {
    throw new Error("scheduled_time_past");
  }
  const timezone = typeof raw.timezone === "string" ? raw.timezone.trim() : "";
  try {
    if (!timezone) throw new Error("empty");
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error("scheduled_timezone_invalid");
  }
  return { scheduledFor, timezone };
}

export async function rescheduleCampaign(
  supabase: ServiceClient,
  raw: Record<string, unknown>,
  now = Date.now(),
  actor: CampaignActor | null = null,
) {
  const campaignId = campaignIdFrom(raw);
  const { scheduledFor, timezone } = rescheduleInput(raw, now);
  const { data, error } = await supabase
    .from("admin_email_log")
    .update({ scheduled_for: scheduledFor.toISOString(), timezone })
    .eq("id", campaignId)
    .eq("status", "scheduled")
    .is("processing_started_at", null)
    .select(SCHEDULED_GUARD_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`campaign_reschedule_failed:${error.message}`);
  if (!data) throw new Error("campaign_not_reschedulable");
  await auditCampaignChange(supabase, actor, "email_campaign_rescheduled", campaignId, {
    scheduled_for: scheduledFor.toISOString(),
    timezone,
  });
  return data;
}

export async function updateScheduledCampaign(
  supabase: ServiceClient,
  raw: Record<string, unknown>,
  actor: CampaignActor | null = null,
) {
  const campaignId = campaignIdFrom(raw);
  const { subject, storedDocument, plainBody } = await prepareCampaignContent(supabase, raw);
  const { data, error } = await supabase
    .from("admin_email_log")
    .update({ subject, body: plainBody, body_document: versionedDocument(storedDocument) })
    .eq("id", campaignId)
    .eq("status", "scheduled")
    .is("processing_started_at", null)
    .select(SCHEDULED_GUARD_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`campaign_update_failed:${error.message}`);
  if (!data) throw new Error("campaign_not_reschedulable");
  await auditCampaignChange(supabase, actor, "email_campaign_edited", campaignId, { subject });
  return data;
}

/** A scheduled email's words, for the composer's edit mode. */
export async function getScheduledCampaign(
  supabase: ServiceClient,
  raw: Record<string, unknown>,
) {
  const campaignId = campaignIdFrom(raw);
  const { data, error } = await supabase
    .from("admin_email_log")
    .select("id,status,subject,body,body_document,scheduled_for,timezone,processing_started_at")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw new Error(`campaign_read_failed:${error.message}`);
  if (!data || data.status !== "scheduled" || data.processing_started_at) {
    throw new Error("campaign_not_reschedulable");
  }
  const stored = data.body_document as { blocks?: unknown } | null;
  return {
    id: data.id,
    subject: data.subject,
    document: validateDocument(stored?.blocks ?? stored ?? legacyBodyDocument(String(data.body ?? ""))),
    scheduled_for: data.scheduled_for,
    timezone: data.timezone,
  };
}

function scheduleBackground(promise: Promise<unknown>) {
  const runtime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (value: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(promise);
  else {promise.catch((error) =>
      console.error("[admin-send-email] background failure", error)
    );}
}

async function claimCampaignById(
  supabase: ServiceClient,
  campaignId: string,
) {
  const now = new Date().toISOString();
  const { data: scheduled } = await supabase.from("admin_email_log")
    .update({ status: "sending", started_at: now, processing_started_at: now })
    .eq("id", campaignId)
    .eq("status", "scheduled")
    .lte("scheduled_for", now)
    .select("*")
    .maybeSingle();
  if (scheduled) return scheduled;
  const { data: queued } = await supabase.from("admin_email_log")
    .update({ status: "sending", started_at: now, processing_started_at: now })
    .eq("id", campaignId)
    .eq("status", "queued")
    .select("*")
    .maybeSingle();
  return queued;
}

// INVARIANT I-4419-EMAIL-ONE-DOCUMENT-PER-CAMPAIGN: every batch of a campaign
// sends admin_email_log.rendered_document, saved once by the first batch.
// A blog edit after that changes nothing anyone receives. Enforced here;
// tested by issue_4419_email_snapshot.implementor.test.ts (blog edit case).
async function frozenCampaignDocument(
  supabase: ServiceClient,
  campaign: CampaignRecord,
  resolved: EmailContentBlock[],
): Promise<EmailContentBlock[]> {
  if (!campaign.rendered_at) {
    const copy = renderCampaignEmail(campaign.subject, resolved, SAMPLE_RECIPIENT);
    const { error } = await supabase.from("admin_email_log").update({
      rendered_subject: copy.subject,
      rendered_preheader: copy.preheader,
      rendered_html: copy.html,
      rendered_text: copy.text,
      rendered_document: versionedDocument(resolved),
      render_sample: { ...SAMPLE_RECIPIENT },
      rendered_at: new Date().toISOString(),
    }).eq("id", campaign.id).is("rendered_at", null);
    if (error) throw new Error(`email_snapshot_failed:${error.message}`);
  }
  // Read the stored document back: another run may have saved it first, and
  // the stored one is the one that goes out.
  const { data, error } = await supabase.from("admin_email_log")
    .select("rendered_at,rendered_document")
    .eq("id", campaign.id)
    .maybeSingle();
  if (error) throw new Error(`email_snapshot_failed:${error.message}`);
  if (!data?.rendered_at || !data.rendered_document) {
    throw new Error("email_snapshot_failed:copy_missing");
  }
  return storedRenderedDocument(data.rendered_document);
}

export async function processClaimedCampaign(
  supabase: ServiceClient,
  campaign: CampaignRecord,
) {
  const references = validateDocument(
    campaign.body_document ?? legacyBodyDocument(campaign.body),
  );
  const resolvedBlog = await resolveBlogPostBlocks(
    supabase,
    references,
    SUPABASE_URL,
  );
  if (resolvedBlog.missing.length) {
    await supabase.from("admin_email_log").update({
      status: "failed",
      last_error: `blog_post_not_published:${resolvedBlog.missing[0]}`,
      completed_at: new Date().toISOString(),
    }).eq("id", campaign.id);
    return {
      ok: false,
      error: `blog_post_not_published:${resolvedBlog.missing[0]}`,
    };
  }
  // #4419 D6/D7: the blog post is frozen when sending starts. The first batch
  // saves the exact copy and the resolved document; every batch (this one and
  // each one after) sends that stored document. If the copy can't be saved,
  // nothing is sent.
  let document: EmailContentBlock[];
  try {
    document = await frozenCampaignDocument(
      supabase,
      campaign,
      resolvedBlog.document,
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = raw.startsWith("email_snapshot_failed")
      ? raw
      : `email_snapshot_failed:${raw}`;
    await supabase.from("admin_email_log").update({
      status: "failed",
      last_error: message.slice(0, 2000),
      completed_at: new Date().toISOString(),
      processing_started_at: null,
    }).eq("id", campaign.id);
    return { ok: false, error: message };
  }
  const { data: deliveries, error: claimError } = await supabase.rpc(
    "claim_admin_email_delivery_batch",
    {
      p_campaign_id: campaign.id,
      p_limit: DELIVERY_BATCH_SIZE,
    },
  );
  if (claimError) {
    throw new Error(`delivery_claim_failed:${claimError.message}`);
  }
  const liveSuppressed = await loadSuppressedEmails(supabase);

  for (let offset = 0; offset < (deliveries ?? []).length; offset += 5) {
    const group = deliveries.slice(offset, offset + 5);
    await Promise.all(group.map(async (delivery: Record<string, unknown>) => {
      const recipientEmail = String(delivery.recipient_email).toLowerCase()
        .trim();
      if (liveSuppressed.has(recipientEmail)) {
        await supabase.from("admin_email_recipient_deliveries").update({
          status: "skipped_opt_out",
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq("id", delivery.id);
        return;
      }
      const result = await sendViaResend({
        deliveryId: String(delivery.id),
        campaignId: String(campaign.id),
        to: recipientEmail,
        subject: campaign.subject,
        document,
        profile: delivery.personalization as RecipientProfile,
      });
      if (result.ok) {
        await supabase.from("admin_email_recipient_deliveries").update({
          status: "accepted",
          provider_message_id: result.id ?? null,
          accepted_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq("id", delivery.id);
      } else {
        const attempts = Number(delivery.attempts ?? 1);
        await supabase.from("admin_email_recipient_deliveries").update({
          status: attempts >= 3 ? "failed" : "retrying",
          next_attempt_at: new Date(Date.now() + Math.pow(2, attempts) * 60_000)
            .toISOString(),
          last_error: result.error?.slice(0, 2000) ?? "provider_error",
          updated_at: new Date().toISOString(),
        }).eq("id", delivery.id);
      }
    }));
  }

  const countStatuses = async (statuses: string[]) => {
    const { count, error } = await supabase
      .from("admin_email_recipient_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .in("status", statuses);
    if (error) throw new Error(`delivery_count_failed:${error.message}`);
    return count ?? 0;
  };
  const [accepted, failed, skipped, unfinished] = await Promise.all([
    countStatuses(["accepted"]),
    countStatuses(["failed"]),
    countStatuses(["skipped_opt_out"]),
    countStatuses(["pending", "sending", "retrying"]),
  ]);

  if (unfinished > 0) {
    await supabase.from("admin_email_log").update({
      status: "queued",
      sent_count: accepted,
      failed_count: failed,
      skipped_count: skipped,
      processing_started_at: null,
    }).eq("id", campaign.id);
    return {
      campaign_id: campaign.id,
      accepted,
      failed,
      skipped_opt_out: skipped,
      pending: unfinished,
    };
  }

  const finalStatus = failed === 0
    ? "completed"
    : accepted === 0
    ? "failed"
    : "partial";
  await supabase.from("admin_email_log").update({
    status: finalStatus,
    sent_count: accepted,
    failed_count: failed,
    skipped_count: skipped,
    completed_at: new Date().toISOString(),
    processing_started_at: null,
  }).eq("id", campaign.id);
  return {
    campaign_id: campaign.id,
    status: finalStatus,
    accepted,
    failed,
    skipped_opt_out: skipped,
    pending: 0,
  };
}

async function processCampaignById(
  supabase: ServiceClient,
  campaignId: string,
) {
  const campaign = await claimCampaignById(supabase, campaignId);
  return campaign
    ? await processClaimedCampaign(supabase, campaign)
    : { campaign_id: campaignId, claimed: false };
}

async function processDueCampaign(supabase: ServiceClient) {
  const { data: campaignId, error } = await supabase.rpc(
    "claim_due_admin_email_campaign",
  );
  if (error) throw new Error(`campaign_claim_failed:${error.message}`);
  if (!campaignId) return { claimed: false };
  const { data: campaign, error: fetchError } = await supabase.from(
    "admin_email_log",
  ).select("*").eq("id", campaignId).single();
  if (fetchError || !campaign) {
    throw new Error(
      `campaign_fetch_failed:${fetchError?.message ?? "unknown"}`,
    );
  }
  return await processClaimedCampaign(supabase, campaign);
}

// ─── #4419: cancel, the Emails list, one email's page, a test to yourself ───

/** Is the caller an Admin admin (admin_users, active)? Fails closed. */
export async function isAdminCaller(
  userClient: { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> },
): Promise<boolean> {
  try {
    const { data, error } = await userClient.rpc("is_admin_user");
    return !error && data === true;
  } catch (_err) {
    return false;
  }
}

/**
 * #4419 — Cancel only before the first batch. Between batches a sending
 * campaign is `queued` with no processing_started_at, so started_at is the
 * guard that keeps Cancel from stopping a send halfway (campaign_not_cancellable).
 * Who cancelled is stored and audited.
 */
export async function cancelCampaign(
  supabase: ServiceClient,
  raw: Record<string, unknown>,
  actor: CampaignActor | null = null,
) {
  const campaignId = campaignIdFrom(raw);
  const { data: campaign, error } = await supabase
    .from("admin_email_log")
    .update({
      status: "cancelled",
      completed_at: new Date().toISOString(),
      cancelled_by: actor?.id ?? null,
    })
    .eq("id", campaignId)
    .in("status", ["scheduled", "queued"])
    .is("processing_started_at", null)
    .is("started_at", null)
    .select("id,status")
    .maybeSingle();
  if (error) throw new Error(`campaign_cancel_failed:${error.message}`);
  if (!campaign) throw new Error("campaign_not_cancellable");
  await auditCampaignChange(supabase, actor, "email_campaign_cancelled", campaignId, {});
  return campaign;
}

const LIST_FILTERS = new Set([
  "all",
  "scheduled",
  "sending",
  "sent",
  "attention",
  "cancelled",
]);
export const LIST_PAGE_SIZE = 20;

type ListRow = Record<string, unknown>;

function toLabelFor(row: ListRow, isAdmin: boolean): string | null {
  if (row.recipient_type !== "individual") return null;
  const email = typeof row.recipient_email === "string" ? row.recipient_email : null;
  return isAdmin ? email : maskEmail(email);
}

/**
 * #4419 — the Emails tab. One read (issue_4419_admin_email_list) that never
 * returns the stored HTML or a bulk address. Non-admins get scheduled emails
 * only, as before (Seth, 13 Nov).
 */
export async function listCampaigns(
  supabase: ServiceClient,
  raw: Record<string, unknown>,
  ctx: { isAdmin: boolean },
) {
  const filter = typeof raw.filter === "string" && LIST_FILTERS.has(raw.filter)
    ? raw.filter
    : "all";
  const pageRaw = Number(raw.page ?? 0);
  const page = Number.isInteger(pageRaw) && pageRaw >= 0 && pageRaw <= 10_000
    ? pageRaw
    : 0;
  const { data, error } = await supabase.rpc("issue_4419_admin_email_list", {
    p_filter: filter,
    p_query: subjectSearchPattern(raw.query),
    p_admin: ctx.isAdmin,
    p_limit: LIST_PAGE_SIZE,
    p_offset: page * LIST_PAGE_SIZE,
  });
  if (error) throw new Error(`campaign_list_failed:${error.message}`);
  const result = (data ?? {}) as {
    rows?: ListRow[];
    counts?: Record<string, number>;
    total?: number;
  };
  const sourceRows = Array.isArray(result.rows) ? result.rows : [];
  const engagement = await listEngagement(
    supabase,
    sourceRows.map((row) => String(row.id)),
  );
  const rows = sourceRows.map((row) => {
    const { state, label } = campaignState({
      status: String(row.status ?? ""),
      started_at: (row.started_at as string | null) ?? null,
    });
    const recipientCount = Number(row.recipient_count ?? 0);
    const skipped = Number(row.skipped_count ?? 0);
    const counts = engagement.get(String(row.id));
    return {
      id: row.id,
      subject: row.subject,
      preheader: row.preheader ?? null,
      thumb_url: row.thumb_url ?? null,
      audience: row.audience ?? null,
      segment_filter: row.segment_filter ?? null,
      recipient_type: row.recipient_type,
      to_label: toLabelFor(row, ctx.isAdmin),
      by_name: row.by_name ?? null,
      state,
      state_label: label,
      scheduled_for: row.scheduled_for ?? null,
      timezone: row.timezone ?? "UTC",
      created_at: row.created_at ?? null,
      started_at: row.started_at ?? null,
      completed_at: row.completed_at ?? null,
      matched: Number(row.matched ?? 0),
      will_receive: Math.max(recipientCount - skipped, 0),
      accepted: Number(row.accepted ?? 0),
      failed: Number(row.failed ?? 0),
      has_snapshot: row.has_snapshot === true,
      delivered: counts?.delivered ?? null,
      opened_unique: counts?.opened_unique ?? null,
    };
  });
  return {
    rows,
    counts: {
      all: Number(result.counts?.all ?? 0),
      scheduled: Number(result.counts?.scheduled ?? 0),
      sending: Number(result.counts?.sending ?? 0),
      sent: Number(result.counts?.sent ?? 0),
      attention: Number(result.counts?.attention ?? 0),
      cancelled: Number(result.counts?.cancelled ?? 0),
    },
    total: Number(result.total ?? 0),
    page,
    page_size: LIST_PAGE_SIZE,
  };
}

/** #4419 Part B — delivered and unique opens per listed campaign; empty on a failed read (the list still loads). */
async function listEngagement(
  supabase: ServiceClient,
  ids: string[],
): Promise<Map<string, { delivered: number; opened_unique: number }>> {
  const out = new Map<string, { delivered: number; opened_unique: number }>();
  if (!ids.length) return out;
  const { data, error } = await supabase.rpc(
    "issue_4419_admin_email_engagement_counts",
    { p_campaign_ids: ids },
  );
  if (error) {
    console.error("[admin-send-email] engagement counts failed", error.message);
    return out;
  }
  for (const row of (Array.isArray(data) ? data : []) as ListRow[]) {
    out.set(String(row.campaign_id), {
      delivered: Number(row.delivered ?? 0),
      opened_unique: Number(row.opened_unique ?? 0),
    });
  }
  return out;
}

const DETAIL_COLUMNS =
  "id,subject,body,body_document,status,from_name,from_email,recipient_type,recipient_email,segment_filter,audience,recipient_count,sent_count,failed_count,skipped_count,matched_count,no_contact_count,duplicate_count,no_consent_count,internal_excluded_count,sent_by,created_at,scheduled_for,timezone,started_at,completed_at,processing_started_at,last_error,cancelled_by,rendered_subject,rendered_preheader,rendered_html,rendered_text,rendered_at";

type DetailRow = Record<string, unknown>;

async function personLabels(
  supabase: ServiceClient,
  ids: Array<unknown>,
): Promise<Map<string, string | null>> {
  const unique = [
    ...new Set(
      ids.filter((id): id is string => typeof id === "string" && UUID_PATTERN.test(id)),
    ),
  ];
  const out = new Map<string, string | null>();
  await Promise.all(unique.map(async (id) => {
    const { data, error } = await supabase.rpc("issue_4383_person_label", {
      p_user_id: id,
    });
    out.set(id, error ? null : (typeof data === "string" ? data : null));
  }));
  return out;
}

/**
 * #4419 — what the detail page shows in its frame. Exact copy when one was
 * saved; a live Preview while it hasn't started; otherwise Rebuilt from the
 * saved blocks (sent before Admin kept copies), labelled as such.
 */
export async function campaignView(supabase: ServiceClient, row: DetailRow) {
  if (row.rendered_at) {
    return {
      kind: "exact" as const,
      subject: String(row.rendered_subject ?? ""),
      preheader: String(row.rendered_preheader ?? ""),
      html: String(row.rendered_html ?? ""),
      text: String(row.rendered_text ?? ""),
      rendered_at: row.rendered_at as string,
      notes: [] as string[],
    };
  }
  const notes: string[] = [];
  let document: EmailContentBlock[];
  try {
    document = validateDocument(
      row.body_document ?? legacyBodyDocument(String(row.body ?? "")),
    );
  } catch {
    document = legacyBodyDocument(String(row.body ?? ""));
    notes.push("document_unreadable_used_plain_body");
  }
  const notStarted = !row.started_at;
  const resolveLive = async (doc: EmailContentBlock[]) => {
    try {
      const resolved = await resolveBlogPostBlocks(supabase, doc, SUPABASE_URL);
      for (const id of resolved.missing) notes.push(`blog_post_not_published:${id}`);
      return resolved.document;
    } catch (error) {
      notes.push(
        `blog_lookup_failed:${error instanceof Error ? error.message : String(error)}`,
      );
      return doc;
    }
  };
  let kind: "preview" | "rebuilt";
  if (notStarted) {
    kind = "preview";
    document = await resolveLive(document);
  } else {
    kind = "rebuilt";
    const rebuilt = rebuildFromStoredSnapshots(document);
    document = rebuilt.document;
    if (rebuilt.fromSnapshot) notes.push("blog_from_saved_snapshot");
    if (rebuilt.withoutSnapshot) {
      notes.push("blog_resolved_live");
      document = await resolveLive(document);
    }
  }
  const copy = renderCampaignEmail(
    String(row.subject ?? ""),
    document,
    SAMPLE_RECIPIENT,
  );
  return {
    kind,
    subject: copy.subject,
    preheader: copy.preheader,
    html: copy.html,
    text: copy.text,
    rendered_at: null,
    notes,
  };
}

type DeliverySummary = {
  total: number;
  accepted: number;
  failed: number;
  pending: number;
  skipped_late: number;
  by_reason: Array<{ code: string; count: number }>;
  raw: string | null;
};

/** #4419 — one email's whole page: state, timeline facts, the frame, counts, failures. */
export async function getCampaignDetail(
  supabase: ServiceClient,
  raw: Record<string, unknown>,
  ctx: { isAdmin: boolean },
) {
  const campaignId = campaignIdFrom(raw);
  const { data, error } = await supabase
    .from("admin_email_log")
    .select(DETAIL_COLUMNS)
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw new Error(`campaign_read_failed:${error.message}`);
  if (!data) throw new Error("campaign_not_found");
  const row = data as DetailRow;
  const { state, label } = campaignState({
    status: String(row.status ?? ""),
    started_at: (row.started_at as string | null) ?? null,
  });
  // Seth (13 Nov): only admins see sent emails, as before #4419.
  if (!ctx.isAdmin && state !== "scheduled") throw new Error("email_admin_only");

  const [view, summaryResult, auditResult, engagement] = await Promise.all([
    campaignView(supabase, row),
    supabase.rpc("issue_4419_admin_email_delivery_summary", {
      p_campaign_id: campaignId,
    }),
    supabase.from("admin_audit_log")
      .select("created_at,metadata")
      .eq("target_type", "admin_email_log")
      .eq("target_id", campaignId)
      .eq("action", "email_campaign_rescheduled")
      .order("created_at", { ascending: true })
      .limit(20),
    campaignEngagement(supabase, campaignId),
  ]);
  if (summaryResult.error) {
    throw new Error(`campaign_summary_failed:${summaryResult.error.message}`);
  }
  if (auditResult.error) {
    throw new Error(`campaign_history_failed:${auditResult.error.message}`);
  }
  const summary = (summaryResult.data ?? {}) as Partial<DeliverySummary>;
  const audits = (auditResult.data ?? []) as Array<
    { created_at: string; metadata: Record<string, unknown> | null }
  >;
  const names = await personLabels(supabase, [
    row.sent_by,
    row.cancelled_by,
    ...audits.map((audit) => audit.metadata?.actor_user_id),
  ]);
  const nameOf = (id: unknown) =>
    typeof id === "string" ? names.get(id) ?? null : null;

  const hasLedger = Number(summary.total ?? 0) > 0;
  const unsubscribed = Number(row.skipped_count ?? 0);
  const recipientCount = Number(row.recipient_count ?? 0);
  const byReason = Array.isArray(summary.by_reason) ? summary.by_reason : [];
  const campaignCode = campaignFailureCode(row.last_error as string | null);
  const failure = {
    summary_code: campaignCode ?? byReason[0]?.code ?? null,
    raw: (typeof row.last_error === "string" && row.last_error.trim()
      ? row.last_error.trim()
      : summary.raw ?? null)?.slice(0, 300) ?? null,
    by_reason: byReason,
  };
  const audience = row.audience && typeof row.audience === "object"
    ? (ctx.isAdmin
      ? row.audience
      : Object.fromEntries(
        Object.entries(row.audience as Record<string, unknown>).filter(([key]) =>
          key !== "email"
        ),
      ))
    : null;
  return {
    campaign: {
      id: row.id,
      subject: row.subject,
      state,
      state_label: label,
      raw_status: row.status,
      from: {
        name: row.from_name ?? ADMIN_SENDER.name,
        email: row.from_email ?? ADMIN_SENDER.address,
      },
      to_label: toLabelFor(row, ctx.isAdmin),
      recipient_type: row.recipient_type,
      audience,
      segment_filter: row.segment_filter ?? null,
      created_at: row.created_at,
      created_by_name: nameOf(row.sent_by),
      scheduled_for: row.scheduled_for ?? null,
      timezone: row.timezone ?? "UTC",
      started_at: row.started_at ?? null,
      completed_at: row.completed_at ?? null,
      cancelled_at: state === "cancelled" ? row.completed_at ?? null : null,
      cancelled_by_name: state === "cancelled" ? nameOf(row.cancelled_by) : null,
      rescheduled: audits.map((audit) => ({
        at: audit.created_at,
        by_name: nameOf(audit.metadata?.actor_user_id),
        scheduled_for: audit.metadata?.scheduled_for ?? null,
        timezone: audit.metadata?.timezone ?? null,
      })),
      can_change: state === "scheduled" && !row.processing_started_at,
    },
    counts: {
      matched: Number(row.matched_count ?? 0),
      internal: Number(row.internal_excluded_count ?? 0),
      no_consent: Number(row.no_consent_count ?? 0),
      unsubscribed,
      no_contact: Number(row.no_contact_count ?? 0),
      duplicate: Number(row.duplicate_count ?? 0),
      to_send: Math.max(recipientCount - unsubscribed, 0),
      accepted: hasLedger ? Number(summary.accepted ?? 0) : Number(row.sent_count ?? 0),
      failed: hasLedger ? Number(summary.failed ?? 0) : Number(row.failed_count ?? 0),
      pending: hasLedger ? Number(summary.pending ?? 0) : 0,
    },
    view,
    failure,
    engagement,
  };
}

/** #4419 Part B — what happened after the provider accepted it. Null on a failed read. */
async function campaignEngagement(supabase: ServiceClient, campaignId: string) {
  const { data, error } = await supabase.rpc("issue_4419_admin_email_engagement", {
    p_campaign_id: campaignId,
  });
  if (error) {
    console.error("[admin-send-email] engagement read failed", error.message);
    return null;
  }
  return data ?? null;
}

const TEST_SEND_LIMIT_PER_HOUR = 5;

/**
 * #4419 — "Send test to me": the caller's own address only, their own first
 * name, the exact copy's document when one exists (else the live preview),
 * "[Test] " in the subject, no delivery row, no unsubscribe header, five an
 * hour.
 */
export async function sendCampaignTest(
  supabase: ServiceClient,
  raw: Record<string, unknown>,
  ctx: { user: { id: string; email: string | null }; isAdmin: boolean },
  now = Date.now(),
) {
  const campaignId = campaignIdFrom(raw);
  const to = normalizedValidEmail(ctx.user.email);
  if (!to) throw new Error("test_send_address_missing");
  const { data, error } = await supabase
    .from("admin_email_log")
    .select("id,status,started_at,subject,body,body_document,rendered_at,rendered_document")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw new Error(`campaign_read_failed:${error.message}`);
  if (!data) throw new Error("campaign_not_found");
  const row = data as DetailRow;
  const { state } = campaignState({
    status: String(row.status ?? ""),
    started_at: (row.started_at as string | null) ?? null,
  });
  if (!ctx.isAdmin && state !== "scheduled") throw new Error("email_admin_only");

  const { count, error: countError } = await supabase
    .from("admin_audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "email_campaign_test_sent")
    .eq("metadata->>actor_user_id", ctx.user.id)
    .gte("created_at", new Date(now - 3_600_000).toISOString());
  if (countError) throw new Error(`test_send_count_failed:${countError.message}`);
  if ((count ?? 0) >= TEST_SEND_LIMIT_PER_HOUR) throw new Error("test_send_limit");
  if (!RESEND_API_KEY) throw new Error("NO_PROVIDER");

  let document: EmailContentBlock[];
  if (row.rendered_at && row.rendered_document) {
    document = storedRenderedDocument(row.rendered_document);
  } else {
    const reference = validateDocument(
      row.body_document ?? legacyBodyDocument(String(row.body ?? "")),
    );
    document = (await resolveBlogPostBlocks(supabase, reference, SUPABASE_URL)).document;
  }
  const { data: person } = await supabase
    .rpc("admin_people_directory")
    .select(DIRECTORY_COLUMNS)
    .eq("user_id", ctx.user.id)
    .limit(1)
    .maybeSingle();
  const profile: RecipientProfile = person
    ? { ...directoryRowToRecipient(person as DirectoryRow), email: to }
    : { email: to, first_name: SAMPLE_RECIPIENT.first_name };
  const copy = renderCampaignEmail(String(row.subject ?? ""), document, profile, to);
  assertNotResendSandbox(ADMIN_SENDER);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `admin-email-test-${campaignId}-${ctx.user.id}-${
        Math.floor(now / 60_000)
      }`,
    },
    body: JSON.stringify({
      from: formatSenderHeader(copy.from),
      reply_to: ADMIN_REPLY_TO,
      to: [to],
      subject: `[Test] ${copy.subject}`,
      html: copy.html,
      text: copy.text,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`test_send_failed:Resend ${response.status}: ${detail}`);
  }
  await auditCampaignChange(
    supabase,
    { id: ctx.user.id, email: ctx.user.email },
    "email_campaign_test_sent",
    campaignId,
    { from_snapshot: Boolean(row.rendered_at) },
  );
  return { sent: true, to };
}

/** Is the signed-in caller an active Mingla team member? Fails closed. */
export async function isActiveTeammate(
  userClient: { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> },
): Promise<boolean> {
  try {
    const { data, error } = await userClient.rpc("admin_team_role");
    return !error && typeof data === "string" &&
      ["owner", "admin", "partner", "growth"].includes(data);
  } catch (_err) {
    return false;
  }
}

export async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return jsonResponse({ error: "No authorization header" }, 401);
    }
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "process_due" && token === SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse(await processDueCampaign(supabase));
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      token,
    );
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);
    // #4255 (D5): everyone on the team can write and send email. The caller's
    // own client asks the database, so this is the same "active teammate"
    // answer every Admin page uses (owner, admin, partner or growth).
    if (!(await isActiveTeammate(userSupabase))) {
      return jsonResponse({ error: "Forbidden: team access required" }, 403);
    }

    if (action === "check_provider") {
      return jsonResponse({
        provider: "resend",
        configured: Boolean(RESEND_API_KEY),
        from_domain: ADMIN_SENDER.address,
        from: formatSenderHeader(ADMIN_SENDER),
        reply_to: ADMIN_REPLY_TO,
      });
    }
    if (action === "metadata") {
      // #4226: options come from the same people list the audiences read,
      // so ticket buyers' countries, event cities and brands are offered.
      const rows = (await loadDirectoryRows(supabase, null)).filter((row) =>
        row.is_internal !== true
      );
      const countries = [
        ...new Set(
          rows.map((row) => row.country?.trim().toUpperCase()).filter(
            Boolean,
          ),
        ),
      ].sort();
      const languages = [
        ...new Set(
          rows.map((row) => row.preferred_language?.trim().toLowerCase())
            .filter(Boolean),
        ),
      ].sort();
      const cities = [
        ...new Set(
          rows.flatMap((row) => row.event_cities ?? []).map((city) =>
            city.trim()
          ).filter(Boolean),
        ),
      ].sort((left, right) => left.localeCompare(right));
      const brands = new Map<string, string>();
      for (const row of rows) {
        for (const brand of row.brands ?? []) {
          if (brand?.id && !brands.has(brand.id)) {
            brands.set(brand.id, brand.name);
          }
        }
      }
      return jsonResponse({
        countries: countries.map((value) => ({
          value,
          label: fallbackPersonalization({ email: null, country: value })
            .country,
        })),
        languages: languages.map((value) => ({
          value,
          label: fallbackPersonalization({
            email: null,
            preferred_language: value,
          }).language,
        })),
        cities: cities.map((value) => ({ value, label: value })),
        brands: [...brands.entries()]
          .map(([value, label]) => ({ value, label }))
          .sort((left, right) => left.label.localeCompare(right.label)),
      });
    }

    if (action === "search_recipients") {
      const term = typeof body.term === "string" ? body.term.trim() : "";
      if (term.length < 2) return jsonResponse({ recipients: [] });
      const pattern = `%${
        term.replace(/[\\%_]/g, "\\$&").replace(/[(),]/g, "")
      }%`;
      const { data: matches, error: searchError } = await supabase
        .rpc("admin_people_directory")
        .select(DIRECTORY_COLUMNS)
        .or(
          `email.ilike.${pattern},name.ilike.${pattern},username.ilike.${pattern}`,
        )
        .order("name", { ascending: true, nullsFirst: false })
        .limit(12);
      if (searchError) {
        throw new Error(`recipient_search_failed:${searchError.message}`);
      }
      const suppressed = await loadSuppressedEmails(supabase);
      return jsonResponse({
        recipients: ((matches ?? []) as DirectoryRow[]).map((row) => {
          const profile = directoryRowToRecipient(row);
          const email = normalizedValidEmail(profile.email);
          const values = fallbackPersonalization(profile);
          const exclusion = !email ? "No valid email" : suppressed.has(email) ||
              profile.marketing_consent === "unsubscribed"
            ? "Unsubscribed"
            : requiresMarketingConsent({ mode: "person" }, profile) &&
                profile.marketing_consent !== "yes"
            ? "Didn't agree to marketing email"
            : null;
          return {
            profile_id: profile.id,
            display_name: values.display_name,
            username: values.username,
            email,
            account_type: appStatusLabel(row.app_status),
            country: values.country,
            eligible: exclusion === null,
            exclusion,
          };
        }),
      });
    }

    if (action === "estimate") {
      const segment = body.segment as Record<string, unknown> | undefined;
      if (segment) {
        const unsupported = assertSupportedSegment(segment);
        if (unsupported) return jsonResponse({ error: unsupported }, 400);
      }
      const audience = segment
        ? legacySegmentAudience(segment)
        : normalizeAudience(body.audience);
      const recipients = await loadAudienceProfiles(supabase, audience);
      const suppressed = await loadSuppressedEmails(supabase);
      const snapshot = snapshotFor(recipients, suppressed, audience);
      return jsonResponse({
        matched: snapshot.matched,
        total: snapshot.matched,
        opted_out: snapshot.skippedOptOut,
        no_contact: snapshot.noContact,
        duplicate: snapshot.duplicate,
        // #4226: left out, by reason.
        no_consent: snapshot.noConsent,
        internal: snapshot.internalExcluded,
        will_receive: snapshot.willReceive,
        // #4226: who will receive, by group (explorer, host, both,
        // incomplete, ticket_buyer_no_app, host_contact_no_app).
        groups: snapshot.byGroup,
      });
    }

    if (action === "blog_posts") {
      const query = typeof body.query === "string"
        ? body.query.slice(0, 100)
        : "";
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((value): value is string =>
          typeof value === "string" && UUID_PATTERN.test(value)
        ).slice(0, 20)
        : [];
      let staffPosts: any[] = [];
      if (!ids.length) {
        const { data, error } = await userSupabase.rpc(
          "issue_4137_blog_list_posts",
          { p_status: null, p_query: query || null, p_limit: 20, p_offset: 0 },
        );
        if (error) {
          throw new BlogPostBlockError(
            /42P01|PGRST20[245]|does not exist/i.test(
                `${error.code ?? ""} ${error.message ?? ""}`,
              )
              ? "blog_not_ready"
              : "blog_post_query_failed",
            error.message,
          );
        }
        staffPosts = Array.isArray(data?.posts) ? data.posts : [];
      }
      return jsonResponse({
        posts: await listBlogPostOptions(supabase, {
          query,
          ids,
          staffPosts,
          supabaseUrl: SUPABASE_URL,
        }),
      });
    }

    if (action === "preview") {
      const subject = typeof body.subject === "string" && body.subject.trim()
        ? body.subject.trim()
        : "Your Mingla update";
      const document = validateDocument(
        body.document ??
          legacyBodyDocument(String(body.body ?? "Preview content")),
      );
      assertSupportedPersonalization(subject, document);
      const resolvedBlog = await resolveBlogPostBlocks(
        supabase,
        document,
        SUPABASE_URL,
      );
      // #4419: the same sample and the same render as the exact copy.
      const sample = {
        ...SAMPLE_RECIPIENT,
        ...(body.sampleProfile && typeof body.sampleProfile === "object"
          ? body.sampleProfile
          : {}),
      } as RecipientProfile;
      const rendered = renderCampaignEmail(subject, resolvedBlog.document, sample);
      return jsonResponse({
        html: rendered.html,
        text: rendered.text,
        subject: rendered.subject,
        preheader: rendered.preheader,
      });
    }

    if (action === "create_campaign") {
      return jsonResponse({
        campaign: await createCampaign(supabase, user.id, body),
      }, 201);
    }

    // #4383: change a scheduled email's time or words before it starts.
    if (action === "get_scheduled_campaign") {
      return jsonResponse({ campaign: await getScheduledCampaign(supabase, body) });
    }
    if (action === "reschedule_campaign") {
      return jsonResponse({ campaign: await rescheduleCampaign(supabase, body, Date.now(), { id: user.id, email: user.email ?? null }) });
    }
    if (action === "update_scheduled_campaign") {
      return jsonResponse({ campaign: await updateScheduledCampaign(supabase, body, { id: user.id, email: user.email ?? null }) });
    }

    if (action === "cancel_campaign") {
      return jsonResponse({
        campaign: await cancelCampaign(supabase, body, {
          id: user.id,
          email: user.email ?? null,
        }),
      });
    }

    // #4419: the Emails tab and its detail page, and a test to yourself.
    if (action === "list_campaigns") {
      return jsonResponse(
        await listCampaigns(supabase, body, {
          isAdmin: await isAdminCaller(userSupabase),
        }),
      );
    }
    if (action === "get_campaign_detail") {
      return jsonResponse(
        await getCampaignDetail(supabase, body, {
          isAdmin: await isAdminCaller(userSupabase),
        }),
      );
    }
    if (action === "send_test") {
      return jsonResponse(
        await sendCampaignTest(supabase, body, {
          user: { id: user.id, email: user.email ?? null },
          isAdmin: await isAdminCaller(userSupabase),
        }),
      );
    }

    // Compatibility for the previous Admin client: both old actions now enter
    // the same unlimited, durable campaign lane and never bypass suppressions.
    if (action === "send" || action === "send_bulk") {
      const segment = body.segment as Record<string, unknown> | undefined;
      if (action === "send_bulk") {
        const unsupported = assertSupportedSegment(segment);
        if (unsupported) return jsonResponse({ error: unsupported }, 400);
      }
      let audience: AudienceDefinition;
      if (action === "send") {
        const email = String(body.to ?? "").toLowerCase().trim();
        const { data: person, error: personError } = await supabase
          .rpc("admin_people_directory")
          .select("user_id,email")
          .eq("email", email)
          .limit(1)
          .maybeSingle();
        if (personError || !person) {
          throw new Error("recipient_profile_invalid");
        }
        audience = person.user_id
          ? { mode: "person", profileId: person.user_id }
          : { mode: "person", email: person.email };
      } else {
        audience = legacySegmentAudience(segment);
      }
      const campaign = await createCampaign(supabase, user.id, {
        ...body,
        audience,
      });
      return jsonResponse({
        sent: 0,
        failed: 0,
        queued: campaign.will_receive,
        skipped_opt_out: campaign.skipped_opt_out,
        campaign_id: campaign.id,
      });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, errorStatus(error));
  }
}

/** The HTTP status for a thrown error (#4419: email_admin_only is 403; not_found and the test-send limit are 400). */
export function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof BlogPostBlockError && error.code === "blog_not_ready"
    ? 503
    : /email_admin_only/.test(message)
    ? 403
    : /invalid|required|unsupported|not_cancellable|not_reschedulable|time_past|email_block|email_document|recipient_email|no_eligible|not_found|test_send_limit|test_send_address/
        .test(message)
    ? 400
    : 500;
}

if (import.meta.main) serve(handler);
