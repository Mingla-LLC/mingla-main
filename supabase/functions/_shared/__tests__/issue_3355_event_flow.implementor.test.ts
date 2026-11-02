// Issue #3355 P7 — "Create an event" on the Ari flow engine (implementor
// happy path + adversarial).
//
// MINGLA-INVARIANT: I-ARI-NO-INVENTED-FACTS | issue #3355 | Every fact Ari saves on an event it creates traces to the owner: their request, a card answer, a suggestion they picked, or the brand's own time zone shown on the card they confirm. No end time, ticket tier, time zone or visibility is filled in for them (server side: supabase/migrations/__tests__/issue_3355_event_seed_truth.implementor.pg17.test.sql).
// MINGLA-INVARIANT: I-ARI-NEVER-AUTO-PUBLISH | issue #3355 | Ari proposes publishing an event only from the owner's own "Publish it" answer, behind its own protected confirmation; no probe, resume, reload, confirm or typed side turn ever puts a publish in front of the owner.
//
// Drives the shipped flow (supabase/functions/_shared/ariFlows/offerings/
// event.ts) through the shipped runner with an in-memory run store that keeps
// the SQL rules (lease, compare-and-swap, evidence for every done):
//   Script A — "Create an event for next Friday at 7pm called Lantern Supper"
//     → what can wait (not now) → end time (owner picks 10:30pm) → in person
//     → a picked place → ONE create proposal holding only the owner's facts →
//     confirm → read back → "get it ready to publish?" → not now → summary.
//   Script B — publish-ready with a paid ticket on a brand that can't take
//     payments: details proposal, the money card (keep going), the ticket
//     proposal with the heads-up, visibility, then "Publish it" is refused
//     with the plain fix and nothing is proposed.
//   Adversarial — duplicate guard, curly quotes, "Seth's Party", time zone
//   from the brand (never a device or UTC), no end without the owner, private
//   never sent, a stale question id, never auto-publish, the seed migration.
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_event_flow.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { runFlowStep, type RunnerOutcome } from "../ariFlows/runner.ts";
import type { FlowStore } from "../ariFlows/store.ts";
import type {
  BrandReadiness,
  BrandReadinessItem,
  FlowAnswer,
  FlowEventRow,
  FlowProbeDeps,
  FlowRun,
  FlowStepRecord,
} from "../ariFlows/types.ts";
import {
  classifyOfferingIntent,
  findFlowDefinition,
} from "../ariFlows/index.ts";
import { decideFlowTurn, parseFlowAnswer } from "../ariFlows/edge.ts";
import {
  CREATE_EVENT_FLOW,
  createEventArgs,
  createRows,
  duplicateDrafts,
  parseTicketAnswer,
  UNPUBLISHED_DRAFT_WORDS,
} from "../ariFlows/offerings/event.ts";
import {
  extractEventTitle,
  parseEventEnd,
} from "../ariFlows/offerings/eventFacts.ts";
import { buildProposalPresentation } from "../ariPresentation/registry.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";

const ROOT = new URL("../../../../", import.meta.url);
const OWNER = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const CHAT = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";
const OLD_EVENT = "66666666-6666-4666-8666-666666666666";

// ── A small world ───────────────────────────────────────────────────────────
interface World {
  canSell: boolean;
  brand: {
    default_timezone: string | null;
    country_code: string | null;
    default_currency: string | null;
  };
  events: Map<string, FlowEventRow>;
  titled: FlowEventRow[];
  openProposal: boolean;
}

function item(
  key: string,
  label: string,
  group: string,
  blockingFor: string[],
  recommendedFor: string[],
  done: boolean,
  action: ReadinessAction | null,
): BrandReadinessItem {
  const blocks = !!action && blockingFor.includes(action) && !done;
  return {
    key,
    label,
    group,
    state: done ? "verified" : "missing",
    severity: blocks ? "blocking" : done ? "done" : "skippable",
    blocks_action: blocks,
    blocking_for: blockingFor,
    recommended_for: recommendedFor,
    value_preview: null,
    deferrable: group !== "money",
    deferral: null,
    skip_in_ari: false,
    owner_action: "answer",
    fix: {
      route: group === "money"
        ? `/brand/${BRAND}/payments/onboard`
        : `/brand/${BRAND}/edit`,
      route_label: group === "money" ? "Payments setup" : "Brand profile",
      can_caller_fix: true,
      who_can_fix: "you",
    },
    ask: { control: "text" },
  };
}

