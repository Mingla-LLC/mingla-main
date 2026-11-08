import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import {
  dispatchV2,
  type DispatchV2Input,
  type DispatchV2Result,
  type MinimalClient,
} from "../_shared/notifyV2.ts";
import {
  buildOfferingExecutionSnapshot,
  hashOfferingSelection,
  offeringUnpricedSmsCount,
  type PersistedOfferingPushV1,
  type QuoteCandidateRow,
} from "../_shared/offeringInviteQuote.ts";
import {
  OfferingInviteTokenPepperError,
  resolveOfferingInviteTokenPepper,
} from "../_shared/offeringInviteToken.ts";
import {
  resolveAlertRecipientValue,
  resolveDeliveryFlagValue,
} from "../_shared/secretBundle.ts";
import { MAPPED_COUNTRIES } from "../_shared/e164Country.ts";
import { smsCountryTextableNow } from "../_shared/smsPriceBook.ts";
import { loadSmsRates } from "../_shared/smsPriceTable.ts";
import {
  type OpsAlertEmailInput,
  type OpsAlertEmailResult,
  sendOpsAlertEmail,
} from "../_shared/stripeOpsAlertEmail.ts";

type Channel = "email" | "push" | "sms";
interface DispatchBody {
  eventId: string;
  purpose: "invitation" | "reminder" | "retry_delivery";
  selection: Record<string, unknown> & {
    kind:
      | "all_brand_people"
      | "invited_people"
      | "resolved_brand_people_v1"
      | "failed_attempts_v1";
  };
  channels: Channel[];
  clientRequestId: string;
  mode: "preview" | "confirm";
  quoteHash?: string;
  expectedCostMinor?: number;
  currency?: string | null;
  content?: {
    subject?: string;
    bodyHtml?: string;
    bodyText?: string;
    body?: string;
    pushTitle?: string;
    pushBody?: string;
  };
}

interface WizardWorkerBody {
  mode: "wizard_worker";
}

interface WizardPreviewBody {
  mode: "wizard_preview";
  eventId: string;
  selectionRevision: number;
}

interface WizardOutboxJob {
  outboxJobId: string;
  sealedSelectionId: string;
  eventId: string;
  eventType: "event" | "rsvp" | "experience" | "trip";
  actorId: string;
  brandPersonIds: string[];
  /** #3682 wave 2 — followers (not in Your Book) invited by account. */
  accountRecipientCount?: number;
  /**
   * #4273 — the methods the host ticked ("How to reach them"), sealed at
   * publish. null/absent = automatic (every live method), as before.
   */
  deliveryChannels?: Channel[] | null;
  selectionHash: string;
  selectionRevision: number;
  leaseToken: string;
  attemptCount: number;
  executionSealed: boolean;
  sealedQueuedCount: number | null;
  committedGroupId: string | null;
  committedChannels: Array<"email" | "sms" | "push"> | null;
}

interface WizardObservabilityEvent {
  eventOccurrenceId: number;
  eventName: "wizard_invite_outbox_enqueued";
  offeringKind: "event" | "rsvp" | "experience" | "trip";
  selectionRevision: number;
  selectedCount: number;
  jobState: string;
  leaseToken: string;
}

interface WizardHealthAlert {
  signalKey:
    | "expired_lease"
    | "retry_backlog_age"
    | "terminal_failure_rate"
    | "duplicate_constraint"
    | "publish_without_job"
    | "provider_attempt_dispatch_disabled";
  occurrenceCount: number;
  firstDetectedAt: string;
  notificationToken: string;
}

// The repository does not generate Database types for Edge clients. Pin the
// intentionally dynamic service client once instead of letting createClient's
// empty-schema inference collapse every new RPC/table to `never`.
type WizardServiceClient = ReturnType<typeof createClient<any, any, any>>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const cors = {
  ...corsHeaders,
  "content-type": "application/json",
  "cache-control": "no-store",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isWizardWorkerBody(value: unknown): value is WizardWorkerBody {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    exactKeys(value as Record<string, unknown>, ["mode"]) &&
    (value as Record<string, unknown>).mode === "wizard_worker";
}

function isWizardPreviewBody(value: unknown): value is WizardPreviewBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const body = value as Record<string, unknown>;
  return exactKeys(body, ["eventId", "mode", "selectionRevision"]) &&
    body.mode === "wizard_preview" && typeof body.eventId === "string" &&
    UUID.test(body.eventId) && Number.isSafeInteger(body.selectionRevision) &&
    (body.selectionRevision as number) >= 0;
}

function deliveryFlagEnabled(
  field: "marketing_send_live_enabled",
  legacyName: "MARKETING_SEND_LIVE_ENABLED",
): boolean {
  const value = resolveDeliveryFlagValue(field, legacyName);
  return typeof value === "boolean" ? value : value === "true" || value === "1";
}

function currentWizardDeliveryPolicy(): {
  channels: Channel[];
} {
  const marketing = deliveryFlagEnabled(
    "marketing_send_live_enabled",
    "MARKETING_SEND_LIVE_ENABLED",
  );
  // #4273 — one SMS switch per country. SMS is offered when any country is
  // switched on; a number in a switched-off country is then skipped by the
  // quote itself ("can't text their country yet"), never priced.
  const anySmsCountry = MAPPED_COUNTRIES.some((country) =>
    smsCountryTextableNow(country)
  );
  return {
    channels: [
      ...(marketing ? ["email" as const] : []),
      "push" as const,
      ...(marketing && anySmsCountry ? ["sms" as const] : []),
    ].sort() as Channel[],
  };
}

/**
 * #4273 — the wizard's Book-lane methods: the live delivery policy narrowed to
 * the methods the host ticked. A plan with no stored methods (null) keeps the
 * automatic behaviour. May be empty when every ticked method is switched off.
 */
export function wizardChannelsFor(
  policyChannels: Channel[],
  chosen: unknown,
): Channel[] {
  if (chosen === null || chosen === undefined) return [...policyChannels];
  if (!Array.isArray(chosen)) throw new Error("wizard_invite_methods_invalid");
  const picked = new Set(chosen);
  return policyChannels.filter((channel) => picked.has(channel));
}

