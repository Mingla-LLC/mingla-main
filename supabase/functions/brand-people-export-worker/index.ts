import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { csvFromRows } from "../brand-people-export/csv.ts";

const BRAND_BOOK_COLUMNS = [
  "personId",
  "name",
  "primaryEmail",
  "alternateEmails",
  "primaryPhone",
  "alternatePhones",
  "firstSource",
  "lastSource",
  "sourceTypes",
  "suppressedEmail",
  "suppressedSms",
] as const;
const ALLOWED_COLUMNS = new Set<string>(BRAND_BOOK_COLUMNS);

interface ExportClaim {
  id: string;
  brand_id: string;
  export_kind: "brand_book" | "offering_guest_roster";
  prepared_storage_path: string | null;
  prepared_row_count: number | null;
  prepared_checksum: string | null;
}

interface ExportJobState {
  status: "queued" | "running" | "ready" | "failed" | "expired";
  storage_path: string | null;
  prepared_storage_path: string | null;
  prepared_checksum: string | null;
  safe_error_code: string | null;
}

export interface ExportWorkerDeps {
  // deno-lint-ignore no-explicit-any -- test seam for the Edge client.
  createService: (url: string, serviceKey: string) => any;
  envGet: (name: string) => string | undefined;
  randomUUID: () => string;
}

const DEFAULT_DEPS: ExportWorkerDeps = {
  createService: (url, serviceKey) =>
    createClient(url, serviceKey, { auth: { persistSession: false } }),
  envGet: (name) =>
    name === "SUPABASE_URL"
      ? Deno.env.get("SUPABASE_URL")
      : name === "SUPABASE_SERVICE_ROLE_KEY"
      ? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      : undefined,
  randomUUID: () => crypto.randomUUID(),
};

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
  );
  return Array.from(digest, (value) => value.toString(16).padStart(2, "0"))
    .join(
      "",
    );
}

function validateRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("export_provider_rows_invalid");
  const rows = value.map((entry) => {
    const row = (entry as { row_data?: unknown })?.row_data;
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("export_provider_rows_invalid");
    }
    for (const key of Object.keys(row)) {
      if (!ALLOWED_COLUMNS.has(key)) {
        throw new Error("export_provider_rows_invalid");
      }
    }
    return row as Record<string, unknown>;
  });
  return rows.sort((left, right) =>
    String(left.personId ?? "").localeCompare(String(right.personId ?? ""))
  );
}

// deno-lint-ignore no-explicit-any -- Edge client has no generated database types.
export async function expireFiles(service: any): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await service.from("brand_people_export_jobs")
    .select(
      "id,status,storage_path,prepared_storage_path,safe_error_code,expires_at",
    ).in("status", ["ready", "expired"])
    .or(`safe_error_code.eq.privacy_erasure,expires_at.lte.${now}`)
    .limit(100);
  if (error || !Array.isArray(data) || data.length === 0) return 0;
  const references = new Map<string, Set<string>>();
  for (const row of data) {
    for (const path of [row.storage_path, row.prepared_storage_path]) {
      if (typeof path !== "string" || path.length === 0) continue;
      const jobs = references.get(path) ?? new Set<string>();
      jobs.add(String(row.id));
      references.set(path, jobs);
    }
  }
  const expiredJobs = new Set<string>();
  for (const [path, jobs] of references) {
    const paths = [path];
    const { error: removeError } = await service.storage.from(
      "brand-people-exports",
    ).remove(paths);
    if (removeError) continue;
    for (const jobId of jobs) {
      const { data: marked } = await service.rpc(
        "biz_expire_brand_people_export",
        { p_job_id: jobId, p_storage_path: path },
      );
      if (marked === true) expiredJobs.add(jobId);
    }
  }
  return expiredJobs.size;
}

// deno-lint-ignore no-explicit-any -- Edge client has no generated database types.
async function readExportJobState(
  service: any,
  jobId: string,
): Promise<ExportJobState | null> {
  const { data, error } = await service.from("brand_people_export_jobs")
    .select(
      "status,storage_path,prepared_storage_path,prepared_checksum,safe_error_code",
    ).eq("id", jobId).maybeSingle();
  return error || data === null ? null : data as ExportJobState;
}

// deno-lint-ignore no-explicit-any -- Edge client has no generated database types.
async function removeAndClearExactPath(
  service: any,
  jobId: string,
  path: string,
): Promise<boolean> {
  const paths = [path];
  const { error: removeError } = await service.storage.from(
    "brand-people-exports",
  ).remove(paths);
  if (removeError) {
    return false;
  }
  const { data: marked } = await service.rpc(
    "biz_expire_brand_people_export",
    { p_job_id: jobId, p_storage_path: path },
  );
  return marked === true;
}

// deno-lint-ignore no-explicit-any -- Edge client has no generated database types.
async function persistExportFailure(
  service: any,
  jobId: string,
  workerId: string,
  safeCode: string,
  retryable: boolean,
): Promise<"queued" | "failed" | null> {
  for (let retry = 0; retry < 2; retry += 1) {
    const { data, error } = await service.rpc(
      "biz_retry_or_fail_brand_people_export",
      {
        p_job_id: jobId,
        p_worker_id: workerId,
        p_safe_error_code: safeCode,
        p_retryable: retryable,
      },
    );
    if (!error && (data === "queued" || data === "failed")) return data;
  }
  const { data, error } = await service.from("brand_people_export_jobs")
    .select("status,safe_error_code,locked_by").eq("id", jobId).maybeSingle();
  return !error && data !== null &&
      (data.status === "queued" || data.status === "failed") &&
      data.safe_error_code === safeCode && data.locked_by === null
    ? data.status
    : null;
}

