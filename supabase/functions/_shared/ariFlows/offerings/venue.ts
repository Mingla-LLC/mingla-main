/**
 * Issue #3355 P9 — "Create a venue" on the flow engine (audit D-21).
 *
 *   brand_gate (venue_submit) → the place, picked from the address search
 *   (never coordinates typed by anyone) → the name → the web address,
 *   derived from the name and confirmed by the owner → the category (the
 *   server's list; Stay only while Stay authoring is on) → opening hours for
 *   all seven days → contact (the brand's own, confirmed, or typed) → ONE
 *   submit proposal → read back: "Mingla reviews new venues before they go
 *   live" (pending_review) → a skippable cover handoff on the venue page.
 *
 * Every saved fact is the owner's (I-ARI-NO-INVENTED-FACTS): no default
 * hours, category or contact. There is no publish: admin verification makes
 * a venue public.
 */

import { brandBlockersStep, brandCanWaitStep, listWords } from "../brandGate.ts";
import { moneyGateStep } from "../moneyGate.ts";
import {
  attemptOf,
  choiceQuestion,
  formResponse,
  problemOf,
  proposalOpen,
  retry,
  textQuestion,
  typedAnswer,
} from "./event.ts";
import { cleanTitle, type PickedPlace } from "./eventFacts.ts";
import {
  doneWith as done,
  failedReason,
  ownerAnswer as owner,
} from "./offeringPrice.ts";
import type {
  FlowContext,
  FlowDefinition,
  FlowEvidence,
  FlowRun,
  FlowVenueRow,
  ProbeResult,
  StepDefinition,
} from "../types.ts";

export const VENUE_FLOW_VERSION = 2;
const NOUN = "venue";
const FORM_ANSWER = "answer";

/** What the owner is told once a venue is submitted (spec §6 P9). */
export const VENUE_REVIEW_WORDS =
  "Mingla reviews new venues before they go live.";

/** The server's venue categories, with the Host's labels. */
export const VENUE_CATEGORY_OPTIONS: ReadonlyArray<
  { id: string; label: string }
> = Object.freeze([
  { id: "restaurant", label: "Restaurant" },
  { id: "play", label: "Play" },
  { id: "creative_and_arts", label: "Creative & arts" },
]);
export const STAY_CATEGORY_OPTION = Object.freeze({ id: "stay", label: "Stay" });
export const STAY_AUTHORING_FLAG = "STAY_VENUE_AUTHORING";

/** One opening-hours row, as biz_create_venue_listing reads it. */
export type VenueHourRow = {
  weekday: number;
  open_time?: string;
  close_time?: string;
  is_closed: boolean;
};

type Contact = { email: string | null; phone: string | null };

function answer(run: FlowRun, key: string): unknown {
  return run.answers[key]?.value;
}

function stringAnswer(run: FlowRun, key: string): string | null {
  const value = answer(run, key);
  return typeof value === "string" && value.trim() ? value : null;
}

function placeAnswer(run: FlowRun): PickedPlace | null {
  const value = answer(run, "place");
  return value && typeof value === "object" ? value as PickedPlace : null;
}

// ── Web address (slug) ─────────────────────────────────────────────────────

/** The server's slug rule: 1–32 lowercase letters and digits. */
export const VENUE_SLUG = /^[a-z0-9]{1,32}$/;

/** "Mama's Kitchen & Bar" → "mamaskitchenbar" (the server's slug rule). */
export function slugFromName(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
}