function observeWizardInvite(
  event: string,
  properties: Record<string, string | number | boolean | null>,
): void {
  // Aggregate-only structured logs. Never add person/group IDs, destinations,
  // search text, message bodies, or provider payloads here.
  console.info(JSON.stringify({ event, ...properties }));
}

function wizardInviteAlertRecipients(): string[] {
  const configured = resolveAlertRecipientValue(
    "api_health",
    "API_HEALTH_ALERT_EMAILS",
  );
  if (Array.isArray(configured)) return configured;
  return (configured ?? "seth@usemingla.com").split(",").map((value) =>
    value.trim()
  ).filter(Boolean);
}

export async function drainWizardInviteObservability(
  service: WizardServiceClient,
): Promise<number> {
  try {
    const { data, error } = await service.rpc(
      "issue_1780_claim_wizard_invite_observability_v1",
      { p_limit: 25 },
    );
    if (error) throw new Error("observability_claim_failed");
    let emitted = 0;
    for (const row of (data ?? []) as WizardObservabilityEvent[]) {
      if (
        row.eventName !== "wizard_invite_outbox_enqueued" ||
        !Number.isSafeInteger(row.eventOccurrenceId) ||
        !Number.isSafeInteger(row.selectionRevision) ||
        !Number.isSafeInteger(row.selectedCount) ||
        typeof row.leaseToken !== "string" || !UUID.test(row.leaseToken)
      ) {
        continue;
      }
      observeWizardInvite(row.eventName, {
        offering_kind: row.offeringKind,
        selection_revision: row.selectionRevision,
        selected_count: row.selectedCount,
        job_state: row.jobState,
      });
      const { error: completionError } = await service.rpc(
        "issue_1780_complete_wizard_invite_observability_v1",
        {
          p_event_occurrence_id: row.eventOccurrenceId,
          p_lease_token: row.leaseToken,
        },
      );
      if (!completionError) emitted += 1;
    }
    return emitted;
  } catch {
    console.warn("[wizard-invite] aggregate observability drain unavailable");
    return 0;
  }
}

const WIZARD_HEALTH_LABELS: Record<WizardHealthAlert["signalKey"], string> = {
  expired_lease: "Jobs stuck past lease expiry",
  retry_backlog_age: "Retry backlog is aging",
  terminal_failure_rate: "Terminal failure rate is elevated",
  duplicate_constraint: "Duplicate constraint violations detected",
  publish_without_job: "Published invite plans are missing jobs",
  provider_attempt_dispatch_disabled:
    "Provider attempts were created while dispatch was disabled",
};

export async function drainWizardInviteHealthAlerts(
  service: WizardServiceClient,
  send: (input: OpsAlertEmailInput) => Promise<OpsAlertEmailResult> =
    sendOpsAlertEmail,
): Promise<number> {
  try {
    const { data, error } = await service.rpc(
      "issue_1780_claim_wizard_invite_health_v1",
    );
    if (error) throw new Error("health_claim_failed");
    let sent = 0;
    for (const row of (data ?? []) as WizardHealthAlert[]) {
      const label = WIZARD_HEALTH_LABELS[row.signalKey];
      if (
        label === undefined || !Number.isSafeInteger(row.occurrenceCount) ||
        row.occurrenceCount < 1 || typeof row.firstDetectedAt !== "string" ||
        typeof row.notificationToken !== "string" ||
        !UUID.test(row.notificationToken)
      ) {
        continue;
      }
      const result = await send({
        subject: `⚠️ [WIZARD INVITES] ${label}`,
        paragraphs: [
          `${label}.`,
          `Current aggregate count: ${row.occurrenceCount}.`,
          `First detected at ${row.firstDetectedAt} UTC.`,
        ],
        recipients: wizardInviteAlertRecipients(),
        cta: null,
      });
      if (result.succeeded < 1) continue;
      const { error: completionError } = await service.rpc(
        "issue_1780_complete_wizard_invite_health_alert_v1",
        {
          p_signal_key: row.signalKey,
          p_notification_token: row.notificationToken,
        },
      );
      if (!completionError) sent += 1;
    }
    return sent;
  } catch {
    console.warn("[wizard-invite] aggregate health alert drain unavailable");
    return 0;
  }
}

export function resolveWizardQuoteCurrency(
  estimatedCostMinor: number,
  snapshotCurrency: string | null,
  offeringCurrency: unknown,
): string {
  if (
    typeof offeringCurrency !== "string" || !/^[A-Z]{3}$/.test(offeringCurrency)
  ) {
    throw new Error("wizard_invite_currency_unavailable");
  }
  if (estimatedCostMinor === 0) return offeringCurrency;
  if (snapshotCurrency === null || !/^[A-Z]{3}$/.test(snapshotCurrency)) {
    throw new Error("wizard_invite_currency_unavailable");
  }
  if (snapshotCurrency !== offeringCurrency) {
    throw new Error("wizard_invite_currency_mismatch");
  }
  return snapshotCurrency;
}

async function dispatchCommittedWizardGroup(
  service: WizardServiceClient,
  url: string,
  serviceKey: string,
  group: { groupId: string; campaignIds: string[] },
  channels: Channel[],
): Promise<boolean> {
  const ambiguous = await handOffOfferingGroupProviders(
    service,
    url,
    serviceKey,
    group,
    channels,
  );
  const intendedStatus = ambiguous ? "partial" : "running";
  // A previous ambiguous handoff leaves the group partial. A reclaimed
  // outbox lease resumes the same group/campaign operation keys and may
  // reconcile partial back to running without creating a second group.
  const eligibleStatuses = ["queued", "running", "partial"];
  const { data: updatedGroup, error: groupUpdateError } = await service.from(
    "marketing_send_groups",
  ).update({ status: intendedStatus, started_at: new Date().toISOString() })
    .eq("id", group.groupId).in("status", eligibleStatuses).select("status")
    .maybeSingle();
  if (!groupUpdateError && updatedGroup?.status !== undefined) {
    return !ambiguous;
  }
  return false;
}

type AccountInviteDispatch = (
  client: MinimalClient,
  input: DispatchV2Input,
) => Promise<DispatchV2Result>;

interface AccountInviteWork {
  deliveryId: string;
  userId: string;
  ring: "follower" | "extended";
  channel: "push" | "email";
  email: string | null;
}

