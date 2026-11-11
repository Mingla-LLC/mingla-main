// Issue #3355 P3 — Ari flow engine core (implementor happy path + adversarial).
//
// MINGLA-INVARIANT: I-ARI-FLOW-ENGINE-OWNS-PROGRESS | issue #3355 | Only the server step runner advances a flow run; every step it marks done carries probe evidence, and a run completes only with evidence (SQL side: supabase/migrations/__tests__/issue_3355_ari_flow_runs.implementor.pg17.test.sql).
// MINGLA-INVARIANT: I-ARI-BOUND-ANSWERS | issue #3355 | A card answer is structured ({run, step, question, choice}); an answer to any card but the run's current one is QUESTION_STALE and changes nothing; a reload resumes the open card instead of issuing a second one.
// MINGLA-INVARIANT: I-ARI-NO-CLIENT-AUTHORED-CONTINUATION | issue #3355 | The Host never sends a message on the owner's behalf to keep a flow going; the confirm response and flow_resume carry the next step, persisted as engine assistant rows (never user turns, never counted toward the daily limit).
//
// Drives the shipped modules with an in-memory run store that applies the
// same rules as the SQL functions (lease, compare-and-swap, evidence):
//   * start → what can wait is noted, never asked (#3355 Wave A, D4a; the
//     items stay on Home) → the owner's original request goes to the event
//     lane → confirm of the created event returns an evidence-backed summary
//     that names what can wait once;
//   * reload/resume returns the same card (no duplicate), a stale answer is
//     refused with the current card, concurrent requests get "busy", an
//     expired lease lets a second device continue, a teammate is view-only;
//   * "I've uploaded it" with nothing uploaded → "I checked; … isn't there
//     yet" and the handoff stays the current card;
//   * irrelevant items (Website-only plan approval) never appear on an event;
//   * deterministic readiness answers need no model;
//   * honest stop copy; confirm-next rows are assistant rows only; the Host
//     no longer authors "Continue Website setup"; follow-on proposals use the
//     allowed source.
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_flow_engine.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { runFlowStep } from "../ariFlows/runner.ts";
import type { FlowStore } from "../ariFlows/store.ts";
import type {
  BrandReadiness,
  BrandReadinessItem,
  FlowArtefact,
  FlowProbeDeps,
  FlowRun,
  FlowStepRecord,
} from "../ariFlows/types.ts";
import {
  classifyOfferingIntent,
  classifyReadinessQuestion,
  findFlowDefinition,
  intentWantsPaid,
} from "../ariFlows/index.ts";
import { buildReadinessAnswer } from "../ariFlows/readinessAnswer.ts";
import {
  decideFlowTurn,
  flowChoices,
  parseFlowAnswer,
  persistFlowRow,
  staleFlowAnswer,
} from "../ariFlows/edge.ts";
import {
  ARI_LOOP_PROBLEM_LINE,
  ARI_OUT_OF_TIME_LINE,
  honestLoopStopText,
} from "../ariFlows/honestCopy.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";

const ROOT = new URL("../../../../", import.meta.url);
const OWNER = "11111111-1111-4111-8111-111111111111";
const MATE = "44444444-4444-4444-8444-444444444444";
const BRAND = "22222222-2222-4222-8222-222222222222";
const CHAT = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";

// ── A small world and a readiness read that follows the P2 catalogue rules ──
interface World {
  set: Set<string>;
  roleOk: boolean;
  canSell: boolean;
  brandWideNotNow: Set<string>;
  events: Set<string>;
  /** #3355 Wave A: items made to block the draft, for an open handoff card. */
  blockDraft?: Set<string>;
}

