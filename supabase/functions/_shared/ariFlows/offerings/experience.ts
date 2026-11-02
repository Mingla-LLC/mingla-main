/**
 * Issue #3355 P9 — "Create an experience" on the flow engine.
 *
 *   brand_gate (draft) → money_gate (only when the request asks for paid) →
 *   title → description (saved exactly as written, 10–500 characters) →
 *   vibe (the server's four experience intents) → stops, 1 to 5, each a name,
 *   a short description and a place picked from the address search ("Add
 *   another stop" / "That's all") → time zone (the brand's, else its
 *   country's, else asked) → date and start time → end time → ONE create
 *   proposal → read back → "get it ready to publish?" → free or paid → the
 *   payout-country question when the brand has no currency → the price per
 *   person → ONE price proposal → publish-readiness from the Host publish
 *   checks + brand_readiness → publish ONLY when the owner asks, behind its
 *   own protected confirmation.
 *
 * Every saved fact is the owner's (I-ARI-NO-INVENTED-FACTS): typed or picked
 * on a card, or the brand's own time zone shown on the create card they
 * confirm. No default price: the draft is saved "price not set" (not free)
 * until the owner chooses.
 */

import { brandBlockersStep, brandCanWaitStep, listWords } from "../brandGate.ts";
import { moneyGateStep } from "../moneyGate.ts";
import { marketDefaultTimezone } from "../../agentAri10xTools.ts";
import { isValidIanaTimezone } from "../../agentRelativeTime.ts";
import {
  attemptOf,
  choiceQuestion,
  formRendition,
  formResponse,
  problemOf,
  proposalOpen,
  publishBlockerClause,
  retry,
  textQuestion,
  typedAnswer,
  UNPUBLISHED_DRAFT_WORDS,
} from "./event.ts";
import {
  cleanTitle,
  extractEventTitle,
  formatEventClock,
  formatEventStart,
  parseEventEnd,
  parseEventStart,
  parseTimezoneAnswer,
  type PickedPlace,
  zoneWords,
} from "./eventFacts.ts";
import {
  doneWith as done,
  failedReason,
  offeringPriceStep,
  ownerAnswer as owner,
  priceAnswer,
  priceWords,
} from "./offeringPrice.ts";
import type {
  AnswerOutcome,
  FlowContext,
  FlowDefinition,
  FlowEvidence,
  FlowExperienceRow,
  FlowRun,
  ProbeResult,
  StepDefinition,
} from "../types.ts";

export const EXPERIENCE_FLOW_VERSION = 2;
const NOUN = "experience";
const FORM_ANSWER = "answer";
export const MAX_STOPS = 5;
/** The Host and server limits on an experience description. */
export const DESCRIPTION_MIN = 10;
export const DESCRIPTION_MAX = 500;

/** The server's canonical experience intents, with the Host's labels. */
export const EXPERIENCE_VIBES: ReadonlyArray<{ id: string; label: string }> =
  Object.freeze([
    { id: "adventurous", label: "Adventurous" },
    { id: "first-date", label: "First Dates" },
    { id: "romantic", label: "Romantic" },
    { id: "group-fun", label: "Group Fun" },
  ]);

export type ExperienceStop = {
  name: string;
  description: string;
  place: PickedPlace;
};

/**
 * The stop being added. `added` marks "just saved, ask about another" so the
 * "Add another stop / That's all" card comes before the next stop's name.
 */
type StopDraft = { name?: string; description?: string; added?: boolean };

function answer(run: FlowRun, key: string): unknown {
  return run.answers[key]?.value;
}

function stringAnswer(run: FlowRun, key: string): string | null {
  const value = answer(run, key);
  return typeof value === "string" && value.trim() ? value : null;
}

function intentText(run: FlowRun): string {
  const text = answer(run, "intent_text");
  return typeof text === "string" ? text : "";
}

function observedOf(ctx: FlowContext, step: string): unknown {
  return ctx.run.step_states[step]?.evidence?.observed;
}

export function stopsOf(run: FlowRun): ExperienceStop[] {
  const value = answer(run, "stops");
  return Array.isArray(value) ? value as ExperienceStop[] : [];
}

function stopDraft(run: FlowRun): StopDraft {
  const value = answer(run, "stop_draft");
  return value && typeof value === "object" ? value as StopDraft : {};
}

function stopsFinished(run: FlowRun): boolean {
  return answer(run, "stops_done") === true || stopsOf(run).length >= MAX_STOPS;
}

type ExperienceFacts = {
  title: string | null;
  description: string | null;
  intents: string[];
  stops: ExperienceStop[];
  timezone: string | null;
  timezone_source: "owner" | "brand" | "country" | null;
  start_at: string | null;
  end_at: string | null;
};

