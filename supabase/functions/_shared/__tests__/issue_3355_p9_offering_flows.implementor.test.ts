// Issue #3355 P9 — experiences, venues and stays on the Ari flow engine
// (implementor happy path + adversarial).
//
// MINGLA-INVARIANT: I-ARI-P9-NO-INVENTED-FACTS | issue #3355 | Every fact Ari saves on an experience, venue or stay it creates traces to the owner: experience stops (name, description, picked place), vibe, when and price; venue place, name, slug, category, all seven days of hours and contact; stay venue, settings, kind, guests, count, price and policy. No default price, capacity or hours.
// MINGLA-INVARIANT: I-ARI-NEVER-ASKS-COORDINATES | issue #3355 | Places come only from the address search on an Ari card; owner copy never carries "latitude" or "longitude" (audit D-21).
// MINGLA-INVARIANT: I-ARI-STAY-OFFERING-TYPED | issue #3355 | manage_stay_inventory create_offering accepts only a typed CreateStayOfferingInput; an untyped payload is refused before the Stay owner is called (audit D-22).
//
// Drives the shipped flows (supabase/functions/_shared/ariFlows/offerings/
// {experience,venue,stay}.ts) through the shipped runner with an in-memory
// run store that keeps the SQL rules (lease, compare-and-swap, evidence).
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_p9_offering_flows.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  runFlowStep,
  type RunnerOutcome,
  subjectIdFromResult,
} from "../ariFlows/runner.ts";
import type { FlowStore } from "../ariFlows/store.ts";
import type {
  BrandReadiness,
  BrandReadinessItem,
  FlowAnswer,
  FlowExperienceRow,
  FlowProbeDeps,
  FlowRun,
  FlowStayInventory,
  FlowStepRecord,
  FlowVenueRow,
} from "../ariFlows/types.ts";
import {
  classifyOfferingIntent,
  findFlowDefinition,
} from "../ariFlows/index.ts";
import { parseFlowPlace, stayInventoryOf } from "../ariFlows/edge.ts";
import {
  createExperienceArgs,
  experiencePublishGaps,
} from "../ariFlows/offerings/experience.ts";
import {
  freeSlug,
  parseContact,
  parseVenueHours,
  slugFromName,
  VENUE_REVIEW_WORDS,
} from "../ariFlows/offerings/venue.ts";
import {
  createStayOfferingPayload,
  parseCheckTimes,
  parseStaySize,
  staySettingsPayload,
} from "../ariFlows/offerings/stay.ts";
import { stayOfferingPayloadProblem } from "../stayOfferingContract.ts";
import { ownerCopyViolations } from "../ariOwnerCopy.ts";
import { AGENT_TOOLS, findTool } from "../agentTools.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { inferAriToolsets, selectAriTools } from "../agentToolsets.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";

const BRAND = "22222222-2222-4222-8222-222222222222";
const CHAT = "33333333-3333-4333-8333-333333333333";
const EXP_ID = "55555555-5555-4555-8555-555555555555";
const VENUE_ID = "66666666-6666-4666-8666-666666666666";
const STAY_VENUE_ID = "77777777-7777-4777-8777-777777777777";
const OFFERING_ID = "88888888-8888-4888-8888-888888888888";
const OP = "44444444-4444-4444-8444-444444444444";
const BRAND_NAME = "Coastline Collective";

/** The raw tool (no caller-authorization wrapper), as #1978's tests do. */
function domainTool(name: string) {
  const found = DOMAIN_TOOLS.find((tool) => tool.name === name);
  if (!found) throw new Error(`missing domain tool: ${name}`);
  return found;
}

// ── A small world ───────────────────────────────────────────────────────────
interface World {
  canSell: boolean;
  brand: {
    default_timezone: string | null;
    country_code: string | null;
    default_currency: string | null;
    contact_email: string | null;
    contact_phone: string | null;
  };
  experiences: Map<string, FlowExperienceRow>;
  venues: FlowVenueRow[];
  stays: Map<string, FlowStayInventory>;
  stayFlag: boolean;
  openProposal: boolean;
}

function item(
  key: string,
  label: string,
  group: string,
  blockingFor: string[],
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
    recommended_for: [],
    value_preview: null,
    deferrable: group !== "money",
    deferral: null,
    skip_in_ari: false,
    owner_action: "answer",
    fix: {
      route: `/brand/${BRAND}/payments/onboard`,
      route_label: "Payments setup",
      can_caller_fix: true,
      who_can_fix: "you",
    },
    ask: { control: "text" },
  };
}

function readinessFor(world: World, action: ReadinessAction | null): BrandReadiness {
  const items = [
    item(
      "money.can_sell",
      "Ready to sell paid tickets",
      "money",
      ["publish_paid", "stay_publish"],
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
      can_be_paid_out: world.canSell,
      sell_reason: world.canSell ? "ready" : "no_provider",
      payout_reason: world.canSell ? "ready" : "no_bank",
      rail: world.canSell ? "stripe" : "none",
      currency: world.brand.default_currency,
      terms_accepted_by_caller: true,
    },
    items,
  } as BrandReadiness;
}

function probesFor(world: World): FlowProbeDeps {
  return {
    readiness: (action) => Promise.resolve(readinessFor(world, action)),
    subjectExists: () => Promise.resolve(false),
    setAside: () => Promise.resolve("brand"),
    hasOpenProposal: () => Promise.resolve(world.openProposal),
    brandFacts: () => Promise.resolve(world.brand),
    experienceRow: (id) => Promise.resolve(world.experiences.get(id) ?? null),
    venues: () => Promise.resolve(world.venues),
    stayInventory: (id) => Promise.resolve(world.stays.get(id) ?? null),
    featureFlag: () => Promise.resolve(world.stayFlag),
  };
}

