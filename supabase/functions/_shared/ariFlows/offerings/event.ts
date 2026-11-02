/**
 * Issue #3355 P7 — "Create an event" on the flow engine.
 *
 *   brand_gate (draft) → money_gate (paid only) → the draft facts (title,
 *   time zone, start, end, format, place / link, home-address question) →
 *   duplicate check → ONE create proposal → read back → "get it ready to
 *   publish?" → cover, party types, description (one update proposal),
 *   tickets (one ticket proposal) → visibility → a publish-readiness card
 *   from brand_readiness + the Host publish checks → publish ONLY when the
 *   owner asks, behind its own protected confirmation.
 *
 * Every saved fact is the owner's: typed in their request or a card, picked
 * on a card, or a suggestion they chose (I-ARI-NO-INVENTED-FACTS). The time
 * zone is the brand's own, else its country's single zone (both shown on the
 * create card the owner confirms), else asked.
 */

import { listWords } from "../brandGate.ts";
import {
  currencyWords,
  moneyGateStep,
  PAYOUT_COUNTRY_QUESTION,
  PAYOUT_COUNTRY_TOOL,
  payoutCountryOptions,
  payoutCountryProposal,
} from "../moneyGate.ts";
import { brandBlockersStep, brandCanWaitStep } from "../brandGate.ts";
import {
  marketDefaultTimezone,
  payoutRailFor,
} from "../../agentAri10xTools.ts";
import { isValidIanaTimezone } from "../../agentRelativeTime.ts";
import {
  providerMinimumChargeMinor,
  ticketPriceBelowMinimum,
} from "../../money/providerMinimums.ts";
import { DRAFT_PAID_TIER_HEADS_UP } from "../../agentTicketPricing.ts";
import {
  formatMinor,
  minorFromMajor,
  minorUnitsPerMajor,
} from "../../money/formatMinor.ts";
import { assertOwnerCopy } from "../../ariOwnerCopy.ts";
import {
  cleanTitle,
  extractEventTitle,
  formatEventClock,
  formatEventStart,
  isHomeLike,
  PARTY_TYPES,
  parseEventEnd,
  parseEventStart,
  parseTimezoneAnswer,
  type PickedPlace,
  suggestedEventEnd,
  zoneWords,
} from "./eventFacts.ts";
import type {
  AnswerOutcome,
  AskSpec,
  FlowAnswer,
  FlowAnswerValue,
  FlowAnswerValues,
  FlowChoiceOption,
  FlowContext,
  FlowDefinition,
  FlowEventRow,
  FlowEvidence,
  FlowRun,
  ProbeResult,
  StepDefinition,
} from "../types.ts";

export const EVENT_FLOW_VERSION = 2;

/** The choice id of a form card's answer (runner.ts FORM_ANSWER). */
const FORM_ANSWER = "answer";

/** The plain words for an unpublished draft (never "private"). */
export const UNPUBLISHED_DRAFT_WORDS =
  "Unpublished draft — nobody can see it until you publish.";

type Facts = {
  title: string | null;
  timezone: string | null;
  timezone_source: "owner" | "brand" | "country" | null;
  start_at: string | null;
  end_at: string | null;
  format: "in_person" | "online" | "hybrid" | null;
  place: PickedPlace | null;
  online_url: string | null;
  hide_address: boolean | null;
};

function answer(run: FlowRun, key: string): unknown {
  return run.answers[key]?.value;
}

function owner(value: unknown): FlowAnswerValue {
  return { value, source: "owner" };
}

function intentText(run: FlowRun): string {
  const text = answer(run, "intent_text");
  return typeof text === "string" ? text : "";
}

/** An end the owner put in their first request ("7 to 10:30pm"). */
function intentEnd(
  run: FlowRun,
  startAt: string,
  timezone: string,
): string | null {
  const range =
    /(?:\b(?:to|until|till|through)\b|[–—]|(?<=\d\s?(?:am|pm)?)\s?-\s?)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|midnight)/i
      .exec(intentText(run));
  return range ? parseEventEnd(range[1], startAt, timezone, new Date()) : null;
}

function stringAnswer(run: FlowRun, key: string): string | null {
  const value = answer(run, key);
  return typeof value === "string" && value.trim() ? value : null;
}

function evidenceOf(ctx: FlowContext, step: string): Record<string, unknown> {
  const observed = ctx.run.step_states[step]?.evidence?.observed;
  return observed && typeof observed === "object"
    ? observed as Record<string, unknown>
    : {};
}

/**
 * A fact first read from the owner's request is pinned in its step's
 * evidence, so "next Friday" means the same day on every later turn.
 */
function pinned(ctx: FlowContext, step: string): string | null {
  const observed = ctx.run.step_states[step]?.evidence?.observed;
  return typeof observed === "string" && observed ? observed : null;
}

/** Everything the owner has given so far (their words and card answers). */
export function eventFacts(ctx: FlowContext): Facts {
  const run = ctx.run;
  const title = stringAnswer(run, "title") ?? pinned(ctx, "event_title") ??
    extractEventTitle(intentText(run), ctx.brandName) ?? null;
  const tzEvidence = evidenceOf(ctx, "event_timezone");
  const ownerZone = stringAnswer(run, "timezone");
  const timezone = ownerZone ??
    (typeof tzEvidence.timezone === "string" ? tzEvidence.timezone : null);
  const start = stringAnswer(run, "start_at") ?? pinned(ctx, "event_start") ??
    (timezone ? parseEventStart(intentText(run), timezone, new Date()) : null);
  const end = stringAnswer(run, "end_at") ?? pinned(ctx, "event_end") ??
    (start && timezone ? intentEnd(run, start, timezone) : null);
  const format = answer(run, "format");
  const place = answer(run, "place");
  const hide = answer(run, "hide_address");
  return {
    title,
    timezone,
    timezone_source: ownerZone
      ? "owner"
      : tzEvidence.source === "brand" || tzEvidence.source === "country"
      ? tzEvidence.source
      : null,
    start_at: start,
    end_at: end,
    format: format === "in_person" || format === "online" ||
        format === "hybrid"
      ? format
      : null,
    place: place && typeof place === "object" ? place as PickedPlace : null,
    online_url: stringAnswer(run, "online_url"),
    hide_address: typeof hide === "boolean" ? hide : null,
  };
}

function done(probe: string, observed: unknown): ProbeResult {
  return { done: true, evidence: { probe, observed } };
}

/**
 * A form card: one text field, or a set of choices, answered on the card.
 * #3355 P8: shared with the trip flow (`noun`).
 */
export function formRendition(args: {
  id: string;
  noun?: string;
  title: string;
  body: string;
  field?: { label: string; placeholder: string; kind?: "text" | "url" };
  choices?: { options: { id: string; label: string }[]; multiple: boolean };
  problem?: string | null;
}): Record<string, unknown> {
  const noun = args.noun ?? "event";
  return {
    schema_version: 2,
    rendition_id: `${noun}-setup:${args.id}`,
    kind: `${noun}-setup`,
    eyebrow: `New ${noun}`,
    title: args.title,
    body: args.problem ?? args.body,
    ...(args.problem ? { tone: "warning" } : {}),
    state: "ready",
    blocks: [
      ...(args.problem
        ? [{
          type: "callout",
          version: 1,
          id: "nothing-saved",
          tone: "warning",
          title: "Nothing was saved",
          body: "Answer again and Ari will check it before anything is saved.",
        }]
        : []),
      ...(args.choices
        ? [{
          type: "choices",
          version: 1,
          id: `${args.id}-choices`,
          selection: args.choices.multiple ? "multiple" : "single",
          options: args.choices.options,
        }]
        : []),
      ...(args.field
        ? [{
          type: "input",
          version: 1,
          id: `${args.id}-answer`,
          field: {
            id: args.id,
            label: args.field.label,
            value: "",
            placeholder: args.field.placeholder,
            editable: true,
            kind: args.field.kind ?? "text",
          },
        }]
        : []),
    ],
    actions: [{
      id: "continue-with-ari",
      label: "Continue",
      style: "primary",
      behavior: { type: "submit", message: "Use my answer" },
    }],
  };
}

