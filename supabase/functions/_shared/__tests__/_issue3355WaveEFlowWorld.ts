// Issue #3355 Wave E — shared test world for the Wave E suites: the Wave A
// in-memory run store (lease, compare-and-swap, evidence, parked, resume)
// and a Lagos brand's readiness probes. Copied from
// issue_3355_wave_a_understand_first.implementor.test.ts (a test file cannot
// be imported without re-registering its tests). Not a test file itself.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { FlowStore } from "../ariFlows/store.ts";
import type {
  BrandReadiness,
  BrandReadinessItem,
  FlowProbeDeps,
  FlowRun,
  FlowStepRecord,
} from "../ariFlows/types.ts";
import { findFlowDefinition, intentWantsPaid } from "../ariFlows/index.ts";
import type { decideFlowTurn } from "../ariFlows/edge.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";

export const OWNER = "11111111-1111-4111-8111-111111111111";
export const BRAND = "22222222-2222-4222-8222-222222222222";
export const CHAT = "33333333-3333-4333-8333-333333333333";
export const EVENT_ID = "55555555-5555-4555-8555-555555555555";

export const HOST_INFLUENCER_SENTENCE =
  "I want to create discount codes for influencers and marketers of my event to give their followers to get discounts when purchasing tickets";
export const HOST_FAVY10_SENTENCE =
  'Create a discount code for me using "FAVY10" as the code and 10% off this code and let it run from now until 19th of December 2026.';

// ── A small world: the P2 catalogue rules, Lagos brand ─────────────────────
export interface World {
  set: Set<string>;
  roleOk: boolean;
  events: Set<string>;
}

export const CATALOGUE = [
  {
    key: "tagline",
    label: "Tagline",
    group: "identity",
    blocking_for: [] as string[],
    recommended_for: ["publish_free", "publish_paid"],
  },
  {
    key: "contact_phone",
    label: "Contact phone",
    group: "contact",
    blocking_for: ["website_build"],
    recommended_for: ["publish_free", "publish_paid"],
  },
  {
    key: "timezone",
    label: "Time zone",
    group: "location",
    blocking_for: [] as string[],
    recommended_for: ["publish_free", "publish_paid"],
  },
  {
    key: "team.role",
    label: "Your role on this brand",
    group: "team",
    blocking_for: ["draft_save", "publish_free", "publish_paid"],
    recommended_for: [] as string[],
  },
];

export function readinessFor(
  world: World,
  action: ReadinessAction | null,
): BrandReadiness {
  const items: BrandReadinessItem[] = CATALOGUE.map((entry) => {
    const done = entry.key === "team.role"
      ? world.roleOk
      : world.set.has(entry.key);
    const blocks = !!action && entry.blocking_for.includes(action) && !done;
    return {
      key: entry.key,
      label: entry.label,
      group: entry.group,
      state: done ? "verified" : "missing",
      severity: blocks ? "blocking" : done ? "done" : "skippable",
      blocks_action: blocks,
      blocking_for: entry.blocking_for,
      recommended_for: entry.recommended_for,
      value_preview: null,
      deferrable: entry.key !== "team.role",
      deferral: null,
      skip_in_ari: false,
      owner_action: "answer",
      fix: {
        route: entry.key === "team.role"
          ? `/brand/${BRAND}/team`
          : `/brand/${BRAND}/edit`,
        route_label: entry.key === "team.role" ? "Team" : "Brand profile",
        can_caller_fix: entry.key !== "team.role",
        who_can_fix: entry.key === "team.role"
          ? "the brand owner"
          : "a brand admin or the owner",
      },
      ask: { control: "text" },
    } as BrandReadinessItem;
  });
  return {
    brand_id: BRAND,
    action,
    can_proceed: !items.some((item) => item.blocks_action),
    context_revision: "r1",
    evaluated_at: "now",
    counts: { blocking: 0, can_wait: 0, done: 0, deferred: 0 },
    money: {
      can_sell: false,
      can_be_paid_out: false,
      sell_reason: "no_provider",
      payout_reason: "no_bank",
      rail: "none",
      currency: "NGN",
      terms_accepted_by_caller: true,
    },
    items,
  } as BrandReadiness;
}

