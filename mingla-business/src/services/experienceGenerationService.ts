/**
 * ORCH-0881 — Ve5 menu snap + pending experience confirm/cancel client.
 */

import {
  cancelAgentAction,
  confirmAgentAction,
  type AgentConfirmResponse,
} from "./agentChatService";
import { supabase } from "./supabase";

export interface ExperienceFilePayload {
  mime_type: "image/jpeg" | "image/png" | "application/pdf";
  data_base64: string;
}

/** @deprecated Use ExperienceFilePayload */
export type MenuFilePayload = ExperienceFilePayload;

export interface PendingExperienceProposal {
  id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  expires_at: string;
}

export type ParseMenuResponse =
  | {
    kind: "ok";
    pending_actions: PendingExperienceProposal[];
    experiences_count: number;
  }
  | { kind: "error"; code: string; message: string };

export type ParseExperienceResponse = ParseMenuResponse;

async function invokeExperienceParser(
  functionName: "parse-restaurant-menu" | "parse-play-activities",
  args: { brand_id: string; files: ExperienceFilePayload[] },
  fallbackMessage: string,
): Promise<ParseExperienceResponse> {
  const { data, error } = await supabase.functions.invoke<ParseExperienceResponse>(
    functionName,
    { body: args },
  );
  if (error) {
    const message = error.message ?? fallbackMessage;
    return { kind: "error", code: "EDGE_ERROR", message };
  }
  if (!data) {
    return { kind: "error", code: "EMPTY", message: "Empty response from server" };
  }
  return data;
}

export async function parseRestaurantMenu(args: {
  brand_id: string;
  files: ExperienceFilePayload[];
}): Promise<ParseExperienceResponse> {
  return invokeExperienceParser(
    "parse-restaurant-menu",
    args,
    "Couldn't read your menu — try again",
  );
}

export async function parsePlayActivities(args: {
  brand_id: string;
  files: ExperienceFilePayload[];
}): Promise<ParseExperienceResponse> {
  return invokeExperienceParser(
    "parse-play-activities",
    args,
    "Couldn't read your activities list — try again",
  );
}

export interface HubPendingExperienceRow {
  id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  status: string;
  expires_at: string;
  created_at: string;
}

export async function fetchPendingExperiencesForBrand(
  brandId: string,
): Promise<HubPendingExperienceRow[]> {
  const { data, error } = await supabase
    .from("agent_pending_actions")
    .select("id, tool_name, tool_args, status, expires_at, created_at")
    .eq("related_brand_id", brandId)
    .eq("source", "hub_experience")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as HubPendingExperienceRow[];
}

export async function confirmExperienceProposal(
  pending_action_id: string,
  edited_args?: Record<string, unknown>,
): Promise<AgentConfirmResponse> {
  return confirmAgentAction({ pending_action_id, edited_args });
}

export async function rejectExperienceProposal(
  pending_action_id: string,
): Promise<AgentConfirmResponse> {
  return cancelAgentAction(pending_action_id);
}
