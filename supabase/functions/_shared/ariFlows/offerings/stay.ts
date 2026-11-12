/**
 * Issue #3355 P9 — "Create a stay" on the flow engine (audit D-22).
 *
 *   brand_gate (draft) → money_gate (only when the request asks for paid) →
 *   an approved Stay venue (picked; none = said plainly, with a way to add
 *   one) → the Stay settings the server needs to publish (summary of 20+
 *   characters, time zone, check-in and check-out), saved on ONE protected
 *   proposal when missing → the offering, typed like the Host's
 *   CreateStayOfferingInput: a room or a whole place, its name, guests and
 *   how many there are → the price (the payout-country question first when
 *   the brand has no currency) → the cancellation policy → ONE create
 *   proposal → read back → publish ONLY when the owner asks, behind its own
 *   protected confirmation.
 *
 * Every saved fact is the owner's (I-ARI-NO-INVENTED-FACTS): no default
 * price, guest count, number of rooms, times or policy. The offering shape
 * mirrors the Host's own create (StayInventoryManager): a room is
 * pooled_units with adults = guests and no children, a place is
 * exclusive_units priced per booking.
 */

import {
  brandBlockersStep,
  brandCanWaitStep,
  listWords,
} from "../brandGate.ts";
import { moneyGateStep } from "../moneyGate.ts";
import { marketDefaultTimezone } from "../../payoutCountries.ts";
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
} from "./event.ts";
import { cleanTitle, parseTimezoneAnswer, zoneWords } from "./eventFacts.ts";
import {
  doneWith as done,
  failedReason,
  offeringPriceStep,
  ownerAnswer as owner,
  priceAnswer,
  priceWords,
} from "./offeringPrice.ts";
import { VENUE_REVIEW_WORDS } from "./venue.ts";
import type {
  AnswerOutcome,
  FlowContext,
  FlowDefinition,
  FlowEvidence,
  FlowRun,
  FlowStayInventory,
  FlowVenueRow,
  ProbeResult,
  StepDefinition,
} from "../types.ts";

export const STAY_FLOW_VERSION = 2;
const NOUN = "stay";
const FORM_ANSWER = "answer";
/** The server's publish rule for a Stay summary. */
export const STAY_SUMMARY_MIN = 20;

/** "Still no draft": what the owner is told about an unpublished Stay. */
export const STAY_DRAFT_WORDS =
  "Draft — guests can't book it until you publish.";

function answer(run: FlowRun, key: string): unknown {
  return run.answers[key]?.value;
}

function stringAnswer(run: FlowRun, key: string): string | null {
  const value = answer(run, key);
  return typeof value === "string" && value.trim() ? value : null;
}

// ── The venue ─────────────────────────────────────────────────────────────

/** A venue a stay can go on: a Stay venue Mingla has approved. */
export function isApprovedStayVenue(venue: FlowVenueRow): boolean {
  return venue.venue_category === "stay" && venue.claim_status === "verified";
}

async function stayVenues(ctx: FlowContext): Promise<FlowVenueRow[]> {
  return (await ctx.deps.venues?.() ?? []).filter(isApprovedStayVenue);
}

async function chosenVenue(ctx: FlowContext): Promise<FlowVenueRow | null> {
  const id = stringAnswer(ctx.run, "venue_id");
  const venues = await stayVenues(ctx);
  if (id) return venues.find((venue) => venue.id === id) ?? null;
  // The only approved Stay venue is the answer; it is named on every card
  // after this one and on the create card the owner confirms.
  return venues.length === 1 ? venues[0] : null;
}

