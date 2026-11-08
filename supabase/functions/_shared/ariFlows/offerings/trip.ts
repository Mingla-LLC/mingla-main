/**
 * Issue #3355 P8 — "Create a trip" on the flow engine.
 *
 *   brand_gate (draft) → money_gate (only when the request asks for paid or
 *   instalments) → title → first and last calendar day → time zone (the
 *   brand's, else its country's, else asked) → departure and destination
 *   picked from the address search → ONE create proposal → read back →
 *   "get it ready to publish?" → free or paid → the payout-country question
 *   when the brand has no currency → the package (name, price in the brand's
 *   currency, spots) → deposit and instalments (gated on payouts to the bank,
 *   "Skip instalments for now" when they aren't on) → ONE package proposal →
 *   refund policy (the trip wizard's presets) → ONE policy proposal →
 *   publish-readiness from the Host publish checks + brand_readiness →
 *   publish ONLY when the owner asks, behind its own protected confirmation.
 *
 * Every saved fact is the owner's (I-ARI-NO-INVENTED-FACTS): typed in their
 * request or a card, picked on a card, or the brand's own time zone shown on
 * the create card they confirm. The server side (ari_create_trip_draft)
 * refuses a missing zone, missing days and a past start, and creates no
 * package (migration 20280312003355).
 */

import {
  brandBlockersStep,
  brandCanWaitStep,
  listWords,
} from "../brandGate.ts";
import {
  currencyWords,
  moneyGateStep,
  PAYOUT_COUNTRY_TOOL,
  payoutCountryProposal,
} from "../moneyGate.ts";
import { marketDefaultTimezone, payoutRailFor } from "../../payoutCountries.ts";
import { isValidIanaTimezone } from "../../agentRelativeTime.ts";
import { ticketPriceBelowMinimum } from "../../money/providerMinimums.ts";
import { formatMinor, minorFromMajor } from "../../money/formatMinor.ts";
import { assertOwnerCopy } from "../../ariOwnerCopy.ts";
import { parseTripDateRange } from "../../agentTripPlanner.ts";
import {
  attemptOf,
  choiceQuestion,
  currencyOf,
  examplePrice,
  formResponse,
  parseTicketAnswer,
  PAYOUT_COUNTRY_KEY,
  payoutCountryQuestion,
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
  parseTimezoneAnswer,
  type PickedPlace,
  zoneWords,
} from "./eventFacts.ts";
import type {
  AnswerOutcome,
  AskSpec,
  FlowAnswerValue,
  FlowContext,
  FlowDefinition,
  FlowEvidence,
  FlowRun,
  FlowTripRow,
  ProbeResult,
  StepDefinition,
} from "../types.ts";

export const TRIP_FLOW_VERSION = 2;
const NOUN = "trip";
const FORM_ANSWER = "answer";

type Dates = { start_date: string; end_date: string };

type TripFacts = {
  title: string | null;
  dates: Dates | null;
  timezone: string | null;
  timezone_source: "owner" | "brand" | "country" | null;
  departure: PickedPlace | null;
  destination: PickedPlace | null;
};

function answer(run: FlowRun, key: string): unknown {
  return run.answers[key]?.value;
}

function owner(value: unknown): FlowAnswerValue {
  return { value, source: "owner" };
}

function done(probe: string, observed: unknown): ProbeResult {
  return { done: true, evidence: { probe, observed } };
}

function intentText(run: FlowRun): string {
  const text = answer(run, "intent_text");
  return typeof text === "string" ? text : "";
}

function stringAnswer(run: FlowRun, key: string): string | null {
  const value = answer(run, key);
  return typeof value === "string" && value.trim() ? value : null;
}

function observedOf(ctx: FlowContext, step: string): unknown {
  return ctx.run.step_states[step]?.evidence?.observed;
}

function isDates(value: unknown): value is Dates {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.start_date === "string" && typeof v.end_date === "string";
}

function placeAnswer(run: FlowRun, key: string): PickedPlace | null {
  const value = answer(run, key);
  return value && typeof value === "object" ? value as PickedPlace : null;
}

const TITLE_DATE_TAIL =
  /\s+(?:from|on|between|for|starting)\s+(?:the\s+)?(?:\d{1,4}\b|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d)[\s\S]*$/i;

/**
 * The name in the owner's request ("a trip called Lagos Weekend from 8 to
 * 10 January" → "Lagos Weekend"): the event title reader, without the dates.
 */
export function tripTitleFromIntent(
  text: string,
  brandName?: string,
): string | null {
  const title = extractEventTitle(text, brandName);
  if (!title) return null;
  const trimmed = title.replace(TITLE_DATE_TAIL, "").trim();
  return trimmed.length >= 2 ? trimmed : null;
}

/**
 * Everything the owner has given so far. A fact first read from the
 * request is pinned in its step's evidence, so "8 to 10 January" means the
 * same days on every later turn.
 */
