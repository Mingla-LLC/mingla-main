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
  documentPlainText,
  fallbackPersonalization,
  legacyBodyDocument,
  normalizeAudience,
  normalizedValidEmail,
  personalizeDocument,
  personalizeText,
  type RecipientProfile,
  snapshotAudience,
  validateDocument,
  versionedDocument,
} from "./model.ts";
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

const ADMIN_SENDER: SenderIdentity = {
  name: "Mingla",
  address: "hello@usemingla.com",
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
 * mean the same thing here as there and ticket buyers with no account can be
 * reached. Filters live in ./audience.ts.
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

async function sendViaResend(input: {
  deliveryId: string;
  campaignId: string;
  to: string;
  subject: string;
  document: ReturnType<typeof validateDocument>;
  profile: RecipientProfile;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    assertNotResendSandbox(ADMIN_SENDER);
    const subject = personalizeText(input.subject, input.profile);
    const document = personalizeDocument(input.document, input.profile);
    const rendered = renderTransactionalEmail({
      variant: "admin_compose",
      recipient: { name: input.profile.first_name ?? null, email: input.to },
      body: {
        variant: "admin_compose",
        title: subject,
        paragraphs: [],
        document,
      },
      sender: ADMIN_SENDER,
    });
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

export async function createCampaign(
  supabase: ServiceClient,
  userId: string,
  raw: Record<string, unknown>,
) {
  if (!RESEND_API_KEY) throw new Error("NO_PROVIDER");
  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  if (!subject || subject.length > 998 || /[\r\n]/.test(subject)) {
    throw new Error("email_subject_invalid");
  }
  if (!raw.audience || typeof raw.audience !== "object") {
    throw new Error("audience_required");
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
      body: documentPlainText(resolvedBlog.document),
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
  const document = resolvedBlog.document;
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
    const { data: adminRow } = await supabase.from("admin_users")
      .select("id")
      .eq("email", user.email)
      .eq("status", "active")
      .maybeSingle();
    if (!adminRow) {
      return jsonResponse({ error: "Forbidden: admin access required" }, 403);
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
      const sample = {
        email: "member@example.com",
        first_name: "Maya",
        display_name: "Maya Okafor",
        username: "mayaexplores",
        // orch-strict-grep-allow stripe-country-out-of-scope — recipient preview country, unrelated to Stripe account availability
        country: "NG",
        preferred_language: "en",
        created_at: "2026-01-15T12:00:00.000Z",
        ...(body.sampleProfile && typeof body.sampleProfile === "object"
          ? body.sampleProfile
          : {}),
      } as RecipientProfile;
      const rendered = renderTransactionalEmail({
        variant: "admin_compose",
        recipient: {
          name: sample.first_name ?? null,
          email: sample.email ?? "member@example.com",
        },
        body: {
          variant: "admin_compose",
          title: personalizeText(subject, sample),
          paragraphs: [],
          document: personalizeDocument(resolvedBlog.document, sample),
        },
        sender: ADMIN_SENDER,
      });
      return jsonResponse({
        html: rendered.html,
        text: rendered.text,
        subject: rendered.subject,
      });
    }

    if (action === "create_campaign") {
      return jsonResponse({
        campaign: await createCampaign(supabase, user.id, body),
      }, 201);
    }

    if (action === "cancel_campaign") {
      const campaignId = typeof body.campaignId === "string"
        ? body.campaignId.trim()
        : "";
      if (!UUID_PATTERN.test(campaignId)) {
        throw new Error("campaign_id_invalid");
      }
      const { data: campaign, error: cancelError } = await supabase
        .from("admin_email_log")
        .update({ status: "cancelled", completed_at: new Date().toISOString() })
        .eq("id", campaignId)
        .in("status", ["scheduled", "queued"])
        .is("processing_started_at", null)
        .select("id,status")
        .maybeSingle();
      if (cancelError) {
        throw new Error(`campaign_cancel_failed:${cancelError.message}`);
      }
      if (!campaign) throw new Error("campaign_not_cancellable");
      return jsonResponse({ campaign });
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
    const status =
      error instanceof BlogPostBlockError && error.code === "blog_not_ready"
        ? 503
        : /invalid|required|unsupported|not_cancellable|email_block|email_document|recipient_email|no_eligible/
            .test(message)
        ? 400
        : 500;
    return jsonResponse({ error: message }, status);
  }
}

if (import.meta.main) serve(handler);
