import type { AgentMessage } from "./agentChatService";

export function isAriFailureMessageForTurn(
  message: AgentMessage,
  clientTurnId: string,
): boolean {
  const failure = (message.content as {
    structured?: { failure?: { v?: unknown } };
  })?.structured?.failure;
  return message.role === "assistant" &&
    message.client_turn_id === clientTurnId && failure?.v === 1;
}

export function isAriFailureMessageForPending(
  message: AgentMessage,
  pendingActionId: string,
): boolean {
  return message.role === "assistant" &&
    (message.content as { failure_for_pending_action_id?: unknown })
        ?.failure_for_pending_action_id === pendingActionId;
}
