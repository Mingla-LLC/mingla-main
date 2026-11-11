// Issue #3355 Wave A — Ari never traps a host again (implementor happy path).
//
// MINGLA-INVARIANT: I-ARI-NO-JAIL | issue #3355 | Typed text inside an open flow that is not a card answer is re-read; a request parks the run and the agent loop serves it in the same turn with one "Resume <flow>" card; "I didn't catch that" is said only to words with no request; the same words twice never get the same card twice.
//
// Replays production 2026-11-10 (Lagos host, run 8a841954) against the
// shipped modules with an in-memory run store that applies the SQL rules
// (lease, compare-and-swap, evidence, parked, resume):
//   A1  the host's influencer sentence (and other non-offering creates) start
//       no offering flow; real offering requests still do;
//   A2  the FAVY10 sentence typed inside an open create_event run parks the
//       run and is handed to the agent loop with a create_discount hint and a
//       "Resume event setup" card — never waitingText; unclear words get
//       "I didn't catch that" once, the same words again park; Resume brings
//       the same card back;
//   A3  "can wait" items never form a step: they are one line in the final
//       summary with a link to Home;
//   A5  the edge treats a parked run as not live; a new flow closes it.
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_wave_a_understand_first.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

import {
  parkArtefact,
  RESUME_CHOICE,
  runFlowStep,
  waitingText,
} from "../ariFlows/runner.ts";
import { readFlowRequest } from "../ariFlows/requestRead.ts";
import type { FlowStore } from "../ariFlows/store.ts";
import type {
  BrandReadiness,
  BrandReadinessItem,
  FlowProbeDeps,
  FlowRun,
  FlowStepRecord,
} from "../ariFlows/types.ts";
import {
  classifyOfferingIntent,
  findFlowDefinition,
  intentWantsPaid,
} from "../ariFlows/index.ts";
import {
  decideFlowTurn,
  flowChoices,
  flowStateOf,
  isResumeAnswer,
  staleFlowAnswer,
  startFlowFromTool,
} from "../ariFlows/edge.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const CHAT = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";

export const HOST_INFLUENCER_SENTENCE =
  "I want to create discount codes for influencers and marketers of my event to give their followers to get discounts when purchasing tickets";
export const HOST_FAVY10_SENTENCE =
  'Create a discount code for me using "FAVY10" as the code and 10% off this code and let it run from now until 19th of December 2026.';

// ── A small world: the P2 catalogue rules, Lagos brand ─────────────────────
interface World {
  set: Set<string>;
  roleOk: boolean;
  events: Set<string>;
}