const venueStep: StepDefinition = {
  key: "stay_venue",
  title: "Which venue",
  kind: "question",
  depends_on: ["brand_blockers", "brand_can_wait", "money_gate"],
  policy: "blocking",
  async probe(ctx) {
    const venue = await chosenVenue(ctx);
    if (venue) {
      return {
        done: true,
        note: stringAnswer(ctx.run, "venue_id")
          ? undefined
          : `I'll add it to ${venue.name}, your approved Stay venue.`,
        evidence: {
          probe: "stay_venue",
          observed: { id: venue.id, name: venue.name },
        },
      };
    }
    const approved = await stayVenues(ctx);
    if (approved.length === 0) {
      const all = await ctx.deps.venues?.() ?? [];
      const inReview = all.filter((venue) =>
        venue.venue_category === "stay" &&
        venue.claim_status === "pending_review"
      );
      return {
        done: false,
        ask: choiceQuestion({
          noun: NOUN,
          key: `venue:none:${inReview.map((venue) => venue.id).join(",")}`,
          title: "No approved Stay venue yet",
          text: inReview.length > 0
            ? `A stay goes on a Stay venue Mingla has approved. ${
              listWords(inReview.map((venue) => `"${venue.name}"`))
            } ${
              inReview.length === 1 ? "is" : "are"
            } still in review — ${VENUE_REVIEW_WORDS} Nothing was created.`
            : "A stay goes on a Stay venue Mingla has approved, and you don't have one yet. Add your venue first — or say \"create a venue\" and I'll set it up with you. Nothing was created.",
          options: [
            ...(inReview.length === 0
              ? [{
                id: "add_venue",
                label: "Add a venue",
                route: "/venue/create",
              }]
              : []),
            { id: "check", label: "Check again" },
            { id: "cancel", label: "Stop here" },
          ],
        }),
      };
    }
    const problem = problemOf(ctx);
    const body = "Which venue is the stay at?";
    return {
      done: false,
      ask: {
        kind: "question",
        answer_mode: "form",
        reuse_key: `${NOUN}:venue:${attemptOf(ctx)}`,
        title: "Which venue",
        text: `${problem ? `${problem} ` : ""}${body}`,
        options: [],
        rendition: formRendition({
          id: "venue",
          noun: NOUN,
          title: "Which venue",
          body,
          choices: {
            options: approved.slice(0, 40).map((venue) => ({
              id: venue.id,
              label: venue.name,
            })),
            multiple: false,
          },
          problem,
        }),
        record: { data: { attempt: attemptOf(ctx) } },
      },
    };
  },
  textAnswer(_ctx, text) {
    const response = text.trim();
    return response
      ? { choices: [response], country: null, response: "" }
      : null;
  },
  async onAnswer(ctx, choiceId, given): Promise<AnswerOutcome | null> {
    if (choiceId === "cancel") {
      return {
        record: { state: "asked" },
        cancel_run: true,
        ack: "Okay, I've stopped here. Nothing was created.",
      };
    }
    if (choiceId === "check") return { record: { state: "pending" } };
    const picked = formResponse(choiceId, given);
    if (picked === null) return null;
    const venues = await stayVenues(ctx);
    const venue = venues.find((candidate) =>
      candidate.id === picked ||
      candidate.name.toLowerCase() === picked.toLowerCase()
    );
    if (!venue) {
      return retry(ctx, "Pick one of your approved venues. Nothing was saved.");
    }
    return {
      record: { state: "pending" },
      answers: { venue_id: owner(venue.id) },
    };
  },
};

// ── Stay settings (what publishing needs) ─────────────────────────────────

async function inventory(ctx: FlowContext): Promise<FlowStayInventory | null> {
  const venue = await chosenVenue(ctx);
  if (!venue || !ctx.deps.stayInventory) return null;
  return await ctx.deps.stayInventory(venue.id);
}

function hhmmOf(value: string | null | undefined): string | null {
  const match = /^(\d{2}):(\d{2})/.exec(value ?? "");
  return match ? `${match[1]}:${match[2]}` : null;
}

/** The server's publish rule (biz_publish_stay / staySettingsReadiness). */
export function staySettingsComplete(stay: FlowStayInventory | null): boolean {
  const settings = stay?.settings;
  if (!settings) return false;
  const checkIn = hhmmOf(settings.check_in_time);
  const checkOut = hhmmOf(settings.check_out_time);
  return settings.summary.trim().length >= STAY_SUMMARY_MIN &&
    !!settings.timezone && !!checkIn && !!checkOut && checkIn !== checkOut;
}

async function settingsNeeded(ctx: FlowContext): Promise<boolean> {
  return !staySettingsComplete(await inventory(ctx));
}

