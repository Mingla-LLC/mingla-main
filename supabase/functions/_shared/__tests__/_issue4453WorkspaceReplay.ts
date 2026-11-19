// deno-lint-ignore-file no-explicit-any require-await -- the stub Core mirrors async HTTP
/*
 * #4453 Website workspace — the replay world: a stub Core (brand-site-control
 * answered in memory) and one fixture turn through the shipped deterministic
 * layers with a stub model. Shared by the workspace unit suite, the workspace
 * replay suite and the #3355 replay harness. No network, no model.
 */

import { AGENT_TOOLS, isReadOnlyAgentToolCall } from "../agentTools.ts";
import { ariChatLoopBudget, runAgentLoop } from "../agentLoop.ts";
import { assertSiteToolArgs, SITE_AGENT_TOOLS } from "../agentSiteTools.ts";
import {
  GET_SITE_WORKSPACE_TOOL,
  parseSiteFocus,
  SITE_CHANGE_SET_TOOL,
  SITE_WORKSPACE_TURN_TOOLS,
  type SiteChangeSetResult,
  type SiteFocus,
  type SiteQuestionChoices,
  type SiteStepActivity,
  siteWorkspaceContextText,
  siteWorkspaceFollowupText,
  siteWorkspaceProposalIssue,
  splitSiteQuestionChoices,
} from "../agentSiteWorkspaceTools.ts";
import { ToolError } from "../agentToolHelpers.ts";
import {
  WORKSPACE_SNAPSHOT,
  WS_BRAND_ID,
  WS_SITE_ID,
} from "../../../../scripts/ari/eval/replay/websiteWorkspaceFixtures.mjs";

export const WS_USER_ID = "c1d2e3f4-a5b6-4c7d-8e9f-a0b1c2d3e4f5";
export const WS_PENDING_ID = "22222222-2222-4222-8222-222222222222";
export const WS_TICKET_ID = "33333333-3333-4333-8333-333333333333";

export interface CoreScript {
  /** This step (0-based) is refused with Core's named code and sentence. */
  fail?: {
    index: number;
    code: string;
    message?: string;
    detail?: Record<string, unknown>;
  };
  /** A set_look step is refused this many times as hard to read, with the nearest shade. */
  unreadable?: { times: number; foreground: string; nearest_readable: string };
  /** This step answers STEP_IN_PROGRESS once, then the first try's result, marked repeated. */
  in_progress_once?: number;
  /** This step answers REVISION_CONFLICT once, then applies. */
  stale_once?: number;
  /** From this step on Core does not answer (the undo does not either). */
  down_from?: number;
  /** The undo is refused (someone changed the draft since). */
  undo?: "ok" | "refused";
  checks?: "pass" | "warn" | "down";
  workspace?: "ok" | "down";
  /** The team-request function: ok, a role refusal, or an error. */
  rpc?: "ok" | "forbidden" | "error";
}

export interface CoreCall {
  action: string;
  args: Record<string, any>;
  operation_id: string;
  route: string;
}

/** brand-site-control, answered in memory. */
export class FakeCore {
  calls: CoreCall[] = [];
  rpcCalls: Array<{ fn: string; args: Record<string, any> }> = [];
  private appliedSteps = 0;
  private staleSpent = false;
  private unreadableSpent = 0;
  private inProgressSpent = false;

  constructor(readonly script: CoreScript = {}) {}

  actions(): string[] {
    return this.calls.map((call) => call.action);
  }

  private ok(data: unknown) {
    return { data: { ok: true, data }, error: null };
  }

  private refused(
    code: string,
    message?: string,
    detail: Record<string, unknown> = {},
  ) {
    return {
      data: {
        ok: false,
        error: { code, ...(message ? { message } : {}), ...detail },
      },
      error: null,
    };
  }

  private down() {
    return { data: null, error: { name: "FunctionsFetchError" } };
  }