const CATALOGUE: Array<{
  key: string;
  label: string;
  group: string;
  blocking_for: string[];
  recommended_for: string[];
  route: string | null;
  route_label: string;
  can_fix: boolean;
  who: string;
}> = [
  {
    key: "profile_photo",
    label: "Brand logo",
    group: "media",
    blocking_for: ["website_build"],
    recommended_for: ["publish_free", "publish_paid"],
    route: `/brand/${BRAND}/edit`,
    route_label: "Brand profile",
    can_fix: true,
    who: "a brand admin or the owner",
  },
  {
    key: "contact_phone",
    label: "Contact phone",
    group: "contact",
    blocking_for: ["website_build"],
    recommended_for: ["publish_free", "publish_paid"],
    route: `/brand/${BRAND}/edit`,
    route_label: "Brand profile",
    can_fix: true,
    who: "a brand admin or the owner",
  },
  {
    key: "approved_plan",
    label: "Approved Website plan",
    group: "website",
    blocking_for: ["website_build"],
    recommended_for: [],
    route: `/brand/${BRAND}/website`,
    route_label: "Website setup",
    can_fix: true,
    who: "a brand admin or the owner",
  },
  {
    key: "money.can_sell",
    label: "Ready to sell paid tickets",
    group: "money",
    blocking_for: ["publish_paid"],
    recommended_for: [],
    route: `/brand/${BRAND}/payments/onboard`,
    route_label: "Payments setup",
    can_fix: false,
    who: "the brand owner",
  },
  {
    key: "team.role",
    label: "Your role on this brand",
    group: "team",
    blocking_for: ["draft_save", "publish_free", "publish_paid"],
    recommended_for: [],
    route: `/brand/${BRAND}/team`,
    route_label: "Team",
    can_fix: false,
    who: "the brand owner",
  },
];

function readinessFor(
  world: World,
  action: ReadinessAction | null,
): BrandReadiness {
  const items: BrandReadinessItem[] = CATALOGUE.map((entry) => {
    const done = entry.key === "team.role"
      ? world.roleOk
      : entry.key === "money.can_sell"
      ? world.canSell
      : world.set.has(entry.key);
    const blocks = !!action &&
      (entry.blocking_for.includes(action) ||
        (action === "draft_save" && !!world.blockDraft?.has(entry.key))) &&
      !done;
    const deferred = world.brandWideNotNow.has(entry.key) && !done;
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
      deferrable: !entry.key.startsWith("money.") && entry.key !== "team.role",
      deferral: deferred
        ? { by_display_name: "Ada Owner", at: "now", until: null, reason: null }
        : null,
      skip_in_ari: deferred && !blocks,
      owner_action: "answer",
      fix: {
        route: entry.route,
        route_label: entry.route_label,
        can_caller_fix: entry.can_fix,
        who_can_fix: entry.who,
      },
      ask: { control: "text" },
    };
  });
  return {
    brand_id: BRAND,
    action,
    can_proceed: !items.some((item) => item.blocks_action),
    context_revision: "r1",
    evaluated_at: "now",
    counts: { blocking: 0, can_wait: 0, done: 0, deferred: 0 },
    money: {
      can_sell: world.canSell,
      can_be_paid_out: false,
      sell_reason: world.canSell ? "ready" : "no_provider",
      payout_reason: "no_bank",
      rail: world.canSell ? "stripe" : "none",
      currency: "GBP",
      terms_accepted_by_caller: true,
    },
    items,
  };
}

function probesFor(world: World, log: string[] = []): FlowProbeDeps {
  return {
    readiness(action) {
      log.push(`readiness:${action}`);
      return Promise.resolve(readinessFor(world, action));
    },
    subjectExists(_table, id) {
      return Promise.resolve(world.events.has(id));
    },
    setAside(key) {
      log.push(`set_aside:${key}`);
      // P2: a brand-wide "not now" never marks the item done; Home keeps it.
      world.brandWideNotNow.add(key);
      return Promise.resolve("brand");
    },
  };
}

// ── In-memory store with the SQL rules (lease, CAS, evidence) ───────────────
type StoredRun = FlowRun & {
  started_by: string;
  lease_token: string | null;
  lease_owner: string | null;
  lease_expires: number;
};