export function problemOf(ctx: FlowContext): string | null {
  const problem = ctx.state?.data?.problem;
  return typeof problem === "string" ? problem : null;
}

export function attemptOf(ctx: FlowContext): number {
  const attempt = ctx.state?.data?.attempt;
  return typeof attempt === "number" ? attempt : 0;
}

/** Nothing saved; the same question comes back with what was wrong. */
export function retry(ctx: FlowContext, problem: string): AnswerOutcome {
  return {
    record: {
      state: "asked",
      data: { problem, attempt: attemptOf(ctx) + 1 },
    },
  };
}

export function textQuestion(args: {
  ctx: FlowContext;
  key: string;
  noun?: string;
  title: string;
  text: string;
  label: string;
  placeholder: string;
  kind?: "text" | "url";
  options?: { id: string; label: string }[];
}): AskSpec {
  const problem = problemOf(args.ctx);
  const noun = args.noun ?? "event";
  return {
    kind: "question",
    answer_mode: "form",
    reuse_key: `${noun}:${args.key}:${attemptOf(args.ctx)}`,
    title: args.title,
    text: problem ? `${problem} ${args.text}` : args.text,
    options: args.options ?? [],
    rendition: formRendition({
      id: args.key,
      noun,
      title: args.title,
      body: args.text,
      field: { label: args.label, placeholder: args.placeholder, kind: args.kind },
      problem,
    }),
    record: { data: { attempt: attemptOf(args.ctx) } },
  };
}

/**
 * #3355 P7 — the Host ticket sheet's "Choose your payout country" prompt as
 * an Ari card: the Host chooser's countries, one pick, answered on the card.
 */
export function payoutCountryQuestion(
  ctx: FlowContext,
  brandCountry: string | null,
  failed: string | null,
  noun = "event",
): AskSpec {
  const problem = failed ?? problemOf(ctx);
  const title = "Choose your payout country";
  const body =
    `Prices need a currency. ${PAYOUT_COUNTRY_QUESTION}`;
  return {
    kind: "question",
    answer_mode: "form",
    reuse_key: `${noun}:${PAYOUT_COUNTRY_KEY}:${attemptOf(ctx)}${
      failed ? ":failed" : ""
    }`,
    title,
    text: problem ? `${problem} ${PAYOUT_COUNTRY_QUESTION}` : body,
    options: [],
    rendition: formRendition({
      id: PAYOUT_COUNTRY_KEY,
      noun,
      title,
      body,
      choices: { options: payoutCountryOptions(brandCountry), multiple: false },
      problem,
    }),
    record: { data: { attempt: attemptOf(ctx) } },
  };
}

export function choiceQuestion(args: {
  key: string;
  title: string;
  text: string;
  options: FlowChoiceOption[];
  noun?: string;
}): AskSpec {
  return {
    kind: "question",
    reuse_key: `${args.noun ?? "event"}:${args.key}`,
    title: args.title,
    text: args.text,
    options: args.options,
    record: {},
  };
}

const NOT_AN_ANSWER =
  /\?\s*$|^(?:how|why|can|could|should|do|does|is|are|will|would|stop|cancel|never\s?mind|forget it|not now|skip|later)\b/i;

/** A typed reply as a form answer, unless it is a question or a stop. */
export function typedAnswer(text: string): FlowAnswerValues | null {
  if (NOT_AN_ANSWER.test(text.trim())) return null;
  const response = text.trim().slice(0, 2000);
  return response ? { choices: [], country: null, response } : null;
}

export function formResponse(
  choiceId: string,
  answer?: FlowAnswer,
): string | null {
  if (choiceId !== FORM_ANSWER || !answer?.values) return null;
  return answer.values.response.trim() || answer.values.choices[0] || null;
}

// ── Draft facts ────────────────────────────────────────────────────────────