export async function handleExportWorkerRequest(
  request: Request,
  deps: ExportWorkerDeps = DEFAULT_DEPS,
): Promise<Response> {
  if (request.method !== "POST") {
    return response({ error: "method_not_allowed" }, 405);
  }
  const url = deps.envGet("SUPABASE_URL") ?? "";
  const serviceKey = deps.envGet("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (
    url.length === 0 || serviceKey.length === 0 ||
    request.headers.get("authorization") !== `Bearer ${serviceKey}`
  ) return response({ error: "forbidden" }, 403);
  const service = deps.createService(url, serviceKey);
  const workerId = deps.randomUUID();
  const expired = await expireFiles(service);
  const { data: claimed, error: claimError } = await service.rpc(
    "biz_claim_brand_people_export_jobs",
    { p_worker_id: workerId, p_limit: 1 },
  );
  if (claimError) {
    return response({ error: "export_claim_failed", expired }, 500);
  }
  const jobs = (claimed ?? []) as ExportClaim[];
  if (jobs.length === 0) {
    return response({ claimed: 0, ready: 0, failed: 0, expired });
  }
  const job = jobs[0];
  try {
    const { data: providerRows, error: providerError } = await service.rpc(
      "biz_brand_people_export_rows",
      { p_job_id: job.id },
    );
    if (providerError) {
      const code = providerError.message.includes("export_provider_not_ready")
        ? "export_provider_not_ready"
        : "export_provider_failed";
      const persisted = await persistExportFailure(
        service,
        job.id,
        workerId,
        code,
        code !== "export_provider_not_ready",
      );
      if (persisted === null) {
        return response({
          error: "export_failure_persistence_unproven",
          claimed: 1,
          ready: 0,
          failed: 0,
          state: "unknown",
          expired,
        }, 503);
      }
      return response({ claimed: 1, ready: 0, failed: 1, expired });
    }
    const rows = validateRows(providerRows);
    const { data: heartbeat, error: heartbeatError } = await service.rpc(
      "biz_heartbeat_brand_people_export",
      {
        p_job_id: job.id,
        p_worker_id: workerId,
      },
    );
    if (heartbeatError || heartbeat !== true) {
      throw new Error("export_lease_unproven");
    }
    const csv = csvFromRows(rows, BRAND_BOOK_COLUMNS);
    const bytes = new TextEncoder().encode(csv);
    const checksum = await sha256Hex(bytes);
    const storagePath = `brand/${job.brand_id}/${job.id}.csv`;
    const { error: prepareError } = await service.rpc(
      "biz_prepare_brand_people_export_upload",
      {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_storage_path: storagePath,
        p_row_count: rows.length,
        p_checksum: checksum,
      },
    );
    if (prepareError) throw new Error("export_prepare_failed");
    const { error: uploadError } = await service.storage.from(
      "brand-people-exports",
    ).upload(storagePath, bytes, {
      contentType: "text/csv; charset=utf-8",
      upsert: false,
    });
    if (uploadError) {
      const { data: prior, error: downloadError } = await service.storage.from(
        "brand-people-exports",
      ).download(storagePath);
      if (downloadError || prior === null) {
        throw new Error("export_storage_failed");
      }
      const priorChecksum = await sha256Hex(
        new Uint8Array(await prior.arrayBuffer()),
      );
      if (priorChecksum !== checksum) {
        throw new Error("export_prepared_checksum_conflict");
      }
    }
    const { error: completeError } = await service.rpc(
      "biz_complete_brand_people_export",
      {
        p_job_id: job.id,
        p_worker_id: workerId,
        p_storage_path: storagePath,
        p_row_count: rows.length,
        p_omitted_person_count: 0,
        p_omitted_field_count: 0,
        p_checksum: checksum,
      },
    );
    if (completeError) {
      const observed = await readExportJobState(service, job.id);
      if (
        observed?.status === "ready" &&
        observed.storage_path === storagePath
      ) {
        return response({ claimed: 1, ready: 1, failed: 0, expired });
      }
      if (
        observed?.status === "expired" &&
        observed.safe_error_code === "privacy_erasure"
      ) {
        const cleared = await removeAndClearExactPath(
          service,
          job.id,
          storagePath,
        );
        return response({
          claimed: 1,
          ready: 0,
          failed: 0,
          expired: expired + (cleared ? 1 : 0),
        });
      }
      throw new Error("export_completion_failed");
    }
    return response({ claimed: 1, ready: 1, failed: 0, expired });
  } catch (error) {
    const code = error instanceof Error &&
        ["export_provider_rows_invalid", "export_prepared_checksum_conflict"]
          .includes(
            error.message,
          )
      ? error.message
      : "export_worker_transient_failure";
    const persisted = await persistExportFailure(
      service,
      job.id,
      workerId,
      code,
      code === "export_worker_transient_failure",
    );
    if (persisted === null) {
      return response({
        error: "export_failure_persistence_unproven",
        claimed: 1,
        ready: 0,
        failed: 0,
        state: "unknown",
        expired,
      }, 503);
    }
    return response({ claimed: 1, ready: 0, failed: 1, expired });
  }
}

if (import.meta.main) {
  serve((request) => handleExportWorkerRequest(request));
}