const summaryStep: StepDefinition = {
  key: "stay_summary",
  title: "About the stay",
  kind: "question",
  depends_on: ["stay_venue"],
  policy: "blocking",
  async probe(ctx) {
    if (!await settingsNeeded(ctx)) return done("stay_settings_complete", true);
    const stay = await inventory(ctx);
    if ((stay?.settings?.summary.trim().length ?? 0) >= STAY_SUMMARY_MIN) {
      return done("stay_summary", true);
    }
    if (stringAnswer(ctx.run, "summary")) return done("owner_summary", true);
    return {
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "summary",
        title: "About the stay",
        text:
          "Describe the stay for guests in a sentence or two (at least 20 characters). I'll save exactly what you write.",
        label: "About the stay",
        placeholder: "e.g. A quiet guesthouse five minutes from the beach.",
      }),
    };
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const summary = response.trim();
    if (summary.length < STAY_SUMMARY_MIN || summary.length > 500) {
      return Promise.resolve(retry(
        ctx,
        `A stay description needs ${STAY_SUMMARY_MIN} to 500 characters. Nothing was saved.`,
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { summary: owner(summary) },
    });
  },
};

const timezoneStep: StepDefinition = {
  key: "stay_timezone",
  title: "Time zone",
  kind: "question",
  depends_on: ["stay_summary"],
  policy: "blocking",
  async probe(ctx) {
    if (!await settingsNeeded(ctx)) return done("stay_settings_complete", true);
    const ownerZone = stringAnswer(ctx.run, "timezone");
    if (ownerZone) {
      return done("owner_timezone", { timezone: ownerZone, source: "owner" });
    }
    const stay = await inventory(ctx);
    if (stay?.settings?.timezone) {
      return done("stay_timezone", {
        timezone: stay.settings.timezone,
        source: "stay",
      });
    }
    // A stay's check-in clock is the venue's, not the brand's: a UK brand's
    // Lagos guesthouse checks in on Lagos time. The Host form has no default,
    // so without a single-zone venue country Ari asks.
    const venue = await chosenVenue(ctx);
    const venueZone = marketDefaultTimezone(venue?.country_code ?? null);
    if (venueZone) {
      return done("venue_country_timezone", {
        timezone: venueZone,
        source: "venue_country",
      });
    }
    return {
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "timezone",
        title: "Time zone",
        text:
          "What time zone is the stay in? Tell me the city — for example London, Lagos or New York.",
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

function stayZone(
  ctx: FlowContext,
): { timezone: string; source: string } | null {
  const observed = ctx.run.step_states.stay_timezone?.evidence?.observed as
    | { timezone?: unknown; source?: unknown }
    | undefined;
  return typeof observed?.timezone === "string"
    ? { timezone: observed.timezone, source: String(observed.source ?? "") }
    : null;
}

const CLOCK =
  /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b|\b(noon|midday|midnight)\b/gi;

/** "Check-in 3pm, check-out 11am" → { check_in: "15:00", check_out: "11:00" }. */
export function parseCheckTimes(
  text: string,
): { check_in: string; check_out: string } | null {
  const clocks: string[] = [];
  for (const match of text.matchAll(CLOCK)) {
    if (match[4]) {
      clocks.push(match[4].toLowerCase() === "midnight" ? "00:00" : "12:00");
      continue;
    }
    let hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    const meridiem = match[3]?.toLowerCase().startsWith("p")
      ? "pm"
      : match[3]
      ? "am"
      : null;
    if (meridiem && (hour < 1 || hour > 12)) continue;
    if (!meridiem && !match[2]) continue; // "2 guests" is not a time
    if (hour > 23 || minute > 59) continue;
    if (meridiem === "am") hour = hour % 12;
    if (meridiem === "pm") hour = (hour % 12) + 12;
    clocks.push(
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    );
  }
  if (clocks.length < 2 || clocks[0] === clocks[1]) return null;
  // "check-out 11am, check-in 3pm": the words decide which is which.
  const outFirst = /check[\s-]?out[\s\S]*check[\s-]?in/i.test(text);
  return outFirst
    ? { check_in: clocks[1], check_out: clocks[0] }
    : { check_in: clocks[0], check_out: clocks[1] };
}

function clockWords(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${
    h < 12 ? "am" : "pm"
  }`;
}

const timesStep: StepDefinition = {
  key: "stay_times",
  title: "Check-in and check-out",
  kind: "question",
  depends_on: ["stay_timezone"],
  policy: "blocking",
  async probe(ctx) {
    if (!await settingsNeeded(ctx)) return done("stay_settings_complete", true);
    if (answer(ctx.run, "check_times")) return done("owner_check_times", true);
    return {
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "check_times",
        title: "Check-in and check-out",
        text:
          "What are the check-in and check-out times? For example: check-in 3pm, check-out 11am.",
        label: "Check-in and check-out",
        placeholder: "e.g. check-in 3pm, check-out 11am",
      }),
    };
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const times = parseCheckTimes(response);
    if (!times) {
      return Promise.resolve(retry(
        ctx,
        "I need two different times: check-in and check-out. Nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { check_times: owner(times) },
    });
  },
};

const RAW_SETTINGS_KEYS: ReadonlyArray<[string, string]> = [
  ["property_kind", "propertyKind"],
  ["amenities", "amenities"],
  ["accessibility_features", "accessibilityFeatures"],
  ["arrival_instructions", "arrivalInstructions"],
  ["default_booking_mode", "defaultBookingMode"],
  ["instant_payment_hold_minutes", "instantPaymentHoldMinutes"],
  ["request_response_hours", "requestResponseHours"],
  ["approved_payment_minutes", "approvedPaymentMinutes"],
  ["booking_horizon_days", "bookingHorizonDays"],
  ["booking_state", "bookingState"],
  ["house_rules", "houseRules"],
];

/**
 * The save_settings payload: what is already stored stays as it is; only the
 * facts the owner just gave change.
 */
export function staySettingsPayload(
  stay: FlowStayInventory | null,
  given: {
    summary: string | null;
    timezone: string | null;
    check_in: string | null;
    check_out: string | null;
  },
): Record<string, unknown> {
  const raw = stay?.settings_raw ?? {};
  const kept: Record<string, unknown> = {};
  for (const [column, key] of RAW_SETTINGS_KEYS) {
    if (raw[column] !== undefined && raw[column] !== null) {
      kept[key] = raw[column];
    }
  }
  const current = stay?.settings;
  return {
    ...kept,
    summary: given.summary ?? current?.summary ?? "",
    timezone: given.timezone ?? current?.timezone,
    checkInTime: given.check_in ?? hhmmOf(current?.check_in_time),
    checkOutTime: given.check_out ?? hhmmOf(current?.check_out_time),
  };
}

const settingsSaveStep: StepDefinition = {
  key: "stay_settings_save",
  title: "Save the stay settings",
  kind: "proposal",
  depends_on: ["stay_times"],
  policy: "blocking",
  subject_tools: ["manage_stay_inventory"],
  async probe(ctx): Promise<ProbeResult> {
    const stay = await inventory(ctx);
    const proposed = ctx.state?.state === "awaiting_approval";
    if (staySettingsComplete(stay)) {
      return {
        done: true,
        note: proposed
          ? "Saved and checked: the stay settings are complete."
          : undefined,
        evidence: { probe: "stay_settings_complete", observed: true },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const venue = await chosenVenue(ctx);
    const zone = stayZone(ctx);
    const times = answer(ctx.run, "check_times") as
      | { check_in: string; check_out: string }
      | undefined;
    if (!venue || !stay || !zone) return done("no_venue", true);
    const payload = staySettingsPayload(stay, {
      summary: stringAnswer(ctx.run, "summary"),
      timezone: zone.timezone,
      check_in: times?.check_in ?? null,
      check_out: times?.check_out ?? null,
    });
    const refused = failedReason(
      ctx,
      "manage_stay_inventory",
      "The stay settings didn't save, so nothing was changed.",
    );
    return {
      done: false,
      ...(refused ? { note: refused } : {}),
      propose: {
        tool_name: "manage_stay_inventory",
        tool_args: {
          brand_id: ctx.run.brand_id,
          venue_id: venue.id,
          action: "save_settings",
          payload,
          // The first save has no version yet; the server refuses a stale one.
          ...(stay.settings_version !== null
            ? { expected_version: stay.settings_version }
            : {}),
        },
        rows: [
          { label: "Venue", value: venue.name },
          { label: "About the stay", value: String(payload.summary) },
          {
            label: "Time zone",
            value: `${zoneWords(zone.timezone)}${
              zone.source === "venue_country"
                ? ", from the venue's country"
                : ""
            }`,
          },
          {
            label: "Check-in",
            value: payload.checkInTime
              ? clockWords(String(payload.checkInTime))
              : "",
          },
          {
            label: "Check-out",
            value: payload.checkOutTime
              ? clockWords(String(payload.checkOutTime))
              : "",
          },
        ].filter((row) => row.value),
        rows_only: true,
      },
      ask: choiceQuestion({
        noun: NOUN,
        key: "settings:ready",
        title: "Save the stay settings",
        text: "Ready to save these stay settings?",
        options: [{ id: "save", label: "Save the settings" }],
      }),
      record: { data: {} },
    };
  },
  async onAnswer(ctx, choiceId) {
    if (choiceId !== "save") return null;
    const probe = await settingsSaveStep.probe(ctx);
    return "propose" in probe
      ? {
        record: { state: "awaiting_approval", data: {} },
        propose: probe.propose,
      }
      : { record: { state: "pending" } };
  },
};

// ── The offering (CreateStayOfferingInput) ────────────────────────────────

export const STAY_KIND_OPTIONS = [
  { id: "room", label: "Rooms" },
  { id: "place", label: "A whole place" },
];

const kindStep: StepDefinition = {
  key: "stay_kind",
  title: "Rooms or a whole place",
  kind: "question",
  depends_on: ["stay_settings_save"],
  policy: "blocking",
  probe(ctx) {
    const kind = stringAnswer(ctx.run, "kind");
    if (kind) return Promise.resolve(done("owner_kind", kind));
    return Promise.resolve({
      done: false,
      ask: choiceQuestion({
        noun: NOUN,
        key: "kind",
        title: "Rooms or a whole place",
        text: "Are guests booking rooms, or a whole place?",
        options: STAY_KIND_OPTIONS,
      }),
    });
  },
  onAnswer(_ctx, choiceId) {
    if (!STAY_KIND_OPTIONS.some((option) => option.id === choiceId)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { kind: owner(choiceId) },
    });
  },
};

const nameStep: StepDefinition = {
  key: "stay_name",
  title: "Name",
  kind: "question",
  depends_on: ["stay_kind"],
  policy: "blocking",
  probe(ctx) {
    const name = stringAnswer(ctx.run, "name");
    if (name) return Promise.resolve(done("owner_name", name));
    const room = stringAnswer(ctx.run, "kind") === "room";
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "name",
        title: "Name",
        text: room
          ? "What's this type of room called?"
          : "What's the place called?",
        label: "Name",
        placeholder: room ? "e.g. Sea View Double" : "e.g. The Garden Cottage",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  async onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return null;
    const name = cleanTitle(response);
    if (name.length < 2) {
      return retry(ctx, "I need a name of at least two letters.");
    }
    const stay = await inventory(ctx);
    if (
      stay?.offerings.some((offering) =>
        offering.name.trim().toLowerCase() === name.toLowerCase() &&
        offering.status !== "archived"
      )
    ) {
      return retry(
        ctx,
        `This venue already has "${name}". Give the new one another name. Nothing was saved.`,
      );
    }
    return { record: { state: "pending" }, answers: { name: owner(name) } };
  },
};

type StaySize = { guests: number; quantity: number };

/** "2 guests, 5 rooms" / "sleeps 6, just 1" → guests and how many. */
export function parseStaySize(text: string, kind: string): StaySize | null {
  const guests =
    /\b(?:sleeps|for|up to)\s+(\d{1,4})\b|\b(\d{1,4})\s*(?:guests?|people|persons?|adults?)\b/i
      .exec(text);
  const quantity =
    /\b(\d{1,5})\s*(?:rooms?|units?|places?|of them|cabins?|apartments?|cottages?|villas?|houses?|copies)\b|\b(?:have|got)\s+(\d{1,5})\b/i
      .exec(text);
  const g = guests ? Number(guests[1] ?? guests[2]) : NaN;
  let q = quantity ? Number(quantity[1] ?? quantity[2]) : NaN;
  if (
    Number.isNaN(q) && kind === "place" &&
    /\b(?:just one|only one|one of them|just 1)\b/i.test(text)
  ) {
    q = 1;
  }
  if (!(g >= 1 && g <= 1000) || !(q >= 1 && q <= 10000)) return null;
  return { guests: g, quantity: q };
}

const sizeStep: StepDefinition = {
  key: "stay_size",
  title: "Guests and how many",
  kind: "question",
  depends_on: ["stay_name"],
  policy: "blocking",
  probe(ctx) {
    if (answer(ctx.run, "size")) {
      return Promise.resolve(done("owner_size", true));
    }
    const room = stringAnswer(ctx.run, "kind") === "room";
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "size",
        title: "Guests and how many",
        text: room
          ? "How many guests can stay in one room, and how many of these rooms do you have? For example: 2 guests, 5 rooms."
          : "How many guests can the place sleep, and how many of these places do you have? For example: 6 guests, 1 place.",
        label: "Guests and how many",
        placeholder: room ? "e.g. 2 guests, 5 rooms" : "e.g. 6 guests, 1 place",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const size = parseStaySize(
      response,
      stringAnswer(ctx.run, "kind") ?? "room",
    );
    if (!size) {
      return Promise.resolve(retry(
        ctx,
        "I need both numbers: how many guests, and how many you have. Nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { size: owner(size) },
    });
  },
};

// A whole place is priced per booking (the Host's create does the same).
function placePriceWording(kind: string | null): string {
  return kind === "place" ? "per booking" : "per night";
}

const priceStep = offeringPriceStep({
  key: "stay_price",
  noun: NOUN,
  dependsOn: "stay_size",
  answerKey: "price",
  title: "Price",
  needed: () => Promise.resolve(true),
  question: (example, ctx) =>
    `What's the price ${
      placePriceWording(stringAnswer(ctx.run, "kind"))
    }? For example: ${example}.`,
  label: "Price",
  placeholder: (example) => `e.g. ${example}`,
});

const policyStep: StepDefinition = {
  key: "stay_policy",
  title: "Cancellation policy",
  kind: "question",
  depends_on: ["stay_price"],
  policy: "blocking",
  probe(ctx) {
    if (stringAnswer(ctx.run, "policy")) {
      return Promise.resolve(done("owner_policy", true));
    }
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "policy",
        title: "Cancellation policy",
        text:
          "What's your cancellation policy? Write it the way guests should read it. I'll save exactly what you write.",
        label: "Cancellation policy",
        placeholder: "e.g. Free cancellation up to 7 days before arrival.",
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const policy = response.trim();
    if (policy.length < 10 || policy.length > 2000) {
      return Promise.resolve(retry(
        ctx,
        "A cancellation policy needs at least a short sentence. Nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { policy: owner(policy) },
    });
  },
};

/**
 * The typed create_offering payload (CreateStayOfferingInput), shaped like
 * the Host's own create: only the owner's facts.
 */
export function createStayOfferingPayload(
  run: FlowRun,
  price: { price_minor: number; currency: string } | null,
): Record<string, unknown> | null {
  const kind = stringAnswer(run, "kind");
  const name = stringAnswer(run, "name");
  const size = answer(run, "size") as StaySize | undefined;
  const policy = stringAnswer(run, "policy");
  if (
    (kind !== "room" && kind !== "place") || !name || !size || !price || !policy
  ) {
    return null;
  }
  return {
    kind,
    name,
    inventoryBasis: kind === "room" ? "pooled_units" : "exclusive_units",
    unitNamingMode: "interchangeable",
    quantity: size.quantity,
    minGuests: 1,
    maxGuests: size.guests,
    ...(kind === "room"
      ? { maxAdults: size.guests, maxChildren: 0 }
      : { placePricingBasis: "per_booking" }),
    price: { amountMinor: price.price_minor, currencyCode: price.currency },
    policy: { cancellationPolicy: policy },
  };
}

function createdOffering(
  stay: FlowStayInventory | null,
  name: string | null,
): FlowStayInventory["offerings"][number] | null {
  if (!stay || !name) return null;
  return stay.offerings.find((offering) =>
    offering.name.trim().toLowerCase() === name.toLowerCase() &&
    offering.status !== "archived"
  ) ?? null;
}

const createStep: StepDefinition = {
  key: "stay_create",
  title: "Create the stay",
  kind: "proposal",
  depends_on: ["stay_policy"],
  policy: "blocking",
  subject_tools: ["manage_stay_inventory"],
  async probe(ctx): Promise<ProbeResult> {
    const proposed = ctx.state?.state === "awaiting_approval";
    const stay = await inventory(ctx);
    const venue = await chosenVenue(ctx);
    const name = stringAnswer(ctx.run, "name");
    const made = createdOffering(stay, name);
    // The name step refuses a name this venue already has, so an offering
    // with the owner's name is the one this run created.
    if (made) {
      return {
        done: true,
        note: proposed
          ? `Saved and checked: "${made.name}" is on ${
            venue?.name ?? "your venue"
          } as a draft — guests can't book it until you publish.`
          : undefined,
        evidence: {
          probe: "stay_offering_exists",
          observed: { id: made.id, name: made.name },
        },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const price = priceAnswer(ctx, "price");
    const payload = createStayOfferingPayload(ctx.run, price);
    const refused = failedReason(
      ctx,
      "manage_stay_inventory",
      "The stay wasn't created, so nothing was saved.",
    );
    const note = proposed && ctx.trigger === "confirm"
      ? refused ?? "The stay wasn't created, so nothing is shown as saved."
      : undefined;
    if (!payload || !venue || !stay || stay.settings_version === null) {
      return {
        done: false,
        note,
        ask: choiceQuestion({
          noun: NOUN,
          key: "create:incomplete",
          title: "Create the stay",
          text: "I'm missing a detail for this stay, so nothing was created.",
          options: [{ id: "cancel", label: "Stop here" }],
        }),
      };
    }
    const proposal = stayCreateProposal(ctx, venue, stay, payload, price!);
    return {
      done: false,
      note,
      propose: proposal,
      ask: choiceQuestion({
        noun: NOUN,
        key: "create:ready",
        title: "Create the stay",
        text:
          `Ready to add "${name}" to ${venue.name} as a draft? Guests can't book it until you publish.`,
        options: [{ id: "create", label: "Create the stay" }],
      }),
      record: { data: {} },
    };
  },
  async onAnswer(ctx, choiceId) {
    if (choiceId === "cancel") {
      return {
        record: { state: "asked" },
        cancel_run: true,
        ack: "Okay, I've stopped here. Nothing was created.",
      };
    }
    if (choiceId !== "create") return null;
    const probe = await createStep.probe(ctx);
    return "propose" in probe
      ? {
        record: { state: "awaiting_approval", data: {} },
        propose: probe.propose,
      }
      : { record: { state: "pending" } };
  },
};

function stayCreateProposal(
  ctx: FlowContext,
  venue: FlowVenueRow,
  stay: FlowStayInventory,
  payload: Record<string, unknown>,
  price: { price_minor: number; currency: string },
): NonNullable<AnswerOutcome["propose"]> {
  const kind = String(payload.kind);
  return {
    tool_name: "manage_stay_inventory",
    tool_args: {
      brand_id: ctx.run.brand_id,
      venue_id: venue.id,
      action: "create_offering",
      payload,
      expected_version: stay.settings_version,
    },
    rows: [
      { label: "Venue", value: venue.name },
      {
        label: kind === "room" ? "Room" : "Place",
        value: String(payload.name),
      },
      { label: "Guests", value: `Up to ${payload.maxGuests}` },
      {
        label: "How many",
        value: `${payload.quantity} ${
          kind === "room"
            ? Number(payload.quantity) === 1 ? "room" : "rooms"
            : Number(payload.quantity) === 1
            ? "place"
            : "places"
        }`,
      },
      {
        label: "Price",
        value: `${priceWords(price)} ${placePriceWording(kind)}`,
      },
      {
        label: "Cancellation",
        value: String(
          (payload.policy as { cancellationPolicy: string })
            .cancellationPolicy,
        ),
      },
      { label: "Status", value: STAY_DRAFT_WORDS },
    ],
    rows_only: true,
  };
}

// ── Publish (only when asked) ─────────────────────────────────────────────

async function publishBlockers(ctx: FlowContext): Promise<string[]> {
  const stay = await inventory(ctx);
  const gaps: string[] = [];
  if (!staySettingsComplete(stay)) gaps.push("it needs its stay settings");
  const readiness = await ctx.deps.readiness("stay_publish");
  const blocking = readiness.items.filter((item) =>
    item.blocks_action && item.severity !== "done"
  ).map(publishBlockerClause);
  return [...gaps, ...blocking];
}

const publishStep: StepDefinition = {
  key: "stay_publish",
  title: "Publish",
  kind: "check",
  depends_on: ["stay_create"],
  policy: "blocking",
  subject_tools: ["publish_stay"],
  async probe(ctx): Promise<ProbeResult> {
    if (answer(ctx.run, "publish_later") === true) {
      return done("owner_publish_later", true);
    }
    const stay = await inventory(ctx);
    const venue = await chosenVenue(ctx);
    const made = createdOffering(stay, stringAnswer(ctx.run, "name"));
    if (!made || !venue || !stay) return done("no_subject", true);
    const proposed = ctx.state?.state === "awaiting_approval";
    if (made.status === "live") {
      return {
        done: true,
        note: proposed
          ? `Published and checked: "${made.name}" is live.`
          : undefined,
        evidence: { probe: "stay_offering_status", observed: made.status },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const refused = failedReason(
      ctx,
      "publish_stay",
      "It wasn't published, so guests still can't book it.",
    );
    const note = proposed && ctx.trigger === "confirm"
      ? refused ?? "It wasn't published, so guests still can't book it."
      : undefined;
    const blockers = await publishBlockers(ctx);
    // I-ARI-NEVER-AUTO-PUBLISH: this card only ASKS.
    return {
      done: false,
      note,
      ask: choiceQuestion({
        noun: NOUN,
        key: blockers.length > 0
          ? `publish:blocked:${blockers.join("|")}`
          : "publish:ready",
        title: blockers.length > 0 ? "Not ready to publish yet" : "Publish?",
        text: blockers.length > 0
          ? `It's saved as a draft. Before guests can book: ${
            listWords(blockers)
          }.`
          : `It's saved as a draft. Publish ${venue.name}'s stay now? Nothing goes live until you say so.`,
        options: blockers.length > 0
          ? [
            {
              id: "open",
              label: "Open the venue",
              route: `/venue/${venue.id}`,
            },
            { id: "check", label: "Check again" },
            { id: "later", label: "Not now" },
          ]
          : [
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
        ack: "Okay. It stays a draft — guests can't book it until you publish.",
      };
    }
    if (choiceId === "check") return { record: { state: "pending" } };
    if (choiceId !== "publish") return null;
    const stay = await inventory(ctx);
    const venue = await chosenVenue(ctx);
    if (!stay || !venue || stay.settings_version === null) {
      return { record: { state: "pending" } };
    }
    // Read before act: the owner asked; check again now.
    if ((await publishBlockers(ctx)).length > 0) {
      return { record: { state: "pending" }, ack: "Nothing was published." };
    }
    return {
      record: { state: "awaiting_approval", data: {} },
      propose: {
        tool_name: "publish_stay",
        tool_args: {
          brand_id: ctx.run.brand_id,
          venue_id: venue.id,
          expected_version: stay.settings_version,
        },
        rows: [
          { label: "Venue", value: venue.name },
          {
            label: "Publishes",
            value: "The Stay and its ready draft rooms and places",
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
  const created = run.step_states.stay_create;
  if (created?.state !== "done" || !created.evidence) return null;
  const observed = created.evidence.observed as { name?: string } | undefined;
  const name = observed?.name ? `"${observed.name}"` : "Your stay";
  const published =
    run.step_states.stay_publish?.evidence?.probe === "stay_offering_status";
  return {
    title: published ? "Your stay is live" : "Your stay draft",
    text: published
      ? "It's live. Share it from its page whenever you're ready."
      : `${name} is saved as a draft and I've checked it's there. Guests can't book it until you publish. You can ask me to publish it anytime.`,
    evidence: created.evidence,
  };
}

/**
 * The create_stay flow, version 2. Version 1 (P3: gates, then the old model
 * lane) stays registered so a run already started on it finishes there.
 */
export const CREATE_STAY_FLOW: FlowDefinition = {
  key: "create_stay",
  version: STAY_FLOW_VERSION,
  title: "Create a stay",
  subject: "offering",
  concurrency: "one_per_subject",
  noun: NOUN,
  readiness: {
    draft: "draft_save",
    publish: "stay_publish",
    publish_paid: "stay_publish",
  },
  subject_tools: [],
  subject_table: null,
  // #3355 rework 2 (P2-11): the draft completes the run; publishing is
  // offered once on the completion card.
  follow_up: {
    step: "stay_publish",
    text: "Want me to check it's ready for guests to book?",
    yes: { id: "yes", label: "Check it's ready" },
    no: { id: "not_now", label: "Not now" },
    no_text:
      "Okay. It stays as a draft. Ask me to publish it whenever you like.",
  },
  steps: [
    brandBlockersStep,
    brandCanWaitStep,
    moneyGateStep,
    venueStep,
    summaryStep,
    timezoneStep,
    timesStep,
    settingsSaveStep,
    kindStep,
    nameStep,
    sizeStep,
    priceStep,
    policyStep,
    createStep,
    publishStep,
  ],
  summarize,
};
