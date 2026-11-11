// Issue #3355 — bounded observe/reason/act loop. Reads and agent-state writes
// may continue inside the turn; the first domain write is returned as a
// proposal so the existing confirmation authority remains unchanged.

export interface AgentLoopToolCall {
  name: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
}

export interface AgentLoopModelResult {
  textResponse?: string;
  toolCalls: AgentLoopToolCall[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface AgentLoopObservation {
  tool: string;
  args: Record<string, unknown>;
  thoughtSignature?: string;
  result?: unknown;
  /**
   * #3355 Wave B (B4): a failed call is an observation the model reasons
   * over — the code, the detail, the host-facing reason and the next step
   * (a Host screen from the App Map or another tool).
   */
  error?: AgentLoopToolErrorObservation;
  elapsedMs: number;
}

export interface AgentLoopToolErrorObservation {
  code: string;
  message: string;
  user_reason?: string;
  next_step?: unknown;
}

export interface AgentLoopNormalizedError {
  code: string;
  message: string;
  recoverable: boolean;
  user_reason?: string;
  next_step?: unknown;
}

function errorObservation(
  normal: AgentLoopNormalizedError,
): AgentLoopToolErrorObservation {
  return {
    code: normal.code,
    message: normal.message,
    ...(normal.user_reason !== undefined
      ? { user_reason: normal.user_reason }
      : {}),
    ...(normal.next_step !== undefined ? { next_step: normal.next_step } : {}),
  };
}

export interface AgentLoopProposalValidationIssue {
  code: string;
  message: string;
}

export interface AgentLoopBudget {
  maxSteps: number;
  maxModelCalls: number;
  maxToolCalls: number;
  maxConsecutiveErrors: number;
  deadlineMs: number;
}

export const DEFAULT_AGENT_LOOP_BUDGET: AgentLoopBudget = Object.freeze({
  maxSteps: 6,
  maxModelCalls: 7,
  maxToolCalls: 12,
  // Two independent read lanes may fail together (for example search plus a
  // stale public URL). Give the model one final reasoning turn to preserve the
  // completed plan and state the evidence gap instead of stopping mid-task.
  maxConsecutiveErrors: 3,
  deadlineMs: 55_000,
});

// #3355 Wave C (C3): agent-chat's production budget, tuned for Gemini Flash
// (D2b). Before this, production fell through to DEFAULT_AGENT_LOOP_BUDGET
// (12 tool calls) and only the local lane had an explicit budget.
//
// MINGLA-INVARIANT: I-ARI-PRODUCTION-LOOP-BUDGET | issue #3355 | With the local-model lane off, agent-chat runs at most 6 steps, 7 model calls and 5 model-chosen tool calls (plus the turn's required deterministic pre-reads) inside the 55 s deadline, and the deadline still stops the loop first. Enforced by supabase/functions/_shared/__tests__/issue_3355_wave_c_loop_budget.implementor.test.ts
export const ARI_PRODUCTION_LOOP_BUDGET: AgentLoopBudget = Object.freeze({
  maxSteps: 6,
  maxModelCalls: 7,
  maxToolCalls: 5,
  maxConsecutiveErrors: DEFAULT_AGENT_LOOP_BUDGET.maxConsecutiveErrors,
  deadlineMs: 55_000,
});

/** The loopback lane's budget (#3355 local verification), unchanged. */
export const ARI_LOCAL_LOOP_BUDGET: Partial<AgentLoopBudget> = Object.freeze({
  deadlineMs: 115_000,
  maxSteps: 9,
  maxModelCalls: 10,
  maxToolCalls: 8,
});

/**
 * agent-chat's budget. `requiredReads` are the turn's deterministic pre-reads
 * (initialCalls plus any expanded page reads); they run before the model and
 * would otherwise use up the 5 tool calls the model may choose.
 */
export function ariChatLoopBudget(args: {
  localModelEnabled: boolean;
  requiredReads?: number;
}): Partial<AgentLoopBudget> {
  if (args.localModelEnabled) return { ...ARI_LOCAL_LOOP_BUDGET };
  const required = Math.max(0, Math.floor(args.requiredReads ?? 0));
  return {
    ...ARI_PRODUCTION_LOOP_BUDGET,
    maxToolCalls: ARI_PRODUCTION_LOOP_BUDGET.maxToolCalls + required,
  };
}

export type AgentLoopResult =
  | {
    kind: "text";
    text: string;
    observations: AgentLoopObservation[];
    usage: { input: number; output: number; calls: number };
    exhausted: boolean;
  }
  | {
    kind: "proposal";
    toolCall: AgentLoopToolCall;
    observations: AgentLoopObservation[];
    usage: { input: number; output: number; calls: number };
    exhausted: false;
  }
  | {
    kind: "stopped";
    reason: "cancelled" | "deadline" | "budget" | "errors";
    observations: AgentLoopObservation[];
    usage: { input: number; output: number; calls: number };
    exhausted: boolean;
  };

export async function runAgentLoop(args: {
  budget?: Partial<AgentLoopBudget>;
  initialCalls?: AgentLoopToolCall[];
  /**
   * Deterministic read-only lanes may already have a complete, cited answer
   * after their required initial reads. Returning text here avoids an
   * unnecessary second reasoning call without changing tool authorization or
   * write-confirmation behavior. `null` keeps the ordinary observe/reason loop.
   */
  completeAfterInitialReads?: (
    observations: readonly AgentLoopObservation[],
  ) => string | null;
  /**
   * Derive additional required reads from an initial discovery result before
   * the first model call. This is how research opens returned pages instead of
   * asking the model to rediscover URLs or narrate a search index as evidence.
   */
  expandInitialReads?: (
    observations: readonly AgentLoopObservation[],
  ) => AgentLoopToolCall[];
  /**
   * A model may narrate search results before doing a required page read.
   * Return the missing read calls here to enforce the evidence contract; an
   * empty list accepts the text. Calls still pass through the normal tool
   * classifier, budget, cancellation and executor boundaries below.
   */
  recoverReadsFromPrematureText?: (
    text: string,
    observations: readonly AgentLoopObservation[],
  ) => AgentLoopToolCall[];
  callModel: (
    observations: readonly AgentLoopObservation[],
    step: number,
  ) => Promise<AgentLoopModelResult>;
  classifyTool: (
    call: AgentLoopToolCall,
  ) => "read" | "agent_state" | "write" | "unknown";
  /** A failed proposal check is returned to the model for a bounded repair. */
  validateProposal?: (
    call: AgentLoopToolCall,
  ) =>
    | AgentLoopProposalValidationIssue
    | null
    | Promise<
      AgentLoopProposalValidationIssue | null
    >;
  /** Reject false completion text and give the model one bounded repair turn. */
  validateFinalText?: (
    text: string,
    observations: readonly AgentLoopObservation[],
  ) =>
    | AgentLoopProposalValidationIssue
    | null
    | Promise<
      AgentLoopProposalValidationIssue | null
    >;
  executeTool: (call: AgentLoopToolCall) => Promise<unknown>;
  isCancelled?: () => Promise<boolean>;
  onProgress?: (
    event: { phase: string; step: number; tool?: string },
  ) => Promise<void> | void;
  normalizeError?: (error: unknown) => AgentLoopNormalizedError;
}): Promise<AgentLoopResult> {
  const budget = { ...DEFAULT_AGENT_LOOP_BUDGET, ...(args.budget ?? {}) };
  const started = Date.now();
  const observations: AgentLoopObservation[] = [];
  let modelCalls = 0;
  let toolCalls = 0;
  let consecutiveErrors = 0;
  let finalTextRepairAttempts = 0;
  let input = 0;
  let output = 0;
  const usage = () => ({ input, output, calls: modelCalls });

  // Required readbacks for deterministic workflows run before the first model
  // turn. They use the exact same executor, cancellation and error budget as
  // model-selected reads, so this is orchestration—not a privileged side path.
  for (const call of args.initialCalls ?? []) {
    if (toolCalls >= budget.maxToolCalls) {
      return {
        kind: "stopped",
        reason: "budget",
        observations,
        usage: usage(),
        exhausted: true,
      };
    }
    if (await args.isCancelled?.()) {
      return {
        kind: "stopped",
        reason: "cancelled",
        observations,
        usage: usage(),
        exhausted: false,
      };
    }
    const classification = args.classifyTool(call);
    if (classification !== "read" && classification !== "agent_state") {
      observations.push({
        tool: call.name,
        args: call.args,
        error: {
          code: "UNKNOWN_TOOL",
          message: "That required read capability is unavailable.",
        },
        elapsedMs: 0,
      });
      consecutiveErrors += 1;
      continue;
    }
    toolCalls += 1;
    await args.onProgress?.({
      phase: classification === "read" ? "read" : "plan",
      step: 0,
      tool: call.name,
    });
    const toolStarted = Date.now();
    try {
      const result = await args.executeTool(call);
      observations.push({
        tool: call.name,
        args: call.args,
        result,
        elapsedMs: Date.now() - toolStarted,
      });
      consecutiveErrors = 0;
    } catch (error) {
      const normal: AgentLoopNormalizedError = args.normalizeError?.(error) ?? {
        code: "TOOL_FAILED",
        message: error instanceof Error ? error.message : "The tool failed.",
        recoverable: true,
      };
      observations.push({
        tool: call.name,
        args: call.args,
        error: errorObservation(normal),
        elapsedMs: Date.now() - toolStarted,
      });
      if (
        !normal.recoverable ||
        ++consecutiveErrors >= budget.maxConsecutiveErrors
      ) {
        return {
          kind: "stopped",
          reason: "errors",
          observations,
          usage: usage(),
          exhausted: false,
        };
      }
    }
  }

  // Discovery reads can reveal the exact safe URLs required for the next
  // evidence step. They still pass through the same classification, budget,
  // cancellation, executor and error handling as the original required reads.
  for (const call of args.expandInitialReads?.(observations) ?? []) {
    if (toolCalls >= budget.maxToolCalls) {
      return {
        kind: "stopped",
        reason: "budget",
        observations,
        usage: usage(),
        exhausted: true,
      };
    }
    if (await args.isCancelled?.()) {
      return {
        kind: "stopped",
        reason: "cancelled",
        observations,
        usage: usage(),
        exhausted: false,
      };
    }
    const classification = args.classifyTool(call);
    if (classification !== "read" && classification !== "agent_state") {
      observations.push({
        tool: call.name,
        args: call.args,
        error: {
          code: "UNKNOWN_TOOL",
          message: "That required read capability is unavailable.",
        },
        elapsedMs: 0,
      });
      consecutiveErrors += 1;
      continue;
    }
    toolCalls += 1;
    await args.onProgress?.({
      phase: classification === "read" ? "read" : "plan",
      step: 0,
      tool: call.name,
    });
    const toolStarted = Date.now();
    try {
      const result = await args.executeTool(call);
      observations.push({
        tool: call.name,
        args: call.args,
        result,
        elapsedMs: Date.now() - toolStarted,
      });
      consecutiveErrors = 0;
    } catch (error) {
      const normal: AgentLoopNormalizedError = args.normalizeError?.(error) ?? {
        code: "TOOL_FAILED",
        message: error instanceof Error ? error.message : "The tool failed.",
        recoverable: true,
      };
      observations.push({
        tool: call.name,
        args: call.args,
        error: errorObservation(normal),
        elapsedMs: Date.now() - toolStarted,
      });
      if (
        !normal.recoverable ||
        ++consecutiveErrors >= budget.maxConsecutiveErrors
      ) {
        return {
          kind: "stopped",
          reason: "errors",
          observations,
          usage: usage(),
          exhausted: false,
        };
      }
    }
  }

  const completedInitialText = args.completeAfterInitialReads?.(observations)
    ?.trim();
  if (completedInitialText) {
    return {
      kind: "text",
      text: completedInitialText,
      observations,
      usage: usage(),
      exhausted: false,
    };
  }

  modelTurns: for (let step = 0; step < budget.maxSteps; step++) {
    if (Date.now() - started >= budget.deadlineMs) {
      return {
        kind: "stopped",
        reason: "deadline",
        observations,
        usage: usage(),
        exhausted: true,
      };
    }
    if (await args.isCancelled?.()) {
      return {
        kind: "stopped",
        reason: "cancelled",
        observations,
        usage: usage(),
        exhausted: false,
      };
    }
    if (
      modelCalls >= budget.maxModelCalls || toolCalls >= budget.maxToolCalls
    ) {
      return {
        kind: "stopped",
        reason: "budget",
        observations,
        usage: usage(),
        exhausted: true,
      };
    }
    await args.onProgress?.({ phase: "model", step });
    let model: AgentLoopModelResult;
    try {
      model = await args.callModel(observations, step);
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "The reasoning service did not return a usable response.";
      observations.push({
        tool: "reasoning",
        args: {},
        error: {
          code: "MODEL_UNAVAILABLE",
          message,
        },
        elapsedMs: 0,
      });
      return {
        kind: "stopped",
        reason: "errors",
        observations,
        usage: usage(),
        exhausted: false,
      };
    }
    modelCalls += 1;
    input += model.usage?.prompt_tokens ?? 0;
    output += model.usage?.completion_tokens ?? 0;
    let calls = model.toolCalls ?? [];
    if (calls.length === 0) {
      const modelText = model.textResponse?.trim() ||
        "I need a little more information to continue.";
      calls = args.recoverReadsFromPrematureText?.(
        modelText,
        observations,
      ) ?? [];
      if (calls.length > 0) {
        await args.onProgress?.({ phase: "read", step });
      } else {
        const textIssue = await args.validateFinalText?.(
          modelText,
          observations,
        );
        if (textIssue) {
          observations.push({
            tool: "reasoning",
            args: {},
            error: textIssue,
            elapsedMs: 0,
          });
          if (finalTextRepairAttempts >= 1) {
            return {
              kind: "stopped",
              reason: "errors",
              observations,
              usage: usage(),
              exhausted: false,
            };
          }
          finalTextRepairAttempts += 1;
          continue modelTurns;
        }
        return {
          kind: "text",
          text: modelText,
          observations,
          usage: usage(),
          exhausted: false,
        };
      }
    }
    for (const call of calls) {
      const classification = args.classifyTool(call);
      if (classification === "write") {
        const issue = await args.validateProposal?.(call);
        if (issue) {
          observations.push({
            tool: call.name,
            args: call.args,
            ...(call.thoughtSignature
              ? { thoughtSignature: call.thoughtSignature }
              : {}),
            error: { code: issue.code, message: issue.message },
            elapsedMs: 0,
          });
          consecutiveErrors += 1;
          if (consecutiveErrors >= budget.maxConsecutiveErrors) {
            return {
              kind: "stopped",
              reason: "errors",
              observations,
              usage: usage(),
              exhausted: false,
            };
          }
          continue modelTurns;
        }
        return {
          kind: "proposal",
          toolCall: call,
          observations,
          usage: usage(),
          exhausted: false,
        };
      }
      if (classification === "unknown") {
        observations.push({
          tool: call.name,
          args: call.args,
          ...(call.thoughtSignature
            ? { thoughtSignature: call.thoughtSignature }
            : {}),
          error: {
            code: "UNKNOWN_TOOL",
            message: "That capability is unavailable.",
          },
          elapsedMs: 0,
        });
        consecutiveErrors += 1;
        continue;
      }
      if (toolCalls >= budget.maxToolCalls) {
        return {
          kind: "stopped",
          reason: "budget",
          observations,
          usage: usage(),
          exhausted: true,
        };
      }
      toolCalls += 1;
      await args.onProgress?.({
        phase: classification === "read" ? "read" : "plan",
        step,
        tool: call.name,
      });
      const toolStarted = Date.now();
      try {
        const result = await args.executeTool(call);
        observations.push({
          tool: call.name,
          args: call.args,
          ...(call.thoughtSignature
            ? { thoughtSignature: call.thoughtSignature }
            : {}),
          result,
          elapsedMs: Date.now() - toolStarted,
        });
        consecutiveErrors = 0;
      } catch (error) {
        const normal: AgentLoopNormalizedError = args.normalizeError?.(error) ??
          {
            code: "TOOL_FAILED",
            message: error instanceof Error
              ? error.message
              : "The tool failed.",
            recoverable: true,
          };
        observations.push({
          tool: call.name,
          args: call.args,
          ...(call.thoughtSignature
            ? { thoughtSignature: call.thoughtSignature }
            : {}),
          error: errorObservation(normal),
          elapsedMs: Date.now() - toolStarted,
        });
        if (!normal.recoverable) {
          return {
            kind: "stopped",
            reason: "errors",
            observations,
            usage: usage(),
            exhausted: false,
          };
        }
        consecutiveErrors += 1;
        if (consecutiveErrors >= budget.maxConsecutiveErrors) {
          return {
            kind: "stopped",
            reason: "errors",
            observations,
            usage: usage(),
            exhausted: false,
          };
        }
      }
    }
  }
  return {
    kind: "stopped",
    reason: "budget",
    observations,
    usage: usage(),
    exhausted: true,
  };
}