function freshWorld(overrides: Partial<World> = {}): World {
  return {
    canSell: false,
    brand: {
      default_timezone: "Africa/Lagos",
      country_code: "NG",
      default_currency: "NGN",
      contact_email: "hello@coastline.test",
      contact_phone: "+2348012345678",
    },
    experiences: new Map(),
    venues: [],
    stays: new Map(),
    stayFlag: false,
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
async function startRun(
  store: MemoryStore,
  flowKey: string,
  text: string,
): Promise<FlowRun> {
  const def = findFlowDefinition(flowKey)!;
  assertEquals(def.version, 2, `new ${flowKey} runs use the engine flow`);
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

/** Every owner-visible string the flow produced so far. */
const SEEN: string[] = [];

function remember(outcome: RunnerOutcome): RunnerOutcome {
  const o = outcome as unknown as Record<string, unknown>;
  if (typeof o.text === "string") SEEN.push(o.text);
  const artefact = o.artefact as Record<string, unknown> | undefined;
  if (artefact) SEEN.push(JSON.stringify(artefact));
  if (Array.isArray(o.rows)) SEEN.push(JSON.stringify(o.rows));
  return outcome;
}

async function turn(world: World, store: MemoryStore): Promise<RunnerOutcome> {
  return remember(
    await runFlowStep({ store, probes: probesFor(world) }, {
      run: await cur(store),
      trigger: "turn",
      brandName: BRAND_NAME,
    }),
  );
}

async function answer(
  world: World,
  store: MemoryStore,
  a: (run: FlowRun) => FlowAnswer,
): Promise<RunnerOutcome> {
  const run = await cur(store);
  return remember(
    await runFlowStep({ store, probes: probesFor(world) }, {
      run,
      trigger: "answer",
      answer: a(run),
      brandName: BRAND_NAME,
    }),
  );
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
  return remember(
    await runFlowStep({ store, probes: probesFor(world) }, {
      run: await cur(store),
      trigger: "confirm",
      confirmed: { tool_name: toolName, result },
      brandName: BRAND_NAME,
    }),
  );
}

function rowsText(rows: { label: string; value: string }[]): string {
  return rows.map((r) => `${r.label}: ${r.value}`).join("\n");
}

function stepOf(outcome: RunnerOutcome): string {
  assert(outcome.kind === "artefact", `expected a card, got ${outcome.kind}`);
  return outcome.artefact.step_key;
}

const MARKET = {
  venue_name: "Balogun Market",
  address: "Balogun Market, Lagos Island, Lagos, Nigeria",
  city: "Lagos",
  country_code: "NG",
  lat: 6.4541,
  lng: 3.3886,
  feature_type: "poi",
  place_id: "dXJuOm1ieHBvaTpiYWxvZ3Vu",
};
const SUYA = {
  venue_name: "12 Adeola Odeku St",
  address: "12 Adeola Odeku Street, Victoria Island, Lagos, Nigeria",
  city: "Lagos",
  country_code: "NG",
  lat: 6.4281,
  lng: 3.4219,
  feature_type: "address",
  place_id: "dXJuOm1ieGFkcjphZGVvbGE",
};

const INTENT = "Create a food tasting experience in Lagos";

/** What the experience create RPC stores for these args (the readback). */
function experienceFrom(args: Record<string, unknown>): FlowExperienceRow {
  const stops = args.stops as Record<string, unknown>[];
  return {
    id: EXP_ID,
    title: String(args.title),
    status: "draft",
    updated_at: "2026-11-02T10:00:00.000000+00:00",
    timezone: String(args.timezone),
    description: String(args.narrative),
    intents: args.experience_intents as string[],
    stops: stops.map((stop) => ({
      name: String(stop.name),
      description: String(stop.description),
      address: String(stop.address),
      has_point: typeof stop.lat === "number",
      has_place_id: typeof stop.place_id === "string",
    })),
    is_free: args.is_free === true,
    whole_price_cents: 0,
    when: args.when as Record<string, unknown>,
  };
}

/** "Create a food tasting experience in Lagos" up to the create proposal. */
async function experienceToProposal(world: World, store: MemoryStore) {
  await startRun(store, "create_experience", INTENT);
  assertEquals(stepOf(await turn(world, store)), "experience_title");
  assertEquals(
    stepOf(await answer(world, store, (r) => form(r, { response: "Lagos Street Food Trail" }))),
    "experience_description",
  );
  const short = await answer(world, store, (r) => form(r, { response: "Food!" }));
  assert(short.kind === "artefact");
  assertMatch(short.artefact.text, /10 to 500 characters\. Nothing was saved/);
  const vibe = await answer(
    world,
    store,
    (r) =>
      form(r, {
        response:
          "  Taste your way through Lagos Island's markets and suya spots.  ",
      }),
  );
  assertEquals(stepOf(vibe), "experience_vibe");
  assert(vibe.kind === "artefact");
  const vibeOptions = (vibe.artefact.rendition?.blocks as {
    type: string;
    options?: { id: string }[];
  }[]).find((b) => b.type === "choices")!.options!.map((o) => o.id);
  assertEquals(vibeOptions, ["adventurous", "first-date", "romantic", "group-fun"]);
  assertEquals(
    stepOf(await answer(world, store, (r) => form(r, { choices: ["Group Fun", "Adventurous"] }))),
    "experience_stop_name",
  );
  // Stop 1.
  assertEquals(
    stepOf(await answer(world, store, (r) => form(r, { response: "Market welcome" }))),
    "experience_stop_description",
  );
  const place1 = await answer(
    world,
    store,
    (r) => form(r, { response: "Meet your guide and taste fresh agege bread." }),
  );
  assertEquals(stepOf(place1), "experience_stop_place");
  assert(place1.kind === "artefact");
  assertEquals(place1.artefact.answer_mode, "form");
  // Typed words are not a place.
  const typed = await answer(world, store, (r) => form(r, { response: "Balogun market" }));
  assert(typed.kind === "artefact");
  assertMatch(typed.artefact.text, /Pick the address from the search suggestions/);
  const more1 = await answer(world, store, (r) => form(r, { place: MARKET }));
  assertEquals(stepOf(more1), "experience_stop_more");
  // Stop 2.
  assertEquals(
    stepOf(await answer(world, store, (r) => choice(r, "another"))),
    "experience_stop_name",
  );
  await answer(world, store, (r) => form(r, { response: "Suya on the island" }));
  await answer(world, store, (r) => form(r, { response: "Spicy suya and cold zobo by the water." }));
  const more2 = await answer(world, store, (r) => form(r, { place: SUYA }));
  assertEquals(stepOf(more2), "experience_stop_more");
  // The zone came from the brand, so the date is next.
  assertEquals(
    stepOf(await answer(world, store, (r) => choice(r, "done"))),
    "experience_start",
  );
  assertEquals(
    stepOf(await answer(world, store, (r) => form(r, { response: "14 November at 6pm" }))),
    "experience_end",
  );
  // The price is the owner's choice, asked before the draft.
  assertEquals(
    stepOf(await answer(world, store, (r) => form(r, { response: "9pm" }))),
    "experience_price_kind",
  );
  // Payments aren't set up: P6's money step lets the owner keep going
  // (Seth's decision 3: a draft may hold a price before payments).
  const money = await answer(world, store, (r) => choice(r, "paid"));
  assertEquals(stepOf(money), "money_gate");
  assert(money.kind === "artefact");
  assertMatch(money.artefact.text, /bookings/);
  const price = await answer(world, store, (r) => choice(r, "continue"));
  assertEquals(stepOf(price), "experience_price");
  assert(price.kind === "artefact");
  assertMatch(price.artefact.text, /price per person\? For example: ₦/);
  const wrong = await answer(world, store, (r) => form(r, { response: "£45" }));
  assert(wrong.kind === "artefact");
  assertMatch(wrong.artefact.text, /You typed £45, but .* prices are in NGN/);
  return await answer(world, store, (r) => form(r, { response: "₦25,000" }));
}

function nextNov14Year(): number {
  const now = new Date();
  const year = now.getUTCFullYear();
  return now.toISOString().slice(0, 10) < `${year}-11-14` ? year : year + 1;
}

// ── Intent ──────────────────────────────────────────────────────────────────

Deno.test("P9: experience, venue and stay requests enter their engine flows without the model", () => {
  assertEquals(classifyOfferingIntent(INTENT), "create_experience");
  assertEquals(classifyOfferingIntent("Create a venue for my restaurant"), "create_venue");
  assertEquals(classifyOfferingIntent("Set up a stay for my guesthouse"), "create_stay");
  for (const key of ["create_experience", "create_venue", "create_stay"]) {
    assertEquals(findFlowDefinition(key)?.version, 2, key);
    assertEquals(findFlowDefinition(key, 1)?.version, 1, `${key}: older runs finish on v1`);
  }
});

// ── Experience ──────────────────────────────────────────────────────────────

Deno.test("P9: an experience with two picked stops is one create proposal holding exactly the owner's facts", async () => {
  const world = freshWorld();
  const store = new MemoryStore();
  const proposed = await experienceToProposal(world, store);
  assert(proposed.kind === "propose", `got ${proposed.kind}`);
  assertEquals(proposed.tool_name, "create_experience");
  const year = nextNov14Year();
  assertEquals(proposed.tool_args, {
    brand_id: BRAND,
    title: "Lagos Street Food Trail",
    narrative: "Taste your way through Lagos Island's markets and suya spots.",
    experience_intents: ["adventurous", "group-fun"],
    stops: [
      {
        name: "Market welcome",
        description: "Meet your guide and taste fresh agege bread.",
        address: MARKET.address,
        city: "Lagos",
        country_code: "NG",
        place_id: MARKET.place_id,
        lat: MARKET.lat,
        lng: MARKET.lng,
        coordinate_precision: "exact",
      },
      {
        name: "Suya on the island",
        description: "Spicy suya and cold zobo by the water.",
        address: SUYA.address,
        city: "Lagos",
        country_code: "NG",
        place_id: SUYA.place_id,
        lat: SUYA.lat,
        lng: SUYA.lng,
        coordinate_precision: "exact",
      },
    ],
    location_mode: "per_stop",
    pricing_mode: "whole",
    is_free: false,
    whole_price_cents: 2_500_000,
    currency: "NGN",
    timezone: "Africa/Lagos",
    whenMode: "single",
    when: { date: `${year}-11-14`, doorsOpen: "18:00", endsAt: "21:00" },
  }, "the owner's price, no capacity, nothing the owner didn't give");
  assertEquals(proposed.rows_only, true);
  const rows = rowsText(proposed.rows);
  assertMatch(rows, /Stop 1: Market welcome — Meet your guide/);
  assertMatch(rows, /Stop 2: Suya on the island/);
  assertMatch(rows, /Time zone: Lagos time, from your brand/);
  assertMatch(rows, /Price: (?:₦|NGN\s)25,000\.00 per person/);
  assertMatch(rows, /Heads-up: You can save a price now/);
  assertNotMatch(rows, /latitude|longitude|6\.45|3\.38|create_experience|private/i);
  // The create_experience schema accepts exactly these args.
  const schema = findTool("create_experience")!.parameters as {
    properties: Record<string, unknown>;
    required: string[];
  };
  for (const key of Object.keys(proposed.tool_args)) assert(schema.properties[key], key);
  for (const key of schema.required) assert(key in proposed.tool_args, key);

  // Confirm → read back → "get it ready?" in the same response.
  const next = await confirm(
    world,
    store,
    "create_experience",
    () => world.experiences.set(EXP_ID, experienceFrom(proposed.tool_args)),
    { event: { id: EXP_ID } },
  );
  assert(next.kind === "artefact");
  assertMatch(next.text, /Saved and checked: "Lagos Street Food Trail" with 2 stops is an unpublished draft/);
  assertEquals(next.artefact.step_key, "experience_publish");
  const run = await cur(store);
  assertEquals(run.subject_id, EXP_ID);
  for (
    const key of ["title", "description", "intents", "stops", "start_at", "end_at", "price_kind", "price"]
  ) {
    assertEquals(run.answers[key]?.source, "owner", key);
  }
});

Deno.test("P9: a free experience is saved free only because the owner said so, and publishes only on the owner's word", async () => {
  const world = freshWorld({ canSell: true });
  const store = new MemoryStore();
  await startRun(store, "create_experience", "Create an experience called Sunset Walk");
  assertEquals(stepOf(await turn(world, store)), "experience_description");
  await answer(world, store, (r) => form(r, { response: "A slow walk along the lagoon at sunset." }));
  await answer(world, store, (r) => form(r, { choices: ["Romantic"] }));
  await answer(world, store, (r) => form(r, { response: "Lagoon path" }));
  await answer(world, store, (r) => form(r, { response: "Walk and watch the sun go down." }));
  await answer(world, store, (r) => form(r, { place: SUYA }));
  await answer(world, store, (r) => choice(r, "done"));
  await answer(world, store, (r) => form(r, { response: "14 November at 6pm" }));
  assertEquals(
    stepOf(await answer(world, store, (r) => form(r, { response: "8pm" }))),
    "experience_price_kind",
  );
  const proposed = await answer(world, store, (r) => choice(r, "free"));
  assert(proposed.kind === "propose", `got ${proposed.kind}`);
  assertEquals(proposed.tool_args.is_free, true);
  assert(!("whole_price_cents" in proposed.tool_args));
  assertMatch(rowsText(proposed.rows), /Price: Free/);
  const ready = await confirm(
    world,
    store,
    "create_experience",
    () =>
      world.experiences.set(EXP_ID, {
        ...experienceFrom(proposed.tool_args),
        is_free: true,
      }),
    { event: { id: EXP_ID } },
  );
  assert(ready.kind === "artefact");
  assertEquals(ready.artefact.step_key, "experience_publish");
  assertEquals(ready.artefact.title, "Ready to publish");
  assertEquals(world.experiences.get(EXP_ID)!.status, "draft", "nothing published by itself");
  const publish = await answer(world, store, (r) => choice(r, "publish"));
  assert(publish.kind === "propose");
  assertEquals(publish.tool_name, "publish_experience");
  assertEquals(publish.tool_args, {
    event_id: EXP_ID,
    expected_revision: "2026-11-02T10:00:00.000000+00:00",
  });
});

Deno.test("P9: a paid experience on a brand that can't sell yet is saved, and publishing is refused in plain words", async () => {
  const world = freshWorld();
  const store = new MemoryStore();
  const proposed = await experienceToProposal(world, store);
  assert(proposed.kind === "propose");
  const next = await confirm(
    world,
    store,
    "create_experience",
    () => world.experiences.set(EXP_ID, {
      ...experienceFrom(proposed.tool_args),
      whole_price_cents: 2_500_000,
    }),
    { event: { id: EXP_ID } },
  );
  assert(next.kind === "artefact");
  assertMatch(next.artefact.text, /Can't publish yet: payment setup isn't finished/);
  assert(!next.artefact.options.some((o) => o.id === "publish"));
  world.canSell = true;
  const check = await answer(world, store, (r) => choice(r, "check"));
  assert(check.kind === "artefact");
  assertEquals(check.artefact.title, "Ready to publish");
  const later = await answer(world, store, (r) => choice(r, "later"));
  assertEquals(later.kind, "completed");
});

Deno.test("P9: an experience is capped at five stops and its description cap matches its message", async () => {
  const world = freshWorld();
  const store = new MemoryStore();
  await startRun(store, "create_experience", "Create an experience called Five Stop Crawl");
  assertEquals(stepOf(await turn(world, store)), "experience_description");
  await answer(world, store, (r) => form(r, { response: "Five stops across the city in one night." }));
  await answer(world, store, (r) => form(r, { choices: ["Romantic"] }));
  let last: RunnerOutcome | null = null;
  for (let n = 1; n <= 5; n += 1) {
    await answer(world, store, (r) => form(r, { response: `Stop number ${n}` }));
    await answer(world, store, (r) => form(r, { response: `What happens at ${n}.` }));
    last = await answer(world, store, (r) => form(r, { place: MARKET }));
    if (n < 5) {
      assertEquals(stepOf(last), "experience_stop_more");
      await answer(world, store, (r) => choice(r, "another"));
    }
  }
  // The fifth stop ends the loop: no "another stop?" card.
  assert(last && last.kind === "artefact");
  assertEquals(last.artefact.step_key, "experience_start");
  assertMatch(last.text, /5 stops, the most an experience can have/);
  // The tool's own message states its real 500 cap (was "1-2000"), the
  // same cap as its schema.
  const tool = findTool("create_experience")!;
  const narrative = (tool.parameters as {
    properties: Record<string, { maxLength?: number }>;
  }).properties.narrative;
  assertEquals(narrative.maxLength, 500);
  const source = await Deno.readTextFile(new URL("../agentTools.ts", import.meta.url));
  assertMatch(source, /"narrative is required \(1-500 chars\)"/);
  assertNotMatch(source, /narrative is required \(1-2000/);
});

Deno.test("P9: an experience draft missing a picked place for a stop is not publish-ready", () => {
  const row: FlowExperienceRow = {
    id: EXP_ID,
    title: "Trail",
    status: "draft",
    updated_at: "x",
    timezone: "Africa/Lagos",
    description: "A long enough description.",
    intents: ["romantic"],
    stops: [{ name: "A", description: "B", address: "C", has_point: true, has_place_id: false }],
    is_free: true,
    whole_price_cents: 0,
    when: { date: "2027-01-01" },
  };
  assertEquals(experiencePublishGaps(row), [
    "a name, a description and a picked address for every stop",
  ]);
  assertEquals(experiencePublishGaps({ ...row, stops: [{ ...row.stops[0], has_place_id: true }], is_free: false }), [
    "a price",
  ]);
});

// ── Venue ───────────────────────────────────────────────────────────────────

const VI = {
  venue_name: "The Lagoon Room",
  address: "The Lagoon Room, 3 Ozumba Mbadiwe Ave, Victoria Island, Lagos, Nigeria",
  city: "Lagos",
  country_code: "NG",
  lat: 6.4338,
  lng: 3.4206,
  feature_type: "poi",
  place_id: "dXJuOm1ieHBvaTpsYWdvb24",
};

Deno.test("P9: a venue created via the picker is one submit proposal of the owner's facts, then 'Mingla reviews new venues before they go live'", async () => {
  const world = freshWorld({
    venues: [{
      id: "99999999-9999-4999-8999-999999999999",
      name: "Old",
      slug: "thelagoonroom",
      venue_category: "restaurant",
      claim_status: "verified",
      city: "Lagos",
      cover_media_url: null,
      created_at: null,
    }],
  });
  const store = new MemoryStore();
  await startRun(store, "create_venue", "Create a venue for my restaurant");
  const place = await turn(world, store);
  assertEquals(stepOf(place), "venue_place");
  assert(place.kind === "artefact");
  assertEquals(place.artefact.answer_mode, "form");
  const name = await answer(world, store, (r) => form(r, { place: VI }));
  assertEquals(stepOf(name), "venue_name");
  assert(name.kind === "artefact");
  // The named place the owner picked is offered with one tap.
  assertEquals(name.artefact.options.map((o) => o.label), ["The Lagoon Room"]);
  const slug = await answer(world, store, (r) => choice(r, "use_place"));
  assertEquals(stepOf(slug), "venue_slug");
  assert(slug.kind === "artefact");
  // Derived from the name, made free among the brand's venues.
  assertMatch(slug.artefact.text, /\/v\/thelagoonroom2\b/);
  const bad = await answer(world, store, (r) => form(r, { response: "The-Lagoon!" }));
  assert(bad.kind === "artefact");
  assertMatch(bad.artefact.text, /lowercase letters and numbers/);
  const taken = await answer(world, store, (r) => form(r, { response: "thelagoonroom" }));
  assert(taken.kind === "artefact");
  assertMatch(taken.artefact.text, /already uses thelagoonroom/);
  const category = await answer(world, store, (r) => choice(r, "use_suggested"));
  assertEquals(stepOf(category), "venue_category");
  assert(category.kind === "artefact");
  // Stay authoring is off: Stay isn't offered.
  assertEquals(category.artefact.options.map((o) => o.id), ["restaurant", "play", "creative_and_arts"]);
  const hours = await answer(world, store, (r) => choice(r, "restaurant"));
  assertEquals(stepOf(hours), "venue_hours");
  // Days the owner never mentions are asked, never filled in.
  const partial = await answer(world, store, (r) => form(r, { response: "Mon-Fri 12pm-11pm" }));
  assert(partial.kind === "artefact");
  assertMatch(partial.artefact.text, /I still need the hours for Saturday and Sunday/);
  // #3355 — answering only the missing days completes the week; the weekdays
  // already given are kept (this used to loop back to Monday–Friday).
  const contact = await answer(
    world,
    store,
    (r) => form(r, { response: "Sat 10am-1am, Sun closed" }),
  );
  assertEquals(stepOf(contact), "venue_contact");
  assert(contact.kind === "artefact");
  assertMatch(contact.artefact.text, /hello@coastline\.test · \+2348012345678/);
  const proposed = await answer(world, store, (r) => choice(r, "use_brand"));
  assert(proposed.kind === "propose", `got ${proposed.kind}`);
  assertEquals(proposed.tool_name, "create_venue_listing");
  const open = (open_time: string, close_time: string, weekday: number) => ({
    weekday,
    open_time,
    close_time,
    is_closed: false,
  });
  assertEquals(proposed.tool_args, {
    brand_id: BRAND,
    name: "The Lagoon Room",
    slug: "thelagoonroom2",
    lat: VI.lat,
    lng: VI.lng,
    address: VI.address,
    city: "Lagos",
    country_code: "NG",
    coordinate_precision: "exact",
    venue_category: "restaurant",
    hours: [
      open("12:00", "23:00", 0),
      open("12:00", "23:00", 1),
      open("12:00", "23:00", 2),
      open("12:00", "23:00", 3),
      open("12:00", "23:00", 4),
      open("10:00", "01:00", 5),
      { weekday: 6, is_closed: true },
    ],
    contact_email: "hello@coastline.test",
    contact_phone: "+2348012345678",
  });
  const rows = rowsText(proposed.rows);
  assertMatch(rows, /Hours: Mon–Fri 12pm–11pm · Sat 10am–1am · Sun closed/);
  assertMatch(rows, /After you submit: Mingla reviews new venues before they go live\./);
  assertNotMatch(rows, /latitude|longitude|6\.43|3\.42/i);
  const schema = findTool("create_venue_listing")!.parameters as {
    properties: Record<string, unknown>;
    required: string[];
  };
  for (const key of Object.keys(proposed.tool_args)) assert(schema.properties[key], key);
  for (const key of schema.required) assert(key in proposed.tool_args, key);

  // biz_create_venue_listing returns the new venue's id itself.
  const next = await confirm(world, store, "create_venue_listing", () => {
    world.venues = [...world.venues, {
      id: VENUE_ID,
      name: "The Lagoon Room",
      slug: "thelagoonroom2",
      venue_category: "restaurant",
      claim_status: "pending_review",
      city: "Lagos",
      cover_media_url: null,
      created_at: null,
    }];
  }, VENUE_ID);
  assert(next.kind === "artefact");
  assert(next.text.includes(VENUE_REVIEW_WORDS), next.text);
  assertMatch(next.text, /Saved and checked: "The Lagoon Room" is submitted/);
  assertEquals((await cur(store)).subject_id, VENUE_ID);
  // The cover is a skippable step on the venue page.
  assertEquals(next.artefact.step_key, "venue_cover");
  const end = await answer(world, store, (r) => choice(r, "not_now"));
  assertEquals(end.kind, "completed");
  assert(end.kind === "completed");
  assertMatch(end.text, /Mingla reviews new venues before they go live/);
});

Deno.test("P9: venue hours, slug and contact read only what the owner wrote", () => {
  const every = parseVenueHours("9am to 5pm every day");
  assertEquals(every.missing, []);
  assertEquals(every.rows.every((r) => r.open_time === "09:00" && r.close_time === "17:00"), true);
  assertEquals(parseVenueHours("Tue-Sun 10-2pm, Mon closed").rows[1], {
    weekday: 1,
    open_time: "10:00",
    close_time: "14:00",
    is_closed: false,
  });
  assertEquals(parseVenueHours("Sat 9am-5pm").missing, [0, 1, 2, 3, 4, 6]);
  assertMatch(parseVenueHours("every day 9am-9am").problem ?? "", /can't be the same/);
  assertEquals(slugFromName("Mama's Kitchen & Bar"), "mamaskitchenbar");
  assertEquals(slugFromName("Café Olé"), "cafeole");
  assertEquals(freeSlug("abc", new Set(["abc", "abc2"])), "abc3");
  assertEquals(parseContact("call +44 20 7946 0000"), { email: null, phone: "+442079460000" });
  assertEquals(parseContact("07946 000000"), null, "a phone needs its country code");
  assertEquals(parseContact("bookings@lagoon.ng"), { email: "bookings@lagoon.ng", phone: null });
});

Deno.test("P9: the venue flow offers Stay only while Stay authoring is on", async () => {
  const world = freshWorld({ stayFlag: true });
  const store = new MemoryStore();
  await startRun(store, "create_venue", "Create a venue");
  await turn(world, store);
  await answer(world, store, (r) => form(r, { place: VI }));
  await answer(world, store, (r) => form(r, { response: "Lagoon Guesthouse" }));
  const category = await answer(world, store, (r) => choice(r, "use_suggested"));
  assert(category.kind === "artefact");
  assertEquals(category.artefact.options.map((o) => o.id), [
    "restaurant",
    "play",
    "creative_and_arts",
    "stay",
  ]);
});

// ── Stay ────────────────────────────────────────────────────────────────────

function stayVenue(claim: string): FlowVenueRow {
  return {
    id: STAY_VENUE_ID,
    name: "Lagoon Guesthouse",
    slug: "lagoonguesthouse",
    venue_category: "stay",
    claim_status: claim,
    city: "Lagos",
    cover_media_url: null,
    created_at: null,
  };
}

Deno.test("P9: with no approved Stay venue Ari says so plainly and creates nothing", async () => {
  const world = freshWorld();
  const store = new MemoryStore();
  await startRun(store, "create_stay", "Create a stay for my guesthouse");
  const none = await turn(world, store);
  assert(none.kind === "artefact");
  assertEquals(none.artefact.step_key, "stay_venue");
  assertMatch(none.artefact.text, /you don't have one yet/);
  assertMatch(none.artefact.text, /Nothing was created/);
  const add = none.artefact.options.find((o) => o.id === "add_venue");
  assertEquals(add?.route, "/venue/create");

  // One still in review: named, with the review words.
  world.venues = [stayVenue("pending_review")];
  const review = await answer(world, store, (r) => choice(r, "check"));
  assert(review.kind === "artefact");
  assertMatch(review.artefact.text, /"Lagoon Guesthouse" is still in review — Mingla reviews new venues/);
});

Deno.test("P9: a stay offering is created on an approved venue, typed, from the owner's facts only", async () => {
  const world = freshWorld({ venues: [stayVenue("verified")] });
  world.stays.set(STAY_VENUE_ID, {
    venue_id: STAY_VENUE_ID,
    settings_version: null,
    settings: null,
    settings_raw: null,
    offerings: [],
  });
  const store = new MemoryStore();
  await startRun(store, "create_stay", "Create a stay for my guesthouse");
  const summary = await turn(world, store);
  // The only approved venue is used and named; settings are missing.
  assertEquals(stepOf(summary), "stay_summary");
  assert(summary.kind === "artefact");
  assertMatch(summary.text, /I'll add it to Lagoon Guesthouse, your approved Stay venue/);
  const times = await answer(
    world,
    store,
    (r) => form(r, { response: "A calm guesthouse a short walk from Bar Beach." }),
  );
  // The zone came from the brand.
  assertEquals(stepOf(times), "stay_times");
  const settings = await answer(
    world,
    store,
    (r) => form(r, { response: "check-in 2pm, check-out 11am" }),
  );
  assert(settings.kind === "propose", `got ${settings.kind}`);
  assertEquals(settings.tool_name, "manage_stay_inventory");
  assertEquals(settings.tool_args, {
    brand_id: BRAND,
    venue_id: STAY_VENUE_ID,
    action: "save_settings",
    payload: {
      summary: "A calm guesthouse a short walk from Bar Beach.",
      timezone: "Africa/Lagos",
      checkInTime: "14:00",
      checkOutTime: "11:00",
    },
  }, "the first save carries no version");
  const kind = await confirm(world, store, "manage_stay_inventory", () => {
    world.stays.set(STAY_VENUE_ID, {
      venue_id: STAY_VENUE_ID,
      settings_version: 1,
      settings: {
        summary: "A calm guesthouse a short walk from Bar Beach.",
        timezone: "Africa/Lagos",
        check_in_time: "14:00:00",
        check_out_time: "11:00:00",
      },
      settings_raw: {},
      offerings: [],
    });
  });
  assert(kind.kind === "artefact");
  assertMatch(kind.text, /Saved and checked: the stay settings are complete/);
  assertEquals(kind.artefact.step_key, "stay_kind");
  assertEquals(stepOf(await answer(world, store, (r) => choice(r, "room"))), "stay_name");
  assertEquals(
    stepOf(await answer(world, store, (r) => form(r, { response: "Sea View Double" }))),
    "stay_size",
  );
  const missing = await answer(world, store, (r) => form(r, { response: "2 guests" }));
  assert(missing.kind === "artefact");
  assertMatch(missing.artefact.text, /I need both numbers/);
  const price = await answer(world, store, (r) => form(r, { response: "2 guests, 5 rooms" }));
  assertEquals(stepOf(price), "stay_price");
  assert(price.kind === "artefact");
  assertMatch(price.artefact.text, /price per night/);
  assertEquals(
    stepOf(await answer(world, store, (r) => form(r, { response: "₦45,000" }))),
    "stay_policy",
  );
  const proposed = await answer(
    world,
    store,
    (r) => form(r, { response: "Free cancellation up to 7 days before arrival." }),
  );
  assert(proposed.kind === "propose", `got ${proposed.kind}`);
  assertEquals(proposed.tool_name, "manage_stay_inventory");
  assertEquals(proposed.tool_args, {
    brand_id: BRAND,
    venue_id: STAY_VENUE_ID,
    action: "create_offering",
    payload: {
      kind: "room",
      name: "Sea View Double",
      inventoryBasis: "pooled_units",
      unitNamingMode: "interchangeable",
      quantity: 5,
      minGuests: 1,
      maxGuests: 2,
      maxAdults: 2,
      maxChildren: 0,
      price: { amountMinor: 4_500_000, currencyCode: "NGN" },
      policy: { cancellationPolicy: "Free cancellation up to 7 days before arrival." },
    },
    expected_version: 1,
  });
  // The typed contract the tool enforces accepts it.
  assertEquals(stayOfferingPayloadProblem(proposed.tool_args.payload), null);
  const rows = rowsText(proposed.rows);
  assertMatch(rows, /Price: (?:₦|NGN\s)45,000\.00 per night/);
  assertMatch(rows, /How many: 5 rooms/);
  const next = await confirm(world, store, "manage_stay_inventory", () => {
    const stay = world.stays.get(STAY_VENUE_ID)!;
    world.stays.set(STAY_VENUE_ID, {
      ...stay,
      offerings: [{
        id: OFFERING_ID,
        name: "Sea View Double",
        kind: "room",
        status: "draft",
        version: 1,
        has_price: true,
        has_policy: true,
      }],
    });
  }, { kind: "success", data: { offeringId: OFFERING_ID } });
  assert(next.kind === "artefact");
  assertMatch(next.text, /Saved and checked: "Sea View Double" is on Lagoon Guesthouse as a draft/);
  assertEquals(next.artefact.step_key, "stay_publish");
  // Never published by itself; payments aren't ready so the card says why.
  assertMatch(next.artefact.text, /payment setup isn't finished/);
  const later = await answer(world, store, (r) => choice(r, "later"));
  assertEquals(later.kind, "completed");
});

Deno.test("P9: an untyped stay payload is rejected before the Stay owner is called", async () => {
  const tool = domainTool("manage_stay_inventory");
  let invoked = 0;
  const client = {
    functions: {
      invoke: () => {
        invoked += 1;
        return Promise.resolve({ data: { kind: "success" }, error: null });
      },
    },
  };
  const base = { brand_id: BRAND, venue_id: STAY_VENUE_ID, action: "create_offering", expected_version: 1 };
  for (
    const payload of [
      { anything: true },
      { kind: "room", name: "Room" },
      { kind: "room", name: "Room", inventoryBasis: "pooled_units", maxGuests: 2, quantity: 3 },
      {
        kind: "place",
        name: "Cottage",
        inventoryBasis: "exclusive_units",
        quantity: 1,
        maxGuests: 4,
        placePricingBasis: "per_booking",
        price: { amountMinor: 100, currencyCode: "ngn" },
      },
    ]
  ) {
    await assertRejects(
      () => tool.executor({ ...base, payload }, client as never, "u", { operationId: OP } as never),
      Error,
    );
  }
  assertEquals(invoked, 0, "nothing reached manage-stay-inventory");
  // A typed payload goes through.
  await tool.executor({
    ...base,
    payload: {
      kind: "place",
      name: "Cottage",
      inventoryBasis: "exclusive_units",
      quantity: 1,
      minGuests: 1,
      maxGuests: 4,
      placePricingBasis: "per_booking",
    },
  }, client as never, "u", { operationId: OP } as never);
  assertEquals(invoked, 1);
});

Deno.test("P9: a new Stay's first settings save needs no version; every other mutation still does", async () => {
  const tool = domainTool("manage_stay_inventory");
  const bodies: Record<string, unknown>[] = [];
  const client = {
    functions: {
      invoke: (_name: string, opts: { body: Record<string, unknown> }) => {
        bodies.push(opts.body);
        return Promise.resolve({ data: { kind: "success" }, error: null });
      },
    },
  };
  const base = { brand_id: BRAND, venue_id: STAY_VENUE_ID };
  await tool.executor(
    { ...base, action: "save_settings", payload: { timezone: "Africa/Lagos" } },
    client as never,
    "u",
    { operationId: OP } as never,
  );
  assertEquals(bodies[0].expectedVersion, null);
  await assertRejects(
    () =>
      tool.executor(
        { ...base, action: "update_offering", payload: {} },
        client as never,
        "u",
        { operationId: OP } as never,
      ),
    Error,
    "expected_version",
  );
  assertEquals(bodies.length, 1);
});

Deno.test("P9: stay words, settings and sizes come only from the owner", () => {
  assertEquals(parseCheckTimes("check-in 3pm, check-out 11am"), { check_in: "15:00", check_out: "11:00" });
  assertEquals(parseCheckTimes("check-out 10:30, check-in 14:00"), { check_in: "14:00", check_out: "10:30" });
  assertEquals(parseCheckTimes("3pm"), null);
  assertEquals(parseStaySize("sleeps 6, 1 cottage", "place"), { guests: 6, quantity: 1 });
  assertEquals(parseStaySize("2 guests", "room"), null);
  // A save keeps every stored setting and changes only the owner's facts.
  const kept = staySettingsPayload({
    venue_id: STAY_VENUE_ID,
    settings_version: 4,
    settings: { summary: "short", timezone: "Africa/Lagos", check_in_time: "15:00:00", check_out_time: "11:00:00" },
    settings_raw: { default_booking_mode: "instant", house_rules: "No parties", booking_horizon_days: 180 },
    offerings: [],
  }, { summary: "A much longer summary for guests to read.", timezone: null, check_in: null, check_out: null });
  assertEquals(kept, {
    defaultBookingMode: "instant",
    houseRules: "No parties",
    bookingHorizonDays: 180,
    summary: "A much longer summary for guests to read.",
    timezone: "Africa/Lagos",
    checkInTime: "15:00",
    checkOutTime: "11:00",
  });
  // No price, no offering (never a default price).
  const run = { answers: {} } as unknown as FlowRun;
  assertEquals(createStayOfferingPayload(run, null), null);
  // The Stay snapshot maps without inventing a version.
  assertEquals(stayInventoryOf(STAY_VENUE_ID, { settings: null, offerings: [] })?.settings_version, null);
});

// ── Coordinates, places, windows ────────────────────────────────────────────

Deno.test("P9 (D-21): Ari never emits 'latitude' or 'longitude'", () => {
  for (const text of ["What's the latitude and longitude?", "Send me the longitude please"]) {
    assert(ownerCopyViolations(text, "prose").length > 0, text);
    assert(ownerCopyViolations(text, "label").length > 0, text);
  }
  assertEquals(ownerCopyViolations("Pick the address from the search suggestions.", "prose"), []);
  assert(SEEN.length > 20, "the flows above produced owner copy");
  for (const text of SEEN) {
    assertNotMatch(text, /latitude|longitude/i);
  }
});

Deno.test("P9: a picked place carries the address search's own id; anything odd is refused", () => {
  const base = { ...MARKET };
  assertEquals(parseFlowPlace(base)?.place_id, MARKET.place_id);
  const { place_id: _id, ...older } = base;
  assertEquals(parseFlowPlace(older)?.place_id, undefined, "older Host builds still work");
  assertEquals(parseFlowPlace({ ...base, place_id: "x y" }), null);
  assertEquals(parseFlowPlace({ ...base, extra: 1 }), null);
});

Deno.test("P9 (D-22): a host setting up a stay gets its venues listed, not the guest booking tools", () => {
  const text = "Create a stay for my guesthouse";
  const names = selectAriTools(AGENT_TOOLS, inferAriToolsets(text), 12, text).map((t) => t.name);
  assert(names.includes("list_venue_listings"), names.join(","));
  for (const guest of ["quote_stay", "create_stay_reservation", "transition_stay"]) {
    assert(!names.includes(guest), guest);
  }
  // A guest-booking question still gets the booking tools.
  const booking = "Quote a stay booking for a guest";
  assert(
    selectAriTools(AGENT_TOOLS, inferAriToolsets(booking), 12, booking).some((t) =>
      t.name === "quote_stay"
    ),
  );
});

Deno.test("P9: a venue create's bare id result becomes the run's subject", () => {
  assertEquals(subjectIdFromResult(VENUE_ID), VENUE_ID);
  assertEquals(subjectIdFromResult("not an id"), null);
  assertEquals(subjectIdFromResult({ event: { id: EXP_ID } }), EXP_ID);
});

Deno.test("P9: experience args are refused without every owner fact (no defaults fill a gap)", () => {
  const stop = {
    name: "A",
    description: "B",
    place: { ...MARKET },
  };
  const facts = {
    title: "T",
    description: "Long enough here",
    intents: ["romantic"],
    stops: [stop],
    timezone: "Africa/Lagos",
    timezone_source: "brand" as const,
    start_at: "2027-01-01T18:00:00Z",
    end_at: "2027-01-01T21:00:00Z",
    price: "free" as const,
  };
  assert(createExperienceArgs(BRAND, facts) !== null);
  assertEquals(createExperienceArgs(BRAND, { ...facts, stops: [] }), null);
  // No price chosen: no draft (the server would store it as free).
  assertEquals(createExperienceArgs(BRAND, { ...facts, price: null }), null);
});