export function probesFor(world: World): FlowProbeDeps {
  return {
    readiness: (action) => Promise.resolve(readinessFor(world, action)),
    subjectExists: (_table, id) => Promise.resolve(world.events.has(id)),
    setAside: () => Promise.resolve("brand"),
  };
}

// ── In-memory store with the SQL rules (+ parked / resume, Wave A) ─────────
export type StoredRun = FlowRun & {
  started_by: string;
  lease_token: string | null;
  lease_expires: number;
  parked_from_status: FlowRun["status"] | null;
};
export const LIVE = [
  "active",
  "awaiting_owner",
  "awaiting_approval",
  "awaiting_handoff",
  "blocked",
];

export class MemoryStore implements FlowStore {
  runs = new Map<string, StoredRun>();
  clock = 1_000;
  constructor(public userId: string) {}
  private view(run: StoredRun): FlowRun {
    return {
      ...structuredClone({
        ...run,
        lease_token: undefined,
        lease_expires: undefined,
        started_by: undefined,
        parked_from_status: undefined,
      }),
      started_by_me: run.started_by === this.userId,
      started_by_name: "Favour Host",
      lease_held: run.lease_expires > this.clock,
      lease_held_by_me: run.lease_expires > this.clock,
      lease_owner_name: null,
    } as FlowRun;
  }
  start(args: Parameters<FlowStore["start"]>[0]) {
    // #3355 rework 3 (R3-7, as 20280702133355): a follow-up run never closes
    // another setup open in the chat, live or parked; it is refused.
    const followUp = args.answers !== undefined && args.answers !== null &&
      "follow_up_of" in (args.answers as Record<string, unknown>);
    if (
      followUp &&
      [...this.runs.values()].some((run) =>
        run.conversation_id === args.conversationId &&
        (LIVE.includes(run.status) || run.status === "parked")
      )
    ) {
      return Promise.reject(new Error("flow_run_open"));
    }
    for (const run of this.runs.values()) {
      if (run.conversation_id !== args.conversationId) continue;
      if (LIVE.includes(run.status) && run.flow_key === args.flowKey) {
        return Promise.resolve({
          created: false,
          owned_by_other: false,
          owner_display_name: null,
          run: this.view(run),
        });
      }
      // One open run per chat: a new flow closes the chat's live or parked run.
      if (LIVE.includes(run.status) || run.status === "parked") {
        run.status = "cancelled";
      }
    }
    const id = crypto.randomUUID();
    const run: StoredRun = {
      id,
      brand_id: args.brandId,
      flow_key: args.flowKey,
      flow_version: args.flowVersion,
      concurrency: args.concurrency,
      subject_id: null,
      conversation_id: args.conversationId,
      status: "active",
      current_step_key: null,
      current_question_id: null,
      current_pending_action_id: null,
      current_artefact: null,
      step_states: {},
      answers: (args.answers ?? {}) as FlowRun["answers"],
      session_skips: [],
      revision: 1,
      started_by_me: true,
      started_by_name: "Favour Host",
      lease_held: false,
      lease_held_by_me: false,
      lease_owner_name: null,
      stopped: false,
      last_activity_at: null,
      owner_since: null,
      started_by: this.userId,
      lease_token: null,
      lease_expires: 0,
      parked_from_status: null,
    };
    this.runs.set(id, run);
    return Promise.resolve({
      created: true,
      owned_by_other: false,
      owner_display_name: null,
      run: this.view(run),
    });
  }
  lease(runId: string, token: string, ttl = 30) {
    const run = this.runs.get(runId)!;
    if (!LIVE.includes(run.status)) {
      return Promise.resolve({
        ok: false,
        reason: "terminal" as const,
        owner_display_name: null,
        run: this.view(run),
      });
    }
    run.lease_token = token;
    run.lease_expires = this.clock + ttl * 1000;
    return Promise.resolve({
      ok: true,
      reason: null,
      owner_display_name: null,
      run: this.view(run),
    });
  }
  advance(
    runId: string,
    token: string,
    rev: number,
    patch: Record<string, unknown>,
  ) {
    const run = this.runs.get(runId)!;
    if (run.lease_token !== token || run.lease_expires <= this.clock) {
      return Promise.reject(new Error("flow_lease_not_held"));
    }
    if (rev !== run.revision) {
      return Promise.reject(new Error("flow_revision_conflict"));
    }
    if (!LIVE.includes(run.status)) {
      return Promise.reject(new Error("flow_run_terminal"));
    }
    const states = (patch.step_states ?? {}) as Record<string, FlowStepRecord>;
    for (const [key, value] of Object.entries(states)) {
      if (
        value.state === "done" &&
        (!value.evidence?.probe || !("observed" in value.evidence))
      ) {
        return Promise.reject(new Error(`flow_evidence_required:${key}`));
      }
    }
    if (patch.status === "parked") run.parked_from_status = run.status;
    Object.assign(run, {
      ...patch,
      step_states: { ...run.step_states, ...states },
      answers: { ...run.answers, ...(patch.answers as object ?? {}) },
      revision: run.revision + 1,
    });
    if (patch.status === "parked") {
      run.lease_token = null;
      run.lease_expires = 0;
    }
    return Promise.resolve(this.view(run));
  }
  release(runId: string, token: string) {
    const run = this.runs.get(runId)!;
    if (run.lease_token === token) {
      run.lease_token = null;
      run.lease_expires = 0;
    }
    return Promise.resolve();
  }
  getForConversation(conversationId: string) {
    const runs = [...this.runs.values()].filter((run) =>
      run.conversation_id === conversationId
    );
    const pick = runs.find((run) => LIVE.includes(run.status)) ??
      runs.find((run) => run.status === "parked") ?? runs.at(-1);
    return Promise.resolve(pick ? this.view(pick) : null);
  }
  getById(runId: string) {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? this.view(run) : null);
  }
  resume(runId: string, conversationId: string) {
    const run = this.runs.get(runId)!;
    if (
      run.status !== "parked" || run.conversation_id !== conversationId ||
      run.started_by !== this.userId
    ) {
      return Promise.reject(new Error("flow_run_not_parked"));
    }
    run.status = run.parked_from_status ?? "active";
    run.parked_from_status = null;
    run.revision += 1;
    return Promise.resolve(this.view(run));
  }
}

