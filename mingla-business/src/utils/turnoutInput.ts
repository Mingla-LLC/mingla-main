/**
 * Issue #1008 — the ONE turnout payload/key builder shared by the ambient
 * card and #1742's pre-publish gate. Intelligence never writes draft state.
 */
import { PARTY_TYPES } from "../constants/eventTaxonomy";
import {
  EXPERIENCE_INTENTS,
  type ExperienceIntentId,
} from "../constants/experienceIntents";
import type {
  ExperiencePricingMode,
  ExperienceStopDraft,
} from "../components/experience/experienceWizardTypes";
import type { ExperienceWhenState } from "../hooks/useExperienceDraftAdapter";
import type { DraftEvent } from "../store/draftEventStore";
import { effectiveDraftCurrency } from "./moneySummary";
import { expandRecurrenceToDates } from "./recurrenceRule";

export interface TurnoutEngineInput {
  title: string;
  category: string;
  city: string;
  venue_name: string;
  date: string;
  start_time?: string;
  indoor_outdoor: "indoor";
  ticket_price: number;
  capacity: number;
  budget: 0;
  audience_size: null;
  lineup: null;
  currency?: string;
}

export type TurnoutBlockReason =
  | "missing_title"
  | "missing_category"
  | "missing_city"
  | "missing_date"
  | "invalid_date"
  | "missing_capacity"
  | "unlimited_capacity"
  | "online_event";

export type TurnoutInputResult =
  | { ok: true; input: TurnoutEngineInput }
  | { ok: false; reason: TurnoutBlockReason };

export type TurnoutInputSource =
  | {
      kind: "event" | "rsvp";
      draft: DraftEvent;
      brandDefaultCurrency: string | null;
    }
  | {
      kind: "experience";
      title: string;
      intents: readonly ExperienceIntentId[];
      stops: readonly ExperienceStopDraft[];
      when: ExperienceWhenState;
      pricingMode: ExperiencePricingMode;
      resolvedTotalMajor: number;
      isFree: boolean;
      capacity: string;
      unlimited: boolean;
      brandDefaultCurrency: string | null;
    };

const isoDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const todayIso = (): string => isoDate(new Date());

export const resolveNextEventDate = (draft: DraftEvent): string | null => {
  const today = todayIso();
  if (draft.whenMode === "single") return draft.date;
  if (draft.whenMode === "multi_date") {
    const candidates = (draft.multiDates ?? [])
      .map((entry) => entry.date)
      .filter((date) => date >= today)
      .sort();
    return candidates[0] ?? null;
  }
  if (draft.date === null || draft.recurrenceRule === null) return null;
  const next = expandRecurrenceToDates(draft.recurrenceRule, draft.date)
    .map(isoDate)
    .filter((date) => date >= today)
    .sort();
  return next[0] ?? null;
};

export const resolveNextExperienceDate = (
  when: ExperienceWhenState,
): string | null => {
  const today = todayIso();
  if (when.whenMode === "single") return when.date;
  if (when.whenMode === "multi_date") {
    return (
      (when.multiDates ?? [])
        .map((entry) => entry.date)
        .filter((date) => date >= today)
        .sort()[0] ?? null
    );
  }
  if (when.date === null || when.recurrenceRule === null) return null;
  return (
    expandRecurrenceToDates(when.recurrenceRule, when.date)
      .map(isoDate)
      .filter((date) => date >= today)
      .sort()[0] ?? null
  );
};

const isValidForecastDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const today = new Date(`${todayIso()}T00:00:00`);
  const candidate = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(candidate.getTime()) || candidate < today) return false;
  const max = new Date(today);
  max.setDate(max.getDate() + 550);
  return candidate <= max;
};

const partyTypeCategory = (draft: DraftEvent): string => {
  const labels = new Map(
    PARTY_TYPES.map((option) => [option.slug, option.label]),
  );
  return draft.partyTypes
    .slice(0, 3)
    .map((slug) => labels.get(slug))
    .filter((label): label is string => label !== undefined)
    .join(", ")
    .slice(0, 60);
};

const eventCapacity = (draft: DraftEvent): number | TurnoutBlockReason => {
  if (draft.tickets.length === 0) return "missing_capacity";
  if (draft.tickets.some((ticket) => ticket.isUnlimited))
    return "unlimited_capacity";
  const capacity = draft.tickets.reduce(
    (total, ticket) => total + (ticket.capacity ?? 0),
    0,
  );
  return Number.isInteger(capacity) && capacity > 0
    ? capacity
    : "missing_capacity";
};

const eventTicketPrice = (draft: DraftEvent): number => {
  const prices = draft.tickets
    .filter(
      (ticket) =>
        ticket.visibility !== "disabled" &&
        !ticket.isFree &&
        ticket.priceGbp !== null &&
        ticket.priceGbp >= 0,
    )
    .map((ticket) => ticket.priceGbp as number);
  return prices.length === 0 ? 0 : Math.round(Math.min(...prices) * 100) / 100;
};

