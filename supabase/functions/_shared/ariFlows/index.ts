/**
 * Issue #3355 P3 — the Ari flow registry.
 *
 * Every offering flow is: brand_gate (blockers, then what can wait) →
 * money_gate (only for paid) → offering → summary. In P3 the offering step
 * hands the owner's original request to the existing lane (the deterministic
 * event planner for events; the current Ari lanes for the rest) and, for
 * events, verifies the created draft before the run completes. P7–P9 replace
 * the offering step with the shared slot planner; the engine hook stays.
 */

import type { ReadinessAction } from "../readinessCatalog.ts";
import { brandBlockersStep, brandCanWaitStep, listWords } from "./brandGate.ts";
import { moneyGateStep } from "./moneyGate.ts";
import { WEBSITE_SETUP_FLOW } from "./websiteSetup.ts";
import { CREATE_EVENT_FLOW } from "./offerings/event.ts";
import { CREATE_TRIP_FLOW } from "./offerings/trip.ts";
import { CREATE_EXPERIENCE_FLOW } from "./offerings/experience.ts";
import { CREATE_VENUE_FLOW } from "./offerings/venue.ts";
import { CREATE_STAY_FLOW } from "./offerings/stay.ts";
import { IMPORT_CONTACTS_FLOW } from "./contactImport.ts";
import { BRAND_SETUP_FLOW } from "./brandSetup.ts";
import type {
  FlowContext,
  FlowDefinition,
  ProbeResult,
  StepDefinition,
} from "./types.ts";

export type OfferingFlowKey =
  | "create_event"
  | "create_experience"
  | "create_trip"
  | "create_venue"
  | "create_stay";

function offeringStep(): StepDefinition {
  return {
    key: "offering",
    title: "Build it",
    kind: "subflow",
    depends_on: ["brand_blockers", "brand_can_wait", "money_gate"],
    policy: "blocking",
    async probe(ctx: FlowContext): Promise<ProbeResult> {
      const { def, run } = ctx;
      if (run.subject_id && def.subject_table) {
        const exists = await ctx.deps.subjectExists(
          def.subject_table,
          run.subject_id,
        );
        if (exists) {
          return {
            done: true,
            evidence: {
              probe: `${def.subject_table}_exists`,
              observed: run.subject_id,
            },
          };
        }
      }
      if (!def.subject_table && ctx.state?.state === "delegated") {
        // P3: this offering's own lane owns creation (P7–P9 bring it onto the
        // engine). The preamble is what this run verified.
        return {
          done: true,
          evidence: {
            probe: "handed_to_offering_lane",
            observed: Object.fromEntries(
              Object.entries(run.step_states).map((
                [key, value],
              ) => [key, value.state]),
            ),
          },
        };
      }
      return { done: false, delegate: true };
    },
  };
}

function summaryStep(): StepDefinition {
  return {
    key: "summary",
    title: "Wrap up",
    kind: "summary",
    depends_on: ["offering"],
    policy: "blocking",
    probe(): Promise<ProbeResult> {
      // The runner builds the summary from evidence; nothing to ask here.
      return Promise.resolve({
        done: true,
        evidence: { probe: "summary", observed: true },
      });
    },
  };
}

function offeringFlow(args: {
  key: OfferingFlowKey;
  noun: string;
  draft: ReadinessAction;
  publish: ReadinessAction;
  publishPaid: ReadinessAction | null;
  subjectTools: string[];
  subjectTable: string | null;
}): FlowDefinition {
  return {
    key: args.key,
    version: 1,
    title: `Create ${args.noun === "event" ? "an" : "a"} ${args.noun}`,
    subject: "offering",
    concurrency: "one_per_subject",
    noun: args.noun,
    readiness: {
      draft: args.draft,
      publish: args.publish,
      publish_paid: args.publishPaid,
    },
    subject_tools: args.subjectTools,
    subject_table: args.subjectTable,
    steps: [
      brandBlockersStep,
      brandCanWaitStep,
      moneyGateStep,
      offeringStep(),
      summaryStep(),
    ],
  };
}

