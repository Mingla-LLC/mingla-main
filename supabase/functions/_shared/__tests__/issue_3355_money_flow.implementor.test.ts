// Issue #3355 P6 — the money flow (implementor happy path + edges).
//
// MINGLA-INVARIANT: I-ARI-MONEY-ROLE-USES-SERVER-PREDICATE | issue #3355 | Ari's money tools (refunds, order cancels, payout and balance reads, instalment charges) authorize with the server's money predicate biz_can_manage_payments_for_brand through its _for_caller wrapper, never the linear role rank, and the currency-change decision uses its resolver's own rule (effective rank >= finance_manager); an event manager is refused in plain words before any card. Owner-only payment setup (biz_can_mutate_payouts_for_brand) is role-aware in open_handoff.
// MINGLA-INVARIANT: I-MONEY-SELL-VS-PAYOUT-DISTINCT | issue #3355 | Every Ari money answer (get_payout_status, the launch plan, the money gate) comes from brand_readiness(...).money (pg_brand_can_collect vs pg_brand_can_payout) with a plain guide per reason; a brand that can sell but can't be paid out is never told "Payouts are enabled".
//
// Covers SPEC §7.1 P6 and Seth's decisions 5/6 on the Ari side:
//   * event manager asking for a refund → "Only admins or finance can refund"
//     before any card; finance and admins pass; non-members stay not-found;
//   * a hold-rail brand reads "You can sell now; payouts start once your bank
//     is connected", never "Payouts are enabled";
//   * a currency change Ari helps decide makes can_sell true and the money
//     step completes from the server read;
//   * the instalment step is refused with an owner handoff while payouts
//     can't reach the bank; elsewhere that is only a warning;
//   * ISK (and JPY) show no decimals; Ari context strings use the formatter;
//   * provider minimum: Ari refuses a below-minimum tier at price entry; the
//     edge, Host and SQL minimum tables are identical;
//   * market time zones; blank zones are filled or asked, never sent empty;
//   * publish proposals read brand_readiness first and never block on items
//     the server would not refuse;
//   * Seth's decision 3: a paid tier on a DRAFT is proposed and saved for a
//     brand that can't take payments yet, with a one-line heads-up; publishing
//     it is refused with the plain fix; live tiers still need payments.
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_money_flow.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AGENT_TOOLS } from "../agentTools.ts";
import {
  authorizeAgentTool,
  MONEY_TOOL_PREDICATES,
  OWNER_SPOKEN_REFUSAL_CODES,
} from "../agentToolAuthorization.ts";
import { ToolError } from "../agentToolHelpers.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import {
  ARI_10X_TOOLS,
  bindProposalTimezone,
  OWNER_ONLY_HANDOFF_MESSAGE,
} from "../agentAri10xTools.ts";
import { ownerCopyViolations } from "../ariOwnerCopy.ts";
import {
  formatMajorWithCode,
  formatMinor,
  formatMinorWithCode,
} from "../money/formatMinor.ts";
import { formatMinorAmount } from "../ariPresentation/registry.ts";
import {
  PROVIDER_MINIMUM_CHARGE_MINOR,
  ticketPriceBelowMinimum,
  ticketPriceMinimumMessage,
} from "../money/providerMinimums.ts";
import {
  PROVIDER_MINIMUM_CHARGE_MINOR as HOST_MINIMUMS,
  ticketPriceMinimumMessage as hostMinimumMessage,
} from "../../../../mingla-business/src/constants/providerMinimumCharges.ts";
import { moneySplitView } from "../money/moneySplit.ts";
import {
  preflightReadinessProposal,
  preflightTripPackagePrices,
} from "../money/proposeReadiness.ts";
import {
  DRAFT_PAID_TIER_HEADS_UP,
  preflightTicketPricingProposal,
  verifiedProposalArgs,
} from "../agentTicketPricing.ts";
import { moneyGateStep } from "../ariFlows/moneyGate.ts";
import { findFlowDefinition, FLOW_DEFINITIONS } from "../ariFlows/index.ts";
import type {
  BrandReadiness,
  BrandReadinessItem,
  FlowContext,
  FlowRun,
  FlowStepRecord,
} from "../ariFlows/types.ts";
import type { BrandReadinessMoney } from "../agentReadinessTools.ts";

const BRAND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EVENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// deno-lint-ignore no-explicit-any
type Any = any;

// deno-lint-ignore no-explicit-any
function chain(result: unknown): any {
  const self: Record<string, unknown> = {};
  for (
    const method of ["select", "eq", "is", "not", "order", "limit", "gt", "in"]
  ) {
    self[method] = () => self;
  }
  self.maybeSingle = () => Promise.resolve({ data: result, error: null });
  self.single = () => Promise.resolve({ data: result, error: null });
  self.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve({ data: result, error: null }).then(resolve, reject);
  return self;
}

const ROLE_RANK: Record<string, number> = {
  scanner: 10,
  marketing_manager: 20,
  finance_manager: 30,
  event_manager: 40,
  brand_admin: 50,
  brand_owner: 60,
};

