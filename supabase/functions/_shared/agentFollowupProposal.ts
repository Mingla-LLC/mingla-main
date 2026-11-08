// #4304 — after Ari runs a read (e.g. list_discounts) its follow-up model call
// may answer with the write it was asked for (end_discount, create_discount).
// That call used to be dropped: the turn ended as "Here's what I found." and
// the Host had to say "yes" again. This decides when the follow-up's tool call
// becomes the turn's proposal; agent-chat then runs it through the same
// write-proposal path as a first-pass write.

export interface FollowupToolCall {
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
}

export interface FollowupProposal<T> {
  tool: T;
  toolCall: FollowupToolCall;
}

/**
 * Returns the follow-up's tool call when it is a known, non-read-only tool and
 * the turn is not a read interruption of an active event plan. A second read,
 * an unknown tool, no tool call, or a read interruption returns null, and the
 * turn stays a text turn as before.
 */
export function followupProposal<T extends { name: string }>(
  followup: { toolCall?: FollowupToolCall } | undefined | null,
  findTool: (name: string) => T | undefined,
  isReadOnly: (toolName: string, args: Record<string, unknown>) => boolean,
  readInterruption: boolean,
): FollowupProposal<T> | null {
  if (readInterruption) return null;
  const call = followup?.toolCall;
  if (!call || typeof call.name !== "string") return null;
  const tool = findTool(call.name);
  if (!tool) return null;
  const args = call.args !== null && typeof call.args === "object" &&
      !Array.isArray(call.args)
    ? call.args
    : {};
  if (isReadOnly(tool.name, args)) return null;
  return {
    tool,
    toolCall: {
      name: tool.name,
      args,
      ...(call.thoughtSignature
        ? { thoughtSignature: call.thoughtSignature }
        : {}),
    },
  };
}
