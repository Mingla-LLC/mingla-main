/**
 * issue #3605 — the two shapes Gemini 3 refuses, repaired before they are sent.
 *
 * Ari runs on `gemini-3.6-flash`. Two rules of the 3.x function-calling
 * contract are not expressible in the transcript Ari stores, and production
 * proved both of them on 2026-09-28:
 *
 *  1. "Function call is missing a thought_signature in functionCall parts."
 *     A 3.x model returns an opaque `thoughtSignature` on every functionCall
 *     part. Echoing that call back WITHOUT the signature is a hard HTTP 400.
 *     agent-chat rebuilt the call by hand (name + args) for the follow-up
 *     summary turn, so EVERY inline read 400'd on its second hop, `followup`
 *     fell back to undefined, and the user got the bare string
 *     "Here's what I found." with the data stranded in structured content.
 *
 *  2. "Please ensure that function response turn comes immediately after a
 *     function call turn." Only a `role='tool'` row is persisted for an inline
 *     read (`append_agent_chat_tool_result` writes one row and no matching
 *     assistant/tool_calls row), so the rebuilt history carries a
 *     functionResponse with no functionCall in front of it. It survived while
 *     a user turn happened to sit at the head of the 10-message window; the
 *     moment the window slid so that the head WAS the orphan, every turn in
 *     that conversation 400'd — which is why "change the SEO description"
 *     failed twice and no Ari write ever reached brand-site-control.
 *
 * Both rules are about the SHAPE of `contents`, so both are enforced here, in
 * one pass, on the way out of `callGemini`. Nothing upstream has to remember
 * them.
 *
 * Repair, never drop: an unusable functionCall/functionResponse part is
 * rewritten as a plain text part carrying the same information, so the model
 * still sees what it already knew. Dropping it would silently lose the read
 * the user just paid for. The rewritten text is explicitly NOT wrapped in
 * <user_data> — it is Mingla's own tool activity, not user-authored content,
 * and I-ARI-USER-DATA-WRAP must not be diluted by wrapping system text in it.
 */

import type { GeminiContentMessage } from "./agentGemini.ts";

export interface GeminiContentsRepairCounts {
  /** functionCall parts rewritten because they carried no thought signature. */
  unsignedCalls: number;
  /** functionResponse parts rewritten because no call turn preceded them. */
  orphanResponses: number;
}

export interface GeminiContentsRepair {
  contents: GeminiContentMessage[];
  repairs: GeminiContentsRepairCounts;
}

type Part = GeminiContentMessage["parts"][number];

function isFunctionCallPart(
  part: Part,
): part is { functionCall: { name: string; args: Record<string, unknown> } } & {
  thoughtSignature?: string;
} {
  return typeof part === "object" && part !== null && "functionCall" in part &&
    !!(part as { functionCall?: unknown }).functionCall;
}

function isFunctionResponsePart(
  part: Part,
): part is {
  functionResponse: { name: string; response: Record<string, unknown> };
} {
  return typeof part === "object" && part !== null &&
    "functionResponse" in part &&
    !!(part as { functionResponse?: unknown }).functionResponse;
}

function signatureOf(part: Part): string | null {
  const direct = (part as { thoughtSignature?: unknown }).thoughtSignature;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const nested = (part as {
    functionCall?: { thoughtSignature?: unknown };
  }).functionCall?.thoughtSignature;
  return typeof nested === "string" && nested.length > 0 ? nested : null;
}

/** Never throws on a cyclic or non-serialisable value; the prompt still ships. */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null) ?? "null";
  } catch {
    return "null";
  }
}

/**
 * Enforce, in order:
 *   - no functionCall part without a thought signature;
 *   - no functionResponse part that is not immediately preceded by an EMITTED
 *     functionCall turn naming the same tool.
 *
 * The second rule reads the emitted output, not the input, so a call that this
 * pass just downgraded to text also downgrades its own response — the pair
 * never half-survives.
 */
export function repairGeminiContents(
  contents: readonly GeminiContentMessage[],
): GeminiContentsRepair {
  const out: GeminiContentMessage[] = [];
  const repairs: GeminiContentsRepairCounts = {
    unsignedCalls: 0,
    orphanResponses: 0,
  };
  // Tool names whose functionCall SURVIVED into the last emitted content.
  let callableNames = new Set<string>();

  for (const content of contents) {
    const parts: Part[] = [];
    const emittedCalls = new Set<string>();
    for (const part of content.parts) {
      if (isFunctionCallPart(part)) {
        if (signatureOf(part) === null) {
          repairs.unsignedCalls++;
          parts.push({
            text: `[mingla_tool_call name=${part.functionCall.name}] ${
              safeJson(part.functionCall.args)
            }`,
          });
          continue;
        }
        emittedCalls.add(part.functionCall.name);
        parts.push(part);
        continue;
      }
      if (isFunctionResponsePart(part)) {
        const name = part.functionResponse.name;
        if (!callableNames.has(name)) {
          repairs.orphanResponses++;
          parts.push({
            text: `[mingla_tool_result name=${name}] ${
              safeJson(part.functionResponse.response)
            }`,
          });
          continue;
        }
        parts.push(part);
        continue;
      }
      parts.push(part);
    }
    // A content whose every part vanished would be an empty turn, which Gemini
    // also refuses. Repair never empties a content (every branch pushes), but
    // an empty input content must not be propagated either.
    if (parts.length === 0) continue;
    out.push({ role: content.role, parts });
    callableNames = emittedCalls;
  }

  return { contents: out, repairs };
}

/**
 * The call site's convenience wrapper: repaired contents, and one audible line
 * when anything had to be repaired. Failing closed and silent would read as
 * "the transcript was fine all along" — #3605 was invisible for exactly that
 * reason, because the follow-up's catch swallowed the 400 without a log.
 */
export function sanitizeGeminiContents(
  contents: readonly GeminiContentMessage[],
): GeminiContentMessage[] {
  const { contents: repaired, repairs } = repairGeminiContents(contents);
  if (repairs.unsignedCalls > 0 || repairs.orphanResponses > 0) {
    console.warn(
      "[agentGeminiContents] repaired gemini contents",
      JSON.stringify({
        fn: "agentGeminiContents",
        issue: "3605",
        unsigned_calls: repairs.unsignedCalls,
        orphan_responses: repairs.orphanResponses,
        content_count: repaired.length,
      }),
    );
  }
  return repaired;
}
