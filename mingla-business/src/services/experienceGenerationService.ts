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
  // META-ORCH-1009 Sub-E (C2): true when the row is still DB-`pending` but past
  // its expiry. The Hub renders a regenerate / re-snap CTA for these instead of
  // hiding them, so Sarah never sees an empty list where a dead card used to be.
  isExpired: boolean;
}

export async function fetchPendingExperiencesForBrand(
  brandId: string,
): Promise<HubPendingExperienceRow[]> {
  // META-ORCH-1009 Sub-E (C2 / SPEC §11.4): do NOT filter expired rows out.
  // Previously `.gt("expires_at", now)` hid them, so an expired proposal
  // silently vanished; now we keep `pending` rows and flag expiry client-side
  // so the card can show a regenerate CTA. The 15-min pg_cron sweep
  // (expire_agent_pending_actions) eventually flips truly-stale rows to
  // `expired`, which this `status = pending` filter then excludes — the window
  // between expiry and the sweep is exactly when the regenerate CTA matters.
  const nowMs = Date.now();
  const { data, error } = await supabase
    .from("agent_pending_actions")
    .select("id, tool_name, tool_args, status, expires_at, created_at")
    .eq("related_brand_id", brandId)
    .eq("source", "hub_experience")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>): HubPendingExperienceRow => {
    const expiresAt = r.expires_at as string;
    return {
      id: r.id as string,
      tool_name: r.tool_name as string,
      tool_args: (r.tool_args as Record<string, unknown>) ?? {},
      status: r.status as string,
      expires_at: expiresAt,
      created_at: r.created_at as string,
      isExpired: expiresAt ? new Date(expiresAt).getTime() < nowMs : false,
    };
  });
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