export function tripFacts(ctx: FlowContext): TripFacts {
  const run = ctx.run;
  const pinnedTitle = observedOf(ctx, "trip_title");
  const title = stringAnswer(run, "title") ??
    (typeof pinnedTitle === "string" ? pinnedTitle : null) ??
    tripTitleFromIntent(intentText(run), ctx.brandName);
  const ownerDates = answer(run, "dates");
  const pinnedDates = observedOf(ctx, "trip_dates");
  // The owner chose "Change the dates": only a new answer counts now.
  const cleared = "dates" in run.answers && ownerDates === null;
  const dates = isDates(ownerDates)
    ? ownerDates
    : cleared
    ? null
    : isDates(pinnedDates)
    ? pinnedDates
    : parseTripDateRange(intentText(run));
  const tz = observedOf(ctx, "trip_timezone") as
    | { timezone?: unknown; source?: unknown }
    | undefined;
  const ownerZone = stringAnswer(run, "timezone");
  return {
    title,
    dates,
    timezone: ownerZone ??
      (typeof tz?.timezone === "string" ? tz.timezone : null),
    timezone_source: ownerZone
      ? "owner"
      : tz?.source === "brand" || tz?.source === "country"
      ? tz.source
      : null,
    departure: placeAnswer(run, "departure"),
    destination: placeAnswer(run, "destination"),
  };
}

