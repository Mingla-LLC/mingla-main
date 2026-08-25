/**
 * ORCH-0821 — useConfirmPendingAction
 * Confirms or cancels a pending Ari action. On success, invalidates the
 * relevant cache entries (messages + the brand/event lists most likely to
 * be affected by the executed write).
 */

import { useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  AgentConfirmResponse,
  cancelAgentAction,
  confirmAgentAction,
} from "../services/agentChatService";
import {
  canDispatchAriIntent,
  createAriClientIntent,
  reduceAriClientIntent,
} from "../services/agentReliability";
import { useShareNetworkState } from "../components/ui/useShareNetworkState";
import { agentQueryKeys } from "./useAgentChat";
import { brandKeys } from "./brandKeys";
import { creatorAccountKeys } from "./creatorAccountKeys";
import { brandHoursKeys } from "./useBrandHours";
import { brandDiscoveryCurrencyKeys } from "./useBrandDiscoveryCurrency";
import { venueAvailabilityKeys } from "./useVenueAvailability";

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
  const online = useShareNetworkState();
  const intentRef = useRef<ReturnType<typeof createAriClientIntent> | null>(null);

  const confirmMutation = useMutation({
    mutationFn: (args: { pending_action_id: string; edited_args?: Record<string, unknown> }) =>
      confirmAgentAction(args),
    onSuccess: (response) => {
      qc.invalidateQueries({ queryKey: agentQueryKeys.messages(conversationId) });
      if (response.kind === "executed") {
        const result = response.result as {
          brand?: { id?: string };
          brand_id?: string;
          venue_id?: string;
        } | null;
        const brandId = typeof result?.brand?.id === "string"
          ? result.brand.id
          : typeof result?.brand_id === "string"
            ? result.brand_id
            : null;
        // Invalidate downstream caches that other parts of the app rely on.
        // (These keys are owned by elsewhere in the app; we invalidate broadly
        // because tool writes may affect brands or events lists.)
        if (
          response.tool_name === "create_brand" ||
          response.tool_name === "update_brand" ||
          response.tool_name === "delete_brand"
        ) {
          qc.invalidateQueries({ queryKey: brandKeys.all });
          if (brandId) {
            qc.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
          }
          if (
            response.tool_name === "create_brand" ||
            response.tool_name === "delete_brand"
          ) {
            qc.invalidateQueries({ queryKey: creatorAccountKeys.all });
          }
        }
        if (response.tool_name === "manage_brand_hours" && brandId) {
          qc.invalidateQueries({ queryKey: brandHoursKeys.byBrand(brandId) });
          qc.invalidateQueries({ queryKey: venueAvailabilityKeys.config(brandId) });
        }
        if (response.tool_name === "manage_brand_discovery_currency") {
          qc.invalidateQueries({ queryKey: brandDiscoveryCurrencyKeys.all });
          if (brandId) qc.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
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
    async (pending_action_id: string, edited_args?: Record<string, unknown>) => {
      const intent = createAriClientIntent({
        intent: "confirm",
        conversationId,
        brandId: null,
        pendingActionId: pending_action_id,
        argsVersion: 1,
      });
      const current = intentRef.current?.stableId === pending_action_id
        ? intentRef.current
        : intent;
      const gate = canDispatchAriIntent(current, online !== false);
      if (!gate.allowed) {
        return {
          kind: "error" as const,
          code: gate.reason === "offline" ? "OFFLINE" : "IN_FLIGHT",
          message: gate.reason === "offline"
            ? "You are offline. Your request is still here for you to retry."
            : "Ari is already working on that request.",
        };
      }
      intentRef.current = reduceAriClientIntent(current, { type: "dispatch_started" });
      const response = await confirmMutation.mutateAsync({ pending_action_id, edited_args });
      if (intentRef.current?.stableId === pending_action_id) {
        intentRef.current = {
          ...intentRef.current,
          state: response.kind === "error" ? "uncertain" : "terminal",
          lastCode: response.kind === "error" ? response.code : "CANONICAL_READBACK_MATCHED",
        };
      }
      return response;
    },
    [confirmMutation, conversationId, online],
  );

  const cancel = useCallback(
    async (pending_action_id: string) => {
      const intent = createAriClientIntent({
        intent: "cancel",
        conversationId,
        brandId: null,
        pendingActionId: pending_action_id,
        argsVersion: 1,
      });
      const current = intentRef.current?.stableId === pending_action_id
        ? intentRef.current
        : intent;
      const gate = canDispatchAriIntent(current, online !== false);
      if (!gate.allowed) {
        return {
          kind: "error" as const,
          code: gate.reason === "offline" ? "OFFLINE" : "IN_FLIGHT",
          message: gate.reason === "offline"
            ? "You are offline. Your request is still here for you to retry."
            : "Ari is already working on that request.",
        };
      }
      intentRef.current = reduceAriClientIntent(current, { type: "dispatch_started" });
      const response = await cancelMutation.mutateAsync(pending_action_id);
      if (intentRef.current?.stableId === pending_action_id) {
        intentRef.current = {
          ...intentRef.current,
          state: response.kind === "error" ? "uncertain" : "terminal",
          lastCode: response.kind === "error" ? response.code : "ACTION_CANCELLED",
        };
      }
      return response;
    },
    [cancelMutation, conversationId, online],
  );

  return {
    confirm,
    cancel,
    isExecuting: confirmMutation.isPending || cancelMutation.isPending,
  };
}