export function experienceFacts(ctx: FlowContext): ExperienceFacts {
  const run = ctx.run;
  const pinnedTitle = observedOf(ctx, "experience_title");
  const tz = observedOf(ctx, "experience_timezone") as
    | { timezone?: unknown; source?: unknown }
    | undefined;
  const ownerZone = stringAnswer(run, "timezone");
  const intents = answer(run, "intents");
  return {
    title: stringAnswer(run, "title") ??
      (typeof pinnedTitle === "string" ? pinnedTitle : null) ??
      extractEventTitle(intentText(run), ctx.brandName) ?? null,
    description: stringAnswer(run, "description"),
    intents: Array.isArray(intents)
      ? intents.filter((id): id is string => typeof id === "string")
      : [],
    stops: stopsOf(run),
    timezone: ownerZone ??
      (typeof tz?.timezone === "string" ? tz.timezone : null),
    timezone_source: ownerZone
      ? "owner"
      : tz?.source === "brand" || tz?.source === "country"
      ? tz.source
      : null,
    start_at: stringAnswer(run, "start_at"),
    end_at: stringAnswer(run, "end_at"),
  };
}

// ── Draft facts ────────────────────────────────────────────────────────────

const titleStep: StepDefinition = {
  key: "experience_title",
  title: "Experience name",
  kind: "question",
  depends_on: ["brand_blockers", "brand_can_wait", "money_gate"],
  policy: "blocking",
  probe(ctx) {
    const { title } = experienceFacts(ctx);
    if (title) return Promise.resolve(done("owner_title", title));
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "title",
        title: "Experience name",
        text: "What's the experience called?",
        label: "Experience name",
        placeholder: "e.g. Lagos Street Food Trail",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const title = cleanTitle(response);
    if (title.length < 2) {
      return Promise.resolve(
        retry(ctx, "I need a name of at least two letters."),
      );
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { title: owner(title) },
    });
  },
};

const descriptionStep: StepDefinition = {
  key: "experience_description",
  title: "Description",
  kind: "question",
  depends_on: ["experience_title"],
  policy: "blocking",
  probe(ctx) {
    const { description } = experienceFacts(ctx);
    if (description) return Promise.resolve(done("owner_description", true));
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "description",
        title: "Description",
        text:
          "Describe the experience in a sentence or two — what guests will do. I'll save exactly what you write.",
        label: "Description",
        placeholder: "e.g. Taste your way through five of Lagos's best street food stalls.",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const description = response.trim();
    if (
      description.length < DESCRIPTION_MIN ||
      description.length > DESCRIPTION_MAX
    ) {
      return Promise.resolve(retry(
        ctx,
        `A description needs ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX} characters. Nothing was saved.`,
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { description: owner(description) },
    });
  },
};

const VIBE_BY_LABEL: ReadonlyMap<string, string> = new Map(
  EXPERIENCE_VIBES.flatMap((vibe) => [
    [vibe.label.toLowerCase(), vibe.id],
    [vibe.id, vibe.id],
  ]),
);

const vibeStep: StepDefinition = {
  key: "experience_vibe",
  title: "Vibe",
  kind: "question",
  depends_on: ["experience_description"],
  policy: "blocking",
  probe(ctx) {
    const { intents } = experienceFacts(ctx);
    if (intents.length > 0) return Promise.resolve(done("owner_intents", intents));
    const problem = problemOf(ctx);
    const body = "What's the vibe? Pick one or more.";
    return Promise.resolve({
      done: false,
      ask: {
        kind: "question",
        answer_mode: "form",
        reuse_key: `${NOUN}:vibe:${attemptOf(ctx)}`,
        title: "Vibe",
        text: `${problem ? `${problem} ` : ""}${body}`,
        options: [],
        rendition: formRendition({
          id: "vibe",
          noun: NOUN,
          title: "Vibe",
          body,
          choices: { options: [...EXPERIENCE_VIBES], multiple: true },
          problem,
        }),
        record: { data: { attempt: attemptOf(ctx) } },
      },
    });
  },
  textAnswer(_ctx, text) {
    const labels = text.split(/,|\band\b/i).map((part) => part.trim())
      .filter((part) => VIBE_BY_LABEL.has(part.toLowerCase()));
    return labels.length > 0
      ? { choices: labels, country: null, response: "" }
      : null;
  },
  onAnswer(ctx, choiceId, given) {
    if (choiceId !== FORM_ANSWER || !given?.values) {
      return Promise.resolve(null);
    }
    const chosen = new Set(
      given.values.choices.flatMap((label) => {
        const id = VIBE_BY_LABEL.get(label.toLowerCase());
        return id ? [id] : [];
      }),
    );
    // The server's own order (EXPERIENCE_INTENTS on the Host).
    const intents = EXPERIENCE_VIBES.map((vibe) => vibe.id).filter((id) =>
      chosen.has(id)
    );
    if (intents.length === 0) {
      return Promise.resolve(
        retry(ctx, "Pick at least one vibe. Nothing was saved."),
      );
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { intents: owner(intents) },
    });
  },
};