/** "Fri 8 Jan – Sun 10 Jan 2027" for two calendar days (no zone shift). */
export function tripDaysWords(start: string, end: string): string {
  const day = (iso: string, withYear: boolean) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
    }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`)).replace(",", "");
  return start.slice(0, 10) === end.slice(0, 10)
    ? day(start, true)
    : `${day(start, false)} – ${day(end, true)}`;
}

// ── Draft facts ────────────────────────────────────────────────────────────

const titleStep: StepDefinition = {
  key: "trip_title",
  title: "Trip name",
  kind: "question",
  depends_on: ["brand_blockers", "brand_can_wait", "money_gate"],
  policy: "blocking",
  probe(ctx) {
    const { title } = tripFacts(ctx);
    if (title) return Promise.resolve(done("owner_title", title));
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "title",
        title: "Trip name",
        text: "What's the trip called?",
        label: "Trip name",
        placeholder: "e.g. Lagos Long Weekend",
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

const datesStep: StepDefinition = {
  key: "trip_dates",
  title: "Dates",
  kind: "question",
  depends_on: ["trip_title"],
  policy: "blocking",
  probe(ctx) {
    const { dates } = tripFacts(ctx);
    if (dates) return Promise.resolve(done("owner_dates", dates));
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "dates",
        title: "Dates",
        text:
          "What are the first and last days of the trip? For example: 8 to 10 January.",
        label: "First and last day",
        placeholder: "e.g. 8 to 10 January",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const dates = parseTripDateRange(response);
    if (!dates) {
      return Promise.resolve(retry(
        ctx,
        "I couldn't read a first and last day from today on from that, so nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { dates: owner(dates) },
    });
  },
};

const timezoneStep: StepDefinition = {
  key: "trip_timezone",
  title: "Time zone",
  kind: "question",
  depends_on: ["trip_dates"],
  policy: "blocking",
  async probe(ctx) {
    const ownerZone = stringAnswer(ctx.run, "timezone");
    if (ownerZone) {
      return done("owner_timezone", { timezone: ownerZone, source: "owner" });
    }
    // The brand's own zone, else its country's single zone; both are shown
    // on the create card the owner confirms. Never UTC by default.
    const brand = await ctx.deps.brandFacts?.() ?? null;
    if (
      brand?.default_timezone && isValidIanaTimezone(brand.default_timezone)
    ) {
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
          "What time zone is the trip in? Tell me the city — for example London, Lagos or New York.",
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

/** "Where does it leave from?" / "Where is it going?" — the address search. */
function placeStep(args: {
  key: "trip_departure" | "trip_destination";
  answerKey: "departure" | "destination";
  dependsOn: string;
  title: string;
  question: string;
}): StepDefinition {
  return {
    key: args.key,
    title: args.title,
    kind: "question",
    depends_on: [args.dependsOn],
    policy: "blocking",
    probe(ctx) {
      const place = placeAnswer(ctx.run, args.answerKey);
      if (place) {
        return Promise.resolve(done(`owner_${args.answerKey}`, place.address));
      }
      const problem = typeof ctx.state?.data?.problem === "string"
        ? `${ctx.state.data.problem} `
        : "";
      // The Host shows its address search (AddressInput) on this card.
      return Promise.resolve({
        done: false,
        ask: {
          kind: "question",
          answer_mode: "form",
          reuse_key: `${NOUN}:${args.answerKey}:${attemptOf(ctx)}`,
          title: args.title,
          text:
            `${problem}${args.question} Pick it from the search suggestions.`,
          options: [],
          record: { data: { attempt: attemptOf(ctx) } },
        },
      });
    },
    onAnswer(ctx, choiceId, given) {
      if (choiceId !== FORM_ANSWER) return Promise.resolve(null);
      const place = given?.values?.place;
      if (!place) {
        return Promise.resolve(retry(
          ctx,
          "Pick the place from the search suggestions. Nothing was saved.",
        ));
      }
      return Promise.resolve({
        record: { state: "pending" },
        answers: { [args.answerKey]: owner(place) },
      });
    },
  };
}

const departureStep = placeStep({
  key: "trip_departure",
  answerKey: "departure",
  dependsOn: "trip_timezone",
  title: "Where it leaves from",
  question: "Where does the trip leave from?",
});

const destinationStep = placeStep({
  key: "trip_destination",
  answerKey: "destination",
  dependsOn: "trip_departure",
  title: "Where it's going",
  question: "Where is the trip going?",
});

// ── The create proposal ───────────────────────────────────────────────────

function placeArg(place: PickedPlace): Record<string, unknown> {
  return {
    label: place.address,
    city: place.city,
    ...(place.country_code ? { country_code: place.country_code } : {}),
    lat: place.lat,
    lng: place.lng,
  };
}

/** The create_trip args — only the owner's facts (I-ARI-NO-INVENTED-FACTS). */
export function createTripArgs(
  brandId: string,
  facts: TripFacts,
): Record<string, unknown> | null {
  if (
    !facts.title || !facts.dates || !facts.timezone || !facts.departure ||
    !facts.destination
  ) return null;
  return {
    brand_id: brandId,
    title: facts.title,
    timezone: facts.timezone,
    start_date: facts.dates.start_date,
    end_date: facts.dates.end_date,
    departure: placeArg(facts.departure),
    destination: placeArg(facts.destination),
  };
}

export function createTripRows(
  facts: TripFacts,
): { label: string; value: string }[] {
  const tz = facts.timezone ?? "UTC";
  return [
    {
      label: "When",
      value: facts.dates
        ? tripDaysWords(facts.dates.start_date, facts.dates.end_date)
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
    { label: "Leaves from", value: facts.departure?.address ?? "" },
    { label: "Going to", value: facts.destination?.address ?? "" },
    { label: "Status", value: UNPUBLISHED_DRAFT_WORDS },
  ].filter((row) => row.value);
}

async function tripRow(ctx: FlowContext): Promise<FlowTripRow | null> {
  if (!ctx.run.subject_id || !ctx.deps.tripRow) return null;
  return await ctx.deps.tripRow(ctx.run.subject_id);
}

/** The owner-safe reason a confirmed trip write was refused, if it was. */
function failedReason(
  ctx: FlowContext,
  tool: string,
  fallback: string,
): string | null {
  if (
    ctx.state?.state !== "awaiting_approval" || ctx.trigger !== "confirm" ||
    ctx.failed?.tool_name !== tool
  ) return null;
  return assertOwnerCopy(ctx.failed.message, {
    fallback,
    surface: "flow_text",
    mode: "prose",
  });
}

const createStep: StepDefinition = {
  key: "trip_create",
  title: "Create the draft",
  kind: "proposal",
  depends_on: ["trip_destination"],
  policy: "blocking",
  subject_tools: ["create_trip"],
  async probe(ctx): Promise<ProbeResult> {
    const proposed = ctx.state?.state === "awaiting_approval";
    const row = await tripRow(ctx);
    if (row) {
      // Read back: the days as the Host wizard will show them.
      const days = row.start_at && row.end_at
        ? ` runs ${tripDaysWords(row.start_at, row.end_at)} and`
        : "";
      return {
        done: true,
        note: proposed
          ? `Saved and checked: "${row.title}"${days} is an unpublished draft — nobody can see it until you publish.`
          : undefined,
        evidence: {
          probe: "trip_exists",
          observed: {
            id: row.id,
            title: row.title,
            start_at: row.start_at,
            end_at: row.end_at,
          },
        },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const facts = tripFacts(ctx);
    const args = createTripArgs(ctx.run.brand_id, facts);
    const refused = failedReason(
      ctx,
      "create_trip",
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
          text: "I'm missing a detail for this trip, so nothing was created.",
          options: [{ id: "cancel", label: "Stop here" }],
        }),
      };
    }
    return {
      done: false,
      note,
      propose: {
        tool_name: "create_trip",
        tool_args: args,
        rows: createTripRows(facts),
        rows_only: true,
      },
      ask: choiceQuestion({
        noun: NOUN,
        key: "create:ready",
        title: "Create the draft",
        text:
          `Ready to save "${facts.title}" as an unpublished draft? Nobody can see it until you publish.`,
        options: [
          { id: "create", label: "Create the draft" },
          { id: "change_dates", label: "Change the dates" },
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
    if (choiceId === "change_dates") {
      // A refused past date (or the owner's own change) is never a dead end.
      return Promise.resolve({
        record: { state: "pending" },
        answers: { dates: { value: null, source: "owner" } },
        ack: "Okay. Nothing was saved.",
      });
    }
    if (choiceId !== "create") return Promise.resolve(null);
    const facts = tripFacts(ctx);
    const args = createTripArgs(ctx.run.brand_id, facts);
    if (!args) return Promise.resolve(null);
    return Promise.resolve({
      record: { state: "awaiting_approval", data: {} },
      propose: {
        tool_name: "create_trip",
        tool_args: args,
        rows: createTripRows(facts),
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
  key: "trip_publish_ready",
  title: "Get it ready to publish",
  kind: "question",
  depends_on: ["trip_create"],
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
        text:
          "Want to get it ready to publish? I'll need a package — its name, price and number of spots — and your refund policy.",
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

/** Packages are asked only while the trip has none saved. */
async function needsPackage(ctx: FlowContext): Promise<boolean> {
  if (!wantsPublishReady(ctx)) return false;
  const row = await tripRow(ctx);
  return !!row && row.packages.length === 0;
}

const packageKindStep: StepDefinition = {
  key: "trip_package_kind",
  title: "Free or paid",
  kind: "question",
  depends_on: ["trip_publish_ready"],
  policy: "blocking",
  async probe(ctx) {
    if (!await needsPackage(ctx)) return done("no_package_needed", true);
    const kind = answer(ctx.run, "package_kind");
    if (kind === "free" || kind === "paid") {
      return done("owner_package_kind", kind);
    }
    return {
      done: false,
      ask: choiceQuestion({
        noun: NOUN,
        key: "package_kind",
        title: "Free or paid",
        text: "Is the trip free or paid?",
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
    return Promise.resolve({
      record: { state: "pending" },
      answers: {
        package_kind: owner(choiceId),
        paid: owner(choiceId === "paid"),
      },
    });
  },
};

/** Seth's decision 3: a draft can hold a paid package before payments. */
export const PAID_PACKAGE_HEADS_UP =
  "You can save a paid package now; you'll need payments set up before you publish.";

type PackageAnswer = {
  name: string;
  price_minor: number;
  capacity: number;
  paid: boolean;
};

/** The owner's package words: "Shared room, ₦250,000, 12 spots". */
export function parsePackageAnswer(
  text: string,
  paid: boolean,
): {
  name: string | null;
  price_major: number | null;
  capacity: number | null;
  typed_price?: string;
  typed_currencies?: string[];
} | null {
  const normalized = text.replace(/\btravell?ers?\b/gi, "people");
  const parsed = parseTicketAnswer(normalized, paid);
  if (!parsed) return null;
  const name =
    text.split(/[,;\n]/).map((part) => part.trim()).find((part) =>
      /[A-Za-z]/.test(part) && !/\d/.test(part) && !/[£$€₦]/.test(part) &&
      !/^(?:free|no limit|unlimited)$/i.test(part)
    ) ?? null;
  return {
    name: name ? cleanTitle(name).slice(0, 80) : null,
    price_major: parsed.price_major,
    capacity: parsed.unlimited ? null : parsed.capacity,
    ...(parsed.typed_price
      ? {
        typed_price: parsed.typed_price,
        typed_currencies: parsed.typed_currencies,
      }
      : {}),
  };
}

function askingPayoutCountry(ctx: FlowContext): boolean {
  return ctx.run.current_artefact?.reuse_key.startsWith(
    `${NOUN}:${PAYOUT_COUNTRY_KEY}:`,
  ) === true;
}

const packageDetailsStep: StepDefinition = {
  key: "trip_package_details",
  title: "Package",
  kind: "question",
  depends_on: ["trip_package_kind"],
  policy: "blocking",
  async probe(ctx) {
    if (!await needsPackage(ctx)) return done("no_package_needed", true);
    if (answer(ctx.run, "package")) return done("owner_package", true);
    const paid = answer(ctx.run, "package_kind") === "paid";
    const brand = paid ? await ctx.deps.brandFacts?.() ?? null : null;
    const currency = currencyOf(brand?.default_currency);
    const proposed = ctx.state?.state === "awaiting_approval";
    if (brand && paid && !currency) {
      // A price needs a currency: the Host's payout-country prompt first.
      if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
        return { done: false, wait: true };
      }
      const failed = failedReason(
        ctx,
        PAYOUT_COUNTRY_TOOL,
        "The payout country didn't save, so nothing was changed.",
      );
      return {
        done: false,
        ask: payoutCountryQuestion(ctx, brand.country_code, failed, NOUN),
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
        noun: NOUN,
        key: "package",
        title: "Package",
        text: paid
          ? `What's the package called, its price, and how many spots? For example: Shared room, ${example}, 12 spots.`
          : "What's the package called, and how many spots? For example: Standard, 12 spots.",
        label: paid ? "Name, price and spots" : "Name and spots",
        placeholder: paid
          ? `e.g. Shared room, ${example}, 12 spots`
          : "e.g. Standard, 12 spots",
      }),
    };
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  async onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
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
    const paid = answer(ctx.run, "package_kind") === "paid";
    const parsed = parsePackageAnswer(response, paid);
    const shape = paid
      ? "I need the package name, its price and the number of spots."
      : "I need the package name and the number of spots.";
    if (!parsed || !parsed.capacity) {
      return retry(ctx, `${shape} Nothing was saved.`);
    }
    if (!parsed.name) {
      return retry(
        ctx,
        `Give the package a name too. ${shape} Nothing was saved.`,
      );
    }
    const brand = await ctx.deps.brandFacts?.() ?? null;
    const currency = currencyOf(brand?.default_currency);
    if (
      paid && currency && parsed.typed_currencies &&
      !parsed.typed_currencies.includes(currency)
    ) {
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
      const tooLow = ticketPriceBelowMinimum(priceMinor, currency);
      if (tooLow) return retry(ctx, `${tooLow} Nothing was saved.`);
    }
    const value: PackageAnswer = {
      name: parsed.name,
      price_minor: priceMinor,
      capacity: parsed.capacity,
      paid,
    };
    return { record: { state: "pending" }, answers: { package: owner(value) } };
  },
};