function readinessFor(
  world: World,
  action: ReadinessAction | null,
): BrandReadiness {
  const items = [
    item(
      "profile_photo",
      "Brand logo",
      "media",
      ["website_build"],
      ["publish_free", "publish_paid"],
      false,
      action,
    ),
    item(
      "money.can_sell",
      "Ready to sell paid tickets",
      "money",
      ["publish_paid"],
      [],
      world.canSell,
      action,
    ),
  ];
  return {
    brand_id: BRAND,
    action,
    can_proceed: !items.some((i) => i.blocks_action),
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

function probesFor(world: World): FlowProbeDeps {
  return {
    readiness: (action) => Promise.resolve(readinessFor(world, action)),
    subjectExists: (_table, id) => Promise.resolve(world.events.has(id)),
    setAside: () => Promise.resolve("brand"),
    hasOpenProposal: () => Promise.resolve(world.openProposal),
    brandFacts: () => Promise.resolve(world.brand),
    eventRow: (id) => Promise.resolve(world.events.get(id) ?? null),
    eventsTitled: () => Promise.resolve(world.titled),
  };
}

function freshWorld(overrides: Partial<World> = {}): World {
  return {
    canSell: false,
    brand: {
      default_timezone: null,
      country_code: "GB",
      default_currency: "GBP",
    },
    events: new Map(),
    titled: [],
    openProposal: false,
    ...overrides,
  };
}

// ── In-memory store with the SQL rules (lease, CAS, evidence) ───────────────
class MemoryStore implements FlowStore {
  runs = new Map<string, FlowRun & { token: string | null }>();
  patches: Array<Record<string, unknown>> = [];
  start(args: Parameters<FlowStore["start"]>[0]) {
    const run = {
      id: crypto.randomUUID(),
      brand_id: args.brandId,
      flow_key: args.flowKey,
      flow_version: args.flowVersion,
      concurrency: args.concurrency,
      subject_id: null,
      conversation_id: args.conversationId,
      status: "active" as const,
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
      token: null,
    };
    this.runs.set(run.id, run);
    return Promise.resolve({
      created: true,
      owned_by_other: false,
      owner_display_name: null,
      run: this.view(run),
    });
  }
  private view(run: FlowRun & { token: string | null }): FlowRun {
    const { token: _token, ...rest } = structuredClone(run);
    return rest;
  }
  lease(runId: string, token: string) {
    const run = this.runs.get(runId)!;
    if (["completed", "cancelled", "expired"].includes(run.status)) {
      return Promise.resolve({
        ok: false,
        reason: "terminal" as const,
        owner_display_name: null,
        run: this.view(run),
      });
    }
    run.token = token;
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
    if (run.token !== token) return Promise.reject(new Error("lease"));
    if (rev !== run.revision) return Promise.reject(new Error("revision"));
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
    if (run.token === token) run.token = null;
    return Promise.resolve();
  }
  getForConversation(conversationId: string) {
    const run = [...this.runs.values()].find((r) =>
      r.conversation_id === conversationId
    );
    return Promise.resolve(run ? this.view(run) : null);
  }
  getById(runId: string) {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? this.view(run) : null);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────
const BRAND_NAME = "Lantern Supper Club";

async function startRun(store: MemoryStore, text: string): Promise<FlowRun> {
  const def = findFlowDefinition("create_event")!;
  assertEquals(def.version, 2, "new event runs use the engine flow");
  return (await store.start({
    brandId: BRAND,
    flowKey: def.key,
    flowVersion: def.version,
    concurrency: def.concurrency,
    conversationId: CHAT,
    answers: {
      intent_text: { value: text, source: "owner" },
      paid: { value: false, source: "owner" },
    },
  })).run;
}

async function cur(store: MemoryStore): Promise<FlowRun> {
  return (await store.getForConversation(CHAT))!;
}

function choice(run: FlowRun, id: string): FlowAnswer {
  return {
    run_id: run.id,
    step_key: run.current_step_key!,
    question_id: run.current_question_id!,
    choice_id: id,
    display_text: run.current_artefact?.options.find((o) => o.id === id)
      ?.label ?? id,
  };
}

function form(
  run: FlowRun,
  values: Partial<NonNullable<FlowAnswer["values"]>>,
): FlowAnswer {
  return {
    run_id: run.id,
    step_key: run.current_step_key!,
    question_id: run.current_question_id!,
    choice_id: "answer",
    display_text: "answer",
    values: { choices: [], country: null, response: "", ...values },
  };
}

async function answer(
  world: World,
  store: MemoryStore,
  a: (run: FlowRun) => FlowAnswer,
): Promise<RunnerOutcome> {
  const run = await cur(store);
  return await runFlowStep({ store, probes: probesFor(world) }, {
    run,
    trigger: "answer",
    answer: a(run),
    brandName: BRAND_NAME,
  });
}

/** Stand-in for agent-confirm-action: the write lands, then the runner runs. */
async function confirm(
  world: World,
  store: MemoryStore,
  toolName: string,
  apply: () => void,
  result: unknown = {},
): Promise<RunnerOutcome> {
  world.openProposal = false;
  apply();
  return await runFlowStep({ store, probes: probesFor(world) }, {
    run: await cur(store),
    trigger: "confirm",
    confirmed: { tool_name: toolName, result },
    brandName: BRAND_NAME,
  });
}

const SHOREDITCH = {
  venue_name: "Shoreditch Town Hall",
  address: "380 Old Street, London EC1V 9LT",
  city: "London",
  country_code: "GB",
  lat: 51.5265,
  lng: -0.0806,
  feature_type: "poi",
};

function londonClock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function rowFrom(args: Record<string, unknown>): FlowEventRow {
  return {
    id: EVENT_ID,
    title: String(args.title),
    status: "draft",
    timezone: String(args.timezone),
    description: null,
    party_types: [],
    city: (args.city as string) ?? null,
    cover_media_url: null,
    online_url: null,
    created_at: new Date().toISOString(),
    draft: {
      format: args.format,
      clientRevision: 0,
      when: { date: "2026-11-06", doorsOpen: "19:00", endsAt: "22:30" },
      location: { venueName: args.location_text, address: args.location_address },
      tickets: [],
    },
  };
}

/** Script A up to the create proposal. */
async function toCreateProposal(world: World, store: MemoryStore) {
  const run = await startRun(
    store,
    "Create an event for next Friday at 7pm called Lantern Supper",
  );
  const first = await runFlowStep({ store, probes: probesFor(world) }, {
    run,
    trigger: "turn",
    brandName: BRAND_NAME,
  });
  assertEquals(first.kind, "artefact");
  assertEquals((await cur(store)).current_step_key, "brand_can_wait");
  const end = await answer(world, store, (r) => choice(r, "not_now"));
  assertEquals(end.kind, "artefact");
  if (end.kind !== "artefact") throw new Error("no end card");
  // Title, start and time zone came from the request and the brand.
  assertEquals(end.artefact.step_key, "event_end");
  assertMatch(end.artefact.text, /How long does it run\? It starts Fri/);
  assertEquals(end.artefact.options[0].label, "Ends at 9:00 pm");
  assertEquals(end.artefact.answer_mode, "form");
  const format = await answer(
    world,
    store,
    (r) => form(r, { response: "10:30pm" }),
  );
  assert(format.kind === "artefact");
  assertEquals(format.artefact.step_key, "event_format");
  const place = await answer(world, store, (r) => choice(r, "in_person"));
  assert(place.kind === "artefact");
  assertEquals(place.artefact.step_key, "event_place");
  assertEquals(place.artefact.answer_mode, "form");
  return await answer(world, store, (r) => form(r, { place: SHOREDITCH }));
}

// ── Script A ────────────────────────────────────────────────────────────────

Deno.test("P7 Script A: the owner's words become one create proposal with only their facts", async () => {
  assertEquals(
    classifyOfferingIntent(
      "Create an event for next Friday at 7pm called Lantern Supper",
    ),
    "create_event",
    "intent is found without the model",
  );
  const world = freshWorld();
  const store = new MemoryStore();
  const proposed = await toCreateProposal(world, store);
  assertEquals(proposed.kind, "propose");
  if (proposed.kind !== "propose") return;
  assertEquals(proposed.tool_name, "create_event");
  const args = proposed.tool_args;
  assertEquals(args.title, "Lantern Supper");
  assertEquals(args.timezone, "Europe/London", "the brand's country's zone");
  assertEquals(londonClock(String(args.start_at)), "19:00");
  assertEquals(londonClock(String(args.end_at)), "22:30", "the owner's end");
  assertEquals(args.format, "in_person");
  assertEquals(args.location_text, "Shoreditch Town Hall");
  assertEquals(args.location_address, "380 Old Street, London EC1V 9LT");
  assertEquals(args.city, "London");
  assertEquals(args.hide_address_until_ticket, false, "a venue, not a home");
  assertEquals(args.visibility, "public");
  assertEquals("tickets" in args, false, "no ticket the owner didn't give");
  assertEquals("description" in args, false);
  // Plain card words only; "unpublished", never "private".
  assertEquals(proposed.rows_only, true);
  const rows = proposed.rows.map((r) => `${r.label}: ${r.value}`).join("\n");
  assertMatch(rows, /When: Fri .*, 7:00 pm – 10:30 pm \(London time\)/);
  assertMatch(rows, /Time zone: London time, from your brand's country/);
  assertMatch(rows, /Where: Shoreditch Town Hall, 380 Old Street/);
  assertMatch(rows, new RegExp(UNPUBLISHED_DRAFT_WORDS.replace(/[.—]/g, ".")));
  assertNotMatch(rows, /private|create_event|_/i);
  const presentation = buildProposalPresentation("create_event", {
    ...args,
    __proposal_context: { flow_rows: proposed.rows, flow_rows_only: true },
  });
  assertEquals(presentation.title, "Lantern Supper");
  assertEquals(
    presentation.fields.map((f) => f.label),
    ["When", "Time zone", "Where", "Status"],
    "no raw coordinates or visibility on the card",
  );
  assertEquals((await cur(store)).status, "awaiting_approval");

  // Confirm → read back → "get it ready to publish?" in the same response.
  const next = await confirm(
    world,
    store,
    "create_event",
    () => world.events.set(EVENT_ID, rowFrom(args)),
    { event: { id: EVENT_ID } },
  );
  assertEquals(next.kind, "artefact");
  if (next.kind !== "artefact") return;
  assertMatch(next.text, /Saved and checked: "Lantern Supper" is an unpublished draft/);
  assertEquals(next.artefact.step_key, "event_publish_ready");
  assertMatch(next.artefact.text, /party type, a short description, tickets/);
  assertEquals((await cur(store)).subject_id, EVENT_ID);

  const done = await answer(world, store, (r) => choice(r, "not_now"));
  assertEquals(done.kind, "completed");
  if (done.kind !== "completed") return;
  assertMatch(done.text, /unpublished draft.*Nobody can see it until you publish/);
  assertNotMatch(done.text, /private/i);
  const final = await cur(store);
  assertEquals(final.status, "completed");
  // Every saved fact traces to the owner (I-ARI-NO-INVENTED-FACTS).
  assertEquals(final.answers.end_at?.source, "owner");
  assertEquals(final.answers.format?.source, "owner");
  assertEquals(final.answers.place?.source, "owner");
  assertEquals(final.step_states.event_timezone.evidence?.observed, {
    timezone: "Europe/London",
    source: "country",
  });
  for (const patch of store.patches) {
    for (
      const value of Object.values(
        (patch.step_states ?? {}) as Record<string, FlowStepRecord>,
      )
    ) {
      if (value.state === "done") assert(value.evidence?.probe);
    }
  }
});

// ── Script B ────────────────────────────────────────────────────────────────

Deno.test("P7 Script B: a paid ticket is saved on the draft with a heads-up; publishing is refused with the plain fix", async () => {
  const world = freshWorld({ canSell: false });
  const store = new MemoryStore();
  const proposed = await toCreateProposal(world, store);
  assert(proposed.kind === "propose");
  await confirm(
    world,
    store,
    "create_event",
    () => world.events.set(EVENT_ID, rowFrom(proposed.tool_args)),
    { event: { id: EVENT_ID } },
  );
  const cover = await answer(world, store, (r) => choice(r, "yes"));
  assert(cover.kind === "artefact");
  assertEquals(cover.artefact.step_key, "event_cover");
  assertEquals(cover.artefact.subject_id, EVENT_ID, "the upload knows its event");
  assertEquals(cover.artefact.handoff?.item_key, "event_cover");
  const party = await answer(world, store, (r) => choice(r, "not_now"));
  assert(party.kind === "artefact");
  assertEquals(party.artefact.step_key, "event_party_types");
  const description = await answer(
    world,
    store,
    (r) => form(r, { choices: ["Themed Party"] }),
  );
  assert(description.kind === "artefact");
  assertEquals(description.artefact.step_key, "event_description");
  const details = await answer(
    world,
    store,
    (r) => form(r, { response: "A candlelit supper with live strings." }),
  );
  assertEquals(details.kind, "propose");
  if (details.kind !== "propose") return;
  assertEquals(details.tool_name, "update_event");
  assertEquals(details.tool_args, {
    event_id: EVENT_ID,
    client_revision: 1,
    party_types: ["themed-party"],
    description: "A candlelit supper with live strings.",
  });

  const kind = await confirm(world, store, "update_event", () => {
    const row = world.events.get(EVENT_ID)!;
    row.party_types = ["themed-party"];
    row.description = "A candlelit supper with live strings.";
    row.draft.clientRevision = 1;
  });
  assert(kind.kind === "artefact");
  assertMatch(kind.text, /party type and description are on the draft/);
  assertEquals(kind.artefact.step_key, "event_ticket_kind");

  // "Paid" brings the money card first: it can wait (decision 3).
  const money = await answer(world, store, (r) => choice(r, "paid"));
  assert(money.kind === "artefact");
  assertEquals(money.artefact.step_key, "money_gate");
  assertMatch(money.artefact.text, /Payments aren't set up for selling yet/);
  assertMatch(money.artefact.text, /with paid tickets now/);
  assert(money.artefact.options.some((o) => o.id === "continue"));
  assert(
    money.artefact.options.some((o) =>
      o.route === `/brand/${BRAND}/payments/onboard`
    ),
  );
  const ticket = await answer(world, store, (r) => choice(r, "continue"));
  assert(ticket.kind === "artefact");
  assertEquals(ticket.artefact.step_key, "event_ticket_details");
  const ticketProposal = await answer(
    world,
    store,
    (r) => form(r, { response: "£15, 60 tickets" }),
  );
  assertEquals(ticketProposal.kind, "propose");
  if (ticketProposal.kind !== "propose") return;
  assertEquals(ticketProposal.tool_name, "upsert_ticket_tier");
  assertEquals(ticketProposal.tool_args, {
    event_id: EVENT_ID,
    name: "General admission",
    is_free: false,
    is_unlimited: false,
    capacity: 60,
    price_cents: 1500,
  });
  const ticketRows = ticketProposal.rows.map((r) => `${r.label}: ${r.value}`)
    .join("\n");
  assertMatch(ticketRows, /Price: £15/);
  assertMatch(ticketRows, /How many: 60/);
  assertMatch(ticketRows, /Heads-up: You can add paid tickets now/);

  const visibility = await confirm(world, store, "upsert_ticket_tier", () => {
    world.events.get(EVENT_ID)!.draft.tickets = [{
      name: "General admission",
      isFree: false,
      priceGbp: 15,
      capacity: 60,
    }];
  });
  assert(visibility.kind === "artefact");
  assertEquals(visibility.artefact.step_key, "event_visibility");
  assertEquals(
    visibility.artefact.options.map((o) => o.label),
    ["Public", "Unlisted"],
    "Public first; Private never offered while frozen",
  );
  const publish = await answer(world, store, (r) => choice(r, "public"));
  assert(publish.kind === "artefact");
  assertEquals(publish.artefact.step_key, "event_publish");
  assertMatch(publish.artefact.text, /Can't publish yet: payment setup isn't finished/);
  assertNotMatch(publish.artefact.text, /verifying/i);

  // The owner asks anyway: refused in plain words, nothing proposed.
  const refused = await answer(world, store, (r) => choice(r, "publish"));
  assertEquals(refused.kind, "artefact");
  if (refused.kind !== "artefact") return;
  assertMatch(refused.text, /Can't publish yet: payment setup isn't finished\. Nothing was published\./);
  assertEquals((await cur(store)).status, "awaiting_owner");
});

// ── Adversarial ─────────────────────────────────────────────────────────────

Deno.test("P7 adversarial: a same-title draft on the same day is offered back, never duplicated", async () => {
  const world = freshWorld();
  const store = new MemoryStore();
  const run = await startRun(
    store,
    "Create an event for next Friday at 7pm to 10pm called Lantern Supper",
  );
  await runFlowStep({ store, probes: probesFor(world) }, {
    run,
    trigger: "turn",
    brandName: BRAND_NAME,
  });
  await answer(world, store, (r) => choice(r, "not_now"));
  const created = new Date(Date.now() - 3_600_000).toISOString();
  world.titled = [{
    ...rowFrom({ title: "lantern supper", timezone: "Europe/London" }),
    id: OLD_EVENT,
    created_at: created,
  }];
  await answer(world, store, (r) => choice(r, "in_person"));
  const dup = await answer(world, store, (r) => form(r, { place: SHOREDITCH }));
  assertEquals(dup.kind, "artefact");
  if (dup.kind !== "artefact") return;
  assertEquals(dup.artefact.step_key, "event_duplicate");
  assertMatch(dup.artefact.text, /You already have a draft called "lantern supper"/);
  world.events.set(OLD_EVENT, { ...world.titled[0] });
  const kept = await answer(world, store, (r) => choice(r, "continue"));
  assert(kept.kind === "artefact", "no create proposal for a kept draft");
  assertEquals(kept.artefact.step_key, "event_publish_ready");
  assertEquals((await cur(store)).subject_id, OLD_EVENT);

  // The pure guard: case-folded title, same local day or made today.
  const rows = [{ ...world.titled[0], created_at: "2020-01-01T00:00:00Z" }];
  assertEquals(
    duplicateDrafts(rows, {
      title: "LANTERN SUPPER",
      start_at: "2026-11-06T19:00:00Z",
      timezone: "Europe/London",
    }, new Date(), null).length,
    1,
  );
  assertEquals(
    duplicateDrafts(rows, {
      title: "Lantern Supper",
      start_at: "2026-11-13T19:00:00Z",
      timezone: "Europe/London",
    }, new Date(), null).length,
    0,
    "another day, made long ago: a new event",
  );
});

Deno.test("P7 adversarial: titles drop curly quotes and keep apostrophes (D-19)", () => {
  assertEquals(
    extractEventTitle("Create an event called ‘Lantern Supper’ next Friday"),
    "Lantern Supper",
  );
  assertEquals(
    extractEventTitle("Create an event called “Lantern Supper” on Friday"),
    "Lantern Supper",
  );
  assertEquals(
    extractEventTitle("Create an event called Seth's Party next Friday at 8pm"),
    "Seth's Party",
  );
  assertEquals(
    extractEventTitle("Make an event named 'Seth's Party' on Friday"),
    "Seth's Party",
  );
  assertEquals(
    extractEventTitle("Plan an event called Vol. 2, for 20 guests"),
    "Vol. 2",
  );
  assertEquals(
    extractEventTitle(
      "Make an event called Lantern Supper for Lantern Supper Club",
      "Lantern Supper Club",
    ),
    "Lantern Supper",
  );
});

Deno.test("P7 adversarial: the time zone is the brand's own, never the device's or UTC", async () => {
  // Brand has its own zone: used (and shown on the card), nothing asked.
  const lagos = freshWorld({
    brand: {
      default_timezone: "Africa/Lagos",
      country_code: "GB",
      default_currency: "NGN",
    },
  });
  const store = new MemoryStore();
  const proposed = await toCreateProposal(lagos, store);
  assert(proposed.kind === "propose");
  assertEquals(proposed.tool_args.timezone, "Africa/Lagos");
  assertMatch(
    proposed.rows.map((r) => r.value).join(" "),
    /Lagos time, from your brand/,
  );

  // A country with several zones and no brand zone: Ari asks.
  const us = freshWorld({
    brand: { default_timezone: null, country_code: "US", default_currency: "USD" },
  });
  const usStore = new MemoryStore();
  const run = await startRun(usStore, "Create an event called Rooftop Social");
  await runFlowStep({ store: usStore, probes: probesFor(us) }, {
    run,
    trigger: "turn",
    brandName: BRAND_NAME,
  });
  const asked = await answer(us, usStore, (r) => choice(r, "not_now"));
  assert(asked.kind === "artefact");
  assertEquals(asked.artefact.step_key, "event_timezone");
  assertMatch(asked.artefact.text, /What time zone is this event in\?/);
  const bad = await answer(us, usStore, (r) => form(r, { response: "Narnia" }));
  assert(bad.kind === "artefact");
  assertEquals(bad.artefact.step_key, "event_timezone");
  assertMatch(bad.text, /couldn't match that to a time zone, so nothing was saved/);
  const start = await answer(
    us,
    usStore,
    (r) => form(r, { response: "New York" }),
  );
  assert(start.kind === "artefact");
  assertEquals(start.artefact.step_key, "event_start");
  assertEquals((await cur(usStore)).answers.timezone, {
    value: "America/New_York",
    source: "owner",
  });
});

Deno.test("P7 adversarial: no end time is saved unless the owner gives or picks it", async () => {
  const world = freshWorld();
  const store = new MemoryStore();
  const run = await startRun(
    store,
    "Create an event for next Friday at 7pm called Lantern Supper",
  );
  await runFlowStep({ store, probes: probesFor(world) }, {
    run,
    trigger: "turn",
    brandName: BRAND_NAME,
  });
  const end = await answer(world, store, (r) => choice(r, "not_now"));
  assert(end.kind === "artefact");
  assertEquals(end.artefact.step_key, "event_end", "asked, never assumed");
  // Resume / reload never fills it in.
  const resumed = await runFlowStep({ store, probes: probesFor(world) }, {
    run: await cur(store),
    trigger: "resume",
    brandName: BRAND_NAME,
  });
  assertEquals(resumed.kind, "unchanged");
  assertEquals((await cur(store)).answers.end_at, undefined);
  // Without an end there are no create args at all.
  assertEquals(
    createEventArgs(BRAND, {
      title: "Lantern Supper",
      timezone: "Europe/London",
      timezone_source: "country",
      start_at: "2026-11-06T19:00:00.000Z",
      end_at: null,
      format: "online",
      place: null,
      online_url: "https://zoom.us/j/1",
      hide_address: null,
    }),
    null,
  );
  // Picking the suggestion makes it the owner's answer.
  const format = await answer(world, store, (r) => choice(r, "suggested"));
  assert(format.kind === "artefact");
  const answered = (await cur(store)).answers.end_at!;
  assertEquals(answered.source, "owner");
  assertEquals(londonClock(String(answered.value)), "21:00");
  // A lone time or a length is read relative to the start.
  assertEquals(
    parseEventEnd(
      "until midnight",
      "2026-11-06T19:00:00.000Z",
      "Europe/London",
      new Date("2026-11-01T12:00:00Z"),
    ),
    "2026-11-07T00:00:00.000Z",
  );
  assertEquals(
    parseEventEnd("whenever", "2026-11-06T19:00:00.000Z", "Europe/London", new Date()),
    null,
  );
});

Deno.test("P7 adversarial: a home-like address asks, defaulting to ticket holders only", async () => {
  const world = freshWorld();
  const store = new MemoryStore();
  const run = await startRun(
    store,
    "Create an event for next Friday at 7pm until 11pm called House Supper",
  );
  await runFlowStep({ store, probes: probesFor(world) }, {
    run,
    trigger: "turn",
    brandName: BRAND_NAME,
  });
  await answer(world, store, (r) => choice(r, "not_now"));
  await answer(world, store, (r) => choice(r, "in_person"));
  const privacy = await answer(world, store, (r) =>
    form(r, {
      place: {
        ...SHOREDITCH,
        venue_name: "My flat",
        address: "12 Example Road, London N1 1AA",
        feature_type: "address",
      },
    }));
  assert(privacy.kind === "artefact");
  assertEquals(privacy.artefact.step_key, "event_address_privacy");
  assertEquals(privacy.artefact.title, "Show the address only to ticket holders?");
  assertEquals(privacy.artefact.options[0], {
    id: "hide",
    label: "Yes, only ticket holders",
  });
  const proposed = await answer(world, store, (r) => choice(r, "hide"));
  assert(proposed.kind === "propose");
  assertEquals(proposed.tool_args.hide_address_until_ticket, true);
  assertMatch(
    proposed.rows.map((r) => r.value).join(" "),
    /address shown only to ticket holders/,
  );
});

Deno.test("P7 adversarial: private is never sent and never offered", async () => {
  const world = freshWorld();
  const store = new MemoryStore();
  const proposed = await toCreateProposal(world, store);
  assert(proposed.kind === "propose");
  assert(proposed.tool_args.visibility !== "private");
  const source = await Deno.readTextFile(
    new URL("supabase/functions/_shared/ariFlows/offerings/event.ts", ROOT),
  );
  assertNotMatch(source, /visibility:\s*"private"|id:\s*"private"/);
});

Deno.test("P7 adversarial: a stale question id changes nothing", async () => {
  const world = freshWorld();
  const store = new MemoryStore();
  const run = await startRun(
    store,
    "Create an event for next Friday at 7pm called Lantern Supper",
  );
  await runFlowStep({ store, probes: probesFor(world) }, {
    run,
    trigger: "turn",
    brandName: BRAND_NAME,
  });
  const oldCard = await cur(store);
  await answer(world, store, (r) => choice(r, "not_now"));
  const before = await cur(store);
  const stale = await runFlowStep({ store, probes: probesFor(world) }, {
    run: before,
    trigger: "answer",
    answer: { ...choice(oldCard, "not_now"), step_key: "brand_can_wait" },
    brandName: BRAND_NAME,
  });
  assertEquals(stale.kind, "stale");
  const after = await cur(store);
  assertEquals(after.revision, before.revision);
  assertEquals(after.current_question_id, before.current_question_id);
});

Deno.test("P7 adversarial: publishing is proposed only from the owner's own 'Publish it'", async () => {
  const world = freshWorld({ canSell: true });
  const store = new MemoryStore();
  const proposed = await toCreateProposal(world, store);
  assert(proposed.kind === "propose");
  await confirm(
    world,
    store,
    "create_event",
    () => world.events.set(EVENT_ID, rowFrom(proposed.tool_args)),
    { event: { id: EVENT_ID } },
  );
  // Make the draft complete, as the details and tickets steps would.
  const row = world.events.get(EVENT_ID)!;
  row.party_types = ["themed-party"];
  row.description = "A candlelit supper with live strings.";
  row.draft.tickets = [{ name: "General admission", isFree: true, capacity: 60 }];
  await answer(world, store, (r) => choice(r, "yes"));
  const visibility = await answer(world, store, (r) => choice(r, "not_now"));
  assert(visibility.kind === "artefact");
  assertEquals(visibility.artefact.step_key, "event_visibility");
  const ready = await answer(world, store, (r) => choice(r, "unlisted"));
  assert(ready.kind === "artefact");
  assertEquals(ready.artefact.step_key, "event_publish");
  assertMatch(ready.artefact.text, /Publish "Lantern Supper" now as Unlisted\?/);
  // Resume, reload, a typed side turn and a confirm of something else: never
  // a publish proposal.
  for (const trigger of ["resume", "handoff_return", "turn", "confirm"] as const) {
    const outcome = await runFlowStep({ store, probes: probesFor(world) }, {
      run: await cur(store),
      trigger,
      ownerText: trigger === "turn" ? "looks good" : undefined,
      ...(trigger === "confirm"
        ? { confirmed: { tool_name: "update_event", result: {} } }
        : {}),
      brandName: BRAND_NAME,
    });
    assert(outcome.kind !== "propose", `${trigger} must never publish`);
  }
  const publish = await answer(world, store, (r) => choice(r, "publish"));
  assertEquals(publish.kind, "propose");
  if (publish.kind !== "propose") return;
  assertEquals(publish.tool_name, "publish_event");
  assertEquals(publish.tool_args, { event_id: EVENT_ID, visibility: "unlisted" });
  // The definition itself: no step's probe can propose a publish.
  for (const step of CREATE_EVENT_FLOW.steps) {
    if (step.key === "event_publish") continue;
    assertNotMatch(
      step.probe.toString(),
      /publish_event/,
      `${step.key} must not reach publish`,
    );
  }
  assertNotMatch(
    CREATE_EVENT_FLOW.steps.find((s) => s.key === "event_publish")!.probe
      .toString(),
    /tool_name:\s*"publish_event"/,
    "the publish card only asks",
  );
});

Deno.test("P7: picked places and ticket words are read strictly", () => {
  const run = "77777777-7777-4777-8777-777777777777";
  const q = "88888888-8888-4888-8888-888888888888";
  const parsed = parseFlowAnswer({
    run_id: run,
    step_key: "event_place",
    question_id: q,
    choice_id: "answer",
    display_text: "Shoreditch Town Hall, 380 Old Street",
    values: { choices: [], country: null, response: "", place: SHOREDITCH },
  });
  assertEquals(parsed?.values?.place?.city, "London");
  for (
    const bad of [
      { ...SHOREDITCH, lat: 123 },
      { ...SHOREDITCH, city: "" },
      { ...SHOREDITCH, extra: true },
      { ...SHOREDITCH, lng: "0" },
    ]
  ) {
    assertEquals(
      parseFlowAnswer({
        run_id: run,
        step_key: "event_place",
        question_id: q,
        choice_id: "answer",
        display_text: "x",
        values: { choices: [], country: null, response: "", place: bad },
      }),
      null,
    );
  }
  // #3355 P7: the typed currency rides along so a mismatch is asked about.
  assertEquals(parseTicketAnswer("£15, 60 tickets", true), {
    price_major: 15,
    capacity: 60,
    unlimited: false,
    typed_price: "£15",
    typed_currencies: ["GBP"],
  });
  assertEquals(parseTicketAnswer("60 tickets", true), null, "paid needs a price");
  assertEquals(parseTicketAnswer("no limit", false), {
    price_major: null,
    capacity: null,
    unlimited: true,
  });
});

Deno.test("P7: the seed migration requires the owner's end and time zone on the Ari path", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "supabase/migrations/20280229003355_issue_3355_event_seed_truth.sql",
      ROOT,
    ),
  );
  assertMatch(sql, /RAISE EXCEPTION 'event_end_required'/);
  assertMatch(sql, /RAISE EXCEPTION 'event_timezone_required'/);
  assertMatch(sql, /ari_private_visibility_allowed\(\)/);
  assertNotMatch(sql, /v_start\+interval '2 hours'/, "no two-hour default");
  assertNotMatch(sql, /COALESCE\(NULLIF\(p_args->>'timezone',''\),'UTC'\)/);
  assertMatch(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.ari_private_visibility_allowed\(\)\s+TO service_role/,
  );
});

Deno.test("P7: the request starts the engine's event flow before any keyword lane", async () => {
  const world = freshWorld({
    brand: {
      default_timezone: "Europe/London",
      country_code: "GB",
      default_currency: "GBP",
    },
  });
  const store = new MemoryStore();
  const decision = await decideFlowTurn({
    // deno-lint-ignore no-explicit-any
    service: {} as any,
    // deno-lint-ignore no-explicit-any
    userClient: {} as any,
    userId: OWNER,
    brand: { id: BRAND, name: BRAND_NAME },
    conversationId: CHAT,
    message: "Schedule an event called Seth's Party for next Friday at 8pm",
    flowAnswer: null,
    engineEnabled: true,
    otherLaneActive: false,
    store,
    probes: probesFor(world),
  });
  assertEquals(decision.kind, "reply");
  const run = await cur(store);
  assertEquals(run.flow_key, "create_event");
  assertEquals(run.flow_version, 2);
  assertEquals(run.answers.intent_text?.value, "Schedule an event called Seth's Party for next Friday at 8pm");
  // An active run beats every keyword lane: the next typed turn stays here.
  const next = await decideFlowTurn({
    // deno-lint-ignore no-explicit-any
    service: {} as any,
    // deno-lint-ignore no-explicit-any
    userClient: {} as any,
    userId: OWNER,
    brand: { id: BRAND, name: BRAND_NAME },
    conversationId: CHAT,
    message: "show me my events",
    flowAnswer: null,
    engineEnabled: true,
    otherLaneActive: false,
    store,
    probes: probesFor(world),
  });
  assertEquals(next.kind, "reply", "typed words get the open card back");
});

// ── #3355 P7 Phase 7 fix: paid tickets on a brand with no currency ─────────
//
// Found in the browser: a brand with no payout country or currency picked
// Paid, kept going, typed "£15, 60 tickets", saw Price "15.00" and the
// confirm was refused (DOMAIN_REFUSED: paid tickets need a payout currency),
// leaving the chat with no next card. Ari now asks the Host ticket sheet's
// payout-country question first, shows the price in the brand's currency,
// asks when a typed currency disagrees, and re-presents a refused save.

/** Script B up to the "Are tickets free or paid?" card. */
async function toTicketKind(world: World, store: MemoryStore) {
  const proposed = await toCreateProposal(world, store);
  assert(proposed.kind === "propose");
  await confirm(
    world,
    store,
    "create_event",
    () => world.events.set(EVENT_ID, rowFrom(proposed.tool_args)),
    { event: { id: EVENT_ID } },
  );
  await answer(world, store, (r) => choice(r, "yes"));
  await answer(world, store, (r) => choice(r, "not_now"));
  await answer(world, store, (r) => form(r, { choices: ["Themed Party"] }));
  await answer(world, store, (r) => form(r, { response: "Candlelit supper." }));
  const kind = await confirm(world, store, "update_event", () => {
    const row = world.events.get(EVENT_ID)!;
    row.party_types = ["themed-party"];
    row.description = "Candlelit supper.";
    row.draft.clientRevision = 1;
  });
  assert(kind.kind === "artefact");
  assertEquals(kind.artefact.step_key, "event_ticket_kind");
}

function noCurrencyWorld(): World {
  return freshWorld({
    canSell: false,
    brand: { default_timezone: null, country_code: "GB", default_currency: null },
  });
}

/** Stand-in for agent-confirm-action when the confirmed write is refused. */
async function confirmFailed(
  world: World,
  store: MemoryStore,
  toolName: string,
  message: string,
): Promise<RunnerOutcome> {
  world.openProposal = false;
  return await runFlowStep({ store, probes: probesFor(world) }, {
    run: await cur(store),
    trigger: "confirm",
    failed: { tool_name: toolName, message },
    brandName: BRAND_NAME,
  });
}

const CURRENCY_REFUSAL =
  "Paid tickets need a payout currency, and that comes from payment setup.";

Deno.test("P7 fix: no-currency brand → Paid → payout country → confirmed currency → £15.00 → draft tier", async () => {
  const world = noCurrencyWorld();
  const store = new MemoryStore();
  await toTicketKind(world, store);
  const money = await answer(world, store, (r) => choice(r, "paid"));
  assert(money.kind === "artefact");
  assertEquals(money.artefact.step_key, "money_gate");

  // "Keep going" no longer leads to a price with no currency.
  const country = await answer(world, store, (r) => choice(r, "continue"));
  assert(country.kind === "artefact");
  assertEquals(country.artefact.step_key, "event_ticket_details");
  assertEquals(country.artefact.title, "Choose your payout country");
  assertMatch(
    country.artefact.text,
    /Which country is your bank account in\? We'll use its currency for this brand's prices\./,
  );
  assertEquals(country.artefact.answer_mode, "form");
  const block = (country.artefact.rendition?.blocks as {
    type: string;
    options?: { id: string; label: string }[];
    selection?: string;
  }[]).find((b) => b.type === "choices");
  assertEquals(block?.selection, "single");
  const labels = block?.options?.map((o) => o.label) ?? [];
  assertEquals(labels[0], "United Kingdom (GBP)", "the brand's own country first");
  assert(labels.includes("Nigeria (NGN)"), "Nigeria, as in the Host chooser");
  assert(labels.includes("Ireland (EUR)"));
  assertEquals(labels.length, 35, "the Host chooser's 34 card countries + Nigeria");

  // The pick is a brand setting: one protected confirmation, nothing saved yet.
  const pick = await answer(
    world,
    store,
    (r) => form(r, { choices: ["United Kingdom (GBP)"] }),
  );
  assertEquals(pick.kind, "propose");
  if (pick.kind !== "propose") return;
  assertEquals(pick.tool_name, "set_brand_payout_country");
  assertEquals(pick.tool_args, { brand_id: BRAND, country_code: "GB" });
  assertEquals(
    pick.ack,
    "Use GBP (£) for Lantern Supper Club's prices? Your bank account is in the United Kingdom.",
  );
  assertEquals(pick.rows_only, true);
  assertEquals(
    pick.rows.map((r) => `${r.label}: ${r.value}`),
    [
      "Brand: Lantern Supper Club",
      "Prices in: GBP (£)",
      "Bank account in: United Kingdom",
    ],
  );
  assertEquals(world.brand.default_currency, null, "nothing written before confirm");
  // A typed reply while the card waits never issues a second card.
  world.openProposal = true;
  const waiting = await runFlowStep({ store, probes: probesFor(world) }, {
    run: await cur(store),
    trigger: "turn",
    ownerText: "United Kingdom",
    brandName: BRAND_NAME,
  });
  assertEquals(waiting.kind, "notice");

  // Confirmed: the brand now has GBP, and Ari goes on to the price.
  const price = await confirm(
    world,
    store,
    "set_brand_payout_country",
    () => {
      world.brand.default_currency = "GBP";
    },
  );
  assert(price.kind === "artefact");
  assertEquals(price.artefact.step_key, "event_ticket_details");
  assertMatch(price.text, /Saved and checked: Lantern Supper Club's prices are in GBP \(£\)\./);
  assertMatch(price.artefact.text, /For example: £15, 60 tickets\./);

  const tier = await answer(world, store, (r) => form(r, { response: "£15, 60 tickets" }));
  assertEquals(tier.kind, "propose");
  if (tier.kind !== "propose") return;
  assertEquals(tier.tool_name, "upsert_ticket_tier");
  assertEquals(tier.tool_args.price_cents, 1500);
  const rows = tier.rows.map((r) => `${r.label}: ${r.value}`);
  assert(rows.includes("Price: £15.00"), rows.join(" | "));
  assert(rows.some((r) => r.startsWith("Heads-up: You can add paid tickets now")));

  // Seth's decision 3: the paid tier saves on the draft before payments.
  const saved = await confirm(world, store, "upsert_ticket_tier", () => {
    world.events.get(EVENT_ID)!.draft.tickets = [{
      name: "General admission",
      isFree: false,
      priceGbp: 15,
      capacity: 60,
    }];
  });
  assert(saved.kind === "artefact");
  assertEquals(saved.artefact.step_key, "event_visibility");
});

Deno.test("P7 fix: Nigeria goes to the Nigerian payout rail (NGN) and the example is in naira", async () => {
  const world = noCurrencyWorld();
  const store = new MemoryStore();
  await toTicketKind(world, store);
  await answer(world, store, (r) => choice(r, "paid"));
  await answer(world, store, (r) => choice(r, "continue"));
  const pick = await answer(world, store, (r) => form(r, { choices: ["Nigeria (NGN)"] }));
  assert(pick.kind === "propose");
  assertEquals(pick.tool_args, { brand_id: BRAND, country_code: "NG" });
  assertMatch(pick.ack ?? "", /Use NGN \(₦\) for Lantern Supper Club's prices\? Your bank account is in Nigeria\./);
  const price = await confirm(world, store, "set_brand_payout_country", () => {
    world.brand.default_currency = "NGN";
  });
  assert(price.kind === "artefact");
  assertMatch(price.artefact.text, /For example: ₦2,000, 60 tickets\./);
});

Deno.test("P7 fix: a refused payout-country save brings the question back with the reason", async () => {
  const world = noCurrencyWorld();
  const store = new MemoryStore();
  await toTicketKind(world, store);
  await answer(world, store, (r) => choice(r, "paid"));
  await answer(world, store, (r) => choice(r, "continue"));
  await answer(world, store, (r) => form(r, { response: "uk" }));
  const back = await confirmFailed(
    world,
    store,
    "set_brand_payout_country",
    "Only the owner or a brand admin can choose the payout country. Nothing was changed.",
  );
  assert(back.kind === "artefact", "never a dead end");
  assertEquals(back.artefact.title, "Choose your payout country");
  assertMatch(back.artefact.text, /^Only the owner or a brand admin can choose the payout country/);
});

Deno.test("P7 fix: a typed currency that disagrees with the brand's is asked about, never saved", async () => {
  const world = freshWorld({ canSell: false });
  const store = new MemoryStore();
  await toTicketKind(world, store);
  await answer(world, store, (r) => choice(r, "paid"));
  const details = await answer(world, store, (r) => choice(r, "continue"));
  assert(details.kind === "artefact");
  assertEquals(details.artefact.title, "Price and number of tickets");
  const asked = await answer(world, store, (r) => form(r, { response: "$15, 60 tickets" }));
  assertEquals(asked.kind, "artefact", "no ticket proposal in the wrong currency");
  if (asked.kind !== "artefact") return;
  assertEquals(asked.artefact.step_key, "event_ticket_details");
  assertMatch(
    asked.artefact.text,
    /You typed \$15, but Lantern Supper Club's prices are in GBP \(£\)\. What's the ticket price in GBP\? Nothing was saved\./,
  );
  assertEquals((await cur(store)).answers.ticket, undefined);
  // The same price in the brand's currency (or with no symbol word) goes on.
  const ok = await answer(world, store, (r) => form(r, { response: "15 pounds, 60 tickets" }));
  assertEquals(ok.kind, "propose");
});

Deno.test("P7 fix: a refused ticket save re-presents the step with the reason and the next choices", async () => {
  const world = freshWorld({ canSell: false });
  const store = new MemoryStore();
  await toTicketKind(world, store);
  await answer(world, store, (r) => choice(r, "paid"));
  await answer(world, store, (r) => choice(r, "continue"));
  const tier = await answer(world, store, (r) => form(r, { response: "£15, 60 tickets" }));
  assert(tier.kind === "propose");
  const failed = await confirmFailed(world, store, "upsert_ticket_tier", CURRENCY_REFUSAL);
  assert(failed.kind === "artefact", "a next card, not a dead end");
  assertEquals(failed.artefact.step_key, "event_tickets_save");
  assertEquals(failed.artefact.title, "The tickets didn't save");
  assertMatch(failed.artefact.text, /^Paid tickets need a payout currency.*What would you like to do\?$/);
  assertEquals(
    failed.artefact.options.map((o) => o.id),
    ["open", "free", "retry", "no_tickets"],
  );
  assertEquals(
    failed.artefact.options[0].route,
    `/brand/${BRAND}/payments/onboard`,
  );
  // Reloading or a stray reply keeps the same card (never a new one).
  const again = await runFlowStep({ store, probes: probesFor(world) }, {
    run: await cur(store),
    trigger: "resume",
    brandName: BRAND_NAME,
  });
  assertEquals(again.kind, "unchanged");

  // "Make the tickets free" proposes the same ticket, free.
  const free = await answer(world, store, (r) => choice(r, "free"));
  assertEquals(free.kind, "propose");
  if (free.kind !== "propose") return;
  assertEquals(free.tool_args.is_free, true);
  assertEquals("price_cents" in free.tool_args, false);
  assert(free.rows.some((r) => r.label === "Price" && r.value === "Free"));
});

Deno.test("P7 fix: after a refused ticket save the owner can keep the draft without tickets", async () => {
  const world = freshWorld({ canSell: false });
  const store = new MemoryStore();
  await toTicketKind(world, store);
  await answer(world, store, (r) => choice(r, "paid"));
  await answer(world, store, (r) => choice(r, "continue"));
  await answer(world, store, (r) => form(r, { response: "£15, 60 tickets" }));
  await confirmFailed(world, store, "upsert_ticket_tier", CURRENCY_REFUSAL);
  const next = await answer(world, store, (r) => choice(r, "no_tickets"));
  assert(next.kind === "artefact");
  assertMatch(next.text, /The draft stays without tickets for now/);
  assertEquals(next.artefact.step_key, "event_visibility");
  // "Try saving again" from a fresh failure proposes the save again.
  const world2 = freshWorld({ canSell: false });
  const store2 = new MemoryStore();
  await toTicketKind(world2, store2);
  await answer(world2, store2, (r) => choice(r, "paid"));
  await answer(world2, store2, (r) => choice(r, "continue"));
  await answer(world2, store2, (r) => form(r, { response: "£15, 60 tickets" }));
  await confirmFailed(world2, store2, "upsert_ticket_tier", "");
  const retried = await answer(world2, store2, (r) => choice(r, "retry"));
  assertEquals(retried.kind, "propose");
});

Deno.test("P7 fix: a refused confirm runs the flow, and the Host reads the re-presented step", async () => {
  const confirmSource = await Deno.readTextFile(
    new URL("supabase/functions/agent-confirm-action/index.ts", ROOT),
  );
  const failureBranch = confirmSource.slice(
    confirmSource.indexOf('outcome: "failed",'),
    confirmSource.indexOf("if (isAmbiguous) {"),
  );
  assertMatch(failureBranch, /await flowNextAfterConfirm\(\{[\s\S]*failed: \{\s*tool_name: tool\.name,/);
  const host = await Deno.readTextFile(
    new URL("mingla-business/src/screens/ari/AriChatScreen.tsx", ROOT),
  );
  const errorBranch = host.slice(
    host.indexOf("if (isAlreadyResolvedError(result.message))"),
    host.indexOf('if (result.kind === "proposal_replaced")'),
  );
  assertMatch(errorBranch, /void chat\.resumeFlow\("resume"\);/);
});

Deno.test("P7: an online event's create card shows the joining link the owner gave", () => {
  const rows = createRows({
    title: "Harbour Social",
    timezone: "Europe/London",
    timezone_source: "country",
    start_at: "2026-11-14T18:00:00.000Z",
    end_at: "2026-11-14T20:00:00.000Z",
    format: "online",
    place: null,
    online_url: "https://meet.example.test/harbour-social",
    hide_address: null,
  });
  assertEquals(
    rows.find((row) => row.label === "Joining link")?.value,
    "https://meet.example.test/harbour-social",
  );
});
