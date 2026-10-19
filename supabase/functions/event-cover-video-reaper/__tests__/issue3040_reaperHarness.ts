// Issue #3040 — shared harness for the #3040 reaper suites: the real
// handleReaper against an in-memory database whose RPCs follow the SQL
// contracts of 20271108003040 (claim predicate and rotation, transition matrix,
// apply_once, live references).
// deno-lint-ignore-file no-explicit-any
import { handleReaper } from "../index.ts";
import {
  applyOnceHandler,
  makeFakeDb,
  type Row,
  type RpcHandler,
  transitionJobHandler,
} from "../../_shared/__tests__/issue3040_fakeSupabase.ts";

export const SERVICE_KEY = "service-role-key-3040-reaper";

const TERMINAL = ["failed", "cancelled", "superseded"];
const CLAIMABLE = [...TERMINAL, "source_uploaded", "processing_queued", "processing", "ready"];

export const claimHandler: RpcHandler = (args, db) => {
  const now = Date.now();
  const rows = (db.tables.event_cover_video_jobs ?? []).filter((row) =>
    ((CLAIMABLE.includes(row.status) && row.source_asset_id != null) ||
      (row.status === "source_uploading" && row.provider_allocation_uncertain_at != null &&
        row.provider_allocation_identity === row.id)) &&
    row.reaped_at == null &&
    (row.reconcile_lease_until == null || Date.parse(row.reconcile_lease_until) < now)
  ).sort((a, b) =>
    (TERMINAL.includes(a.status) ? 0 : 1) - (TERMINAL.includes(b.status) ? 0 : 1) ||
    (a.reconcile_attempted_at == null ? -1 : 0) - (b.reconcile_attempted_at == null ? -1 : 0) ||
    String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id))
  ).slice(0, Number(args.p_limit ?? 100));
  for (const row of rows) {
    row.reconcile_attempted_at = new Date(now).toISOString();
    row.reconcile_lease_until = new Date(now + 60_000).toISOString();
  }
  return { data: rows.map((row) => ({ ...row })), error: null };
};

export type HarnessOptions = {
  events?: Row[];
  brands?: Row[];
  adminConfig?: Row[];
  references?: Record<string, string[]>;
  missingRpcs?: string[];
  bunnyGetVideo?: (guid: string) => Promise<any>;
  bunnyFindVideoByTitle?: (title: string) => Promise<any>;
  destroyFails?: boolean;
};

export const makeReaper = (jobs: Row[], options: HarnessOptions = {}) => {
  const destroyed: string[] = [];
  const handlers: Record<string, RpcHandler> = {
    cover_video_record_processing_slo_breaches: () => ({ data: [], error: null }),
    cover_video_claim_reconcile_jobs: claimHandler,
    cover_video_transition_job: transitionJobHandler,
    cover_video_apply_once: applyOnceHandler,
    cover_video_guid_live_references: (args) => ({
      data: options.references?.[args.p_guid] ?? [],
      error: null,
    }),
    cover_video_claim_provider_allocation: (args, db) => {
      const row = db.tables.event_cover_video_jobs.find((r) => r.id === args.p_job_id);
      return { data: row ? { ...row, provider_allocation_token: "lease-3040" } : null, error: null };
    },
    cover_video_resolve_provider_allocation: (args, db) => {
      const row = db.tables.event_cover_video_jobs.find((r) => r.id === args.p_job_id);
      if (!row) return { data: null, error: null };
      row.provider_allocation_uncertain_at = null;
      if (!args.p_absent) row.source_asset_id = args.p_source_asset_id;
      return { data: { ...row }, error: null };
    },
  };
  for (const name of options.missingRpcs ?? []) delete handlers[name];
  const db = makeFakeDb({
    event_cover_video_jobs: jobs,
    events: options.events ?? [],
    brands: options.brands ?? [],
    admin_config: options.adminConfig ?? [],
    api_health_checks: [],
    ad_creatives: [],
  }, handlers);
  const deps = {
    bunnyFindVideoByTitle: options.bunnyFindVideoByTitle ??
      (() => Promise.resolve({ ok: true as const, guid: null })),
    bunnyGetVideo: options.bunnyGetVideo ??
      (() => Promise.resolve({ ok: false as const, status: 503, reason: "unused" })),
    destroyCoverVideoAsset: (row: { source_asset_id?: unknown }) => {
      if (options.destroyFails) return Promise.resolve({ ok: false as const, reason: "bunny_delete_http_500" });
      destroyed.push(String(row.source_asset_id));
      return Promise.resolve({ ok: true as const });
    },
    serviceRoleClient: () => db.client,
  };
  const tick = async (): Promise<Record<string, any>> => {
    const prior = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY);
    try {
      const response = await handleReaper(
        new Request("https://internal/event-cover-video-reaper", {
          method: "POST",
          headers: { authorization: `Bearer ${SERVICE_KEY}` },
        }),
        deps as never,
      );
      return await response.json();
    } finally {
      if (prior === undefined) Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
      else Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", prior);
    }
  };
  const job = (id: string) => db.tables.event_cover_video_jobs.find((row) => row.id === id) as Row;
  return { db, deps, destroyed, tick, job };
};

export const withTusHead = async (
  head: (url: string) => Response,
  fn: () => Promise<void>,
): Promise<void> => {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) =>
    Promise.resolve(head(String(input instanceof Request ? input.url : input)))) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
};

export const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const { log, warn, error } = console;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, { log, warn, error });
  }
};