interface AccountInviteContext {
  brandName: string | null;
  brandSlug: string | null;
  eventTitle: string | null;
  eventSlug: string | null;
}

function publicOfferingOrigin(): string {
  return (Deno.env.get("BUSINESS_WEB_ORIGIN") ??
    Deno.env.get("MINGLA_PUBLIC_APP_ORIGIN") ?? "https://mingla.app")
    .replace(/\/+$/, "");
}

/**
 * #3682 wave 2 — the public link an account invite opens. Explorer routes the
 * same `/e/{brand}/{event}` (or `/b/{brand}`) path to its own screen.
 */
export function accountInviteLink(
  context: AccountInviteContext,
  origin = publicOfferingOrigin(),
): string | null {
  const slug = /^[a-z0-9][a-z0-9-]{0,119}$/i;
  const brand = context.brandSlug ?? "";
  const event = context.eventSlug ?? "";
  if (!slug.test(brand)) return null;
  return slug.test(event)
    ? `${origin}/e/${encodeURIComponent(brand)}/${encodeURIComponent(event)}`
    : `${origin}/b/${encodeURIComponent(brand)}`;
}

/**
 * Decide-and-send for account-only invite recipients. The SQL builder makes
 * every send-time decision (unfollow, mute, channel prefs, Book dedupe, email
 * cap) and returns only queued work; each item is reported back so a retry
 * never sends it twice. Email addresses exist only inside this function.
 */
export async function runWizardAccountInvites(
  service: WizardServiceClient,
  job: WizardOutboxJob,
  dispatch: AccountInviteDispatch = dispatchV2,
): Promise<{ sent: number; skipped: number; failed: number }> {
  const { data, error } = await service.rpc(
    "issue_3682_build_wizard_account_invites_v1",
    {
      p_outbox_job_id: job.outboxJobId,
      p_sealed_selection_id: job.sealedSelectionId,
      p_lease_token: job.leaseToken,
    },
  );
  if (error) throw new Error("account_invite_build_failed");
  const built = data as { context: AccountInviteContext; work: AccountInviteWork[] };
  const link = accountInviteLink(built.context ?? {} as AccountInviteContext);
  const totals = { sent: 0, skipped: 0, failed: 0 };
  for (const item of built.work ?? []) {
    let state: "sent" | "skipped" | "failed" = "failed";
    let reason = "provider_failed";
    if (item.channel === "email" && !item.email) {
      state = "skipped";
      reason = "channel_unavailable";
    } else {
      try {
        const result = await dispatch(service as unknown as MinimalClient, {
          user_id: item.userId,
          contact: item.channel === "email" ? item.email : null,
          category_key: "brand_offering_invite",
          payload: {
            brand_name: built.context?.brandName ?? "Mingla",
            event_title: built.context?.eventTitle ?? "",
            reason: item.ring,
            brand_slug: built.context?.brandSlug ?? null,
            event_slug: built.context?.eventSlug ?? null,
            ...(link ? { event_url: link } : {}),
          },
          deep_link: link,
          idempotency_key:
            `wizard-account-invite:${job.outboxJobId}:${item.userId}`,
          requested_channel: item.channel,
        });
        const delivery = result.deliveries?.find((row) =>
          row.channel === item.channel
        );
        if (
          result.success && delivery &&
          ["sent", "delivered"].includes(delivery.status)
        ) {
          state = "sent";
          reason = "delivered";
        } else if (
          result.success && delivery &&
          ["suppressed", "skipped"].includes(delivery.status)
        ) {
          state = "skipped";
          reason = delivery.status === "suppressed"
            ? "can_send_denied"
            : "channel_unavailable";
        }
      } catch {
        state = "failed";
        reason = "provider_failed";
      }
    }
    const { error: recordError } = await service.rpc(
      "issue_3682_record_wizard_account_invite_v1",
      {
        p_outbox_job_id: job.outboxJobId,
        p_lease_token: job.leaseToken,
        p_delivery_id: item.deliveryId,
        p_state: state,
        p_reason: reason,
      },
    );
    if (recordError) throw new Error("account_invite_record_failed");
    totals[state] += 1;
  }
  return totals;
}