function packageAnswer(ctx: FlowContext): PackageAnswer | null {
  const value = answer(ctx.run, "package");
  return value && typeof value === "object" ? value as PackageAnswer : null;
}

/** The opening money step already said instalments must wait for payouts. */
function installmentsSetAside(ctx: FlowContext): boolean {
  const gate = ctx.run.step_states.money_gate;
  return gate?.state === "deferred" &&
    gate.reason === "installments_need_payouts";
}

const installmentsStep: StepDefinition = {
  key: "trip_installments",
  title: "Deposit and instalments",
  kind: "question",
  depends_on: ["trip_package_details"],
  policy: "blocking",
  async probe(ctx) {
    const pkg = packageAnswer(ctx);
    if (!pkg?.paid || !await needsPackage(ctx)) {
      return done("not_offered", true);
    }
    if (installmentsSetAside(ctx)) return done("installments_skipped", true);
    const value = answer(ctx.run, "installments");
    if (typeof value === "boolean") return done("owner_installments", value);
    return {
      done: false,
      ask: choiceQuestion({
        noun: NOUN,
        key: "installments",
        title: "Deposit and instalments",
        text:
          "Do you want travellers to pay a deposit and the rest in instalments, or pay in full when they book?",
        options: [
          { id: "yes", label: "Deposit and instalments" },
          { id: "no", label: "Pay in full" },
        ],
      }),
    };
  },
  onAnswer(_ctx, choiceId) {
    if (choiceId !== "yes" && choiceId !== "no") return Promise.resolve(null);
    return Promise.resolve({
      record: { state: "pending" },
      answers: { installments: owner(choiceId === "yes") },
    });
  },
};

