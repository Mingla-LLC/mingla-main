/**
 * Issue #3355 P3 — the flow run store: thin, typed wrappers around the
 * service-role RPCs in migration 20280308003355. The edge decides nothing
 * about clocks or concurrency; the database does (lease, CAS, evidence).
 *
 * Deploy rule (SPEC §6): edge code merges before the migration is applied in
 * production, so a missing function (PGRST202) is `FlowEngineUnavailable` and
 * every caller falls back to the pre-engine path. The engine is also behind
 * `ARI_FLOW_ENGINE=on` (default off).
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
  env: { get(key: string): string | undefined } = Deno.env,
): boolean {
  return env.get("ARI_FLOW_ENGINE") === "on";
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
  const call = async (fn: string, params: JsonRecord): Promise<unknown> => {
    const { data, error } = await service.rpc(fn, params);
    if (error) throw failure(fn, error);
    return data;
  };
  const runOrThrow = (value: unknown, fn: string): FlowRun => {
    const run = parseFlowRun(value);
    if (!run) throw new Error(`${fn}: unexpected shape`);
    return run;
  };
  return {
    async start(args) {
      const data = record(
        await call("ari_flow_run_start", {
          p_user_id: userId,
          p_brand_id: args.brandId,
          p_flow_key: args.flowKey,
          p_flow_version: args.flowVersion,
          p_concurrency: args.concurrency,
          p_conversation_id: args.conversationId,
          p_subject_id: args.subjectId ?? null,
          p_answers: args.answers ?? {},
        }),
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
        await call("ari_flow_run_lease", {
          p_run_id: runId,
          p_user_id: userId,
          p_lease_token: token,
          p_ttl_seconds: ttlSeconds,
        }),
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
        await call("ari_flow_run_advance", {
          p_run_id: runId,
          p_lease_token: token,
          p_expected_revision: expectedRevision,
          p_patch: patch,
        }),
        "ari_flow_run_advance",
      );
    },
    async release(runId, token) {
      await call("ari_flow_run_release", {
        p_run_id: runId,
        p_lease_token: token,
      });
    },
    async getForConversation(conversationId) {
      const data = await call("ari_flow_run_get", {
        p_user_id: userId,
        p_run_id: null,
        p_conversation_id: conversationId,
      });
      return data === null ? null : parseFlowRun(data);
    },
    async getById(runId) {
      const data = await call("ari_flow_run_get", {
        p_user_id: userId,
        p_run_id: runId,
        p_conversation_id: null,
      });
      return data === null ? null : parseFlowRun(data);
    },
  };
}
