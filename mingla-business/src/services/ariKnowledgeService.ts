/** Issue #3355 — host-visible Ari memory and durable task controls. */

import { supabase } from "./supabase";

export type AriMemoryKind =
  "preference" | "correction" | "business_fact" | "workflow";

export interface AriMemoryNote {
  id: string;
  brand_id: string | null;
  kind: AriMemoryKind;
  content: string;
  confidence: number;
  updated_at: string;
}

export type AriJobStatus =
  | "queued"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface AriAgentJob {
  id: string;
  brand_id: string | null;
  conversation_id: string | null;
  goal_summary: string;
  status: AriJobStatus;
  checkpoint: Record<string, unknown>;
  completed_step_keys: string[];
  pending_step_keys: string[];
  last_error_code: string | null;
  revision: number;
  updated_at: string;
}

function rpcError(error: { message?: string; code?: string } | null): Error {
  return new Error(error?.message || error?.code || "ARI_CONTROL_UNAVAILABLE");
}

export async function listAriMemory(
  brandId: string | null,
): Promise<AriMemoryNote[]> {
  const { data, error } = await supabase.rpc(
    "ari_memory_list" as never,
    { p_brand_id: brandId } as never,
  );
  if (error) throw rpcError(error);
  return Array.isArray(data) ? (data as unknown as AriMemoryNote[]) : [];
}

export async function saveAriMemory(input: {
  brandId: string | null;
  kind: AriMemoryKind;
  content: string;
}): Promise<AriMemoryNote> {
  const { data, error } = await supabase.rpc(
    "ari_memory_save" as never,
    {
      p_brand_id: input.brandId,
      p_kind: input.kind,
      p_content: input.content,
      p_evidence_message_id: null,
    } as never,
  );
  if (error || !data) throw rpcError(error);
  return data as unknown as AriMemoryNote;
}

export async function updateAriMemory(input: {
  noteId: string;
  brandId: string | null;
  kind: AriMemoryKind;
  content: string;
}): Promise<AriMemoryNote> {
  const { data, error } = await supabase.rpc(
    "ari_memory_update" as never,
    {
      p_note_id: input.noteId,
      p_brand_id: input.brandId,
      p_kind: input.kind,
      p_content: input.content,
    } as never,
  );
  if (error || !data) throw rpcError(error);
  return data as unknown as AriMemoryNote;
}

export async function forgetAriMemory(noteId: string): Promise<void> {
  const { error } = await supabase.rpc(
    "ari_memory_forget" as never,
    { p_note_id: noteId } as never,
  );
  if (error) throw rpcError(error);
}

export async function listAriJobs(): Promise<AriAgentJob[]> {
  const { data, error } = await supabase.rpc(
    "ari_manage_agent_job" as never,
    {
      p_action: "list",
      p_job_id: null,
      p_brand_id: null,
      p_conversation_id: null,
      p_idempotency_key: null,
      p_expected_revision: null,
      p_patch: {},
    } as never,
  );
  if (error) throw rpcError(error);
  return Array.isArray(data) ? (data as unknown as AriAgentJob[]) : [];
}

export async function controlAriJob(input: {
  jobId: string;
  revision: number;
  action: "pause" | "resume" | "cancel";
}): Promise<AriAgentJob> {
  const { data, error } = await supabase.rpc(
    "ari_manage_agent_job" as never,
    {
      p_action: input.action,
      p_job_id: input.jobId,
      p_brand_id: null,
      p_conversation_id: null,
      p_idempotency_key: null,
      p_expected_revision: input.revision,
      p_patch: {},
    } as never,
  );
  if (error || !data) throw rpcError(error);
  return data as unknown as AriAgentJob;
}