/**
 * P6's money step for trip deposits and instalments: payouts to the bank
 * block them (the server's bank_required_for_installments), so without them
 * the card offers "Skip instalments for now".
 */
const installmentsMoneyStep: StepDefinition = {
  ...moneyGateStep,
  key: "trip_installments_money",
  title: "Payouts for instalments",
  depends_on: ["trip_installments"],
  async probe(ctx) {
    if (
      answer(ctx.run, "installments") !== true || !packageAnswer(ctx)?.paid ||
      installmentsSetAside(ctx) || !await needsPackage(ctx)
    ) {
      return done("not_requested", true);
    }
    return await moneyGateStep.probe(ctx);
  },
};

function installmentsAllowed(ctx: FlowContext): boolean {
  return answer(ctx.run, "installments") === true &&
    !installmentsSetAside(ctx) &&
    ctx.run.step_states.trip_installments_money?.state !== "deferred";
}

type Schedule = {
  deposit_pct: number;
  installments: { ordinal: number; pct: number; days_after_booking: number }[];
};

const WORD_COUNT: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
};

/**
 * "30% deposit, then 2 monthly payments": the deposit and an equal split of
 * the rest, one payment a month after booking (whole percents; the last
 * payment takes the remainder). Null when either number is missing.
 */
export function parseInstallmentPlan(text: string): Schedule | null {
  const deposit = /(\d{1,2})\s*%/.exec(text);
  const count =
    /\b(\d{1,2}|one|two|three|four|five|six)\s+(?:monthly\s+|more\s+|equal\s+)*(?:payments?|instal?lments?|months?)\b/i
      .exec(text);
  if (!deposit || !count) return null;
  const depositPct = Number(deposit[1]);
  const n = WORD_COUNT[count[1].toLowerCase()] ?? Number(count[1]);
  if (!(depositPct >= 1 && depositPct <= 90) || !(n >= 1 && n <= 11)) {
    return null;
  }
  const rest = 100 - depositPct;
  const each = Math.floor(rest / n);
  if (each < 1) return null;
  return {
    deposit_pct: depositPct,
    installments: Array.from({ length: n }, (_, i) => ({
      ordinal: i + 1,
      pct: i === n - 1 ? rest - each * (n - 1) : each,
      days_after_booking: 30 * (i + 1),
    })),
  };
}

