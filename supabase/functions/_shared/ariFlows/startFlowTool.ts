/**
 * Issue #3355 Wave E (E1/D3a) — `start_flow`, the one way a guided setup
 * starts from typed words.
 *
 * Before Wave E, keyword classifiers in front of the model started setups
 * (`classifyOfferingIntent`, `isContactImportIntent`, `isWebsiteSetupRequest`)
 * and routed "create … event" to the event slot planner. Production
 * 2026-11-10: "I want to create discount codes for influencers … of my
 * event" was put into event setup and the model never saw it. Now the model
 * reads the request and calls `start_flow`; the classifiers are labelled
 * hints it may ignore.
 *
 * `start_flow` is a loop control, not a domain tool: it writes nothing but
 * the setup's own run (the same `ari_flow_run_start` the keyword lane used),
 * needs no confirmation card, and every step of the setup keeps its server
 * checks (brand blockers, the money gate, readiness, and one protected
 * proposal per write). The setup's facts come from the host's own words
 * (provenance "owner"); the model's `prefills` are kept as engine hints and
 * never become a fact.
 *
 * MINGLA-INVARIANT: I-ARI-FLOWS-START-BY-TOOL | issue #3355 | A guided setup (create_event/trip/experience/venue/stay, website_setup, import_contacts) starts from typed words only when the model calls start_flow with a registered flow_key; no keyword classifier starts a setup or routes to the event slot planner before the model. Enforced by supabase/functions/_shared/__tests__/issue_3355_wave_e_start_flow.implementor.test.ts
 */

import { FLOW_DEFINITIONS } from "./index.ts";

export const ARI_START_FLOW_TOOL = "start_flow";

/** Every registered flow key, once (versions collapse). */
export const ARI_START_FLOW_KEYS: readonly string[] = Object.freeze([
  ...new Set(FLOW_DEFINITIONS.map((def) => def.key)),
]);

/** What each setup is, for the model (keys are the flow registry's). */
const FLOW_WORDS: Readonly<Record<string, string>> = Object.freeze({
  create_event: "a new event (party, show, gathering) from scratch",
  create_trip: "a new trip, tour or retreat",
  create_experience: "a new experience (a class, a tasting, a tour stop)",
  create_venue: "list a new venue",
  create_stay: "a new stay (accommodation)",
  website_setup: "set up or continue the brand's Website",
  import_contacts: "import or upload a customer / contact list",
});

const MAX_PREFILLS = 8;
const MAX_TEXT = 600;

export interface AriStartFlowArgs {
  flow_key: string;
  intent_text: string;
  prefills: Record<string, string | number | boolean>;
}

/** The Gemini declaration (offered only when a setup could start). */
export const ARI_START_FLOW_DECLARATION = Object.freeze({
  name: ARI_START_FLOW_TOOL,
  description:
    "Start a guided setup that walks the host through creating something step by step. Use it only when the host asks to create or set up one of these from scratch: " +
    ARI_START_FLOW_KEYS.map((key) => `${key} = ${FLOW_WORDS[key] ?? key}`)
      .join("; ") +
    ". Do not use it for discount codes, ticket tiers, refunds, payouts, campaigns, edits, lists or questions: those use their own tools. It saves nothing by itself; the setup asks the host one thing at a time and every change still needs the host's approval. intent_text is the host's request in their words. prefills are values the host stated (title, date, price) — the setup checks them again.",
  parameters: {
    type: "object",
    properties: {
      flow_key: { type: "string", enum: [...ARI_START_FLOW_KEYS] },
      intent_text: { type: "string" },
      prefills: {
        type: "object",
        properties: {
          title: { type: "string" },
          date: { type: "string" },
          price: { type: "number" },
          currency: { type: "string" },
          paid: { type: "boolean" },
          capacity: { type: "integer" },
          city: { type: "string" },
          venue: { type: "string" },
        },
      },
    },
    required: ["flow_key"],
  },
});

/**
 * Strict check of the model's start_flow call. Null = not a valid call (the
 * loop returns it to the model as an unknown capability, so it can repair).
 */
export function parseStartFlowArgs(args: unknown): AriStartFlowArgs | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const raw = args as Record<string, unknown>;
  const allowed = new Set(["flow_key", "intent_text", "prefills"]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return null;
  if (
    typeof raw.flow_key !== "string" ||
    !ARI_START_FLOW_KEYS.includes(raw.flow_key)
  ) return null;
  if (raw.intent_text !== undefined && typeof raw.intent_text !== "string") {
    return null;
  }
  const prefills: Record<string, string | number | boolean> = {};
  if (raw.prefills !== undefined && raw.prefills !== null) {
    if (typeof raw.prefills !== "object" || Array.isArray(raw.prefills)) {
      return null;
    }
    const entries = Object.entries(raw.prefills as Record<string, unknown>);
    if (entries.length > MAX_PREFILLS) return null;
    for (const [key, value] of entries) {
      if (!/^[a-z_]{1,32}$/.test(key)) return null;
      if (typeof value === "string") prefills[key] = value.slice(0, 200);
      else if (typeof value === "number" && Number.isFinite(value)) {
        prefills[key] = value;
      } else if (typeof value === "boolean") prefills[key] = value;
      else return null;
    }
  }
  return {
    flow_key: raw.flow_key,
    intent_text: typeof raw.intent_text === "string"
      ? raw.intent_text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT)
      : "",
    prefills,
  };
}