export const buildTurnoutInput = (
  source: TurnoutInputSource,
): TurnoutInputResult => {
  if (source.kind === "experience") {
    const title = source.title.trim().slice(0, 140);
    if (title.length < 2) return { ok: false, reason: "missing_title" };
    const labels = new Map(
      EXPERIENCE_INTENTS.map((item) => [item.id, item.label]),
    );
    const category = source.intents
      .slice(0, 3)
      .map((id) => labels.get(id))
      .filter((label): label is string => label !== undefined)
      .join(", ")
      .slice(0, 60);
    if (category.length < 2) return { ok: false, reason: "missing_category" };
    const firstStop = source.stops[0];
    const city = (firstStop?.city ?? "").trim().slice(0, 80);
    if (city.length < 2) return { ok: false, reason: "missing_city" };
    const date = resolveNextExperienceDate(source.when);
    if (date === null) return { ok: false, reason: "missing_date" };
    if (!isValidForecastDate(date))
      return { ok: false, reason: "invalid_date" };
    if (source.unlimited) return { ok: false, reason: "unlimited_capacity" };
    const capacity = Number(source.capacity);
    if (!Number.isInteger(capacity) || capacity < 1)
      return { ok: false, reason: "missing_capacity" };
    const currency = source.brandDefaultCurrency?.trim().toUpperCase() ?? "";
    const startTime = source.when.doorsOpen ?? firstStop?.startTime ?? "";
    return {
      ok: true,
      input: {
        title,
        category,
        city,
        venue_name: (firstStop?.placeName ?? "").trim().slice(0, 120),
        date,
        indoor_outdoor: "indoor",
        ticket_price: source.isFree
          ? 0
          : Math.max(0, source.resolvedTotalMajor),
        capacity,
        budget: 0,
        audience_size: null,
        lineup: null,
        ...(/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)
          ? { start_time: startTime }
          : {}),
        ...(/^[A-Z]{3}$/.test(currency) ? { currency } : {}),
      },
    };
  }
  const { draft } = source;
  if (draft.format === "online") return { ok: false, reason: "online_event" };
  const title = draft.name.trim().slice(0, 140);
  if (title.length < 2) return { ok: false, reason: "missing_title" };
  const category = partyTypeCategory(draft);
  if (category.length < 2) return { ok: false, reason: "missing_category" };
  const city = (draft.city ?? "").trim().slice(0, 80);
  if (city.length < 2) return { ok: false, reason: "missing_city" };
  const date = resolveNextEventDate(draft);
  if (date === null) return { ok: false, reason: "missing_date" };
  if (!isValidForecastDate(date)) return { ok: false, reason: "invalid_date" };

  const capacity =
    source.kind === "rsvp"
      ? (draft.rsvpCapacity ?? "unlimited_capacity")
      : eventCapacity(draft);
  if (typeof capacity !== "number") return { ok: false, reason: capacity };
  if (!Number.isInteger(capacity) || capacity < 1) {
    return { ok: false, reason: "missing_capacity" };
  }

  const currency = effectiveDraftCurrency(
    draft.currency,
    source.brandDefaultCurrency,
  );
  const startTime = draft.doorsOpen ?? "";
  const input: TurnoutEngineInput = {
    title,
    category,
    city,
    venue_name: (draft.venueName ?? "").trim().slice(0, 120),
    date,
    indoor_outdoor: "indoor",
    ticket_price: source.kind === "rsvp" ? 0 : eventTicketPrice(draft),
    capacity,
    budget: 0,
    audience_size: null,
    lineup: null,
    ...(/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)
      ? { start_time: startTime }
      : {}),
    ...(/^[A-Z]{3}$/.test(currency) ? { currency } : {}),
  };
  return { ok: true, input };
};

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

export const turnoutInputKey = (input: TurnoutEngineInput): string =>
  stableStringify({ tool: "events", input });

export const turnoutInputHash = (input: TurnoutEngineInput): string => {
  const source = turnoutInputKey(input);
  let hash = BigInt("14695981039346656037");
  const prime = BigInt("1099511628211");
  const mask = BigInt("0xffffffffffffffff");
  for (let index = 0; index < source.length; index += 1) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
};

export const turnoutMaterialKey = (input: TurnoutEngineInput): string =>
  stableStringify({
    date: input.date,
    city: input.city,
    capacity: input.capacity,
    ticket_price: input.ticket_price,
    currency: input.currency,
  });

/** Provider-session spending law shared by the turnout hook's effects. */
export class TurnoutRunBudget {
  private autoSpent = false;
  private readonly gateKeys = new Set<string>();

  spendAuto(): boolean {
    if (this.autoSpent) return false;
    this.autoSpent = true;
    return true;
  }

  spendPreview(inputKey: string): boolean {
    if (this.gateKeys.has(inputKey)) return false;
    this.gateKeys.add(inputKey);
    return true;
  }
}
