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
  error?: { code: string; message: string };
  elapsedMs: number;
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
  executeTool: (call: AgentLoopToolCall) => Promise<unknown>;
  isCancelled?: () => Promise<boolean>;
  onProgress?: (
    event: { phase: string; step: number; tool?: string },
  ) => Promise<void> | void;
  normalizeError?: (
    error: unknown,
  ) => { code: string; message: string; recoverable: boolean };
}): Promise<AgentLoopResult> {
  const budget = { ...DEFAULT_AGENT_LOOP_BUDGET, ...(args.budget ?? {}) };
  const started = Date.now();
  const observations: AgentLoopObservation[] = [];
  let modelCalls = 0;
  let toolCalls = 0;
  let consecutiveErrors = 0;
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
      const normal = args.normalizeError?.(error) ?? {
        code: "TOOL_FAILED",
        message: error instanceof Error ? error.message : "The tool failed.",
        recoverable: true,
      };
      observations.push({
        tool: call.name,
        args: call.args,
        error: { code: normal.code, message: normal.message },
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
      const normal = args.normalizeError?.(error) ?? {
        code: "TOOL_FAILED",
        message: error instanceof Error ? error.message : "The tool failed.",
        recoverable: true,
      };
      observations.push({
        tool: call.name,
        args: call.args,
        error: { code: normal.code, message: normal.message },
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

  for (let step = 0; step < budget.maxSteps; step++) {
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
        const normal = args.normalizeError?.(error) ??
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
          error: { code: normal.code, message: normal.message },
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
