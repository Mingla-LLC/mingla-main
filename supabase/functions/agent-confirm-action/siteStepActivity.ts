/**
 * #4453 Website workspace — a confirmed plan's progress, one activity row per
 * step, on the turn that proposed it (the Host follows that turn's
 * `agent_activity_events` over Realtime, exactly as it follows a chat turn).
 *
 * Kinds: `site_step_started`, `site_step_done`, `site_step_failed`. Each row
 * carries `{ group_id, index, total, label }` (and `reason`, `rolled_back` on
 * a failure) in `detail` when the database function takes `p_detail`; when it
 * does not yet, the row is written without it, and the Host reads the step
 * from the order of the rows (the nth `site_step_started` is step n) and the
 * label from the plan it already holds.
 *
 * Progress is a courtesy: nothing here can fail, slow or undo a change.
 * Kept out of index.ts so tests can run it without starting the server.
 */

// deno-lint-ignore-file no-explicit-any

import type { SiteStepActivity } from "../_shared/agentSiteWorkspaceTools.ts";
import { isMissingRpc } from "./pendingClaim.ts";

interface ActivityClient {
  rpc: (fn: string, args: Record<string, unknown>) => any;
  from: (table: string) => any;
}

type Attempt = { id: string; attempt_number: number } | null;

async function proposingAttempt(args: {
  client: ActivityClient;
  userId: string;
  conversationId: string;
  pendingActionId: string;
}): Promise<Attempt> {
  const { data: proposal } = await args.client.from("agent_messages")
    .select("client_turn_id")
    .eq("user_id", args.userId)
    .eq("conversation_id", args.conversationId)
    .eq("role", "assistant")
    .contains("tool_calls", { pending_action_id: args.pendingActionId })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (typeof proposal?.client_turn_id !== "string") return null;
  const { data: attempt } = await args.client.from("agent_turn_attempts")
    .select("id,attempt_number")
    .eq("user_id", args.userId)
    .eq("conversation_id", args.conversationId)
    .eq("client_turn_id", proposal.client_turn_id)
    .maybeSingle();
  return attempt &&
      typeof attempt.id === "string" &&
      Number.isInteger(attempt.attempt_number)
    ? { id: attempt.id, attempt_number: attempt.attempt_number }
    : null;
}

/** The writer agent-confirm-action hands the change-set executor. */
export function siteStepActivityWriter(args: {
  client: ActivityClient;
  userId: string;
  conversationId: string | null;
  pendingActionId: string;
  now?: () => string;
}): (event: SiteStepActivity) => Promise<void> {
  let attempt: Promise<Attempt> | null = null;
  // Decided by the first write: does the function take p_detail?
  let detailSupported = true;
  return async (event) => {
    const conversationId = args.conversationId;
    if (!conversationId) return;
    try {
      attempt ??= proposingAttempt({ ...args, conversationId }).catch(() =>
        null
      );
      const owner = await attempt;
      if (!owner) return;
      const base = {
        p_attempt_id: owner.id,
        p_user_id: args.userId,
        p_attempt_number: owner.attempt_number,
        p_event_type: event.type,
        p_now: (args.now ?? (() => new Date().toISOString()))(),
      };
      let error: { code?: unknown; message?: unknown } | null = null;
      if (detailSupported) {
        ({ error } = await args.client.rpc("append_agent_activity_event", {
          ...base,
          p_detail: event.detail,
        }));
        if (error && isMissingRpc(error)) {
          detailSupported = false;
          error = null;
        } else if (!error) return;
      }
      if (!detailSupported) {
        ({ error } = await args.client.rpc(
          "append_agent_activity_event",
          base,
        ));
      }
      if (error) {
        console.error(JSON.stringify({
          event: "ari_activity_write_failed",
          phase: event.type,
        }));
      }
    } catch {
      console.error(JSON.stringify({
        event: "ari_activity_write_failed",
        phase: event.type,
      }));
    }
  };
}
