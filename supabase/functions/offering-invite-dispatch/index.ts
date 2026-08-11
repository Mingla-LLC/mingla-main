import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { dispatchV2, type MinimalClient } from "../_shared/notifyV2.ts";
import {
  buildOfferingExecutionSnapshot,
  hashOfferingSelection,
  type PersistedOfferingPushV1,
  type QuoteCandidateRow,
} from "../_shared/offeringInviteQuote.ts";
import {
  OfferingInviteTokenPepperError,
  resolveOfferingInviteTokenPepper,
} from "../_shared/offeringInviteToken.ts";

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
  const ordinarySelection =
    exactKeys(selection, ["kind"]) &&
    (selection.kind === "all_brand_people" || selection.kind === "invited_people");
  const resolvedSelection =
    exactKeys(selection, ["brandPersonIds", "kind", "selectionHash", "source"]) &&
    selection.kind === "resolved_brand_people_v1" &&
    selection.source === "guest_roster_actions" &&
    Array.isArray(selection.brandPersonIds) &&
    typeof selection.selectionHash === "string" && HASH.test(selection.selectionHash);
  const retrySelection =
    exactKeys(selection, ["failedAttemptIds", "kind", "selectionHash", "source"]) &&
    selection.kind === "failed_attempts_v1" &&
    selection.source === "guest_roster_actions" &&
    Array.isArray(selection.failedAttemptIds) &&
    typeof selection.selectionHash === "string" && HASH.test(selection.selectionHash);
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
  return {
    mode: "preview",
    quoteHash: snapshot.quote.quoteHash,
    quotedAt: snapshot.quotedAt,
    selectedCount: result.selectedCount,
    eligibleCount: result.eligibleCount,
    reachableCount: reachable.length,
    suppressedCount: suppressed.length,
    skippedCount: Math.max(
      0,
      result.selectedCount * snapshot.channels.length -
        snapshot.candidates.length,
    ),
    skipReasonCounts: {},
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
  if (!isBody(untrusted)) return json({ error: "invalid_request" }, 400);
  const body = untrusted;
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = request.headers.get("authorization") ?? "";
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

if (import.meta.main) serve(handler);