const titleStep: StepDefinition = {
  key: "event_title",
  title: "Event name",
  kind: "question",
  depends_on: ["brand_blockers", "brand_can_wait", "money_gate"],
  policy: "blocking",
  probe(ctx) {
    const { title } = eventFacts(ctx);
    if (title) return Promise.resolve(done("owner_title", title));
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        key: "title",
        title: "Event name",
        text: "What's the event called?",
        label: "Event name",
        placeholder: "e.g. Lantern Supper",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, answer) {
    const response = formResponse(choiceId, answer);
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

const timezoneStep: StepDefinition = {
  key: "event_timezone",
  title: "Time zone",
  kind: "question",
  depends_on: ["event_title"],
  policy: "blocking",
  async probe(ctx) {
    const ownerZone = stringAnswer(ctx.run, "timezone");
    if (ownerZone) {
      return done("owner_timezone", { timezone: ownerZone, source: "owner" });
    }
    // The brand's own time zone, else its country's single zone (P6 market
    // rules). Both are shown on the create card the owner confirms. Never
    // the device's zone and never UTC by default.
    const brand = await ctx.deps.brandFacts?.() ?? null;
    if (brand?.default_timezone && isValidIanaTimezone(brand.default_timezone)) {
      return {
        done: true,
        evidence: {
          probe: "brand_timezone",
          observed: { timezone: brand.default_timezone, source: "brand" },
        },
      };
    }
    const country = marketDefaultTimezone(brand?.country_code);
    if (country) {
      return {
        done: true,
        evidence: {
          probe: "country_timezone",
          observed: { timezone: country, source: "country" },
        },
      };
    }
    return {
      done: false,
      ask: textQuestion({
        ctx,
        key: "timezone",
        title: "Time zone",
        text:
          "What time zone is this event in? Tell me the city — for example London, Lagos or New York.",
        label: "City or time zone",
        placeholder: "e.g. New York",
      }),
    };
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, answer) {
    const response = formResponse(choiceId, answer);
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
  key: "event_start",
  title: "Start",
  kind: "question",
  depends_on: ["event_timezone"],
  policy: "blocking",
  probe(ctx) {
    const { start_at } = eventFacts(ctx);
    if (start_at) return Promise.resolve(done("owner_start", start_at));
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        key: "start",
        title: "Date and start time",
        text:
          "When does it start? Tell me the date and start time — for example Friday 13 November at 7pm.",
        label: "Date and start time",
        placeholder: "e.g. Friday 13 November at 7pm",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, answer) {
    const response = formResponse(choiceId, answer);
    if (response === null) return Promise.resolve(null);
    const { timezone } = eventFacts(ctx);
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
      answers: { start_at: owner(start) },
    });
  },
};

const endStep: StepDefinition = {
  key: "event_end",
  title: "End time",
  kind: "question",
  depends_on: ["event_start"],
  policy: "blocking",
  probe(ctx) {
    const { start_at, end_at, timezone } = eventFacts(ctx);
    if (end_at) return Promise.resolve(done("owner_end", end_at));
    const tz = timezone ?? "UTC";
    const suggestion = start_at ? suggestedEventEnd(start_at) : null;
    return Promise.resolve({
      done: false,
      ask: {
        ...textQuestion({
          ctx,
          key: "end",
          title: "End time",
          text: `How long does it run? It starts ${
            start_at ? formatEventStart(start_at, tz) : "on the date you gave"
          }. Pick the suggested end or type another time.`,
          label: "Ends at",
          placeholder: "e.g. 10:30pm",
          options: suggestion
            ? [{
              id: "suggested",
              label: `Ends at ${formatEventClock(suggestion, tz)}`,
            }]
            : [],
        }),
        record: { data: { attempt: attemptOf(ctx), suggestion } },
      },
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, answer) {
    const { start_at, timezone } = eventFacts(ctx);
    if (!start_at || !timezone) return Promise.resolve(null);
    if (choiceId === "suggested") {
      // The owner chose the suggestion on the card: now it is their answer.
      return Promise.resolve({
        record: { state: "pending" },
        answers: { end_at: owner(suggestedEventEnd(start_at)) },
      });
    }
    const response = formResponse(choiceId, answer);
    if (response === null) return Promise.resolve(null);
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

const FORMAT_OPTIONS = [
  { id: "in_person", label: "In person" },
  { id: "online", label: "Online" },
  { id: "hybrid", label: "Both" },
];

const formatStep: StepDefinition = {
  key: "event_format",
  title: "How people attend",
  kind: "question",
  depends_on: ["event_end"],
  policy: "blocking",
  probe(ctx) {
    const { format } = eventFacts(ctx);
    if (format) return Promise.resolve(done("owner_format", format));
    return Promise.resolve({
      done: false,
      ask: choiceQuestion({
        key: "format",
        title: "How people attend",
        text: "Is it in person, online, or both?",
        options: FORMAT_OPTIONS,
      }),
    });
  },
  onAnswer(_ctx, choiceId) {
    if (!FORMAT_OPTIONS.some((option) => option.id === choiceId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { format: owner(choiceId) },
    });
  },
};

const placeStep: StepDefinition = {
  key: "event_place",
  title: "Where",
  kind: "question",
  depends_on: ["event_format"],
  policy: "blocking",
  probe(ctx) {
    const { format, place } = eventFacts(ctx);
    if (format === "online") return Promise.resolve(done("not_in_person", true));
    if (place) return Promise.resolve(done("owner_place", place.address));
    const problem = problemOf(ctx);
    // The Host shows its address search (MapboxAddressInput) on this card.
    return Promise.resolve({
      done: false,
      ask: {
        kind: "question",
        answer_mode: "form",
        reuse_key: `event:place:${attemptOf(ctx)}`,
        title: "Where is it?",
        text: `${
          problem ? `${problem} ` : ""
        }Add the venue name and pick the address from the search, so guests can find it.`,
        options: [],
        record: { data: { attempt: attemptOf(ctx) } },
      },
    });
  },
  onAnswer(ctx, choiceId, answer) {
    if (choiceId !== FORM_ANSWER) return Promise.resolve(null);
    const place = answer?.values?.place;
    if (!place) {
      return Promise.resolve(retry(
        ctx,
        "Pick the address from the search suggestions, so the city is right. Nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { place: owner(place) },
    });
  },
};

const privacyStep: StepDefinition = {
  key: "event_address_privacy",
  title: "Address privacy",
  kind: "question",
  depends_on: ["event_place"],
  policy: "blocking",
  probe(ctx) {
    const { place, hide_address } = eventFacts(ctx);
    if (!place || !isHomeLike(place)) {
      return Promise.resolve(done("not_home_like", true));
    }
    if (hide_address !== null) {
      return Promise.resolve(done("owner_address_privacy", hide_address));
    }
    // Seth's decision 4: a home-like address — ask, defaulting to yes.
    return Promise.resolve({
      done: false,
      ask: choiceQuestion({
        key: "address_privacy",
        title: "Show the address only to ticket holders?",
        text:
          "That address looks like a home. Show the full address only to people with a ticket? Everyone else sees just the area.",
        options: [
          { id: "hide", label: "Yes, only ticket holders" },
          { id: "show", label: "No, show it to everyone" },
        ],
      }),
    });
  },
  onAnswer(_ctx, choiceId) {
    if (choiceId !== "hide" && choiceId !== "show") {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { hide_address: owner(choiceId === "hide") },
    });
  },
};

const MAP_LINK =
  /\b(?:maps\.app\.goo\.gl|goo\.gl\/maps|google\.[a-z.]+\/maps|maps\.google\.|maps\.apple\.com)\b/i;

const linkStep: StepDefinition = {
  key: "event_link",
  title: "Joining link",
  kind: "question",
  depends_on: ["event_address_privacy"],
  policy: "blocking",
  probe(ctx) {
    const { format, online_url } = eventFacts(ctx);
    if (format !== "online" && format !== "hybrid") {
      return Promise.resolve(done("not_online", true));
    }
    if (online_url) return Promise.resolve(done("owner_link", online_url));
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        key: "link",
        title: "Joining link",
        text: "What's the link people use to join online?",
        label: "Joining link",
        placeholder: "https://zoom.us/j/…",
        kind: "url",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, answer) {
    const response = formResponse(choiceId, answer);
    if (response === null) return Promise.resolve(null);
    let url: URL | null = null;
    try {
      url = new URL(response.trim());
    } catch {
      url = null;
    }
    if (!url || !/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) {
      return Promise.resolve(
        retry(ctx, "That isn't a web link, so nothing was saved."),
      );
    }
    if (MAP_LINK.test(response)) {
      return Promise.resolve(retry(
        ctx,
        "That's a map location, not a joining link. Nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { online_url: owner(url.toString()) },
    });
  },
};

// ── Duplicate guard and the create proposal ───────────────────────────────

function localDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

const DAY_MS = 24 * 3_600_000;

/** §3(c).6 — same brand, same title (case-folded), same day or made today. */
export function duplicateDrafts(
  rows: FlowEventRow[],
  facts: { title: string; start_at: string; timezone: string },
  now: Date,
  exclude: string | null,
): FlowEventRow[] {
  const title = facts.title.toLocaleLowerCase().trim();
  const day = localDate(facts.start_at, facts.timezone);
  return rows.filter((row) => {
    if (row.id === exclude) return false;
    if (row.title.toLocaleLowerCase().trim() !== title) return false;
    const when = row.draft.when && typeof row.draft.when === "object"
      ? row.draft.when as Record<string, unknown>
      : {};
    const created = row.created_at ? new Date(row.created_at).getTime() : NaN;
    return when.date === day ||
      (Number.isFinite(created) && now.getTime() - created < DAY_MS);
  });
}

const duplicateStep: StepDefinition = {
  key: "event_duplicate",
  title: "Already a draft?",
  kind: "check",
  depends_on: ["event_link"],
  policy: "blocking",
  async probe(ctx) {
    if (ctx.run.subject_id) return done("subject_chosen", ctx.run.subject_id);
    if (answer(ctx.run, "duplicate_choice") === "new") {
      return done("owner_chose_new", true);
    }
    const facts = eventFacts(ctx);
    if (!facts.title || !facts.start_at || !facts.timezone || !ctx.deps.eventsTitled) {
      return done("no_duplicate_check", true);
    }
    const rows = await ctx.deps.eventsTitled(facts.title);
    const matches = duplicateDrafts(rows, {
      title: facts.title,
      start_at: facts.start_at,
      timezone: facts.timezone,
    }, new Date(), null);
    if (matches.length === 0) return done("no_duplicate", facts.title);
    const first = matches[0];
    const when = (first.draft.when ?? {}) as Record<string, unknown>;
    const day = typeof when.date === "string"
      ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
      }).format(new Date(`${when.date}T12:00:00Z`))
      : null;
    return {
      done: false,
      ask: {
        ...choiceQuestion({
          key: `duplicate:${first.id}`,
          title: "You already have this draft",
          text: `You already have a draft called "${first.title}"${
            day ? ` on ${day}` : ""
          }. Continue that one or make a new one?`,
          options: [
            { id: "continue", label: "Continue that one" },
            { id: "new", label: "Make a new one" },
          ],
        }),
        record: { data: { existing_id: first.id } },
      },
    };
  },
  onAnswer(ctx, choiceId) {
    const existing = ctx.state?.data?.existing_id;
    if (choiceId === "new") {
      return Promise.resolve({
        record: { state: "pending" },
        answers: { duplicate_choice: owner("new") },
      });
    }
    if (choiceId === "continue" && typeof existing === "string") {
      return Promise.resolve({
        record: { state: "pending" },
        answers: { duplicate_choice: owner("continue") },
        subject_id: existing,
        ack: "Okay, we'll carry on with that draft. Nothing new was created.",
      });
    }
    return Promise.resolve(null);
  },
};

/** The create_event args — only the owner's facts (I-ARI-NO-INVENTED-FACTS). */
export function createEventArgs(
  brandId: string,
  facts: Facts,
): Record<string, unknown> | null {
  if (
    !facts.title || !facts.timezone || !facts.start_at || !facts.end_at ||
    !facts.format
  ) return null;
  const inPerson = facts.format !== "online";
  if (inPerson && !facts.place) return null;
  if (!inPerson && !facts.online_url) return null;
  if (facts.format === "hybrid" && !facts.online_url) return null;
  return {
    brand_id: brandId,
    title: facts.title,
    when_mode: "single",
    start_at: facts.start_at,
    end_at: facts.end_at,
    timezone: facts.timezone,
    format: facts.format,
    // Decision 8: visibility is asked at publish (Public preselected); the
    // draft itself is simply unpublished. Never "private" (#1931 frozen).
    visibility: "public",
    ...(facts.place
      ? {
        location_text: facts.place.venue_name,
        location_address: facts.place.address,
        city: facts.place.city,
        location_lat: facts.place.lat,
        location_lng: facts.place.lng,
        location_precision: facts.place.feature_type === "poi" ||
            facts.place.feature_type === "address"
          ? "exact"
          : "approximate",
        hide_address_until_ticket: facts.hide_address === true,
      }
      : {}),
    ...(facts.online_url ? { online_url: facts.online_url } : {}),
  };
}

export function createRows(facts: Facts): { label: string; value: string }[] {
  const tz = facts.timezone ?? "UTC";
  const rows = [
    {
      label: "When",
      value: facts.start_at && facts.end_at
        ? `${formatEventStart(facts.start_at, tz)} – ${
          formatEventClock(facts.end_at, tz)
        } (${zoneWords(tz)})`
        : "",
    },
    ...(facts.timezone_source === "brand" || facts.timezone_source === "country"
      ? [{
        label: "Time zone",
        value: `${zoneWords(tz)}, from your brand${
          facts.timezone_source === "country" ? "'s country" : ""
        }`,
      }]
      : []),
    ...(facts.place
      ? [{
        label: "Where",
        value: `${facts.place.venue_name}, ${facts.place.address}${
          facts.hide_address ? " (address shown only to ticket holders)" : ""
        }`,
      }]
      : []),
    // #3355 — the owner confirms the joining link they gave; it was saved
    // without ever being shown on the card.
    ...(facts.online_url
      ? [{ label: "Joining link", value: facts.online_url }]
      : []),
    { label: "Status", value: UNPUBLISHED_DRAFT_WORDS },
  ];
  return rows.filter((row) => row.value);
}

export async function proposalOpen(ctx: FlowContext): Promise<boolean> {
  if (!ctx.deps.hasOpenProposal) return false;
  try {
    return await ctx.deps.hasOpenProposal();
  } catch (_error) {
    return false;
  }
}

async function subjectRow(ctx: FlowContext): Promise<FlowEventRow | null> {
  if (!ctx.run.subject_id || !ctx.deps.eventRow) return null;
  return await ctx.deps.eventRow(ctx.run.subject_id);
}

const createStep: StepDefinition = {
  key: "event_create",
  title: "Create the draft",
  kind: "proposal",
  depends_on: ["event_duplicate"],
  policy: "blocking",
  subject_tools: ["create_event"],
  async probe(ctx): Promise<ProbeResult> {
    const proposed = ctx.state?.state === "awaiting_approval";
    const row = await subjectRow(ctx);
    if (row) {
      return {
        done: true,
        note: proposed
          ? `Saved and checked: "${row.title}" is an unpublished draft — nobody can see it until you publish.`
          : undefined,
        evidence: { probe: "events_exists", observed: { id: row.id, title: row.title, status: row.status } },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const facts = eventFacts(ctx);
    const args = createEventArgs(ctx.run.brand_id, facts);
    const note = proposed && ctx.trigger === "confirm"
      ? "The draft wasn't created, so nothing is shown as saved."
      : undefined;
    if (!args) {
      // A fact went missing (it shouldn't): say so plainly, nothing saved.
      return {
        done: false,
        note,
        ask: choiceQuestion({
          key: "create:incomplete",
          title: "Create the draft",
          text: "I'm missing a detail for this draft, so nothing was created.",
          options: [{ id: "cancel", label: "Stop here" }],
        }),
      };
    }
    const ask: AskSpec = choiceQuestion({
      key: "create:ready",
      title: "Create the draft",
      text: `Ready to save "${facts.title}" as an unpublished draft? Nobody can see it until you publish.`,
      options: [{ id: "create", label: "Create the draft" }],
    });
    return {
      done: false,
      note,
      propose: {
        tool_name: "create_event",
        tool_args: args,
        rows: createRows(facts),
        rows_only: true,
      },
      ask,
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
    if (choiceId !== "create") return Promise.resolve(null);
    const facts = eventFacts(ctx);
    const args = createEventArgs(ctx.run.brand_id, facts);
    if (!args) return Promise.resolve(null);
    return Promise.resolve({
      record: { state: "awaiting_approval", data: {} },
      propose: {
        tool_name: "create_event",
        tool_args: args,
        rows: createRows(facts),
        rows_only: true,
      },
    });
  },
};

// ── Publish-ready facts (after the draft exists) ──────────────────────────

function wantsPublishReady(ctx: FlowContext): boolean {
  return answer(ctx.run, "publish_ready") === true;
}

const publishReadyStep: StepDefinition = {
  key: "event_publish_ready",
  title: "Get it ready to publish",
  kind: "question",
  depends_on: ["event_create"],
  policy: "blocking",
  probe(ctx) {
    const value = answer(ctx.run, "publish_ready");
    if (typeof value === "boolean") {
      return Promise.resolve(done("owner_publish_ready", value));
    }
    return Promise.resolve({
      done: false,
      ask: choiceQuestion({
        key: "publish_ready",
        title: "Get it ready to publish?",
        text:
          "Want to get it ready to publish? I'll need a party type, a short description, tickets, and whether it's public or unlisted. A cover photo helps too.",
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

const coverStep: StepDefinition = {
  key: "event_cover",
  title: "Cover",
  kind: "handoff",
  depends_on: ["event_publish_ready"],
  policy: "skippable",
  async probe(ctx) {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    const row = await subjectRow(ctx);
    if (row?.cover_media_url) {
      return {
        done: true,
        note: ctx.state?.state === "human_action"
          ? "I checked; your cover is on the draft."
          : undefined,
        evidence: { probe: "event_cover", observed: true },
      };
    }
    if (answer(ctx.run, "cover_skipped") === true || !row) {
      return done("cover_skipped", true);
    }
    // In-chat cover upload (the Host's own event cover picker), skippable.
    return {
      done: false,
      ask: {
        kind: "handoff",
        reuse_key: "event:cover",
        title: "Add a cover",
        text:
          "Add a cover photo or video for the event page. You choose it — Ari never adds one for you.",
        options: [
          { id: "check", label: "I've added it, check now" },
          { id: "not_now", label: "Not now" },
        ],
        handoff: {
          item_key: "event_cover",
          item_label: "Event cover",
          route: `/event/${row.id}/edit`,
          route_label: "the event",
          can_caller_fix: true,
          who_can_fix: "you",
        },
        subject_id: row.id,
        record: {},
      },
    };
  },
  onAnswer(_ctx, choiceId) {
    if (choiceId !== "not_now") return Promise.resolve(null);
    return Promise.resolve({
      record: { state: "pending" },
      answers: { cover_skipped: owner(true) },
      ack: "Okay, no cover for now. You can add one anytime before you publish.",
    });
  },
};

const PARTY_LABELS: ReadonlyMap<string, string> = new Map(
  PARTY_TYPES.map((option) => [option.label.toLowerCase(), option.slug]),
);

const partyStep: StepDefinition = {
  key: "event_party_types",
  title: "Party type",
  kind: "question",
  depends_on: ["event_cover"],
  policy: "blocking",
  async probe(ctx) {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    const row = await subjectRow(ctx);
    if (row && row.party_types.length > 0) {
      return done("event_party_types", row.party_types);
    }
    const chosen = answer(ctx.run, "party_types");
    if (Array.isArray(chosen) && chosen.length > 0) {
      return done("owner_party_types", chosen);
    }
    const problem = problemOf(ctx);
    return {
      done: false,
      ask: {
        kind: "question",
        answer_mode: "form",
        reuse_key: `event:party:${attemptOf(ctx)}`,
        title: "Party type",
        text: `${problem ? `${problem} ` : ""}What kind of event is it? Pick one or more.`,
        options: [],
        rendition: formRendition({
          id: "party_types",
          title: "Party type",
          body: "What kind of event is it? Pick one or more.",
          choices: {
            options: PARTY_TYPES.map((option) => ({
              id: option.slug,
              label: option.label,
            })),
            multiple: true,
          },
          problem,
        }),
        record: { data: { attempt: attemptOf(ctx) } },
      },
    };
  },
  textAnswer(_ctx, text) {
    const labels = text.split(/,|\band\b/i).map((part) => part.trim())
      .filter((part) => PARTY_LABELS.has(part.toLowerCase()));
    return labels.length > 0
      ? { choices: labels, country: null, response: "" }
      : null;
  },
  onAnswer(ctx, choiceId, answer) {
    if (choiceId !== FORM_ANSWER || !answer?.values) {
      return Promise.resolve(null);
    }
    const slugs = [
      ...new Set(
        answer.values.choices.flatMap((label) => {
          const slug = PARTY_LABELS.get(label.toLowerCase());
          return slug ? [slug] : [];
        }),
      ),
    ];
    if (slugs.length === 0) {
      return Promise.resolve(
        retry(ctx, "Pick at least one party type. Nothing was saved."),
      );
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { party_types: owner(slugs) },
    });
  },
};

const descriptionStep: StepDefinition = {
  key: "event_description",
  title: "Description",
  kind: "question",
  depends_on: ["event_party_types"],
  policy: "blocking",
  async probe(ctx) {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    const row = await subjectRow(ctx);
    if (row?.description) return done("event_description", true);
    if (stringAnswer(ctx.run, "description")) {
      return done("owner_description", true);
    }
    return {
      done: false,
      ask: textQuestion({
        ctx,
        key: "description",
        title: "Description",
        text:
          "Describe the event in a sentence or two — what guests can expect. I'll save exactly what you write.",
        label: "Description",
        placeholder: "e.g. A candlelit supper with live strings.",
      }),
    };
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, answer) {
    const response = formResponse(choiceId, answer);
    if (response === null) return Promise.resolve(null);
    const description = response.trim();
    if (description.length < 10 || description.length > 2000) {
      return Promise.resolve(retry(
        ctx,
        "A description needs at least a short sentence (10 or more characters). Nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { description: owner(description) },
    });
  },
};

function draftRevision(row: FlowEventRow): number {
  const value = Number(row.draft.clientRevision ?? 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

const detailsSaveStep: StepDefinition = {
  key: "event_details_save",
  title: "Save the details",
  kind: "proposal",
  depends_on: ["event_description"],
  policy: "blocking",
  subject_tools: ["update_event"],
  async probe(ctx): Promise<ProbeResult> {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    const row = await subjectRow(ctx);
    if (!row) return done("no_subject", true);
    const proposed = ctx.state?.state === "awaiting_approval";
    const partyTypes = answer(ctx.run, "party_types");
    const description = stringAnswer(ctx.run, "description");
    const savedParty = row.party_types.length > 0 || !Array.isArray(partyTypes);
    const savedDescription = !!row.description || !description;
    if (savedParty && savedDescription) {
      return {
        done: true,
        note: proposed
          ? "Saved and checked: the party type and description are on the draft."
          : undefined,
        evidence: {
          probe: "event_details",
          observed: { party_types: row.party_types, description: !!row.description },
        },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const args: Record<string, unknown> = {
      event_id: row.id,
      client_revision: draftRevision(row) + 1,
      ...(!row.party_types.length && Array.isArray(partyTypes)
        ? { party_types: partyTypes }
        : {}),
      ...(!row.description && description ? { description } : {}),
    };
    const labels = Array.isArray(partyTypes)
      ? PARTY_TYPES.filter((option) => partyTypes.includes(option.slug))
        .map((option) => option.label)
      : [];
    const rows = [
      ...(labels.length > 0
        ? [{ label: "Party type", value: labels.join(", ") }]
        : []),
      ...(typeof args.description === "string"
        ? [{ label: "Description", value: args.description }]
        : []),
      { label: "Status", value: UNPUBLISHED_DRAFT_WORDS },
    ];
    return {
      done: false,
      note: proposed && ctx.trigger === "confirm"
        ? "Those details didn't save, so nothing is shown as done."
        : undefined,
      propose: {
        tool_name: "update_event",
        tool_args: args,
        rows,
        rows_only: true,
      },
      ask: choiceQuestion({
        key: "details:ready",
        title: "Save the details",
        text: "Ready to save the party type and description to the draft?",
        options: [{ id: "save", label: "Save to the draft" }],
      }),
      record: { data: {} },
    };
  },
  async onAnswer(ctx, choiceId) {
    if (choiceId !== "save") return null;
    const probe = await detailsSaveStep.probe(ctx);
    return "propose" in probe
      ? { record: { state: "awaiting_approval", data: {} }, propose: probe.propose }
      : { record: { state: "pending" } };
  },
};

function draftTickets(row: FlowEventRow | null): unknown[] {
  return Array.isArray(row?.draft.tickets) ? row!.draft.tickets as unknown[] : [];
}

const ticketKindStep: StepDefinition = {
  key: "event_ticket_kind",
  title: "Tickets",
  kind: "question",
  depends_on: ["event_details_save"],
  policy: "blocking",
  async probe(ctx) {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    const row = await subjectRow(ctx);
    if (draftTickets(row).length > 0) return done("event_tickets", true);
    const kind = answer(ctx.run, "ticket_kind");
    if (kind === "free" || kind === "paid") return done("owner_ticket_kind", kind);
    return {
      done: false,
      ask: choiceQuestion({
        key: "ticket_kind",
        title: "Tickets",
        text: "Are tickets free or paid?",
        options: [
          { id: "free", label: "Free" },
          { id: "paid", label: "Paid" },
        ],
      }),
    };
  },
  onAnswer(_ctx, choiceId) {
    if (choiceId !== "free" && choiceId !== "paid") {
      return Promise.resolve(null);
    }
    // "Paid" also tells the money step: it shows what selling needs, and the
    // draft can still hold paid tickets (Seth's decision 3).
    return Promise.resolve({
      record: { state: "pending" },
      answers: {
        ticket_kind: owner(choiceId),
        paid: owner(choiceId === "paid"),
      },
    });
  },
};

const CAPACITY =
  /\b(\d{1,6})\s*(?:tickets?|people|guests?|spots?|places?|seats?|max|capacity)\b|\b(?:capacity|limit(?:ed)?(?:\s+to)?|for|max(?:imum)?)\s*(?:of\s+)?(\d{1,6})\b/i;
const NO_LIMIT = /\b(?:no limit|unlimited|no cap|as many as)\b/i;
// #3355 P8: "₦2,000" / "£1,250.50" carry thousands separators (the card's
// own example for naira is "₦2,000"); a lone ",5" is a decimal comma.
const PRICE =
  /(?:([£$€₦])\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,7}(?:[.,]\d{1,2})?))|(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d{1,7}(?:[.,]\d{1,2})?)\s*(pounds?|dollars?|euros?|naira|gbp|usd|eur|ngn)\b/i;

/** "2,000" → 2000, "1,250.50" → 1250.5, "12,5" → 12.5. */
function priceNumber(raw: string): number {
  return /,\d{3}(?:\.|$)/.test(raw)
    ? Number(raw.replace(/,/g, ""))
    : Number(raw.replace(",", "."));
}

/** The currencies a typed symbol or word can mean. */
const TYPED_CURRENCY: ReadonlyArray<[RegExp, string[]]> = [
  [/^(?:£|pounds?|gbp)$/i, ["GBP"]],
  [/^(?:\$|dollars?)$/i, ["USD", "CAD"]],
  [/^usd$/i, ["USD"]],
  [/^(?:€|euros?|eur)$/i, ["EUR"]],
  [/^(?:₦|naira|ngn)$/i, ["NGN"]],
];

/** The owner's ticket words: price (paid only) and capacity or no limit. */
export function parseTicketAnswer(
  text: string,
  paid: boolean,
): {
  price_major: number | null;
  capacity: number | null;
  unlimited: boolean;
  /** The price as typed ("$15"), when it named a currency. */
  typed_price?: string;
  /** The currencies that typed symbol or word can mean. */
  typed_currencies?: string[];
} | null {
  const unlimited = NO_LIMIT.test(text);
  const capacityMatch = CAPACITY.exec(text);
  const capacity = capacityMatch
    ? Number(capacityMatch[1] ?? capacityMatch[2])
    : null;
  let price: number | null = null;
  let typed: { price: string; currencies: string[] } | null = null;
  if (paid) {
    const priceMatch = PRICE.exec(text);
    const raw = priceMatch?.[2] ?? priceMatch?.[3];
    price = raw ? priceNumber(raw) : null;
    if (price === null || !(price > 0)) return null;
    const marker = priceMatch?.[1] ?? priceMatch?.[4] ?? "";
    const currencies = TYPED_CURRENCY.find(([pattern]) => pattern.test(marker))
      ?.[1];
    if (currencies) {
      typed = {
        price: priceMatch?.[1] ? `${marker}${raw}` : `${raw} ${marker}`,
        currencies,
      };
    }
  }
  if (!unlimited && !(capacity && capacity > 0)) return null;
  return {
    price_major: price,
    capacity: unlimited ? null : capacity,
    unlimited,
    ...(typed
      ? { typed_price: typed.price, typed_currencies: typed.currencies }
      : {}),
  };
}

/**
 * #3355 P9 — a price on its own ("£45 per person", "45"): the same reading
 * as a ticket price, with no count needed. Null when there is no price.
 */
export function parseTypedPrice(text: string): {
  price_major: number;
  typed_price?: string;
  typed_currencies?: string[];
} | null {
  const parsed = parseTicketAnswer(`${text} no limit`, true);
  if (!parsed || parsed.price_major === null) return null;
  return {
    price_major: parsed.price_major,
    ...(parsed.typed_price
      ? {
        typed_price: parsed.typed_price,
        typed_currencies: parsed.typed_currencies,
      }
      : {}),
  };
}

/** The example price in the brand's own currency ("£15", "₦2,000"). */
export function examplePrice(currency: string): string {
  const minimum = providerMinimumChargeMinor(currency);
  const minimumMajor = minimum === null
    ? 0
    : minimum / minorUnitsPerMajor(currency);
  const amount = minimumMajor > 15 ? Math.ceil(minimumMajor * 20) : 15;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch (_error) {
    return `${amount} ${currency}`;
  }
}

export function currencyOf(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

export const PAYOUT_COUNTRY_KEY = "payout_country";

/** Is the open card the payout-country question? */
function askingPayoutCountry(ctx: FlowContext): boolean {
  return ctx.run.current_artefact?.reuse_key.startsWith(
    `event:${PAYOUT_COUNTRY_KEY}:`,
  ) === true;
}

const ticketDetailsStep: StepDefinition = {
  key: "event_ticket_details",
  title: "Ticket details",
  kind: "question",
  depends_on: ["event_ticket_kind"],
  policy: "blocking",
  async probe(ctx) {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    const row = await subjectRow(ctx);
    if (draftTickets(row).length > 0) return done("event_tickets", true);
    if (answer(ctx.run, "ticket")) return done("owner_ticket", true);
    const paid = answer(ctx.run, "ticket_kind") === "paid";
    const brand = paid ? await ctx.deps.brandFacts?.() ?? null : null;
    const currency = currencyOf(brand?.default_currency);
    const proposed = ctx.state?.state === "awaiting_approval";
    if (brand && paid && !currency) {
      // The Host ticket sheet's payout-country prompt: a price needs a
      // currency, and a paid ticket without one can never save.
      if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
        return { done: false, wait: true };
      }
      const failed = proposed && ctx.trigger === "confirm" &&
          ctx.failed?.tool_name === PAYOUT_COUNTRY_TOOL
        ? assertOwnerCopy(ctx.failed.message, {
          fallback: "The payout country didn't save, so nothing was changed.",
          surface: "flow_text",
          mode: "prose",
        })
        : null;
      return {
        done: false,
        ask: payoutCountryQuestion(ctx, brand.country_code, failed),
      };
    }
    const example = paid ? examplePrice(currency ?? "GBP") : "";
    return {
      done: false,
      ...(proposed && currency && ctx.trigger === "confirm"
        ? {
          note: `Saved and checked: ${ctx.brandName}'s prices are in ${
            currencyWords(currency)
          }.`,
        }
        : {}),
      ask: textQuestion({
        ctx,
        key: "ticket",
        title: paid ? "Price and number of tickets" : "How many can come",
        text: paid
          ? `What's the ticket price, and how many tickets? For example: ${example}, 60 tickets.`
          : "How many people can come? Say a number, or \"no limit\".",
        label: paid ? "Price and tickets" : "Number of people",
        placeholder: paid ? `e.g. ${example}, 60 tickets` : "e.g. 60 people",
      }),
    };
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  async onAnswer(ctx, choiceId, answer) {
    const response = formResponse(choiceId, answer);
    if (response === null) return null;
    if (askingPayoutCountry(ctx)) {
      const rail = payoutRailFor(response);
      if (!rail) {
        return retry(
          ctx,
          "Pick the country your bank account is in from the list. Nothing was saved.",
        );
      }
      const { ack, propose } = payoutCountryProposal(ctx, rail);
      return {
        record: {
          state: "awaiting_approval",
          data: { country_code: rail.country },
        },
        ack,
        propose,
      };
    }
    const paid = ctx.run.answers.ticket_kind?.value === "paid";
    const parsed = parseTicketAnswer(response, paid);
    if (!parsed) {
      return retry(
        ctx,
        paid
          ? "I need a price and a number of tickets (or \"no limit\"). Nothing was saved."
          : "I need a number of people (or \"no limit\"). Nothing was saved.",
      );
    }
    const brand = await ctx.deps.brandFacts?.() ?? null;
    const currency = currencyOf(brand?.default_currency);
    if (
      paid && currency && parsed.typed_currencies &&
      !parsed.typed_currencies.includes(currency)
    ) {
      // Never a silent save in the wrong currency: ask.
      return retry(
        ctx,
        `You typed ${parsed.typed_price}, but ${ctx.brandName}'s prices are in ${
          currencyWords(currency)
        }. Nothing was saved.`,
      );
    }
    const priceMinor = parsed.price_major === null
      ? 0
      : minorFromMajor(parsed.price_major, currency);
    if (paid) {
      // Seth's decision 6: the provider minimum, checked at price entry.
      const tooLow = ticketPriceBelowMinimum(priceMinor, currency);
      if (tooLow) return retry(ctx, `${tooLow} Nothing was saved.`);
    }
    return {
      record: { state: "pending" },
      answers: {
        ticket: owner({
          price_minor: priceMinor,
          capacity: parsed.capacity,
          unlimited: parsed.unlimited,
          paid,
        }),
      },
    };
  },
};

/** The one ticket the owner described. The name is a suggestion on the card. */
export const SUGGESTED_TICKET_NAME = "General admission";

const ticketSaveStep: StepDefinition = {
  key: "event_tickets_save",
  title: "Save the tickets",
  kind: "proposal",
  depends_on: ["event_ticket_details"],
  policy: "blocking",
  subject_tools: ["upsert_ticket_tier"],
  async probe(ctx): Promise<ProbeResult> {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    const row = await subjectRow(ctx);
    if (!row) return done("no_subject", true);
    const proposed = ctx.state?.state === "awaiting_approval";
    if (draftTickets(row).length > 0) {
      return {
        done: true,
        note: proposed
          ? "Saved and checked: the tickets are on the draft."
          : undefined,
        evidence: { probe: "event_tickets", observed: draftTickets(row).length },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const ticket = answer(ctx.run, "ticket") as TicketAnswer | undefined;
    if (!ticket) return done("no_ticket", true);
    // A refused save is never a dead end: the step comes back with the plain
    // reason and what the owner can do next (and stays until they choose).
    const failedNow = proposed && ctx.trigger === "confirm" &&
        ctx.failed?.tool_name === "upsert_ticket_tier"
      ? ctx.failed.message
      : null;
    const failedBefore = ctx.state?.state === "asked" &&
        typeof ctx.state.data?.failed === "string"
      ? ctx.state.data.failed
      : null;
    if (failedNow !== null || failedBefore !== null) {
      return {
        done: false,
        ask: await ticketFailedQuestion(ctx, ticket, failedNow ?? failedBefore ?? ""),
      };
    }
    const args = {
      event_id: row.id,
      name: SUGGESTED_TICKET_NAME,
      is_free: !ticket.paid,
      is_unlimited: ticket.unlimited,
      ...(ticket.unlimited ? {} : { capacity: ticket.capacity }),
      ...(ticket.paid ? { price_cents: ticket.price_minor } : {}),
    };
    const readiness = ticket.paid
      ? await ctx.deps.readiness("publish_paid").catch(() => null)
      : null;
    const brand = ticket.paid ? await ctx.deps.brandFacts?.() ?? null : null;
    const rows = [
      { label: "Ticket", value: SUGGESTED_TICKET_NAME },
      {
        label: "Price",
        value: ticket.paid
          ? formatMinor(ticket.price_minor, brand?.default_currency ?? null, "en") ??
            String(ticket.price_minor / 100)
          : "Free",
      },
      {
        label: "How many",
        value: ticket.unlimited ? "No limit" : `${ticket.capacity}`,
      },
      ...(readiness && !readiness.money.can_sell
        ? [{ label: "Heads-up", value: DRAFT_PAID_TIER_HEADS_UP }]
        : []),
    ];
    return {
      done: false,
      note: proposed && ctx.trigger === "confirm"
        ? "The tickets didn't save, so nothing is shown as done."
        : undefined,
      propose: {
        tool_name: "upsert_ticket_tier",
        tool_args: args,
        rows,
        rows_only: true,
      },
      ask: choiceQuestion({
        key: "tickets:ready",
        title: "Save the tickets",
        text: "Ready to save the tickets to the draft?",
        options: [{ id: "save", label: "Save to the draft" }],
      }),
      record: { data: {} },
    };
  },
  async onAnswer(ctx, choiceId) {
    if (choiceId === "no_tickets") {
      return {
        record: { state: "skipped", reason: "owner_kept_draft_without_tickets" },
        ack:
          "Okay. The draft stays without tickets for now; you can add them anytime.",
      };
    }
    if (choiceId === "free") {
      const ticket = answer(ctx.run, "ticket") as TicketAnswer | undefined;
      if (!ticket) return null;
      // The owner's own choice: the same ticket, free. The save is proposed
      // again below, behind its confirmation.
      return {
        record: { state: "pending" },
        answers: {
          ticket_kind: owner("free"),
          paid: owner(false),
          ticket: owner({ ...ticket, price_minor: 0, paid: false }),
        },
      };
    }
    if (choiceId !== "save" && choiceId !== "retry") return null;
    if (choiceId === "retry") {
      // Re-read with the failure answered, so the save is proposed again.
      return { record: { state: "pending" } };
    }
    const probe = await ticketSaveStep.probe(ctx);
    return "propose" in probe
      ? { record: { state: "awaiting_approval", data: {} }, propose: probe.propose }
      : { record: { state: "pending" } };
  },
};

type TicketAnswer = {
  price_minor: number;
  capacity: number | null;
  unlimited: boolean;
  paid: boolean;
};

/** The ticket save was refused: the plain reason and the next choices. */
async function ticketFailedQuestion(
  ctx: FlowContext,
  ticket: TicketAnswer,
  message: string,
): Promise<AskSpec> {
  const reason = assertOwnerCopy(message, {
    fallback: "The tickets didn't save, so nothing was changed.",
    surface: "flow_text",
    mode: "prose",
  });
  const options: { id: string; label: string; route?: string }[] = [];
  if (ticket.paid) {
    const readiness = await ctx.deps.readiness("publish_paid").catch(() => null);
    const sell = readiness?.items.find((item) => item.key === "money.can_sell");
    if (sell?.fix.can_caller_fix && sell.fix.route) {
      options.push({
        id: "open",
        label: `Open ${sell.fix.route_label}`.slice(0, 100),
        route: sell.fix.route,
      });
    }
    options.push({ id: "free", label: "Make the tickets free" });
  }
  options.push({ id: "retry", label: "Try saving again" });
  options.push({ id: "no_tickets", label: "Keep the draft without tickets" });
  return {
    kind: "question",
    reuse_key: "event:tickets:failed",
    title: "The tickets didn't save",
    text: `${reason} What would you like to do?`,
    options,
    record: { data: { failed: reason } },
  };
}

const VISIBILITY_OPTIONS = [
  { id: "public", label: "Public" },
  { id: "unlisted", label: "Unlisted" },
];

const visibilityStep: StepDefinition = {
  key: "event_visibility",
  title: "Who can find it",
  kind: "question",
  depends_on: ["event_tickets_save"],
  policy: "blocking",
  probe(ctx) {
    if (!wantsPublishReady(ctx)) return Promise.resolve(done("not_requested", true));
    const value = answer(ctx.run, "visibility");
    if (value === "public" || value === "unlisted") {
      return Promise.resolve(done("owner_visibility", value));
    }
    // Decision 8: asked here, Public first. Private is never offered while
    // private access is frozen (#1931).
    return Promise.resolve({
      done: false,
      ask: choiceQuestion({
        key: "visibility",
        title: "Who can find it",
        text:
          "When it's published, who should find it? Public shows it on Mingla; Unlisted is only for people with the link.",
        options: VISIBILITY_OPTIONS,
      }),
    });
  },
  onAnswer(_ctx, choiceId) {
    if (!VISIBILITY_OPTIONS.some((option) => option.id === choiceId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { visibility: owner(choiceId) },
    });
  },
};

/** The Host publish checks (draftEventValidation) a draft still misses. */
export function hostPublishGaps(row: FlowEventRow): string[] {
  const gaps: string[] = [];
  const draft = row.draft;
  if (!row.title.trim()) gaps.push("a name");
  if (!row.description) gaps.push("a description");
  if (row.party_types.length === 0) gaps.push("a party type");
  const when = (draft.when ?? {}) as Record<string, unknown>;
  if (!when.endsAt) gaps.push("an end time");
  const format = draft.format;
  const location = (draft.location ?? {}) as Record<string, unknown>;
  if (format !== "online" && (!row.city || !location.address)) {
    gaps.push("a venue address");
  }
  if ((format === "online" || format === "hybrid") && !row.online_url) {
    gaps.push("a joining link");
  }
  if (draftTickets(row).length === 0) gaps.push("tickets");
  return gaps;
}

function hasPaidTicket(row: FlowEventRow): boolean {
  return draftTickets(row).some((ticket) => {
    const t = ticket as Record<string, unknown>;
    return t.isFree !== true && Number(t.priceGbp ?? 0) > 0;
  });
}

async function publishBlockers(
  ctx: FlowContext,
  row: FlowEventRow,
): Promise<string[]> {
  const gaps = hostPublishGaps(row);
  const action = hasPaidTicket(row) ? "publish_paid" : "publish_free";
  const readiness = await ctx.deps.readiness(action);
  const blocking = readiness.items.filter((item) =>
    item.blocks_action && item.severity !== "done"
  ).map(publishBlockerClause);
  return [...gaps.map((gap) => `it needs ${gap}`), ...blocking];
}

// #3355 — each blocker reads as its own clause ("…isn't finished and you
// haven't accepted the Organiser Terms"), never a bare label tacked on.
const BLOCKER_CLAUSES: Readonly<Record<string, string>> = {
  "money.can_sell": "payment setup isn't finished",
  "money.terms_member": "you haven't accepted the Organiser Terms yet",
  "money.currency": "the brand has no currency yet",
  "money.market": "the brand hasn't chosen its payout country",
  "money.currency_reconciliation": "a currency change needs a decision",
  "money.tax_registration": "tax registration isn't set up",
};

export function publishBlockerClause(
  item: { key: string; label: string },
): string {
  return BLOCKER_CLAUSES[item.key] ?? `${item.label} still needs doing`;
}

const publishStep: StepDefinition = {
  key: "event_publish",
  title: "Publish",
  kind: "check",
  depends_on: ["event_visibility"],
  policy: "blocking",
  subject_tools: ["publish_event"],
  async probe(ctx): Promise<ProbeResult> {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    if (answer(ctx.run, "publish_later") === true) {
      return done("owner_publish_later", true);
    }
    const row = await subjectRow(ctx);
    if (!row) return done("no_subject", true);
    const proposed = ctx.state?.state === "awaiting_approval";
    if (row.status !== "draft") {
      return {
        done: true,
        note: proposed ? `Published and checked: "${row.title}" is live.` : undefined,
        evidence: { probe: "event_status", observed: row.status },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const blockers = await publishBlockers(ctx, row);
    const visibility = answer(ctx.run, "visibility") === "unlisted"
      ? "Unlisted"
      : "Public";
    const note = proposed && ctx.trigger === "confirm"
      ? "It wasn't published, so nothing is shown as live."
      : undefined;
    if (blockers.length > 0) {
      return {
        done: false,
        note,
        ask: choiceQuestion({
          key: `publish:blocked:${blockers.join("|")}`,
          title: "Not ready to publish yet",
          text: `Can't publish yet: ${listWords(blockers)}. Your draft is saved; nobody can see it until you publish.`,
          options: [
            { id: "publish", label: "Publish it" },
            { id: "check", label: "Check again" },
            { id: "later", label: "Not now" },
          ],
        }),
      };
    }
    // I-ARI-NEVER-AUTO-PUBLISH: this card only ASKS. Publishing is proposed
    // only from the owner's own "Publish it" (onAnswer), behind its own
    // protected confirmation.
    return {
      done: false,
      note,
      ask: choiceQuestion({
        key: `publish:ready:${visibility}`,
        title: "Ready to publish",
        text: `Everything's ready. Publish "${row.title}" now as ${visibility}? Nothing goes live until you say so.`,
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
    if (choiceId !== "publish") return null;
    const row = await subjectRow(ctx);
    if (!row || row.status !== "draft") return { record: { state: "pending" } };
    // Read before act: the owner asked; check again now.
    const blockers = await publishBlockers(ctx, row);
    if (blockers.length > 0) {
      return {
        record: { state: "pending" },
        // The re-presented card names the blockers; the ack only says what
        // happened, so the reason is never printed twice.
        ack: "Nothing was published.",
      };
    }
    const visibility = answer(ctx.run, "visibility") === "unlisted"
      ? "unlisted"
      : "public";
    return {
      record: { state: "awaiting_approval", data: {} },
      propose: {
        tool_name: "publish_event",
        tool_args: { event_id: row.id, visibility },
        rows: [
          { label: "Event", value: row.title },
          {
            label: "Who can find it",
            value: visibility === "public"
              ? "Public — shown on Mingla"
              : "Unlisted — only people with the link",
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
  const created = run.step_states.event_create;
  if (created?.state !== "done" || !created.evidence) return null;
  const observed = created.evidence.observed as { title?: string } | undefined;
  const title = observed?.title ? `"${observed.title}"` : "Your event";
  const published = run.step_states.event_publish?.evidence?.probe ===
    "event_status";
  return {
    title: published ? "Your event is live" : "Your event draft",
    text: published
      ? "It's live. Share it from its page whenever you're ready."
      : `${title} is saved as an unpublished draft and I've checked it's there. Nobody can see it until you publish. You can ask me to get it ready or publish it anytime.`,
    evidence: created.evidence,
  };
}

/**
 * The create_event flow, version 2. Version 1 (P3: gates, then the old event
 * planner) stays registered so a run already started on it finishes there.
 */
export const CREATE_EVENT_FLOW: FlowDefinition = {
  key: "create_event",
  version: EVENT_FLOW_VERSION,
  title: "Create an event",
  subject: "offering",
  concurrency: "one_per_subject",
  noun: "event",
  readiness: {
    draft: "draft_save",
    publish: "publish_free",
    publish_paid: "publish_paid",
  },
  subject_tools: ["create_event"],
  subject_table: "events",
  steps: [
    brandBlockersStep,
    brandCanWaitStep,
    moneyGateStep,
    titleStep,
    timezoneStep,
    startStep,
    endStep,
    formatStep,
    placeStep,
    privacyStep,
    linkStep,
    duplicateStep,
    createStep,
    publishReadyStep,
    coverStep,
    partyStep,
    descriptionStep,
    detailsSaveStep,
    ticketKindStep,
    ticketDetailsStep,
    ticketSaveStep,
    visibilityStep,
    publishStep,
  ],
  summarize,
};
