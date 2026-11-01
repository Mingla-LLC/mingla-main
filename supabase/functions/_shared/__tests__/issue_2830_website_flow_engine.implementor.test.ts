// Issue #2830 P4 — Website setup on the Ari flow engine (implementor happy
// path + adversarial).
//
// MINGLA-INVARIANT: I-ARI-WEBSITE-OWNER-APPROVES-PLAN | issue #2830 | Ari never approves the Website plan: the approve part is only a review handoff to /brand/<id>/website/plan?part=approve, and no Website flow answer can produce a plan-approval write.
// MINGLA-INVARIANT: I-ARI-WEBSITE-BUILD-GATED | issue #2830 | The Website build is proposed only when the plan's first five parts, the brand-context audit and the owner's approval are all true, through ONE protected create_site_draft proposal that reuses the brand's site; a built site is verified by reading the site back, never a second website.
// MINGLA-INVARIANT: I-ARI-WEBSITE-PUBLISH-EXACT-DIGEST | issue #2830 | A Website publish is proposed only after the owner asks for it, bound to the exact revision and digest that were validated and design-checked; a changed draft is re-checked, never published.
//
// Drives the shipped runner + Website flow with an in-memory run store (the
// SQL rules: lease, compare-and-swap, evidence) and a fake Website world
// standing in for the live plan / site / validation / design-check reads.
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_2830_website_flow_engine.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  classifyFlowText,
  runFlowStep,
  type RunnerOutcome,
  textChoiceFor,
} from "../ariFlows/runner.ts";
import type { FlowStore } from "../ariFlows/store.ts";
import { FlowEngineUnavailable } from "../ariFlows/store.ts";
import type {
  BrandReadiness,
  FlowAnswerValues,
  FlowProbeDeps,
  FlowRun,
  FlowStepRecord,
} from "../ariFlows/types.ts";
import { findFlowDefinition } from "../ariFlows/index.ts";
import {
  publishArgumentsDigest,
  WEBSITE_BRAND_FIELD_ORDER,
  WEBSITE_DEFAULT_DESIGN,
  WEBSITE_SETUP_FLOW,
  websiteTextAnswer,
} from "../ariFlows/websiteSetup.ts";
import {
  decideFlowTurn,
  flowSideFailureText,
  isWebsiteSetupRequest,
  parseFlowAnswer,
} from "../ariFlows/edge.ts";
import { buildProposalPresentation } from "../ariPresentation/registry.ts";
import { verifiedProposalArgs } from "../agentTicketPricing.ts";
import { flowNextAfterConfirm } from "../../agent-confirm-action/confirmNext.ts";

const ROOT = new URL("../../../../", import.meta.url);
const OWNER = "11111111-1111-4111-8111-111111111111";
const MATE = "44444444-4444-4444-8444-444444444444";
const BRAND = "22222222-2222-4222-8222-222222222222";
const CHAT = "33333333-3333-4333-8333-333333333333";
const SITE = "66666666-6666-4666-8666-666666666666";
const EVENT_ID = "55555555-5555-4555-8555-555555555555";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

// ── A fake Website world: the canonical reads the flow probes ──────────────
interface Field {
  key: string;
  label: string;
  requirement: "required" | "recommended" | "optional";
  state: string;
  value: unknown;
}

interface World {
  revision: number;
  fields: Map<string, Field>;
  approved: boolean;
  site: { id: string } | null;
  built: boolean;
  published: boolean;
  firstOfferingDone: boolean;
  draftDigest: string;
  homeRevision: string;
  warnings: { label: string; message: string }[];
  checkedDigests: string[];
  /** Digest the design checks report (a draft that changes mid-check). */
  checksDigestOverride: string | null;
  validationFails: string | null;
  events: Set<string>;
  openProposal: boolean;
  reads: string[];
}

const FIELD_DEFS: Array<[string, string, Field["requirement"]]> = [
  ["name", "Brand name", "required"],
  ["description", "Brand story", "required"],
  ["offerings_selected", "What you offer", "required"],
  ["design_key", "Website design", "required"],
  ["story.who", "Who comes with you", "required"],
  ["story.why", "Why they choose you", "required"],
  ["story.main_action", "Main visitor action", "required"],
  ["approved_plan", "Owner-approved plan", "required"],
  ["venue_descriptor", "Venue description", "optional"],
  ["contact_email", "Contact email", "recommended"],
  ["contact_phone", "Contact phone", "recommended"],
  ["address", "Address", "recommended"],
  ["city_country", "City and country", "recommended"],
  ["social_links", "Public website or social link", "recommended"],
  ["profile_photo", "Brand logo", "recommended"],
  ["cover_media", "Cover media", "recommended"],
  ["theme", "Mingla page theme", "recommended"],
];

const VALUES: Record<string, unknown> = {
  name: "Lantern Supper Club",
  description: "Candlelit suppers in London.",
  offerings_selected: ["events"],
  design_key: "voyage",
  "story.who": "Friends",
  "story.why": "Good food",
  "story.main_action": "Come to an event",
  approved_plan: { ok: true },
  contact_email: "hello@lantern.test",
  contact_phone: "+447700900123",
  address: "1 Shoreditch High St",
  city_country: { city: "London", country_code: "GB" },
  social_links: { social_links: { instagram: "https://instagram.com/x" } },
  profile_photo: "https://cdn.test/logo.png",
  cover_media: "https://cdn.test/cover.png",
  theme: { color: "#eb7825", font: "fraunces", animation: "shimmer_reveal" },
};

function world(missing: string[] = [], overrides: Partial<World> = {}): World {
  const fields = new Map<string, Field>();
  for (const [key, label, requirement] of FIELD_DEFS) {
    const isMissing = missing.includes(key);
    fields.set(key, {
      key,
      label,
      requirement,
      state: isMissing ? "missing" : "verified",
      value: isMissing ? null : VALUES[key] ?? null,
    });
  }
  return {
    revision: 7,
    fields,
    approved: !missing.includes("approved_plan"),
    site: null,
    built: false,
    published: false,
    firstOfferingDone: false,
    draftDigest: DIGEST_A,
    homeRevision: "12",
    warnings: [],
    checkedDigests: [],
    checksDigestOverride: null,
    validationFails: null,
    events: new Set(),
    openProposal: false,
    reads: [],
    ...overrides,
  };
}

const settled = (w: World, key: string) =>
  ["verified", "not_applicable"].includes(w.fields.get(key)!.state);

function planOf(w: World) {
  const contextComplete = [...w.fields.values()].every((field) =>
    field.requirement === "optional" ||
    ["verified", "not_applicable"].includes(field.state)
  );
  const done: Record<string, boolean> = {
    offer: settled(w, "offerings_selected"),
    brand: settled(w, "name") && settled(w, "description"),
    look: settled(w, "design_key"),
    story: settled(w, "story.who") && settled(w, "story.why") &&
      settled(w, "story.main_action"),
    approve: w.approved,
    // The plan's tick alone; the flow must still read the site back.
    build: w.built,
    first_offering: w.firstOfferingDone,
    publish: w.published,
  };
  return {
    plan: { revision: w.revision, story: {} },
    status: {
      parts: Object.entries(done).map(([key, value]) => ({ key, done: value })),
    },
    completeness: {
      context_revision: "c".repeat(64),
      context_complete: contextComplete && w.approved,
      fields: [...w.fields.values()].map((field) => ({ ...field })),
    },
  };
}

function readiness(): BrandReadiness {
  return {
    brand_id: BRAND,
    action: "draft_save",
    can_proceed: true,
    context_revision: "r",
    evaluated_at: "now",
    counts: { blocking: 0, can_wait: 0, done: 0, deferred: 0 },
    money: {
      can_sell: false,
      can_be_paid_out: false,
      sell_reason: "no_provider",
      payout_reason: "no_bank",
      rail: "none",
      currency: "GBP",
      terms_accepted_by_caller: true,
    },
    items: [],
  };
}

