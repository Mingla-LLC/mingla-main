// Issue #3355 P8 — "Create a trip" on the Ari flow engine (implementor happy
// path + adversarial).
//
// MINGLA-INVARIANT: I-ARI-TRIP-NO-INVENTED-FACTS | issue #3355 | Every fact Ari saves on a trip it creates traces to the owner: the first and last calendar day, the time zone (theirs, or the brand's shown on the card they confirm), the departure and destination they picked, and each package's name, price and spots. No UTC default, no capacity default, no auto-created package (server side: supabase/migrations/__tests__/issue_3355_trip_seed_truth.implementor.pg17.test.sql).
// MINGLA-INVARIANT: I-ARI-NO-WRITE-IN-INITIAL-CALLS | issue #3355 | agent-chat's initialCalls (the loop's read-only pre-pass) holds only read tools; a trip is created by the engine's create_trip flow behind the owner's confirmation (audit D-16).
//
// Drives the shipped flow (supabase/functions/_shared/ariFlows/offerings/
// trip.ts) through the shipped runner with an in-memory run store that keeps
// the SQL rules (lease, compare-and-swap, evidence for every done):
//   "Create a 3-day trip to Lagos from 8 to 10 January" → the trip's name → departure and destination picked → ONE
//   create_trip proposal with only the owner's facts → confirm → read back →
//   "get it ready?" → paid → the payout-country question on a brand with no
//   currency, before any price → the package → deposit and instalments
//   refused while payouts aren't on ("Skip instalments for now") → ONE
//   package proposal → refund policy → ONE policy proposal → publish refused
//   with the plain gaps → not now → summary.
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_trip_flow.implementor.test.ts

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
  FlowProbeDeps,
  FlowRun,
  FlowStepRecord,
  FlowTripRow,
} from "../ariFlows/types.ts";
import {
  classifyOfferingIntent,
  findFlowDefinition,
} from "../ariFlows/index.ts";
import {
  createTripArgs,
  parseInstallmentPlan,
  parsePackageAnswer,
  tripPublishGaps,
  tripTitleFromIntent,
} from "../ariFlows/offerings/trip.ts";
import {
  parseTicketAnswer,
  UNPUBLISHED_DRAFT_WORDS,
} from "../ariFlows/offerings/event.ts";
import { findTool, isReadOnlyAgentToolCall } from "../agentTools.ts";
import { ariDomainRefusal } from "../agentToolHelpers.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";

const ROOT = new URL("../../../../", import.meta.url);
const BRAND = "22222222-2222-4222-8222-222222222222";
const CHAT = "33333333-3333-4333-8333-333333333333";
const TRIP_ID = "55555555-5555-4555-8555-555555555555";
const BRAND_NAME = "Coastline Collective";
const INTENT = "Create a 3-day trip to Lagos from 8 to 10 January";

/** The next 8 January from today (the flow reads a yearless range so). */
function nextJan8Year(): number {
  const now = new Date();
  const year = now.getUTCFullYear();
  return now.toISOString().slice(0, 10) <= `${year}-01-08` ? year : year + 1;
}
const YEAR = nextJan8Year();

// ── A small world ───────────────────────────────────────────────────────────
interface World {
  canSell: boolean;
  canPayout: boolean;
  brand: {
    default_timezone: string | null;
    country_code: string | null;
    default_currency: string | null;
  };
  trips: Map<string, FlowTripRow>;
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
    item("profile_photo", "Brand logo", "media", ["website_build"], false, action),
    item(
      "money.can_sell",
      "Ready to sell paid tickets",
      "money",
      ["publish_paid", "trip_installments"],
      world.canSell,
      action,
    ),
    item(
      "money.can_be_paid_out",
      "Payouts to your bank",
      "money",
      ["trip_installments"],
      world.canPayout,
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
      can_be_paid_out: world.canPayout,
      sell_reason: world.canSell ? "ready" : "no_provider",
      payout_reason: world.canPayout ? "ready" : "no_bank",
      rail: world.canSell ? "paystack" : "none",
      currency: world.brand.default_currency,
      terms_accepted_by_caller: true,
    },
    items,
  } as BrandReadiness;
}