// ── Stops (1–5): name → description → place → "another?" ──────────────────

function stopNumber(run: FlowRun): number {
  return stopsOf(run).length + 1;
}

const stopNameStep: StepDefinition = {
  key: "experience_stop_name",
  title: "Stop name",
  kind: "question",
  depends_on: ["experience_vibe"],
  policy: "blocking",
  probe(ctx) {
    const run = ctx.run;
    if (stopsFinished(run)) return Promise.resolve(done("stops_finished", stopsOf(run).length));
    const draft = stopDraft(run);
    if (draft.added) return Promise.resolve(done("stop_added", stopsOf(run).length));
    if (draft.name) return Promise.resolve(done("owner_stop_name", draft.name));
    const n = stopNumber(run);
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: `stop${n}:name`,
        title: `Stop ${n}`,
        text: n === 1
          ? "Let's add the stops — one stop is fine. What's the first stop called?"
          : `What's stop ${n} called?`,
        label: "Stop name",
        placeholder: "e.g. Rooftop welcome drinks",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const name = cleanTitle(response);
    if (name.length < 2) {
      return Promise.resolve(retry(ctx, "I need a stop name of at least two letters."));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { stop_draft: owner({ name }) },
    });
  },
};

const stopDescriptionStep: StepDefinition = {
  key: "experience_stop_description",
  title: "Stop description",
  kind: "question",
  depends_on: ["experience_stop_name"],
  policy: "blocking",
  probe(ctx) {
    const run = ctx.run;
    if (stopsFinished(run)) return Promise.resolve(done("stops_finished", true));
    const draft = stopDraft(run);
    if (draft.added) return Promise.resolve(done("stop_added", stopsOf(run).length));
    if (draft.description) return Promise.resolve(done("owner_stop_description", true));
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: `stop${stopNumber(run)}:description`,
        title: `Stop ${stopNumber(run)}`,
        text: `What happens at "${draft.name ?? "this stop"}"? One short line.`,
        label: "What happens here",
        placeholder: "e.g. A welcome cocktail with views over the lagoon.",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const description = response.trim();
    if (description.length < 2 || description.length > 280) {
      return Promise.resolve(retry(
        ctx,
        "A stop description needs a short line (up to 280 characters). Nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: {
        stop_draft: owner({ ...stopDraft(ctx.run), description }),
      },
    });
  },
};

const stopPlaceStep: StepDefinition = {
  key: "experience_stop_place",
  title: "Stop place",
  kind: "question",
  depends_on: ["experience_stop_description"],
  policy: "blocking",
  probe(ctx) {
    const run = ctx.run;
    if (stopsFinished(run)) return Promise.resolve(done("stops_finished", true));
    const draft = stopDraft(run);
    if (draft.added) {
      // The stop was just added; the "another stop?" card is next.
      return Promise.resolve(done("stop_added", stopsOf(run).length));
    }
    const problem = problemOf(ctx);
    // The Host shows its address search (MapboxAddressInput) on this card.
    return Promise.resolve({
      done: false,
      ask: {
        kind: "question",
        answer_mode: "form",
        reuse_key: `${NOUN}:stop${stopNumber(run)}:place:${attemptOf(ctx)}`,
        title: `Where is "${draft.name ?? `stop ${stopNumber(run)}`}"?`,
        text: `${
          problem ? `${problem} ` : ""
        }Where is "${draft.name ?? "this stop"}"? Pick the address from the search suggestions, so guests can find it.`,
        options: [],
        record: { data: { attempt: attemptOf(ctx) } },
      },
    });
  },
  onAnswer(ctx, choiceId, given) {
    if (choiceId !== FORM_ANSWER) return Promise.resolve(null);
    const place = given?.values?.place;
    const draft = stopDraft(ctx.run);
    if (!place) {
      return Promise.resolve(retry(
        ctx,
        "Pick the address from the search suggestions. Nothing was saved.",
      ));
    }
    if (!draft.name || !draft.description) return Promise.resolve(null);
    const stop: ExperienceStop = {
      name: draft.name,
      description: draft.description,
      place,
    };
    return Promise.resolve({
      record: { state: "pending" },
      answers: {
        stops: owner([...stopsOf(ctx.run), stop]),
        stop_draft: owner({ added: true }),
      },
    });
  },
};