/** The derived slug, made free among this brand's venues (2, 3, …). */
export function freeSlug(base: string, taken: ReadonlySet<string>): string {
  const root = base || "venue";
  if (!taken.has(root)) return root;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = String(n);
    const candidate = `${root.slice(0, 32 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return root;
}

async function takenSlugs(ctx: FlowContext): Promise<Set<string>> {
  const venues = await ctx.deps.venues?.() ?? [];
  return new Set(venues.map((venue) => venue.slug.toLowerCase()));
}

// ── Opening hours ──────────────────────────────────────────────────────────

const DAY_NAMES: ReadonlyArray<[RegExp, number]> = [
  [/^mon(?:day)?s?$/i, 0],
  [/^tue(?:s(?:day)?)?s?$/i, 1],
  [/^wed(?:nesday)?s?$/i, 2],
  [/^thu(?:r(?:s(?:day)?)?)?s?$/i, 3],
  [/^fri(?:day)?s?$/i, 4],
  [/^sat(?:urday)?s?$/i, 5],
  [/^sun(?:day)?s?$/i, 6],
];
export const WEEKDAY_WORDS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const DAY_TOKEN =
  "(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?";
const DAY_RANGE = new RegExp(
  `\\b(${DAY_TOKEN})\\s*(?:-|–|—|to|through|thru)\\s*(${DAY_TOKEN})\\b`,
  "gi",
);
const DAY_SINGLE = new RegExp(`\\b(${DAY_TOKEN})\\b`, "gi");
const EVERY_DAY =
  /\b(?:every\s*day|everyday|daily|all\s+week|each\s+day|7\s+days(?:\s+a\s+week)?|same\s+(?:hours\s+)?every\s+day)\b/i;
const CLOCK_TOKEN =
  /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\s|$|-|–|—|,|;|\b)|\b(noon|midday|midnight)\b/gi;

function dayIndex(token: string): number | null {
  for (const [pattern, index] of DAY_NAMES) {
    if (pattern.test(token.trim())) return index;
  }
  return null;
}

function daysIn(segment: string): number[] {
  const days = new Set<number>();
  if (EVERY_DAY.test(segment)) [0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d));
  if (/\bweekdays?\b/i.test(segment)) [0, 1, 2, 3, 4].forEach((d) => days.add(d));
  if (/\bweekends?\b/i.test(segment)) [5, 6].forEach((d) => days.add(d));
  let rest = segment;
  for (const match of segment.matchAll(DAY_RANGE)) {
    const from = dayIndex(match[1]);
    const to = dayIndex(match[2]);
    if (from === null || to === null) continue;
    for (let d = from, i = 0; i < 7; i += 1, d = (d + 1) % 7) {
      days.add(d);
      if (d === to) break;
    }
    rest = rest.replace(match[0], " ");
  }
  for (const match of rest.matchAll(DAY_SINGLE)) {
    const d = dayIndex(match[1]);
    if (d !== null) days.add(d);
  }
  return [...days].sort((a, b) => a - b);
}

type Clock = { hour: number; minute: number; meridiem: "am" | "pm" | null };

function clocksIn(segment: string): Clock[] {
  // Day words are removed first so "Sat" is never read as a time.
  const text = segment.replace(DAY_RANGE, " ").replace(DAY_SINGLE, " ");
  const clocks: Clock[] = [];
  for (const match of text.matchAll(CLOCK_TOKEN)) {
    if (match[4]) {
      const word = match[4].toLowerCase();
      clocks.push(
        word === "midnight"
          ? { hour: 12, minute: 0, meridiem: "am" }
          : { hour: 12, minute: 0, meridiem: "pm" },
      );
      continue;
    }
    const hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    const meridiem = match[3]
      ? (match[3].toLowerCase().startsWith("a") ? "am" : "pm")
      : null;
    if (hour > 23 || minute > 59 || (meridiem && (hour < 1 || hour > 12))) {
      continue;
    }
    clocks.push({ hour, minute, meridiem });
  }
  return clocks;
}

function minutesOf(clock: Clock, meridiem: "am" | "pm" | null): number {
  let hour = clock.hour;
  if (meridiem === "am") hour = hour % 12;
  if (meridiem === "pm") hour = (hour % 12) + 12;
  return hour * 60 + clock.minute;
}

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "9am–5pm", "10-2pm", "18:00-23:30", "9-5": open and close in minutes. */
function rangeOf(segment: string): { open: number; close: number } | null {
  const clocks = clocksIn(segment);
  if (clocks.length < 2) return null;
  const [a, b] = clocks;
  const twentyFour = (c: Clock) => c.meridiem === null && c.hour > 12;
  let open: number;
  let close: number;
  if (a.meridiem || twentyFour(a)) {
    open = minutesOf(a, a.meridiem);
  } else if (b.meridiem) {
    // "10-2pm": the open takes the close's half of the day unless that puts
    // it after the close ("10–2pm" opens at 10am).
    const same = minutesOf(a, b.meridiem);
    open = same < minutesOf(b, b.meridiem) ? same : minutesOf(a, "am");
  } else {
    open = minutesOf(a, null);
  }
  if (b.meridiem || twentyFour(b)) {
    close = minutesOf(b, b.meridiem);
  } else if (a.meridiem) {
    const same = minutesOf(b, a.meridiem);
    close = same > open ? same : minutesOf(b, a.meridiem === "am" ? "pm" : "am");
  } else {
    // "9-5": a close earlier than the open is the afternoon.
    close = minutesOf(b, null);
    if (close <= open && b.hour < 12) close += 12 * 60;
  }
  return { open: open % (24 * 60), close: close % (24 * 60) };
}

/**
 * The owner's hours for all seven days ("Mon–Fri 9am–5pm, Sat 10am–2pm, Sun
 * closed" or "9am to 5pm every day"). Close before open is an overnight span
 * (the Host's rule); open equal to close is refused. Days the words never
 * mention come back in `missing`, never filled in.
 */
export function parseVenueHours(text: string): {
  rows: VenueHourRow[];
  missing: number[];
  problem: string | null;
} {
  const byDay = new Map<number, VenueHourRow>();
  const segments = text.split(/[,;\n]+/).map((part) => part.trim())
    .filter(Boolean);
  let problem: string | null = null;
  for (const segment of segments) {
    let days = daysIn(segment);
    if (days.length === 0 && segments.length === 1) days = [0, 1, 2, 3, 4, 5, 6];
    if (days.length === 0) continue;
    if (/\bclosed\b/i.test(segment)) {
      for (const day of days) byDay.set(day, { weekday: day, is_closed: true });
      continue;
    }
    const range = rangeOf(segment);
    if (!range) {
      problem = `I couldn't read the times in "${segment}".`;
      continue;
    }
    if (range.open === range.close) {
      problem = "Open and close can't be the same time.";
      continue;
    }
    for (const day of days) {
      byDay.set(day, {
        weekday: day,
        open_time: hhmm(range.open),
        close_time: hhmm(range.close),
        is_closed: false,
      });
    }
  }
  const missing = [0, 1, 2, 3, 4, 5, 6].filter((day) => !byDay.has(day));
  return {
    rows: [...byDay.values()].sort((a, b) => a.weekday - b.weekday),
    missing,
    problem,
  };
}