export const FLOW_DEFINITIONS: readonly FlowDefinition[] = Object.freeze([
  offeringFlow({
    key: "create_event",
    noun: "event",
    draft: "draft_save",
    publish: "publish_free",
    publishPaid: "publish_paid",
    subjectTools: ["create_event"],
    subjectTable: "events",
  }),
  offeringFlow({
    key: "create_experience",
    noun: "experience",
    draft: "draft_save",
    publish: "publish_free",
    publishPaid: "publish_paid",
    subjectTools: ["create_experience"],
    subjectTable: null,
  }),
  offeringFlow({
    key: "create_trip",
    noun: "trip",
    draft: "draft_save",
    publish: "publish_free",
    publishPaid: "publish_paid",
    subjectTools: ["create_trip"],
    subjectTable: null,
  }),
  offeringFlow({
    key: "create_venue",
    noun: "venue",
    draft: "venue_submit",
    publish: "venue_submit",
    publishPaid: null,
    subjectTools: ["create_venue"],
    subjectTable: null,
  }),
  offeringFlow({
    key: "create_stay",
    noun: "stay",
    draft: "stay_publish",
    publish: "stay_publish",
    publishPaid: null,
    subjectTools: ["create_stay_offering"],
    subjectTable: null,
  }),
  // #3355 P7 — events on the engine (v2); v1 above lets older runs finish.
  CREATE_EVENT_FLOW,
  // #3355 P8 — trips on the engine (v2); v1 above lets older runs finish.
  CREATE_TRIP_FLOW,
  // #3355 P9 — experiences, venues and stays on the engine (v2); their v1
  // definitions above let older runs finish.
  CREATE_EXPERIENCE_FLOW,
  CREATE_VENUE_FLOW,
  CREATE_STAY_FLOW,
  // #2830 P4 — Website setup, the engine's first brand flow.
  WEBSITE_SETUP_FLOW,
  // #3355 — a contact list for blasts and outreach, through Ari.
  IMPORT_CONTACTS_FLOW,
  // #4389 — bank country, then Terms + payment details on the secure screen.
  BRAND_SETUP_FLOW,
]);

/**
 * Version rule: a run finishes on the definition it started with while that
 * version is registered; otherwise the latest version re-plans from probes
 * (probes are idempotent, so re-planning is safe).
 */
export function findFlowDefinition(
  key: string,
  version?: number,
): FlowDefinition | null {
  const candidates = FLOW_DEFINITIONS.filter((def) => def.key === key);
  if (candidates.length === 0) return null;
  return candidates.find((def) => def.version === version) ??
    candidates.reduce((a, b) => (b.version > a.version ? b : a));
}

const CREATE_VERB =
  /\b(?:create|make|set\s*up|start|plan|host|launch|add|build|organi[sz]e|throw|put on|schedule)\b/i;
const OFFERING_NOUNS: ReadonlyArray<[OfferingFlowKey, RegExp]> = [
  ["create_stay", /\b(?:stays?|accommodation|lodging)\b/i],
  ["create_venue", /\bvenues?\b/i],
  ["create_trip", /\b(?:trips?|tours?|retreats?|getaways?)\b/i],
  ["create_experience", /\bexperiences?\b/i],
  ["create_event", /\b(?:events?|party|parties|gatherings?|show)\b/i],
];
const QUESTION_LEAD =
  /^(?:how|what|why|where|when|which|who|do i|does|is|are|should)\b/i;
const NOT_A_CREATE =
  /\b(?:show me|list|how many|edit|update|change|rename|delete|remove|cancel|publish|duplicate|copy|website|flyer|poster|campaign|blast|ad|ads)\b/i;

/**
 * #3355 Wave A (A1) — things a host creates that are NOT an offering. When a
 * create verb's object is one of these ("create discount codes … of my
 * event", "set up ticket tiers for my event"), the offering noun later in the
 * sentence only says what the thing is FOR, so no offering flow starts and
 * the model reads the request (production 2026-11-10, run 8a841954).
 */
const NON_OFFERING_OBJECT =
  /\b(?:discounts?|(?:discount|promo|coupon|voucher|access|referral)\s+codes?|codes?|promos?|promotions?|coupons?|vouchers?|sale\s+prices?|ticket\s+(?:tiers?|types?|prices?)|tiers?|tickets?|refunds?|payouts?|guest\s*lists?|invites?|invitations?|team\s+members?|teammates?|scanners?|campaigns?|emails?|messages?|blasts?|reports?|websites?|flyers?|posters?)\b/i;
const CREATE_VERB_ALL = new RegExp(CREATE_VERB.source, "gi");
const ANY_OFFERING_NOUN = new RegExp(
  OFFERING_NOUNS.map(([, noun]) => noun.source).join("|"),
  "i",
);

/** The first create verb whose object is a non-offering thing, if any. */
function createsNonOffering(normalized: string): boolean {
  for (const verb of normalized.matchAll(CREATE_VERB_ALL)) {
    const after = normalized.slice((verb.index ?? 0) + verb[0].length);
    // The verb's clause: up to the next sentence break or "and <verb>".
    const clause = after.split(/[.;!?]|\band\b(?=\s+(?:then\s+)?[a-z]+)/i)[0]
      .slice(0, 120);
    const object = NON_OFFERING_OBJECT.exec(clause);
    if (!object) continue;
    const offering = ANY_OFFERING_NOUN.exec(clause);
    // "create discount codes … for my event": the code comes first.
    if (!offering || object.index < offering.index) return true;
  }
  return false;
}

