/**
 * #4389 — brand setup as an Ari flow: bank country, then Organiser Terms and
 * payment details on the secure screen. Name is done once the brand exists.
 *
 * Every step reads `brand_readiness(brand_setup)` (the one truth: exactly 4
 * items) and hands off to the full-screen setup route; nothing here writes,
 * and bank, ID or tax numbers are never asked for in chat. There is no
 * keyword front door: the flow is started through the engine's flow start.
 */

import type { BrandReadinessItem } from "../agentReadinessTools.ts";
import { brandSetupRoute, type BrandSetupStep } from "../readinessCatalog.ts";
import type {
  FlowContext,
  FlowDefinition,
  ProbeResult,
  StepDefinition,
} from "./types.ts";

export const BRAND_SETUP_FLOW_KEY = "brand_setup";

function done(items: BrandReadinessItem[], key: string): boolean {
  const item = items.find((i) => i.key === key);
  return item?.state === "verified" || item?.state === "not_applicable";
}

function handoffStep(spec: {
  key: string;
  title: string;
  items: string[];
  step: BrandSetupStep;
  text: string;
  routeLabel: string;
  dependsOn: string[];
}): StepDefinition {
  return {
    key: spec.key,
    title: spec.title,
    kind: "handoff",
    depends_on: spec.dependsOn,
    policy: "blocking",
    async probe(ctx: FlowContext): Promise<ProbeResult> {
      const readiness = await ctx.deps.readiness("brand_setup");
      const items = readiness.items;
      if (spec.items.every((key) => done(items, key))) {
        return {
          done: true,
          evidence: {
            probe: "brand_readiness",
            observed: spec.items,
            action: "brand_setup",
            context_revision: readiness.context_revision,
          },
        };
      }
      const first = items.find((i) => spec.items.includes(i.key) && !done(items, i.key));
      const route = brandSetupRoute(ctx.run.brand_id, spec.step);
      return {
        done: false,
        ask: {
          kind: "handoff",
          reuse_key: `${BRAND_SETUP_FLOW_KEY}:${spec.key}`,
          title: spec.title,
          text: spec.text,
          options: [{ id: "open", label: spec.routeLabel, route }],
          handoff: {
            item_key: first?.key ?? spec.items[0],
            item_label: first?.label ?? spec.title,
            route,
            route_label: spec.routeLabel,
            can_caller_fix: first?.fix?.can_caller_fix ?? true,
            who_can_fix: first?.fix?.who_can_fix ?? "the brand owner",
          },
          record: { item_key: first?.key ?? spec.items[0] },
        },
      };
    },
  };
}

const bankCountryStep = handoffStep({
  key: "bank_country",
  title: "Bank country",
  items: ["money.market"],
  step: "country",
  text: "Pick the country your bank account is in. Prices and payouts use its currency.",
  routeLabel: "Choose bank country",
  dependsOn: [],
});

const getPaidStep = handoffStep({
  key: "get_paid",
  title: "Get paid",
  items: ["money.terms_member", "money.details_submitted"],
  step: "pay",
  text: "Bank and ID details are entered on a secure screen, not in chat.",
  routeLabel: "Open secure setup",
  dependsOn: ["bank_country"],
});

export const BRAND_SETUP_FLOW: FlowDefinition = {
  key: BRAND_SETUP_FLOW_KEY,
  version: 1,
  title: "Brand setup",
  subject: "brand",
  concurrency: "one_per_brand",
  noun: "brand",
  readiness: {
    draft: "brand_setup",
    publish: "brand_setup",
    publish_paid: null,
  },
  subject_tools: [],
  subject_table: null,
  steps: [bankCountryStep, getPaidStep],
  summarize(run) {
    const evidence = run.step_states.get_paid?.evidence;
    if (!evidence) return null;
    return {
      title: "You're all set",
      text: "Payment details sent. You can take bookings once they're checked.",
      evidence,
    };
  },
};