  private answer(action: string, args: Record<string, any>) {
    const script = this.script;
    if (action === GET_SITE_WORKSPACE_TOOL) {
      return script.workspace === "down"
        ? this.down()
        : this.ok(structuredClone(WORKSPACE_SNAPSHOT));
    }
    if (action === "apply_site_change") {
      const index = this.appliedSteps;
      if (script.down_from !== undefined && index >= script.down_from) {
        return this.down();
      }
      if (script.fail?.index === index) {
        return this.refused(
          script.fail.code,
          script.fail.message,
          script.fail.detail,
        );
      }
      if (
        script.unreadable && args.step?.op === "set_look" &&
        this.unreadableSpent < script.unreadable.times
      ) {
        this.unreadableSpent += 1;
        const sentence =
          "Your button words would be hard to read on that colour.";
        // Core's sentence and bounded detail (brand-site-control/siteWorkspace.ts).
        return this.refused(
          "UNREADABLE_COLOURS",
          "Those colours would make some words hard to read.",
          {
            problems: [sentence],
            suggestions: [{
              sentence,
              foreground: script.unreadable.foreground,
              background: "#ffffff",
              nearest_readable: script.unreadable.nearest_readable,
            }],
          },
        );
      }
      let repeated = false;
      if (script.in_progress_once === index) {
        if (!this.inProgressSpent) {
          this.inProgressSpent = true;
          return this.refused(
            "STEP_IN_PROGRESS",
            "That change is still being applied. Try again in a moment.",
            { retryable: true },
          );
        }
        repeated = true;
      }
      if (script.stale_once === index && !this.staleSpent) {
        this.staleSpent = true;
        return this.refused("REVISION_CONFLICT");
      }
      this.appliedSteps += 1;
      const step = args.step ?? {};
      // Studio's answer (applySiteChange): the group, the revision of what
      // changed, and that only the draft changed.
      return this.ok({
        ok: true,
        group_id: args.group_id,
        draft_only: true,
        ...(repeated ? { repeated: true } : {}),
        ...(step.op === "set_look"
          ? { look_revision: "2026-11-19T10:00:00.000Z", warnings: [] }
          : step.op === "set_menu"
          ? { menu_revision: "2026-11-19T10:00:00.000Z" }
          : { page_revision: String(index + 7) }),
        touched: {
          ...(step.page_id ? { page_id: step.page_id } : {}),
          ...(step.op === "add_section"
            ? { section_id: `sec_new_${index + 1}` }
            : step.section_id
            ? { section_id: step.section_id }
            : {}),
        },
      });
    }
    if (action === "undo_site_change_group") {
      if (script.down_from !== undefined) return this.down();
      if (script.undo === "refused") {
        return this.refused(
          "CHANGED_SINCE",
          "This has been changed since, so that step can't be undone or redone from here.",
        );
      }
      // An unknown or already-undone group is a no-op, not a refusal.
      const undone = this.appliedSteps > 0;
      this.appliedSteps = 0;
      return this.ok({
        group_id: args.group_id,
        label: "undone",
        pages: undone ? ["pg_home"] : [],
        look: false,
        menu: false,
        undone,
        draft_only: true,
      });
    }
    if (action === "run_site_design_checks") {
      if (script.checks === "down") return this.down();
      return this.ok({
        draft_digest: "e".repeat(64),
        warning_count: script.checks === "warn" ? 1 : 0,
        ran_at: "2026-11-19T10:00:00.000Z",
        checks: [
          { key: "words", label: "Words", status: "pass", items: [] },
          script.checks === "warn"
            ? {
              key: "readability",
              label: "Readability",
              status: "warn",
              items: [{
                message: "The button colour is hard to read on the page.",
                section: "design",
              }],
            }
            : {
              key: "readability",
              label: "Readability",
              status: "pass",
              items: [],
            },
        ],
      });
    }
    return this.refused("VALIDATION_FAILED");
  }