function clockWords(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
}

/** "Mon–Fri 9am–5pm · Sat 10am–2pm · Sun closed" for the card. */
export function hoursWords(rows: VenueHourRow[]): string {
  const label = (row: VenueHourRow) =>
    row.is_closed
      ? "closed"
      : `${clockWords(row.open_time ?? "")}–${clockWords(row.close_time ?? "")}`;
  const groups: { from: number; to: number; text: string }[] = [];
  for (const row of rows) {
    const text = label(row);
    const last = groups[groups.length - 1];
    if (last && last.text === text && last.to === row.weekday - 1) {
      last.to = row.weekday;
    } else groups.push({ from: row.weekday, to: row.weekday, text });
  }
  const short = (d: number) => WEEKDAY_WORDS[d].slice(0, 3);
  if (groups.length === 1 && groups[0].from === 0 && groups[0].to === 6) {
    return `Every day ${groups[0].text}`;
  }
  return groups.map((group) =>
    `${short(group.from)}${group.to !== group.from ? `–${short(group.to)}` : ""} ${group.text}`
  ).join(" · ");
}

// ── Contact ────────────────────────────────────────────────────────────────

const EMAIL = /[^\s@,;]+@[^\s@,;]+\.[A-Za-z]{2,}/;
const PHONE = /\+\d[\d\s().-]{6,20}\d/;