export function freshWorld(overrides: Partial<World> = {}): World {
  return {
    set: new Set<string>(),
    roleOk: true,
    events: new Set<string>(),
    ...overrides,
  };
}

export async function startEventRun(store: MemoryStore, text: string) {
  const def = findFlowDefinition("create_event", 1)!;
  const started = await store.start({
    brandId: BRAND,
    flowKey: def.key,
    flowVersion: def.version,
    concurrency: def.concurrency,
    conversationId: CHAT,
    answers: {
      intent_text: { value: text, source: "owner" },
      paid: { value: intentWantsPaid(text), source: "owner" },
    },
  });
  return started.run;
}

export const current = async (store: MemoryStore) =>
  (await store.getForConversation(CHAT))!;

export const NO_CLIENT = {} as SupabaseClient;

export function turnArgs(
  store: MemoryStore,
  world: World,
  message: string,
  flowAnswer: Parameters<typeof decideFlowTurn>[0]["flowAnswer"] = null,
) {
  return {
    service: NO_CLIENT,
    userClient: NO_CLIENT,
    userId: OWNER,
    brand: { id: BRAND, name: "Favy Lagos" },
    conversationId: CHAT,
    message,
    flowAnswer,
    engineEnabled: true,
    otherLaneActive: false,
    store,
    probes: probesFor(world),
  };
}