const CATALOGUE = [
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

function readinessFor(
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

function probesFor(world: World): FlowProbeDeps {
  return {
    readiness: (action) => Promise.resolve(readinessFor(world, action)),
    subjectExists: (_table, id) => Promise.resolve(world.events.has(id)),
    setAside: () => Promise.resolve("brand"),
  };
}

// ── In-memory store with the SQL rules (+ parked / resume, Wave A) ─────────
type StoredRun = FlowRun & {
  started_by: string;
  lease_token: string | null;
  lease_expires: number;
  parked_from_status: FlowRun["status"] | null;
};
const LIVE = [
  "active",
  "awaiting_owner",
  "awaiting_approval",
  "awaiting_handoff",
  "blocked",
];

class MemoryStore implements FlowStore {
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

function freshWorld(overrides: Partial<World> = {}): World {
  return {
    set: new Set<string>(),
    roleOk: true,
    events: new Set<string>(),
    ...overrides,
  };
}

async function startEventRun(store: MemoryStore, text: string) {
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

const current = async (store: MemoryStore) =>
  (await store.getForConversation(CHAT))!;

const NO_CLIENT = {} as SupabaseClient;

function turnArgs(
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

// ── A1 — the router never misroutes a non-offering create ──────────────────

Deno.test("A1: the host's influencer sentence and other non-offering creates start no offering flow", () => {
  for (
    const text of [
      HOST_INFLUENCER_SENTENCE,
      "create a promo code for the party",
      "set up ticket tiers for my event",
      "make a discount for my trip",
      HOST_FAVY10_SENTENCE,
      "I host events and want to create a promo code for them",
      "add a team member to my event",
      "create a refund for my event's buyers",
    ]
  ) {
    assertEquals(classifyOfferingIntent(text), null, text);
  }
});

Deno.test("A1: real offering requests still start their flow", () => {
  assertEquals(
    classifyOfferingIntent("create an event next Friday"),
    "create_event",
  );
  assertEquals(classifyOfferingIntent("Create an event"), "create_event");
  assertEquals(
    classifyOfferingIntent("Create a party with tickets at ₦5,000"),
    "create_event",
  );
  assertEquals(
    classifyOfferingIntent("I want to plan a trip to Lisbon"),
    "create_trip",
  );
  assertEquals(
    classifyOfferingIntent("Set up a stay at our venue"),
    "create_stay",
  );
  assertEquals(classifyOfferingIntent("Add a venue"), "create_venue");
  assertEquals(
    classifyOfferingIntent("Make a new experience"),
    "create_experience",
  );
});

Deno.test("A1: the influencer sentence through decideFlowTurn opens no run", async () => {
  const store = new MemoryStore(OWNER);
  const decision = await decideFlowTurn(
    turnArgs(store, freshWorld(), HOST_INFLUENCER_SENTENCE),
  );
  assertEquals(decision.kind, "none");
  assertEquals(store.runs.size, 0, "no create_event run was started");
});

// ── A2 — the escape hatch ──────────────────────────────────────────────────

Deno.test("A2: the request read hears requests, and only requests", () => {
  assertEquals(readFlowRequest(HOST_FAVY10_SENTENCE), "create_discount");
  assertEquals(readFlowRequest(HOST_INFLUENCER_SENTENCE), "create_discount");
  assertEquals(
    readFlowRequest("Set up ticket tiers for my event"),
    "ticket_tiers",
  );
  assertEquals(readFlowRequest("Create an event next Friday"), "create_event");
  assertEquals(
    readFlowRequest("please send an email to my guests"),
    "campaign",
  );
  for (
    const text of ["blue", "hmm", "ok", "the second one", "add it", "Lagos"]
  ) {
    assertEquals(readFlowRequest(text), null, text);
  }
});

Deno.test("A2 replay: the FAVY10 sentence inside an open create_event run parks it and goes to the agent loop with a discount hint — never waitingText", async () => {
  // The host's brand has a blocker, so a handoff card is open.
  const world = freshWorld({ roleOk: false });
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(world) };
  const run = await startEventRun(store, "Create an event");
  const first = await runFlowStep(deps, {
    run,
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  assertEquals(first.kind, "artefact");
  if (first.kind !== "artefact") return;
  const card = first.artefact;

  const decision = await decideFlowTurn(
    turnArgs(store, world, HOST_FAVY10_SENTENCE),
  );
  assertEquals(decision.kind, "parked");
  if (decision.kind !== "parked") return;
  assertEquals(decision.hint, "create_discount");
  assertEquals(decision.resume.options, [
    { id: RESUME_CHOICE, label: "Resume event setup" },
  ]);
  assertNotMatch(decision.resume.text, /didn't catch/);
  assertEquals(decision.state?.status, "parked");
  assertEquals(
    decision.state?.current_artefact_id,
    decision.resume.artefact_id,
    "the Resume card is the chat's one current card",
  );
  const parked = await current(store);
  assertEquals(parked.status, "parked");
  assertEquals(parked.current_question_id, card.question_id);
  // The Resume card is a real, answerable flow card on the Host.
  const choices = flowChoices(decision.resume)!;
  assertEquals(choices.options.length, 1);
  assertEquals(choices.options[0].label, "Resume event setup");

  // The next plain turn is not the engine's: the agent loop owns the chat.
  const next = await decideFlowTurn(
    turnArgs(store, world, "Also make one called GIRLSTRIPLAGOS"),
  );
  assertEquals(next.kind, "none");
});

Deno.test("A2 replay (v2 event flow): the FAVY10 sentence on an open form card is never taken as its answer", async () => {
  const world = freshWorld({
    set: new Set(["tagline", "contact_phone", "timezone"]),
  });
  const store = new MemoryStore(OWNER);
  const probes: FlowProbeDeps = {
    ...probesFor(world),
    brandFacts: () =>
      Promise.resolve({
        default_timezone: "Africa/Lagos",
        country_code: "NG",
        default_currency: "NGN",
      }),
  };
  const deps = { store, probes };
  const def = findFlowDefinition("create_event")!;
  assertEquals(def.version, 2);
  const started = await store.start({
    brandId: BRAND,
    flowKey: def.key,
    flowVersion: def.version,
    concurrency: def.concurrency,
    conversationId: CHAT,
    answers: {
      intent_text: { value: "Create an event", source: "owner" },
      paid: { value: false, source: "owner" },
    },
  });
  const first = await runFlowStep(deps, {
    run: started.run,
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  assertEquals(first.kind, "artefact");
  if (first.kind !== "artefact") return;
  assertEquals(
    first.artefact.answer_mode,
    "form",
    "a typed-answer card is open",
  );
  const typed = await runFlowStep(deps, {
    run: await current(store),
    trigger: "turn",
    ownerText: HOST_FAVY10_SENTENCE,
    brandName: "Favy Lagos",
  });
  assertEquals(typed.kind, "parked");
  if (typed.kind !== "parked") return;
  assertEquals(typed.hint, "create_discount");
  const after = await current(store);
  assertEquals(
    after.answers.title,
    undefined,
    "the sentence is not the event's name",
  );
  assertEquals(after.answers.start_at, undefined, "nor its start");

  // An ordinary typed answer on the same kind of card still answers it.
  const store2 = new MemoryStore(OWNER);
  const run2 = (await store2.start({
    brandId: BRAND,
    flowKey: def.key,
    flowVersion: def.version,
    concurrency: def.concurrency,
    conversationId: CHAT,
    answers: { intent_text: { value: "Create an event", source: "owner" } },
  })).run;
  await runFlowStep({ store: store2, probes }, {
    run: run2,
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  const answered = await runFlowStep({ store: store2, probes }, {
    run: (await store2.getForConversation(CHAT))!,
    trigger: "turn",
    ownerText: "Lagos Rooftop Social",
    brandName: "Favy Lagos",
  });
  assert(answered.kind !== "parked", "a plain answer is still an answer");
  assertEquals(
    (await store2.getForConversation(CHAT))!.answers.title?.value,
    "Lagos Rooftop Social",
  );
});

Deno.test("A2: unclear words get 'I didn't catch that' once; the same words again are never answered with the same card", async () => {
  const world = freshWorld({ roleOk: false });
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(world) };
  await runFlowStep(deps, {
    run: await startEventRun(store, "Create an event"),
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  const once = await runFlowStep(deps, {
    run: await current(store),
    trigger: "turn",
    ownerText: "blue",
    brandName: "Favy Lagos",
  });
  assertEquals(once.kind, "notice");
  if (once.kind !== "notice") return;
  assertMatch(once.text, /didn't catch that/);
  assert(once.unmatched);

  const twice = await runFlowStep(deps, {
    run: await current(store),
    trigger: "turn",
    ownerText: "Blue.",
    brandName: "Favy Lagos",
  });
  assertEquals(
    twice.kind,
    "parked",
    "the same words twice never get the same card twice",
  );
  if (twice.kind !== "parked") return;
  assertEquals(twice.hint, "repeated");
});

// #3355 Wave D (D4, I-ARI-ESCALATES-AFTER-SECOND-FAILURE): a stuck host's
// typed turn sets the open setup aside — even words that would answer the
// card — and decideFlowTurn starts no new setup for them.
Deno.test("D4: a stuck host (escalate) parks the open setup instead of answering its card", async () => {
  const world = freshWorld({ roleOk: false });
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(world) };
  await runFlowStep(deps, {
    run: await startEventRun(store, "Create an event"),
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  const parked = await runFlowStep(deps, {
    run: await current(store),
    trigger: "turn",
    ownerText: "Lagos Rooftop Social",
    brandName: "Favy Lagos",
    escalate: true,
  });
  assertEquals(parked.kind, "parked");
  assertEquals((await current(store)).status, "parked");

  const fresh = new MemoryStore(OWNER);
  const none = await decideFlowTurn({
    ...turnArgs(fresh, world, "Create an event next Friday"),
    escalate: true,
  });
  assertEquals(none.kind, "none", "no setup starts for a stuck host");
  assertEquals(await fresh.getForConversation(CHAT), null);
});

Deno.test("A2: the same request sent twice is served both times, never the same card", async () => {
  const world = freshWorld({ roleOk: false });
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(world) };
  await runFlowStep(deps, {
    run: await startEventRun(store, "Create an event"),
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  const first = await decideFlowTurn(
    turnArgs(store, world, HOST_FAVY10_SENTENCE),
  );
  assertEquals(first.kind, "parked");
  const second = await decideFlowTurn(
    turnArgs(store, world, HOST_FAVY10_SENTENCE),
  );
  assertEquals(
    second.kind,
    "none",
    "the agent loop answers; no card comes back",
  );
});

Deno.test("A2: Resume brings the run back with the same card; a stale Resume is refused", async () => {
  const world = freshWorld({ roleOk: false });
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(world) };
  const first = await runFlowStep(deps, {
    run: await startEventRun(store, "Create an event"),
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  assertEquals(first.kind, "artefact");
  if (first.kind !== "artefact") return;
  const parked = await decideFlowTurn(
    turnArgs(store, world, HOST_FAVY10_SENTENCE),
  );
  assertEquals(parked.kind, "parked");
  if (parked.kind !== "parked") return;
  const resume = parked.resume;
  const answer = {
    run_id: resume.run_id,
    step_key: resume.step_key,
    question_id: resume.question_id!,
    choice_id: RESUME_CHOICE,
    display_text: "Resume event setup",
  };
  assert(isResumeAnswer(await current(store), answer));
  assertEquals(
    await staleFlowAnswer({ store, conversationId: CHAT, answer }),
    null,
    "the pre-claim check lets the Resume answer through",
  );
  const back = await decideFlowTurn(
    turnArgs(store, world, "Resume event setup", answer),
  );
  assertEquals(back.kind, "reply");
  if (back.kind !== "reply") return;
  assertMatch(back.text, /back to your event setup/);
  assertEquals(back.artefact?.artefact_id, first.artefact.artefact_id);
  assertEquals((await current(store)).status, "awaiting_handoff");

  // Resume again: the run is live, so the old Resume card is stale.
  const again = await decideFlowTurn(
    turnArgs(store, world, "Resume event setup", answer),
  );
  assertEquals(again.kind, "stale");
});

Deno.test("A5 (edge): a new flow in the chat closes the parked run; the chat holds one open run", async () => {
  const world = freshWorld({ roleOk: false });
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(world) };
  await runFlowStep(deps, {
    run: await startEventRun(store, "Create an event"),
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  await decideFlowTurn(turnArgs(store, world, HOST_FAVY10_SENTENCE));
  const parked = await current(store);
  assertEquals(parked.status, "parked");
  assertEquals(
    flowStateOf(parked)?.current_artefact_id,
    parkArtefact(parked).artefact_id,
  );
  world.roleOk = true;
  // #3355 Wave E (D3a): the new setup is the model's start_flow.
  await startFlowFromTool({
    ...turnArgs(store, world, "Plan a trip to Lisbon"),
    call: { flow_key: "create_trip" },
  });
  const open = [...store.runs.values()].filter((run) =>
    LIVE.includes(run.status) || run.status === "parked"
  );
  assertEquals(open.length, 1);
  assertEquals(open[0].flow_key, "create_trip");
  assertEquals(store.runs.get(parked.id)!.status, "cancelled");
});

Deno.test("A2: waitingText is still the honest words for text with no request", () => {
  const text = waitingText(
    {
      schema_version: 1,
      artefact_id: "q:x:y",
      run_id: "x",
      step_key: "brand_blockers",
      question_id: "y",
      kind: "handoff",
      reuse_key: "handoff:team.role",
      title: "Before I can start your event",
      text: "Your role on this brand needs sorting first.",
      options: [],
    },
    "other",
  );
  assertMatch(text, /didn't catch that/);
});

// ── A3 — what can wait is never a step ─────────────────────────────────────

Deno.test("A3: can-wait items never form a step; they are one summary line with a link to Home", async () => {
  // Tagline, phone and time zone are missing; none blocks an event draft.
  const world = freshWorld();
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(world) };
  const first = await runFlowStep(deps, {
    run: await startEventRun(store, "Create an event"),
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  assertEquals(first.kind, "delegate", "no 'Before your event goes live' card");
  const running = await current(store);
  assertEquals(running.step_states.brand_can_wait.state, "done");
  assertEquals(
    (running.step_states.brand_can_wait.evidence?.observed as {
      can_wait: string[];
    }).can_wait,
    ["tagline", "contact_phone", "timezone"],
  );

  world.events.add(EVENT_ID);
  const done = await runFlowStep(deps, {
    run: running,
    trigger: "confirm",
    confirmed: {
      tool_name: "create_event",
      result: { event: { id: EVENT_ID } },
    },
    brandName: "Favy Lagos",
  });
  assertEquals(done.kind, "completed");
  if (done.kind !== "completed") return;
  assertMatch(
    done.artefact.text,
    /Still on your Home to-do list: tagline, contact phone and time zone\./,
  );
  assertEquals(
    done.artefact.text.match(/Home to-do list/g)?.length,
    1,
    "said once",
  );
  assertEquals(done.artefact.options, [{
    id: "open:home",
    label: "Open your Home to-do list",
    route: "/(tabs)/home",
  }]);
  assert(done.artefact.question_id, "the link is a live card button");
  const finished = await current(store);
  assertEquals(
    flowStateOf(finished)?.current_artefact_id,
    done.artefact.artefact_id,
    "the finished run's summary link stays tappable",
  );
  const choices = flowChoices(done.artefact)!;
  assertEquals(choices.options[0].payload, {
    type: "handoff",
    route: "/(tabs)/home",
  });
});

Deno.test("A3: with nothing waiting the summary has no link and no line", async () => {
  const world = freshWorld({
    set: new Set(["tagline", "contact_phone", "timezone"]),
  });
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(world) };
  await runFlowStep(deps, {
    run: await startEventRun(store, "Create an event"),
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  world.events.add(EVENT_ID);
  const done = await runFlowStep(deps, {
    run: await current(store),
    trigger: "confirm",
    confirmed: {
      tool_name: "create_event",
      result: { event: { id: EVENT_ID } },
    },
    brandName: "Favy Lagos",
  });
  assertEquals(done.kind, "completed");
  if (done.kind !== "completed") return;
  assertNotMatch(done.artefact.text, /to-do list/);
  assertEquals(done.artefact.options, []);
  assertEquals(done.artefact.question_id ?? null, null);
});

// ── A7 twins of the live flow evals (scripts/ari/eval/flows/) ──────────────

Deno.test("S6 (twin of ng_brand_no_timezone_handoff): an NG brand missing its time zone is never handed off for it", async () => {
  // Time zone (and everything else that can wait) is missing.
  const world = freshWorld();
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(world) };
  const outcome = await runFlowStep(deps, {
    run: await startEventRun(store, "Create an event"),
    trigger: "turn",
    brandName: "Favy Lagos",
  });
  assertEquals(outcome.kind, "delegate");
  const run = await current(store);
  assertEquals(run.current_artefact, null, "no card at all on the way in");
  assert(
    !Object.values(run.step_states).some((record) =>
      record.item_key === "timezone"
    ),
    "no step waits on the time zone",
  );
});