export async function handleWizardWorker(
  service: WizardServiceClient,
  url: string,
  serviceKey: string,
  accountDispatch: AccountInviteDispatch = dispatchV2,
): Promise<Response> {
  // Both drains read only durable rows committed by earlier transactions.
  // This prevents rolled-back publisher work from appearing as an enqueue.
  const observabilityEmitted = await drainWizardInviteObservability(service);
  const healthAlertsSent = await drainWizardInviteHealthAlerts(service);
  const { data, error } = await service.rpc(
    "issue_1780_claim_wizard_invite_outbox_v1",
    { p_limit: 10 },
  );
  if (error) {
    return json(
      {
        error: "wizard_worker_claim_failed",
        providerIo: false,
        observabilityEmitted,
        healthAlertsSent,
      },
      503,
    );
  }
  const jobs = (data ?? []) as WizardOutboxJob[];
  const outcomes: Array<Record<string, unknown>> = [];
  const policy = currentWizardDeliveryPolicy();
  for (const job of jobs) {
    let providerIo = false;
    try {
      observeWizardInvite("wizard_invite_outbox_claimed", {
        offering_kind: job.eventType,
        selection_revision: job.selectionRevision,
        attempt_count: job.attemptCount,
      });
      // #3682 wave 2 — account-only recipients first (idempotent per item),
      // then the unchanged sealed Book lane.
      if ((job.accountRecipientCount ?? 0) > 0) {
        providerIo = true;
        const account = await runWizardAccountInvites(
          service,
          job,
          accountDispatch,
        );
        observeWizardInvite("wizard_invite_account_lane_done", {
          offering_kind: job.eventType,
          selection_revision: job.selectionRevision,
          sent: account.sent,
          skipped: account.skipped,
          failed: account.failed,
        });
        if (job.brandPersonIds.length === 0) {
          const { error: accountCompletionError } = await service.rpc(
            "issue_3682_complete_wizard_account_outbox_v1",
            {
              p_outbox_job_id: job.outboxJobId,
              p_sealed_selection_id: job.sealedSelectionId,
              p_lease_token: job.leaseToken,
            },
          );
          if (accountCompletionError) {
            throw new Error("account_invite_completion_failed");
          }
          observeWizardInvite("wizard_invite_outbox_succeeded", {
            offering_kind: job.eventType,
            selection_revision: job.selectionRevision,
            job_state: "succeeded",
            attempt_count: job.attemptCount,
          });
          outcomes.push({
            outboxJobId: job.outboxJobId,
            status: "succeeded",
            providerIo,
          });
          continue;
        }
      }
      let channels = wizardChannelsFor(policy.channels, job.deliveryChannels);
      const selection = {
        kind: "resolved_brand_people_v1" as const,
        source: "guest_roster_actions",
        brandPersonIds: job.brandPersonIds,
        selectionHash: job.selectionHash,
      };
      let group: { groupId: string; campaignIds: string[] };
      if (
        channels.length === 0 && !job.executionSealed &&
        job.committedGroupId === null
      ) {
        // #4273 — every method the host ticked is switched off right now, so
        // the Book lane has nothing it may use. Nothing is sent by a method
        // the host did not pick.
        const { error: noMethodsError } = await service.rpc(
          "issue_4273_complete_wizard_invite_outbox_no_methods_v1",
          {
            p_outbox_job_id: job.outboxJobId,
            p_sealed_selection_id: job.sealedSelectionId,
            p_lease_token: job.leaseToken,
          },
        );
        if (noMethodsError) throw new Error("no_methods_completion_failed");
        observeWizardInvite("wizard_invite_outbox_succeeded", {
          offering_kind: job.eventType,
          selection_revision: job.selectionRevision,
          selected_count: job.brandPersonIds.length,
          can_receive: 0,
          skipped: job.brandPersonIds.length,
          job_state: "succeeded",
          attempt_count: job.attemptCount,
        });
        outcomes.push({
          outboxJobId: job.outboxJobId,
          status: "succeeded_no_methods",
          providerIo,
        });
        continue;
      }
      if (
        job.executionSealed && job.sealedQueuedCount === 0 &&
        job.committedGroupId === null
      ) {
        const { error: completionError } = await service.rpc(
          "issue_1780_complete_wizard_invite_outbox_no_recipients_v1",
          {
            p_outbox_job_id: job.outboxJobId,
            p_sealed_selection_id: job.sealedSelectionId,
            p_lease_token: job.leaseToken,
          },
        );
        if (completionError) {
          throw new Error("zero_reachable_completion_failed");
        }
        observeWizardInvite("wizard_invite_outbox_succeeded", {
          offering_kind: job.eventType,
          selection_revision: job.selectionRevision,
          selected_count: job.brandPersonIds.length,
          can_receive: 0,
          skipped: job.brandPersonIds.length,
          job_state: "succeeded",
          attempt_count: job.attemptCount,
        });
        outcomes.push({
          outboxJobId: job.outboxJobId,
          status: "succeeded_no_recipients",
          providerIo: false,
        });
        continue;
      }
      if (job.committedGroupId !== null) {
        channels = job.committedChannels ?? channels;
        const { data: campaignRows, error: campaignError } = await service.from(
          "marketing_send_group_campaigns",
        ).select("campaign_id").eq("send_group_id", job.committedGroupId);
        if (campaignError) throw new Error("resume_group_failed");
        group = {
          groupId: job.committedGroupId,
          campaignIds: (campaignRows ?? []).map((
            row: { campaign_id: string },
          ) => row.campaign_id),
        };
      } else {
        if (!job.executionSealed) {
          const { data: quoteData, error: quoteError } = await service.rpc(
            "biz_offering_send_quote_candidates",
            {
              p_actor_id: job.actorId,
              p_event_id: job.eventId,
              p_purpose: "invitation",
              p_selection: selection,
              p_channels: channels,
            },
          );
          if (quoteError) throw new Error("quote_failed");
          const candidates = quoteData as {
            brandId: string;
            candidates: QuoteCandidateRow[];
          };
          const snapshot = await buildOfferingExecutionSnapshot({
      smsRates: await loadSmsRates(service).catch(() => undefined),
            eventId: job.eventId,
            brandId: candidates.brandId,
            purpose: "invitation",
            channels,
            selectionHash: await hashOfferingSelection(selection),
            candidates: candidates.candidates,
            content: {},
            allowEmptyPreview: true,
          });
          const { error: sealError } = await service.rpc(
            "issue_1780_seal_wizard_invite_execution_v1",
            {
              p_outbox_job_id: job.outboxJobId,
              p_sealed_selection_id: job.sealedSelectionId,
              p_lease_token: job.leaseToken,
              p_execution_snapshot: snapshot,
            },
          );
          if (sealError) throw new Error("execution_seal_failed");
          if (
            !snapshot.candidates.some((candidate) =>
              candidate.outcome === "queued"
            )
          ) {
            const { error: completionError } = await service.rpc(
              "issue_1780_complete_wizard_invite_outbox_no_recipients_v1",
              {
                p_outbox_job_id: job.outboxJobId,
                p_sealed_selection_id: job.sealedSelectionId,
                p_lease_token: job.leaseToken,
              },
            );
            if (completionError) {
              throw new Error("zero_reachable_completion_failed");
            }
            observeWizardInvite("wizard_invite_outbox_succeeded", {
              offering_kind: job.eventType,
              selection_revision: job.selectionRevision,
              selected_count: job.brandPersonIds.length,
              can_receive: 0,
              skipped: job.brandPersonIds.length,
              job_state: "succeeded",
              attempt_count: job.attemptCount,
            });
            outcomes.push({
              outboxJobId: job.outboxJobId,
              status: "succeeded_no_recipients",
              providerIo: false,
            });
            continue;
          }
        }
        // Token crypto is required only for a sealed job that will create
        // executable delivery attempts. Zero-reachable jobs complete above.
        await resolveOfferingInviteTokenPepper();
        const { data: executionData, error: executionError } = await service
          .rpc(
            "issue_1780_execute_wizard_invite_outbox_v1",
            {
              p_outbox_job_id: job.outboxJobId,
              p_sealed_selection_id: job.sealedSelectionId,
              p_lease_token: job.leaseToken,
            },
          );
        if (executionError) {
          throw new Error(
            executionError.code === "23505"
              ? "duplicate_constraint_violation"
              : "execute_failed",
          );
        }
        const executed = executionData as {
          groupId: string;
          campaignIds: string[];
          channels?: Array<"email" | "sms" | "push">;
        };
        channels = executed.channels ?? channels;
        group = {
          groupId: executed.groupId,
          campaignIds: executed.campaignIds,
        };
      }
      // The execution RPC has committed before either provider-capable path.
      providerIo = true;
      const clean = await dispatchCommittedWizardGroup(
        service,
        url,
        serviceKey,
        group,
        channels,
      );
      if (!clean) throw new Error("provider_handoff_ambiguous");
      const { error: completionError } = await service.rpc(
        "issue_1780_complete_wizard_invite_outbox_v1",
        {
          p_outbox_job_id: job.outboxJobId,
          p_sealed_selection_id: job.sealedSelectionId,
          p_lease_token: job.leaseToken,
        },
      );
      if (completionError) {
        throw new Error("provider_handoff_completion_failed");
      }
      observeWizardInvite("wizard_invite_outbox_succeeded", {
        offering_kind: job.eventType,
        selection_revision: job.selectionRevision,
        job_state: "succeeded",
        attempt_count: job.attemptCount,
      });
      outcomes.push({
        outboxJobId: job.outboxJobId,
        status: "succeeded",
        providerIo,
      });
    } catch (caught) {
      const message = caught instanceof Error
        ? caught.message
        : "worker_failed";
      const { data: failedState } = await service.rpc(
        "issue_1780_fail_wizard_invite_outbox_v1",
        {
          p_outbox_job_id: job.outboxJobId,
          p_lease_token: job.leaseToken,
          p_error_code: /^[a-z0-9_]{1,80}$/.test(message)
            ? message
            : "worker_failed",
          p_retryable: true,
        },
      );
      const terminal = failedState === "terminal";
      observeWizardInvite(
        terminal
          ? "wizard_invite_outbox_terminal_failed"
          : "wizard_invite_outbox_retryable_failed",
        {
          offering_kind: job.eventType,
          selection_revision: job.selectionRevision,
          job_state: terminal ? "terminal" : "retryable",
          attempt_count: job.attemptCount,
          error_code: /^[a-z0-9_]{1,80}$/.test(message)
            ? message
            : "worker_failed",
        },
      );
      outcomes.push({
        outboxJobId: job.outboxJobId,
        status: terminal ? "terminal" : "retryable",
        providerIo,
      });
    }
  }
  return json({
    claimed: jobs.length,
    outcomes,
    providerIo: outcomes.some((row) => row.providerIo),
    observabilityEmitted,
    healthAlertsSent,
  });
}

