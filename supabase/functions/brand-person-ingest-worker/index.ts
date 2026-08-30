import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { safeBrandPersonResolution } from "../_shared/brandPeople.ts";
import { resolveUserPhoneE164 } from "../../../packages/card-identity/phone.mjs";

interface IngestRow {
  id: string;
  source_kind:
    | "event_rsvp"
    | "rsvp_plus_one"
    | "order"
    | "ticket_holder"
    | "reservation"
    | "stay_reservation";
  source_id: string;
  operation: "upsert" | "retire";
}

type SourcePhoneClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<
          { data: Record<string, unknown> | null; error: unknown }
        >;
      };
    };
  };
};

export async function normalizedPhoneForIngest(
  client: SourcePhoneClient,
  row: Pick<IngestRow, "source_kind" | "source_id" | "operation">,
): Promise<string | null> {
  if (
    row.operation === "retire" ||
    (row.source_kind !== "reservation" &&
      row.source_kind !== "stay_reservation")
  ) {
    return null;
  }
  const table = row.source_kind === "reservation"
    ? "reservations"
    : "stay_reservation_groups";
  const columns = row.source_kind === "reservation"
    ? "phone:guest_phone_e164,phoneCountryIso:guest_phone_country_iso"
    : "phone:guest_snapshot->>phone,phoneCountryIso:guest_snapshot->>phoneCountryIso";
  const { data, error } = await client.from(table).select(columns).eq(
    "id",
    row.source_id,
  ).maybeSingle();
  if (error) throw new Error("source_fetch_failed");
  if (data === null) return null;
  return resolveUserPhoneE164(data.phone, data.phoneCountryIso);
}

export function brandPersonIngestResolutionFailure(
  message: string | undefined,
): "erased_contact_suppressed" | "resolver_failed" {
  return message?.includes("people_erased_contact_suppressed")
    ? "erased_contact_suppressed"
    : "resolver_failed";
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const bearer = request.headers.get("authorization") ?? "";
  if (
    serviceKey.length === 0 || (bearer !== `Bearer ${serviceKey}` &&
      (cronSecret.length === 0 || bearer !== `Bearer ${cronSecret}`))
  ) {
    return json({ error: "forbidden" }, 403);
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (url.length === 0) return json({ error: "service_unavailable" }, 503);
  const client = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const { data, error } = await client.rpc("biz_claim_brand_person_ingest", {
    p_limit: 100,
  });
  if (error) return json({ error: "ingest_claim_failed" }, 500);
  const rows = (data ?? []) as IngestRow[];
  const counts = {
    claimed: rows.length,
    linked: 0,
    conflict: 0,
    unlinked: 0,
    retired: 0,
    retryable: 0,
    dead: 0,
    erasedSuppressed: 0,
    finishUnknown: 0,
  };
  for (const row of rows) {
    try {
      const normalizedPhone = await normalizedPhoneForIngest(
        client as unknown as SourcePhoneClient,
        row,
      );
      const parameters = row.source_kind === "reservation" ||
          row.source_kind === "stay_reservation"
        ? {
          p_source_kind: row.source_kind,
          p_source_id: row.source_id,
          p_normalized_phone_e164: normalizedPhone,
        }
        : { p_source_kind: row.source_kind, p_source_id: row.source_id };
      const { data: outcome, error: resolutionError } = await client.rpc(
        "biz_resolve_brand_person_source_derived",
        parameters,
      );
      if (resolutionError) {
        throw new Error(
          brandPersonIngestResolutionFailure(resolutionError.message),
        );
      }
      const label = safeBrandPersonResolution(outcome).linkOutcome;
      if (label === "linked" || label === "already_linked") counts.linked += 1;
      else if (label === "conflict") counts.conflict += 1;
      else if (label === "retired") counts.retired += 1;
      else counts.unlinked += 1;
      const { error: finishError } = await client.rpc(
        "biz_finish_brand_person_ingest",
        {
          p_id: row.id,
          p_succeeded: true,
          p_safe_error_code: null,
        },
      );
      if (finishError) throw new Error("finish_failed");
    } catch (error) {
      if (
        error instanceof Error && error.message === "erased_contact_suppressed"
      ) {
        const { error: finishError } = await client.rpc(
          "biz_finish_brand_person_ingest",
          { p_id: row.id, p_succeeded: true, p_safe_error_code: null },
        );
        if (finishError) counts.finishUnknown += 1;
        else counts.erasedSuppressed += 1;
        continue;
      }
      const code = error instanceof Error && error.message === "finish_failed"
        ? "ingest_finish_failed"
        : error instanceof Error && error.message === "source_fetch_failed"
        ? "ingest_source_fetch_failed"
        : "ingest_resolver_failed";
      const { error: finishError } = await client.rpc(
        "biz_finish_brand_person_ingest",
        {
          p_id: row.id,
          p_succeeded: false,
          p_safe_error_code: code,
        },
      );
      if (finishError) {
        counts.finishUnknown += 1;
      } else {
        const { data: finished, error: finishedError } = await client.from(
          "brand_person_ingest_outbox",
        ).select("status").eq("id", row.id).single();
        if (finishedError || finished === null) counts.finishUnknown += 1;
        else if (finished.status === "dead") counts.dead += 1;
        else counts.retryable += 1;
      }
    }
  }
  return json(counts);
}

if (import.meta.main) serve(handler);