const stopMoreStep: StepDefinition = {
  key: "experience_stop_more",
  title: "More stops",
  kind: "question",
  depends_on: ["experience_stop_place"],
  policy: "blocking",
  probe(ctx) {
    const run = ctx.run;
    const stops = stopsOf(run);
    if (answer(run, "stops_done") === true) {
      return Promise.resolve(done("owner_stops_done", stops.length));
    }
    if (stops.length >= MAX_STOPS) {
      return Promise.resolve({
        done: true,
        note: `That's ${MAX_STOPS} stops, the most an experience can have.`,
        evidence: { probe: "stop_limit", observed: stops.length },
      });
    }
    const last = stops[stops.length - 1];
    return Promise.resolve({
      done: false,
      ask: choiceQuestion({
        noun: NOUN,
        key: `stops:${stops.length}`,
        title: "Another stop?",
        text: `Added "${last?.name ?? "the stop"}". Add another stop, or is that all?`,
        options: [
          { id: "another", label: "Add another stop" },
          { id: "done", label: "That's all" },
        ],
      }),
    });
  },
  onAnswer(_ctx, choiceId) {
    if (choiceId === "another") {
      return Promise.resolve({
        record: { state: "pending" },
        answers: { stop_draft: owner({}) },
      });
    }
    if (choiceId !== "done") return Promise.resolve(null);
    return Promise.resolve({
      record: { state: "pending" },
      answers: { stops_done: owner(true) },
    });
  },
};

// ── When ───────────────────────────────────────────────────────────────────

const timezoneStep: StepDefinition = {
  key: "experience_timezone",
  title: "Time zone",
  kind: "question",
  depends_on: ["experience_stop_more"],
  policy: "blocking",
  async probe(ctx) {
    const ownerZone = stringAnswer(ctx.run, "timezone");
    if (ownerZone) {
      return done("owner_timezone", { timezone: ownerZone, source: "owner" });
    }
    // The brand's own zone, else its country's single zone; both are shown
    // on the create card the owner confirms. Never UTC by default.
    const brand = await ctx.deps.brandFacts?.() ?? null;
    if (brand?.default_timezone && isValidIanaTimezone(brand.default_timezone)) {
      return done("brand_timezone", {
        timezone: brand.default_timezone,
        source: "brand",
      });
    }
    const country = marketDefaultTimezone(brand?.country_code);
    if (country) {
      return done("country_timezone", { timezone: country, source: "country" });
    }
    return {
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "timezone",
        title: "Time zone",
        text:
          "What time zone is the experience in? Tell me the city — for example London, Lagos or New York.",
        label: "City or time zone",
        placeholder: "e.g. Lagos",
      }),
    };
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const zone = parseTimezoneAnswer(response);
    if (!zone) {
      return Promise.resolve(retry(
        ctx,
        "I couldn't match that to a time zone, so nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { timezone: owner(zone) },
    });
  },
};

