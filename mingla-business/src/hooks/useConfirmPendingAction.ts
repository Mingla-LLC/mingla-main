/**
 * ORCH-0821 — useConfirmPendingAction
 * Confirms or cancels a pending Ari action. On success, invalidates the
 * relevant cache entries (messages + the brand/event lists most likely to
 * be affected by the executed write).
 */

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  AgentConfirmResponse,
  cancelAgentAction,
  confirmAgentAction,
} from "../services/agentChatService";
import { agentQueryKeys } from "./useAgentChat";

export interface UseConfirmPendingActionResult {
  confirm: (
    pending_action_id: string,
    edited_args?: Record<string, unknown>,
  ) => Promise<AgentConfirmResponse>;
  cancel: (pending_action_id: string) => Promise<AgentConfirmResponse>;
  isExecuting: boolean;
}

export function useConfirmPendingAction(
  conversationId: string | null,
): UseConfirmPendingActionResult {
  const qc = useQueryClient();

  const confirmMutation = useMutation({
    mutationFn: (args: { pending_action_id: string; edited_args?: Record<string, unknown> }) =>
      confirmAgentAction(args),
    onSuccess: (response) => {
      qc.invalidateQueries({ queryKey: agentQueryKeys.messages(conversationId) });
      if (response.kind === "executed") {
        // Invalidate downstream caches that other parts of the app rely on.
        // (These keys are owned by elsewhere in the app; we invalidate broadly
        // because tool writes may affect brands or events lists.)
        if (
          response.tool_name === "create_brand" ||
          response.tool_name === "update_brand" ||
          response.tool_name === "delete_brand"
        ) {
          qc.invalidateQueries({ queryKey: ["brands"] });
        }
        if (response.tool_name === "create_event" || response.tool_name === "update_event") {
          qc.invalidateQueries({ queryKey: ["events"] });
        }
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (pending_action_id: string) => cancelAgentAction(pending_action_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: agentQueryKeys.messages(conversationId) });
    },
  });

  const confirm = useCallback(
    (pending_action_id: string, edited_args?: Record<string, unknown>) =>
      confirmMutation.mutateAsync({ pending_action_id, edited_args }),
    [confirmMutation],
  );

  const cancel = useCallback(
    (pending_action_id: string) => cancelMutation.mutateAsync(pending_action_id),
    [cancelMutation],
  );

  return {
    confirm,
    cancel,
    isExecuting: confirmMutation.isPending || cancelMutation.isPending,
  };
}