  /** A caller-scoped Supabase client, as the tool executors use it. */
  client(): any {
    const rows = (table: string): unknown[] =>
      table === "brands"
        ? [{
          id: WS_BRAND_ID,
          name: "Harmattan Kitchen",
          slug: "harmattan-kitchen",
          default_currency: "NGN",
          cover_media_url: null,
        }]
        : table === "brand_sites"
        ? [{ id: WS_SITE_ID }]
        : [];
    const query = (table: string) => {
      const builder: any = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: rows(table), error: null }).then(resolve),
      };
      for (
        const method of ["select", "eq", "is", "not", "limit", "order", "in"]
      ) builder[method] = () => builder;
      builder.maybeSingle = async () => ({
        data: rows(table)[0] ?? null,
        error: null,
      });
      return builder;
    };
    return {
      from: (table: string) => query(table),
      functions: {
        invoke: async (
          name: string,
          options: { body: Record<string, any> },
        ) => {
          if (name !== "brand-site-control") return this.down();
          const body = options.body;
          this.calls.push({
            action: String(body.action),
            args: body.args ?? {},
            operation_id: String(body.operation_id),
            route: String(body.route),
          });
          return this.answer(String(body.action), body.args ?? {});
        },
      },
      rpc: async (fn: string, args: Record<string, any>) => {
        this.rpcCalls.push({ fn, args });
        if (fn !== "issue_4453_create_website_request") {
          return { data: null, error: { code: "PGRST202", message: "none" } };
        }
        if (this.script.rpc === "forbidden") {
          return { data: null, error: { code: "42501", message: "denied" } };
        }
        if (this.script.rpc === "error") {
          return { data: null, error: { code: "XX000", message: "boom" } };
        }
        return {
          data: { ticket_id: WS_TICKET_ID, ticket_number: "S-2041" },
          error: null,
        };
      },
    };
  }
}

export function rawSiteTool(name: string) {
  const tool = SITE_AGENT_TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error(`${name} is not registered`);
  return tool;
}

type ModelStep =
  | { call: { tool: string; args: Record<string, unknown> } }
  | { text: string };

export interface WorkspaceTurnFixture {
  say: string;
  focus: Record<string, unknown> | null;
  stub: { model: ModelStep[]; core?: CoreScript };
  confirm?: boolean;
  expect: Record<string, any>;
}

export interface WorkspaceTurnRun {
  /** What grade.mjs reads. */
  observed: {
    route: string;
    tool: string | null;
    args: Record<string, unknown> | null;
    text: string;
    card_id: null;
    new_flow_runs: string[];
    handoffs: string[];
  };
  context: string;
  focus: SiteFocus | null;
  loopKind: string;
  modelCalls: number;
  offeredTools: string[];
  bounced: string[];
  question: SiteQuestionChoices | null;
  result: SiteChangeSetResult | Record<string, unknown> | null;
  events: SiteStepActivity[];
  core: FakeCore;
}