export interface WizardAccountQuote {
  accountRecipientCount: number;
  canReceiveCount: number;
  push: number;
  email: number;
}

async function quoteWizardAccountRecipients(
  service: WizardServiceClient,
  actorId: string,
  eventId: string,
  selectionRevision: number,
  planned: number,
): Promise<WizardAccountQuote | null> {
  if (!Number.isSafeInteger(planned) || planned <= 0) return null;
  const { data, error } = await service.rpc(
    "issue_3682_quote_wizard_account_invites_v1",
    {
      p_actor_id: actorId,
      p_event_id: eventId,
      p_selection_revision: selectionRevision,
    },
  );
  if (error || data === null || typeof data !== "object") {
    throw new Error("quote_failed");
  }
  return data as WizardAccountQuote;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
}

/**
 * #3682 wave 2 — fold account-only recipients into the wizard estimate. Push is
 * free; email stays inside the monthly cap the SQL quote already applied. The
 * quote hash changes whenever the account counts do, so a stale confirmation
 * cannot match.
 *
 * #3682 closeout — the wizard's `reachableCount` is PEOPLE, not deliveries: a
 * guest reachable by push and email counts once. It always equals
 * `canReceiveCount`; the per-channel split stays in `perChannelReachable`.
 */
export async function mergeWizardAccountQuote(
  quote: Record<string, unknown>,
  account: WizardAccountQuote | null,
): Promise<Record<string, unknown>> {
  if (account === null || account.accountRecipientCount <= 0) {
    return {
      ...quote,
      reachableCount: Number(quote.canReceiveCount),
      accountRecipientCount: 0,
    };
  }
  const channels = quote.perChannelReachable as {
    email: number;
    sms: number;
    push: number;
  };
  const selectedCount = Number(quote.selectedCount) +
    account.accountRecipientCount;
  const canReceiveCount = Number(quote.canReceiveCount) +
    account.canReceiveCount;
  return {
    ...quote,
    quoteHash: await sha256Hex(
      `${quote.quoteHash}|account:${account.accountRecipientCount}:` +
        `${account.canReceiveCount}:${account.push}:${account.email}`,
    ),
    selectedCount,
    eligibleCount: Number(quote.eligibleCount ?? 0) +
      account.accountRecipientCount,
    reachableCount: canReceiveCount,
    canReceiveCount,
    skippedCount: Math.max(0, selectedCount - canReceiveCount),
    perChannelReachable: {
      email: channels.email + account.email,
      sms: channels.sms,
      push: channels.push + account.push,
    },
    accountRecipientCount: account.accountRecipientCount,
  };
}

/**
 * #4273 — the Book-lane estimate when every method the host ticked is switched
 * off: nobody in Your Book can receive, nothing costs money. The hash binds the
 * revision so a publish confirmation cannot match a different selection.
 */
export async function noMethodsWizardQuote(input: {
  selectedCount: number;
  selectionRevision: number;
  selectionHash: string;
  currency: string;
}): Promise<Record<string, unknown>> {
  return {
    mode: "preview",
    quoteHash: await sha256Hex(
      `wizard-no-methods|${input.selectionRevision}|${input.selectionHash}`,
    ),
    quotedAt: new Date().toISOString(),
    selectedCount: input.selectedCount,
    eligibleCount: 0,
    reachableCount: 0,
    suppressedCount: 0,
    canReceiveCount: 0,
    skippedCount: input.selectedCount,
    skipReasonCounts: {},
    unpricedSmsCount: 0,
    perChannelReachable: { email: 0, sms: 0, push: 0 },
    smsSegments: 0,
    estimatedCostMinor: 0,
    currency: input.currency,
    lastContactAt: null,
    selectionRevision: input.selectionRevision,
    selectionHash: input.selectionHash,
    providerIo: false,
  };
}