export function scheduleWords(schedule: Schedule): string {
  const n = schedule.installments.length;
  return `${schedule.deposit_pct}% deposit, then ${n} monthly payment${
    n === 1 ? "" : "s"
  }`;
}

const installmentPlanStep: StepDefinition = {
  key: "trip_installment_plan",
  title: "Instalment plan",
  kind: "question",
  depends_on: ["trip_installments_money"],
  policy: "blocking",
  async probe(ctx) {
    if (!installmentsAllowed(ctx) || !await needsPackage(ctx)) {
      return done("not_requested", true);
    }
    if (answer(ctx.run, "schedule")) return done("owner_schedule", true);
    return {
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "schedule",
        title: "Instalment plan",
        text:
          "How much is the deposit, and in how many monthly payments is the rest paid? For example: 30% deposit, then 2 monthly payments.",
        label: "Deposit and payments",
        placeholder: "e.g. 30% deposit, then 2 monthly payments",
      }),
    };
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const schedule = parseInstallmentPlan(response);
    if (!schedule) {
      return Promise.resolve(retry(
        ctx,
        "I need a deposit percentage and a number of monthly payments. Nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { schedule: owner(schedule) },
    });
  },
};

const packageSaveStep: StepDefinition = {
  key: "trip_package_save",
  title: "Save the package",
  kind: "proposal",
  depends_on: ["trip_installment_plan"],
  policy: "blocking",
  subject_tools: ["manage_trip_tiers"],
  async probe(ctx): Promise<ProbeResult> {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    const row = await tripRow(ctx);
    if (!row) return done("no_subject", true);
    const proposed = ctx.state?.state === "awaiting_approval";
    if (row.packages.length > 0) {
      return {
        done: true,
        note: proposed
          ? "Saved and checked: the package is on the draft."
          : undefined,
        evidence: { probe: "trip_packages", observed: row.packages.length },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const pkg = packageAnswer(ctx);
    if (!pkg) return done("no_package", true);
    const refused = failedReason(
      ctx,
      "manage_trip_tiers",
      "The package didn't save, so nothing was changed.",
    );
    const before = ctx.state?.state === "asked" &&
        typeof ctx.state.data?.failed === "string"
      ? ctx.state.data.failed
      : null;
    if (refused !== null || before !== null) {
      // A refused save is never a dead end: the plain reason and the choices.
      return {
        done: false,
        ask: {
          kind: "question",
          reuse_key: `${NOUN}:package:failed`,
          title: "The package didn't save",
          text: `${refused ?? before} What would you like to do?`,
          options: [
            { id: "retry", label: "Try saving again" },
            { id: "no_package", label: "Keep the draft without it" },
          ],
          record: { data: { failed: refused ?? before } },
        },
      };
    }
    const schedule = installmentsAllowed(ctx)
      ? answer(ctx.run, "schedule") as Schedule | undefined
      : undefined;
    const args = {
      event_id: row.id,
      expected_updated_at: row.updated_at,
      items: [{
        tier_name: pkg.name,
        price_cents: pkg.price_minor,
        capacity: pkg.capacity,
        display_order: 0,
        tier_metadata: schedule ? { installments: schedule } : {},
      }],
    };
    const brand = pkg.paid ? await ctx.deps.brandFacts?.() ?? null : null;
    const readiness = pkg.paid
      ? await ctx.deps.readiness("publish_paid").catch(() => null)
      : null;
    const rows = [
      { label: "Package", value: pkg.name },
      {
        label: "Price",
        value: pkg.paid
          ? formatMinor(
            pkg.price_minor,
            brand?.default_currency ?? null,
            "en",
          ) ??
            String(pkg.price_minor / 100)
          : "Free",
      },
      { label: "Spots", value: `${pkg.capacity}` },
      ...(pkg.paid
        ? [{
          label: "Payment",
          value: schedule ? scheduleWords(schedule) : "In full when they book",
        }]
        : []),
      ...(readiness && !readiness.money.can_sell
        ? [{ label: "Heads-up", value: PAID_PACKAGE_HEADS_UP }]
        : []),
    ];
    return {
      done: false,
      propose: {
        tool_name: "manage_trip_tiers",
        tool_args: args,
        rows,
        rows_only: true,
      },
      ask: choiceQuestion({
        noun: NOUN,
        key: "package:ready",
        title: "Save the package",
        text: "Ready to save the package to the draft?",
        options: [{ id: "save", label: "Save to the draft" }],
      }),
      record: { data: {} },
    };
  },
  async onAnswer(ctx, choiceId) {
    if (choiceId === "no_package") {
      return {
        record: {
          state: "skipped",
          reason: "owner_kept_draft_without_package",
        },
        ack:
          "Okay. The draft stays without a package for now; you can add one anytime.",
      };
    }
    if (choiceId === "retry") return { record: { state: "pending" } };
    if (choiceId !== "save") return null;
    const probe = await packageSaveStep.probe(ctx);
    return "propose" in probe
      ? {
        record: { state: "awaiting_approval", data: {} },
        propose: probe.propose,
      }
      : { record: { state: "pending" } };
  },
};

/** The trip wizard's refund presets (refundPolicyModel.ts), in plain words. */
export const TRIP_REFUND_OPTIONS: ReadonlyArray<{
  id: string;
  label: string;
  words: string;
  policy: {
    kind: string;
    tiers: { days_before_start: number; refund_pct: number }[];
  };
}> = Object.freeze([
  {
    id: "flexible",
    label: "Flexible",
    words: "Full refund up to 30 days before, half up to 14 days before",
    policy: {
      kind: "flexible",
      tiers: [
        { days_before_start: 30, refund_pct: 100 },
        { days_before_start: 14, refund_pct: 50 },
        { days_before_start: 0, refund_pct: 0 },
      ],
    },
  },
  {
    id: "standard",
    label: "Standard",
    words: "Full refund up to 60 days before, half up to 30 days before",
    policy: {
      kind: "standard",
      tiers: [
        { days_before_start: 60, refund_pct: 100 },
        { days_before_start: 30, refund_pct: 50 },
        { days_before_start: 0, refund_pct: 0 },
      ],
    },
  },
  {
    id: "strict",
    label: "Strict",
    words: "Full refund up to 90 days before, then none",
    policy: {
      kind: "strict",
      tiers: [
        { days_before_start: 90, refund_pct: 100 },
        { days_before_start: 0, refund_pct: 0 },
      ],
    },
  },
  {
    id: "no_refunds",
    label: "No refunds",
    words: "No refunds once booked",
    policy: {
      kind: "custom",
      tiers: [{ days_before_start: 0, refund_pct: 0 }],
    },
  },
]);

const refundStep: StepDefinition = {
  key: "trip_refund_policy",
  title: "Refund policy",
  kind: "question",
  depends_on: ["trip_package_save"],
  policy: "blocking",
  async probe(ctx) {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    const row = await tripRow(ctx);
    if (!row) return done("no_subject", true);
    if (row.refund_policy) return done("trip_refund_policy", true);
    const chosen = answer(ctx.run, "refund_policy");
    if (typeof chosen === "string") return done("owner_refund_policy", chosen);
    return {
      done: false,
      ask: choiceQuestion({
        noun: NOUN,
        key: "refund_policy",
        title: "Refund policy",
        text: `Which refund policy should travellers get? ${
          TRIP_REFUND_OPTIONS.map((option) =>
            `${option.label}: ${option.words}.`
          )
            .join(" ")
        }`,
        options: TRIP_REFUND_OPTIONS.map(({ id, label }) => ({ id, label })),
      }),
    };
  },
  onAnswer(_ctx, choiceId) {
    if (!TRIP_REFUND_OPTIONS.some((option) => option.id === choiceId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { refund_policy: owner(choiceId) },
    });
  },
};

const refundSaveStep: StepDefinition = {
  key: "trip_refund_save",
  title: "Save the refund policy",
  kind: "proposal",
  depends_on: ["trip_refund_policy"],
  policy: "blocking",
  subject_tools: ["update_trip"],
  async probe(ctx): Promise<ProbeResult> {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    const row = await tripRow(ctx);
    if (!row) return done("no_subject", true);
    const proposed = ctx.state?.state === "awaiting_approval";
    if (row.refund_policy) {
      return {
        done: true,
        note: proposed
          ? "Saved and checked: the refund policy is on the draft."
          : undefined,
        evidence: {
          probe: "trip_refund_policy",
          observed: row.refund_policy.kind ?? true,
        },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const option = TRIP_REFUND_OPTIONS.find((candidate) =>
      candidate.id === answer(ctx.run, "refund_policy")
    );
    if (!option) return done("no_refund_policy", true);
    const refused = failedReason(
      ctx,
      "update_trip",
      "The refund policy didn't save, so nothing was changed.",
    );
    return {
      done: false,
      ...(refused ? { note: refused } : {}),
      propose: {
        tool_name: "update_trip",
        tool_args: {
          event_id: row.id,
          expected_updated_at: row.updated_at,
          refund_policy: option.policy,
        },
        rows: [
          {
            label: "Refund policy",
            value: `${option.label} — ${option.words}`,
          },
          { label: "Status", value: UNPUBLISHED_DRAFT_WORDS },
        ],
        rows_only: true,
      },
      ask: choiceQuestion({
        noun: NOUN,
        key: "refund:ready",
        title: "Save the refund policy",
        text: "Ready to save the refund policy to the draft?",
        options: [{ id: "save", label: "Save to the draft" }],
      }),
      record: { data: {} },
    };
  },
  async onAnswer(ctx, choiceId) {
    if (choiceId !== "save") return null;
    const probe = await refundSaveStep.probe(ctx);
    return "propose" in probe
      ? {
        record: { state: "awaiting_approval", data: {} },
        propose: probe.propose,
      }
      : { record: { state: "pending" } };
  },
};

/** The Host trip publish checks (business_publish_trip_draft + wizard). */
export function tripPublishGaps(row: FlowTripRow): string[] {
  const gaps: string[] = [];
  const picked = (place: FlowTripRow["departure"]) =>
    !!place && place.lat !== null && place.lng !== null;
  if (!row.title.trim()) gaps.push("a name");
  if (!row.start_at || !row.end_at) gaps.push("its dates");
  if (!picked(row.departure)) gaps.push("where it leaves from");
  if (!picked(row.destination)) gaps.push("where it's going");
  if (row.day_count === 0) gaps.push("at least one itinerary day");
  if (row.packages.length === 0) gaps.push("a package");
  return gaps;
}

async function publishBlockers(
  ctx: FlowContext,
  row: FlowTripRow,
): Promise<string[]> {
  const paid = row.packages.some((pkg) => pkg.price_cents > 0);
  const readiness = await ctx.deps.readiness(
    paid ? "publish_paid" : "publish_free",
  );
  const blocking = readiness.items.filter((item) =>
    item.blocks_action && item.severity !== "done"
  ).map(publishBlockerClause);
  return [...tripPublishGaps(row).map((gap) => `it needs ${gap}`), ...blocking];
}

const publishStep: StepDefinition = {
  key: "trip_publish",
  title: "Publish",
  kind: "check",
  depends_on: ["trip_refund_save"],
  policy: "blocking",
  subject_tools: ["publish_trip"],
  async probe(ctx): Promise<ProbeResult> {
    if (!wantsPublishReady(ctx)) return done("not_requested", true);
    if (answer(ctx.run, "publish_later") === true) {
      return done("owner_publish_later", true);
    }
    const row = await tripRow(ctx);
    if (!row) return done("no_subject", true);
    const proposed = ctx.state?.state === "awaiting_approval";
    if (row.status !== "draft") {
      return {
        done: true,
        note: proposed
          ? `Published and checked: "${row.title}" is live.`
          : undefined,
        evidence: { probe: "trip_status", observed: row.status },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const blockers = await publishBlockers(ctx, row);
    const refused = failedReason(
      ctx,
      "publish_trip",
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
          text: `Can't publish yet: ${
            listWords(blockers)
          }. Your draft is saved; nobody can see it until you publish.`,
          options: [
            {
              id: "open",
              label: "Open the trip",
              route: `/trip/${row.id}/edit`,
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
        text:
          `Everything's ready. Publish "${row.title}" now? Nothing goes live until you say so.`,
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
        ack:
          "Okay. It stays an unpublished draft — nobody can see it until you publish.",
      };
    }
    if (choiceId === "check") return { record: { state: "pending" } };
    if (choiceId !== "publish") return null;
    const row = await tripRow(ctx);
    if (!row || row.status !== "draft") return { record: { state: "pending" } };
    // Read before act: the owner asked; check again now.
    if ((await publishBlockers(ctx, row)).length > 0) {
      return { record: { state: "pending" }, ack: "Nothing was published." };
    }
    return {
      record: { state: "awaiting_approval", data: {} },
      propose: {
        tool_name: "publish_trip",
        tool_args: { event_id: row.id, expected_updated_at: row.updated_at },
        rows: [
          { label: "Trip", value: row.title },
          ...(row.start_at && row.end_at
            ? [{
              label: "When",
              value: tripDaysWords(row.start_at, row.end_at),
            }]
            : []),
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
  const created = run.step_states.trip_create;
  if (created?.state !== "done" || !created.evidence) return null;
  const observed = created.evidence.observed as { title?: string } | undefined;
  const title = observed?.title ? `"${observed.title}"` : "Your trip";
  const published =
    run.step_states.trip_publish?.evidence?.probe === "trip_status";
  return {
    title: published ? "Your trip is live" : "Your trip draft",
    text: published
      ? "It's live. Share it from its page whenever you're ready."
      : `${title} is saved as an unpublished draft and I've checked it's there. Nobody can see it until you publish. You can ask me to get it ready or publish it anytime.`,
    evidence: created.evidence,
  };
}

/**
 * The create_trip flow, version 2. Version 1 (P3: gates, then the old trip
 * lane) stays registered so a run already started on it finishes there.
 */
export const CREATE_TRIP_FLOW: FlowDefinition = {
  key: "create_trip",
  version: TRIP_FLOW_VERSION,
  title: "Create a trip",
  subject: "offering",
  concurrency: "one_per_subject",
  noun: NOUN,
  readiness: {
    draft: "draft_save",
    publish: "publish_free",
    publish_paid: "publish_paid",
  },
  subject_tools: ["create_trip"],
  subject_table: "events",
  steps: [
    brandBlockersStep,
    brandCanWaitStep,
    moneyGateStep,
    titleStep,
    datesStep,
    timezoneStep,
    departureStep,
    destinationStep,
    createStep,
    publishReadyStep,
    packageKindStep,
    packageDetailsStep,
    installmentsStep,
    installmentsMoneyStep,
    installmentPlanStep,
    packageSaveStep,
    refundStep,
    refundSaveStep,
    publishStep,
  ],
  summarize,
};
