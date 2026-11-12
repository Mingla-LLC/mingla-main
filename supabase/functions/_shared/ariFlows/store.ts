/**
 * Issue #3355 P3 — the flow run store: thin, typed wrappers around the
 * service-role RPCs in migration 20280308003355. The edge decides nothing
 * about clocks or concurrency; the database does (lease, CAS, evidence).
 *
 * Deploy rule (SPEC §6): edge code merges before the migration is applied in
 * production, so a missing function (PGRST202) is `FlowEngineUnavailable` and
 * every caller falls back to the pre-engine path. The engine is also behind
 * the `ari_flow_engine` row in `public.feature_flags` (default off), or
 * `ARI_FLOW_ENGINE=on` for a local stack or an eval run. Production never
 * uses the env name: the Supabase secret budget is full (#3355 switch-off).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type {
  FlowArtefact,
  FlowRun,
  FlowRunStatus,
  FlowStepRecord,
} from "./types.ts";

export class FlowEngineUnavailable extends Error {
  constructor(message = "flow engine unavailable") {
    super(message);
    this.name = "FlowEngineUnavailable";
  }
}

export class FlowConflict extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "FlowConflict";
  }
}

export function flowEngineEnabled(
  value: string | undefined = Deno.env.get("ARI_FLOW_ENGINE"),
): boolean {
  return value === "on";
}

export const FLOW_ENGINE_FLAG_KEY = "ari_flow_engine";
const FLOW_ENGINE_FLAG_TTL_MS = 15_000;
let flowEngineFlagCache: { value: boolean; at: number } | null = null;

/** Test seam: forget the cached flag read. */
export function resetFlowEngineFlagCache(): void {
  flowEngineFlagCache = null;
}

/**
 * Whether the flow engine runs for this request: the env override, else the
 * `ari_flow_engine` feature flag, read with the service client and cached
 * per isolate for 15 s. A failed read is off (the pre-engine path stands).
 */