/** One owner request through the workspace turn's deterministic layers. */
export async function replayWorkspaceTurn(
  turn: WorkspaceTurnFixture,
): Promise<WorkspaceTurnRun> {
  const focus = turn.focus === null ? null : parseSiteFocus(turn.focus);
  if (turn.focus !== null && !focus) {
    throw new Error(`fixture focus is not a valid site_focus: ${turn.say}`);
  }
  const context = siteWorkspaceContextText({
    brandId: WS_BRAND_ID,
    brandName: "Harmattan Kitchen",
    focus,
  });
  const core = new FakeCore(turn.stub.core ?? {});
  const client = core.client();
  const script = [...turn.stub.model];
  let modelCalls = 0;
  let snapshot: unknown = null;
  const names = new Set(AGENT_TOOLS.map((tool) => tool.name));
  // What agent-chat offers a workspace turn's model.
  const offeredTools = AGENT_TOOLS.map((tool) => tool.name).filter((name) =>
    SITE_WORKSPACE_TURN_TOOLS.includes(name)
  );

  const loop = await runAgentLoop({
    // agent-chat's own budget for this turn: one required pre-read, the
    // intent read already spent, the claim check kept back.
    budget: ariChatLoopBudget({
      localModelEnabled: false,
      requiredReads: 1,
      intentRead: { modelCalls: 1, elapsedMs: 1_500 },
      claimCheck: true,
    }),
    initialCalls: [{
      name: GET_SITE_WORKSPACE_TOOL,
      args: { brand_id: WS_BRAND_ID },
    }],
    callModel: () => {
      modelCalls += 1;
      const next = script.shift();
      if (!next) throw new Error(`stub model ran out of answers: ${turn.say}`);
      return Promise.resolve(
        "text" in next ? { textResponse: next.text, toolCalls: [] } : {
          toolCalls: [{
            name: next.call.tool,
            args: structuredClone(next.call.args),
          }],
        },
      );
    },
    classifyTool: (call) =>
      !names.has(call.name)
        ? "unknown"
        : isReadOnlyAgentToolCall(call.name, call.args)
        ? "read"
        : "write",
    validateProposal: (call) =>
      siteWorkspaceProposalIssue({
        toolName: call.name,
        args: call.args,
        workspace: true,
        focus,
        brandId: WS_BRAND_ID,
        snapshot,
      }),
    executeTool: async (call) => {
      const result = await rawSiteTool(call.name).executor(
        call.args,
        client,
        WS_USER_ID,
        { operationId: null },
      );
      if (call.name === GET_SITE_WORKSPACE_TOOL) snapshot = result;
      return result;
    },
    normalizeError: (error) => ({
      code: error instanceof ToolError ? error.code : "TOOL_FAILED",
      message: error instanceof Error ? error.message : "failed",
      recoverable: true,
    }),
  });

  const bounced = loop.observations.flatMap((observation) =>
    observation.error && observation.tool !== GET_SITE_WORKSPACE_TOOL
      ? [observation.error.code]
      : []
  );
  const run: WorkspaceTurnRun = {
    observed: {
      route: "error",
      tool: null,
      args: null,
      text: "",
      card_id: null,
      new_flow_runs: [],
      handoffs: [],
    },
    context,
    focus,
    loopKind: loop.kind,
    modelCalls,
    offeredTools,
    bounced,
    question: null,
    result: null,
    events: [],
    core,
  };

  if (loop.kind === "text") {
    const split = splitSiteQuestionChoices(loop.text);
    run.question = split.question;
    run.observed = { ...run.observed, route: "text", text: split.text };
    return run;
  }
  if (loop.kind !== "proposal") return run;

  const tool = loop.toolCall.name;
  const args = loop.toolCall.args;
  // The authorization seam's own check (proposal time and confirmation).
  assertSiteToolArgs(tool, args);
  run.observed = { ...run.observed, route: `proposal:${tool}`, tool, args };
  if (!turn.confirm) return run;

  // The Host confirms: agent-confirm-action runs the executor with the
  // pending action's id and the step-activity writer.
  const result = await rawSiteTool(tool).executor(args, client, WS_USER_ID, {
    operationId: WS_PENDING_ID,
    retry: false,
    ...(tool === SITE_CHANGE_SET_TOOL
      ? {
        onSiteStep: (event: SiteStepActivity) => {
          run.events.push(event);
          return Promise.resolve();
        },
      }
      : {}),
  } as any);
  run.result = result as Record<string, unknown>;
  run.observed.text = siteWorkspaceFollowupText(tool, result) ?? "";
  return run;
}