function probes(w: World): FlowProbeDeps {
  return {
    readiness: () => Promise.resolve(readiness()),
    subjectExists: (_table, id) => Promise.resolve(w.events.has(id)),
    setAside: () => Promise.resolve("brand"),
    hasOpenProposal: () => Promise.resolve(w.openProposal),
    readTool(name, args) {
      w.reads.push(name);
      switch (name) {
        case "get_site_plan":
          return Promise.resolve(planOf(w));
        case "get_brand_site":
          return Promise.resolve(
            w.site
              ? { id: w.site.id, status: "draft" }
              : { website_state: "not_set_up" },
          );
        case "validate_site_draft":
          if (w.validationFails) {
            return Promise.reject(new Error(w.validationFails));
          }
          assertEquals(args.site_id, w.site?.id);
          return Promise.resolve({
            valid: true,
            home_revision: w.homeRevision,
            draft_digest: w.draftDigest,
          });
        case "run_site_design_checks": {
          const digest = w.checksDigestOverride ?? w.draftDigest;
          w.checkedDigests.push(digest);
          return Promise.resolve({
            draft_digest: digest,
            warning_count: w.warnings.length,
            checks: w.warnings.map((warning) => ({
              key: "words",
              label: warning.label,
              status: "warn",
              items: [{ message: warning.message }],
            })),
          });
        }
        default:
          return Promise.reject(new Error(`unexpected read ${name}`));
      }
    },
  };
}

// ── In-memory store with the SQL rules (lease, CAS, evidence, one per brand)
type StoredRun = FlowRun & {
  started_by: string;
  lease_token: string | null;
  lease_expires: number;
};