function probesFor(world: World): FlowProbeDeps {
  return {
    readiness: (action) => Promise.resolve(readinessFor(world, action)),
    subjectExists: (_table, id) => Promise.resolve(world.trips.has(id)),
    setAside: () => Promise.resolve("brand"),
    hasOpenProposal: () => Promise.resolve(world.openProposal),
    brandFacts: () => Promise.resolve(world.brand),
    tripRow: (id) => Promise.resolve(world.trips.get(id) ?? null),
  };
}

function freshWorld(overrides: Partial<World> = {}): World {
  return {
    canSell: false,
    canPayout: false,
    brand: {
      default_timezone: null,
      country_code: "NG",
      default_currency: null,
    },
    trips: new Map(),
    openProposal: false,
    ...overrides,
  };
}

// ── In-memory store with the SQL rules (lease, CAS, evidence) ───────────────
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
async function startRun(store: MemoryStore, text: string): Promise<FlowRun> {
  const def = findFlowDefinition("create_trip")!;
  assertEquals(def.version, 2, "new trip runs use the engine flow");
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

const ABUJA = {
  venue_name: "Abuja",
  address: "Abuja, Federal Capital Territory, Nigeria",
  city: "Abuja",
  country_code: "NG",
  lat: 9.0765,
  lng: 7.3986,
  feature_type: "place",
};
const LAGOS = {
  venue_name: "Lagos",
  address: "Lagos, Nigeria",
  city: "Lagos",
  country_code: "NG",
  lat: 6.5244,
  lng: 3.3792,
  feature_type: "place",
};

/** What ari_create_trip_draft stores for these args (Host encoding). */
function tripFrom(args: Record<string, unknown>): FlowTripRow {
  const dep = args.departure as Record<string, unknown>;
  const dest = args.destination as Record<string, unknown>;
  return {
    id: TRIP_ID,
    title: String(args.title),
    status: "draft",
    timezone: String(args.timezone),
    updated_at: "2026-11-02T10:00:00.000000+00:00",
    start_at: `${args.start_date}T00:00:00+00:00`,
    end_at: `${args.end_date}T23:59:59+00:00`,
    departure: { label: String(dep.label), lat: Number(dep.lat), lng: Number(dep.lng) },
    destination: { label: String(dest.label), lat: Number(dest.lat), lng: Number(dest.lng) },
    refund_policy: null,
    day_count: 0,
    packages: [],
  };
}

/** The Lagos request up to the create proposal. */
async function toCreateProposal(world: World, store: MemoryStore) {
  const run = await startRun(store, INTENT);
  const first = await runFlowStep({ store, probes: probesFor(world) }, {
    run,
    trigger: "turn",
    brandName: BRAND_NAME,
  });
  assert(first.kind === "artefact");
  // The request has no name: Ari asks rather than making one up.
  assertEquals(first.artefact.step_key, "trip_title");
  const departure = await answer(
    world,
    store,
    (r) => form(r, { response: "Lagos Long Weekend" }),
  );
  assert(departure.kind === "artefact");
  // The days came from the request and the zone from the brand's country.
  assertEquals(departure.artefact.step_key, "trip_departure");
  assertEquals(departure.artefact.answer_mode, "form");
  const destination = await answer(world, store, (r) => form(r, { place: ABUJA }));
  assert(destination.kind === "artefact");
  assertEquals(destination.artefact.step_key, "trip_destination");
  return await answer(world, store, (r) => form(r, { place: LAGOS }));
}

function rowsText(rows: { label: string; value: string }[]): string {
  return rows.map((r) => `${r.label}: ${r.value}`).join("\n");
}

// ── The Lagos script ────────────────────────────────────────────────────────

Deno.test("P8: 'Create a 3-day trip to Lagos from 8 to 10 January' enters the trip flow without the model", () => {
  assertEquals(classifyOfferingIntent(INTENT), "create_trip");
  assertEquals(findFlowDefinition("create_trip")?.version, 2);
  assertEquals(findFlowDefinition("create_trip", 1)?.version, 1, "older runs finish on v1");
});

Deno.test("P8: the Lagos trip becomes one create proposal holding only the owner's facts", async () => {
  const world = freshWorld();
  const store = new MemoryStore();
  const proposed = await toCreateProposal(world, store);
  assertEquals(proposed.kind, "propose");
  if (proposed.kind !== "propose") return;
  assertEquals(proposed.tool_name, "create_trip");
  const args = proposed.tool_args;
  assertEquals(args, {
    brand_id: BRAND,
    title: "Lagos Long Weekend",
    timezone: "Africa/Lagos",
    start_date: `${YEAR}-01-08`,
    end_date: `${YEAR}-01-10`,
    departure: {
      label: ABUJA.address,
      city: "Abuja",
      country_code: "NG",
      lat: ABUJA.lat,
      lng: ABUJA.lng,
    },
    destination: {
      label: LAGOS.address,
      city: "Lagos",
      country_code: "NG",
      lat: LAGOS.lat,
      lng: LAGOS.lng,
    },
  }, "no capacity, no package, no UTC, nothing the owner didn't give");
  assertEquals(proposed.rows_only, true);
  const rows = rowsText(proposed.rows);
  assertMatch(rows, new RegExp(`When: \\w{3} 8 Jan – \\w{3} 10 Jan ${YEAR}`));
  assertMatch(rows, /Time zone: Lagos time, from your brand's country/);
  assertMatch(rows, /Leaves from: Abuja, Federal Capital Territory, Nigeria/);
  assertMatch(rows, /Going to: Lagos, Nigeria/);
  assert(rows.includes(UNPUBLISHED_DRAFT_WORDS));
  assertNotMatch(rows, /private|create_trip|latitude|longitude|_|\b6\.52/i);
  // The create_trip schema accepts exactly these args.
  const schema = findTool("create_trip")!.parameters as {
    properties: Record<string, unknown>;
    required: string[];
  };
  for (const key of Object.keys(args)) assert(schema.properties[key], key);
  for (const key of schema.required) assert(key in args, key);

  // Confirm → read back → "get it ready to publish?" in the same response.
  const next = await confirm(
    world,
    store,
    "create_trip",
    () => world.trips.set(TRIP_ID, tripFrom(args)),
    { event: { id: TRIP_ID } },
  );
  assert(next.kind === "artefact");
  assertMatch(
    next.text,
    new RegExp(
      `Saved and checked: "Lagos Long Weekend" runs \\w{3} 8 Jan – \\w{3} 10 Jan ${YEAR} and is an unpublished draft`,
    ),
  );
  assertEquals(next.artefact.step_key, "trip_publish_ready");
  assertEquals((await cur(store)).subject_id, TRIP_ID);
  const final = await cur(store);
  assertEquals(final.answers.title?.source, "owner");
  assertEquals(final.answers.departure?.source, "owner");
  assertEquals(final.answers.destination?.source, "owner");
  assertEquals(final.step_states.trip_timezone.evidence?.observed, {
    timezone: "Africa/Lagos",
    source: "country",
  });
});

Deno.test("P8: a no-currency brand gets the payout-country question before any price; instalments are refused until payouts are on; packages come only from the owner", async () => {
  const world = freshWorld({ canSell: false, canPayout: false });
  const store = new MemoryStore();
  const proposed = await toCreateProposal(world, store);
  assert(proposed.kind === "propose");
  await confirm(
    world,
    store,
    "create_trip",
    () => world.trips.set(TRIP_ID, tripFrom(proposed.tool_args)),
    { event: { id: TRIP_ID } },
  );
  // Nothing was created beyond the trip itself: no package.
  assertEquals(world.trips.get(TRIP_ID)!.packages.length, 0);
  const kind = await answer(world, store, (r) => choice(r, "yes"));
  assert(kind.kind === "artefact");
  assertEquals(kind.artefact.step_key, "trip_package_kind");
  // P6's money step: payments aren't set up, the draft can still hold a
  // paid package (Seth's decision 3), so the owner keeps going.
  const money = await answer(world, store, (r) => choice(r, "paid"));
  assert(money.kind === "artefact");
  assertEquals(money.artefact.step_key, "money_gate");
  assertMatch(money.artefact.text, /You can still build this trip/);
  const country = await answer(world, store, (r) => choice(r, "continue"));
  assert(country.kind === "artefact");
  assertEquals(country.artefact.step_key, "trip_package_details");
  assertEquals(country.artefact.title, "Choose your payout country");
  assertMatch(country.artefact.text, /Prices need a currency/);
  assertNotMatch(country.artefact.text, /price, and how many spots/);
  const choices = (country.artefact.rendition?.blocks as {
    type: string;
    options?: { id: string; label: string }[];
  }[]).find((b) => b.type === "choices")!.options!;
  assert(choices.length > 1 && choices.length <= 40, "fits the card");
  assertEquals(choices[0].id, "NG", "the brand's own country first");

  const payout = await answer(world, store, (r) => form(r, { response: "NG" }));
  assert(payout.kind === "propose");
  assertEquals(payout.tool_name, "set_brand_payout_country");
  const priced = await confirm(world, store, "set_brand_payout_country", () => {
    world.brand.default_currency = "NGN";
  });
  assert(priced.kind === "artefact");
  assertMatch(priced.text, /prices are in NGN \(₦\)/);
  assertMatch(priced.artefact.text, /package called, its price, and how many spots/);

  // A wrong-currency price is asked about, never saved.
  const wrong = await answer(
    world,
    store,
    (r) => form(r, { response: "Shared room, £200, 12 spots" }),
  );
  assert(wrong.kind === "artefact");
  assertMatch(wrong.artefact.text, /You typed £200, but .* prices are in NGN/);

  const inst = await answer(
    world,
    store,
    (r) => form(r, { response: "Shared room, ₦250,000, 12 spots" }),
  );
  assert(inst.kind === "artefact");
  assertEquals(inst.artefact.step_key, "trip_installments");
  const gate = await answer(world, store, (r) => choice(r, "yes"));
  assert(gate.kind === "artefact");
  assertEquals(gate.artefact.step_key, "trip_installments_money");
  assertEquals(gate.artefact.title, "Before deposits and instalments");
  assertMatch(gate.artefact.text, /Deposits and instalments need payouts to reach the bank first/);
  const ids = gate.artefact.options.map((o) => o.id);
  assert(ids.includes("no_installments"), "Skip instalments for now");
  assert(!ids.includes("continue"), "no way past payouts for instalments");

  const save = await answer(world, store, (r) => choice(r, "no_installments"));
  assert(save.kind === "propose");
  assertEquals(save.tool_name, "manage_trip_tiers");
  assertEquals(save.tool_args, {
    event_id: TRIP_ID,
    expected_updated_at: "2026-11-02T10:00:00.000000+00:00",
    items: [{
      tier_name: "Shared room",
      price_cents: 25_000_000,
      capacity: 12,
      display_order: 0,
      tier_metadata: {},
    }],
  });
  const rows = rowsText(save.rows);
  assertMatch(rows, /Package: Shared room/);
  assertMatch(rows, /Price: NGN\s250,000/);
  assertMatch(rows, /Spots: 12/);
  assertMatch(rows, /Payment: In full when they book/);
  assertMatch(rows, /Heads-up: You can save a paid package now/);

  const refund = await confirm(world, store, "manage_trip_tiers", () => {
    world.trips.get(TRIP_ID)!.packages.push({
      ticket_type_id: "t1",
      name: "Shared room",
      price_cents: 25_000_000,
      capacity: 12,
      installments: false,
    });
  });
  assert(refund.kind === "artefact");
  assertMatch(refund.text, /Saved and checked: the package is on the draft/);
  assertEquals(refund.artefact.step_key, "trip_refund_policy");
  assertEquals(
    refund.artefact.options.map((o) => o.label),
    ["Flexible", "Standard", "Strict", "No refunds"],
  );
  const policy = await answer(world, store, (r) => choice(r, "standard"));
  assert(policy.kind === "propose");
  assertEquals(policy.tool_name, "update_trip");
  assertEquals((policy.tool_args.refund_policy as { kind: string }).kind, "standard");

  // Publish-readiness: the Host checks it still misses, in plain words.
  const blocked = await confirm(world, store, "update_trip", () => {
    world.trips.get(TRIP_ID)!.refund_policy = { kind: "standard" };
  });
  assert(blocked.kind === "artefact");
  assertEquals(blocked.artefact.step_key, "trip_publish");
  assertMatch(blocked.artefact.text, /Can't publish yet: it needs at least one itinerary day/);
  assert(!blocked.artefact.options.some((o) => o.id === "publish"));
  assertEquals(
    blocked.artefact.options.find((o) => o.id === "open")?.route,
    `/trip/${TRIP_ID}/edit`,
  );
  const done = await answer(world, store, (r) => choice(r, "later"));
  assertEquals(done.kind, "completed");
  if (done.kind !== "completed") return;
  assertMatch(done.text, /unpublished draft/);
  const final = await cur(store);
  assertEquals(final.answers.package?.source, "owner");
  assertEquals(final.step_states.trip_installments_money.state, "deferred");
});

Deno.test("P8: with payouts on, the owner's deposit and monthly payments ride on the package; publish only on the owner's word", async () => {
  const world = freshWorld({
    canSell: true,
    canPayout: true,
    brand: { default_timezone: "Africa/Lagos", country_code: "NG", default_currency: "NGN" },
  });
  const store = new MemoryStore();
  const proposed = await toCreateProposal(world, store);
  assert(proposed.kind === "propose");
  assertMatch(rowsText(proposed.rows), /Time zone: Lagos time, from your brand$/m);
  await confirm(
    world,
    store,
    "create_trip",
    () => world.trips.set(TRIP_ID, { ...tripFrom(proposed.tool_args), day_count: 2 }),
    { event: { id: TRIP_ID } },
  );
  await answer(world, store, (r) => choice(r, "yes"));
  const details = await answer(world, store, (r) => choice(r, "paid"));
  assert(details.kind === "artefact");
  assertEquals(details.artefact.step_key, "trip_package_details");
  await answer(world, store, (r) => form(r, { response: "Shared room, ₦250,000, 12 travellers" }));
  const plan = await answer(world, store, (r) => choice(r, "yes"));
  assert(plan.kind === "artefact");
  assertEquals(plan.artefact.step_key, "trip_installment_plan");
  const save = await answer(
    world,
    store,
    (r) => form(r, { response: "30% deposit, then 2 monthly payments" }),
  );
  assert(save.kind === "propose");
  const items = save.tool_args.items as Record<string, unknown>[];
  assertEquals(items[0].tier_metadata, {
    installments: {
      deposit_pct: 30,
      installments: [
        { ordinal: 1, pct: 35, days_after_booking: 30 },
        { ordinal: 2, pct: 35, days_after_booking: 60 },
      ],
    },
  });
  assertMatch(rowsText(save.rows), /Payment: 30% deposit, then 2 monthly payments/);
  await confirm(world, store, "manage_trip_tiers", () => {
    world.trips.get(TRIP_ID)!.packages.push({
      ticket_type_id: "t1",
      name: "Shared room",
      price_cents: 25_000_000,
      capacity: 12,
      installments: true,
    });
  });
  await answer(world, store, (r) => choice(r, "flexible"));
  const ready = await confirm(world, store, "update_trip", () => {
    world.trips.get(TRIP_ID)!.refund_policy = { kind: "flexible" };
  });
  // I-ARI-NEVER-AUTO-PUBLISH: the confirm brings a question, not a publish.
  assert(ready.kind === "artefact");
  assertEquals(ready.artefact.step_key, "trip_publish");
  assertEquals(ready.artefact.options.map((o) => o.id), ["publish", "later"]);
  const publish = await answer(world, store, (r) => choice(r, "publish"));
  assert(publish.kind === "propose");
  assertEquals(publish.tool_name, "publish_trip");
  assertEquals(publish.tool_args, {
    event_id: TRIP_ID,
    expected_updated_at: "2026-11-02T10:00:00.000000+00:00",
  });
});

// ── Adversarial ─────────────────────────────────────────────────────────────

Deno.test("P8: a past or unreadable range is refused with nothing saved", async () => {
  const world = freshWorld();
  const store = new MemoryStore();
  const run = await startRun(store, "Create a trip called “Harmattan Escape”");
  const dates = await runFlowStep({ store, probes: probesFor(world) }, {
    run,
    trigger: "turn",
    brandName: BRAND_NAME,
  });
  assert(dates.kind === "artefact");
  assertEquals(dates.artefact.step_key, "trip_dates", "curly quotes are a title");
  assertEquals((await cur(store)).step_states.trip_title.evidence?.observed, "Harmattan Escape");
  const past = await answer(
    world,
    store,
    (r) => form(r, { response: `1 to 2 January ${new Date().getUTCFullYear() - 1}` }),
  );
  assert(past.kind === "artefact");
  assertEquals(past.artefact.step_key, "trip_dates");
  assertMatch(past.artefact.text, /from today on.*nothing was saved/);
  assertEquals((await cur(store)).answers.dates, undefined);
});

Deno.test("P8: no package, no UTC and no capacity can come from Ari's side", () => {
  const facts = {
    title: "Lagos Long Weekend",
    dates: { start_date: `${YEAR}-01-08`, end_date: `${YEAR}-01-10` },
    timezone: null,
    timezone_source: null,
    departure: ABUJA,
    destination: LAGOS,
  };
  assertEquals(createTripArgs(BRAND, facts), null, "no zone, no proposal");
  const args = createTripArgs(BRAND, { ...facts, timezone: "Africa/Lagos" })!;
  for (const key of ["capacity", "max_guests", "tiers", "packages", "price_cents"]) {
    assertEquals(key in args, false, key);
  }
  // A package needs the owner's name and spots; nothing is filled in.
  assertEquals(parsePackageAnswer("₦250,000, 12 spots", true)?.name, null);
  assertEquals(parsePackageAnswer("Shared room, ₦250,000", true), null);
  assertEquals(parsePackageAnswer("Shared room, no limit", false)?.capacity, null);
  assertEquals(parseInstallmentPlan("a deposit please"), null);
  assertEquals(
    tripPublishGaps({
      id: TRIP_ID,
      title: "X",
      status: "draft",
      timezone: "Africa/Lagos",
      updated_at: "",
      start_at: null,
      end_at: null,
      departure: { label: "Typed only", lat: null, lng: null },
      destination: null,
      refund_policy: null,
      day_count: 0,
      packages: [],
    }),
    [
      "its dates",
      "where it leaves from",
      "where it's going",
      "at least one itinerary day",
      "a package",
    ],
  );
});

Deno.test("P8 bug: a price with a thousands separator is the price the owner typed", () => {
  // The event card's own naira example is "₦2,000"; it used to read as ₦2.00
  // and then be refused as below the minimum (or saved 1,000 times too low).
  assertEquals(parseTicketAnswer("₦2,000, 60 tickets", true)?.price_major, 2000);
  assertEquals(parseTicketAnswer("£1,250.50, 10 tickets", true)?.price_major, 1250.5);
  assertEquals(parseTicketAnswer("12,5 euros, 30 tickets", true)?.price_major, 12.5);
  assertEquals(parsePackageAnswer("Shared room, ₦250,000, 12 spots", true)?.price_major, 250000);
});

Deno.test("P8: the trip's name is the owner's words, without the dates", () => {
  assertEquals(
    tripTitleFromIntent("Create a trip called Lagos Weekend from 8 to 10 January"),
    "Lagos Weekend",
  );
  assertEquals(tripTitleFromIntent("Create a trip called “Harmattan Escape”"), "Harmattan Escape");
  assertEquals(tripTitleFromIntent(INTENT), null, "no name given, none made up");
});

Deno.test("P8: every trip-create refusal is a plain, final 'nothing was saved' (never 'verifying')", () => {
  for (
    const code of [
      "trip_timezone_required",
      "trip_dates_required",
      "trip_dates_invalid",
      "trip_date_past",
      "trip_place_invalid",
      "trip_refund_policy_draft_only",
    ]
  ) {
    const refusal = ariDomainRefusal(`ari_execute_trip_operation: ${code}`);
    assert(refusal, `${code} must be a typed refusal`);
    assertEquals(refusal.code, "DOMAIN_REFUSED");
    assertMatch(refusal.message, /Nothing was saved\.$/);
    assertNotMatch(refusal.message, /_/);
  }
});

Deno.test("P8 (D-16): agent-chat's read-only pre-pass never holds a write", async () => {
  const source = await Deno.readTextFile(
    new URL("supabase/functions/agent-chat/index.ts", ROOT),
  );
  assertNotMatch(source, /tripCreationCall|buildAriTripCreationCall/);
  const start = source.indexOf("const initialCalls =");
  assert(start > 0);
  const end = source.indexOf(";\n", start);
  const block = source.slice(start, end);
  const names = [...block.matchAll(/name:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert(names.length >= 4, `found ${names.join(",")}`);
  for (const name of names) {
    assert(
      isReadOnlyAgentToolCall(name, { action: "get" }),
      `${name} in initialCalls must be a read`,
    );
  }
  const planner = await Deno.readTextFile(
    new URL("supabase/functions/_shared/agentTripPlanner.ts", ROOT),
  );
  assertNotMatch(planner, /name:\s*"create_trip"/, "the planner only parses");
});