interface Fact {
  fact: string;
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

/** The workspace's own facts for one turn (beside grade.mjs's gradeTurn). */
export function gradeWorkspaceTurn(
  expect: Record<string, any> | undefined,
  run: WorkspaceTurnRun,
): Fact[] {
  const facts: Fact[] = [];
  const add = (fact: string, expected: unknown, actual: unknown) =>
    facts.push({
      fact,
      passed: JSON.stringify(expected) === JSON.stringify(actual),
      expected,
      actual,
    });
  const result = (run.result ?? {}) as Record<string, any>;
  const applies = run.core.calls.filter((call) =>
    call.action === "apply_site_change"
  );
  const writes = run.core.calls.filter((call) =>
    ["apply_site_change", "undo_site_change_group"].includes(call.action)
  );

  // Always: the turn finished inside the loop budget, read the draft first,
  // offered only the workspace tools, and never reached a publish action.
  add("the turn fits the loop budget", true, run.loopKind !== "stopped");
  add(
    "the draft is read before anything else",
    GET_SITE_WORKSPACE_TOOL,
    run.core.calls[0]?.action ?? null,
  );
  add(
    "only workspace tools are offered",
    [
      GET_SITE_WORKSPACE_TOOL,
      SITE_CHANGE_SET_TOOL,
      "propose_website_team_request",
    ].sort(),
    [...run.offeredTools].sort(),
  );
  add(
    "nothing is published",
    [],
    run.core.calls.filter((call) =>
      /publish|preview|rollback/.test(call.action)
    )
      .map((call) => call.action),
  );
  add(
    "every step is in one group",
    true,
    applies.every((call) => call.args.group_id === WS_PENDING_ID),
  );
  if (run.focus) {
    add(
      "the context names the selected section",
      true,
      run.context.includes(run.focus.section_id) &&
        run.context.includes(run.focus.section_label),
    );
  }
  if (!expect) return facts;

  if (expect.model_calls !== undefined) {
    add("model calls", expect.model_calls, run.modelCalls);
  }
  if (expect.bounced) add("sent back for repair", expect.bounced, run.bounced);
  if (expect.status) add("plan status", expect.status, result.status ?? null);
  if (expect.applied !== undefined) {
    add("steps on the draft", expect.applied, (result.applied ?? []).length);
  }
  if (expect.ops) {
    add("steps in order", expect.ops, applies.map((call) => call.args.step.op));
  }
  if (expect.apply_calls !== undefined) {
    add("apply calls", expect.apply_calls, applies.length);
  }
  if (expect.failed_index !== undefined) {
    add("failed step", expect.failed_index, result.failed?.index ?? null);
  }
  if (expect.undo_called !== undefined) {
    add(
      "undo called",
      expect.undo_called,
      run.core.actions().includes("undo_site_change_group"),
    );
  }
  if (expect.checks_ran !== undefined) {
    add(
      "design checks ran",
      expect.checks_ran,
      run.core.actions().includes("run_site_design_checks"),
    );
  }
  if (expect.checks_passed !== undefined) {
    add("design checks passed", expect.checks_passed, result.checks?.passed);
  }
  if (expect.warnings !== undefined) {
    add("warnings", expect.warnings, (result.checks?.warnings ?? []).length);
  }
  if (expect.sent_colour) {
    add(
      "the colour finally sent",
      expect.sent_colour,
      applies.at(-1)?.args.step?.tokens?.colors?.action ?? null,
    );
  }
  if (expect.adjusted !== undefined) {
    add(
      "colours moved to a readable shade",
      expect.adjusted,
      (result.applied ?? []).reduce(
        (sum: number, item: any) => sum + (item.adjusted_colours ?? []).length,
        0,
      ),
    );
  }
  if (expect.sent_row) {
    // Studio takes a new row's words as { field: words }.
    add(
      "the new row as Core receives it",
      expect.sent_row,
      applies.at(-1)?.args.step?.list_ops?.[0]?.values ?? null,
    );
  }
  if (expect.same_operation_id) {
    add(
      "the repeat carries the same operation id",
      1,
      new Set(applies.map((call) => call.operation_id)).size,
    );
  }
  if (expect.uncited_steps !== undefined) {
    add(
      "steps sent without a source",
      expect.uncited_steps,
      applies.filter((call) => !("cites" in call.args)).length,
    );
  }
  if (expect.couldnt !== undefined) {
    add("could not do", expect.couldnt, (result.couldnt ?? []).length);
  }
  if (expect.core_writes !== undefined) {
    add("draft writes", expect.core_writes, writes.length);
  }
  if (expect.events !== undefined) {
    add("progress rows", expect.events, run.events.length);
  }
  if (expect.last_event) {
    add(
      "last progress row",
      expect.last_event,
      run.events.at(-1)?.type ?? null,
    );
  }
  if (expect.one_group) {
    add(
      "one group label for the whole plan",
      1,
      new Set(applies.map((call) => call.args.group_label)).size,
    );
  }
  if (expect.only_section) {
    add(
      "only the selected section changed",
      [expect.only_section],
      [...new Set(applies.map((call) => call.args.step.section_id))],
    );
  }
  if (expect.context_names) {
    add(
      "context names the section",
      true,
      run.context.includes(expect.context_names),
    );
  }
  if (expect.question_options !== undefined) {
    add(
      "tappable answers",
      expect.question_options,
      run.question?.options.length ?? 0,
    );
  }
  if (expect.team_request) {
    const sent = run.core.rpcCalls.filter((call) =>
      call.fn === "issue_4453_create_website_request"
    );
    add("team request sent once", 1, sent.length);
    add(
      "team request keyed by the approval",
      WS_PENDING_ID,
      sent[0]?.args.p_client_request_id ?? null,
    );
    if (expect.team_where_section) {
      add(
        "team request names the section",
        expect.team_where_section,
        sent[0]?.args.p_where?.section_id ?? null,
      );
    }
  }
  return facts;
}