export async function readFlowEngineEnabled(
  service: SupabaseClient,
  env: string | undefined = Deno.env.get("ARI_FLOW_ENGINE"),
  now: number = Date.now(),
): Promise<boolean> {
  if (flowEngineEnabled(env)) return true;
  if (
    flowEngineFlagCache &&
    now - flowEngineFlagCache.at < FLOW_ENGINE_FLAG_TTL_MS
  ) return flowEngineFlagCache.value;
  let value = false;
  try {
    const { data, error } = await service.from("feature_flags")
      .select("is_enabled")
      .eq("flag_key", FLOW_ENGINE_FLAG_KEY)
      .maybeSingle();
    value = !error &&
      (data as { is_enabled?: unknown } | null)?.is_enabled === true;
  } catch (_error) {
    value = false;
  }
  flowEngineFlagCache = { value, at: now };
  return value;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const STATUSES: ReadonlySet<string> = new Set([
  "active",
  "awaiting_owner",
  "awaiting_approval",
  "awaiting_handoff",
  "blocked",
  "completed",
  "cancelled",
  "expired",
  "parked",
]);

export function parseFlowArtefact(value: unknown): FlowArtefact | null {
  const raw = record(value);
  if (
    !raw || raw.schema_version !== 1 || !str(raw.artefact_id) ||
    !str(raw.run_id) || !str(raw.step_key) || !str(raw.kind) ||
    typeof raw.text !== "string" || !Array.isArray(raw.options)
  ) return null;
  return raw as unknown as FlowArtefact;
}

/** The presentation-safe run JSON from ari_flow_run_json. */
export function parseFlowRun(value: unknown): FlowRun | null {
  const raw = record(value);
  if (!raw || !str(raw.id) || !str(raw.brand_id) || !str(raw.flow_key)) {
    return null;
  }
  const status = str(raw.status);
  if (!status || !STATUSES.has(status)) return null;
  const steps = record(raw.step_states) ?? {};
  const answers = record(raw.answers) ?? {};
  return {
    id: raw.id as string,
    brand_id: raw.brand_id as string,
    flow_key: raw.flow_key as string,
    flow_version: typeof raw.flow_version === "number" ? raw.flow_version : 1,
    concurrency: raw.concurrency === "one_per_brand"
      ? "one_per_brand"
      : "one_per_subject",
    subject_id: str(raw.subject_id),
    conversation_id: str(raw.conversation_id),
    status: status as FlowRunStatus,
    current_step_key: str(raw.current_step_key),
    current_question_id: str(raw.current_question_id),
    current_pending_action_id: str(raw.current_pending_action_id),
    current_artefact: parseFlowArtefact(raw.current_artefact),
    step_states: steps as Record<string, FlowStepRecord>,
    answers: answers as FlowRun["answers"],
    session_skips: Array.isArray(raw.session_skips)
      ? raw.session_skips.filter((key): key is string =>
        typeof key === "string"
      )
      : [],
    revision: typeof raw.revision === "number" ? raw.revision : 1,
    started_by_me: raw.started_by_me === true,
    started_by_name: str(raw.started_by_name) ?? "A teammate",
    lease_held: raw.lease_held === true,
    lease_held_by_me: raw.lease_held_by_me === true,
    lease_owner_name: str(raw.lease_owner_name),
    // #2830: absent during the deploy window (edge before migration).
    stopped: raw.stopped === true,
    last_activity_at: str(raw.last_activity_at),
    owner_since: str(raw.owner_since),
  };
}

export interface FlowStartResult {
  created: boolean;
  owned_by_other: boolean;
  owner_display_name: string | null;
  run: FlowRun;
}

export interface FlowLeaseResult {
  ok: boolean;
  reason: "busy" | "owned_by_other" | "terminal" | null;
  owner_display_name: string | null;
  run: FlowRun;
}

/** #2830 — the brand's live run, as the setup screen sees it. */
export interface FlowBrandRun {
  run: FlowRun;
  can_take_over: boolean;
  last_takeover: {
    to_name: string;
    from_name: string;
    kind: string;
    created_at: string;
  } | null;
}

/** #2830 — this chat's run was taken from this person. */
export interface FlowDisplacement {
  id: string;
  run_id: string;
  to_name: string;
  created_at: string | null;
  notified_at: string | null;
}

export interface FlowStore {
  start(args: {
    brandId: string;
    flowKey: string;
    flowVersion: number;
    concurrency: FlowRun["concurrency"];
    conversationId: string | null;
    subjectId?: string | null;
    answers?: Record<string, unknown>;
  }): Promise<FlowStartResult>;
  lease(runId: string, token: string, ttlSeconds?: number): Promise<
    FlowLeaseResult
  >;
  advance(
    runId: string,
    token: string,
    expectedRevision: number,
    patch: Record<string, unknown>,
  ): Promise<FlowRun>;
  release(runId: string, token: string): Promise<void>;
  getForConversation(conversationId: string): Promise<FlowRun | null>;
  getById(runId: string): Promise<FlowRun | null>;
  // #2830 — optional so an older in-memory store keeps working; the real store
  // always has them.
  brandRun?(brandId: string, flowKey: string): Promise<FlowBrandRun | null>;
  takeOver?(args: {
    runId: string;
    conversationId: string | null;
    expectedRevision: number;
    mode: "continue" | "take_over";
  }): Promise<{ changed: boolean; kind: string | null; run: FlowRun }>;
  displacement?(conversationId: string): Promise<FlowDisplacement | null>;
  /**
   * #3355 Wave A — bring this chat's parked run back (live again, the same
   * step). FlowConflict when it expired or the chat moved on.
   */
  resume?(runId: string, conversationId: string): Promise<FlowRun>;
  markDisplacementNotified?(id: string): Promise<void>;
}

function isMissing(error: { code?: unknown; message?: unknown }): boolean {
  return error.code === "PGRST202" || error.code === "42P01" ||
    error.code === "42883" ||
    /could not find the function|does not exist/i.test(
      String(error.message ?? ""),
    );
}

function failure(
  fn: string,
  error: { code?: unknown; message?: unknown },
): Error {
  if (isMissing(error)) return new FlowEngineUnavailable(fn);
  const message = String(error.message ?? "");
  for (
    const code of [
      "flow_revision_conflict",
      "flow_lease_not_held",
      "flow_run_terminal",
      "flow_run_conflict",
      "flow_run_active",
      "flow_run_busy",
      "flow_brand_paused",
      "flow_takeover_invalid",
      "flow_form_locked",
      "flow_run_not_parked",
    ]
  ) {
    if (message.includes(code)) return new FlowConflict(code);
  }
  if (error.code === "42501" || /\bforbidden\b/.test(message)) {
    return new FlowConflict("forbidden");
  }
  return new Error(`${fn}: ${message || "failed"}`);
}

/** Service-role store acting for one authenticated user. */
export function createFlowStore(
  service: SupabaseClient,
  userId: string,
): FlowStore {
  // Each RPC is named literally at its `service.rpc("…")` call site so the
  // #2305 lifecycle gate can see that production code reaches the functions
  // that advance `ari_flow_runs.status` (a name passed through a variable is
  // invisible to it). `settle` only maps the result.
  const settle = (
    fn: string,
    result: {
      data: unknown;
      error: { code?: unknown; message?: unknown } | null;
    },
  ): unknown => {
    if (result.error) throw failure(fn, result.error);
    return result.data;
  };
  const runOrThrow = (value: unknown, fn: string): FlowRun => {
    const run = parseFlowRun(value);
    if (!run) throw new Error(`${fn}: unexpected shape`);
    return run;
  };
  return {
    async start(args) {
      const data = record(
        settle(
          "ari_flow_run_start",
          await service.rpc("ari_flow_run_start", {
            p_user_id: userId,
            p_brand_id: args.brandId,
            p_flow_key: args.flowKey,
            p_flow_version: args.flowVersion,
            p_concurrency: args.concurrency,
            p_conversation_id: args.conversationId,
            p_subject_id: args.subjectId ?? null,
            p_answers: args.answers ?? {},
          }),
        ),
      );
      return {
        created: data?.created === true,
        owned_by_other: data?.owned_by_other === true,
        owner_display_name: str(data?.owner_display_name),
        run: runOrThrow(data?.run, "ari_flow_run_start"),
      };
    },
    async lease(runId, token, ttlSeconds = 30) {
      const data = record(
        settle(
          "ari_flow_run_lease",
          await service.rpc("ari_flow_run_lease", {
            p_run_id: runId,
            p_user_id: userId,
            p_lease_token: token,
            p_ttl_seconds: ttlSeconds,
          }),
        ),
      );
      const reason = str(data?.reason);
      return {
        ok: data?.ok === true,
        reason: reason === "busy" || reason === "owned_by_other" ||
            reason === "terminal"
          ? reason
          : null,
        owner_display_name: str(data?.owner_display_name),
        run: runOrThrow(data?.run, "ari_flow_run_lease"),
      };
    },
    async advance(runId, token, expectedRevision, patch) {
      return runOrThrow(
        settle(
          "ari_flow_run_advance",
          await service.rpc("ari_flow_run_advance", {
            p_run_id: runId,
            p_lease_token: token,
            p_expected_revision: expectedRevision,
            p_patch: patch,
          }),
        ),
        "ari_flow_run_advance",
      );
    },
    async release(runId, token) {
      settle(
        "ari_flow_run_release",
        await service.rpc("ari_flow_run_release", {
          p_run_id: runId,
          p_lease_token: token,
        }),
      );
    },
    async getForConversation(conversationId) {
      const data = settle(
        "ari_flow_run_get",
        await service.rpc("ari_flow_run_get", {
          p_user_id: userId,
          p_run_id: null,
          p_conversation_id: conversationId,
        }),
      );
      return data === null ? null : parseFlowRun(data);
    },
    async getById(runId) {
      const data = settle(
        "ari_flow_run_get",
        await service.rpc("ari_flow_run_get", {
          p_user_id: userId,
          p_run_id: runId,
          p_conversation_id: null,
        }),
      );
      return data === null ? null : parseFlowRun(data);
    },
    async brandRun(brandId, flowKey) {
      const data = record(
        settle(
          "ari_flow_brand_run_get",
          await service.rpc("ari_flow_brand_run_get", {
            p_user_id: userId,
            p_brand_id: brandId,
            p_flow_key: flowKey,
          }),
        ),
      );
      if (!data) return null;
      const last = record(data.last_takeover);
      return {
        run: runOrThrow(data.run, "ari_flow_brand_run_get"),
        can_take_over: data.can_take_over === true,
        last_takeover: last
          ? {
            to_name: str(last.to_name) ?? "A teammate",
            from_name: str(last.from_name) ?? "A teammate",
            kind: str(last.kind) ?? "took_over_active",
            created_at: str(last.created_at) ?? "",
          }
          : null,
      };
    },
    async takeOver(args) {
      const data = record(
        settle(
          "ari_flow_run_take_over",
          await service.rpc("ari_flow_run_take_over", {
            p_user_id: userId,
            p_run_id: args.runId,
            p_conversation_id: args.conversationId,
            p_expected_revision: args.expectedRevision,
            p_mode: args.mode,
          }),
        ),
      );
      return {
        changed: data?.changed === true,
        kind: str(data?.kind),
        run: runOrThrow(data?.run, "ari_flow_run_take_over"),
      };
    },
    async displacement(conversationId) {
      const data = record(
        settle(
          "ari_flow_run_displacement_get",
          await service.rpc("ari_flow_run_displacement_get", {
            p_user_id: userId,
            p_conversation_id: conversationId,
          }),
        ),
      );
      if (!data || !str(data.id)) return null;
      return {
        id: data.id as string,
        run_id: str(data.run_id) ?? "",
        to_name: str(data.to_name) ?? "A teammate",
        created_at: str(data.created_at),
        notified_at: str(data.notified_at),
      };
    },
    async resume(runId, conversationId) {
      return runOrThrow(
        settle(
          "ari_flow_run_resume",
          await service.rpc("ari_flow_run_resume", {
            p_user_id: userId,
            p_run_id: runId,
            p_conversation_id: conversationId,
          }),
        ),
        "ari_flow_run_resume",
      );
    },
    async markDisplacementNotified(id) {
      settle(
        "ari_flow_run_displacement_mark",
        await service.rpc("ari_flow_run_displacement_mark", {
          p_id: id,
          p_user_id: userId,
        }),
      );
    },
  };
}