class MemoryStore implements FlowStore {
  runs = new Map<string, StoredRun>();
  clock = 1_000;
  patches: Array<Record<string, unknown>> = [];
  constructor(public userId: string, shared?: MemoryStore) {
    if (shared) {
      this.runs = shared.runs;
      this.patches = shared.patches;
      this.clockRef = shared;
    }
  }
  clockRef: MemoryStore = this;
  private now() {
    return this.clockRef.clock;
  }
  private view(run: StoredRun): FlowRun {
    const live = run.lease_expires > this.now();
    return {
      ...structuredClone({
        ...run,
        lease_token: undefined,
        lease_owner: undefined,
        lease_expires: undefined,
        started_by: undefined,
      }),
      started_by_me: run.started_by === this.userId,
      started_by_name: run.started_by === OWNER ? "Ada Owner" : "Sam Mate",
      lease_held: live,
      lease_held_by_me: live && run.lease_owner === this.userId,
      lease_owner_name: live
        ? (run.lease_owner === OWNER ? "Ada Owner" : "Sam Mate")
        : null,
    } as FlowRun;
  }
  start(args: Parameters<FlowStore["start"]>[0]) {
    for (const run of this.runs.values()) {
      if (
        run.conversation_id === args.conversationId &&
        !["completed", "cancelled", "expired"].includes(run.status)
      ) {
        return Promise.resolve({
          created: false,
          owned_by_other: false,
          owner_display_name: null,
          run: this.view(run),
        });
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
      started_by_name: "Ada Owner",
      lease_held: false,
      lease_held_by_me: false,
      lease_owner_name: null,
      started_by: this.userId,
      lease_token: null,
      lease_owner: null,
      lease_expires: 0,
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
    if (["completed", "cancelled", "expired"].includes(run.status)) {
      return Promise.resolve({
        ok: false,
        reason: "terminal" as const,
        owner_display_name: null,
        run: this.view(run),
      });
    }
    if (run.started_by !== this.userId) {
      return Promise.resolve({
        ok: false,
        reason: "owned_by_other" as const,
        owner_display_name: "Ada Owner",
        run: this.view(run),
      });
    }
    if (run.lease_expires > this.now() && run.lease_token !== token) {
      return Promise.resolve({
        ok: false,
        reason: "busy" as const,
        owner_display_name: "Ada Owner",
        run: this.view(run),
      });
    }
    run.lease_token = token;
    run.lease_owner = this.userId;
    run.lease_expires = this.now() + ttl * 1000;
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
    if (run.lease_token !== token || run.lease_expires <= this.now()) {
      return Promise.reject(new Error("flow_lease_not_held"));
    }
    if (rev !== run.revision) {
      return Promise.reject(new Error("flow_revision_conflict"));
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
    if (
      patch.status === "completed" &&
      !(patch.completion_evidence as { probe?: string } | undefined)?.probe
    ) {
      return Promise.reject(new Error("flow_evidence_required:completion"));
    }
    this.patches.push(structuredClone(patch));
    Object.assign(run, {
      ...patch,
      step_states: { ...run.step_states, ...states },
      answers: { ...run.answers, ...(patch.answers as object ?? {}) },
      revision: run.revision + 1,
    });
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
    const live =
      runs.find((run) =>
        !["completed", "cancelled", "expired"].includes(run.status)
      ) ?? runs.at(-1);
    return Promise.resolve(live ? this.view(live) : null);
  }
  getById(runId: string) {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? this.view(run) : null);
  }
}

function freshWorld(overrides: Partial<World> = {}): World {
  return {
    set: new Set<string>(),
    roleOk: true,
    canSell: false,
    brandWideNotNow: new Set<string>(),
    events: new Set<string>(),
    ...overrides,
  };
}

// #3355 P7: these P3 cases pin create_event version 1 (gates, then the old
// event lane), which stays registered so a run started on it finishes there.
// Version 2 (the event facts on the engine) is covered by
// issue_3355_event_flow.implementor.test.ts.
async function startEventRun(store: MemoryStore, text = "Create an event") {
  const def = findFlowDefinition("create_event", 1)!;
  assertEquals(def.version, 1);
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

async function current(store: MemoryStore): Promise<FlowRun> {
  return (await store.getForConversation(CHAT))!;
}

function answerFor(run: FlowRun, choice: string) {
  const artefact = run.current_artefact!;
  return {
    run_id: run.id,
    step_key: run.current_step_key!,
    question_id: run.current_question_id!,
    choice_id: choice,
    display_text: artefact.options.find((o) => o.id === choice)?.label ??
      choice,
  };
}

// ── Happy path ──────────────────────────────────────────────────────────────

Deno.test("P3 happy (Wave A): create event → what can wait is noted, not asked → event lane → confirm returns an evidence-backed summary", async () => {
  const world = freshWorld();
  const store = new MemoryStore(OWNER);
  const log: string[] = [];
  const deps = { store, probes: probesFor(world, log) };
  const run = await startEventRun(store);

  // #3355 Wave A (A3, D4a): items that can wait never form a step.
  const answered = await runFlowStep(deps, {
    run,
    trigger: "turn",
    brandName: "Lantern",
  });
  assertEquals(answered.kind, "delegate");
  if (answered.kind !== "delegate") return;
  assertEquals(answered.semantic_message, "Create an event");
  const noted = (await current(store)).step_states.brand_can_wait;
  assertEquals(noted.state, "done");
  assertEquals(
    (noted.evidence?.observed as { can_wait: string[] }).can_wait,
    ["profile_photo", "contact_phone"],
    "irrelevant to an event: the Website-only plan approval is never noted",
  );
  // Nothing was set aside on the owner's behalf; Home still lists it.
  assertEquals(log.filter((l) => l.startsWith("set_aside:")), []);
  assertEquals(
    readinessFor(world, null).items.find((i) => i.key === "profile_photo")
      ?.severity,
    "skippable",
  );

  // Ordinary event-planning turns belong to the event lane.
  const planning = await runFlowStep(deps, {
    run: await current(store),
    trigger: "turn",
    ownerText: "Friday at 8pm",
    brandName: "Lantern",
  });
  assertEquals(planning.kind, "pass");

  // Confirm of the created event: the server returns the next step.
  world.events.add(EVENT_ID);
  const confirmed = await runFlowStep(deps, {
    run: await current(store),
    trigger: "confirm",
    confirmed: {
      tool_name: "create_event",
      result: { event: { id: EVENT_ID, title: "Supper" } },
    },
    brandName: "Lantern",
  });
  assertEquals(confirmed.kind, "completed");
  if (confirmed.kind !== "completed") return;
  assertMatch(confirmed.text, /draft is saved and I've checked it's there/);
  assertMatch(
    confirmed.text,
    /Still on your Home to-do list: brand logo and contact phone/,
  );
  const finalRun = await current(store);
  assertEquals(finalRun.status, "completed");
  assertEquals(finalRun.subject_id, EVENT_ID);
  assertEquals(finalRun.step_states.offering.state, "done");
  assertEquals(
    finalRun.step_states.offering.evidence?.probe,
    "events_exists",
  );
});

Deno.test("P3 happy: every done the runner writes carries probe evidence", async () => {
  const store = new MemoryStore(OWNER);
  const deps = {
    store,
    probes: probesFor(
      freshWorld({ set: new Set(["profile_photo", "contact_phone"]) }),
    ),
  };
  const run = await startEventRun(store);
  const outcome = await runFlowStep(deps, {
    run,
    trigger: "turn",
    brandName: "L",
  });
  assertEquals(
    outcome.kind,
    "delegate",
    "nothing to ask: straight to the event lane",
  );
  for (const patch of store.patches) {
    for (
      const value of Object.values(
        (patch.step_states ?? {}) as Record<string, FlowStepRecord>,
      )
    ) {
      if (value.state === "done") {
        assert(value.evidence?.probe, "done without a probe");
        assert("observed" in (value.evidence ?? {}), "done without observed");
      }
    }
  }
});

Deno.test("P3 happy: reload resumes the open card — same id, no second card", async () => {
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(freshWorld({ roleOk: false })) };
  const run = await startEventRun(store);
  const first = await runFlowStep(deps, {
    run,
    trigger: "turn",
    brandName: "L",
  });
  assert(first.kind === "artefact");
  const before = await current(store);
  for (const trigger of ["resume", "handoff_return"] as const) {
    const again = await runFlowStep(deps, {
      run: await current(store),
      trigger,
      brandName: "L",
    });
    assertEquals(again.kind, "unchanged");
    if (again.kind === "unchanged") {
      assertEquals(again.artefact?.artefact_id, first.artefact.artefact_id);
    }
  }
  const after = await current(store);
  assertEquals(after.current_question_id, before.current_question_id);
  assertEquals(after.revision, before.revision, "resume writes nothing");
});

// ── Adversarial ─────────────────────────────────────────────────────────────

Deno.test("P3 adversarial: a stale question id is refused with the current card and changes nothing", async () => {
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(freshWorld({ roleOk: false })) };
  const run = await startEventRun(store);
  await runFlowStep(deps, { run, trigger: "turn", brandName: "L" });
  const live = await current(store);
  const stale = await runFlowStep(deps, {
    run: live,
    trigger: "answer",
    answer: {
      ...answerFor(live, "check"),
      question_id: "99999999-9999-4999-8999-999999999999",
    },
    brandName: "L",
  });
  assertEquals(stale.kind, "stale");
  if (stale.kind === "stale") {
    assertEquals(
      stale.artefact?.artefact_id,
      live.current_artefact?.artefact_id,
    );
  }
  const after = await current(store);
  assertEquals(after.revision, live.revision);
  assertEquals(after.step_states.brand_blockers.state, "human_action");

  // The pre-claim guard says the same without touching the run.
  const preClaim = await staleFlowAnswer({
    store,
    conversationId: CHAT,
    answer: {
      ...answerFor(live, "check"),
      question_id: "99999999-9999-4999-8999-999999999999",
    },
  });
  assertEquals(preClaim?.next?.artefact_id, live.current_artefact?.artefact_id);
  assertEquals(
    await staleFlowAnswer({
      store,
      conversationId: CHAT,
      answer: answerFor(live, "check"),
    }),
    null,
    "the current card's answer is not stale",
  );
  // A tampered choice id is never applied either.
  const tampered = await runFlowStep(deps, {
    run: live,
    trigger: "answer",
    answer: { ...answerFor(live, "check"), choice_id: "not_now" },
    brandName: "L",
  });
  assertEquals(tampered.kind, "stale");
});

Deno.test("P3 adversarial: two concurrent requests — one works, the other is busy", async () => {
  const store = new MemoryStore(OWNER);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const world = freshWorld({ roleOk: false });
  const slow: FlowProbeDeps = {
    ...probesFor(world),
    async readiness(action) {
      await gate;
      return readinessFor(world, action);
    },
  };
  const run = await startEventRun(store);
  const a = runFlowStep({ store, probes: slow }, {
    run,
    trigger: "turn",
    brandName: "L",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pendingB = runFlowStep({ store, probes: slow }, {
    run,
    trigger: "turn",
    brandName: "L",
  }).catch((error: unknown) => ({ kind: `threw:${String(error)}` }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  const [first, b] = await Promise.all([
    a.catch((error: unknown) => ({ kind: `threw:${String(error)}` })),
    pendingB,
  ]);
  assertEquals(b.kind, "busy", "the second request must not do the work");
  if (b.kind === "busy" && "text" in b) {
    assertEquals((b as { view_only: boolean }).view_only, false);
    assertMatch((b as { text: string }).text, /another window/);
  }
  assertEquals(first.kind, "artefact");
  assertEquals(store.patches.length, 1, "exactly one request advanced the run");
});

Deno.test("P3 adversarial: an expired lease lets a second device continue; a teammate is view-only", async () => {
  const store = new MemoryStore(OWNER);
  const run = await startEventRun(store);
  // Device A leased and vanished.
  await store.lease(run.id, "device-a", 30);
  const blocked = await runFlowStep(
    { store, probes: probesFor(freshWorld({ roleOk: false })) },
    {
      run,
      trigger: "turn",
      brandName: "L",
    },
  );
  assertEquals(blocked.kind, "busy");
  store.clock += 31_000;
  const continued = await runFlowStep({
    store,
    probes: probesFor(freshWorld({ roleOk: false })),
  }, {
    run,
    trigger: "turn",
    brandName: "L",
  });
  assertEquals(continued.kind, "artefact");

  const mate = new MemoryStore(MATE, store);
  const viewOnly = await runFlowStep({
    store: mate,
    probes: probesFor(freshWorld({ roleOk: false })),
  }, {
    run: (await mate.getForConversation(CHAT))!,
    trigger: "resume",
    brandName: "L",
  });
  assertEquals(viewOnly.kind, "busy");
  if (viewOnly.kind === "busy") {
    assertEquals(viewOnly.view_only, true);
    assertMatch(viewOnly.text, /^Ada Owner is working on this/);
  }
});

Deno.test("P3 adversarial: 'I've uploaded it' with nothing uploaded keeps the handoff and says so", async () => {
  // #3355 Wave A: what can wait is never a card, so the handoff here is an
  // item that blocks the draft and the owner can fix.
  const world = freshWorld({ blockDraft: new Set(["profile_photo"]) });
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(world) };
  const run = await startEventRun(store);
  const fix = await runFlowStep(deps, { run, trigger: "turn", brandName: "L" });
  assertEquals(fix.kind, "artefact");
  if (fix.kind !== "artefact") return;
  assertEquals(fix.artefact.kind, "handoff");
  assertEquals(fix.artefact.options.map((o) => o.id), [
    "open",
    "check",
    "cancel",
  ]);
  const handoffId = fix.artefact.artefact_id;

  const claim = await runFlowStep(deps, {
    run: await current(store),
    trigger: "turn",
    ownerText: "I've uploaded it",
    brandName: "L",
  });
  assertEquals(claim.kind, "notice");
  if (claim.kind === "notice") {
    assertMatch(claim.text, /^I checked; your brand logo isn't there yet\./);
    assertEquals(claim.artefact?.artefact_id, handoffId);
  }
  assertEquals(
    (await current(store)).current_artefact?.artefact_id,
    handoffId,
    "the handoff stays the current card — no duplicate",
  );

  world.set.add("profile_photo");
  const verified = await runFlowStep(deps, {
    run: await current(store),
    trigger: "answer",
    answer: answerFor(await current(store), "check"),
    brandName: "L",
  });
  assertEquals(verified.kind, "delegate", "sorted: the flow moves on");
  if (verified.kind === "delegate") {
    assertMatch(verified.ack ?? "", /^I checked; your brand logo is sorted now\./);
  }
});

Deno.test("P3 adversarial: a blocker is a handoff with no 'not now'; stop cancels honestly", async () => {
  const store = new MemoryStore(OWNER);
  const deps = { store, probes: probesFor(freshWorld({ roleOk: false })) };
  const run = await startEventRun(store);
  const blocked = await runFlowStep(deps, {
    run,
    trigger: "turn",
    brandName: "L",
  });
  assertEquals(blocked.kind, "artefact");
  if (blocked.kind !== "artefact") return;
  assertEquals(blocked.artefact.step_key, "brand_blockers");
  assertMatch(blocked.artefact.text, /Only the brand owner can do this\./);
  assert(!blocked.artefact.options.some((o) => o.id === "not_now"));
  const stopped = await runFlowStep(deps, {
    run: await current(store),
    trigger: "turn",
    ownerText: "never mind",
    brandName: "L",
  });
  assertEquals(stopped.kind, "cancelled");
  assertEquals((await current(store)).status, "cancelled");
});

Deno.test("P3 adversarial: paid intent says once what blocks selling and keeps building the draft", async () => {
  const store = new MemoryStore(OWNER);
  const deps = {
    store,
    probes: probesFor(
      freshWorld({ set: new Set(["profile_photo", "contact_phone"]) }),
    ),
  };
  const run = await startEventRun(store, "Create a paid event, tickets £15");
  const money = await runFlowStep(deps, {
    run,
    trigger: "turn",
    brandName: "L",
  });
  assertEquals(money.kind, "artefact");
  if (money.kind !== "artefact") return;
  assertEquals(money.artefact.step_key, "money_gate");
  assertMatch(money.artefact.text, /with paid tickets now/);
  // [TEST-MOD-APPROVED #3355 P6] the money gate now walks one item at a time
  // and a teammate's owner-only item says so in the owner handoff words.
  assertMatch(
    money.artefact.text,
    /Payments aren't set up for selling yet\. Only the owner can do this — tell them\?/,
  );
  const going = await runFlowStep(deps, {
    run: await current(store),
    trigger: "answer",
    answer: answerFor(await current(store), "continue"),
    brandName: "L",
  });
  assertEquals(going.kind, "delegate", "money never blocks a draft (Seth #3)");
});

// ── Deterministic readiness answers, classifiers, copy ──────────────────────

Deno.test("P3: readiness questions are answered from the checklist with no model", async () => {
  assertEquals(
    classifyReadinessQuestion(
      "What does my brand still need before I can sell paid tickets?",
    ),
    "publish_paid",
  );
  assertEquals(
    classifyReadinessQuestion("What does my brand still need?"),
    "all",
  );
  assertEquals(classifyReadinessQuestion("Create an event on Friday"), null);
  const answer = buildReadinessAnswer({
    readiness: readinessFor(freshWorld(), "publish_paid"),
    action: "publish_paid",
    brandName: "Lantern",
  });
  assertMatch(
    answer.text,
    /^Before Lantern can sell paid tickets, this needs doing:/,
  );
  assertMatch(
    answer.text,
    /Ready to sell paid tickets: only the brand owner can do this\./,
  );
  assertMatch(answer.text, /can wait: Brand logo and Contact phone/);
  assertNotMatch(answer.text, /Approved Website plan/);

  let modelCalled = false;
  const rpc = (fn: string, args: Record<string, unknown>) => {
    if (fn !== "brand_readiness") modelCalled = true;
    return Promise.resolve({
      data: readinessFor(freshWorld(), args.p_action as ReadinessAction),
      error: null,
    });
  };
  const started = performance.now();
  const decision = await decideFlowTurn({
    // deno-lint-ignore no-explicit-any
    service: {} as any,
    // deno-lint-ignore no-explicit-any
    userClient: { rpc } as any,
    userId: OWNER,
    brand: { id: BRAND, name: "Lantern" },
    conversationId: CHAT,
    message: "What does my brand still need before I can sell paid tickets?",
    flowAnswer: null,
    engineEnabled: false,
    otherLaneActive: false,
  });
  assertEquals(decision.kind, "reply");
  if (decision.kind === "reply") {
    assertEquals(decision.classification, "readiness_answer");
  }
  assert(!modelCalled);
  assert(performance.now() - started < 1000);
});

Deno.test("P3: offering intent classifier", () => {
  assertEquals(classifyOfferingIntent("Create an event"), "create_event");
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
  assertEquals(classifyOfferingIntent("How do I create an event?"), null);
  assertEquals(classifyOfferingIntent("List my events"), null);
  assertEquals(classifyOfferingIntent("Publish my event"), null);
  assertEquals(classifyOfferingIntent("Make a flyer for my event"), null);
  assert(intentWantsPaid("tickets £15"));
  assert(!intentWantsPaid("a free party"));
});

Deno.test("P3: flow answers must be fully bound", () => {
  const ok = {
    run_id: "66666666-6666-4666-8666-666666666666",
    step_key: "brand_can_wait",
    question_id: "77777777-7777-4777-8777-777777777777",
    choice_id: "fix:profile_photo",
    display_text: "Add brand logo",
  };
  assert(parseFlowAnswer(ok));
  assertEquals(parseFlowAnswer({ ...ok, question_id: "q1" }), null);
  assertEquals(parseFlowAnswer({ ...ok, choice_id: "DROP TABLE" }), null);
  assertEquals(parseFlowAnswer({ ...ok, display_text: "" }), null);
});

Deno.test("P3: honest stop copy never claims kept work or a blocker that isn't there", () => {
  for (const reason of ["deadline", "budget", "errors"]) {
    const text = honestLoopStopText(reason, []);
    assertNotMatch(text, /kept|resume from here|below|tool errors/i);
    assertMatch(text, /Nothing was changed|nothing was changed/);
  }
  assertEquals(honestLoopStopText("deadline", []), ARI_OUT_OF_TIME_LINE);
  assertEquals(honestLoopStopText("errors", []), ARI_LOOP_PROBLEM_LINE);
  assertEquals(
    honestLoopStopText("errors", [{
      error: {
        code: "DOMAIN_REFUSED",
        message:
          "Payments aren't set up yet, so paid tickets can't go on sale.",
      },
    }]),
    "I couldn't do that. Payments aren't set up yet, so paid tickets can't go on sale.",
  );
  const chat = Deno.readTextFileSync(
    new URL("supabase/functions/agent-chat/index.ts", ROOT),
  );
  assertNotMatch(chat, /stated the blocker below/);
  assertNotMatch(chat, /I kept the completed steps and can resume/);
});

Deno.test("P3: engine rows are assistant rows only — never a user turn or an attempt", async () => {
  const writes: Array<{ table: string; row: Record<string, unknown> }> = [];
  const service = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          writes.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  const id = await persistFlowRow({
    // deno-lint-ignore no-explicit-any
    service: service as any,
    userId: OWNER,
    conversationId: CHAT,
    text: "Next step",
    artefact: null,
    state: null,
    promptVersion: "p",
    modelVersion: "m",
  });
  assert(id);
  assertEquals(writes.map((w) => [w.table, w.row.role]), [[
    "agent_messages",
    "assistant",
  ]]);
  assert(!("client_turn_id" in writes[0].row), "no turn id: not a turn");
});

Deno.test("P3: the Host never authors a continuation; confirm asks for server continuation", () => {
  const screen = Deno.readTextFileSync(
    new URL("mingla-business/src/screens/ari/AriChatScreen.tsx", ROOT),
  );
  assertNotMatch(screen, /sendMessage\(\s*["'`]Continue /);
  assertNotMatch(screen, /Continue Website setup: resume/);
  const service = Deno.readTextFileSync(
    new URL("mingla-business/src/services/agentChatService.ts", ROOT),
  );
  assertMatch(service, /continuation: "server"/);
});

Deno.test("P3: chained follow-on proposals use the allowed pending-action source", () => {
  const confirm = Deno.readTextFileSync(
    new URL("supabase/functions/agent-confirm-action/index.ts", ROOT),
  );
  assertNotMatch(confirm, /source:\s*"ari_chat"/);
  assertMatch(confirm, /source:\s*"ari",/);
});

// ── Confirm carries next; resume reads without writing ──────────────────────

import { flowNextAfterConfirm } from "../../agent-confirm-action/confirmNext.ts";
import { resumeFlowForHost } from "../../agent-turn-control/flowResume.ts";

function fakeClients(world: World) {
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
  const userClient = {
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "brand_readiness") {
        return Promise.resolve({
          data: readinessFor(
            world,
            (args.p_action ?? null) as ReadinessAction | null,
          ),
          error: null,
        });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        maybeSingle: () => {
          if (table === "events") {
            return Promise.resolve({
              data: world.events.has(filters.id as string)
                ? { id: filters.id }
                : null,
              error: null,
            });
          }
          if (table === "agent_conversations") {
            return Promise.resolve({
              data: { id: CHAT, brand_id: BRAND },
              error: null,
            });
          }
          if (table === "brands") {
            return Promise.resolve({
              data: { id: BRAND, name: "Lantern" },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return chain;
    },
  };
  const service = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserted.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { userClient, service, inserted };
}

Deno.test("P3 happy: confirm of the created event returns the next step, saved as one assistant row", async () => {
  const world = freshWorld({
    set: new Set(["profile_photo", "contact_phone"]),
  });
  const store = new MemoryStore(OWNER);
  const run = await startEventRun(store);
  await runFlowStep({ store, probes: probesFor(world) }, {
    run,
    trigger: "turn",
    brandName: "L",
  });
  world.events.add(EVENT_ID);
  const { userClient, service, inserted } = fakeClients(world);
  const result = await flowNextAfterConfirm({
    // deno-lint-ignore no-explicit-any
    userClient: userClient as any,
    // deno-lint-ignore no-explicit-any
    service: service as any,
    userId: OWNER,
    conversationId: CHAT,
    brand: { id: BRAND, name: "Lantern" },
    confirmed: {
      tool_name: "create_event",
      result: { event: { id: EVENT_ID } },
    },
    promptVersion: "p",
    modelVersion: "m",
    enabled: true,
    store,
  });
  assert(result.next, "confirm must carry next");
  assertMatch(result.next!.text, /draft is saved and I've checked it's there/);
  assertEquals(result.flow_state?.status, "completed");
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].table, "agent_messages");
  assertEquals(inserted[0].row.role, "assistant");
  assertEquals(inserted[0].row.id, result.next!.message_id);
});

Deno.test("P3 happy: resume returns the open card and writes nothing; flag off returns nothing", async () => {
  const world = freshWorld({ roleOk: false });
  const store = new MemoryStore(OWNER);
  const run = await startEventRun(store);
  const first = await runFlowStep({ store, probes: probesFor(world) }, {
    run,
    trigger: "turn",
    brandName: "L",
  });
  assert(first.kind === "artefact");
  const before = (await current(store)).revision;
  const { userClient, service, inserted } = fakeClients(world);
  const resumed = await resumeFlowForHost({
    // deno-lint-ignore no-explicit-any
    service: service as any,
    // deno-lint-ignore no-explicit-any
    userClient: userClient as any,
    userId: OWNER,
    conversationId: CHAT,
    trigger: "resume",
    enabled: true,
    store,
  });
  assertEquals(resumed.status, 200);
  assertEquals(
    (resumed.body.artefact as FlowArtefact).artefact_id,
    first.artefact.artefact_id,
  );
  assertEquals(
    (resumed.body.flow_state as { current_artefact_id: string })
      .current_artefact_id,
    first.artefact.artefact_id,
  );
  assertEquals(inserted.length, 0, "a reload never appends a card");
  assertEquals((await current(store)).revision, before);

  const handoffReturn = await resumeFlowForHost({
    // deno-lint-ignore no-explicit-any
    service: service as any,
    // deno-lint-ignore no-explicit-any
    userClient: userClient as any,
    userId: OWNER,
    conversationId: CHAT,
    trigger: "handoff_return",
    enabled: true,
    store,
  });
  assertEquals(handoffReturn.body.next, null, "nothing changed: no new card");
  assertEquals(inserted.length, 0);

  const off = await resumeFlowForHost({
    // deno-lint-ignore no-explicit-any
    service: service as any,
    // deno-lint-ignore no-explicit-any
    userClient: userClient as any,
    userId: OWNER,
    conversationId: CHAT,
    trigger: "resume",
    enabled: false,
    store,
  });
  assertEquals(off.body, { flow_state: null, artefact: null });
});

Deno.test("cert D7: the paid-readiness answer lists its blockers once — no closing paragraph repeating them", () => {
  const answer = buildReadinessAnswer({
    readiness: readinessFor(freshWorld(), "publish_paid"),
    action: "publish_paid",
    brandName: "Lantern",
  });
  assertMatch(answer.text, /Ready to sell paid tickets: only the brand owner/);
  // Live: "Paid selling isn't ready: …" closed the answer, saying the same
  // blockers a second time.
  assertNotMatch(answer.text, /Paid selling isn't ready/);
  assertNotMatch(answer.text, /no bank is connected yet\.?$/);
});
