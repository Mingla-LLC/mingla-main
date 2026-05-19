/**
 * ORCH-0881 — Ve5 menu snap + pending experience confirm/cancel client.
 */

import {
  cancelAgentAction,
  confirmAgentAction,
  type AgentConfirmResponse,
} from "./agentChatService";
import { supabase } from "./supabase";

export interface MenuFilePayload {
  mime_type: "image/jpeg" | "image/png" | "application/pdf";
  data_base64: string;
}

export interface PendingExperienceProposal {
  id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
}

export type ParseMenuResponse =
  | {
    kind: "ok";
    pending_actions: PendingExperienceProposal[];
    experiences_count: number;
  }
  | { kind: "error"; code: string; message: string };

export async function parseRestaurantMenu(args: {
  brand_id: string;
  files: MenuFilePayload[];
}): Promise<ParseMenuResponse> {
  const { data, error } = await supabase.functions.invoke<ParseMenuResponse>(
    "parse-restaurant-menu",
    { body: args },
  );
  if (error) {
    const message = error.message ?? "Couldn't read your menu — try again";
    return { kind: "error", code: "EDGE_ERROR", message };
  }
  if (!data) {
    return { kind: "error", code: "EMPTY", message: "Empty response from server" };
  }
  return data;
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