class MemoryStore implements FlowStore {
  runs: Map<string, StoredRun>;
  clock = 1_000;
  calls: string[] = [];
  constructor(public userId: string, shared?: MemoryStore) {
    this.runs = shared?.runs ?? new Map();
  }
  private view(run: StoredRun): FlowRun {
    const { started_by, lease_token: _t, lease_expires: _e, ...rest } = run;
    return {
      ...structuredClone(rest),
      started_by_me: started_by === this.userId,
      started_by_name: started_by === OWNER ? "Ada Owner" : "Sam Mate",
      lease_held: false,
      lease_held_by_me: false,
      lease_owner_name: null,
    } as FlowRun;
  }
  start(args: Parameters<FlowStore["start"]>[0]) {
    this.calls.push("start");
    for (const run of this.runs.values()) {
      const live = !["completed", "cancelled", "expired"].includes(run.status);
      if (
        live && run.flow_key === args.flowKey &&
        (run.conversation_id === args.conversationId ||
          (args.concurrency === "one_per_brand" &&
            run.brand_id === args.brandId))
      ) {
        return Promise.resolve({
          created: false,
          owned_by_other: run.started_by !== this.userId,
          owner_display_name: "Ada Owner",
          run: this.view(run),
        });
      }
    }
    const run: StoredRun = {
      id: crypto.randomUUID(),
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
      lease_expires: 0,
    };
    this.runs.set(run.id, run);
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
    if (run.lease_expires > this.clock && run.lease_token !== token) {
      return Promise.resolve({
        ok: false,
        reason: "busy" as const,
        owner_display_name: "Ada Owner",
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
    if (run.lease_token !== token) {
      return Promise.reject(new Error("flow_lease_not_held"));
    }
    if (rev !== run.revision) {
      return Promise.reject(new Error("flow_revision_conflict"));
    }
    const states = (patch.step_states ?? {}) as Record<string, FlowStepRecord>;
    for (const [key, value] of Object.entries(states)) {
      if (value.state === "done" && (!value.evidence?.probe)) {
        return Promise.reject(new Error(`flow_evidence_required:${key}`));
      }
    }
    if (
      patch.status === "completed" &&
      !(patch.completion_evidence as { probe?: string } | undefined)?.probe
    ) {
      return Promise.reject(new Error("flow_evidence_required:completion"));
    }
    Object.assign(run, {
      ...patch,
      step_states: { ...run.step_states, ...states },
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

// ── Helpers ────────────────────────────────────────────────────────────────
async function startRun(store: MemoryStore): Promise<FlowRun> {
  const def = findFlowDefinition("website_setup")!;
  return (await store.start({
    brandId: BRAND,
    flowKey: def.key,
    flowVersion: def.version,
    concurrency: def.concurrency,
    conversationId: CHAT,
    answers: {},
  })).run;
}

async function current(store: MemoryStore): Promise<FlowRun> {
  return (await store.getForConversation(CHAT))!;
}

function step(
  w: World,
  store: MemoryStore,
  run: FlowRun,
  input: Partial<Parameters<typeof runFlowStep>[1]>,
): Promise<RunnerOutcome> {
  return runFlowStep({ store, probes: probes(w) }, {
    run,
    trigger: "turn",
    brandName: "Lantern Supper Club",
    ...input,
  });
}

function choose(run: FlowRun, choice: string) {
  return {
    trigger: "answer" as const,
    answer: {
      run_id: run.id,
      step_key: run.current_step_key!,
      question_id: run.current_question_id!,
      choice_id: choice,
      display_text: choice,
    },
  };
}

function form(run: FlowRun, values: Partial<FlowAnswerValues>) {
  return {
    trigger: "answer" as const,
    answer: {
      run_id: run.id,
      step_key: run.current_step_key!,
      question_id: run.current_question_id!,
      choice_id: "answer",
      display_text: values.response || "answer",
      values: { choices: [], country: null, response: "", ...values },
    },
  };
}

/** What the confirmed write does to the world (stands in for the executor). */
function applyConfirmed(
  w: World,
  tool: string,
  args: Record<string, unknown>,
): unknown {
  w.openProposal = false;
  const verify = (key: string, value: unknown) => {
    const field = w.fields.get(key)!;
    field.state = "verified";
    field.value = value;
  };
  switch (tool) {
    case "update_brand_context": {
      const patch = args.patch as Record<string, unknown> ?? {};
      for (const [key, value] of Object.entries(patch)) verify(key, value);
      for (
        const exception of (args.exceptions as { field_key: string }[] ?? [])
      ) {
        w.fields.get(exception.field_key)!.state = "not_applicable";
      }
      break;
    }
    case "save_site_plan_design":
      verify("design_key", args.design_key);
      break;
    case "save_site_plan_answers": {
      const answers = args.answers as Record<string, unknown>;
      if (answers.offerings_selected) {
        verify("offerings_selected", answers.offerings_selected);
      }
      const story = (answers.story ?? {}) as Record<string, unknown>;
      for (const key of ["who", "why", "main_action"]) {
        if (story[key]) verify(`story.${key}`, story[key]);
      }
      break;
    }
    case "create_site_draft":
      w.site = w.site ?? { id: SITE };
      w.built = true;
      return { website_state: "draft", site_id: w.site.id, pages: ["home"] };
    case "publish_site":
      if (
        args.source_digest === w.draftDigest &&
        args.expected_revision === w.homeRevision
      ) w.published = true;
      return { status: "executing" };
    case "create_event":
      w.events.add(EVENT_ID);
      return { event: { id: EVENT_ID } };
  }
  w.revision += 1;
  return { ok: true };
}

async function confirm(
  w: World,
  store: MemoryStore,
  outcome: RunnerOutcome,
): Promise<RunnerOutcome> {
  assertEquals(outcome.kind, "propose");
  const proposal = outcome as Extract<RunnerOutcome, { kind: "propose" }>;
  const result = applyConfirmed(w, proposal.tool_name, proposal.tool_args);
  return await step(w, store, await current(store), {
    trigger: "confirm",
    confirmed: { tool_name: proposal.tool_name, result },
  });
}

function asArtefact(outcome: RunnerOutcome) {
  assert(
    outcome.kind === "artefact" || outcome.kind === "completed",
    `expected a card, got ${outcome.kind}`,
  );
  return outcome as Extract<RunnerOutcome, { kind: "artefact" }>;
}

// ── Happy path ─────────────────────────────────────────────────────────────

Deno.test("P4 happy: brand-details phone via the chip → one proposal → confirm → readback receipt and the next gap in the same response", async () => {
  const w = world(["contact_phone", "contact_email"]);
  const store = new MemoryStore(OWNER);
  const first = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(first.artefact.step_key, "brand");
  assertEquals(first.artefact.answer_mode, "form");
  assertEquals(first.artefact.title, "Contact email");
  // Email first (form order), then the phone.
  let run = await current(store);
  const emailProposal = await step(
    w,
    store,
    run,
    form(run, { response: "hello@lantern.test" }),
  );
  const afterEmail = asArtefact(await confirm(w, store, emailProposal));
  assertMatch(afterEmail.text, /^Saved\. Contact email: hello@lantern\.test\./);
  assertEquals(afterEmail.artefact.title, "Contact phone");
  // The phone card is the Brand details control: chip + local number.
  const rendition = afterEmail.artefact.rendition as {
    rendition_id: string;
    eyebrow: string;
    blocks: Array<{ type: string; field?: Record<string, unknown> }>;
  };
  assertEquals(rendition.rendition_id, afterEmail.artefact.artefact_id);
  assertMatch(rendition.eyebrow, /Part 2 of 8 · Your brand details/);
  const input = rendition.blocks.find((block) => block.type === "input");
  assertEquals(input?.field?.kind, "phone");
  assertEquals(input?.field?.countryIso, "GB");
  assert(
    !rendition.blocks.some((block) => block.type === "metrics"),
    "one progress counter only",
  );

  run = await current(store);
  const phoneProposal = await step(
    w,
    store,
    run,
    form(run, { country: "GB", response: "07700 900123" }),
  );
  assertEquals(phoneProposal.kind, "propose");
  const proposal = phoneProposal as Extract<RunnerOutcome, { kind: "propose" }>;
  assertEquals(proposal.tool_name, "update_brand_context");
  assertEquals(
    (proposal.tool_args.patch as Record<string, unknown>).contact_phone,
    "+447700900123",
  );
  assertEquals((await current(store)).status, "awaiting_approval");
  const after = asArtefact(await confirm(w, store, phoneProposal));
  // Receipt from the readback (the plan now holds it), then the next part.
  assertMatch(after.text, /^Saved\. Contact phone: \+44 7700 900123\./);
  assertEquals(after.artefact.step_key, "build");
});

Deno.test("P4 happy: confirm-next for a Website run is one assistant row — no owner-authored continuation", async () => {
  const w = world(["contact_email"]);
  const store = new MemoryStore(OWNER);
  await step(w, store, await startRun(store), {});
  const run = await current(store);
  const proposed = await step(
    w,
    store,
    run,
    form(run, { response: "hello@lantern.test" }),
  ) as Extract<RunnerOutcome, { kind: "propose" }>;
  applyConfirmed(w, proposed.tool_name, proposed.tool_args);
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
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
  const result = await flowNextAfterConfirm({
    // deno-lint-ignore no-explicit-any
    userClient: {} as any,
    // deno-lint-ignore no-explicit-any
    service: service as any,
    userId: OWNER,
    conversationId: CHAT,
    brand: { id: BRAND, name: "Lantern Supper Club" },
    confirmed: { tool_name: "update_brand_context", result: { ok: true } },
    promptVersion: "p",
    modelVersion: "m",
    enabled: true,
    store,
    probes: probes(w),
  });
  assert(result.next, "confirm must carry the next step");
  assertMatch(
    result.next!.text,
    /Saved\. Contact email: hello@lantern\.test\./,
  );
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].row.role, "assistant");
  assertNotMatch(JSON.stringify(inserted), /Continue Website setup/);
});

Deno.test("P4 happy: walking all eight parts ends with a published Website and an evidence-backed summary", async () => {
  const w = world([
    "offerings_selected",
    "design_key",
    "story.who",
    "approved_plan",
  ]);
  w.fields.get("offerings_selected")!.value = null;
  const store = new MemoryStore(OWNER);
  let out = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(out.artefact.step_key, "offer");
  let run = await current(store);
  out = asArtefact(
    await confirm(
      w,
      store,
      await step(w, store, run, form(run, { choices: ["Events"] })),
    ),
  );
  assertMatch(out.text, /Saved\. What you offer: Events\./);
  assertEquals(out.artefact.step_key, "look");
  run = await current(store);
  out = asArtefact(
    await confirm(
      w,
      store,
      await step(w, store, run, form(run, { choices: ["Voyage"] })),
    ),
  );
  assertEquals(out.artefact.step_key, "story");
  run = await current(store);
  out = asArtefact(
    await confirm(
      w,
      store,
      await step(w, store, run, form(run, { response: "Friends and family" })),
    ),
  );
  // Approval is the owner's: a handoff to the plan's approval part.
  assertEquals(out.artefact.step_key, "approve");
  assertEquals(out.artefact.kind, "handoff");
  w.approved = true;
  w.fields.get("approved_plan")!.state = "verified";
  run = await current(store);
  out = asArtefact(await step(w, store, run, choose(run, "check")));
  assertMatch(out.text, /I checked; your plan is approved\./);
  assertEquals(out.artefact.step_key, "build");
  run = await current(store);
  out = asArtefact(
    await confirm(w, store, await step(w, store, run, choose(run, "build"))),
  );
  assertMatch(out.text, /draft pages are built and I've checked they're saved/);
  assertEquals(out.artefact.step_key, "first_offering");
  run = await current(store);
  out = asArtefact(await step(w, store, run, choose(run, "not_now")));
  assertEquals(out.artefact.step_key, "publish");
  run = await current(store);
  const done = await confirm(
    w,
    store,
    await step(w, store, run, choose(run, "publish")),
  );
  assertEquals(done.kind, "completed");
  assertMatch((done as { text: string }).text, /Your Website is live/);
  const final = await current(store);
  assertEquals(final.status, "completed");
  for (
    const key of [
      "offer",
      "brand",
      "look",
      "story",
      "approve",
      "build",
      "publish",
    ]
  ) {
    assertEquals(final.step_states[key]?.state, "done", key);
    assert(final.step_states[key]?.evidence?.probe, `${key} has evidence`);
  }
  assertEquals(final.step_states.first_offering?.state, "skipped");
});

// ── Adversarial: approval, build, one site ─────────────────────────────────

Deno.test("P4 adversarial: Ari never approves the plan — the approve part is only a review handoff", async () => {
  const w = world(["approved_plan"]);
  const store = new MemoryStore(OWNER);
  const out = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(out.artefact.step_key, "approve");
  assertEquals(out.artefact.kind, "handoff");
  assertEquals(out.artefact.answer_mode, undefined);
  assertEquals(
    out.artefact.options.find((o) => o.id === "open")?.route,
    `/brand/${BRAND}/website/plan?part=approve`,
  );
  assertEquals(
    out.artefact.options.map((o) => o.id).sort(),
    ["check", "open"],
  );
  let run = await current(store);
  // A forged form answer to the approval card changes nothing.
  const forged = await step(w, store, run, form(run, { response: "approve" }));
  assertEquals(forged.kind, "stale");
  // "I've approved it" with nothing approved: it says so; the card stays.
  run = await current(store);
  const claim = await step(w, store, run, {
    trigger: "turn",
    ownerText: "I've approved it",
  });
  assertEquals(claim.kind, "notice");
  assertMatch((claim as { text: string }).text, /isn't there yet/);
  assertEquals(
    (await current(store)).current_artefact?.artefact_id,
    out.artefact.artefact_id,
  );
  // No Website step can ever propose an approval write.
  const source = Deno.readTextFileSync(
    new URL("supabase/functions/_shared/ariFlows/websiteSetup.ts", ROOT),
  );
  assertNotMatch(source, /tool_name:\s*"[^"]*approv/);
  assertNotMatch(source, /approve:\s*true,\s*\n?\s*approved_plan:\s*\{/);
});

Deno.test("P4 adversarial: no draft before approval; build refuses until setup, context and approval are true", async () => {
  const build = WEBSITE_SETUP_FLOW.steps.find((s) => s.key === "build")!;
  const w = world(["approved_plan", "cover_media"]);
  const store = new MemoryStore(OWNER);
  const run = await startRun(store);
  const ctx = {
    run,
    def: WEBSITE_SETUP_FLOW,
    deps: probes(w),
    brandName: "L",
    state: undefined,
  };
  const probe = await build.probe(ctx);
  assert(!probe.done && "ask" in probe);
  assertMatch(probe.ask.text, /can't build your pages yet/);
  assertMatch(probe.ask.text, /approve the plan/);
  assertMatch(probe.ask.text, /cover media/);
  assert(!probe.ask.options.some((o) => o.id === "build"));
  // Even a forged "build" answer proposes nothing while anything is open.
  const forced = await build.onAnswer!(ctx, "build");
  assertEquals(forced?.propose, undefined);
  // The runner never reaches build before approval.
  const out = asArtefact(await step(w, store, run, {}));
  assertEquals(out.artefact.step_key, "brand"); // cover first
  const order = WEBSITE_SETUP_FLOW.steps.map((s) => s.key);
  assertEquals(order, [
    "offer",
    "brand",
    "look",
    "story",
    "approve",
    "build",
    "first_offering",
    "publish",
  ]);
  assertEquals(build.depends_on, ["approve"]);
});

Deno.test("P4 adversarial: 'not now' on the cover proceeds, then build lists it and 'Add cover media' re-asks it", async () => {
  const w = world(["cover_media"]);
  const store = new MemoryStore(OWNER);
  const first = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(first.artefact.kind, "handoff");
  assert(first.artefact.options.some((o) => o.id === "not_now"));
  let run = await current(store);
  const skipped = asArtefact(await step(w, store, run, choose(run, "not_now")));
  assertMatch(skipped.text, /stays on your Website to-do list/);
  assertEquals(skipped.artefact.step_key, "build");
  assertMatch(skipped.artefact.text, /Still needed: cover media/);
  run = await current(store);
  const back = asArtefact(
    await step(w, store, run, choose(run, "fix:cover_media")),
  );
  assertEquals(back.artefact.step_key, "brand");
  assertEquals(back.artefact.handoff?.item_key, "cover_media");
});

Deno.test("P4 adversarial: required brand fields never offer 'not now'", async () => {
  const w = world(["name"]);
  const store = new MemoryStore(OWNER);
  const out = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(out.artefact.title, "Brand name");
  assertEquals(out.artefact.options.length, 0);
});

Deno.test("P4 adversarial: exactly one website — build proposes once, is verified by reading the site back, and is never offered again", async () => {
  const w = world();
  const store = new MemoryStore(OWNER);
  const out = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(out.artefact.step_key, "build");
  let run = await current(store);
  const proposed = await step(w, store, run, choose(run, "build"));
  assertEquals(proposed.kind, "propose");
  const p = proposed as Extract<RunnerOutcome, { kind: "propose" }>;
  assertEquals(p.tool_name, "create_site_draft");
  assertEquals(Object.keys(p.tool_args).sort(), ["brand_id", "cites", "why"]);
  // The tick alone is not proof: a built plan with no site is not done.
  w.built = true;
  const noSite = asArtefact(
    await step(w, store, await current(store), {
      trigger: "confirm",
      confirmed: { tool_name: "create_site_draft", result: {} },
    }),
  );
  assertEquals(noSite.artefact.step_key, "build");
  run = await current(store);
  const again = await confirm(
    w,
    store,
    await step(w, store, run, choose(run, "build")),
  );
  assertEquals(asArtefact(again).artefact.step_key, "first_offering");
  // Re-reading never proposes another build.
  run = await current(store);
  const later = await step(w, store, run, { trigger: "resume" });
  assert(later.kind !== "propose");
  assertEquals((await current(store)).step_states.build?.state, "done");
  assertEquals(
    (await current(store)).step_states.build?.evidence?.observed,
    { build: true, site_id: SITE },
  );
});

// ── Adversarial: publish ───────────────────────────────────────────────────

function readyToPublish(overrides: Partial<World> = {}): World {
  return world([], {
    site: { id: SITE },
    built: true,
    firstOfferingDone: true,
    ...overrides,
  });
}

Deno.test("P4 adversarial: publish only after the owner asks, bound to the exact validated and design-checked digest", async () => {
  const w = readyToPublish();
  const store = new MemoryStore(OWNER);
  const card = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(card.artefact.step_key, "publish");
  assertEquals(card.artefact.title, "Ready to publish");
  // Showing the card proposed nothing; the checks ran on this exact draft.
  assertEquals(w.checkedDigests, [DIGEST_A]);
  const run = await current(store);
  const proposed = await step(w, store, run, choose(run, "publish"));
  assertEquals(proposed.kind, "propose");
  const p = proposed as Extract<RunnerOutcome, { kind: "propose" }>;
  assertEquals(p.tool_name, "publish_site");
  assertEquals(p.tool_args.site_id, SITE);
  assertEquals(p.tool_args.source_digest, DIGEST_A);
  assertEquals(p.tool_args.expected_revision, "12");
  assertEquals(
    p.tool_args.arguments_digest,
    await publishArgumentsDigest({
      siteId: SITE,
      expectedRevision: "12",
      sourceDigest: DIGEST_A,
    }),
  );
  assert(w.checkedDigests.every((digest) => digest === DIGEST_A));
  assertEquals(w.published, false, "nothing publishes before the confirm");
});

Deno.test("P4 adversarial: a draft that changed since the check is re-checked, never published", async () => {
  const w = readyToPublish();
  const store = new MemoryStore(OWNER);
  await step(w, store, await startRun(store), {});
  w.draftDigest = DIGEST_B; // someone edited the draft
  const run = await current(store);
  const out = asArtefact(await step(w, store, run, choose(run, "publish")));
  assertMatch(
    out.text,
    /changed since I checked it, so I didn't prepare a publish/,
  );
  assertEquals(out.artefact.title, "Ready to publish");
  assertEquals(
    (await current(store)).step_states.publish?.data?.source_digest,
    DIGEST_B,
  );
});

Deno.test("P4 adversarial: checks on a different digest, a failed validation and warnings are shown, not guessed past", async () => {
  const mismatch = readyToPublish({ checksDigestOverride: DIGEST_B });
  let store = new MemoryStore(OWNER);
  let card = asArtefact(await step(mismatch, store, await startRun(store), {}));
  assertMatch(card.text, /changed while I was checking it/);
  assert(!card.artefact.options.some((o) => o.id === "publish"));

  const invalid = readyToPublish({
    validationFails: "The home page has no title.",
  });
  store = new MemoryStore(OWNER);
  card = asArtefact(await step(invalid, store, await startRun(store), {}));
  assertMatch(
    card.text,
    /The home page has no title\. Nothing was published\./,
  );
  assert(!card.artefact.options.some((o) => o.id === "publish"));

  const warned = readyToPublish({
    warnings: [{ label: "Words", message: "Your About page is empty." }],
  });
  store = new MemoryStore(OWNER);
  card = asArtefact(await step(warned, store, await startRun(store), {}));
  assertMatch(card.text, /Words: Your About page is empty\./);
  assertEquals(
    card.artefact.options.map((o) => o.id),
    ["open", "publish", "check", "not_now"],
  );
});

Deno.test("P4 adversarial: after the publish confirm the plan is read back; not live yet is said, not claimed", async () => {
  const w = readyToPublish();
  const store = new MemoryStore(OWNER);
  await step(w, store, await startRun(store), {});
  let run = await current(store);
  const proposed = await step(w, store, run, choose(run, "publish")) as Extract<
    RunnerOutcome,
    { kind: "propose" }
  >;
  // Publishing is still running on Mingla's side.
  const pending = asArtefact(
    await step(w, store, await current(store), {
      trigger: "confirm",
      confirmed: { tool_name: "publish_site", result: { status: "executing" } },
    }),
  );
  assertEquals(pending.artefact.title, "Publishing your Website");
  run = await current(store);
  const notYet = await step(w, store, run, choose(run, "check"));
  assertEquals(notYet.kind, "notice");
  applyConfirmed(w, "publish_site", proposed.tool_args);
  run = await current(store);
  const live = await step(w, store, run, choose(run, "check"));
  assertEquals(live.kind, "completed");
  assertMatch((live as { text: string }).text, /Your Website is live/);
});

// ── First offering ─────────────────────────────────────────────────────────

Deno.test("P4 first offering: create goes to the event lane with no invented facts, is verified by id, and is never offered twice", async () => {
  const w = world([], { site: { id: SITE }, built: true });
  const store = new MemoryStore(OWNER);
  const card = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(card.artefact.step_key, "first_offering");
  assertEquals(
    card.artefact.options.map((o) => o.id),
    ["create:events", "not_now"],
  );
  let run = await current(store);
  const delegated = await step(w, store, run, choose(run, "create:events"));
  assertEquals(delegated.kind, "delegate");
  // Only the bare request — no title, date, price, venue or capacity.
  assertEquals(
    (delegated as { semantic_message: string }).semantic_message,
    "Create an event",
  );
  // While the event lane asks its questions, turns pass straight to it.
  run = await current(store);
  const lane = await step(w, store, run, {
    trigger: "turn",
    ownerText: "Friday at 7pm",
  });
  assertEquals(lane.kind, "pass");
  // Retrying the old choice cannot start a second create.
  const retry = await step(w, store, run, choose(card.run, "create:events"));
  assertEquals(retry.kind, "stale");
  // The event lane's create is confirmed: verified by id, then publish.
  const result = applyConfirmed(w, "create_event", {});
  const after = asArtefact(
    await step(w, store, await current(store), {
      trigger: "confirm",
      confirmed: { tool_name: "create_event", result },
    }),
  );
  assertMatch(
    after.text,
    /first event is saved as a draft and I've checked it's there/,
  );
  assertEquals(after.artefact.step_key, "publish");
  const state = (await current(store)).step_states.first_offering;
  assertEquals(state?.state, "done");
  assertEquals(state?.evidence?.observed, EVENT_ID);
});

Deno.test("P4 first offering: 'Not now' skips safely and keeps it on the plan", async () => {
  const w = world([], { site: { id: SITE }, built: true });
  const store = new MemoryStore(OWNER);
  await step(w, store, await startRun(store), {});
  const run = await current(store);
  const out = asArtefact(await step(w, store, run, choose(run, "not_now")));
  assertMatch(out.text, /stays on your Website plan/);
  assertEquals(
    (await current(store)).step_states.first_offering?.state,
    "skipped",
  );
  assertEquals(w.events.size, 0);
});

// ── Look: Mingla's default design (decision 7) ─────────────────────────────

Deno.test("P4 look: 'Use Mingla's default design' saves the default through a protected confirmation, labelled changeable", async () => {
  const w = world(["design_key"]);
  const store = new MemoryStore(OWNER);
  const card = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(card.artefact.step_key, "look");
  assert(card.artefact.options.some((o) => o.id === "use_default"));
  const run = await current(store);
  const proposed = await step(
    w,
    store,
    run,
    choose(run, "use_default"),
  ) as Extract<
    RunnerOutcome,
    { kind: "propose" }
  >;
  assertEquals(proposed.tool_name, "save_site_plan_design");
  assertEquals(proposed.tool_args.design_key, WEBSITE_DEFAULT_DESIGN);
  assertEquals(proposed.tool_args.source_type, "mingla");
  const presentation = buildProposalPresentation(
    "save_site_plan_design",
    verifiedProposalArgs(proposed.tool_args, { flow_rows: proposed.rows }),
  );
  const rows = Object.fromEntries(
    presentation.fields.map((field) => [field.label, field.value]),
  );
  assertEquals(
    rows["Change it later"],
    "You can pick a different design anytime from your Website.",
  );
  assertMatch(rows.Design, /Mingla's default/);
  // The skip is never a dead end: after the confirm, build is reachable.
  const next = asArtefact(await confirm(w, store, proposed));
  assertEquals(next.artefact.step_key, "build");
});

// ── Bound answers, retries, typed answers, waiting ─────────────────────────

Deno.test("P4 adversarial: a stale form answer changes nothing; an unusable answer re-asks with what was wrong and saves nothing", async () => {
  const w = world(["contact_phone"]);
  const store = new MemoryStore(OWNER);
  const card = asArtefact(await step(w, store, await startRun(store), {}));
  let run = await current(store);
  const bad = asArtefact(
    await step(w, store, run, form(run, { country: "GB", response: "12" })),
  );
  assert(bad.artefact.artefact_id !== card.artefact.artefact_id);
  assertEquals(bad.artefact.title, "Contact phone");
  assertEquals((await current(store)).status, "awaiting_owner");
  // The first card is no longer current: answering it is refused.
  const stale = await step(w, store, await current(store), {
    trigger: "answer",
    answer: {
      run_id: card.run.id,
      step_key: "brand",
      question_id: card.artefact.question_id!,
      choice_id: "answer",
      display_text: "+44 7700 900123",
      values: { choices: [], country: "GB", response: "07700 900123" },
    },
  });
  assertEquals(stale.kind, "stale");
  assertEquals(w.fields.get("contact_phone")!.state, "missing");
  run = await current(store);
  const good = await step(
    w,
    store,
    run,
    form(run, { country: "GB", response: "07700 900123" }),
  );
  assertEquals(good.kind, "propose");
});

Deno.test("P4: a plain typed value answers the open field; a question does not", async () => {
  const w = world(["contact_email"]);
  const store = new MemoryStore(OWNER);
  await step(w, store, await startRun(store), {});
  let run = await current(store);
  const question = await step(w, store, run, {
    trigger: "turn",
    ownerText: "Why do you need my email?",
  });
  assertEquals(question.kind, "pass");
  run = await current(store);
  const typed = await step(w, store, run, {
    trigger: "turn",
    ownerText: "hello@lantern.test",
  });
  assertEquals(typed.kind, "propose");
  // An older Host's card submission is read the same way.
  assertEquals(
    websiteTextAnswer(
      "contact_phone",
      "Use my answer for Contact phone — United Kingdom (+44), confirm the exact change, save it, re-check dependent fields, and continue to the next Website setup gap. Country: GB Response: 07700 900123",
    ),
    { choices: [], country: "GB", response: "07700 900123" },
  );
  assertEquals(websiteTextAnswer("design_key", "Voyage"), {
    choices: ["Voyage"],
    country: null,
    response: "",
  });
  assertEquals(websiteTextAnswer("design_key", "something else"), null);
});

Deno.test("P4: while the owner's proposal is still open, a turn waits — no second card", async () => {
  const w = world(["contact_email"]);
  const store = new MemoryStore(OWNER);
  await step(w, store, await startRun(store), {});
  let run = await current(store);
  await step(w, store, run, form(run, { response: "hello@lantern.test" }));
  w.openProposal = true;
  run = await current(store);
  // #3355: typed words while the change waits are told where it waits
  // (no model round-trip, no second card); a real side question passes.
  const turn = await step(w, store, run, { trigger: "turn", ownerText: "hmm" });
  assertEquals(turn.kind, "notice");
  assertMatch(
    (turn as { text: string }).text,
    /waiting on the confirmation card above/,
  );
  assertEquals((turn as { artefact: unknown }).artefact, null);
  const aside = await step(w, store, await current(store), {
    trigger: "turn",
    ownerText: "What will the card say?",
  });
  assertEquals(aside.kind, "pass");
  assertEquals((await current(store)).current_artefact, null);
  // Cancelled (no open proposal): the same field is asked again.
  w.openProposal = false;
  const again = asArtefact(
    await step(w, store, await current(store), {
      trigger: "turn",
      ownerText: "ok",
    }),
  );
  assertEquals(again.artefact.title, "Contact email");
});

Deno.test("P4: a teammate's Website setup is view-only; the brand never gets a second run", async () => {
  const w = world(["contact_email"]);
  const owner = new MemoryStore(OWNER);
  await step(w, owner, await startRun(owner), {});
  const mate = new MemoryStore(MATE, owner);
  const started = await mate.start({
    brandId: BRAND,
    flowKey: "website_setup",
    flowVersion: 1,
    concurrency: "one_per_brand",
    conversationId: "77777777-7777-4777-8777-777777777777",
    answers: {},
  });
  assertEquals(started.created, false);
  assertEquals(started.owned_by_other, true);
  const out = await step(w, mate, started.run, {});
  assertEquals(out.kind, "busy");
  assertEquals((out as { view_only: boolean }).view_only, true);
  assertEquals(owner.runs.size, 1);
});

Deno.test("P4: form answers are validated before anything runs", () => {
  const base = {
    run_id: "11111111-1111-4111-8111-111111111111",
    step_key: "brand",
    question_id: "22222222-2222-4222-8222-222222222222",
    display_text: "+44 7700 900123",
  };
  assert(parseFlowAnswer({
    ...base,
    choice_id: "answer",
    values: { choices: [], country: "GB", response: "07700 900123" },
  }));
  assertEquals(parseFlowAnswer({ ...base, choice_id: "answer" }), null);
  assertEquals(
    parseFlowAnswer({
      ...base,
      choice_id: "answer",
      values: { choices: [], country: "gb", response: "1" },
    }),
    null,
  );
  assertEquals(
    parseFlowAnswer({
      ...base,
      choice_id: "answer",
      values: { response: "x", extra: true },
    }),
    null,
  );
  assertEquals(
    parseFlowAnswer({
      ...base,
      choice_id: "not_now",
      values: { choices: [], country: null, response: "x" },
    }),
    null,
  );
});

// ── Flag-off parity and the deploy window ──────────────────────────────────

Deno.test("P4 parity: engine off (or migration missing) leaves Website setup on the pre-engine path, untouched", async () => {
  const store = new MemoryStore(OWNER);
  const off = await decideFlowTurn({
    // deno-lint-ignore no-explicit-any
    service: {} as any,
    // deno-lint-ignore no-explicit-any
    userClient: {} as any,
    userId: OWNER,
    brand: { id: BRAND, name: "Lantern" },
    conversationId: CHAT,
    message: "Start Website setup.",
    flowAnswer: null,
    engineEnabled: false,
    otherLaneActive: true,
    websiteSetup: true,
    store,
  });
  assertEquals(off.kind, "none");
  assertEquals(store.calls, []);
  const missing: FlowStore = {
    ...store,
    start: () => Promise.reject(new FlowEngineUnavailable()),
    getForConversation: () => Promise.reject(new FlowEngineUnavailable()),
  } as unknown as FlowStore;
  const unavailable = await decideFlowTurn({
    // deno-lint-ignore no-explicit-any
    service: {} as any,
    // deno-lint-ignore no-explicit-any
    userClient: {} as any,
    userId: OWNER,
    brand: { id: BRAND, name: "Lantern" },
    conversationId: CHAT,
    message: "Start Website setup.",
    flowAnswer: null,
    engineEnabled: true,
    otherLaneActive: true,
    websiteSetup: true,
    store: missing,
  });
  assertEquals(unavailable.kind, "none");
});

Deno.test("P4 parity: the agent-chat wiring only bypasses the pre-engine Website lanes when the engine owns the chat", () => {
  const chat = Deno.readTextFileSync(
    new URL("supabase/functions/agent-chat/index.ts", ROOT),
  );
  assertMatch(
    chat,
    /websiteSetupWorkflow = body\.workflow_context === "website_setup" &&\s*!websiteEngine/,
  );
  assertMatch(chat, /websiteSetupIntent = activeBrand && !websiteEngine/);
  assertMatch(
    chat,
    /if \(decision\.kind === "side"\) \{\s*websiteEngine = true;/,
  );
  const confirm = Deno.readTextFileSync(
    new URL("supabase/functions/agent-confirm-action/index.ts", ROOT),
  );
  // The pre-engine next-gap reader runs only when no run owns the chat.
  assertMatch(confirm, /!next && !flowState && !nextPendingActionId/);
  assert(
    isWebsiteSetupRequest("Start Website setup. Check the live setup plan"),
  );
  assert(
    isWebsiteSetupRequest(
      "Fix all Website brand-context gaps. Resume the durable job",
    ),
  );
  assert(!isWebsiteSetupRequest("hello@lantern.test"));
});

Deno.test("P4: a finished Website setup is not restarted by every message on the Website screen", async () => {
  const w = readyToPublish({ published: true });
  const store = new MemoryStore(OWNER);
  const done = await step(w, store, await startRun(store), {});
  assertEquals(done.kind, "completed");
  const args = {
    // deno-lint-ignore no-explicit-any
    service: {} as any,
    // deno-lint-ignore no-explicit-any
    userClient: {} as any,
    userId: OWNER,
    brand: { id: BRAND, name: "Lantern" },
    conversationId: CHAT,
    flowAnswer: null,
    engineEnabled: true,
    otherLaneActive: true,
    websiteSetup: true,
    store,
  };
  const side = await decideFlowTurn({
    ...args,
    message: "How do I add a page?",
  });
  assertEquals(side.kind, "side");
  assertEquals(store.runs.size, 1);
  assert(isWebsiteSetupRequest("Publish my Website"));
});

Deno.test("P4 first offering: trips and experiences are never created here (their lanes still fill in details) — only events", async () => {
  const w = world([], { site: { id: SITE }, built: true });
  w.fields.get("offerings_selected")!.value = [
    "trips",
    "events",
    "experiences",
  ];
  const store = new MemoryStore(OWNER);
  const card = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(
    card.artefact.options.map((o) => o.id),
    ["create:events", "open", "not_now"],
  );
  assertMatch(
    card.artefact.text,
    /I can't add trips and experiences for you in this chat yet/,
  );
  assertEquals(card.artefact.options[1].route, "/trip/create");
  const run = await current(store);
  const forged = await step(w, store, run, {
    trigger: "answer",
    answer: {
      run_id: run.id,
      step_key: run.current_step_key!,
      question_id: run.current_question_id!,
      choice_id: "create:trips",
      display_text: "Create my first trip",
    },
  });
  assertEquals(forged.kind, "stale");
});

Deno.test("P4 regression: city and country are asked before the phone and address they qualify", () => {
  // The audit's recheck fingerprint for contact_phone and an address
  // "doesn't apply" includes the brand's city and country. Asking them after
  // the phone/address voided those answers and Ari re-asked the address forever
  // (seen live on the local Sites stack, 2026-11-01).
  const at = (key: string) => WEBSITE_BRAND_FIELD_ORDER.indexOf(key);
  assert(at("city_country") >= 0);
  assert(at("city_country") < at("contact_phone"));
  assert(at("city_country") < at("address"));
});

// ── Live certification fixes (local Sites stack, 2026-11-01) ───────────────

function renditionOf(artefact: { rendition?: Record<string, unknown> }) {
  return artefact.rendition as {
    rendition_id: string;
    blocks: Array<{
      type: string;
      field?: Record<string, unknown>;
      options?: Array<Record<string, unknown>>;
    }>;
  };
}

Deno.test("cert D1: a typed theme choice resolves on the engine — whole label (even with 'and'), any case or spacing, or its id", async () => {
  // Live: "Warm and welcoming" was split on "and" and fell through to the
  // model (66K-token prompt).
  for (
    const typed of [
      "Warm and welcoming",
      "  warm AND   welcoming. ",
      "warm",
    ]
  ) {
    assertEquals(websiteTextAnswer("theme", typed), {
      choices: ["Warm and welcoming"],
      country: null,
      response: "",
    }, typed);
  }
  assertEquals(websiteTextAnswer("design_key", "VOYAGE")?.choices, ["Voyage"]);
  assertEquals(
    websiteTextAnswer("offerings_selected", "trips and events")
      ?.choices,
    ["Trips", "Events"],
  );
  assertEquals(websiteTextAnswer("theme", "something else"), null);

  const w = world(["profile_photo", "theme"]);
  const store = new MemoryStore(OWNER);
  await step(w, store, await startRun(store), {});
  w.fields.get("profile_photo")!.state = "verified";
  let run = await current(store);
  const theme = asArtefact(await step(w, store, run, choose(run, "check")));
  assertEquals(theme.artefact.title, "Mingla page theme");
  // The look card carries its three choices.
  const choices = renditionOf(theme.artefact).blocks.find((block) =>
    block.type === "choices"
  );
  assertEquals(
    choices?.options?.map((option) => option.label),
    ["Warm and welcoming", "Bold and energetic", "Refined and minimal"],
  );
  run = await current(store);
  const typed = await step(w, store, run, {
    trigger: "turn",
    ownerText: "Warm and welcoming",
  });
  assertEquals(typed.kind, "propose", "never handed to the model");
  const proposal = typed as Extract<RunnerOutcome, { kind: "propose" }>;
  assertEquals(
    (proposal.tool_args.patch as Record<string, unknown>).theme,
    { color: "#eb7825", font: "fraunces", animation: "shimmer_reveal" },
  );
});

Deno.test("cert D1/D2/D3: every agent-chat reply that shows a form card carries its control", async () => {
  // Live: the first question (description), the look after the logo check
  // and every refusal reached the owner as bare text.
  const { flowReplyStructured } = await import("../ariFlows/edge.ts");
  const w = world(["description"]);
  const store = new MemoryStore(OWNER);
  const first = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(first.artefact.title, "Brand story");
  const structured = flowReplyStructured(first.artefact);
  assertEquals(
    (structured.structuredData?.rendition as { rendition_id: string })
      .rendition_id,
    first.artefact.artefact_id,
  );
  assertEquals(
    renditionOf(first.artefact).blocks.some((block) => block.type === "input"),
    true,
  );
  assertEquals(flowReplyStructured(null), {});
  const chat = Deno.readTextFileSync(
    new URL("supabase/functions/agent-chat/index.ts", ROOT),
  );
  assertMatch(chat, /\.\.\.flowReplyStructured\(decision\.artefact\),/);
});

Deno.test("cert D3: a refusal brings the same field card back with the owner's input kept", async () => {
  const w = world(["contact_phone"]);
  const store = new MemoryStore(OWNER);
  await step(w, store, await startRun(store), {});
  // No brand country and no chip country: the number can't be read.
  w.fields.get("city_country")!.value = null;
  let run = await current(store);
  const refused = asArtefact(
    await step(w, store, run, form(run, { response: "07700 900123" })),
  );
  assertEquals(refused.artefact.title, "Contact phone");
  assertEquals(refused.artefact.answer_mode, "form");
  const input = renditionOf(refused.artefact).blocks.find((block) =>
    block.type === "input"
  );
  assertEquals(input?.field?.value, "07700 900123");
  assertEquals(input?.field?.kind, "phone");
  assert(
    renditionOf(refused.artefact).blocks.some((block) =>
      block.type === "callout"
    ),
    "says nothing was saved",
  );
  // With the country picked this time, the corrected answer proposes.
  run = await current(store);
  const fixed = await step(
    w,
    store,
    run,
    form(run, { country: "GB", response: "07700 900123" }),
  );
  assertEquals(fixed.kind, "propose");
});

Deno.test("cert D5: resuming Website setup re-presents the current card at the bottom, same identity", async () => {
  const { resumeWebsiteReply } = await import("../ariFlows/edge.ts");
  const w = world(["address"]);
  const store = new MemoryStore(OWNER);
  const card = asArtefact(await step(w, store, await startRun(store), {}));
  const decision = resumeWebsiteReply(await current(store));
  assertEquals(decision.kind, "reply");
  if (decision.kind !== "reply") return;
  // Same artefact id: still the one current card, never a second one.
  assertEquals(decision.artefact?.artefact_id, card.artefact.artefact_id);
  assertNotMatch(decision.text, /above/);
  assertMatch(decision.text, /^Picking up Website setup where we left off\./);
  const edge = Deno.readTextFileSync(
    new URL("supabase/functions/_shared/ariFlows/edge.ts", ROOT),
  );
  assertNotMatch(edge, /Your next step is/);
});

Deno.test("cert D6: a logo that is there but can't be used is not called missing, and the handoff stays", async () => {
  const w = world(["profile_photo"]);
  const store = new MemoryStore(OWNER);
  const handoff = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(handoff.artefact.kind, "handoff");
  const logo = w.fields.get("profile_photo")!;
  logo.state = "invalid";
  logo.value = "http://example.test/logo.png";
  let run = await current(store);
  const checked = await step(w, store, run, choose(run, "check"));
  assertEquals(checked.kind, "notice");
  const notice = checked as Extract<RunnerOutcome, { kind: "notice" }>;
  assertMatch(
    notice.text,
    /^I can see a brand logo, but it isn't usable yet: /,
  );
  assertNotMatch(notice.text, /isn't there yet/);
  assertEquals(notice.represent, true);
  assertEquals(notice.artefact?.artefact_id, handoff.artefact.artefact_id);
  // Truly missing still says so.
  logo.state = "missing";
  logo.value = null;
  run = await current(store);
  const missing = await step(w, store, run, choose(run, "check")) as Extract<
    RunnerOutcome,
    { kind: "notice" }
  >;
  assertMatch(missing.text, /^I checked; your brand logo isn't there yet\./);
  assertEquals(missing.represent, true);
});

Deno.test("cert D7: readback shows the saved link; the receipt reads one clear line; paid readiness never repeats itself", async () => {
  const { websiteReadbackLine } = await import("../ariFlows/websiteSetup.ts");
  assertEquals(
    websiteReadbackLine("social_links", {
      key: "social_links",
      label: "Public website or social link",
      state: "verified",
      value: { social_links: { website: "https://localtesttrips.test" } },
    }),
    "Saved. Website: https://localtesttrips.test.",
  );
  assertEquals(
    websiteReadbackLine("city_country", {
      key: "city_country",
      label: "City and country",
      state: "verified",
      value: { city: "London", country_code: "GB" },
    }),
    "Saved. City and country: London, United Kingdom.",
  );
  const { buildToolReceiptRendition } = await import("../ariRendition.ts");
  const receipt = buildToolReceiptRendition({
    toolName: "update_brand_context",
    result: { ok: true },
    pendingActionId: "pa-1",
    capabilities: {
      schema_version: 2,
      renditions: ["receipt"],
      blocks: ["key_value", "callout"],
      // deno-lint-ignore no-explicit-any
    } as any,
    envValue: "on",
  });
  if (receipt) {
    const all = JSON.stringify(receipt);
    assertNotMatch(all, /shown above|below was read back/);
  }
  const source = Deno.readTextFileSync(
    new URL("supabase/functions/_shared/ariRendition.ts", ROOT),
  );
  assertNotMatch(source, /"The saved result is shown above\."/);
  assertNotMatch(
    source,
    /"The saved result below was read back from Mingla\."/,
  );
});

Deno.test("cert D8: opening Website setup is a structured request — a short neutral bubble, engine-generated, outside the daily cap", async () => {
  const edge = await import("../ariFlows/edge.ts");
  assertEquals(edge.WEBSITE_SETUP_KICKOFF_DISPLAY, "Set up my Website");
  assertEquals(edge.parseWebsiteSetupKickoff({}), { part: null });
  assertEquals(edge.parseWebsiteSetupKickoff({ part: "brand" }), {
    part: "brand",
  });
  assertEquals(edge.parseWebsiteSetupKickoff({ part: "nope" }), null);
  assertEquals(edge.parseWebsiteSetupKickoff({ part: "brand", x: 1 }), null);
  assertEquals(edge.parseWebsiteSetupKickoff("Start Website setup"), null);
  const instruction = edge.websiteSetupKickoffInstruction({ part: "brand" });
  assert(isWebsiteSetupRequest(instruction), "the engine reads it as start");
  assertMatch(instruction, /I'm working on Your brand details\./);
  // The attempt is stamped as engine-generated.
  const updates: Record<string, unknown>[] = [];
  const service = {
    from(table: string) {
      assertEquals(table, "agent_turn_attempts");
      return {
        update(row: Record<string, unknown>) {
          updates.push(row);
          const chain = {
            eq: () => chain,
            then: (resolve: (value: { error: null }) => void) =>
              resolve({ error: null }),
          };
          return chain;
        },
      };
    },
  };
  // deno-lint-ignore no-explicit-any
  assert(await edge.markEngineOriginTurn(service as any, OWNER, "att-1"));
  assertEquals(updates, [{ origin: "engine" }]);
  const chat = Deno.readTextFileSync(
    new URL("supabase/functions/agent-chat/index.ts", ROOT),
  );
  assertMatch(chat, /body\.message = WEBSITE_SETUP_KICKOFF_DISPLAY;/);
  assertMatch(
    chat,
    /websiteKickoff\s*\?\s*websiteSetupKickoffInstruction\(websiteKickoff\)\s*:\s*requestMessage/,
  );
  assertMatch(chat, /if \(!rateLimit\.allowed && !kickoffExempt\)/);
  assertMatch(
    chat,
    /await markEngineOriginTurn\(serviceClient, userId, attemptId\)/,
  );
});

// ── Live certification round 2 (local Sites stack, 8/8, 2026-11-01) ───────

function edgeArgs(store: MemoryStore, message: string, w?: World) {
  return {
    ...(w ? { probes: probes(w) } : {}),
    // deno-lint-ignore no-explicit-any
    service: {} as any,
    // deno-lint-ignore no-explicit-any
    userClient: {} as any,
    userId: OWNER,
    brand: { id: BRAND, name: "Lantern" },
    conversationId: CHAT,
    message,
    flowAnswer: null,
    engineEnabled: true,
    otherLaneActive: true,
    websiteSetup: true,
    store,
  };
}

Deno.test("cert2 D1: a failed approval check brings the SAME live card back with its buttons", async () => {
  const w = world(["approved_plan"]);
  const store = new MemoryStore(OWNER);
  const card = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(card.artefact.step_key, "approve");
  const run = await current(store);
  // The card's own "I've approved it, check now" button, nothing approved.
  const checked = await step(w, store, run, choose(run, "check"));
  assertEquals(checked.kind, "notice");
  const notice = checked as Extract<RunnerOutcome, { kind: "notice" }>;
  assertMatch(notice.text, /^I checked; your plan approval isn't there yet\./);
  assertEquals(notice.represent, true, "the card comes back at the bottom");
  assertEquals(notice.artefact?.artefact_id, card.artefact.artefact_id);
  assertEquals(
    notice.artefact?.options.map((o) => o.id).sort(),
    ["check", "open"],
  );
  assertEquals(
    (await current(store)).current_artefact?.artefact_id,
    card.artefact.artefact_id,
    "it stays the one current card",
  );
});

Deno.test("cert2 D2: typed words that don't answer the card get a plain restatement and the same card — never the model", async () => {
  const w = world(["design_key"]);
  const store = new MemoryStore(OWNER);
  const card = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(card.artefact.step_key, "look");
  for (const typed of ["blue please", "done", "ok"]) {
    const out = await step(w, store, await current(store), {
      trigger: "turn",
      ownerText: typed,
    });
    assertEquals(out.kind, "notice", typed);
    const notice = out as Extract<RunnerOutcome, { kind: "notice" }>;
    assertEquals(notice.represent, true, typed);
    assertEquals(notice.unmatched, true, typed);
    assertEquals(notice.artefact?.artefact_id, card.artefact.artefact_id);
    assertMatch(notice.text, /We're on Website design:/);
    assertEquals(w.openProposal, false, "nothing proposed");
  }
  // A genuine side question may still go to the model.
  const aside = await step(w, store, await current(store), {
    trigger: "turn",
    ownerText: "What's the difference between the designs?",
  });
  assertEquals(aside.kind, "pass");
  // decideFlowTurn: unmatched words are a reply with the card, not "side".
  const decided = await decideFlowTurn(edgeArgs(store, "blue please", w));
  assertEquals(decided.kind, "reply");
  if (decided.kind === "reply") {
    assertEquals(decided.artefact?.artefact_id, card.artefact.artefact_id);
  }
  // "Continue Website setup" still resumes with the card.
  const resumed = await decideFlowTurn(
    edgeArgs(store, "Continue Website setup", w),
  );
  assertEquals(resumed.kind, "reply");
  if (resumed.kind === "reply") {
    assertMatch(resumed.text, /^Picking up Website setup where we left off/);
  }
  // A side question is "side", and carries the card for a failed answer.
  const side = await decideFlowTurn(
    edgeArgs(store, "How long does it take?", w),
  );
  assertEquals(side.kind, "side");
  if (side.kind === "side") {
    assertEquals(side.artefact?.artefact_id, card.artefact.artefact_id);
    assertMatch(
      flowSideFailureText(side.artefact ?? null),
      /^I couldn't answer that just now, and nothing was changed\. We're still on Website design:/,
    );
  }
});

Deno.test("cert2 D2: obvious intents are recognised — approved, skip, stop", async () => {
  assertEquals(classifyFlowText("ok I've approved it now"), "done");
  assertEquals(classifyFlowText("done"), "done");
  assertEquals(classifyFlowText("can we skip this one?"), "not_now");
  assertEquals(classifyFlowText("not now"), "not_now");
  assertEquals(classifyFlowText("please stop"), "stop");
  assertEquals(classifyFlowText("stop"), "stop");
  assertEquals(classifyFlowText("don't cancel"), "other");
  assertEquals(classifyFlowText("What does approve mean?"), "question");
  assertEquals(classifyFlowText("blue please"), "other");
  const handoff = {
    options: [
      { id: "open", label: "Open Brand details", route: "/x" },
      { id: "check", label: "I've uploaded it, check now" },
      { id: "not_now", label: "Not now, keep going" },
    ],
  } as unknown as Parameters<typeof textChoiceFor>[0];
  assertEquals(textChoiceFor(handoff, "ok I've uploaded it now"), "check");
  assertEquals(textChoiceFor(handoff, "can we skip this?"), "not_now");

  // "stop" on a card with no stop button stops the run honestly.
  const w = world(["approved_plan"]);
  const store = new MemoryStore(OWNER);
  await step(w, store, await startRun(store), {});
  const stopped = await step(w, store, await current(store), {
    trigger: "turn",
    ownerText: "stop",
  });
  assertEquals(stopped.kind, "cancelled");
  assertMatch((stopped as { text: string }).text, /Nothing was changed/);
  assertEquals((await current(store)).status, "cancelled");
});

Deno.test("cert2 D2: agent-chat never strands the flow when a side answer fails", () => {
  const chat = Deno.readTextFileSync(
    new URL("supabase/functions/agent-chat/index.ts", ROOT),
  );
  assertMatch(chat, /flowSide = \{\s*artefact: decision\.artefact \?\? null,/);
  assertMatch(chat, /if \(sideModelFailed\) return await flowSideFailure\(\);/);
  assertMatch(
    chat,
    /if \(sideModelFailed && loopResult\.kind === "stopped"\) \{\s*return await flowSideFailure\(\);/,
  );
  assertMatch(
    chat,
    /if \(flowSide && !\(err instanceof AriAttachmentError\)\) \{[\s\S]{0,300}return await flowSideFailure\(\);/,
  );
});

Deno.test("cert2 D4: a trips-only brand is told plainly that part 7 is skipped, why, and where to add a trip", async () => {
  const w = world([], { site: { id: SITE }, built: true });
  w.fields.get("offerings_selected")!.value = ["trips"];
  const store = new MemoryStore(OWNER);
  const card = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(card.artefact.step_key, "first_offering");
  assertMatch(
    card.artefact.text,
    /I can't add trips for you in this chat yet, so I'm skipping this part for now\./,
  );
  assertMatch(card.artefact.text, /add your first trip yourself in Mingla/);
  assertEquals(card.artefact.options, [
    { id: "open", label: "Add my first trip", route: "/trip/create" },
    { id: "not_now", label: "Skip for now, keep going" },
  ]);
  const run = await current(store);
  const next = await step(w, store, run, choose(run, "not_now"));
  assertEquals(next.kind, "artefact");
  assertMatch((next as { text: string }).text, /no offering for now/);
  assertEquals(
    (await current(store)).step_states.first_offering.state,
    "skipped",
  );
});

Deno.test("cert2 D4: a part 7 the plan already ticks is never passed silently", async () => {
  const w = readyToPublish();
  w.fields.get("offerings_selected")!.value = ["trips"];
  const store = new MemoryStore(OWNER);
  const card = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(card.artefact.step_key, "publish");
  assertMatch(
    card.text,
    /Your first trip is already on Mingla, so that part of your Website plan is done\./,
  );
  // Said once: the next read does not repeat it.
  const again = await step(w, store, await current(store), {
    trigger: "resume",
  });
  assertNotMatch(
    JSON.stringify(again),
    /already on Mingla/,
  );
});

Deno.test("cert2 D6: the logo handoff offers the in-chat upload first and Brand details second", async () => {
  const w = world(["profile_photo"]);
  const store = new MemoryStore(OWNER);
  const card = asArtefact(await step(w, store, await startRun(store), {}));
  assertEquals(card.artefact.kind, "handoff");
  assertEquals(card.artefact.handoff?.item_key, "profile_photo");
  assertMatch(card.artefact.text, /Choose your file here in the chat/);
  assertMatch(card.artefact.text, /Ari never adds media for you/);
  const open = card.artefact.options.find((o) => o.id === "open");
  assertEquals(open?.label, "Open Brand details");
  assertEquals(open?.route, `/brand/${BRAND}/edit?section=photo`);
  assert(card.artefact.options.some((o) => o.id === "check"));
});