const startStep: StepDefinition = {
  key: "experience_start",
  title: "Date and start time",
  kind: "question",
  depends_on: ["experience_timezone"],
  policy: "blocking",
  probe(ctx) {
    const { start_at } = experienceFacts(ctx);
    if (start_at) return Promise.resolve(done("owner_start", start_at));
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "start",
        title: "Date and start time",
        text:
          "When does it start? Tell me the date and start time — for example Saturday 14 November at 6pm.",
        label: "Date and start time",
        placeholder: "e.g. Saturday 14 November at 6pm",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const { timezone } = experienceFacts(ctx);
    const start = timezone
      ? parseEventStart(response, timezone, new Date())
      : null;
    if (!start) {
      return Promise.resolve(retry(
        ctx,
        "I couldn't read a future date and start time from that, so nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { start_at: owner(start), end_at: owner(null) },
    });
  },
};

const endStep: StepDefinition = {
  key: "experience_end",
  title: "End time",
  kind: "question",
  depends_on: ["experience_start"],
  policy: "blocking",
  probe(ctx) {
    const { start_at, end_at, timezone } = experienceFacts(ctx);
    if (end_at) return Promise.resolve(done("owner_end", end_at));
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "end",
        title: "End time",
        text: `When does it end? It starts ${
          start_at && timezone
            ? formatEventStart(start_at, timezone)
            : "on the date you gave"
        }.`,
        label: "Ends at",
        placeholder: "e.g. 9pm",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const { start_at, timezone } = experienceFacts(ctx);
    if (!start_at || !timezone) return Promise.resolve(null);
    const end = parseEventEnd(response, start_at, timezone, new Date());
    if (!end) {
      return Promise.resolve(retry(
        ctx,
        "I couldn't read an end time after the start from that, so nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { end_at: owner(end) },
    });
  },
};

// ── The create proposal ───────────────────────────────────────────────────

/** "2026-11-14" and "18:00" in the experience's own time zone. */
function localParts(iso: string, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** A picked place as one experience stop (the wizard's stop shape). */
function stopArg(stop: ExperienceStop): Record<string, unknown> {
  const place = stop.place;
  return {
    name: stop.name,
    description: stop.description,
    address: place.address,
    city: place.city,
    ...(place.country_code ? { country_code: place.country_code } : {}),
    ...(place.place_id ? { place_id: place.place_id } : {}),
    lat: place.lat,
    lng: place.lng,
    // The Host reads precision from the pick (#1629): a street address or a
    // named place is a real point; anything else is an area.
    coordinate_precision: place.feature_type === "address" ||
        place.feature_type === "poi"
      ? "exact"
      : "approximate",
  };
}

/** The create_experience args — only the owner's facts. */
export function createExperienceArgs(
  brandId: string,
  facts: ExperienceFacts,
): Record<string, unknown> | null {
  if (
    !facts.title || !facts.description || facts.intents.length === 0 ||
    facts.stops.length === 0 || facts.stops.length > MAX_STOPS ||
    !facts.timezone || !facts.start_at || !facts.end_at
  ) return null;
  const start = localParts(facts.start_at, facts.timezone);
  const end = localParts(facts.end_at, facts.timezone);
  return {
    brand_id: brandId,
    title: facts.title,
    narrative: facts.description,
    experience_intents: facts.intents,
    stops: facts.stops.map(stopArg),
    location_mode: "per_stop",
    // No default price: "whole" with is_free false is the Host draft's
    // "price not set yet"; the price is asked when getting it ready.
    pricing_mode: "whole",
    is_free: false,
    timezone: facts.timezone,
    whenMode: "single",
    when: { date: start.date, doorsOpen: start.time, endsAt: end.time },
  };
}

export function createExperienceRows(
  facts: ExperienceFacts,
): { label: string; value: string }[] {
  const tz = facts.timezone ?? "UTC";
  const vibes = facts.intents.map((id) =>
    EXPERIENCE_VIBES.find((vibe) => vibe.id === id)?.label ?? id
  );
  return [
    { label: "Description", value: facts.description ?? "" },
    { label: "Vibe", value: vibes.join(", ") },
    ...facts.stops.map((stop, index) => ({
      label: `Stop ${index + 1}`,
      value: `${stop.name} — ${stop.description} (${stop.place.address})`,
    })),
    {
      label: "When",
      value: facts.start_at && facts.end_at
        ? `${formatEventStart(facts.start_at, tz)} – ${
          formatEventClock(facts.end_at, tz)
        }`
        : "",
    },
    {
      label: "Time zone",
      value: `${zoneWords(tz)}${
        facts.timezone_source === "brand"
          ? ", from your brand"
          : facts.timezone_source === "country"
          ? ", from your brand's country"
          : ""
      }`,
    },
    { label: "Price", value: "Not set yet — I'll ask when you get it ready" },
    { label: "Status", value: UNPUBLISHED_DRAFT_WORDS },
  ].filter((row) => row.value);
}

async function experienceRow(
  ctx: FlowContext,
): Promise<FlowExperienceRow | null> {
  if (!ctx.run.subject_id || !ctx.deps.experienceRow) return null;
  return await ctx.deps.experienceRow(ctx.run.subject_id);
}

const createStep: StepDefinition = {
  key: "experience_create",
  title: "Create the draft",
  kind: "proposal",
  depends_on: ["experience_end"],
  policy: "blocking",
  subject_tools: ["create_experience"],
  async probe(ctx): Promise<ProbeResult> {
    const proposed = ctx.state?.state === "awaiting_approval";
    const row = await experienceRow(ctx);
    if (row) {
      return {
        done: true,
        note: proposed
          ? `Saved and checked: "${row.title}" with ${row.stops.length} stop${
            row.stops.length === 1 ? "" : "s"
          } is an unpublished draft — nobody can see it until you publish.`
          : undefined,
        evidence: {
          probe: "experience_exists",
          observed: { id: row.id, title: row.title, stops: row.stops.length },
        },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const facts = experienceFacts(ctx);
    const args = createExperienceArgs(ctx.run.brand_id, facts);
    const refused = failedReason(
      ctx,
      "create_experience",
      "The draft wasn't created, so nothing was saved.",
    );
    const note = proposed && ctx.trigger === "confirm"
      ? refused ?? "The draft wasn't created, so nothing is shown as saved."
      : undefined;
    if (!args) {
      return {
        done: false,
        note,
        ask: choiceQuestion({
          noun: NOUN,
          key: "create:incomplete",
          title: "Create the draft",
          text: "I'm missing a detail for this experience, so nothing was created.",
          options: [{ id: "cancel", label: "Stop here" }],
        }),
      };
    }
    return {
      done: false,
      note,
      propose: {
        tool_name: "create_experience",
        tool_args: args,
        rows: createExperienceRows(facts),
        rows_only: true,
      },
      ask: choiceQuestion({
        noun: NOUN,
        key: "create:ready",
        title: "Create the draft",
        text: `Ready to save "${facts.title}" as an unpublished draft? Nobody can see it until you publish.`,
        options: [
          { id: "create", label: "Create the draft" },
          { id: "change_when", label: "Change the date" },
        ],
      }),
      record: { data: {} },
    };
  },
  onAnswer(ctx, choiceId) {
    if (choiceId === "cancel") {
      return Promise.resolve({
        record: { state: "asked" },
        cancel_run: true,
        ack: "Okay, I've stopped here. Nothing was created.",
      });
    }
    if (choiceId === "change_when") {
      return Promise.resolve({
        record: { state: "pending" },
        answers: { start_at: owner(null), end_at: owner(null) },
        ack: "Okay. Nothing was saved.",
      });
    }
    if (choiceId !== "create") return Promise.resolve(null);
    const facts = experienceFacts(ctx);
    const args = createExperienceArgs(ctx.run.brand_id, facts);
    if (!args) return Promise.resolve(null);
    return Promise.resolve({
      record: { state: "awaiting_approval", data: {} },
      propose: {
        tool_name: "create_experience",
        tool_args: args,
        rows: createExperienceRows(facts),
        rows_only: true,
      },
    });
  },
};

// ── Publish-ready facts (after the draft exists) ──────────────────────────

function wantsPublishReady(ctx: FlowContext): boolean {
  return answer(ctx.run, "publish_ready") === true;
}

/** The Host's "price set": free, or a whole price above zero. */
export function experienceHasPrice(row: FlowExperienceRow): boolean {
  return row.is_free || (row.whole_price_cents ?? 0) > 0;
}

const publishReadyStep: StepDefinition = {
  key: "experience_publish_ready",
  title: "Get it ready to publish",
  kind: "question",
  depends_on: ["experience_create"],
  policy: "blocking",
  probe(ctx) {
    const value = answer(ctx.run, "publish_ready");
    if (typeof value === "boolean") {
      return Promise.resolve(done("owner_publish_ready", value));
    }
    return Promise.resolve({
      done: false,
      ask: choiceQuestion({
        noun: NOUN,
        key: "publish_ready",
        title: "Get it ready to publish?",
        text: "Want to get it ready to publish? I'll need the price.",
        options: [
          { id: "yes", label: "Yes, get it ready" },
          { id: "not_now", label: "Not now" },
        ],
      }),
    });
  },
  onAnswer(_ctx, choiceId) {
    if (choiceId !== "yes" && choiceId !== "not_now") {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { publish_ready: owner(choiceId === "yes") },
    });
  },
};

async function needsPrice(ctx: FlowContext): Promise<boolean> {
  if (!wantsPublishReady(ctx)) return false;
  const row = await experienceRow(ctx);
  return !!row && !experienceHasPrice(row);
}

const priceKindStep: StepDefinition = {
  key: "experience_price_kind",
  title: "Free or paid",
  kind: "question",
  depends_on: ["experience_publish_ready"],
  policy: "blocking",
  async probe(ctx) {
    if (!await needsPrice(ctx)) return done("no_price_needed", true);
    const kind = answer(ctx.run, "price_kind");
    if (kind === "free" || kind === "paid") return done("owner_price_kind", kind);
    return {
      done: false,
      ask: choiceQuestion({
        noun: NOUN,
        key: "price_kind",
        title: "Free or paid",
        text: "Is the experience free or paid?",
        options: [
          { id: "free", label: "Free" },
          { id: "paid", label: "Paid" },
        ],
      }),
    };
  },
  onAnswer(_ctx, choiceId) {
    if (choiceId !== "free" && choiceId !== "paid") return Promise.resolve(null);
    return Promise.resolve({
      record: { state: "pending" },
      answers: { price_kind: owner(choiceId), paid: owner(choiceId === "paid") },
    });
  },
};

const priceStep = offeringPriceStep({
  key: "experience_price",
  noun: NOUN,
  dependsOn: "experience_price_kind",
  answerKey: "price",
  title: "Price per person",
  needed: async (ctx) =>
    answer(ctx.run, "price_kind") === "paid" && await needsPrice(ctx),
  question: (example) =>
    `What's the price per person? For example: ${example}.`,
  label: "Price per person",
  placeholder: (example) => `e.g. ${example}`,
});

/** Seth's decision 3: a draft can hold a price before payments are set up. */
export const PAID_EXPERIENCE_HEADS_UP =
  "You can save a price now; you'll need payments set up before you publish.";

const priceSaveStep: StepDefinition = {
  key: "experience_price_save",
  title: "Save the price",
  kind: "proposal",
  depends_on: ["experience_price"],
  policy: "blocking",
  subject_tools: ["update_experience"],
  async probe(ctx): Promise<ProbeResult> {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    const row = await experienceRow(ctx);
    if (!row) return done("no_subject", true);
    const proposed = ctx.state?.state === "awaiting_approval";
    if (experienceHasPrice(row)) {
      return {
        done: true,
        note: proposed ? "Saved and checked: the price is on the draft." : undefined,
        evidence: {
          probe: "experience_price",
          observed: row.is_free ? "free" : row.whole_price_cents,
        },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const kind = answer(ctx.run, "price_kind");
    const price = priceAnswer(ctx, "price");
    if (kind !== "free" && !(kind === "paid" && price)) {
      return done("no_price", true);
    }
    const refused = failedReason(
      ctx,
      "update_experience",
      "The price didn't save, so nothing was changed.",
    );
    const readiness = kind === "paid"
      ? await ctx.deps.readiness("publish_paid").catch(() => null)
      : null;
    const args: Record<string, unknown> = kind === "free"
      ? { event_id: row.id, expected_revision: row.updated_at, is_free: true }
      : {
        event_id: row.id,
        expected_revision: row.updated_at,
        pricing_mode: "whole",
        is_free: false,
        whole_price_cents: price!.price_minor,
        currency: price!.currency,
      };
    return {
      done: false,
      ...(refused ? { note: refused } : {}),
      propose: {
        tool_name: "update_experience",
        tool_args: args,
        rows: [
          { label: "Experience", value: row.title },
          {
            label: "Price",
            value: kind === "free" ? "Free" : `${priceWords(price!)} per person`,
          },
          ...(readiness && !readiness.money.can_sell
            ? [{ label: "Heads-up", value: PAID_EXPERIENCE_HEADS_UP }]
            : []),
          { label: "Status", value: UNPUBLISHED_DRAFT_WORDS },
        ],
        rows_only: true,
      },
      ask: choiceQuestion({
        noun: NOUN,
        key: "price:ready",
        title: "Save the price",
        text: "Ready to save the price to the draft?",
        options: [{ id: "save", label: "Save to the draft" }],
      }),
      record: { data: {} },
    };
  },
  async onAnswer(ctx, choiceId) {
    if (choiceId !== "save") return null;
    const probe = await priceSaveStep.probe(ctx);
    return "propose" in probe
      ? { record: { state: "awaiting_approval", data: {} }, propose: probe.propose }
      : { record: { state: "pending" } };
  },
};

/** The Host experience publish checks (biz_publish_experience). */
export function experiencePublishGaps(row: FlowExperienceRow): string[] {
  const gaps: string[] = [];
  const description = row.description?.trim() ?? "";
  if (!row.title.trim()) gaps.push("a name");
  if (
    description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX
  ) gaps.push("a description of 10 to 500 characters");
  if (row.intents.length === 0) gaps.push("a vibe");
  if (row.stops.length === 0 || row.stops.length > MAX_STOPS) {
    gaps.push("one to five stops");
  } else if (
    row.stops.some((stop) =>
      !stop.name.trim() || !stop.description.trim() || !stop.has_point ||
      !stop.has_place_id
    )
  ) gaps.push("a name, a description and a picked address for every stop");
  if (!row.timezone) gaps.push("a time zone");
  if (!row.when || typeof row.when.date !== "string") gaps.push("a date");
  if (!experienceHasPrice(row)) gaps.push("a price");
  return gaps;
}

async function publishBlockers(
  ctx: FlowContext,
  row: FlowExperienceRow,
): Promise<string[]> {
  const paid = !row.is_free && (row.whole_price_cents ?? 0) > 0;
  const readiness = await ctx.deps.readiness(paid ? "publish_paid" : "publish_free");
  const blocking = readiness.items.filter((item) =>
    item.blocks_action && item.severity !== "done"
  ).map(publishBlockerClause);
  return [
    ...experiencePublishGaps(row).map((gap) => `it needs ${gap}`),
    ...blocking,
  ];
}

const publishStep: StepDefinition = {
  key: "experience_publish",
  title: "Publish",
  kind: "check",
  depends_on: ["experience_price_save"],
  policy: "blocking",
  subject_tools: ["publish_experience"],
  async probe(ctx): Promise<ProbeResult> {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    if (answer(ctx.run, "publish_later") === true) {
      return done("owner_publish_later", true);
    }
    const row = await experienceRow(ctx);
    if (!row) return done("no_subject", true);
    const proposed = ctx.state?.state === "awaiting_approval";
    if (row.status !== "draft") {
      return {
        done: true,
        note: proposed ? `Published and checked: "${row.title}" is live.` : undefined,
        evidence: { probe: "experience_status", observed: row.status },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const blockers = await publishBlockers(ctx, row);
    const refused = failedReason(
      ctx,
      "publish_experience",
      "It wasn't published, so nothing is shown as live.",
    );
    const note = proposed && ctx.trigger === "confirm"
      ? refused ?? "It wasn't published, so nothing is shown as live."
      : undefined;
    if (blockers.length > 0) {
      return {
        done: false,
        note,
        ask: choiceQuestion({
          noun: NOUN,
          key: `publish:blocked:${blockers.join("|")}`,
          title: "Not ready to publish yet",
          text: `Can't publish yet: ${listWords(blockers)}. Your draft is saved; nobody can see it until you publish.`,
          options: [
            {
              id: "open",
              label: "Open the experience",
              route: `/experience/${row.id}/edit`,
            },
            { id: "check", label: "Check again" },
            { id: "later", label: "Not now" },
          ],
        }),
      };
    }
    // I-ARI-NEVER-AUTO-PUBLISH: this card only ASKS.
    return {
      done: false,
      note,
      ask: choiceQuestion({
        noun: NOUN,
        key: "publish:ready",
        title: "Ready to publish",
        text: `Everything's ready. Publish "${row.title}" now? Nothing goes live until you say so.`,
        options: [
          { id: "publish", label: "Publish it" },
          { id: "later", label: "Not now" },
        ],
      }),
    };
  },
  async onAnswer(ctx, choiceId): Promise<AnswerOutcome | null> {
    if (choiceId === "later") {
      return {
        record: { state: "pending" },
        answers: { publish_later: owner(true) },
        ack: "Okay. It stays an unpublished draft — nobody can see it until you publish.",
      };
    }
    if (choiceId === "check") return { record: { state: "pending" } };
    if (choiceId !== "publish") return null;
    const row = await experienceRow(ctx);
    if (!row || row.status !== "draft") return { record: { state: "pending" } };
    // Read before act: the owner asked; check again now.
    if ((await publishBlockers(ctx, row)).length > 0) {
      return { record: { state: "pending" }, ack: "Nothing was published." };
    }
    return {
      record: { state: "awaiting_approval", data: {} },
      propose: {
        tool_name: "publish_experience",
        tool_args: { event_id: row.id, expected_revision: row.updated_at },
        rows: [
          { label: "Experience", value: row.title },
          {
            label: "Stops",
            value: row.stops.map((stop) => stop.name).join(", "),
          },
        ],
        rows_only: true,
      },
    };
  },
};

function summarize(run: FlowRun): {
  title: string;
  text: string;
  evidence: FlowEvidence;
} | null {
  const created = run.step_states.experience_create;
  if (created?.state !== "done" || !created.evidence) return null;
  const observed = created.evidence.observed as { title?: string } | undefined;
  const title = observed?.title ? `"${observed.title}"` : "Your experience";
  const published =
    run.step_states.experience_publish?.evidence?.probe === "experience_status";
  return {
    title: published ? "Your experience is live" : "Your experience draft",
    text: published
      ? `${title} is published and I've checked it's live.`
      : `${title} is saved as an unpublished draft and I've checked it's there. Nobody can see it until you publish. You can ask me to get it ready or publish it anytime.`,
    evidence: created.evidence,
  };
}

/**
 * The create_experience flow, version 2. Version 1 (P3: gates, then the old
 * model lane) stays registered so a run already started on it finishes there.
 */
export const CREATE_EXPERIENCE_FLOW: FlowDefinition = {
  key: "create_experience",
  version: EXPERIENCE_FLOW_VERSION,
  title: "Create an experience",
  subject: "offering",
  concurrency: "one_per_subject",
  noun: NOUN,
  readiness: {
    draft: "draft_save",
    publish: "publish_free",
    publish_paid: "publish_paid",
  },
  subject_tools: ["create_experience"],
  subject_table: "events",
  steps: [
    brandBlockersStep,
    brandCanWaitStep,
    moneyGateStep,
    titleStep,
    descriptionStep,
    vibeStep,
    stopNameStep,
    stopDescriptionStep,
    stopPlaceStep,
    stopMoreStep,
    timezoneStep,
    startStep,
    endStep,
    createStep,
    publishReadyStep,
    priceKindStep,
    priceStep,
    priceSaveStep,
    publishStep,
  ],
  summarize,
};