/** A caller with a brand rank and a money-predicate answer. */
function authClient(opts: { rank: number; canManage: boolean }): Any {
  const calls: string[] = [];
  return {
    calls,
    rpc(name: string, params: Record<string, unknown>) {
      calls.push(name);
      if (name === "biz_can_manage_payments_for_brand_for_caller") {
        return Promise.resolve({ data: opts.canManage, error: null });
      }
      if (name === "biz_brand_effective_rank_for_caller") {
        return Promise.resolve({ data: opts.rank, error: null });
      }
      if (name === "biz_role_rank") {
        return Promise.resolve({
          data: ROLE_RANK[String(params.p_role)] ?? 0,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      if (table === "orders") return chain({ event_id: EVENT });
      if (table === "events") {
        return chain({ brand_id: BRAND, event_type: "event" });
      }
      return chain(null);
    },
  };
}

function tool(name: string): Any {
  const found = AGENT_TOOLS.find((candidate) => candidate.name === name);
  assert(found, `${name} must be registered`);
  return found;
}

const REFUND_ARGS = {
  brand_id: BRAND,
  order_id: ORDER,
  reason: "Customer could not attend the night",
  confirm_phrase: "REFUND",
};

// ── D-11: money tools use the server predicate ──────────────────────────────

Deno.test("P6: an event manager asking for a refund hears 'Only admins or finance can refund' before any card", async () => {
  const client = authClient({
    rank: ROLE_RANK.event_manager,
    canManage: false,
  });
  const error = await assertRejects(
    () => authorizeAgentTool(tool("refund_order"), REFUND_ARGS, client, USER),
    ToolError,
  );
  assertEquals(error.code, "MONEY_ROLE_DENIED");
  assertMatch(error.message, /^Only admins or finance can refund\./);
  assertEquals(ownerCopyViolations(error.message, "prose"), []);
  // The server predicate decided, not the rank ladder (rank 40 > finance 30).
  assert(client.calls.includes("biz_can_manage_payments_for_brand_for_caller"));
  assert(!client.calls.includes("biz_role_rank"));
  // The chat says it in plain words (a text turn), never as a card or toast.
  assert(OWNER_SPOKEN_REFUSAL_CODES.has("MONEY_ROLE_DENIED"));
  const chat = await Deno.readTextFile(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  // Both model proposal paths speak the refusal; the flow-answer path (a
  // "Tell them" note) says the same plain words without a second suffix.
  assertEquals(
    chat.match(/OWNER_SPOKEN_REFUSAL_CODES\.has\(/g)?.length,
    3,
    "every proposal path speaks the refusal",
  );
  assertEquals(chat.match(/classification: "owner_refusal"/g)?.length, 2);
});

Deno.test("P6: finance managers, admins and owners pass the money predicate; non-members stay not-found", async () => {
  for (const rank of [30, 50, 60]) {
    await authorizeAgentTool(
      tool("refund_order"),
      REFUND_ARGS,
      authClient({ rank, canManage: true }),
      USER,
    );
  }
  const stranger = await assertRejects(
    () =>
      authorizeAgentTool(
        tool("refund_order"),
        REFUND_ARGS,
        authClient({ rank: 0, canManage: false }),
        USER,
      ),
    ToolError,
  );
  assertEquals(stranger.code, "BRAND_ACCESS_DENIED");
  // Payout status, balances and instalment charges follow the same predicate.
  for (const name of ["get_payout_status", "get_brand_balances_reports"]) {
    const denied = await assertRejects(
      () =>
        authorizeAgentTool(
          tool(name),
          { brand_id: BRAND },
          authClient({ rank: 40, canManage: false }),
          USER,
        ),
      ToolError,
    );
    assertEquals(denied.code, "MONEY_ROLE_DENIED");
  }
  for (const rule of Object.values(MONEY_TOOL_PREDICATES)) {
    assertEquals(ownerCopyViolations(rule.refusal, "prose"), []);
  }
  // Only the currency DECISION is held to the money predicate.
  await authorizeAgentTool(
    tool("manage_brand_discovery_currency"),
    { brand_id: BRAND, action: "get_state" },
    authClient({ rank: 40, canManage: false }),
    USER,
  );
});

Deno.test("P6: open_handoff tells a non-owner 'Only the owner can do this — tell them?' instead of payment setup", async () => {
  const handoff = ARI_10X_TOOLS.find((t) => t.name === "open_handoff")!;
  const asTeammate = await handoff.executor(
    { destination: "payment_onboarding", brand_id: BRAND },
    {
      rpc: (name: string) =>
        Promise.resolve({
          data: name === "biz_can_mutate_payouts_for_brand_for_caller"
            ? false
            : null,
          error: null,
        }),
    } as Any,
    USER,
  ) as Record<string, Any>;
  assertEquals(asTeammate.route, null);
  assertEquals(asTeammate.requires_owner, true);
  assertEquals(asTeammate.message, OWNER_ONLY_HANDOFF_MESSAGE);
  assertEquals(asTeammate.tell_owner.route, `/brand/${BRAND}/team`);
  const asOwner = await handoff.executor(
    { destination: "payment_onboarding", brand_id: BRAND },
    { rpc: () => Promise.resolve({ data: true, error: null }) } as Any,
    USER,
  ) as Record<string, Any>;
  assertEquals(asOwner.route, `/brand/${BRAND}/payments/onboard`);
});

// ── D-10: sell vs payout ────────────────────────────────────────────────────

function money(over: Partial<BrandReadinessMoney>): BrandReadinessMoney {
  return {
    can_sell: true,
    can_be_paid_out: true,
    sell_reason: "ready",
    payout_reason: "ready",
    rail: "stripe",
    currency: "GBP",
    terms_accepted_by_caller: true,
    ...over,
  };
}

function payoutClient(readinessMoney: BrandReadinessMoney | null): Any {
  return {
    functions: {
      invoke: () => Promise.resolve({ data: null, error: null }),
    },
    rpc(name: string) {
      if (name === "brand_readiness") {
        return Promise.resolve({
          data: readinessMoney
            ? {
              brand_id: BRAND,
              action: null,
              can_proceed: true,
              items: [],
              counts: {},
              money: readinessMoney,
            }
            : null,
          error: readinessMoney
            ? null
            : { code: "PGRST202", message: "Could not find the function" },
        });
      }
      if (name === "pg_brand_can_collect") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      if (table === "brands") {
        return chain([{
          id: BRAND,
          name: "Lagos Supper Club",
          slug: "lagos",
          default_currency: "NGN",
          cover_media_url: null,
        }]);
      }
      if (table === "brand_team_members") return chain([]);
      return chain(null);
    },
  };
}

function payoutTool(): Any {
  return DOMAIN_TOOLS.find((t) => t.name === "get_payout_status")!;
}

Deno.test("P6: a hold-rail brand can sell now and is told payouts start once the bank is connected", async () => {
  const result = await payoutTool().executor(
    { brand_id: BRAND },
    payoutClient(money({
      can_be_paid_out: false,
      payout_reason: "hold_rail_sell_before_bank",
      rail: "paystack_hold",
      currency: "NGN",
    })),
    USER,
  );
  assertEquals(result.can_sell, true);
  assertEquals(result.can_be_paid_out, false);
  assertEquals(result.rail, "paystack_hold");
  assertEquals(result.terms_accepted_by_caller, true);
  assertMatch(
    result.guide,
    /^You can sell now; payouts start once your bank is connected\./,
  );
  assertMatch(
    result.payout_guide,
    /held safely until the owner connects a bank/,
  );
  assertNotMatch(JSON.stringify(result), /Payouts are enabled/i);
  for (const text of [result.guide, result.sell_guide, result.payout_guide]) {
    assertEquals(ownerCopyViolations(text, "prose"), []);
  }
});

Deno.test("P6: every sell and payout reason has its own plain guide; a pending currency change is not 'finish KYC'", () => {
  const recon = moneySplitView(money({
    can_sell: false,
    can_be_paid_out: false,
    sell_reason: "currency_reconciliation_pending",
    payout_reason: "currency_reconciliation_pending",
  }));
  assertMatch(recon.summary, /currency change needs a decision/);
  assertNotMatch(recon.summary, /KYC|finish/i);
  const stripeNoPayouts = moneySplitView(money({
    can_be_paid_out: false,
    payout_reason: "payouts_disabled",
  }));
  assertEquals(
    stripeNoPayouts.summary,
    "You can sell now; payouts start once the payment provider turns payouts on.",
  );
  const noTerms = moneySplitView(money({ terms_accepted_by_caller: false }));
  assertMatch(noTerms.terms_guide!, /Organiser Terms/);
  for (
    const reason of [
      "no_provider",
      "kyc_incomplete",
      "provider_disabled",
      "currency_missing",
      "unsupported_market",
    ]
  ) {
    const view = moneySplitView(
      money({ can_sell: false, sell_reason: reason }),
    );
    assertEquals(ownerCopyViolations(view.summary, "prose"), []);
    assertNotMatch(view.summary, /_/);
  }
});

Deno.test("P6: during the deploy window payout status never claims payouts work", async () => {
  const result = await payoutTool().executor(
    { brand_id: BRAND },
    payoutClient(null),
    USER,
  );
  assertEquals(result.can_sell, true);
  assertEquals(result.can_be_paid_out, null);
  assertNotMatch(JSON.stringify(result), /Payouts are enabled/i);
});

// ── The money_gate flow step ────────────────────────────────────────────────

const MONEY_ITEMS: Record<
  string,
  {
    label: string;
    who: string;
    route: string | null;
    routeLabel: string;
    canFix: boolean;
    blocking: string[];
  }
> = {
  "money.market": {
    label: "Payout country and provider",
    who: "the brand owner",
    route: `/brand/${BRAND}/payments/onboard`,
    routeLabel: "Payments setup",
    canFix: true,
    blocking: [],
  },
  "money.currency": {
    label: "Payout currency",
    who: "the brand owner",
    route: `/brand/${BRAND}/payments/onboard`,
    routeLabel: "Payments setup",
    canFix: true,
    blocking: ["publish_paid", "trip_installments"],
  },
  "money.currency_reconciliation": {
    label: "Currency change review",
    who: "a finance manager, a brand admin or the owner",
    route: `/brand/${BRAND}/payments`,
    routeLabel: "Payments",
    canFix: true,
    blocking: ["publish_paid", "trip_installments"],
  },
  "money.terms_member": {
    label: "Your Organiser Terms",
    who: "you",
    route: null,
    routeLabel: "Accept the Organiser Terms when you publish something paid",
    canFix: true,
    blocking: ["publish_paid", "trip_installments"],
  },
  "money.can_sell": {
    label: "Ready to sell paid tickets",
    who: "the brand owner",
    route: `/brand/${BRAND}/payments/onboard`,
    routeLabel: "Payments setup",
    canFix: true,
    blocking: ["publish_paid", "trip_installments"],
  },
  "money.can_be_paid_out": {
    label: "Payouts to your bank",
    who: "the brand owner",
    route: `/brand/${BRAND}/payments/onboard`,
    routeLabel: "Payments setup",
    canFix: false,
    blocking: ["trip_installments"],
  },
  // Seth #1: the contact email never blocks publishing.
  contact_email: {
    label: "Contact email",
    who: "a brand admin or the owner",
    route: `/brand/${BRAND}/edit`,
    routeLabel: "Brand profile",
    canFix: true,
    blocking: [],
  },
};

function readinessWith(
  action: string,
  missing: string[],
  moneyOver: Partial<BrandReadinessMoney>,
  canFix: Record<string, boolean> = {},
): BrandReadiness {
  const items: BrandReadinessItem[] = Object.entries(MONEY_ITEMS).map((
    [key, entry],
  ) => {
    const done = !missing.includes(key);
    const blocks = !done && entry.blocking.includes(action);
    return {
      key,
      label: entry.label,
      group: key.startsWith("money.") ? "money" : "contact",
      state: done
        ? "verified"
        : key === "money.currency_reconciliation"
        ? "conflict"
        : "missing",
      severity: blocks ? "blocking" : done ? "done" : "skippable",
      blocks_action: blocks,
      blocking_for: entry.blocking,
      recommended_for: [],
      value_preview: null,
      deferrable: false,
      deferral: null,
      skip_in_ari: false,
      owner_action: "external",
      fix: {
        route: entry.route,
        route_label: entry.routeLabel,
        can_caller_fix: canFix[key] ?? entry.canFix,
        who_can_fix: entry.who,
      },
      ask: { control: "handoff" },
    };
  });
  return {
    brand_id: BRAND,
    action: action as BrandReadiness["action"],
    can_proceed: !items.some((item) => item.blocks_action),
    context_revision: "r1",
    evaluated_at: "now",
    counts: { blocking: 0, can_wait: 0, done: 0, deferred: 0 },
    money: money(moneyOver),
    items,
  };
}

function gateCtx(args: {
  flow: string;
  answers: Record<string, unknown>;
  readiness: () => BrandReadiness;
  state?: FlowStepRecord;
}): FlowContext {
  const def = findFlowDefinition(args.flow)!;
  const run = {
    id: "run-1",
    brand_id: BRAND,
    flow_key: def.key,
    flow_version: def.version,
    answers: Object.fromEntries(
      Object.entries(args.answers).map((
        [k, v],
      ) => [k, { value: v, source: "owner" }]),
    ),
    step_states: {},
    session_skips: [],
    current_artefact: null,
  } as unknown as FlowRun;
  return {
    run,
    def,
    brandName: "Lantern",
    state: args.state,
    deps: {
      readiness: () => Promise.resolve(args.readiness()),
      subjectExists: () => Promise.resolve(false),
      setAside: () => Promise.resolve("brand"),
    },
  };
}

Deno.test("P6: money_gate is wired into every paid offering flow after the brand gate", () => {
  for (const def of FLOW_DEFINITIONS.filter((d) => d.subject === "offering")) {
    const keys = def.steps.map((step) => step.key);
    assert(keys.includes("money_gate"), `${def.key} has the money step`);
    assert(keys.indexOf("money_gate") > keys.indexOf("brand_blockers"));
    // #3355 P7: v1 hands over at "offering"; v2 (events) asks its own facts.
    const firstOffering = keys.findIndex((key) =>
      !["brand_blockers", "brand_can_wait", "money_gate"].includes(key)
    );
    assert(firstOffering > 0);
    assert(keys.indexOf("money_gate") < firstOffering);
  }
});

Deno.test("P6: a currency change Ari helps decide makes can_sell true and the money step completes", async () => {
  let resolved = false;
  const read = () =>
    resolved
      ? readinessWith("publish_paid", ["money.can_be_paid_out"], {
        can_be_paid_out: false,
        payout_reason: "no_bank",
      })
      : readinessWith(
        "publish_paid",
        [
          "money.currency_reconciliation",
          "money.can_sell",
          "money.can_be_paid_out",
        ],
        {
          can_sell: false,
          can_be_paid_out: false,
          sell_reason: "currency_reconciliation_pending",
          payout_reason: "currency_reconciliation_pending",
        },
      );
  // 1. The first outstanding item in walk order is the currency review.
  const first = await moneyGateStep.probe(
    gateCtx({ flow: "create_event", answers: { paid: true }, readiness: read }),
  );
  assert(!first.done && "ask" in first);
  if (first.done || !("ask" in first)) return;
  assertEquals(first.ask.reuse_key, "money:money.currency_reconciliation");
  assertMatch(first.ask.text, /I can help you decide it here/);
  assert(first.ask.options.some((o) => o.id === "resolve_currency"));
  assert(
    first.ask.options.some((o) => o.id === "continue"),
    "Seth #3: drafts keep going",
  );
  // 2. "Decide it now" hands that one request to Ari's own lane.
  const asked = {
    state: "asked" as const,
    item_key: "money.currency_reconciliation",
  };
  const outcome = await moneyGateStep.onAnswer!(
    gateCtx({
      flow: "create_event",
      answers: { paid: true },
      readiness: read,
      state: asked,
    }),
    "resolve_currency",
  );
  assertEquals(outcome?.record.data?.resolving, true);
  const delegated = await moneyGateStep.probe(
    gateCtx({
      flow: "create_event",
      answers: { paid: true },
      readiness: read,
      state: outcome!.record,
    }),
  );
  assert(!delegated.done && "delegate" in delegated);
  if (!("delegate" in delegated)) return;
  assertMatch(delegated.semantic ?? "", /currency change/);
  // 3. Ari's confirmed decision lands; the re-read says the brand can sell.
  resolved = true;
  const done = await moneyGateStep.probe(
    gateCtx({
      flow: "create_event",
      answers: { paid: true },
      readiness: read,
      state: { ...outcome!.record, state: "delegated" },
    }),
  );
  assert(done.done);
  if (!done.done) return;
  assertEquals(
    (done.evidence.observed as Record<string, unknown>).can_sell,
    true,
  );
  assertMatch(done.note ?? "", /currency change is decided/);
  // Payouts not yet on is a warning for a paid event, never a card.
  assertMatch(
    done.note ?? "",
    /You can sell now; payouts start once your bank is connected\./,
  );
});

Deno.test("P6: the instalment step is refused with an owner handoff while payouts can't reach the bank", async () => {
  const read = (action: string) => () =>
    readinessWith(action, ["money.can_be_paid_out"], {
      can_be_paid_out: false,
      payout_reason: "no_bank",
    });
  const refused = await moneyGateStep.probe(gateCtx({
    flow: "create_trip",
    answers: { paid: true, installments: true },
    readiness: read("trip_installments"),
  }));
  assert(!refused.done && "ask" in refused);
  if (refused.done || !("ask" in refused)) return;
  assertMatch(refused.ask.text, /Only the owner can do this — tell them\?/);
  assertMatch(refused.ask.text, /Deposits and instalments need payouts/);
  assertEquals(refused.ask.handoff?.item_key, "money.can_be_paid_out");
  assert(refused.ask.options.some((o) => o.id === "no_installments"));
  assert(refused.ask.options.some((o) => o.id === "tell_owner"));
  assert(!refused.ask.options.some((o) => o.id === "continue"));
  assertEquals(ownerCopyViolations(refused.ask.text, "prose"), []);
  // The same brand selling a paid trip without instalments is only warned.
  const paidOnly = await moneyGateStep.probe(gateCtx({
    flow: "create_trip",
    answers: { paid: true },
    readiness: read("publish_paid"),
  }));
  assert(paidOnly.done);
  if (!paidOnly.done) return;
  assertMatch(paidOnly.note ?? "", /You can sell now; payouts start once/);
});

Deno.test("P6: the money walk is ordered and a free offering skips it; contact email never blocks", async () => {
  const read = () =>
    readinessWith(
      "publish_paid",
      ["money.terms_member", "money.can_sell", "contact_email"],
      {
        can_sell: false,
        sell_reason: "kyc_incomplete",
        terms_accepted_by_caller: false,
      },
    );
  const first = await moneyGateStep.probe(
    gateCtx({ flow: "create_event", answers: { paid: true }, readiness: read }),
  );
  assert(!first.done && "ask" in first);
  if (first.done || !("ask" in first)) return;
  assertEquals(
    first.ask.handoff?.item_key,
    "money.terms_member",
    "Terms before can_sell",
  );
  assertMatch(
    first.ask.text,
    /The app asks for them when you publish something paid/,
  );
  assert(!JSON.stringify(first.ask).includes("contact_email"));
  const free = await moneyGateStep.probe(
    gateCtx({
      flow: "create_event",
      answers: { paid: false },
      readiness: read,
    }),
  );
  assert(free.done);
});

// ── D-28: currency formatting ───────────────────────────────────────────────

Deno.test("P6: ISK and JPY show no decimals; two-decimal currencies keep theirs", () => {
  // Stripe's documented ISK wire form: 50000 = 500 kr.
  assertMatch(formatMinor(50000, "ISK")!, /^ISK\s500$/);
  assertEquals(formatMinorWithCode(50000, "ISK"), "500 ISK");
  assertEquals(formatMinorWithCode(500, "JPY"), "500 JPY");
  assertEquals(formatMinorWithCode(250000, "NGN"), "2500.00 NGN");
  assertEquals(formatMinor(3500, "GBP"), "£35.00");
  assertEquals(formatMajorWithCode(500, "ISK"), "500 ISK");
  assertMatch(formatMinorAmount(2500, "ISK"), /^ISK\s25$/);
  assertEquals(formatMinorWithCode(-1, "GBP"), null, "never a made-up number");
  // The owner-visible context strings route through the formatter.
  const chatSource = Deno.readTextFileSync(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  assertNotMatch(chatSource, /\.toFixed\(2\)/);
  const domainSource = Deno.readTextFileSync(
    new URL("../agentDomainTools.ts", import.meta.url),
  );
  assertNotMatch(domainSource, /\(cents \/ 100\)\.toFixed\(2\)/);
});

// ── Decision 6: provider minimum, one table in three places ─────────────────

Deno.test("P6: the minimum-price table is identical in edge code, the Host app and SQL", async () => {
  assertEquals({ ...HOST_MINIMUMS }, { ...PROVIDER_MINIMUM_CHARGE_MINOR });
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20280310003355_issue_3355_paid_tier_terms_and_minimums.sql",
      import.meta.url,
    ),
  );
  const sqlTable = Object.fromEntries(
    [...sql.matchAll(/WHEN '([A-Z]{3})' THEN (\d+)/g)].map((
      m,
    ) => [m[1], Number(m[2])]),
  );
  assertEquals(sqlTable, { ...PROVIDER_MINIMUM_CHARGE_MINOR });
  for (const currency of Object.keys(PROVIDER_MINIMUM_CHARGE_MINOR)) {
    assertEquals(
      hostMinimumMessage(currency),
      ticketPriceMinimumMessage(currency),
    );
  }
  // Unverified currencies are left out, never guessed.
  for (const currency of ["ISK", "BGN"]) {
    assert(!(currency in PROVIDER_MINIMUM_CHARGE_MINOR));
  }
});

Deno.test("P6: Nigeria's minimum is ₦100 (Seth's decision, 2026-11-01) and reads in naira", () => {
  assertEquals(PROVIDER_MINIMUM_CHARGE_MINOR.NGN, 10000);
  assertEquals(HOST_MINIMUMS.NGN, 10000);
  const words =
    "Paid tickets must be at least ₦100.00. That's the smallest amount the payment provider can charge.";
  assertEquals(ticketPriceMinimumMessage("NGN"), words);
  assertEquals(hostMinimumMessage("ngn"), words);
  // ₦99 is refused, ₦100 passes (kobo).
  assertEquals(ticketPriceBelowMinimum(9900, "NGN"), words);
  assertEquals(ticketPriceBelowMinimum(10000, "NGN"), null);
  assertEquals(ticketPriceBelowMinimum(0, "NGN"), null, "free is never checked");
});

function tierClient(): Any {
  return {
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "pg_brand_can_collect" ? true : null,
        error: null,
      }),
    from(table: string) {
      if (table === "events") {
        return chain({
          id: EVENT,
          brand_id: BRAND,
          event_type: "event",
          status: "draft",
          currency: "GBP",
          theme: { business_draft: { tickets: [] } },
          deleted_at: null,
        });
      }
      if (table === "brands") return chain({ default_currency: "GBP" });
      return chain(null);
    },
  };
}

Deno.test("P6: Ari refuses a below-minimum ticket price at price entry, before any card", async () => {
  const error = await assertRejects(
    () =>
      preflightTicketPricingProposal(
        "upsert_ticket_tier",
        {
          event_id: EVENT,
          name: "Cheap",
          is_free: false,
          is_unlimited: true,
          price_cents: 20,
        },
        tierClient(),
      ),
    ToolError,
  );
  assertEquals(error.code, "TICKET_PRICE_BELOW_MINIMUM");
  assertEquals(
    error.message,
    "Paid tickets must be at least £0.30. That's the smallest amount the payment provider can charge. Nothing was changed.",
  );
  assert(OWNER_SPOKEN_REFUSAL_CODES.has("TICKET_PRICE_BELOW_MINIMUM"));
  const ok = await preflightTicketPricingProposal(
    "upsert_ticket_tier",
    {
      event_id: EVENT,
      name: "Fair",
      is_free: false,
      is_unlimited: true,
      price_cents: 30,
    },
    tierClient(),
  );
  assertEquals(ok?.proposed_price_cents, 30);
  // Trip packages are checked the same way.
  await assertRejects(
    () =>
      preflightTripPackagePrices(
        "manage_trip_tiers",
        { event_id: EVENT, items: [{ tier_name: "Bunk", price_cents: 10 }] },
        tierClient(),
      ),
    ToolError,
  );
});

// ── D-27: market time zones ─────────────────────────────────────────────────

Deno.test("P6: market rules give single-zone countries a time zone and ask for multi-zone ones", async () => {
  const rules = ARI_10X_TOOLS.find((t) => t.name === "get_market_rules")!;
  const gb = await rules.executor(
    { country_code: "gb" },
    {} as Any,
    USER,
  ) as Record<string, Any>;
  assertEquals(gb.default_timezone, "Europe/London");
  const ng = await rules.executor(
    { country_code: "NG" },
    {} as Any,
    USER,
  ) as Record<string, Any>;
  assertEquals(ng.default_timezone, "Africa/Lagos");
  const us = await rules.executor(
    { country_code: "US" },
    {} as Any,
    USER,
  ) as Record<string, Any>;
  assertEquals(us.default_timezone, null);
  assertEquals(us.timezone_needs_owner_choice, true);
  assertMatch(us.timezone_ask, /more than one time zone/);
});

function brandClient(brand: Record<string, unknown> | null): Any {
  return { from: () => chain(brand) };
}

Deno.test("P6: Ari never proposes an offering with an empty time zone", async () => {
  const base = {
    brand_id: BRAND,
    title: "Supper",
    start_at: "2027-01-08T19:00:00Z",
  };
  const fromBrand = await bindProposalTimezone("create_event", {
    ...base,
    timezone: "",
  }, brandClient({ default_timezone: "Europe/Paris", country_code: "GB" }));
  assertEquals(fromBrand.timezone, "Europe/Paris");
  const fromMarket = await bindProposalTimezone(
    "create_event",
    base,
    brandClient({ default_timezone: null, country_code: "GB" }),
  );
  assertEquals(fromMarket.timezone, "Europe/London");
  const kept = await bindProposalTimezone("create_event", {
    ...base,
    timezone: "Africa/Lagos",
  }, brandClient({ default_timezone: "Europe/London" }));
  assertEquals(kept.timezone, "Africa/Lagos");
  const ask = await assertRejects(
    () =>
      bindProposalTimezone(
        "create_trip",
        base,
        brandClient({ default_timezone: null, country_code: "US" }),
      ),
    ToolError,
  );
  assertEquals(ask.code, "TIMEZONE_NEEDED");
  assert(OWNER_SPOKEN_REFUSAL_CODES.has("TIMEZONE_NEEDED"));
});

// ── D-26: readiness at propose time ─────────────────────────────────────────

function publishClient(args: {
  tickets: unknown[];
  readiness: BrandReadiness | null;
  calls?: string[];
}): Any {
  return {
    rpc(name: string, params: Record<string, unknown>) {
      args.calls?.push(`${name}:${String(params.p_action ?? "")}`);
      if (name === "brand_readiness") {
        return Promise.resolve(
          args.readiness
            ? {
              data: { ...args.readiness, action: params.p_action },
              error: null,
            }
            : {
              data: null,
              error: {
                code: "PGRST202",
                message: "Could not find the function",
              },
            },
        );
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      if (table === "events") {
        return chain({
          id: EVENT,
          brand_id: BRAND,
          status: "draft",
          theme: { business_draft: { tickets: args.tickets } },
        });
      }
      return chain([]);
    },
  };
}

Deno.test("P6: a paid publish proposal hears its money blocker before the card; the server stays the backstop", async () => {
  const calls: string[] = [];
  const blocked = await assertRejects(
    () =>
      preflightReadinessProposal(
        "publish_event",
        { event_id: EVENT },
        publishClient({
          tickets: [{ name: "Standard", price: 15 }],
          readiness: readinessWith("publish_paid", [
            "money.can_sell",
            "contact_email",
          ], {
            can_sell: false,
            sell_reason: "kyc_incomplete",
          }, { "money.can_sell": false }),
          calls,
        }),
      ),
    ToolError,
  );
  assertEquals(blocked.code, "READINESS_BLOCKED");
  assertMatch(blocked.message, /^Before I can put this on sale/);
  assertMatch(
    blocked.message,
    /Ready to sell paid tickets: only the owner can do this — tell them\?/,
  );
  assertNotMatch(blocked.message, /Contact email/, "Seth #1");
  assertEquals(ownerCopyViolations(blocked.message, "prose"), []);
  assert(calls.includes("brand_readiness:publish_paid"));
  // A free draft reads the free action and is not blocked by money.
  const free = await preflightReadinessProposal(
    "publish_event",
    { event_id: EVENT },
    publishClient({
      tickets: [{ name: "Free", isFree: true, price: 0 }],
      readiness: readinessWith("publish_free", ["money.can_sell"], {
        can_sell: false,
      }),
    }),
  );
  assertEquals(free?.readiness_action, "publish_free");
  // Readiness not applied yet: step aside, the publish RPC decides.
  const unavailable = await preflightReadinessProposal(
    "publish_event",
    { event_id: EVENT },
    publishClient({ tickets: [{ price: 15 }], readiness: null }),
  );
  assertEquals(unavailable, null);
});

// ── Decision 3: paid tickets in drafts before payments ──────────────────────

const TIER_OP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** An event (draft or live) on a brand that can or can't take payments. */
function decision3Client(opts: {
  status: "draft" | "scheduled";
  canCollect: boolean | "error";
  calls?: string[];
}): Any {
  return {
    rpc(name: string) {
      opts.calls?.push(name);
      if (name === "pg_brand_can_collect") {
        return Promise.resolve(
          opts.canCollect === "error"
            ? { data: null, error: { message: "read failed" } }
            : { data: opts.canCollect, error: null },
        );
      }
      if (name === "ari_execute_ticket_pricing_operation") {
        return Promise.resolve({
          data: { representation: "draft", tier: { id: TIER_OP } },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      if (table === "events") {
        return chain({
          id: EVENT,
          brand_id: BRAND,
          event_type: "event",
          status: opts.status,
          currency: "NGN",
          theme: { business_draft: { tickets: [] } },
          deleted_at: null,
        });
      }
      if (table === "brands") return chain({ default_currency: "NGN" });
      return chain(opts.status === "draft" ? null : []);
    },
  };
}

const PAID_DRAFT_TIER = {
  event_id: EVENT,
  name: "Early bird",
  is_free: false,
  is_unlimited: true,
  price_cents: 500000,
};

function upsertTool(): Any {
  return DOMAIN_TOOLS.find((t) => t.name === "upsert_ticket_tier")!;
}

Deno.test("P6 decision 3: a paid tier on a draft is proposed for a brand that can't take payments, with a one-line heads-up", async () => {
  const context = await preflightTicketPricingProposal(
    "upsert_ticket_tier",
    PAID_DRAFT_TIER,
    decision3Client({ status: "draft", canCollect: false }),
  );
  assertEquals(context?.lifecycle, "draft");
  assertEquals(context?.payout_ready, false);
  assertEquals(
    DRAFT_PAID_TIER_HEADS_UP,
    "You can add paid tickets now; you'll need payments set up before you publish.",
  );
  // The card shows the heads-up as its own row, copy-gate clean.
  const presentation = (verifiedProposalArgs(
    PAID_DRAFT_TIER,
    context,
    "upsert_ticket_tier",
  ).__proposal_context as Any).presentation;
  assertEquals(
    presentation.fields.filter((f: Any) => f.label === "Heads-up"),
    [{ label: "Heads-up", value: DRAFT_PAID_TIER_HEADS_UP }],
  );
  assertEquals(ownerCopyViolations(DRAFT_PAID_TIER_HEADS_UP, "prose"), []);
  // A brand that can take payments gets no heads-up.
  const ready = await preflightTicketPricingProposal(
    "upsert_ticket_tier",
    PAID_DRAFT_TIER,
    decision3Client({ status: "draft", canCollect: true }),
  );
  assertEquals(ready?.payout_ready, true);
  assertEquals(ready?.flow_rows, undefined);
  // A failed payments read never blocks a draft (publishing decides).
  const unknown = await preflightTicketPricingProposal(
    "upsert_ticket_tier",
    PAID_DRAFT_TIER,
    decision3Client({ status: "draft", canCollect: "error" }),
  );
  assertEquals(unknown?.payout_ready, null);
});

Deno.test("P6 decision 3: confirming the draft tier saves it; nothing refuses it for payments", async () => {
  const calls: string[] = [];
  const result = await upsertTool().executor(
    PAID_DRAFT_TIER,
    decision3Client({ status: "draft", canCollect: false, calls }),
    USER,
    { operationId: TIER_OP },
  );
  assertEquals(result.representation, "draft");
  assert(calls.includes("ari_execute_ticket_pricing_operation"));
  assert(!calls.includes("pg_brand_can_collect"), "drafts are checked at publish");
});

Deno.test("P6 decision 3: live tiers are unchanged — a new paid tier still needs payments before any card or write", async () => {
  const preflight = await assertRejects(
    () =>
      preflightTicketPricingProposal(
        "upsert_ticket_tier",
        PAID_DRAFT_TIER,
        decision3Client({ status: "scheduled", canCollect: false }),
      ),
    ToolError,
  );
  assertEquals(preflight.code, "PAYOUT_NOT_READY");
  const calls: string[] = [];
  const executed = await assertRejects(
    () =>
      upsertTool().executor(
        PAID_DRAFT_TIER,
        decision3Client({ status: "scheduled", canCollect: false, calls }),
        USER,
        { operationId: TIER_OP },
      ),
    ToolError,
  );
  assertEquals(executed.code, "PAYOUT_NOT_READY");
  assert(!calls.includes("ari_execute_ticket_pricing_operation"));
  const live = await preflightTicketPricingProposal(
    "upsert_ticket_tier",
    PAID_DRAFT_TIER,
    decision3Client({ status: "scheduled", canCollect: true }),
  );
  assertEquals(live?.lifecycle, "live");
  assertEquals(live?.payout_ready, true);
});

Deno.test("P6 decision 3: publishing that paid draft is refused with the plain fix before any card", async () => {
  const blocked = await assertRejects(
    () =>
      preflightReadinessProposal(
        "publish_event",
        { event_id: EVENT },
        publishClient({
          tickets: [{ name: "Early bird", isFree: false, priceGbp: 5000 }],
          readiness: readinessWith("publish_paid", ["money.can_sell"], {
            can_sell: false,
            sell_reason: "kyc_incomplete",
          }, { "money.can_sell": false }),
        }),
      ),
    ToolError,
  );
  assertEquals(blocked.code, "READINESS_BLOCKED");
  assertEquals(
    blocked.message,
    [
      "Before I can put this on sale, this needs doing:",
      "- Ready to sell paid tickets: only the owner can do this — tell them?",
      "Nothing was changed.",
    ].join("\n"),
  );
  assertEquals(ownerCopyViolations(blocked.message, "prose"), []);
});

// ── The currency-change decision follows its server owner ───────────────────

const RESOLVE_ARGS = {
  brand_id: BRAND,
  action: "resolve_reconciliation",
  reconciliation_id: ORDER,
  decision: "convert",
};

Deno.test("P6 currency decision: every role the resolver admits (rank >= finance) can decide it through Ari, an event manager included", async () => {
  // issue_1384_resolve_reconciliation: biz_brand_effective_rank >= finance_manager.
  for (const rank of [30, 40, 50, 60]) {
    const client = authClient({ rank, canManage: rank !== 40 });
    await authorizeAgentTool(
      tool("manage_brand_discovery_currency"),
      RESOLVE_ARGS,
      client,
      USER,
    );
    assert(
      !client.calls.includes("biz_can_manage_payments_for_brand_for_caller"),
      "the currency decision is not held to the refund/payout predicate",
    );
  }
});

Deno.test("P6 currency decision: a role the resolver refuses is refused by Ari first, in plain words; refunds keep the money predicate", async () => {
  for (const rank of [10, 20]) {
    const denied = await assertRejects(
      () =>
        authorizeAgentTool(
          tool("manage_brand_discovery_currency"),
          RESOLVE_ARGS,
          authClient({ rank, canManage: false }),
          USER,
        ),
      ToolError,
    );
    assertEquals(denied.code, "MONEY_ROLE_DENIED");
    assertEquals(
      denied.message,
      "Your role can't decide a currency change. Nothing was changed. Ask a finance manager, an event manager, a brand admin or the owner to do it.",
    );
    assertEquals(ownerCopyViolations(denied.message, "prose"), []);
  }
  const stranger = await assertRejects(
    () =>
      authorizeAgentTool(
        tool("manage_brand_discovery_currency"),
        RESOLVE_ARGS,
        authClient({ rank: 0, canManage: false }),
        USER,
      ),
    ToolError,
  );
  assertEquals(stranger.code, "BRAND_ACCESS_DENIED");
  // An event manager still can't refund or see payouts.
  for (const name of ["refund_order", "get_payout_status"]) {
    const refused = await assertRejects(
      () =>
        authorizeAgentTool(
          tool(name),
          name === "refund_order" ? REFUND_ARGS : { brand_id: BRAND },
          authClient({ rank: 40, canManage: false }),
          USER,
        ),
      ToolError,
    );
    assertEquals(refused.code, "MONEY_ROLE_DENIED");
  }
  assertEquals(
    MONEY_TOOL_PREDICATES.refund_order.predicate,
    "biz_can_manage_payments_for_brand",
  );
  assertEquals(
    MONEY_TOOL_PREDICATES.get_brand_balances_reports.predicate,
    "biz_can_manage_payments_for_brand",
  );
});