async function handleWizardPreview(
  user: WizardServiceClient,
  service: WizardServiceClient,
  actorId: string,
  body: WizardPreviewBody,
): Promise<Response> {
  const { data: planData, error: planError } = await user.rpc(
    "biz_get_offering_invite_plan_v1",
    { p_event_id: body.eventId },
  );
  const plan = planData as Record<string, unknown> | null;
  if (planError || plan === null) {
    return json(
      { error: "wizard_invite_preview_forbidden", providerIo: false },
      403,
    );
  }
  const personIds = plan.brandPersonIds;
  const selectionHash = plan.selectionHash;
  if (
    plan.selectionRevision !== body.selectionRevision ||
    !Array.isArray(personIds) || personIds.length > 500 ||
    personIds.some((id) => typeof id !== "string" || !UUID.test(id)) ||
    typeof selectionHash !== "string" || !HASH.test(selectionHash)
  ) {
    return json(
      { error: "wizard_invite_revision_conflict", providerIo: false },
      409,
    );
  }
  const policy = currentWizardDeliveryPolicy();
  const selection = {
    kind: "resolved_brand_people_v1" as const,
    source: "guest_roster_actions",
    brandPersonIds: personIds,
    selectionHash,
  };
  try {
    // #4273 — quote only the methods the host ticked.
    const channels = wizardChannelsFor(policy.channels, plan.deliveryChannels);
    const account = await quoteWizardAccountRecipients(
      service,
      actorId,
      body.eventId,
      body.selectionRevision,
      Number(plan.accountRecipientCount ?? 0),
    );
    if (channels.length === 0) {
      const eventCurrency = await service.from("events").select("currency")
        .eq("id", body.eventId).maybeSingle();
      if (eventCurrency.error) throw new Error("quote_failed");
      return json(
        await mergeWizardAccountQuote(
          await noMethodsWizardQuote({
            selectedCount: personIds.length,
            selectionRevision: body.selectionRevision,
            selectionHash,
            currency: resolveWizardQuoteCurrency(
              0,
              null,
              eventCurrency.data?.currency,
            ),
          }),
          account,
        ),
      );
    }
    const [{ data: quoteData, error: quoteError }, eventCurrency] =
      await Promise
        .all([
          service.rpc("biz_offering_send_quote_candidates", {
            p_actor_id: actorId,
            p_event_id: body.eventId,
            p_purpose: "invitation",
            p_selection: selection,
            p_channels: channels,
          }),
          service.from("events").select("currency").eq("id", body.eventId)
            .maybeSingle(),
        ]);
    if (quoteError || eventCurrency.error) throw new Error("quote_failed");
    const quoted = quoteData as {
      brandId: string;
      selectedCount: number;
      eligibleCount: number;
      candidates: QuoteCandidateRow[];
    };
    const snapshot = await buildOfferingExecutionSnapshot({
      smsRates: await loadSmsRates(service).catch(() => undefined),
      eventId: body.eventId,
      brandId: quoted.brandId,
      purpose: "invitation",
      channels,
      selectionHash,
      candidates: quoted.candidates,
      content: {},
      allowEmptyPreview: true,
    });
    const preview = publicQuote(snapshot, quoted);
    const currency = resolveWizardQuoteCurrency(
      snapshot.quote.estimatedCostMinor,
      snapshot.quote.currency,
      eventCurrency.data?.currency,
    );
    const perChannelReachable = preview.perChannelReachable as Record<
      string,
      number
    >;
    return json(
      await mergeWizardAccountQuote({
        ...preview,
        perChannelReachable: {
          email: Number(perChannelReachable.email ?? 0),
          sms: Number(perChannelReachable.sms ?? 0),
          push: Number(perChannelReachable.push ?? 0),
        },
        selectionRevision: body.selectionRevision,
        selectionHash,
        currency,
        providerIo: false,
      }, account),
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "wizard_invite_preview_unavailable";
    return json({
      error: message === "wizard_invite_currency_mismatch"
        ? message
        : "wizard_invite_preview_unavailable",
      providerIo: false,
    }, message === "wizard_invite_currency_mismatch" ? 409 : 503);
  }
}

function isBody(value: unknown): value is DispatchBody {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const body = value as Record<string, unknown>;
  if (
    !exactKeys(body, [
      "eventId",
      "purpose",
      "selection",
      "channels",
      "clientRequestId",
      "mode",
      "quoteHash",
      "expectedCostMinor",
      "currency",
      "content",
    ])
  ) return false;
  const selection = body.selection as Record<string, unknown> | null;
  if (selection === null || typeof selection !== "object") return false;
  const ordinarySelection = exactKeys(selection, ["kind"]) &&
    (selection.kind === "all_brand_people" ||
      selection.kind === "invited_people");
  const resolvedSelection = exactKeys(selection, [
    "brandPersonIds",
    "kind",
    "selectionHash",
    "source",
  ]) &&
    selection.kind === "resolved_brand_people_v1" &&
    selection.source === "guest_roster_actions" &&
    Array.isArray(selection.brandPersonIds) &&
    typeof selection.selectionHash === "string" &&
    HASH.test(selection.selectionHash);
  const retrySelection = exactKeys(selection, [
    "failedAttemptIds",
    "kind",
    "selectionHash",
    "source",
  ]) &&
    selection.kind === "failed_attempts_v1" &&
    selection.source === "guest_roster_actions" &&
    Array.isArray(selection.failedAttemptIds) &&
    typeof selection.selectionHash === "string" &&
    HASH.test(selection.selectionHash);
  if (!ordinarySelection && !resolvedSelection && !retrySelection) return false;
  const channels = body.channels;
  if (
    !Array.isArray(channels) || channels.length === 0 ||
    channels.some((channel) =>
      channel !== "email" && channel !== "sms" && channel !== "push"
    ) || new Set(channels).size !== channels.length
  ) return false;
  if (
    body.content !== undefined &&
    (typeof body.content !== "object" || body.content === null ||
      Array.isArray(body.content) ||
      !exactKeys(body.content as Record<string, unknown>, [
        "subject",
        "bodyHtml",
        "bodyText",
        "body",
        "pushTitle",
        "pushBody",
      ]) || Object.values(body.content as Record<string, unknown>).some(
        (entry) => typeof entry !== "string",
      ))
  ) return false;
  return typeof body.eventId === "string" && UUID.test(body.eventId) &&
    (body.purpose === "invitation" || body.purpose === "reminder" ||
      body.purpose === "retry_delivery") &&
    typeof body.clientRequestId === "string" &&
    UUID.test(body.clientRequestId) &&
    (body.mode === "preview" || body.mode === "confirm") &&
    (body.mode !== "confirm" ||
      (typeof body.quoteHash === "string" && HASH.test(body.quoteHash) &&
        Number.isSafeInteger(body.expectedCostMinor) &&
        (body.expectedCostMinor as number) >= 0 &&
        (body.currency === null ||
          (typeof body.currency === "string" &&
            /^[A-Z]{3}$/.test(body.currency)))));
}

function publicQuote(
  snapshot: Awaited<ReturnType<typeof buildOfferingExecutionSnapshot>>,
  result: {
    selectedCount: number;
    eligibleCount: number;
    candidates: QuoteCandidateRow[];
  },
): Record<string, unknown> {
  const reachable = snapshot.candidates.filter((row) =>
    row.outcome === "queued"
  );
  const suppressed = snapshot.candidates.filter((row) =>
    row.outcome === "suppressed"
  );
  const lastContactAt =
    result.candidates.flatMap((row) =>
      row.lastContactAt === null ? [] : [row.lastContactAt]
    ).sort().at(-1) ?? null;
  const perChannelReachable = Object.fromEntries(snapshot.channels.map(
    (channel) => [
      channel,
      reachable.filter((row) => row.channel === channel).length,
    ],
  ));
  const canReceiveCount = new Set(
    reachable.map((candidate) => candidate.brandPersonId),
  ).size;
  return {
    mode: "preview",
    quoteHash: snapshot.quote.quoteHash,
    quotedAt: snapshot.quotedAt,
    selectedCount: result.selectedCount,
    eligibleCount: result.eligibleCount,
    reachableCount: reachable.length,
    suppressedCount: suppressed.length,
    canReceiveCount,
    skippedCount: Math.max(
      0,
      result.selectedCount - canReceiveCount,
    ),
    skipReasonCounts: {},
    /** #4273 — texts skipped because the phone's country has no rate yet. */
    unpricedSmsCount: offeringUnpricedSmsCount(snapshot, result.candidates),
    perChannelReachable,
    smsSegments: snapshot.quote.smsSegments,
    estimatedCostMinor: snapshot.quote.estimatedCostMinor,
    currency: snapshot.quote.currency,
    lastContactAt,
  };
}

export async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  let untrusted: unknown;
  try {
    untrusted = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
  if (isWizardWorkerBody(untrusted)) {
    if (
      !url || !serviceKey || authorization !== `Bearer ${serviceKey}` ||
      request.headers.get("x-mingla-internal-service-key") !== serviceKey
    ) return json({ error: "forbidden", providerIo: false }, 403);
    const service = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
    return await handleWizardWorker(service, url, serviceKey);
  }
  if (isWizardPreviewBody(untrusted)) {
    if (
      !url || !anonKey || !serviceKey || !authorization.startsWith("Bearer ")
    ) {
      return json({ error: "unauthorized", providerIo: false }, 401);
    }
    const user = createClient(url, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: actorData, error: actorError } = await user.auth.getUser();
    if (actorError || actorData.user === null) {
      return json({ error: "unauthorized", providerIo: false }, 401);
    }
    const service = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
    return await handleWizardPreview(
      user,
      service,
      actorData.user.id,
      untrusted,
    );
  }
  if (!isBody(untrusted)) return json({ error: "invalid_request" }, 400);
  const body = untrusted;
  if (!url || !anonKey || !serviceKey || !authorization.startsWith("Bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }
  if (
    (body.selection.kind === "resolved_brand_people_v1" ||
      body.selection.kind === "failed_attempts_v1") &&
    request.headers.get("x-mingla-internal-service-key") !== serviceKey
  ) {
    return json({ error: "forbidden", providerIo: false }, 403);
  }
  const user = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const service = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const { data: actorData, error: actorError } = await user.auth.getUser();
  if (actorError || actorData.user === null) {
    return json({ error: "unauthorized" }, 401);
  }
  const actorId = actorData.user.id;
  const channels = [...body.channels].sort() as Channel[];

  const quote = async () => {
    const { data, error } = await service.rpc(
      "biz_offering_send_quote_candidates",
      {
        p_actor_id: actorId,
        p_event_id: body.eventId,
        p_purpose: body.purpose,
        p_selection: body.selection,
        p_channels: channels,
      },
    );
    if (error) throw error;
    const candidates = data as {
      brandId: string;
      selectedCount: number;
      eligibleCount: number;
      candidates: QuoteCandidateRow[];
      retryPushPayload?: PersistedOfferingPushV1 | null;
    };
    const snapshot = await buildOfferingExecutionSnapshot({
      smsRates: await loadSmsRates(service).catch(() => undefined),
      eventId: body.eventId,
      brandId: candidates.brandId,
      purpose: body.purpose,
      channels,
      selectionHash: await hashOfferingSelection(body.selection),
      candidates: candidates.candidates,
      content: body.content ?? {},
      retryPushPayload: candidates.retryPushPayload,
      allowEmptyPreview: body.mode === "preview",
    });
    if (snapshot.candidates.length > 0) {
      const { data: sealed, error: sealError } = await service.rpc(
        "biz_seal_offering_execution_snapshot",
        {
          p_actor_id: actorId,
          p_selection: body.selection,
          p_execution_snapshot: snapshot,
        },
      );
      if (
        sealError ||
        (sealed as { executionSnapshotHash?: string } | null)
            ?.executionSnapshotHash !== snapshot.executionSnapshotHash
      ) throw sealError ?? new Error("offering_execution_seal_mismatch");
    }
    return { candidates, snapshot };
  };

  let quoted: Awaited<ReturnType<typeof quote>>;
  try {
    quoted = await quote();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("actor_forbidden")) {
      return json({ error: "forbidden", providerIo: false }, 403);
    }
    if (message.includes("cost_unavailable")) {
      return json({ error: "cost_unavailable", providerIo: false }, 503);
    }
    return json({ error: "offering_quote_failed", providerIo: false }, 409);
  }
  const preview = publicQuote(quoted.snapshot, quoted.candidates);
  if (body.mode === "preview") return json({ ...preview, providerIo: false });
  if (quoted.snapshot.candidates.length === 0) {
    return json({ error: "no_recipients", ...preview, providerIo: false }, 409);
  }
  const allowedCost = Math.ceil((body.expectedCostMinor as number) * 1.1);
  if (
    quoted.snapshot.quote.estimatedCostMinor > allowedCost ||
    body.currency !== quoted.snapshot.quote.currency
  ) {
    return json(
      { error: "preview_stale_cost", ...preview, providerIo: false },
      409,
    );
  }
  try {
    await resolveOfferingInviteTokenPepper();
  } catch (error) {
    const code = error instanceof OfferingInviteTokenPepperError
      ? error.code
      : "offering_invite_crypto_unavailable";
    return json({ error: code, providerIo: false }, 503);
  }
  const executionRpc = body.purpose === "retry_delivery"
    ? "biz_execute_offering_delivery_retry"
    : "source" in body.selection &&
        body.selection.source === "guest_roster_actions"
    ? "biz_execute_guest_roster_send_group"
    : "biz_execute_offering_send_group";
  const executionArgs = body.purpose === "retry_delivery"
    ? {
      p_actor_id: actorId,
      p_event_id: body.eventId,
      p_failed_attempt_ids: body.selection.failedAttemptIds,
      p_channels: channels,
      p_client_request_id: body.clientRequestId,
      p_execution_snapshot: quoted.snapshot,
    }
    : {
      p_actor_id: actorId,
      p_event_id: body.eventId,
      p_purpose: body.purpose,
      p_selection: body.selection,
      p_channels: channels,
      p_client_request_id: body.clientRequestId,
      p_execution_snapshot: quoted.snapshot,
    };
  const { data: execution, error: executionError } = await service.rpc(
    executionRpc,
    executionArgs,
  );
  if (executionError) {
    const forbidden = executionError.message.includes("actor_forbidden");
    return json({
      error: forbidden ? "forbidden" : "offering_execute_failed",
      providerIo: false,
    }, forbidden ? 403 : 409);
  }
  const group = execution as {
    groupId: string;
    campaignIds: string[];
    [key: string]: unknown;
  };
  const ambiguous = await handOffOfferingGroupProviders(
    service,
    url,
    serviceKey,
    group,
    channels,
  );
  const intendedStatus = ambiguous ? "partial" : "running";
  const eligibleStatuses = ambiguous ? ["queued", "running"] : ["queued"];
  const { data: updatedGroup, error: groupUpdateError } = await service.from(
    "marketing_send_groups",
  ).update({
    status: intendedStatus,
    started_at: new Date().toISOString(),
  }).eq("id", group.groupId).in("status", eligibleStatuses).select("status")
    .maybeSingle();
  let authoritativeStatus = updatedGroup?.status as string | undefined;
  if (groupUpdateError || authoritativeStatus === undefined) {
    const { data: currentGroup, error: currentGroupError } = await service.from(
      "marketing_send_groups",
    ).select("status").eq("id", group.groupId).maybeSingle();
    if (currentGroupError || currentGroup === null) {
      return json({
        ...group,
        error: "group_status_persistence_unproven",
        providerIo: true,
      }, 502);
    }
    authoritativeStatus = currentGroup.status;
  }
  if (
    (ambiguous && authoritativeStatus !== "partial") ||
    (!ambiguous && authoritativeStatus === "queued")
  ) {
    return json({
      ...group,
      error: "group_status_persistence_unproven",
      status: authoritativeStatus,
      providerIo: true,
    }, 502);
  }
  return json({
    ...group,
    status: authoritativeStatus,
    providerIo: true,
  });
}

/**
 * Sole provider handoff owner for #1770 sends and #1780 wizard groups. Runs
 * only after the execution RPC committed; returns true when any provider
 * handoff was ambiguous. Callers own their own group status transition.
 */
async function handOffOfferingGroupProviders(
  service: WizardServiceClient,
  url: string,
  serviceKey: string,
  group: { groupId: string; campaignIds: string[] },
  channels: Channel[],
): Promise<boolean> {
  let ambiguous = false;
  for (const campaignId of group.campaignIds ?? []) {
    try {
      const response = await fetch(url + "/functions/v1/marketing-send", {
        method: "POST",
        headers: {
          authorization: "Bearer " + serviceKey,
          apikey: serviceKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ campaign_id: campaignId }),
      });
      if (!response.ok) ambiguous = true;
    } catch {
      ambiguous = true;
    }
  }
  if (channels.includes("push")) {
    const { data: attempts, error: attemptsError } = await service.from(
      "brand_offering_invite_delivery_attempts",
    ).select("id").eq(
      "send_group_id",
      group.groupId,
    ).eq("channel", "push").eq("status", "queued");
    if (attemptsError) ambiguous = true;
    for (const attempt of attempts ?? []) {
      const { data: preflightData, error: preflightError } = await service.rpc(
        "biz_preflight_offering_push_provider_io",
        { p_attempt_id: attempt.id },
      );
      if (preflightError || !preflightData) {
        ambiguous = true;
        continue;
      }
      const claimed = preflightData as {
        attemptId: string;
        recipientUserId: string;
        internalProviderClaimKey: string;
        oneSignalIdempotencyKey: string;
        pushPayload: PersistedOfferingPushV1;
      };
      const result = await dispatchV2(service as unknown as MinimalClient, {
        user_id: claimed.recipientUserId,
        category_key: "offering_invitation",
        payload: {},
        idempotency_key: claimed.internalProviderClaimKey,
        requested_channel: "push",
        persisted_offering_push: claimed.pushPayload,
        offering_attempt_id: claimed.attemptId,
        internal_provider_claim_key: claimed.internalProviderClaimKey,
        onesignal_idempotency_key: claimed.oneSignalIdempotencyKey,
      });
      if (!result.success) {
        ambiguous = true;
      }
    }
  }
  return ambiguous;
}

if (import.meta.main) serve(handler);
