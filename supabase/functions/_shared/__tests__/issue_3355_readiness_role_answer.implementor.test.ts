/**
 * #3355 P10 — found by the live eval refund_role_refused_event_manager.
 *
 * An event manager asks "What do I need before I can issue refunds?". The
 * deterministic readiness answer listed the `team.role` blocker with that
 * item's own "who can fix" (who can change roles: the owner), so it said
 * "only the brand owner can do this". The server lets a finance manager, a
 * brand admin or the owner refund (biz_can_manage_payments_for_brand). The
 * answer now names who may do the action itself.
 */

import {
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type {
  BrandReadiness,
  BrandReadinessItem,
} from "../agentReadinessTools.ts";
import { buildReadinessAnswer } from "../ariFlows/readinessAnswer.ts";
import type { ReadinessAction } from "../readinessCatalog.ts";

function roleBlocked(action: ReadinessAction): BrandReadiness {
  const role: BrandReadinessItem = {
    key: "team.role",
    label: "Your role on this brand",
    group: "team",
    state: "missing",
    severity: "blocking",
    blocks_action: true,
    blocking_for: [action],
    recommended_for: [],
    value_preview: "Event Manager",
    deferrable: false,
    deferral: null,
    skip_in_ari: false,
    owner_action: "none",
    fix: {
      route: "/brand/b/team",
      route_label: "Team",
      can_caller_fix: false,
      who_can_fix: "the brand owner",
    },
    ask: { control: "handoff" },
  } as BrandReadinessItem;
  return {
    brand_id: "b",
    action,
    can_proceed: false,
    context_revision: "r1",
    evaluated_at: "now",
    counts: { blocking: 1, can_wait: 0, done: 0, deferred: 0 },
    money: {
      can_sell: true,
      can_be_paid_out: false,
      sell_reason: "ready",
      payout_reason: "no_bank",
      rail: "stripe",
      currency: "GBP",
      terms_accepted_by_caller: false,
    },
    items: [role],
  } as BrandReadiness;
}

Deno.test("an event manager asking about refunds is told who CAN refund, not 'only the owner'", () => {
  const { text } = buildReadinessAnswer({
    readiness: roleBlocked("refund"),
    action: "refund",
    brandName: "Afterglow Sessions",
  });
  assertMatch(
    text,
    /Your role can't issue refunds: only a finance manager, a brand admin or the owner can\./,
  );
  assertNotMatch(text, /only the brand owner can do this/);
});

Deno.test("the role line follows the server's per-action rule", () => {
  const cases: Array<[ReadinessAction, RegExp]> = [
    ["bank_setup", /only the brand owner can\./],
    ["website_build", /only a brand admin or the owner can\./],
    ["publish_paid", /only an event manager, a brand admin or the owner can\./],
  ];
  for (const [action, expected] of cases) {
    const { text } = buildReadinessAnswer({
      readiness: roleBlocked(action),
      action,
      brandName: "Afterglow Sessions",
    });
    assertMatch(text, expected);
  }
});