/** Email and/or an international phone number from the owner's words. */
export function parseContact(text: string): Contact | null {
  const email = EMAIL.exec(text)?.[0] ?? null;
  const rawPhone = PHONE.exec(text)?.[0] ?? null;
  const phone = rawPhone ? `+${rawPhone.replace(/\D/g, "")}` : null;
  if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) return null;
  return email || phone ? { email, phone } : null;
}

function contactAnswer(run: FlowRun): Contact | null {
  const value = answer(run, "contact");
  return value && typeof value === "object" ? value as Contact : null;
}

function contactWords(contact: Contact): string {
  return [contact.email, contact.phone].filter(Boolean).join(" · ");
}

// ── Steps ──────────────────────────────────────────────────────────────────

const placeStep: StepDefinition = {
  key: "venue_place",
  title: "Where",
  kind: "question",
  depends_on: ["brand_blockers", "brand_can_wait", "money_gate"],
  policy: "blocking",
  probe(ctx) {
    const place = placeAnswer(ctx.run);
    if (place) return Promise.resolve(done("owner_place", place.address));
    const problem = problemOf(ctx);
    // The Host shows its address search (MapboxAddressInput) on this card.
    return Promise.resolve({
      done: false,
      ask: {
        kind: "question",
        answer_mode: "form",
        reuse_key: `${NOUN}:place:${attemptOf(ctx)}`,
        title: "Where is the venue?",
        text: `${
          problem ? `${problem} ` : ""
        }Where is the venue? Pick the address from the search suggestions, so guests can find it.`,
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
        "Pick the address from the search suggestions. Nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { place: owner(place) },
    });
  },
};

const nameStep: StepDefinition = {
  key: "venue_name",
  title: "Venue name",
  kind: "question",
  depends_on: ["venue_place"],
  policy: "blocking",
  probe(ctx) {
    const name = stringAnswer(ctx.run, "name");
    if (name) return Promise.resolve(done("owner_name", name));
    const place = placeAnswer(ctx.run);
    // A named place the owner picked can be used with one tap.
    const suggestion = place?.feature_type === "poi" && place.venue_name
      ? cleanTitle(place.venue_name)
      : null;
    return Promise.resolve({
      done: false,
      ask: textQuestion({
        ctx,
        noun: NOUN,
        key: "name",
        title: "Venue name",
        text: "What's the venue called?",
        label: "Venue name",
        placeholder: "e.g. The Lagoon Room",
        options: suggestion ? [{ id: "use_place", label: suggestion }] : [],
      }),
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const place = placeAnswer(ctx.run);
    const response = choiceId === "use_place" && place?.venue_name
      ? place.venue_name
      : formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const name = cleanTitle(response).slice(0, 80);
    if (name.length < 2) {
      return Promise.resolve(retry(ctx, "I need a name of at least two letters."));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { name: owner(name), slug: owner(null) },
    });
  },
};

const slugStep: StepDefinition = {
  key: "venue_slug",
  title: "Web address",
  kind: "question",
  depends_on: ["venue_name"],
  policy: "blocking",
  async probe(ctx) {
    const chosen = stringAnswer(ctx.run, "slug");
    if (chosen) return done("owner_slug", chosen);
    const name = stringAnswer(ctx.run, "name") ?? "";
    const suggestion = freeSlug(slugFromName(name), await takenSlugs(ctx));
    return {
      done: false,
      ask: {
        ...textQuestion({
          ctx,
          noun: NOUN,
          key: `slug:${suggestion}`,
          title: "Web address",
          text: `The venue's page will end in /v/${suggestion}. Use that, or type another — lowercase letters and numbers only, up to 32.`,
          label: "Web address",
          placeholder: `e.g. ${suggestion}`,
          options: [{ id: "use_suggested", label: `Use ${suggestion}` }],
        }),
        record: { data: { attempt: attemptOf(ctx), suggestion } },
      },
    };
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  async onAnswer(ctx, choiceId, given) {
    const suggested = typeof ctx.state?.data?.suggestion === "string"
      ? ctx.state.data.suggestion
      : null;
    const response = choiceId === "use_suggested"
      ? suggested
      : formResponse(choiceId, given);
    if (response === null) return null;
    const slug = response.trim().toLowerCase().replace(/^\/?v\//, "");
    if (!VENUE_SLUG.test(slug)) {
      return retry(
        ctx,
        "A web address can only use lowercase letters and numbers, up to 32. Nothing was saved.",
      );
    }
    if ((await takenSlugs(ctx)).has(slug)) {
      return retry(
        ctx,
        `Another of your venues already uses ${slug}. Nothing was saved.`,
      );
    }
    return { record: { state: "pending" }, answers: { slug: owner(slug) } };
  },
};

async function categoryOptions(
  ctx: FlowContext,
): Promise<{ id: string; label: string }[]> {
  const stay = await ctx.deps.featureFlag?.(STAY_AUTHORING_FLAG) ?? false;
  return stay
    ? [...VENUE_CATEGORY_OPTIONS, STAY_CATEGORY_OPTION]
    : [...VENUE_CATEGORY_OPTIONS];
}

const categoryStep: StepDefinition = {
  key: "venue_category",
  title: "Category",
  kind: "question",
  depends_on: ["venue_slug"],
  policy: "blocking",
  async probe(ctx) {
    const category = stringAnswer(ctx.run, "category");
    if (category) return done("owner_category", category);
    return {
      done: false,
      ask: choiceQuestion({
        noun: NOUN,
        key: "category",
        title: "Category",
        text: "What kind of venue is it?",
        options: await categoryOptions(ctx),
      }),
    };
  },
  async onAnswer(ctx, choiceId) {
    if (!(await categoryOptions(ctx)).some((option) => option.id === choiceId)) {
      return null;
    }
    return { record: { state: "pending" }, answers: { category: owner(choiceId) } };
  },
};

/** Earlier days first, then the newest answer's days on top. */
export function mergeHourRows(
  earlier: unknown,
  latest: VenueHourRow[],
): VenueHourRow[] {
  const byDay = new Map<number, VenueHourRow>();
  if (Array.isArray(earlier)) {
    for (const row of earlier as VenueHourRow[]) {
      if (Number.isInteger(row?.weekday)) byDay.set(row.weekday, row);
    }
  }
  for (const row of latest) byDay.set(row.weekday, row);
  return [...byDay.values()].sort((a, b) => a.weekday - b.weekday);
}

function hoursAnswer(run: FlowRun): VenueHourRow[] | null {
  const value = answer(run, "hours");
  return Array.isArray(value) && value.length === 7
    ? value as VenueHourRow[]
    : null;
}

const hoursStep: StepDefinition = {
  key: "venue_hours",
  title: "Opening hours",
  kind: "question",
  depends_on: ["venue_category"],
  policy: "blocking",
  probe(ctx) {
    const hours = hoursAnswer(ctx.run);
    if (hours) return Promise.resolve(done("owner_hours", hoursWords(hours)));
    const ask = textQuestion({
      ctx,
      noun: NOUN,
      key: "hours",
      title: "Opening hours",
      text:
        "What are the opening hours? Give every day — for example: 9am–5pm every day, or Mon–Fri 9am–5pm, Sat 10am–2pm, Sun closed.",
      label: "Opening hours",
      placeholder: "e.g. Mon–Fri 9am–5pm, Sat 10am–2pm, Sun closed",
    });
    // Re-asking must carry the days already given (see onAnswer).
    const partial = ctx.state?.data?.partial_hours;
    return Promise.resolve({
      done: false,
      ask: partial
        ? {
          ...ask,
          record: {
            ...ask.record,
            data: { ...(ask.record?.data ?? {}), partial_hours: partial },
          },
        }
        : ask,
    });
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const parsed = parseVenueHours(response);
    if (parsed.problem) {
      return Promise.resolve(retry(ctx, `${parsed.problem} Nothing was saved.`));
    }
    // #3355 — days given in an earlier answer are kept: asked only for the
    // missing days, the owner's reply completes the week instead of
    // replacing it (otherwise the question loops forever).
    const rows = mergeHourRows(ctx.state?.data?.partial_hours, parsed.rows);
    const missing = [0, 1, 2, 3, 4, 5, 6].filter((day) =>
      !rows.some((row) => row.weekday === day)
    );
    if (missing.length > 0) {
      const asked = retry(
        ctx,
        `I still need the hours for ${
          listWords(missing.map((day) => WEEKDAY_WORDS[day]))
        } (or say closed). The other days are kept.`,
      );
      return Promise.resolve({
        ...asked,
        record: {
          ...asked.record,
          data: { ...asked.record.data, partial_hours: rows },
        },
      });
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { hours: owner(rows) },
    });
  },
};

const contactStep: StepDefinition = {
  key: "venue_contact",
  title: "Contact",
  kind: "question",
  depends_on: ["venue_hours"],
  policy: "blocking",
  async probe(ctx) {
    const contact = contactAnswer(ctx.run);
    if (contact) return done("owner_contact", contactWords(contact));
    const brand = await ctx.deps.brandFacts?.() ?? null;
    const brandContact: Contact = {
      email: brand?.contact_email ?? null,
      phone: brand?.contact_phone ?? null,
    };
    const hasBrand = !!(brandContact.email || brandContact.phone);
    return {
      done: false,
      ask: {
        ...textQuestion({
          ctx,
          noun: NOUN,
          key: "contact",
          title: "Contact",
          text: hasBrand
            ? `How can guests reach the venue? Use your brand's contact (${
              contactWords(brandContact)
            }), or type an email or phone number.`
            : "How can guests reach the venue? Type an email or a phone number with its country code.",
          label: "Email or phone",
          placeholder: "e.g. hello@venue.com or +44 20 7946 0000",
          options: hasBrand
            ? [{ id: "use_brand", label: "Use my brand's contact" }]
            : [],
        }),
        record: { data: { attempt: attemptOf(ctx), brand: brandContact } },
      },
    };
  },
  textAnswer: (_ctx, text) => typedAnswer(text),
  onAnswer(ctx, choiceId, given) {
    if (choiceId === "use_brand") {
      const brand = ctx.state?.data?.brand as Contact | undefined;
      if (!brand || !(brand.email || brand.phone)) return Promise.resolve(null);
      return Promise.resolve({
        record: { state: "pending" },
        answers: { contact: owner(brand) },
      });
    }
    const response = formResponse(choiceId, given);
    if (response === null) return Promise.resolve(null);
    const contact = parseContact(response);
    if (!contact) {
      return Promise.resolve(retry(
        ctx,
        "I need an email, or a phone number with its country code (like +44…). Nothing was saved.",
      ));
    }
    return Promise.resolve({
      record: { state: "pending" },
      answers: { contact: owner(contact) },
    });
  },
};

/** The create_venue_listing args — only the owner's facts. */
export function createVenueArgs(
  brandId: string,
  run: FlowRun,
): Record<string, unknown> | null {
  const place = placeAnswer(run);
  const name = stringAnswer(run, "name");
  const slug = stringAnswer(run, "slug");
  const category = stringAnswer(run, "category");
  const hours = hoursAnswer(run);
  const contact = contactAnswer(run);
  if (!place || !name || !slug || !category || !hours || !contact) return null;
  return {
    brand_id: brandId,
    name,
    slug,
    lat: place.lat,
    lng: place.lng,
    address: place.address,
    city: place.city,
    ...(place.country_code ? { country_code: place.country_code } : {}),
    // The Host reads precision from the pick (#1629).
    coordinate_precision: place.feature_type === "address" ||
        place.feature_type === "poi"
      ? "exact"
      : "approximate",
    venue_category: category,
    hours,
    ...(contact.email ? { contact_email: contact.email } : {}),
    ...(contact.phone ? { contact_phone: contact.phone } : {}),
  };
}

function createVenueRows(run: FlowRun): { label: string; value: string }[] {
  const place = placeAnswer(run);
  const category = stringAnswer(run, "category");
  const hours = hoursAnswer(run);
  const contact = contactAnswer(run);
  const categoryLabel = [...VENUE_CATEGORY_OPTIONS, STAY_CATEGORY_OPTION].find(
    (option) => option.id === category,
  )?.label;
  return [
    { label: "Venue", value: stringAnswer(run, "name") ?? "" },
    { label: "Address", value: place?.address ?? "" },
    { label: "Web address", value: `/v/${stringAnswer(run, "slug") ?? ""}` },
    { label: "Category", value: categoryLabel ?? "" },
    { label: "Hours", value: hours ? hoursWords(hours) : "" },
    { label: "Contact", value: contact ? contactWords(contact) : "" },
    { label: "After you submit", value: VENUE_REVIEW_WORDS },
  ].filter((row) => row.value);
}

async function venueRow(ctx: FlowContext): Promise<FlowVenueRow | null> {
  if (!ctx.run.subject_id || !ctx.deps.venues) return null;
  return (await ctx.deps.venues()).find((venue) =>
    venue.id === ctx.run.subject_id
  ) ?? null;
}

const createStep: StepDefinition = {
  key: "venue_create",
  title: "Submit the venue",
  kind: "proposal",
  depends_on: ["venue_contact"],
  policy: "blocking",
  subject_tools: ["create_venue_listing"],
  async probe(ctx): Promise<ProbeResult> {
    const proposed = ctx.state?.state === "awaiting_approval";
    const row = await venueRow(ctx);
    if (row) {
      return {
        done: true,
        note: proposed
          ? `Saved and checked: "${row.name}" is submitted. ${VENUE_REVIEW_WORDS} I'll keep it in review until then; nobody sees it yet.`
          : undefined,
        evidence: {
          probe: "venue_exists",
          observed: { id: row.id, name: row.name, claim_status: row.claim_status },
        },
      };
    }
    if (proposed && ctx.trigger !== "confirm" && await proposalOpen(ctx)) {
      return { done: false, wait: true };
    }
    const args = createVenueArgs(ctx.run.brand_id, ctx.run);
    const refused = failedReason(
      ctx,
      "create_venue_listing",
      "The venue wasn't submitted, so nothing was saved.",
    );
    const note = proposed && ctx.trigger === "confirm"
      ? refused ?? "The venue wasn't submitted, so nothing is shown as saved."
      : undefined;
    if (!args) {
      return {
        done: false,
        note,
        ask: choiceQuestion({
          noun: NOUN,
          key: "create:incomplete",
          title: "Submit the venue",
          text: "I'm missing a detail for this venue, so nothing was submitted.",
          options: [{ id: "cancel", label: "Stop here" }],
        }),
      };
    }
    return {
      done: false,
      note,
      propose: {
        tool_name: "create_venue_listing",
        tool_args: args,
        rows: createVenueRows(ctx.run),
        rows_only: true,
      },
      ask: choiceQuestion({
        noun: NOUN,
        key: "create:ready",
        title: "Submit the venue",
        text: `Ready to submit "${stringAnswer(ctx.run, "name")}"? ${VENUE_REVIEW_WORDS}`,
        options: [
          { id: "create", label: "Submit for review" },
          { id: "change_hours", label: "Change the hours" },
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
        ack: "Okay, I've stopped here. Nothing was submitted.",
      });
    }
    if (choiceId === "change_hours") {
      return Promise.resolve({
        record: { state: "pending" },
        answers: { hours: owner(null) },
        ack: "Okay. Nothing was saved.",
      });
    }
    if (choiceId !== "create") return Promise.resolve(null);
    const args = createVenueArgs(ctx.run.brand_id, ctx.run);
    if (!args) return Promise.resolve(null);
    return Promise.resolve({
      record: { state: "awaiting_approval", data: {} },
      propose: {
        tool_name: "create_venue_listing",
        tool_args: args,
        rows: createVenueRows(ctx.run),
        rows_only: true,
      },
    });
  },
};

const coverStep: StepDefinition = {
  key: "venue_cover",
  title: "Cover",
  kind: "handoff",
  depends_on: ["venue_create"],
  policy: "skippable",
  async probe(ctx) {
    const row = await venueRow(ctx);
    if (!row) return done("no_subject", true);
    if (row.cover_media_url) {
      return {
        done: true,
        note: ctx.state?.state === "human_action"
          ? "I checked; your cover is on the venue."
          : undefined,
        evidence: { probe: "venue_cover", observed: true },
      };
    }
    if (answer(ctx.run, "cover_skipped") === true) {
      return done("cover_skipped", true);
    }
    return {
      done: false,
      ask: {
        kind: "handoff",
        reuse_key: `${NOUN}:cover`,
        title: "Add a cover",
        text:
          "Add a cover photo on the venue page so guests can see it. You choose it — Ari never adds one for you.",
        options: [
          { id: "check", label: "I've added it, check now" },
          { id: "not_now", label: "Not now" },
        ],
        handoff: {
          item_key: "venue_cover",
          item_label: "Venue cover",
          route: `/venue/${row.id}`,
          route_label: "the venue",
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
      ack: "Okay, no cover for now. You can add one on the venue page anytime.",
    });
  },
};

function summarize(run: FlowRun): {
  title: string;
  text: string;
  evidence: FlowEvidence;
} | null {
  const created = run.step_states.venue_create;
  if (created?.state !== "done" || !created.evidence) return null;
  const observed = created.evidence.observed as { name?: string } | undefined;
  const name = observed?.name ? `"${observed.name}"` : "Your venue";
  return {
    title: "Your venue is in review",
    text: `${name} is submitted and I've checked it's there. ${VENUE_REVIEW_WORDS} Nobody can see it until then.`,
    evidence: created.evidence,
  };
}

/**
 * The create_venue flow, version 2. Version 1 (P3: gates, then the old model
 * lane) stays registered so a run already started on it finishes there.
 */
export const CREATE_VENUE_FLOW: FlowDefinition = {
  key: "create_venue",
  version: VENUE_FLOW_VERSION,
  title: "Create a venue",
  subject: "offering",
  concurrency: "one_per_subject",
  noun: NOUN,
  readiness: {
    draft: "venue_submit",
    publish: "venue_submit",
    publish_paid: null,
  },
  subject_tools: ["create_venue_listing"],
  subject_table: "venue_listings",
  steps: [
    brandBlockersStep,
    brandCanWaitStep,
    // Nothing is sold on a venue listing (no paid readiness), so this step
    // always passes; it keeps every offering flow the same shape.
    moneyGateStep,
    placeStep,
    nameStep,
    slugStep,
    categoryStep,
    hoursStep,
    contactStep,
    createStep,
    coverStep,
  ],
  summarize,
};