/**
 * Deterministic offering intent ("create an event", "I want to plan a trip").
 * Questions about offerings ("how do I create an event?"), reads ("list my
 * events") and edits are not intents; the verb must come before the noun.
 * #3355 Wave A: a create verb whose object is a non-offering thing (a code,
 * a ticket tier, a refund…) is not an offering intent either.
 */
export function classifyOfferingIntent(
  text: string,
  /**
   * #3355 ship-prep: the rollout switch's off path keeps origin/main's
   * classifier (without the Wave A non-offering rule).
   */
  options: { legacy?: boolean } = {},
): OfferingFlowKey | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 600) return null;
  if (QUESTION_LEAD.test(normalized)) return null;
  if (NOT_A_CREATE.test(normalized)) return null;
  if (!options.legacy && createsNonOffering(normalized)) return null;
  const verb = CREATE_VERB.exec(normalized);
  if (!verb) return null;
  let best: { key: OfferingFlowKey; index: number } | null = null;
  for (const [key, noun] of OFFERING_NOUNS) {
    const nounMatch = noun.exec(normalized.slice(verb.index));
    if (!nounMatch || nounMatch.index > 80) continue;
    if (!best || nounMatch.index < best.index) {
      best = { key, index: nounMatch.index };
    }
  }
  return best?.key ?? null;
}

const PAID_SIGNAL =
  /\b(?:paid|sell(?:ing)?\s+tickets?|ticket\s+price|charge|£|\$|€|₦|naira|pounds?|dollars?|euros?)|[£$€₦]\s?\d/i;
const FREE_SIGNAL = /\b(?:free|no charge|rsvp only)\b/i;

export function intentWantsPaid(text: string): boolean {
  return PAID_SIGNAL.test(text) && !FREE_SIGNAL.test(text);
}

const INSTALLMENT_SIGNAL =
  /\b(?:deposits?|instal?lments?|payment plans?|pay in (?:parts|stages)|pay monthly)\b/i;

/** #3355 P6: a trip with deposits or instalments needs payouts to the bank. */
export function intentWantsInstallments(text: string): boolean {
  return INSTALLMENT_SIGNAL.test(text);
}

export const READINESS_ACTION_WORDS: Readonly<Record<ReadinessAction, string>> =
  Object.freeze({
    draft_save: "save a draft",
    publish_free: "publish",
    publish_paid: "sell paid tickets",
    trip_installments: "take trip deposits or instalments",
    venue_submit: "submit a venue",
    stay_publish: "publish a stay",
    website_build: "build your Website",
    website_publish: "publish your Website",
    refund: "issue refunds",
    bank_setup: "get paid out to your bank",
    brand_setup: "finish setting up this brand",
  });

const READINESS_ASK =
  /\b(?:what(?:'s| is| does| do)?|which|anything|is there anything|am i|are we|can i|can we)\b[\s\S]{0,60}\b(?:need|needs|missing|left|still|ready|before|blocking|stop(?:ping)?)\b/i;

/**
 * Deterministic readiness questions ("What does my brand still need before I
 * can sell paid tickets?"). Returns the action, or "all" for the whole list.
 * Null when the text is not a readiness question.
 */
export function classifyReadinessQuestion(
  text: string,
): ReadinessAction | "all" | null {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 300) return null;
  if (!READINESS_ASK.test(normalized)) return null;
  if (
    !/\b(?:brand|profile|account|we|i|my|us)\b/i.test(normalized) ||
    /\b(?:event|trip|experience)\s+(?:need|needs)\b/i.test(normalized)
  ) return null;
  if (
    /\b(?:sell|paid|ticket sales|take payments?|charge)\b/i.test(normalized)
  ) {
    return "publish_paid";
  }
  if (/\b(?:payout|paid out|bank)\b/i.test(normalized)) return "bank_setup";
  if (/\brefund/i.test(normalized)) return "refund";
  if (/\bwebsite\b/i.test(normalized)) {
    return /\bpublish|live\b/i.test(normalized)
      ? "website_publish"
      : "website_build";
  }
  if (/\b(?:deposit|instal?lments?)\b/i.test(normalized)) {
    return "trip_installments";
  }
  if (/\bstay\b/i.test(normalized)) return "stay_publish";
  if (/\bvenue\b/i.test(normalized)) return "venue_submit";
  if (/\b(?:publish|go live|launch)\b/i.test(normalized)) return "publish_free";
  if (/\b(?:need|missing|left|ready)\b/i.test(normalized)) return "all";
  return null;
}

export { listWords };
